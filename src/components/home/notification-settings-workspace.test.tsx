import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationSettingsWorkspace } from "@/components/home/notification-settings-workspace";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("NotificationSettingsWorkspace", () => {
  it("loads and saves an independent notification recipient", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            recipientEmail: "owner@example.com",
            usesAccountEmail: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            recipientEmail: "bildirim@example.com",
            usesAccountEmail: false,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationSettingsWorkspace />);
    const input = await screen.findByLabelText("Bildirim e-posta adresi");
    expect(input).toHaveValue("owner@example.com");
    expect(screen.getByText(/sahip hesabının giriş e-postası/u)).toBeVisible();

    fireEvent.change(input, { target: { value: "bildirim@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));

    expect(await screen.findByText("Bildirim adresi kaydedildi.")).toBeVisible();
    expect(screen.getByText(/giriş hesabından bağımsız/u)).toBeVisible();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/settings/notifications",
        expect.objectContaining({
          body: JSON.stringify({ recipientEmail: "bildirim@example.com" }),
          method: "PATCH",
        }),
      );
    });
  });
});
