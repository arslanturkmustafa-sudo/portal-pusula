import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

import type { AuthEnvironment } from "@/platform/config/auth-env.schema";

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

type ParsedPasswordHash = Readonly<{
  derivedKey: Buffer;
  salt: Buffer;
}>;

export class PasswordVerificationRuntimeError extends Error {
  constructor() {
    super("Parola doğrulama işlemi çalıştırılamadı.");
    this.name = "PasswordVerificationRuntimeError";
  }
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  const separator = encodedHash.startsWith("scrypt:")
    ? ":"
    : encodedHash.startsWith("scrypt$")
      ? "$"
      : null;
  if (separator === null) return null;

  const parts = encodedHash.split(separator);
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== String(SCRYPT_COST) ||
    parts[2] !== String(SCRYPT_BLOCK_SIZE) ||
    parts[3] !== String(SCRYPT_PARALLELIZATION)
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(parts[4] ?? "", "base64url");
    const derivedKey = Buffer.from(parts[5] ?? "", "base64url");
    if (salt.length !== 16 || derivedKey.length !== SCRYPT_KEY_LENGTH) {
      return null;
    }
    return { derivedKey, salt };
  } catch {
    return null;
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

function secureTextEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed || typeof password !== "string" || password.length > 256) {
    return false;
  }

  try {
    const actualKey = await deriveKey(password, parsed.salt);
    return timingSafeEqual(actualKey, parsed.derivedKey);
  } catch {
    throw new PasswordVerificationRuntimeError();
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 256
  ) {
    throw new PasswordVerificationRuntimeError();
  }

  try {
    const salt = randomBytes(16);
    const derivedKey = await deriveKey(password, salt);
    return [
      "scrypt",
      String(SCRYPT_COST),
      String(SCRYPT_BLOCK_SIZE),
      String(SCRYPT_PARALLELIZATION),
      salt.toString("base64url"),
      derivedKey.toString("base64url"),
    ].join(":");
  } catch {
    throw new PasswordVerificationRuntimeError();
  }
}

export async function verifyAdminCredentials(
  email: string,
  password: string,
  environment: AuthEnvironment,
): Promise<boolean> {
  const canonicalEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  const emailMatches = secureTextEqual(
    canonicalEmail,
    environment.ADMIN_EMAIL,
  );
  const passwordMatches = await verifyPassword(
    password,
    environment.ADMIN_PASSWORD_HASH,
  );

  return emailMatches && passwordMatches;
}
