import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error The production checkpoint utility is intentionally plain Node ESM.
import { buildSourceCheckpoint as untypedBuildSourceCheckpoint } from "../../../scripts/package-source-checkpoint.mjs";

interface CheckpointSummary {
  artifact: string;
  fileCount: number;
  sha256: string;
  sourceFileCount: number;
  uncompressedBytes: number;
}

const buildSourceCheckpoint = untypedBuildSourceCheckpoint as (options: {
  projectRoot: string;
  sliceLabel: string;
}) => Promise<CheckpointSummary>;

const requiredRootFiles = [
  ".gitignore",
  ".nvmrc",
  "compose.mariadb-test.yml",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next-env.d.ts",
  "next.config.mjs",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "vitest.config.mts",
  "vitest.integration.config.mts",
];

interface ZipEntry {
  content: Buffer;
  name: string;
}

function zipEntries(archive: Buffer): ZipEntry[] {
  const endSignature = 0x0605_4b50;
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Checkpoint ZIP end record is missing.");

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x0201_4b50) {
      throw new Error("Checkpoint ZIP central directory is invalid.");
    }
    const compressionMethod = archive.readUInt16LE(centralOffset + 10);
    const contentLength = archive.readUInt32LE(centralOffset + 24);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive.toString(
      "utf8",
      centralOffset + 46,
      centralOffset + 46 + nameLength,
    );
    if (compressionMethod !== 0 || archive.readUInt32LE(localOffset) !== 0x0403_4b50) {
      throw new Error("Checkpoint ZIP entry format is unsupported.");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      content: archive.subarray(contentOffset, contentOffset + contentLength),
      name,
    });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function writeFixture(root: string, path: string, content: string) {
  const absolutePath = resolve(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function scaffoldSafeProject(root: string) {
  for (const file of requiredRootFiles) {
    await writeFixture(root, file, `SAFE_FIXTURE:${file}\n`);
  }
  await writeFixture(root, "docs/migrations.md", "# Safe runbook\n");
  await writeFixture(root, "drizzle/0000_safe.sql", "SELECT 1;\n");
  await writeFixture(root, "drizzle/meta/_journal.json", "{}\n");
  await writeFixture(root, "public/offline-v1.html", "<!doctype html>\n");
  await writeFixture(root, "public/icons/safe.png", "SAFE_FAKE_PNG\n");
  await writeFixture(root, "scripts/package-source-checkpoint.mjs", "export {};\n");
  await writeFixture(root, "scripts/migrate.mjs", "export {};\n");
  await writeFixture(root, "scripts/probe-readiness-secure.ps1", "# safe fixture\n");
  await writeFixture(root, "src/app/page.tsx", "export default function Page() {}\n");
  await writeFixture(root, "src/app/globals.css", ":root {}\n");
  await writeFixture(root, "src/app/page.test.ts", "export {};\n");
  await writeFixture(root, "tests/integration/safe.test.ts", "export {};\n");

  const excludedSentinel = "FAKE_EXCLUDED_SENTINEL_NOT_A_SECRET";
  await writeFixture(root, ".env.example", `FAKE_VALUE=${excludedSentinel}\n`);
  await writeFixture(root, ".env.local", `FAKE_VALUE=${excludedSentinel}\n`);
  await writeFixture(root, ".next/cache.bin", excludedSentinel);
  await writeFixture(root, ".logs/local.log", excludedSentinel);
  await writeFixture(root, ".git/config", excludedSentinel);
  await writeFixture(root, "dist/old.zip", excludedSentinel);
  await writeFixture(root, "node_modules/fake/index.js", excludedSentinel);
  await writeFixture(root, "outputs/plan.md", excludedSentinel);
  await writeFixture(root, "playwright-report/index.html", excludedSentinel);
  await writeFixture(root, "test-results/result.txt", excludedSentinel);
  await writeFixture(root, "work/evidence.txt", excludedSentinel);
}

describe.sequential("source checkpoint policy", () => {
  let projectRoot = "";
  let outputPath = "";
  const sliceLabel = "komut3b-test-fixture";

  beforeEach(async () => {
    projectRoot = await mkdtemp(resolve(tmpdir(), "portal-pusula-checkpoint-"));
    outputPath = resolve(
      projectRoot,
      "dist",
      `portal-pusula-source-checkpoint-${sliceLabel}.zip`,
    );
    await scaffoldSafeProject(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { force: true, recursive: true });
  });

  it("creates the same safe source archive twice", async () => {
    const first = await buildSourceCheckpoint({ projectRoot, sliceLabel });
    const firstArchive = await readFile(outputPath);
    const second = await buildSourceCheckpoint({ projectRoot, sliceLabel });
    const secondArchive = await readFile(outputPath);

    expect(second).toEqual(first);
    expect(secondArchive).toEqual(firstArchive);
    expect(first.sha256).toBe(
      createHash("sha256").update(firstArchive).digest("hex"),
    );

    const entries = zipEntries(firstArchive);
    const names = entries.map((entry) => entry.name);
    expect(names[0]).toBe("CHECKPOINT-MANIFEST.json");
    expect(names.slice(1)).toEqual([...names.slice(1)].sort());
    expect(first.fileCount).toBe(names.length);
    expect(first.sourceFileCount).toBe(names.length - 1);
    expect(names).toContain("scripts/package-source-checkpoint.mjs");
    expect(names).toContain("src/app/page.test.ts");
    expect(names).toContain("tests/integration/safe.test.ts");
    expect(names).toContain("docs/migrations.md");
    expect(names).not.toContain("README.md");
    expect(names.some((name) => name.startsWith("dist/"))).toBe(false);
    expect(firstArchive.toString("utf8")).not.toContain(
      "FAKE_EXCLUDED_SENTINEL_NOT_A_SECRET",
    );

    const manifest = JSON.parse(entries[0].content.toString("utf8")) as {
      boundary: string;
      files: unknown[];
      slice: string;
      sourceFileCount: number;
    };
    expect(manifest.boundary).toContain("not a pre-3A baseline");
    expect(manifest.boundary).toContain("not a Hostinger backup");
    expect(manifest.sourceFileCount).toBe(first.sourceFileCount);
    expect(manifest.files).toHaveLength(first.sourceFileCount);
    expect(manifest.slice).toBe(sliceLabel);
  });

  it("refuses to overwrite a different checkpoint at the same slice", async () => {
    const sentinel = "FAKE_EXISTING_CHECKPOINT_NOT_A_SECRET";
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, sentinel, "utf8");

    await expect(
      buildSourceCheckpoint({ projectRoot, sliceLabel }),
    ).rejects.toThrow("Checkpoint target already exists with different content.");
    expect(await readFile(outputPath, "utf8")).toBe(sentinel);
  });

  it.each(["", "../komut3b", "Komut3B", "komut3b_unsafe", "a".repeat(65)])(
    "rejects unsafe or missing slice label %j",
    async (unsafeSlice) => {
      await expect(
        buildSourceCheckpoint({ projectRoot, sliceLabel: unsafeSlice }),
      ).rejects.toThrow("Checkpoint slice label is invalid.");
    },
  );

  it.each([
    ["src/nested/.env.local", "FAKE_ENV_SENTINEL_NOT_A_SECRET"],
    ["src/nested/private-key.pem", "FAKE_KEY_SENTINEL_NOT_A_KEY"],
    ["src/nested/.npmrc", "FAKE_NPM_SENTINEL_NOT_A_TOKEN"],
    ["docs/nested/token.txt", "FAKE_TOKEN_SENTINEL_NOT_A_TOKEN"],
    ["drizzle/meta/auth.json", "FAKE_AUTH_SENTINEL_NOT_AUTH_DATA"],
  ])("fails closed for adversarial path %s without exposing content", async (path, sentinel) => {
    await writeFixture(projectRoot, path, sentinel);

    let failure = "";
    try {
      await buildSourceCheckpoint({ projectRoot, sliceLabel });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    expect(failure).not.toBe("");
    expect(failure).not.toContain(sentinel);
  });
});
