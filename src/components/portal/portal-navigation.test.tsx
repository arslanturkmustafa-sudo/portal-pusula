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
    render(<PortalNavigation />);
    const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
    const expectedLinks = [
      ["Müşteriler", "/musteriler"],
      ["Günlük plan", "/gunluk-plan"],
      ["Görevler", "/gorevler"],
      ["Finans", "/finans"],
      ["Projeler", "/projeler"],
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
});
