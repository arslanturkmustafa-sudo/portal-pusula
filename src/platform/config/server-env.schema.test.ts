import { describe, expect, it } from "vitest";

import {
  parseServerEnvironment,
  ServerEnvironmentError,
} from "@/platform/config/server-env.schema";

describe("parseServerEnvironment", () => {
  it("uses the safe default log level", () => {
    expect(parseServerEnvironment({})).toEqual({ LOG_LEVEL: "info" });
    expect(parseServerEnvironment({ LOG_LEVEL: "" })).toEqual({
      LOG_LEVEL: "info",
    });
  });

  it("accepts a supported structured-log level", () => {
    expect(parseServerEnvironment({ LOG_LEVEL: "debug" })).toEqual({
      LOG_LEVEL: "debug",
    });
  });

  it("reports only the variable path and issue code", () => {
    const secretLikeValue = "not-a-real-secret-but-must-not-leak";

    try {
      parseServerEnvironment({ LOG_LEVEL: secretLikeValue });
      throw new Error("Expected parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerEnvironmentError);
      expect(JSON.stringify(error)).not.toContain(secretLikeValue);
      expect((error as ServerEnvironmentError).issues).toEqual([
        { code: "invalid_value", path: "LOG_LEVEL" },
      ]);
    }
  });
});

