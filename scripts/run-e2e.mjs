import { spawn } from "node:child_process";
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

function sanitizedEnvironment(additions = {}) {
  const environment = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (
      /^DB_/iu.test(name) ||
      /^READINESS_BEARER_TOKEN$/iu.test(name) ||
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
  const baseEnvironment = sanitizedEnvironment({
    FORCE_COLOR: "0",
  });

  try {
    const port = await reserveLoopbackPort(requestedPort());
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

    if (interruptedSignal !== undefined || server.getOutcome() !== undefined) {
      return 1;
    }

    console.info(`Owned E2E server ready on loopback port ${port}.`);
    playwright = trackedChild(process.execPath, [playwrightCli, "test"], {
      ...baseEnvironment,
      PORTAL_PUSULA_E2E_BASE_URL: baseUrl,
      PORTAL_PUSULA_E2E_EXTERNAL_SERVER: "1",
    });
    const result = await playwright.completion;

    if (
      interruptedSignal !== undefined ||
      result.signal !== null ||
      result.spawnError
    ) {
      return 1;
    }

    return result.code ?? 1;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "E2E runner failed.";
    console.error(message);
    return 1;
  } finally {
    await terminateChild(playwright);
    await terminateChild(server);
  }
}

process.exitCode = await main();
