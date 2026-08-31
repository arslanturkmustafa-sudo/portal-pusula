import { createHash } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = resolve(dirname(scriptPath), "..");
const maximumZip32Value = 0xffff_ffff;
const sliceLabelPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// README is deliberately outside the checkpoint. It records the immutable ZIP
// hash, so embedding that same value inside the ZIP would create a circular hash.
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

const directoryPolicies = new Map([
  ["docs", new Set([".md"])],
  ["drizzle", new Set([".json", ".sql"])],
  ["public", new Set([".html", ".png"])],
  ["scripts", new Set([".mjs", ".ps1"])],
  ["src", new Set([".css", ".ts", ".tsx"])],
  ["tests", new Set([".ts"])],
]);

const forbiddenPrefixes = [
  ".git/",
  ".logs/",
  ".next/",
  "coverage/",
  "dist/",
  "node_modules/",
  "out/",
  "outputs/",
  "playwright-report/",
  "test-results/",
  "work/",
];
const environmentFilePattern = /(?:^|\/)\.env(?:\.[^/]*)?$/iu;
const privateKeyExtensions = new Set([
  ".jks",
  ".kdbx",
  ".key",
  ".keystore",
  ".p12",
  ".p8",
  ".pem",
  ".pfx",
  ".pkcs8",
  ".pkcs12",
]);
const credentialContainerExtensions = new Set([
  "",
  ".conf",
  ".config",
  ".csv",
  ".ini",
  ".json",
  ".properties",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const sensitiveCredentialStems = new Set([
  "auth",
  "authorization",
  "client-secret",
  "client_secret",
  "credential",
  "credentials",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
  "private-key",
  "private_key",
  "secret",
  "secrets",
  "service-account",
  "service_account",
  "token",
  "tokens",
]);

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(content) {
  let value = 0xffff_ffff;
  for (const byte of content) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

function toArchivePath(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

function assertSafeArchivePath(archivePath) {
  const fileName = basename(archivePath).toLocaleLowerCase("en-US");
  const extension = extname(fileName);
  const stem = extension === "" ? fileName : fileName.slice(0, -extension.length);
  const isSensitiveCredentialName =
    sensitiveCredentialStems.has(stem) &&
    credentialContainerExtensions.has(extension);

  if (
    archivePath === "" ||
    archivePath.startsWith("/") ||
    archivePath.split("/").includes("..") ||
    forbiddenPrefixes.some((prefix) => archivePath.startsWith(prefix)) ||
    environmentFilePattern.test(archivePath) ||
    privateKeyExtensions.has(extension) ||
    isSensitiveCredentialName
  ) {
    throw new Error(`Kaynak checkpoint girdisi yasak: ${archivePath}`);
  }
}

async function readRegularFile(projectRoot, absolutePath) {
  const archivePath = toArchivePath(projectRoot, absolutePath);
  const status = await lstat(absolutePath);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`Checkpoint girdisi normal dosya değil: ${archivePath}`);
  }

  assertSafeArchivePath(archivePath);
  return { archivePath, content: await readFile(absolutePath) };
}

async function collectDirectory(projectRoot, directoryName, allowedExtensions) {
  const entries = [];
  const absoluteDirectory = join(projectRoot, directoryName);

  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const child of children) {
      const absolutePath = join(directory, child.name);
      const archivePath = toArchivePath(projectRoot, absolutePath);
      if (child.isSymbolicLink()) {
        throw new Error(`Checkpoint girdisinde sembolik bağlantı var: ${archivePath}`);
      }
      if (child.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(`Desteklenmeyen checkpoint girdisi: ${archivePath}`);
      }

      assertSafeArchivePath(archivePath);
      const extension = extname(child.name).toLocaleLowerCase("en-US");
      if (!allowedExtensions.has(extension)) {
        throw new Error(`Checkpoint allowlist dışı dosya: ${archivePath}`);
      }
      entries.push(await readRegularFile(projectRoot, absolutePath));
    }
  }

  await visit(absoluteDirectory);
  return entries;
}

async function collectSourceEntries(projectRoot) {
  const entries = [];
  for (const rootFile of requiredRootFiles) {
    entries.push(await readRegularFile(projectRoot, join(projectRoot, rootFile)));
  }
  for (const [directoryName, allowedExtensions] of directoryPolicies) {
    entries.push(
      ...(await collectDirectory(
        projectRoot,
        directoryName,
        allowedExtensions,
      )),
    );
  }

  entries.sort((left, right) =>
    left.archivePath.localeCompare(right.archivePath, "en"),
  );

  const caseInsensitivePaths = new Set();
  for (const entry of entries) {
    const normalized = entry.archivePath.toLocaleLowerCase("en-US");
    if (caseInsensitivePaths.has(normalized)) {
      throw new Error(`Checkpoint yol çakışması: ${entry.archivePath}`);
    }
    caseInsensitivePaths.add(normalized);
  }

  if (entries.length > 0xffff - 1) {
    throw new Error("Checkpoint dosya sayısı Zip32 sınırını aşıyor.");
  }
  return entries;
}

function checkpointFileName(sliceLabel) {
  return `portal-pusula-source-checkpoint-${sliceLabel}.zip`;
}

