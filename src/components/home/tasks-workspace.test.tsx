import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TasksWorkspace } from "@/components/home/tasks-workspace";

type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function taskFixture(
  status: TaskStatus = "todo",
  overrides: Record<string, unknown> = {},
) {
  return {
    assigneeEmail: null,
    assigneeUserAccountId: null,
    completedAtUtc: null,
    createdAtUtc: "2026-09-01T08:00:00.000Z",
    customerCode: "ATLAS",
    customerId: "customer-1",
    customerName: "Atlas Makina",
    description: "Teklif sonrası takip",
    dueOn: "2099-12-31",
    id: `task-${status}`,
    priority: "normal",
    projectCode: "BYPUSULA",
    projectId: "project-1",
    projectName: "ByPusula",
    status,
    title: `Görev ${status}`,
    updatedAtUtc: "2026-09-01T08:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

const customer = {
  displayName: "Atlas Makina",
  id: "customer-1",
  shortCode: "ATLAS",
  status: "active",
};

const project = {
  displayName: "ByPusula",
  id: "project-1",
  shortCode: "BYPUSULA",
  status: "active",
};

describe("TasksWorkspace", () => {
  it("loads tasks and customers into five accessible Kanban columns", async () => {
    const statuses: TaskStatus[] = [
      "backlog",
      "todo",
      "in_progress",
      "blocked",
      "done",
    ];
    const tasks = statuses.map((status, index) =>
      taskFixture(status, {
        id: `task-${index}`,
        priority: index === 0 ? "urgent" : "normal",
      }),
    );
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/tasks") return jsonResponse({ tasks });
      if (String(input) === "/api/customers") {
        return jsonResponse({ customers: [customer] });
      }
      if (String(input) === "/api/projects") {
        return jsonResponse({ projects: [project] });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksWorkspace />);

    const backlog = await screen.findByRole("region", { name: "Havuz" });
    expect(within(backlog).getByRole("article", { name: "Görev backlog" }))
      .toBeInTheDocument();
    expect(within(backlog).getByText("Acil")).toBeInTheDocument();
    expect(within(backlog).getByText("Atlas Makina")).toBeInTheDocument();
    expect(within(backlog).getByText(/ByPusula/)).toBeInTheDocument();
    expect(within(backlog).getByText("31 Ara 2099")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Yapılacak" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Devam ediyor" }))
      .toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Beklemede" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tamamlandı" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.queryByText("Bağımlılıklar ve zaman takibi")).not
      .toBeInTheDocument();

    const stageSelector = screen.getByRole("combobox", {
      name: "Gösterilen Kanban aşaması",
    });
    expect(stageSelector).toHaveAttribute("aria-controls", "task-column-todo");
    expect(stageSelector).toHaveValue("todo");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/customers",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("serializes initial reads for the deliberately small database pool", async () => {
    const taskRequest = deferred<Response>();
    const customerRequest = deferred<Response>();
    const projectRequest = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/tasks") return taskRequest.promise;
      if (url === "/api/customers") return customerRequest.promise;
      if (url === "/api/projects") return projectRequest.promise;
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksWorkspace />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/tasks");

    taskRequest.resolve(jsonResponse({ tasks: [] }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/customers");

    customerRequest.resolve(jsonResponse({ customers: [] }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/projects");

    projectRequest.resolve(jsonResponse({ projects: [] }));
    expect(await screen.findByText("Henüz görev kaydı yok.")).toBeInTheDocument();
  });

  it("creates a task with the exact complete form document", async () => {
    let postBody: unknown;
    const createdTask = taskFixture("backlog", {
      customerCode: null,
      customerId: null,
      customerName: null,
      description: null,
      dueOn: null,
      id: "task-created",
      title: "Teklifi hazırla",
      version: 1,
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks" && init?.method === "POST") {
        postBody = JSON.parse(String(init.body));
        return jsonResponse({ task: createdTask }, 201);
      }
      if (url === "/api/tasks") return jsonResponse({ tasks: [] });
      if (url === "/api/customers") {
        return jsonResponse({ customers: [customer] });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [project] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    await screen.findByText("Henüz görev kaydı yok.");
    await user.click(screen.getByRole("button", { name: "+ Görev ekle" }));
    await user.type(screen.getByLabelText("Görev başlığı"), "  Teklifi hazırla  ");
    await user.selectOptions(screen.getByLabelText("Proje"), project.id);
    await user.click(screen.getByRole("button", { name: "Görevi kaydet" }));

    expect(postBody).toEqual({
      customerId: null,
      description: null,
      dueOn: null,
      priority: "normal",
      projectId: project.id,
      status: "backlog",
      title: "Teklifi hazırla",
    });
    const card = await screen.findByRole("article", { name: "Teklifi hazırla" });
    expect(within(screen.getByRole("region", { name: "Havuz" })).getByRole(
      "article",
      { name: "Teklifi hazırla" },
    )).toBe(card);
    expect(screen.queryByRole("heading", { name: "Görev ekle" })).not
      .toBeInTheDocument();
    await waitFor(() => expect(card).toHaveFocus());
  });

  it("moves and then edits with the latest version and all editable fields", async () => {
    const initialTask = taskFixture("todo", { id: "task-42", title: "Teklifi ara" });
    const patchBodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task-42" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        if (patchBodies.length === 1) {
          return jsonResponse({
            task: { ...initialTask, status: "in_progress", version: 4 },
          });
        }
        return jsonResponse({
          task: {
            ...initialTask,
            ...body,
            customerCode: null,
            customerName: null,
            projectCode: null,
            projectId: null,
            projectName: null,
            version: 5,
          },
        });
      }
      if (url === "/api/tasks") return jsonResponse({ tasks: [initialTask] });
      if (url === "/api/customers") {
        return jsonResponse({ customers: [customer] });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [project] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    const statusSelect = await screen.findByRole("combobox", {
      name: "Teklifi ara durumu",
    });
    await user.selectOptions(statusSelect, "in_progress");
    expect(await screen.findByText("Teklifi ara görevi Devam ediyor sütununa taşındı."))
      .toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Yapılacak" })).queryByRole(
      "article",
      { name: "Teklifi ara" },
    )).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Devam ediyor" })).getByRole(
      "article",
      { name: "Teklifi ara" },
    )).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Teklifi ara görevini düzenle" }));
    await user.clear(screen.getByLabelText("Açıklama"));
    await user.selectOptions(screen.getByLabelText("Proje"), "");
    await user.selectOptions(screen.getByLabelText("Müşteri"), "");
    await user.clear(screen.getByLabelText("Vade"));
    await user.selectOptions(screen.getByLabelText("Öncelik"), "urgent");
    await user.click(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));

    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies).toEqual([
      {
        customerId: "customer-1",
        description: "Teklif sonrası takip",
        dueOn: "2099-12-31",
        priority: "normal",
        projectId: project.id,
        status: "in_progress",
        title: "Teklifi ara",
        version: 3,
      },
      {
        customerId: null,
        description: null,
        dueOn: null,
        priority: "urgent",
        projectId: null,
        status: "in_progress",
        title: "Teklifi ara",
        version: 4,
      },
    ]);
    expect(await screen.findByText("v5")).toBeInTheDocument();
  });

  it("keeps the editor version snapshot so a concurrent board update is fenced", async () => {
    const initialTask = taskFixture("todo", {
      id: "task-conflict",
      title: "Müşteriyi ara",
    });
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task-conflict" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        if (patchBodies.length === 1) {
          return jsonResponse({
            task: { ...initialTask, status: "in_progress", version: 4 },
          });
        }
        return jsonResponse({ status: "version_conflict" }, 409);
      }
      if (url === "/api/tasks") return jsonResponse({ tasks: [initialTask] });
      if (url === "/api/customers") {
        return jsonResponse({ customers: [customer] });
      }
      if (url === "/api/projects") {
        return jsonResponse({ projects: [project] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    await user.click(
      await screen.findByRole("button", {
        name: "Müşteriyi ara görevini düzenle",
      }),
    );
    await user.clear(screen.getByLabelText("Görev başlığı"));
    await user.type(screen.getByLabelText("Görev başlığı"), "Müşteriyi tekrar ara");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Müşteriyi ara durumu" }),
      "in_progress",
    );
    await screen.findByText(
      "Müşteriyi ara görevi Devam ediyor sütununa taşındı.",
    );
    await user.click(
      screen.getByRole("button", { name: "Değişiklikleri kaydet" }),
    );

    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies[1]).toMatchObject({
      projectId: project.id,
      status: "todo",
      title: "Müşteriyi tekrar ara",
      version: 3,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Görev başka bir işlemde değişti. Sayfayı yenileyip yeniden deneyin.",
    );
    expect(
      screen.getByRole("heading", { name: "Görevi güncelle" }),
    ).toBeInTheDocument();
  });

  it("shows loading and a recoverable board error", async () => {
    let taskRequestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/api/tasks") {
        taskRequestCount += 1;
        return taskRequestCount === 1
          ? jsonResponse({ status: "service_unavailable" }, 503)
          : jsonResponse({ tasks: [] });
      }
      if (String(input) === "/api/customers") {
        return jsonResponse({ customers: [] });
      }
      if (String(input) === "/api/projects") {
        return jsonResponse({ projects: [] });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    expect(screen.getByText("Görev panosu hazırlanıyor…"))
      .toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Görev panosuna ulaşılamadı.",
    );
    await user.click(screen.getByRole("button", { name: "Yeniden dene" }));
    expect(await screen.findByText("Henüz görev kaydı yok."))
      .toBeInTheDocument();
    expect(taskRequestCount).toBe(2);
  });
});
