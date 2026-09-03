import { Buffer } from "node:buffer";

import type { NextRequest } from "next/server";

export const DEFAULT_WRITE_BODY_LIMIT = 32_768;

export function isSameOriginWriteRequest(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  try {
    if (originHeader === null) return false;
    const origin = new URL(originHeader);
    const requestUrl = new URL(request.url);
    if (origin.origin === requestUrl.origin) return true;

    const host = request.headers.get("host")?.trim().toLowerCase();
    if (!host || origin.host.toLowerCase() !== host) return false;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase();
    const acceptedProtocols = new Set([requestUrl.protocol]);
    if (forwardedProtocol === "http" || forwardedProtocol === "https") {
      acceptedProtocols.add(`${forwardedProtocol}:`);
    }
    return acceptedProtocols.has(origin.protocol);
  } catch {
    return false;
  }
}

export function isJsonWriteRequest(request: NextRequest): boolean {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

export async function readJsonWriteBody(
  request: NextRequest,
  maximumBytes = DEFAULT_WRITE_BODY_LIMIT,
): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new SyntaxError("Request body is invalid.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new SyntaxError("Request body is invalid.");
  }
  return JSON.parse(text) as unknown;
}
