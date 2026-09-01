import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(projectRoot, "dist");
const outputPath = join(outputDirectory, "portal-pusula-hostinger.zip");
const temporaryOutputPath = `${outputPath}.tmp`;

const requiredRootFiles = [
  ".nvmrc",
  "next-env.d.ts",
  "next.config.mjs",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "tsconfig.json",
];

const includedDirectories = ["drizzle", "public", "scripts", "src"];
const allowedProductionScripts = new Set([
  "scripts/migrate.mjs",
  "scripts/migration-integrity.mjs",
  "scripts/mysql-session-policy.mjs",
]);
const excludedLocalScripts = new Set([
  "scripts/build-phpmyadmin-migration-bundle.mjs",
  "scripts/generate-admin-auth.mjs",
  "scripts/generate-pwa-icons.mjs",
  "scripts/mysql-session-policy.d.mts",
  "scripts/package-hostinger.mjs",
  "scripts/package-source-checkpoint.mjs",
  "scripts/probe-readiness-secure.ps1",
  "scripts/run-e2e.mjs",
  "scripts/scan-secrets.mjs",
  "scripts/test-mariadb.mjs",
  "scripts/verify-hostinger-package.mjs",
]);
const allowedPublicFiles = new Set([
  "public/icons/portal-pusula-192-v1.png",
  "public/icons/portal-pusula-512-v1.png",
  "public/icons/portal-pusula-maskable-512-v1.png",
  "public/offline-v1.html",
]);
const drizzleMigrationPattern = /^drizzle\/\d{4}_[a-z0-9][a-z0-9_-]*\.sql$/u;
const drizzleMetaPattern =
  /^drizzle\/meta\/(?:_journal|\d{4}_snapshot)\.json$/u;
const sourceFilePattern = /^src\/.*\.(?:css|ts|tsx)$/u;
const sourceTestFilePattern =
  /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:spec|test))\.tsx?$/u;
const maximumZip32Value = 0xffff_ffff;

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

function toArchivePath(absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

export function assertSafeArchivePath(archivePath) {
  if (
    archivePath === "" ||
    archivePath.startsWith("/") ||
    archivePath.includes("\\") ||
    archivePath.includes("\0") ||
    /^[A-Za-z]:\//u.test(archivePath) ||
    archivePath
      .split("/")
      .some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
  ) {
    throw new Error(`Geçersiz Hostinger paket yolu: ${archivePath}`);
  }
}

export function assertUniqueCaseInsensitiveArchivePaths(archivePaths) {
  const caseInsensitivePaths = new Set();
  for (const archivePath of archivePaths) {
    assertSafeArchivePath(archivePath);
    const normalized = archivePath.toLocaleLowerCase("en-US");
    if (caseInsensitivePaths.has(normalized)) {
      throw new Error(`Büyük/küçük harf çakışmalı paket yolu: ${archivePath}`);
    }
    caseInsensitivePaths.add(normalized);
  }
}

function productionPathDecision(archivePath) {
  assertSafeArchivePath(archivePath);

  if (archivePath.startsWith("drizzle/")) {
    return drizzleMigrationPattern.test(archivePath) ||
      drizzleMetaPattern.test(archivePath)
      ? "include"
      : "reject";
  }
  if (archivePath.startsWith("public/")) {
    return allowedPublicFiles.has(archivePath) ? "include" : "reject";
  }
  if (archivePath.startsWith("scripts/")) {
    if (allowedProductionScripts.has(archivePath)) return "include";
    if (excludedLocalScripts.has(archivePath)) return "exclude";
    return "reject";
  }
  if (archivePath.startsWith("src/")) {
    if (sourceTestFilePattern.test(archivePath)) return "exclude";
    return sourceFilePattern.test(archivePath) ? "include" : "reject";
  }
  return "reject";
}

async function readRegularFile(absolutePath) {
  const status = await lstat(absolutePath);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`Paket girdisi normal dosya değil: ${toArchivePath(absolutePath)}`);
  }

  const archivePath = toArchivePath(absolutePath);
  assertSafeArchivePath(archivePath);
  return { archivePath, content: await readFile(absolutePath) };
}

