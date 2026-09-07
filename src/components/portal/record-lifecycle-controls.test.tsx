import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirectToPortalLogin: vi.fn() }));

vi.mock("@/platform/navigation/portal-return-path", () => ({
  redirectToPortalLogin: mocks.redirectToPortalLogin,
}));

import { RecordLifecycleControls } from "./record-lifecycle-controls";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RecordLifecycleControls", () => {
  it("renders nothing when neither actions nor audit history are allowed", () => {
    const { container } = render(
      <RecordLifecycleControls
        actions={[]}
        canReadHistory={false}
        entityId="project-1"
        entityLabel="Portal Pusula"
        entityType="project"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("requires a reason and sends the exact lifecycle contract", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(
      <RecordLifecycleControls
        actions={[
          {
            description: "Müşteriyi aktif listeden kaldırır.",
            id: "archive",
            label: "Arşivle",
            request: {
              action: "archive",
              endpoint: "/api/customers/customer-1/lifecycle",
              kind: "lifecycle",
              version: 7,
            },
            tone: "danger",
          },
        ]}
        entityId="customer-1"
        entityLabel="Atlas Makina"
        entityType="customer"
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByText("İşlemler"));
    await user.click(screen.getByRole("button", { name: "Arşivle" }));
    expect(screen.getByLabelText("İşlem gerekçesi")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Onayla" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("en az 3 karakter");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("İşlem gerekçesi"), "Müşteri talebi");
    await user.click(screen.getByRole("button", { name: "Onayla" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/customers/customer-1/lifecycle",
      expect.objectContaining({
        body: JSON.stringify({
          action: "archive",
          reason: "Müşteri talebi",
          version: 7,
        }),
        method: "POST",
      }),
    );
  });

  it("keeps the dialog and record state unchanged on a 409", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response({}, 409)));
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(
      <RecordLifecycleControls
        actions={[
          {
            description: "Gideri geçersiz kılar.",
            id: "void",
            label: "Geçersiz kıl",
            request: { endpoint: "/api/finance/expenses/e-1", kind: "expense-void", version: 2 },
            tone: "danger",
          },
        ]}
        entityId="e-1"
        entityLabel="Ofis kirası"
        entityType="expense"
        onSuccess={onSuccess}
      />,
    );
    await user.click(screen.getByText("İşlemler"));
    await user.click(screen.getByRole("button", { name: "Geçersiz kıl" }));
    await user.type(screen.getByLabelText("İşlem gerekçesi"), "Yanlış kayıt");
    await user.click(screen.getByRole("button", { name: "Onayla" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("başka bir işlemde değişti");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("loads and renders server-redacted audit history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        response({
          events: [
            {
              action: "archive",
              actorLabel: "Ayşe",
              after: { status: "archived" },
              before: { status: "active" },
              id: "event-1",
              occurredAtUtc: "2026-09-04T08:00:00.000Z",
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(
      <RecordLifecycleControls
        canReadHistory
        entityId="project-1"
        entityLabel="Portal Pusula"
        entityType="project"
      />,
    );
    await user.click(screen.getByText("İşlemler"));
    await user.click(screen.getByRole("button", { name: "İşlem geçmişi" }));
    expect(await screen.findByText("Arşivlendi")).toBeInTheDocument();
    expect(screen.getByText("Ayşe")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("archived")).toBeInTheDocument();
  });
});
