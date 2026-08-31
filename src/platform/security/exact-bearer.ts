import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasExactBearerAuthorization(
  request: Request,
  expectedToken: string,
): boolean {
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${expectedToken}`;
  const digestMatches = timingSafeEqual(sha256(actual), sha256(expected));

  return digestMatches && Buffer.byteLength(actual) === Buffer.byteLength(expected);
}
