import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/finans/giderler" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import { FinanceSubnavigation } from "@/components/home/finance-subnavigation";

describe("FinanceSubnavigation", () => {
  beforeEach(() => {
    mocks.pathname = "/finans/giderler";
  });

  it("links the finance workspaces and marks only the exact section", () => {
    render(<FinanceSubnavigation />);
    const navigation = screen.getByRole("navigation", { name: "Finans bölümleri" });

    expect(within(navigation).getByRole("link", { name: "Alacaklar" }))
      .toHaveAttribute("href", "/finans");
    expect(within(navigation).getByRole("link", { name: "Kasa ve bankalar" }))
      .toHaveAttribute("href", "/finans/hesaplar");
    expect(within(navigation).getByRole("link", { name: "Giderler" }))
      .toHaveAttribute("href", "/finans/giderler");
    expect(
      within(navigation).getByRole("link", { name: "Kartlar ve ödeme planı" }),
    ).toHaveAttribute("href", "/finans/kartlar");
    expect(within(navigation).getByRole("link", { name: "Nakit akışı" }))
      .toHaveAttribute("href", "/finans/nakit-akisi");
    expect(within(navigation).getByRole("link", { name: "Vergiler" }))
      .toHaveAttribute("href", "/finans/vergiler");
    expect(within(navigation).getByRole("link", { name: "Proje görünümü" }))
      .toHaveAttribute("href", "/finans/raporlar");
    expect(within(navigation).getByRole("link", { name: "Ortaklık hesabı" }))
      .toHaveAttribute("href", "/finans/ortaklik");
    expect(within(navigation).getByRole("link", { name: "Giderler" }))
      .toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: "Alacaklar" }))
      .not.toHaveAttribute("aria-current");
  });

  it("marks the tax workspace as the current finance section", () => {
    mocks.pathname = "/finans/vergiler";
    render(<FinanceSubnavigation />);

    expect(screen.getByRole("link", { name: "Vergiler" }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Giderler" }))
      .not.toHaveAttribute("aria-current");
  });
});
