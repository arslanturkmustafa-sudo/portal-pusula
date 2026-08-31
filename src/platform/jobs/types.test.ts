import { describe, expect, it } from "vitest";

import {
  SafeJobHandlerError,
  safeJobErrorCode,
} from "@/platform/jobs/types";

describe("safe job error codes", () => {
  it("preserves only the generic allowlisted platform error code", () => {
    const error = new SafeJobHandlerError("platform_operation_failed");

    expect(safeJobErrorCode(error)).toBe("platform_operation_failed");
    expect(String(error)).not.toContain("verification");
  });

  it("maps raw handler errors without exposing their content", () => {
    const rawSentinel = "raw-handler-secret-sentinel";
    const error = new Error(rawSentinel);

    const code = safeJobErrorCode(error);

    expect(code).toBe("unexpected_error");
    expect(code).not.toContain(rawSentinel);
  });
});
