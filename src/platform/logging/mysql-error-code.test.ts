import { describe, expect, it } from "vitest";

import {
  safeMySqlErrorCode,
  UNKNOWN_MYSQL_ERROR_CODE,
} from "@/platform/logging/mysql-error-code";

describe("safe MySQL error code", () => {
  it.each([
    "ER_ACCESS_DENIED_ERROR",
    "ECONNREFUSED",
    "ER_NO_SUCH_TABLE",
  ])("keeps allowlisted operational code %s", (code) => {
    expect(safeMySqlErrorCode({ code, message: "sensitive-message" })).toBe(
      code,
    );
  });

  it("replaces unknown codes without reading other error details", () => {
    expect(
      safeMySqlErrorCode({
        code: "UNSAFE_VENDOR_DETAIL",
        message: "password-sentinel",
        sql: "select-secret-sentinel",
      }),
    ).toBe(UNKNOWN_MYSQL_ERROR_CODE);
  });

  it("fails closed when the code property cannot be read", () => {
    const error = Object.defineProperty({}, "code", {
      get() {
        throw new Error("getter-sentinel");
      },
    });

    expect(safeMySqlErrorCode(error)).toBe(UNKNOWN_MYSQL_ERROR_CODE);
  });
});
