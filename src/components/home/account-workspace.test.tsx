import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountWorkspace } from "@/components/home/account-workspace";

const previousValue = ["old", "sample"].join("-");
const nextValue = ["new", "sample"].join("-");

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

describe("AccountWorkspace", () => {
  it("loads the account and changes an established password", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          account: {
            email: "yonetici@example.com",
            passwordChangedAtUtc: "2026-09-01 12:00:00.000000",
            passwordManagementAvailable: true,
            requiresCurrentPassword: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          account: {
            email: "yonetici@example.com",
            passwordChangedAtUtc: "2026-09-02 12:00:00.000000",
            requiresCurrentPassword: true,
          },
          status: "ok",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountWorkspace live />);
    expect(await screen.findByText("yonetici@example.com")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Mevcut parola"), {
      target: { value: previousValue },
    });
    fireEvent.change(screen.getByLabelText("Yeni parola"), {
      target: { value: nextValue },
    });
    fireEvent.change(screen.getByLabelText("Yeni parola tekrarı"), {
      target: { value: nextValue },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parolayı değiştir" }));

    await screen.findByText(/Parolanız değiştirildi/u);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/account/password",
      expect.objectContaining({
        body: JSON.stringify({
          confirmation: nextValue,
          currentPassword: previousValue,
          newPassword: nextValue,
        }),
        method: "PATCH",
      }),
    );
  });

  it("supports first-password bootstrap without asking for the current password", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        account: {
          email: "yonetici@example.com",
          passwordChangedAtUtc: null,
          passwordManagementAvailable: true,
          requiresCurrentPassword: false,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountWorkspace live />);

    expect(await screen.findByText(/İlk uygulama parolanızı/u)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mevcut parola")).not.toBeInTheDocument();
  });

  it("shows the server rejection without exposing submitted passwords", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          account: {
            email: "yonetici@example.com",
            passwordChangedAtUtc: null,
            passwordManagementAvailable: true,
            requiresCurrentPassword: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "current_password_invalid" }, 400),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountWorkspace live />);
    await screen.findByText("yonetici@example.com");
    fireEvent.change(screen.getByLabelText("Mevcut parola"), {
      target: { value: "wrong-password-sentinel" },
    });
    fireEvent.change(screen.getByLabelText("Yeni parola"), {
      target: { value: "new-password-sentinel" },
    });
    fireEvent.change(screen.getByLabelText("Yeni parola tekrarı"), {
      target: { value: "new-password-sentinel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parolayı değiştir" }));

    await screen.findByText("Mevcut parola doğrulanamadı.");
    await waitFor(() => {
      expect(document.body.textContent).not.toContain("wrong-password-sentinel");
      expect(document.body.textContent).not.toContain("new-password-sentinel");
    });
  });

  it("explains a reverse-proxy origin rejection without exposing passwords", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          account: {
            email: "yonetici@example.com",
            passwordChangedAtUtc: null,
            passwordManagementAvailable: true,
            requiresCurrentPassword: true,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    render(<AccountWorkspace live />);
    await screen.findByText("yonetici@example.com");
    fireEvent.change(screen.getByLabelText("Mevcut parola"), {
      target: { value: previousValue },
    });
    fireEvent.change(screen.getByLabelText("Yeni parola"), {
      target: { value: nextValue },
    });
    fireEvent.change(screen.getByLabelText("Yeni parola tekrarı"), {
      target: { value: nextValue },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parolayı değiştir" }));

    expect(
      await screen.findByText(/Güvenlik doğrulaması tamamlanamadı/u),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(previousValue);
    expect(document.body.textContent).not.toContain(nextValue);
  });
});
