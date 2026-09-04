import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import path from "node:path";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const host = "127.0.0.1";
const startupTimeoutMs = 120_000;
const shutdownTimeoutMs = 5_000;
const healthAttemptTimeoutMs = 2_000;
const startupOutputLimit = 8_192;
const composeFile = path.join(projectRoot, "compose.mariadb-test.yml");
const databaseServiceName = "mariadb-test";
const databaseProjectName = `portal-pusula-e2e-${process.pid}-${randomBytes(4).toString("hex")}`;
const disposableDatabase = Object.freeze({
  DB_HOST: "127.0.0.1",
  DB_NAME: "portal_pusula_migration_test",
  DB_PASSWORD: "portal-pusula-local-test-only",
  DB_USER: "portal_pusula_test",
  PORTAL_PUSULA_DISPOSABLE_MARIADB: "1",
});
const safeAuthDiagnosticCategories = new Set([
  "auth_database_unavailable",
  "auth_env_invalid",
  "auth_scrypt_runtime_error",
  "credentials_rejected",
  "request_body_rejected",
  "request_content_type_rejected",
  "request_origin_rejected",
]);
const observedAuthDiagnosticCategories = new Set();
const e2eAdminEmail = "e2e-admin@example.test";
const e2eAdminPassword = "fake-e2e-password";
const e2eSalt = Buffer.alloc(16, 11);
const e2eKey = scryptSync(e2eAdminPassword, e2eSalt, 64, {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const e2ePasswordHash = [
  "scrypt",
  "32768",
  "8",
  "1",
  e2eSalt.toString("base64url"),
  e2eKey.toString("base64url"),
].join(":");

function sanitizedEnvironment(additions = {}) {
  const environment = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (
      /^DB_/iu.test(name) ||
      /^READINESS_BEARER_TOKEN$/iu.test(name) ||
      /^(?:ADMIN_EMAIL|ADMIN_PASSWORD_HASH|SESSION_SECRET)$/u.test(name) ||
      /^PORTAL_PUSULA_AUTH_STORAGE_MODE$/u.test(name) ||
      /^PORTAL_PUSULA_E2E_/iu.test(name) ||
      /^(?:FORCE_COLOR|NO_COLOR)$/u.test(name)
    ) {
      continue;
    }

    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return { ...environment, ...additions };
}

function trackedChild(command, args, environment, stdio = "inherit") {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: environment,
    shell: false,
    stdio,
    windowsHide: true,
  });

  let outcome;
  const completion = new Promise((resolve) => {
    child.once("error", () => {
      outcome = { code: 1, signal: null, spawnError: true };
      resolve(outcome);
    });
    child.once("exit", (code, signal) => {
      if (outcome === undefined) {
        outcome = { code, signal, spawnError: false };
        resolve(outcome);
      }
    });
  });

  return {
    child,
    completion,
    getOutcome: () => outcome,
  };
}

function runOneShot(command, args, environment, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: environment,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    let stdout = "";

    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.resume();
    }

    child.once("error", () => {
      reject(new Error(`Could not start ${command}.`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
        ),
      );
    });
  });
}

function dockerComposeArguments(...args) {
  return [
    "--context",
    "default",
    "compose",
    "--file",
    composeFile,
    "--project-name",
    databaseProjectName,
    ...args,
  ];
}

function parseLoopbackDatabasePort(value) {
  const lines = value.split(/\r?\n/u).filter(Boolean);
  const match = lines.length === 1 ? /^127\.0\.0\.1:(\d{1,5})$/u.exec(lines[0]) : null;
  const port = match ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Disposable E2E database port is invalid.");
  }
  return String(port);
}

const dockerEnvironment = sanitizedEnvironment({
  COMPOSE_DISABLE_ENV_FILE: "true",
});
let databaseStarted = false;

async function startDisposableDatabase() {
  databaseStarted = true;
  console.info("Starting isolated MariaDB for production-mode E2E...");
  await runOneShot(
    "docker",
    dockerComposeArguments("up", "--detach", "--wait", "--wait-timeout", "120"),
    dockerEnvironment,
  );
  const port = parseLoopbackDatabasePort(
    await runOneShot(
      "docker",
      dockerComposeArguments("port", databaseServiceName, "3306"),
      dockerEnvironment,
      true,
    ),
  );
  const databaseEnvironment = sanitizedEnvironment({
    ...disposableDatabase,
    DB_PORT: port,
  });
  await runOneShot(
    process.execPath,
    [path.join("scripts", "migrate.mjs")],
    databaseEnvironment,
  );
  return { ...disposableDatabase, DB_PORT: port };
}

async function stopDisposableDatabase() {
  if (!databaseStarted) return;
  await runOneShot(
    "docker",
    dockerComposeArguments(
      "down",
      "--volumes",
      "--remove-orphans",
      "--timeout",
      "10",
    ),
    dockerEnvironment,
    true,
  );
  databaseStarted = false;
}

function requestedPort() {
  const rawValue = process.env.PORTAL_PUSULA_E2E_PORT;
  if (rawValue === undefined || rawValue === "") {
    return 0;
  }

  if (!/^[0-9]{1,5}$/u.test(rawValue)) {
    throw new Error("E2E runner configuration is invalid.");
  }

  const port = Number(rawValue);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("E2E runner configuration is invalid.");
  }

  return port;
}

function reserveLoopbackPort(port) {
  return new Promise((resolve, reject) => {
    const reservation = createServer();
    let settled = false;

    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new Error("E2E loopback port is unavailable."));
      }
    };

    reservation.once("error", fail);
    reservation.listen({ exclusive: true, host, port }, () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close(fail);
        return;
      }

      const selectedPort = address.port;
      reservation.close((error) => {
        if (settled) return;
        settled = true;
        if (error) {
          reject(new Error("E2E loopback port is unavailable."));
        } else {
          resolve(selectedPort);
        }
      });
    });
  });
}

