import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type VerifiedSession =
  | Readonly<{ kind: "legacy" }>
  | Readonly<{
      accountId: string;
      credentialVersion: number;
      kind: "account";
    }>;

function sign(unsignedToken: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(unsignedToken, "utf8")
    .digest("base64url");
}

function canonicalBase36Integer(value: string): number | null {
  if (!/^[0-9a-z]+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 36);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed.toString(36) !== value
  ) {
    return null;
  }
  return parsed;
}

export function sessionCookieName(
  production = process.env.NODE_ENV === "production",
): string {
  return production
    ? "__Host-portal_pusula_session"
    : "portal_pusula_session";
}

export function sessionCookieOptions(
  production = process.env.NODE_ENV === "production",
) {
  return {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    priority: "high" as const,
    sameSite: "lax" as const,
    secure: production,
  };
}

export function createSessionToken(
  secret: string,
  nowMilliseconds = Date.now(),
): string {
  const issuedAt = Math.floor(nowMilliseconds / 1_000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const nonce = randomBytes(12).toString("base64url");
  const unsignedToken = [
    "v1",
    issuedAt.toString(36),
    expiresAt.toString(36),
    nonce,
  ].join(".");

  return `${unsignedToken}.${sign(unsignedToken, secret)}`;
}

export function createAccountSessionToken(
  secret: string,
  accountId: string,
  credentialVersion: number,
  nowMilliseconds = Date.now(),
): string {
  if (
    !CANONICAL_UUID_PATTERN.test(accountId) ||
    !Number.isSafeInteger(credentialVersion) ||
    credentialVersion < 1
  ) {
    throw new Error("Account session claims are invalid.");
  }

  const issuedAt = Math.floor(nowMilliseconds / 1_000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const nonce = randomBytes(12).toString("base64url");
  const unsignedToken = [
    "v2",
    issuedAt.toString(36),
    expiresAt.toString(36),
    accountId,
    credentialVersion.toString(36),
    nonce,
  ].join(".");

  return `${unsignedToken}.${sign(unsignedToken, secret)}`;
}

function signatureMatches(parts: readonly string[], secret: string): boolean {
  const receivedSignature = parts.at(-1) ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/u.test(receivedSignature)) return false;

  const unsignedToken = parts.slice(0, -1).join(".");
  const expectedSignature = sign(unsignedToken, secret);
  const receivedBuffer = Buffer.from(receivedSignature, "ascii");
  const expectedBuffer = Buffer.from(expectedSignature, "ascii");
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function validLifetime(
  issuedAt: number | null,
  expiresAt: number | null,
  nowMilliseconds: number,
): issuedAt is number {
  if (issuedAt === null || expiresAt === null) return false;
  const now = Math.floor(nowMilliseconds / 1_000);
  return (
    issuedAt <= now + MAX_CLOCK_SKEW_SECONDS &&
    expiresAt > now &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt === SESSION_TTL_SECONDS
  );
}

export function parseSessionToken(
  token: string,
  secret: string,
  nowMilliseconds = Date.now(),
): VerifiedSession | null {
  if (
    typeof token !== "string" ||
    token.length > 256 ||
    typeof secret !== "string" ||
    secret.length !== 16
  ) {
    return null;
  }

  const parts = token.split(".");
  if (parts[0] === "v1") {
    if (parts.length !== 5) return null;
    const issuedAt = canonicalBase36Integer(parts[1] ?? "");
    const expiresAt = canonicalBase36Integer(parts[2] ?? "");
    const nonce = parts[3] ?? "";
    if (
      !/^[A-Za-z0-9_-]{16}$/u.test(nonce) ||
      !signatureMatches(parts, secret) ||
      !validLifetime(issuedAt, expiresAt, nowMilliseconds)
    ) {
      return null;
    }
    return { kind: "legacy" };
  }

  if (parts[0] === "v2") {
    if (parts.length !== 7) return null;
    const issuedAt = canonicalBase36Integer(parts[1] ?? "");
    const expiresAt = canonicalBase36Integer(parts[2] ?? "");
    const accountId = parts[3] ?? "";
    const credentialVersion = canonicalBase36Integer(parts[4] ?? "");
    const nonce = parts[5] ?? "";
    if (
      !CANONICAL_UUID_PATTERN.test(accountId) ||
      credentialVersion === null ||
      credentialVersion < 1 ||
      !/^[A-Za-z0-9_-]{16}$/u.test(nonce) ||
      !signatureMatches(parts, secret) ||
      !validLifetime(issuedAt, expiresAt, nowMilliseconds)
    ) {
      return null;
    }
    return { accountId, credentialVersion, kind: "account" };
  }

  return null;
}

export function verifySessionToken(
  token: string,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  return parseSessionToken(token, secret, nowMilliseconds) !== null;
}
