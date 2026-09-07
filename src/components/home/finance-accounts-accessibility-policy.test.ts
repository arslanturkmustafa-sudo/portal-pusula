import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("finance accounts mobile accessibility policy", () => {
  it("keeps all mobile account actions at least 44px high", () => {
    const css = readFileSync(
      resolve(
        process.cwd(),
        "src/components/home/finance-accounts-workspace.module.css",
      ),
      "utf8",
    );
    const mobile = css.slice(css.indexOf("@media (max-width: 680px)"));
    expect(mobile).toContain(".accountCard footer button");
    expect(mobile).toContain(".movementAmount button");
    expect(mobile).toContain(".formActions button");
    expect(mobile).toContain("min-height: 44px");
  });
});
