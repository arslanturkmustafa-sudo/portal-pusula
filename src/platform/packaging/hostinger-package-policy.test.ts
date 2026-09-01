import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const fixtureDirectory = resolve(
  projectRoot,
  "src",
  "__hostinger_package_policy_fixture__",
);
const packageScript = resolve(projectRoot, "scripts", "package-hostinger.mjs");
const packagePath = resolve(
  projectRoot,
  "dist",
  "portal-pusula-hostinger.zip",
);

interface PackageResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

function runPackager(): Promise<PackageResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [packageScript], {
      cwd: projectRoot,
      env: process.env,
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

function runPolicyProbe(source: string): Promise<PackageResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
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

function zipEntryNames(archive: Buffer): string[] {
  const endSignature = 0x0605_4b50;
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error("Hostinger ZIP end record is missing.");
  }

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let offset = archive.readUInt32LE(endOffset + 16);
  const names: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x0201_4b50) {
      throw new Error("Hostinger ZIP central directory is invalid.");
    }
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.push(archive.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

describe.sequential("Hostinger package sensitive-file policy", () => {
  afterEach(async () => {
    await rm(fixtureDirectory, { force: true, recursive: true });
  });

  it("rejects traversal and absolute archive entry candidates", async () => {
    const moduleUrl = pathToFileURL(packageScript).href;
    const candidates = [
      "",
      "../secret",
      "src/../secret.ts",
      "src/./secret.ts",
      "src//secret.ts",
      "/absolute/secret",
      "C:/absolute/secret",
      "src\\..\\secret.ts",
    ];
    const result = await runPolicyProbe(`
      import { assertSafeArchivePath } from ${JSON.stringify(moduleUrl)};
      const candidates = ${JSON.stringify(candidates)};
      for (const candidate of candidates) {
        let rejected = false;
        try { assertSafeArchivePath(candidate); } catch { rejected = true; }
        if (!rejected) process.exit(17);
      }
    `);

    expect(result.code).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toBe("");
  });

  it("rejects case-insensitive archive entry collisions", async () => {
    const moduleUrl = pathToFileURL(packageScript).href;
    const result = await runPolicyProbe(`
      import { assertUniqueCaseInsensitiveArchivePaths } from ${JSON.stringify(moduleUrl)};
      let rejected = false;
      try {
        assertUniqueCaseInsensitiveArchivePaths(["src/cron/Gate.ts", "src/cron/gate.ts"]);
      } catch { rejected = true; }
      if (!rejected) process.exit(19);
    `);

    expect(result.code).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toBe("");
  });

  it.each([
    [".npmrc", "FAKE_NPMRC_SENTINEL_NOT_A_TOKEN"],
    ["token.txt", "FAKE_TOKEN_SENTINEL_NOT_A_TOKEN"],
    ["auth.json", "FAKE_AUTH_SENTINEL_NOT_CREDENTIALS"],
    [".env.local", "FAKE_ENV_SENTINEL_NOT_A_SECRET"],
    ["private-key.pem", "FAKE_PRIVATE_KEY_SENTINEL_NOT_A_KEY"],
  ])(
    "fails closed for nested %s without exposing fixture content",
    async (fileName, sentinel) => {
      await mkdir(fixtureDirectory, { recursive: true });
      await writeFile(resolve(fixtureDirectory, fileName), sentinel, "utf8");

      const result = await runPackager();

      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(sentinel);
      const previousArchive = await readFile(packagePath).catch(() => null);
      expect(previousArchive?.includes(Buffer.from(sentinel))).not.toBe(true);
    },
  );

  it("packages the fixed production allowlist and required migration assets", async () => {
    const firstResult = await runPackager();

    expect(firstResult.code).toBe(0);
    const firstArchive = await readFile(packagePath);
    const firstEntries = zipEntryNames(firstArchive);

    const secondResult = await runPackager();
    expect(secondResult.code).toBe(0);
    const secondArchive = await readFile(packagePath);
    const entries = zipEntryNames(secondArchive);

    expect(secondArchive.equals(firstArchive)).toBe(true);
    expect(entries).toEqual(firstEntries);
    expect(entries).toContain("package.json");
    expect(entries).toContain("scripts/migrate.mjs");
    expect(entries).toContain("scripts/migration-integrity.mjs");
    expect(entries).toContain("scripts/mysql-session-policy.mjs");
    expect(entries).toContain(
      "drizzle/0000_platform_migration_verification.sql",
    );
    expect(entries).toContain(
      "drizzle/0001_platform_job_outbox_audit.sql",
    );
    expect(entries).toContain(
      "drizzle/0002_platform_state_constraints.sql",
    );
    expect(entries).toContain(
      "drizzle/0003_platform_cron_dispatch_gate.sql",
    );
    expect(entries).toContain("drizzle/0004_customer.sql");
    expect(entries).toContain("drizzle/meta/_journal.json");
    expect(entries).toContain("drizzle/meta/0000_snapshot.json");
    expect(entries).toContain("drizzle/meta/0001_snapshot.json");
    expect(entries).toContain("drizzle/meta/0002_snapshot.json");
    expect(entries).toContain("drizzle/meta/0003_snapshot.json");
    expect(entries).toContain("drizzle/meta/0004_snapshot.json");
    expect(entries).toContain("public/offline-v1.html");
    expect(entries).toContain("public/icons/portal-pusula-192-v1.png");

    expect(entries).not.toContain("scripts/package-source-checkpoint.mjs");
    expect(entries).not.toContain(
      "scripts/build-phpmyadmin-migration-bundle.mjs",
    );
    expect(entries).not.toContain("scripts/generate-admin-auth.mjs");
    expect(entries).not.toContain("scripts/probe-readiness-secure.ps1");
    expect(entries).not.toContain("scripts/test-mariadb.mjs");
    expect(entries).not.toContain("scripts/run-e2e.mjs");
    expect(entries).not.toContain("scripts/scan-secrets.mjs");
    expect(entries).not.toContain("scripts/verify-hostinger-package.mjs");
    expect(entries.some((entry) => /\.test\.tsx?$/u.test(entry))).toBe(false);

    const requiredRootFiles = new Set([
      ".nvmrc",
      "next-env.d.ts",
      "next.config.mjs",
      "package-lock.json",
      "package.json",
      "postcss.config.mjs",
      "tsconfig.json",
    ]);
    const allowedPublicFiles = new Set([
      "public/icons/portal-pusula-192-v1.png",
      "public/icons/portal-pusula-512-v1.png",
      "public/icons/portal-pusula-maskable-512-v1.png",
      "public/offline-v1.html",
    ]);
    const allowedProductionScripts = new Set([
      "scripts/migrate.mjs",
      "scripts/migration-integrity.mjs",
      "scripts/mysql-session-policy.mjs",
    ]);

    for (const entry of entries) {
      const isAllowed =
        requiredRootFiles.has(entry) ||
        allowedPublicFiles.has(entry) ||
        allowedProductionScripts.has(entry) ||
        /^drizzle\/\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/u.test(entry) ||
        /^drizzle\/meta\/(?:_journal|\d{4}_snapshot)\.json$/u.test(entry) ||
        (/^src\/.*\.(?:css|ts|tsx)$/u.test(entry) &&
          !/(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:spec|test))\.tsx?$/u.test(
            entry,
          ));
      expect(isAllowed, `unexpected production ZIP entry: ${entry}`).toBe(true);
    }
  });
});
