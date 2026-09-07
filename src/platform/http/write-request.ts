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

function invalidRequestBody(): SyntaxError {
  return new SyntaxError("Request body is invalid.");
}

export async function readBoundedRequestText(
  request: NextRequest,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw invalidRequestBody();
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw invalidRequestBody();
  }
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The generic validation result is unchanged if cancellation races.
        }
        throw invalidRequestBody();
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      try {
        await reader.cancel();
      } catch {
        // The body remains rejected even if the stream cannot be cancelled.
      }
    }
    throw invalidRequestBody();
  } finally {
    reader.releaseLock();
  }
  return parts.join("");
}

export async function readJsonWriteBody(
  request: NextRequest,
  maximumBytes = DEFAULT_WRITE_BODY_LIMIT,
): Promise<unknown> {
  const text = await readBoundedRequestText(request, maximumBytes);
  return JSON.parse(text) as unknown;
}
