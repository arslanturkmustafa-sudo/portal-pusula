import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DailyPlanVisitCompletion } from "./daily-plan-visit-completion";

const target = {
  committedOn: "2026-09-05",
  contractId: "contract-1",
  customerId: "customer-1",
  customerName: "Atlas Makina",
  visitId: "visit-1",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("DailyPlanVisitCompletion", () => {
  it("completes the selected visit with a confirmed date and optional note", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        visit: { id: target.visitId, resolutionStatus: "completed" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onCompleted = vi.fn();
    const user = userEvent.setup();

    render(<DailyPlanVisitCompletion onCompleted={onCompleted} target={target} />);
    await user.click(
      screen.getByRole("button", {
        name: /Atlas Makina.*ziyaretini tamamla/u,
      }),
    );

    expect(screen.getByRole("dialog", { name: "Atlas Makina" })).toBeInTheDocument();
    expect(screen.getByLabelText("Gerçekleşen gün")).toHaveValue("2026-09-05");
    await user.clear(screen.getByLabelText(/Not/u));
    await user.type(screen.getByLabelText(/Not/u), "Saha görüşmesi tamamlandı.");
    fireEvent.submit(screen.getByRole("button", { name: "Tamamla ve kaydet" }).closest("form")!);

    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith("visit-1"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/customers/customer-1/contracts/contract-1/visits/visit-1",
      expect.objectContaining({
        body: JSON.stringify({
          deliveredOn: "2026-09-05",
          resolutionNote: "Saha görüşmesi tamamlandı.",
          resolutionStatus: "completed",
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and explains a locked visit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ status: "visit_locked" }, 409),
      ),
    );
    const user = userEvent.setup();

    render(<DailyPlanVisitCompletion onCompleted={vi.fn()} target={target} />);
    await user.click(
      screen.getByRole("button", {
        name: /Atlas Makina.*ziyaretini tamamla/u,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Tamamla ve kaydet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ziyaret daha önce sonuçlandırılmış. Planı yenileyin.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("rejects a completion date outside the planned month before sending", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<DailyPlanVisitCompletion onCompleted={vi.fn()} target={target} />);
    await user.click(
      screen.getByRole("button", {
        name: /Atlas Makina.*ziyaretini tamamla/u,
      }),
    );
    const date = screen.getByLabelText("Gerçekleşen gün");
    await user.clear(date);
    await user.type(date, "2026-10-01");
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Tamamla ve kaydet" })
        .closest("form")!,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Gerçekleşme günü planlanan ziyaret ile aynı ayda olmalıdır.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the dialog with a cautious message when the request times out", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout");
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DailyPlanVisitCompletion onCompleted={vi.fn()} target={target} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /Atlas Makina.*ziyaretini tamamla/u,
      }),
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Tamamla ve kaydet" })
        .closest("form")!,
    );

    const timeoutCall = timeoutSpy.mock.calls.find(([, delay]) => delay === 12_000);
    expect(timeoutCall).toBeDefined();
    await act(async () => {
      (timeoutCall?.[0] as () => void)();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "İstek zaman aşımına uğradı. Pencereyi kapatıp sayfayı yenileyerek ziyaret durumunu kontrol edin.",
    );
    expect(
      screen.getByRole("button", { name: "Tamamla ve kaydet" }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
