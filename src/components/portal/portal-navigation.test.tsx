import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/musteriler" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

import { PortalNavigation } from "@/components/portal/portal-navigation";

afterEach(() => cleanup());

describe("PortalNavigation", () => {
  it("links every module to an explicit page and marks the current path", () => {
    render(<PortalNavigation principal={{ permissions: [], role: "owner" }} />);
    const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
    const expectedLinks = [
      ["Müşteriler", "/musteriler"],
      ["Günlük plan", "/gunluk-plan"],
      ["Görevler", "/gorevler"],
      ["Finans", "/finans"],
      ["Projeler", "/projeler"],
      ["Kullanıcılar", "/kullanicilar"],
      ["Hesabım", "/hesabim"],
    ] as const;

    for (const [name, href] of expectedLinks) {
      expect(within(navigation).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(within(navigation).getByRole("link", { name: "Müşteriler" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("omits financial and account-management destinations for a member without those permissions", () => {
    render(
      <PortalNavigation
        principal={{ permissions: ["customers.read", "tasks.read"], role: "member" }}
      />,
    );
    const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
    expect(within(navigation).getByRole("link", { name: "Müşteriler" })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: "Görevler" })).toBeVisible();
    expect(within(navigation).queryByRole("link", { name: "Finans" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Kullanıcılar" })).toBeNull();
  });

  it("routes an accounts-only finance member directly to the protected accounts workspace", () => {
    render(
      <PortalNavigation
        principal={{ permissions: ["finance.accounts.read"], role: "member" }}
      />,
    );
    const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
    expect(within(navigation).getByRole("link", { name: "Finans" })).toHaveAttribute(
      "href",
      "/finans/hesaplar",
    );
  });

  it.each([
    ["finance.receivables.read", "/finans"],
    ["finance.accounts.read", "/finans/hesaplar"],
    ["finance.expenses.read", "/finans/giderler"],
    ["finance.cards.read", "/finans/kartlar"],
    ["finance.partnership.read", "/finans/ortaklik"],
    ["finance.reports.read", "/finans/raporlar"],
  ] as const)(
    "routes an isolated %s grant to its readable finance workspace",
    (permission, href) => {
      render(
        <PortalNavigation
          principal={{ permissions: [permission], role: "member" }}
        />,
      );
      const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
      expect(within(navigation).getByRole("link", { name: "Finans" })).toHaveAttribute(
        "href",
        href,
      );
      cleanup();
    },
  );

  it("uses the documented priority when a member has more than one finance grant", () => {
    render(
      <PortalNavigation
        principal={{
          permissions: ["finance.reports.read", "finance.expenses.read"],
          role: "member",
        }}
      />,
    );
    const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
    expect(within(navigation).getByRole("link", { name: "Finans" })).toHaveAttribute(
      "href",
      "/finans/giderler",
    );
  });
});
