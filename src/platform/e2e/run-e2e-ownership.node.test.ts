// @vitest-environment node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { expect, it } from "vitest";

const projectRoot = process.cwd();
const runnerPath = resolve(projectRoot, "scripts", "run-e2e.mjs");

function runWithOccupiedPort(port: number) {
  return new Promise<{
    code: number | null;
    stderr: string;
    stdout: string;
  }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [runnerPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DB_PASSWORD: "FAKE_DB_SENTINEL_NOT_A_SECRET",
        PORTAL_PUSULA_E2E_PORT: String(port),
        READINESS_BEARER_TOKEN: "FakeTokenValue01",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let stdout = "";

    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolveResult({ code, stderr, stdout });
    });
  });
}

it("fails before Playwright when another process owns the selected port", async () => {
  let acceptedConnections = 0;
  const occupiedServer = createServer((socket) => {
    acceptedConnections += 1;
    socket.end(
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}",
    );
  });

  await new Promise<void>((resolveListen, reject) => {
    occupiedServer.once("error", reject);
    occupiedServer.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = occupiedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a loopback port.");
    }

    const result = await runWithOccupiedPort(address.port);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.code).not.toBe(0);
    expect(output).toContain("E2E loopback port is unavailable.");
    expect(output).not.toMatch(/Running\s+\d+\s+tests?/iu);
    expect(acceptedConnections).toBe(0);
    expect(output).not.toContain("FAKE_DB_SENTINEL_NOT_A_SECRET");
    expect(output).not.toContain("FakeTokenValue01");
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      occupiedServer.close((error) => {
        if (error) reject(error);
        else resolveClose();
      });
    });
  }
});
