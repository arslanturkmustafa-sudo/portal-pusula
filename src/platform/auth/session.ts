import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;

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

export function verifySessionToken(
  token: string,
  secret: string,
  nowMilliseconds = Date.now(),
): boolean {
  if (
    typeof token !== "string" ||
    token.length > 256 ||
    typeof secret !== "string" ||
    secret.length !== 16
  ) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return false;

  const issuedAt = canonicalBase36Integer(parts[1] ?? "");
  const expiresAt = canonicalBase36Integer(parts[2] ?? "");
  const nonce = parts[3] ?? "";
  const receivedSignature = parts[4] ?? "";
  if (
    issuedAt === null ||
    expiresAt === null ||
    !/^[A-Za-z0-9_-]{16}$/u.test(nonce) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(receivedSignature)
  ) {
    return false;
  }

  const unsignedToken = parts.slice(0, 4).join(".");
  const expectedSignature = sign(unsignedToken, secret);
  const receivedBuffer = Buffer.from(receivedSignature, "ascii");
  const expectedBuffer = Buffer.from(expectedSignature, "ascii");
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return false;
  }

  const now = Math.floor(nowMilliseconds / 1_000);
  return (
    issuedAt <= now + MAX_CLOCK_SKEW_SECONDS &&
    expiresAt > now &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt === SESSION_TTL_SECONDS
  );
}