async function collectDirectory(absoluteDirectory, entries) {
  const children = await readdir(absoluteDirectory, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const child of children) {
    const absolutePath = join(absoluteDirectory, child.name);
    if (child.isSymbolicLink()) {
      throw new Error(`Paket girdisinde sembolik bağlantı var: ${toArchivePath(absolutePath)}`);
    }
    if (child.isDirectory()) {
      await collectDirectory(absolutePath, entries);
      continue;
    }
    if (!child.isFile()) {
      throw new Error(`Desteklenmeyen paket girdisi: ${toArchivePath(absolutePath)}`);
    }

    const archivePath = toArchivePath(absolutePath);
    const decision = productionPathDecision(archivePath);
    if (decision === "exclude") continue;
    if (decision === "reject") {
      throw new Error(`Hostinger production allowlist dışında yol: ${archivePath}`);
    }
    entries.push(await readRegularFile(absolutePath));
  }
}

async function collectEntries() {
  const entries = [];
  for (const rootFile of requiredRootFiles) {
    entries.push(await readRegularFile(join(projectRoot, rootFile)));
  }
  for (const directory of includedDirectories) {
    await collectDirectory(join(projectRoot, directory), entries);
  }

  entries.sort((left, right) => {
    if (left.archivePath === "package.json") return -1;
    if (right.archivePath === "package.json") return 1;
    return left.archivePath.localeCompare(right.archivePath, "en");
  });

  for (const entry of entries) {
    assertSafeArchivePath(entry.archivePath);
    const isRequiredRootFile = requiredRootFiles.includes(entry.archivePath);
    if (
      !isRequiredRootFile &&
      productionPathDecision(entry.archivePath) !== "include"
    ) {
      throw new Error(
        `Hostinger production allowlist dışında yol: ${entry.archivePath}`,
      );
    }
  }
  assertUniqueCaseInsensitiveArchivePaths(
    entries.map((entry) => entry.archivePath),
  );

  if (entries[0]?.archivePath !== "package.json") {
    throw new Error("package.json ZIP kökünde bulunamadı.");
  }
  if (entries.length > 0xffff) {
    throw new Error("Dosya sayısı Zip32 sınırını aşıyor.");
  }

  return entries;
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
      throw new Error(`Dosya Zip32 sınırını aşıyor: ${sourceEntry.archivePath}`);
    }
    const name = Buffer.from(sourceEntry.archivePath, "utf8");
    if (name.length > 0xffff) {
      throw new Error(`Paket yolu çok uzun: ${sourceEntry.archivePath}`);
    }
    const entry = { ...sourceEntry, crc: crc32(sourceEntry.content) };
    const localHeader = createLocalHeader(entry, name);
    const centralHeader = createCentralHeader(entry, name, localOffset);

    localParts.push(localHeader, name, entry.content);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + entry.content.length;
    if (localOffset > maximumZip32Value) {
      throw new Error("ZIP içeriği Zip32 sınırını aşıyor.");
    }
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (
    centralDirectory.length > maximumZip32Value ||
    localOffset + centralDirectory.length > maximumZip32Value
  ) {
    throw new Error("ZIP merkez dizini Zip32 sınırını aşıyor.");
  }

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    createEndRecord(entries.length, centralDirectory.length, localOffset),
  ]);
}

async function packageHostinger() {
  const entries = await collectEntries();
  const archive = buildZip(entries);
  await mkdir(outputDirectory, { recursive: true });

  try {
    await writeFile(temporaryOutputPath, archive);
    await rm(outputPath, { force: true });
    await rename(temporaryOutputPath, outputPath);
  } finally {
    await rm(temporaryOutputPath, { force: true });
  }

  const sha256 = createHash("sha256").update(archive).digest("hex");
  const uncompressedBytes = entries.reduce(
    (total, entry) => total + entry.content.length,
    0,
  );

  console.log(
    JSON.stringify({
      artifact: toArchivePath(outputPath),
      fileCount: entries.length,
      uncompressedBytes,
      sha256,
    }),
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await packageHostinger();
}
