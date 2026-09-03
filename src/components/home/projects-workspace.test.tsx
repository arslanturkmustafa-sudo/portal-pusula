import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsWorkspace } from "@/components/home/projects-workspace";

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

const project = {
  budgetAmount: null,
  closedAtUtc: null,
  createdAtUtc: "2026-09-03 08:00:00.000000",
  currency: "TRY",
  displayName: "ByPusula",
  id: "project-1",
  internalNote: null,
  objective: "İşletme olgunluğunu değerlendirmek",
  projectType: "product",
  shortCode: "BYPUSULA",
  startsOn: null,
  status: "active",
  targetEndsOn: null,
  updatedAtUtc: "2026-09-03 08:00:00.000000",
  version: 1,
};

describe("ProjectsWorkspace", () => {
  it("opens a portfolio record and saves a complete versioned edit", async () => {
    let patchBody: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects/project-1" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({
          project: {
            ...project,
            budgetAmount: "75000.0000",
            internalNote: "2027 fiyatı ayrıca değerlendirilecek.",
            startsOn: "2026-09-01",
            targetEndsOn: "2027-08-31",
            version: 2,
          },
        });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [project] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ProjectsWorkspace />);

    expect(await screen.findByRole("heading", { name: "ByPusula" }))
      .toBeInTheDocument();
    expect(screen.getByText("İşletme olgunluğunu değerlendirmek"))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Projeyi düzenle" }));
    await user.type(screen.getByLabelText("Planlanan bütçe (₺)"), "75000");
    fireEvent.change(screen.getByLabelText("Başlangıç"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Hedef bitiş"), {
      target: { value: "2027-08-31" },
    });
    await user.type(
      screen.getByLabelText("İç not"),
      "2027 fiyatı ayrıca değerlendirilecek.",
    );
    await user.click(
      screen.getByRole("button", { name: "Proje dosyasını kaydet" }),
    );

    await waitFor(() => expect(patchBody).toEqual({
      budgetAmount: "75000",
      displayName: "ByPusula",
      internalNote: "2027 fiyatı ayrıca değerlendirilecek.",
      objective: "İşletme olgunluğunu değerlendirmek",
      projectType: "product",
      shortCode: "BYPUSULA",
      startsOn: "2026-09-01",
      status: "active",
      targetEndsOn: "2027-08-31",
      version: 1,
    }));
    expect(await screen.findByText("₺75.000,00")).toBeInTheDocument();
    expect(screen.getByText("1 Eylül 2026")).toBeInTheDocument();
  });

  it("preserves a DECIMAL(19,4) budget exactly while viewing and editing", async () => {
    const preciseProject = {
      ...project,
      budgetAmount: "999999999999999.9999",
      id: "project-precise",
    };
    let patchBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects/project-precise" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          project: { ...preciseProject, version: 2 },
        });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [preciseProject] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ProjectsWorkspace />);

    expect(
      await screen.findByText("₺999.999.999.999.999,9999"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Projeyi düzenle" }));
    expect(screen.getByLabelText("Planlanan bütçe (₺)")).toHaveValue(
      "999999999999999.9999",
    );
    await user.click(
      screen.getByRole("button", { name: "Proje dosyasını kaydet" }),
    );

    await waitFor(() =>
      expect(patchBody?.budgetAmount).toBe("999999999999999.9999"),
    );
    expect(
      await screen.findByText("₺999.999.999.999.999,9999"),
    ).toBeInTheDocument();
  });

  it("creates the agreed four-record starting portfolio from an empty state", async () => {
    const postBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        return jsonResponse(
          {
            project: {
              ...project,
              ...body,
              id: `project-${postBodies.length}`,
              version: 1,
            },
          },
          201,
        );
      }
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ProjectsWorkspace />);
    await user.click(
      await screen.findByRole("button", { name: "Başlangıç portföyünü oluştur" }),
    );

    await waitFor(() => expect(postBodies).toHaveLength(4));
    expect(postBodies.map((body) => body.shortCode)).toEqual([
      "MUHENDIS_KAFASI",
      "BYPUSULA",
      "OPTIPUSULA",
      "7_EMLAK",
    ]);
    expect(await screen.findByText("7 Emlak Ajansı")).toBeInTheDocument();
  });

  it("keeps a partial initialization error visible and retries only missing projects", async () => {
    const postBodies: Array<Record<string, unknown>> = [];
    let byPusulaFailed = false;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/projects" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        if (body.shortCode === "BYPUSULA" && !byPusulaFailed) {
          byPusulaFailed = true;
          return jsonResponse({ status: "service_unavailable" }, 503);
        }
        return jsonResponse(
          {
            project: {
              ...project,
              ...body,
              id: `project-${String(body.shortCode)}`,
              version: 1,
            },
          },
          201,
        );
      }
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ProjectsWorkspace />);
    await user.click(
      await screen.findByRole("button", { name: "Başlangıç portföyünü oluştur" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Başlangıç portföyü tamamlanamadı",
    );
    expect(postBodies.map((body) => body.shortCode)).toEqual([
      "MUHENDIS_KAFASI",
      "BYPUSULA",
    ]);

    await user.click(
      screen.getByRole("button", { name: "Eksik 3 projeyi tamamla" }),
    );

    await waitFor(() => expect(postBodies).toHaveLength(5));
    expect(postBodies.slice(2).map((body) => body.shortCode)).toEqual([
      "BYPUSULA",
      "OPTIPUSULA",
      "7_EMLAK",
    ]);
    expect(await screen.findByText("7 Emlak Ajansı")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
