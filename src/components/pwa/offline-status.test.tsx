import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OfflineStatus } from "@/components/pwa/offline-status";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("OfflineStatus", () => {
  it("shows a safe warning offline and removes it after reconnecting", () => {
    setOnline(true);
    render(<OfflineStatus />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /güncel veriler gösterilemiyor/i,
    );

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

