import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootFiles = [
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".nvmrc",
  "README.md",
  "compose.mariadb-test.yml",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.mjs",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "vitest.config.mts",
  "vitest.integration.config.mts",
];
const roots = [".github", "docs", "drizzle", "public", "scripts", "src", "tests"];
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const safeLiteralValues = new Set(["portal-pusula-local-test-only"]);
const signatures = [
  ["private-key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ["github-token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/u],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}\b/u],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ["stripe-live-key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/u],
  ["credential-in-url", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@/iu],
];
const environmentAssignment =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|API_KEY)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/u;
const literalCredential =
  /(?:password|token|secret|api[_-]?key)\s*[:=]\s*["']([^"']{12,})["']/iu;

function archivePath(absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Secret scan refuses symbolic link: ${archivePath(absolutePath)}`);
    }
    if (entry.isDirectory()) files.push(...(await collectFiles(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function isTextFile(path) {
  const extension = extname(path).toLowerCase();
  return (
    basename(path) === ".env.example" ||
    textExtensions.has(extension) ||
    extension === ""
  );
}

function isSafeLiteral(value) {
  return (
    safeLiteralValues.has(value) ||
    /^(?:fake|not-a-real|.*-sentinel)/iu.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function redactFinding(kind, path, line) {
  return { kind, path, line };
}

async function main() {
  const candidates = rootFiles.map((name) => join(projectRoot, name));
  for (const root of roots) candidates.push(...(await collectFiles(join(projectRoot, root))));

  const findings = [];
  let scannedBytes = 0;
  let scannedFiles = 0;

  for (const path of [...new Set(candidates)].sort()) {
    if (!isTextFile(path)) continue;
    const metadata = await stat(path);
    if (metadata.size > 2_000_000) {
      throw new Error(`Secret scan text file is unexpectedly large: ${archivePath(path)}`);
    }
    const content = await readFile(path, "utf8");
    scannedFiles += 1;
    scannedBytes += Buffer.byteLength(content);

    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const [kind, pattern] of signatures) {
        if (pattern.test(line)) {
          findings.push(redactFinding(kind, archivePath(path), index + 1));
        }
      }

      const environmentMatch = environmentAssignment.exec(line);
      if (environmentMatch && environmentMatch[2] !== "") {
        findings.push(
          redactFinding("non-empty-sensitive-environment", archivePath(path), index + 1),
        );
      }

      const literalMatch = literalCredential.exec(line);
      if (literalMatch && !isSafeLiteral(literalMatch[1])) {
        findings.push(redactFinding("literal-credential", archivePath(path), index + 1));
      }
    }
  }

  if (findings.length > 0) {
    console.error(JSON.stringify({ status: "failed", findings }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.info(
    JSON.stringify({ status: "clean", scannedFiles, scannedBytes, findings: 0 }),
  );
}

await main();