function assertSafeSliceLabel(sliceLabel) {
  if (
    typeof sliceLabel !== "string" ||
    sliceLabel.length < 3 ||
    sliceLabel.length > 64 ||
    !sliceLabelPattern.test(sliceLabel)
  ) {
    throw new Error("Checkpoint slice label is invalid.");
  }

  return sliceLabel;
}

function createManifest(sourceEntries, sliceLabel) {
  const files = sourceEntries.map((entry) => ({
    path: entry.archivePath,
    bytes: entry.content.length,
    sha256: createHash("sha256").update(entry.content).digest("hex"),
  }));
  const content = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        artifact: `dist/${checkpointFileName(sliceLabel)}`,
        slice: sliceLabel,
        boundary: `${sliceLabel} source checkpoint; not a pre-3A baseline and not a Hostinger backup or restore artifact.`,
        sourceFileCount: files.length,
        files,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { archivePath: "CHECKPOINT-MANIFEST.json", content };
}

function createLocalHeader(entry, name) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x0403_4b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.content.length, 18);
  header.writeUInt32LE(entry.content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function createCentralHeader(entry, name, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x0201_4b50, 0);
  header.writeUInt16LE(0x031e, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.content.length, 20);
  header.writeUInt32LE(entry.content.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
}

function createEndRecord(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x0605_4b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const sourceEntry of entries) {
    if (sourceEntry.content.length > maximumZip32Value) {
      throw new Error(`Checkpoint dosyası Zip32 sınırını aşıyor: ${sourceEntry.archivePath}`);
    }
    const name = Buffer.from(sourceEntry.archivePath, "utf8");
    if (name.length > 0xffff) {
      throw new Error(`Checkpoint yolu çok uzun: ${sourceEntry.archivePath}`);
    }
    const entry = { ...sourceEntry, crc: crc32(sourceEntry.content) };
    const localHeader = createLocalHeader(entry, name);
    const centralHeader = createCentralHeader(entry, name, localOffset);
    localParts.push(localHeader, name, entry.content);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + entry.content.length;
    if (localOffset > maximumZip32Value) {
      throw new Error("Checkpoint içeriği Zip32 sınırını aşıyor.");
    }
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (
    centralDirectory.length > maximumZip32Value ||
    localOffset + centralDirectory.length > maximumZip32Value
  ) {
    throw new Error("Checkpoint merkez dizini Zip32 sınırını aşıyor.");
  }
  return Buffer.concat([
    ...localParts,
    centralDirectory,
    createEndRecord(entries.length, centralDirectory.length, localOffset),
  ]);
}

export async function buildSourceCheckpoint({
  projectRoot = defaultProjectRoot,
  sliceLabel,
} = {}) {
  const resolvedRoot = resolve(projectRoot);
  const safeSliceLabel = assertSafeSliceLabel(sliceLabel);
  const resolvedOutput = join(
    resolvedRoot,
    "dist",
    checkpointFileName(safeSliceLabel),
  );
  const sourceEntries = await collectSourceEntries(resolvedRoot);
  const entries = [
    createManifest(sourceEntries, safeSliceLabel),
    ...sourceEntries,
  ];
  const archive = buildZip(entries);
  const temporaryOutputPath = `${resolvedOutput}.${process.pid}.tmp`;

  let existingArchive;
  try {
    existingArchive = await readFile(resolvedOutput);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (existingArchive !== undefined) {
    if (!existingArchive.equals(archive)) {
      throw new Error(
        "Checkpoint target already exists with different content.",
      );
    }

    return checkpointSummary(
      resolvedRoot,
      resolvedOutput,
      entries,
      sourceEntries,
      archive,
    );
  }

  await mkdir(dirname(resolvedOutput), { recursive: true });
  try {
    await writeFile(temporaryOutputPath, archive, { flag: "wx" });
    try {
      await link(temporaryOutputPath, resolvedOutput);
    } catch (error) {
      let racedArchive;
      try {
        racedArchive = await readFile(resolvedOutput);
      } catch {
        throw error;
      }
      if (!racedArchive.equals(archive)) {
        throw new Error(
          "Checkpoint target already exists with different content.",
        );
      }
    }
  } finally {
    await rm(temporaryOutputPath, { force: true });
  }

  return checkpointSummary(
    resolvedRoot,
    resolvedOutput,
    entries,
    sourceEntries,
    archive,
  );
}

function checkpointSummary(
  resolvedRoot,
  resolvedOutput,
  entries,
  sourceEntries,
  archive,
) {
  return {
    artifact: toArchivePath(resolvedRoot, resolvedOutput),
    fileCount: entries.length,
    sourceFileCount: sourceEntries.length,
    uncompressedBytes: entries.reduce(
      (total, entry) => total + entry.content.length,
      0,
    ),
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 2 || arguments_[0] !== "--slice") {
    throw new Error(
      "Usage: npm run checkpoint:source -- --slice <safe-slice-label>",
    );
  }

  console.log(
    JSON.stringify(
      await buildSourceCheckpoint({ sliceLabel: arguments_[1] }),
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  try {
    await main();
  } catch {
    console.error("Source checkpoint generation failed.");
    process.exitCode = 1;
  }
}
