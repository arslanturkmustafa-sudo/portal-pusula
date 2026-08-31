import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const composeFile = path.join(repositoryRoot, "compose.mariadb-test.yml");
const serviceName = "mariadb-test";
const projectName = `portal-pusula-it-${process.pid}-${randomBytes(4).toString("hex")}`;

const testDatabase = Object.freeze({
  DB_HOST: "127.0.0.1",
  DB_NAME: "portal_pusula_migration_test",
  DB_USER: "portal_pusula_test",
  DB_PASSWORD: "portal-pusula-local-test-only",
  PORTAL_PUSULA_DISPOSABLE_MARIADB: "1",
});

const safeEnvironmentKeys = [
  "APPDATA",
  "CI",
  "CommonProgramFiles",
  "FORCE_COLOR",
  "HOME",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "Path",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramW6432",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
];

function runtimeEnvironment(additions = {}) {
  const environment = {};

  for (const key of safeEnvironmentKeys) {
    if (process.env[key] !== undefined) {
      environment[key] = process.env[key];
    }
  }

  return { ...environment, ...additions };
}

function run(command, args, options = {}) {
  const { capture = false, environment = runtimeEnvironment() } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });

    let stdout = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      // Do not retain or echo stderr: lifecycle failures must not accidentally
      // surface details from a developer's machine or Docker configuration.
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

      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command} failed with ${outcome}.`));
    });
  });
}

const dockerEnvironment = runtimeEnvironment({
  // The compose file is fully static. Do not auto-read a developer `.env`.
  COMPOSE_DISABLE_ENV_FILE: "true",
});

function dockerCompose(...args) {
  return [
    "--context",
    "default",
    "compose",
    "--file",
    composeFile,
    "--project-name",
    projectName,
    ...args,
  ];
}

function runIntegrationFile(fileName, publishedPort) {
  return run(
    process.execPath,
    [
      path.join("node_modules", "vitest", "vitest.mjs"),
      "run",
      "--config",
      "vitest.integration.config.mts",
      path.join("tests", "integration", fileName),
    ],
    {
      environment: runtimeEnvironment({
        ...testDatabase,
        DB_PORT: publishedPort,
      }),
    },
  );
}

async function stopEnvironment() {
  try {
    await run(
      "docker",
      dockerCompose("down", "--volumes", "--remove-orphans", "--timeout", "10"),
      { capture: true, environment: dockerEnvironment },
    );
  } catch {
    console.error(
      `Disposable MariaDB cleanup failed. Retry: docker --context default compose --file compose.mariadb-test.yml --project-name ${projectName} down --volumes --remove-orphans`,
    );
    process.exitCode = 1;
  }
}

function parseLoopbackPort(value) {
  const lines = value.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("Expected exactly one disposable MariaDB port mapping.");
  }

  const match = /^127\.0\.0\.1:(\d{1,5})$/u.exec(lines[0]);
  const port = match ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Disposable MariaDB was not bound to an IPv4 loopback port.");
  }

  return String(port);
}

let exitCode = 0;

try {
  console.log("Starting isolated MariaDB 11.4.8 test environment...");
  await run(
    "docker",
    dockerCompose("up", "--detach", "--wait", "--wait-timeout", "120"),
    { environment: dockerEnvironment },
  );

  const publishedPort = parseLoopbackPort(
    await run("docker", dockerCompose("port", serviceName, "3306"), {
      capture: true,
      environment: dockerEnvironment,
    }),
  );

  console.log("Running migration correctness tests against disposable MariaDB...");
  await runIntegrationFile(
    "mariadb-migrations.test.ts",
    publishedPort,
  );

  // These suites intentionally share the same disposable database and mutate
  // the same platform tables, so they must remain separate, serial processes.
  console.log("Running job, outbox, and audit tests against disposable MariaDB...");
  await runIntegrationFile("mariadb-job-engine.test.ts", publishedPort);

  console.log("Running durable cron dispatch gate tests against disposable MariaDB...");
  await runIntegrationFile("mariadb-cron-gate.test.ts", publishedPort);
} catch (error) {
  exitCode = 1;
  console.error(
    error instanceof Error
      ? error.message
      : "Disposable MariaDB integration run failed.",
  );
} finally {
  console.log("Stopping disposable MariaDB and removing its volume...");
  await stopEnvironment();
}

if (process.exitCode && process.exitCode !== 0) {
  exitCode = process.exitCode;
}

process.exitCode = exitCode;
