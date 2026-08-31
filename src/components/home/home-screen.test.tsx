import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeScreen } from "@/components/home/home-screen";

describe("HomeScreen", () => {
  it("renders the accessible local operations desk without marketing UI", () => {
    render(<HomeScreen />);

    const levelOneHeadings = screen.getAllByRole("heading", { level: 1 });
    expect(levelOneHeadings).toHaveLength(1);
    expect(levelOneHeadings[0]).toHaveAccessibleName("Günlük operasyon");

    const skipLink = screen.getByRole("link", { name: "Ana içeriğe geç" });
    const main = screen.getByRole("main");
    expect(skipLink).toHaveAttribute("href", "#ana-icerik");
    expect(main).toHaveAttribute("id", "ana-icerik");
    expect(main).toHaveAttribute("tabindex", "-1");

    const navigation = screen.getByRole("navigation", {
      name: "Ana navigasyon",
    });
    for (const name of ["Projeler", "Görevler", "Takvim", "Finans"]) {
      expect(within(navigation).getByRole("link", { name })).toBeInTheDocument();
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    for (const link of within(navigation).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }

    const previewBoundary = screen.getByRole("note");
    expect(
      within(previewBoundary).getByText("Yerel tasarım önizlemesi"),
    ).toBeInTheDocument();
    expect(
      within(previewBoundary).getByText("Örnek içerik · gerçek iş verisi değil"),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole("heading", { name: /İşlerinizi tek bir yerde/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Temeli incele" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Genişlemeden önce doğrulanan dört temel"),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/₺|tahsilat toplamı|müşteri sayısı/i);
  });
});
