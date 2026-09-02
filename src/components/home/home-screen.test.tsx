import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeScreen } from "@/components/home/home-screen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeScreen", () => {
  it("renders the focused customer workspace without unrelated modules", () => {
    render(<HomeScreen />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Müşteriler");
    expect(screen.getByRole("button", { name: "Müşteri ekle" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Müşteri ara" })).toBeInTheDocument();

    expect(screen.getByRole("region", { name: "Müşteri kayıtları" })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Müşteri kayıtları" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByText("Atlas Makina")).toBeInTheDocument();
    expect(within(table).getAllByText("Gecikti")).toHaveLength(2);

    expect(screen.queryByText("Yerel tasarım önizlemesi")).not.toBeInTheDocument();
    expect(screen.queryByText(/İşlerinizi tek bir yerde/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hesabım" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bugünün planı" })).not.toBeInTheDocument();
  });

  it("never presents sample customers as live records while data is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(<HomeScreen live />);

    expect(screen.getByText("Müşteri kayıtları yükleniyor…")).toBeInTheDocument();
    expect(screen.queryByText("Atlas Makina")).not.toBeInTheDocument();
    expect(screen.getByText("Henüz müşteri kaydı yok. İlk müşteriyi ekleyerek başlayın.")).toBeInTheDocument();
  });

  it("opens date-based contract and monthly visit planning from a customer row", async () => {
    const user = userEvent.setup();
    render(<HomeScreen />);

    await user.click(screen.getByRole("button", { name: /Atlas Makina/ }));

    expect(
      screen.getByRole("region", { name: "Atlas Makina" }),
    ).toBeInTheDocument();
    const startsOn = screen.getByLabelText("Başlangıç") as HTMLInputElement;
    const endsOn = screen.getByLabelText("Bitiş") as HTMLInputElement;
    expect(startsOn.value).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(endsOn.value).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(endsOn.value > startsOn.value).toBe(true);
    expect(screen.getByText("₺60.000,00")).toBeInTheDocument();
    expect(screen.queryByLabelText(/haftalık gün/iu)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ziyaret adedi/iu)).not.toBeInTheDocument();
    expect(screen.getByText("Önce sözleşmeyi kaydedin.")).toBeInTheDocument();
  });
});
