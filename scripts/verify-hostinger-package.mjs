import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageScript = join(projectRoot, "scripts", "package-hostinger.mjs");
const artifact = join(projectRoot, "dist", "portal-pusula-hostinger.zip");

function runPackage() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [packageScript], {
      cwd: projectRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        rejectRun(new Error(`Hostinger package failed (${signal ?? code}).`));
        return;
      }
      const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
      resolveRun(JSON.parse(lines.at(-1)));
    });
  });
}

async function digestArtifact() {
  const content = await readFile(artifact);
  const metadata = await stat(artifact);
  return {
    bytes: metadata.size,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

const firstMetadata = await runPackage();
const first = await digestArtifact();
const secondMetadata = await runPackage();
const second = await digestArtifact();

if (
  first.sha256 !== second.sha256 ||
  first.bytes !== second.bytes ||
  firstMetadata.fileCount !== secondMetadata.fileCount ||
  firstMetadata.uncompressedBytes !== secondMetadata.uncompressedBytes
) {
  throw new Error("Hostinger package is not byte-identical across two builds.");
}

console.info(
  JSON.stringify({
    artifact: "dist/portal-pusula-hostinger.zip",
    fileCount: secondMetadata.fileCount,
    uncompressedBytes: secondMetadata.uncompressedBytes,
    bytes: second.bytes,
    sha256: second.sha256,
    byteIdentical: true,
  }),
);
