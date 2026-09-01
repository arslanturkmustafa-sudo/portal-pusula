import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeScreen } from "@/components/home/home-screen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeScreen", () => {
  it("renders the customer workbench without a marketing hero", () => {
    render(<HomeScreen />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Müşteriler");
    expect(screen.getByRole("button", { name: "Müşteri ekle" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Müşteri ara" })).toBeInTheDocument();

    const navigation = screen.getByRole("navigation", { name: "Ana navigasyon" });
    for (const name of ["Müşteriler", "Günlük plan", "Görevler", "Finans", "Projeler"]) {
      expect(within(navigation).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(navigation).getByRole("link", { name: "Müşteriler" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(screen.getByRole("region", { name: "Müşteri kayıtları" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Bugünün planı" })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Müşteri kayıtları" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByText("Atlas Makina")).toBeInTheDocument();
    expect(within(table).getAllByText("Gecikti")).toHaveLength(2);

    expect(screen.queryByText("Yerel tasarım önizlemesi")).not.toBeInTheDocument();
    expect(screen.queryByText(/İşlerinizi tek bir yerde/i)).not.toBeInTheDocument();
  });

  it("never presents sample customers as live records while data is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<HomeScreen live />);

    expect(screen.getByText("Müşteri kayıtları yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByText("Atlas Makina")).not.toBeInTheDocument();
    expect(screen.getByText("Henüz müşteri kaydı yok. İlk müşteriyi ekleyerek başlayın.")).toBeInTheDocument();
  });
});
