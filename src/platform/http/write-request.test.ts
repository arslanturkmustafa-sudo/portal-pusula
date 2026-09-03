// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";

function request(
  body: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("https://portal.example.test/api/write", {
    body,
    headers: {
      "content-type": "application/json",
      origin: "https://portal.example.test",
      ...headers,
    },
    method: "POST",
  });
}

describe("write request boundary", () => {
  it("accepts exact same-origin JSON", async () => {
    const input = request('{"ok":true}');
    expect(isSameOriginWriteRequest(input)).toBe(true);
    expect(isJsonWriteRequest(input)).toBe(true);
    await expect(readJsonWriteBody(input, 32)).resolves.toEqual({ ok: true });
  });

  it("rejects missing or sibling-subdomain origins", () => {
    expect(
      isSameOriginWriteRequest(
        request("{}", { origin: "https://other.example.test" }),
      ),
    ).toBe(false);
    const missing = request("{}");
    missing.headers.delete("origin");
    expect(isSameOriginWriteRequest(missing)).toBe(false);
  });

  it("checks actual UTF-8 bytes even without a declared length", async () => {
    const input = request('"şşş"');
    input.headers.delete("content-length");
    await expect(readJsonWriteBody(input, 4)).rejects.toBeInstanceOf(SyntaxError);
  });
});
