import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/finans/giderler" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";

describe("FinanceSubnavigation", () => {
  it("links the three finance workspaces and marks only the exact section", () => {
    render(<FinanceSubnavigation />);
    const navigation = screen.getByRole("navigation", { name: "Finans bölümleri" });

    expect(within(navigation).getByRole("link", { name: "Alacaklar" }))
      .toHaveAttribute("href", "/finans");
    expect(within(navigation).getByRole("link", { name: "Giderler" }))
      .toHaveAttribute("href", "/finans/giderler");
    expect(
      within(navigation).getByRole("link", { name: "Kartlar ve ödeme planı" }),
    ).toHaveAttribute("href", "/finans/kartlar");
    expect(within(navigation).getByRole("link", { name: "Giderler" }))
      .toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: "Alacaklar" }))
      .not.toHaveAttribute("aria-current");
  });
});