function waitForOwnedReadySignal(server) {
  return new Promise((resolve, reject) => {
    let startupOutput = "";
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("E2E server did not become ready in time."));
    }, startupTimeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }

    function inspect(chunk) {
      startupOutput = `${startupOutput}${String(chunk)}`.slice(
        -startupOutputLimit,
      );
      for (const match of String(chunk).matchAll(/"category":"([a-z_]+)"/gu)) {
        if (safeAuthDiagnosticCategories.has(match[1])) {
          observedAuthDiagnosticCategories.add(match[1]);
        }
      }
      if (/\bReady in\b/u.test(startupOutput)) {
        if (server.getOutcome() === undefined) {
          finish();
        } else {
          finish(new Error("E2E server exited before becoming ready."));
        }
      }
    }

    server.child.stdout?.on("data", inspect);
    server.child.stderr?.on("data", inspect);
    void server.completion.then(() => {
      finish(new Error("E2E server exited before becoming ready."));
    });
  });
}

async function waitForOwnedHealth(server, healthUrl) {
  const deadline = Date.now() + startupTimeoutMs;

  while (Date.now() < deadline) {
    if (server.getOutcome() !== undefined) {
      throw new Error("E2E server exited before health verification.");
    }

    try {
      const response = await fetch(healthUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(healthAttemptTimeoutMs),
      });
      const isHealthy = response.ok;
      await response.body?.cancel();
      if (isHealthy && server.getOutcome() === undefined) {
        return;
      }
    } catch {
      // The owned child can emit its ready line just before accepting requests.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("E2E server health verification timed out.");
}

async function bootstrapE2eOwner(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    body: new URLSearchParams({
      email: e2eAdminEmail,
      next: "/",
      password: e2eAdminPassword,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(healthAttemptTimeoutMs * 5),
  });
  const location = response.headers.get("location");
  await response.body?.cancel();
  if (response.status !== 303 || location !== "/") {
    throw new Error("E2E owner bootstrap failed.");
  }
}

async function terminateChild(trackedProcess) {
  if (trackedProcess === undefined || trackedProcess.getOutcome() !== undefined) {
    return;
  }

  trackedProcess.child.kill("SIGTERM");
  const stopped = await Promise.race([
    trackedProcess.completion.then(() => true),
    new Promise((resolve) =>
      setTimeout(() => resolve(false), shutdownTimeoutMs),
    ),
  ]);

  if (!stopped && trackedProcess.getOutcome() === undefined) {
    trackedProcess.child.kill("SIGKILL");
    await trackedProcess.completion;
  }
}

let server;
let playwright;
let interruptedSignal;

function recordInterruption(signal) {
  interruptedSignal ??= signal;
  void terminateChild(playwright);
  void terminateChild(server);
}

process.once("SIGINT", () => recordInterruption("SIGINT"));
process.once("SIGTERM", () => recordInterruption("SIGTERM"));

async function main() {
  const nextCli = path.join(
    projectRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const playwrightCli = path.join(
    projectRoot,
    "node_modules",
    "@playwright",
    "test",
    "cli.js",
  );
  let exitCode = 1;

  try {
    const port = await reserveLoopbackPort(requestedPort());
    const databaseEnvironment = await startDisposableDatabase();
    const baseEnvironment = sanitizedEnvironment({
      ...databaseEnvironment,
      ADMIN_EMAIL: e2eAdminEmail,
      ADMIN_PASSWORD_HASH: e2ePasswordHash,
      FORCE_COLOR: "0",
      PORTAL_PUSULA_AUTH_STORAGE_MODE: "database",
      SESSION_SECRET: "FakeSessionKey01",
    });
    const baseUrl = `http://${host}:${port}`;
    const healthUrl = `${baseUrl}/api/health/live`;

    server = trackedChild(
      process.execPath,
      [nextCli, "start", "--hostname", host, "--port", String(port)],
      baseEnvironment,
      ["ignore", "pipe", "pipe"],
    );
    await waitForOwnedReadySignal(server);
    await waitForOwnedHealth(server, healthUrl);
    await bootstrapE2eOwner(baseUrl);

    if (interruptedSignal !== undefined || server.getOutcome() !== undefined) {
      exitCode = 1;
      return exitCode;
    }

    console.info(`Owned E2E server ready on loopback port ${port}.`);
    playwright = trackedChild(process.execPath, [playwrightCli, "test"], {
      ...baseEnvironment,
      PORTAL_PUSULA_E2E_BASE_URL: baseUrl,
      PORTAL_PUSULA_E2E_EXTERNAL_SERVER: "1",
    });
    const result = await playwright.completion;
    if (result.code !== 0 && observedAuthDiagnosticCategories.size > 0) {
      console.error(
        `E2E auth diagnostic categories: ${[...observedAuthDiagnosticCategories].sort().join(", ")}`,
      );
    }

    if (
      interruptedSignal !== undefined ||
      result.signal !== null ||
      result.spawnError
    ) {
      exitCode = 1;
      return exitCode;
    }

    exitCode = result.code ?? 1;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "E2E runner failed.";
    console.error(message);
    exitCode = 1;
  } finally {
    await terminateChild(playwright);
    await terminateChild(server);
    try {
      await stopDisposableDatabase();
    } catch {
      console.error("Disposable E2E database cleanup failed.");
      exitCode = 1;
    }
  }

  return exitCode;
}

process.exitCode = await main();
