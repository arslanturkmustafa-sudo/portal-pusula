import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMocks.router,
}));

import { TasksWorkspace } from "@/components/home/tasks-workspace";

type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done" | "cancelled";

afterEach(() => {
  navigationMocks.replace.mockReset();
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
    recurrenceEndsOn: null,
    recurrenceFrequency: null,
    status,
    title: `Görev ${status}`,
    updatedAtUtc: "2026-09-01T08:00:00.000Z",
    version: 3,
    visitLinked: false,
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
  it("opens the create form from the quick-access action and consumes the URL action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input) === "/api/tasks") return jsonResponse({ tasks: [] });
        if (String(input) === "/api/customers") {
          return jsonResponse({ customers: [customer] });
        }
        if (String(input) === "/api/projects") {
          return jsonResponse({ projects: [project] });
        }
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );
    const user = userEvent.setup();

    render(<TasksWorkspace initialCreate />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Görev ekle" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Görev başlığı" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(navigationMocks.replace).toHaveBeenCalledWith("/gorevler", {
      scroll: false,
    });
  });

  it("loads tasks and customers into six accessible Kanban columns", async () => {
    const statuses: TaskStatus[] = [
      "backlog",
      "todo",
      "in_progress",
      "blocked",
      "done",
      "cancelled",
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
    const user = userEvent.setup();

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
    expect(screen.getByRole("region", { name: "İptal" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(6);
    expect(screen.queryByText("Bağımlılıklar ve zaman takibi")).not
      .toBeInTheDocument();
    const reportLink = screen.getByRole("link", { name: "Firma görev raporu" });
    expect(reportLink).toHaveAttribute("href", "/gorevler/rapor");
    expect(reportLink).toHaveClass("task-report-action");
    expect(within(reportLink).getByText("Firma raporu")).toBeInTheDocument();
    expect(reportLink.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Müşteri filtresi" }),
      customer.id,
    );
    expect(reportLink).toHaveAttribute(
      "href",
      "/gorevler/rapor?customerId=customer-1",
    );

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

  it("keeps write controls but hides lifecycle and audit controls without exact capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input) === "/api/tasks") {
          return jsonResponse({ tasks: [taskFixture("todo", { title: "Yetki kontrollü görev" })] });
        }
        if (String(input) === "/api/customers") return jsonResponse({ customers: [customer] });
        if (String(input) === "/api/projects") return jsonResponse({ projects: [project] });
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );

    render(
      <TasksWorkspace
        capabilities={{
          canExportReports: false,
          canLifecycleTasks: false,
          canReadAudit: false,
          canReadCustomers: true,
          canReadProjects: true,
          canWriteTasks: true,
        }}
      />,
    );

    expect(await screen.findByRole("button", { name: "Yetki kontrollü görev görevini düzenle" }))
      .toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Yetki kontrollü görev durumu" }))
      .toBeInTheDocument();
    expect(screen.queryByText("İşlemler")).not.toBeInTheDocument();
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
      recurrenceEndsOn: null,
      recurrenceFrequency: null,
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

  it("creates a monthly task recurrence and shows its cadence on the card", async () => {
    let postBody: Record<string, unknown> | null = null;
    const createdTask = taskFixture("backlog", {
      dueOn: "2026-09-30",
      id: "task-recurring",
      recurrenceEndsOn: "2026-12-31",
      recurrenceFrequency: "monthly",
      title: "Aylık durum raporu",
      version: 1,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/tasks" && init?.method === "POST") {
          postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return jsonResponse({ task: createdTask }, 201);
        }
        if (url === "/api/tasks") return jsonResponse({ tasks: [] });
        if (url === "/api/customers") return jsonResponse({ customers: [customer] });
        if (url === "/api/projects") return jsonResponse({ projects: [project] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    await user.click(await screen.findByRole("button", { name: "+ Görev ekle" }));
    await user.type(screen.getByLabelText("Görev başlığı"), "Aylık durum raporu");
    await user.type(screen.getByLabelText("Vade"), "2026-09-30");
    await user.selectOptions(screen.getByLabelText("Tekrar"), "monthly");
    await user.type(screen.getByLabelText("Tekrar bitiş tarihi"), "2026-12-31");
    await user.click(screen.getByRole("button", { name: "Görevi kaydet" }));

    expect(postBody).toMatchObject({
      dueOn: "2026-09-30",
      recurrenceEndsOn: "2026-12-31",
      recurrenceFrequency: "monthly",
      title: "Aylık durum raporu",
    });
    const card = await screen.findByRole("article", { name: "Aylık durum raporu" });
    expect(within(card).getByText(/Her ay/)).toBeInTheDocument();
  });

  it("reloads the board after completing a recurring task so its next occurrence appears", async () => {
    const recurringTask = taskFixture("todo", {
      id: "task-recurring-source",
      recurrenceFrequency: "weekly",
      title: "Haftalık kontrol",
    });
    const completedTask = {
      ...recurringTask,
      completedAtUtc: "2026-09-02T10:00:00.000Z",
      status: "done" as const,
      version: 4,
    };
    const nextTask = taskFixture("todo", {
      dueOn: "2100-01-07",
      id: "task-recurring-next",
      recurrenceFrequency: "weekly",
      title: "Haftalık kontrol",
      version: 1,
    });
    let taskReadCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/tasks/task-recurring-source" && init?.method === "PATCH") {
          return jsonResponse({ task: completedTask });
        }
        if (url === "/api/tasks") {
          taskReadCount += 1;
          return jsonResponse({
            tasks:
              taskReadCount === 1
                ? [recurringTask]
                : [completedTask, nextTask],
          });
        }
        if (url === "/api/customers") return jsonResponse({ customers: [customer] });
        if (url === "/api/projects") return jsonResponse({ projects: [project] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Haftalık kontrol durumu" }),
      "done",
    );

    await waitFor(() => {
      expect(taskReadCount).toBe(2);
      expect(screen.getAllByRole("article", { name: "Haftalık kontrol" }))
        .toHaveLength(2);
    });
  });

  it("reloads the board when a recurring task is completed from the editor", async () => {
    const recurringTask = taskFixture("todo", {
      id: "task-recurring-editor",
      recurrenceFrequency: "monthly",
      title: "Aylık kapanış",
    });
    const completedTask = {
      ...recurringTask,
      completedAtUtc: "2026-09-02T10:00:00.000Z",
      status: "done" as const,
      version: 4,
    };
    const nextTask = taskFixture("todo", {
      dueOn: "2100-01-31",
      id: "task-recurring-editor-next",
      recurrenceFrequency: "monthly",
      title: "Aylık kapanış",
      version: 1,
    });
    let taskReadCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/tasks/task-recurring-editor" && init?.method === "PATCH") {
          return jsonResponse({ task: completedTask });
        }
        if (url === "/api/tasks") {
          taskReadCount += 1;
          return jsonResponse({
            tasks:
              taskReadCount === 1
                ? [recurringTask]
                : [completedTask, nextTask],
          });
        }
        if (url === "/api/customers") return jsonResponse({ customers: [customer] });
        if (url === "/api/projects") return jsonResponse({ projects: [project] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    await user.click(
      await screen.findByRole("button", {
        name: "Aylık kapanış görevini düzenle",
      }),
    );
    const editor = await screen.findByRole("region", {
      name: "Görevi güncelle",
    });
    await user.selectOptions(within(editor).getByLabelText("Durum"), "done");
    await user.click(screen.getByRole("button", { name: "Değişiklikleri kaydet" }));

    await waitFor(() => {
      expect(taskReadCount).toBe(2);
      expect(screen.getAllByRole("article", { name: "Aylık kapanış" }))
        .toHaveLength(2);
    });
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
        recurrenceEndsOn: null,
        recurrenceFrequency: null,
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
      title: "Müşteriyi tekrar ara",
      version: 3,
    });
    expect(patchBodies[1]).not.toHaveProperty("projectId");
    expect(patchBodies[1]).not.toHaveProperty("status");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Görev başka bir işlemde değişti. Sayfayı yenileyip yeniden deneyin.",
    );
    expect(
      screen.getByRole("heading", { name: "Görevi güncelle" }),
    ).toBeInTheDocument();
  });

  it("locks visit-owned fields while keeping safe task details editable", async () => {
    const linkedTask = taskFixture("done", {
      id: "task-visit-linked",
      title: "Ziyaret özeti",
      visitLinked: true,
    });
    let patchBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/tasks/task-visit-linked" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          task: {
            ...linkedTask,
            ...patchBody,
            title: "Güncellenen ziyaret özeti",
            version: 4,
          },
        });
      }
      if (url === "/api/tasks") return jsonResponse({ tasks: [linkedTask] });
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
      name: "Ziyaret özeti durumu",
    });
    expect(statusSelect).toBeDisabled();
    expect(statusSelect).toHaveAccessibleDescription(/ziyaret kaydınca yönetilir/iu);
    await user.click(
      screen.getByRole("button", { name: "Ziyaret özeti görevini düzenle" }),
    );

    const editor = screen.getByRole("region", { name: "Görevi güncelle" });
    expect(within(editor).getByLabelText("Proje")).toBeDisabled();
    expect(within(editor).getByLabelText("Müşteri")).toBeDisabled();
    expect(within(editor).getByLabelText("Vade")).toBeDisabled();
    expect(within(editor).getByLabelText("Durum")).toBeDisabled();
    expect(within(editor).getByLabelText("Görev başlığı")).toBeEnabled();
    expect(within(editor).getByLabelText("Öncelik")).toBeEnabled();
    expect(within(editor).getByLabelText("Açıklama")).toBeEnabled();

    await user.clear(within(editor).getByLabelText("Görev başlığı"));
    await user.type(
      within(editor).getByLabelText("Görev başlığı"),
      "Güncellenen ziyaret özeti",
    );
    await user.click(
      screen.getByRole("button", { name: "Değişiklikleri kaydet" }),
    );

    await waitFor(() =>
      expect(patchBody).toEqual({
        title: "Güncellenen ziyaret özeti",
        version: 3,
      }),
    );
  });

  it("offers only customer and project combinations linked in the portfolio", async () => {
    const otherProject = {
      displayName: "OptiPusula",
      id: "project-2",
      shortCode: "OPTIPUSULA",
      status: "active",
    };
    const linkedCustomer = {
      ...customer,
      projects: [{ id: project.id, status: "active" }],
    };
    const otherCustomer = {
      displayName: "Vega Lojistik",
      id: "customer-2",
      projects: [{ id: otherProject.id, status: "active" }],
      shortCode: "VEGA",
      status: "active",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        if (String(input) === "/api/tasks") return jsonResponse({ tasks: [] });
        if (String(input) === "/api/customers") {
          return jsonResponse({ customers: [linkedCustomer, otherCustomer] });
        }
        if (String(input) === "/api/projects") {
          return jsonResponse({ projects: [project, otherProject] });
        }
        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );
    const user = userEvent.setup();

    render(<TasksWorkspace />);
    await user.click(await screen.findByRole("button", { name: "+ Görev ekle" }));
    await user.selectOptions(screen.getByLabelText("Müşteri"), linkedCustomer.id);
    const projectSelect = screen.getByLabelText("Proje");
    expect(within(projectSelect).getByRole("option", { name: /ByPusula/ })).toBeInTheDocument();
    expect(within(projectSelect).queryByRole("option", { name: /OptiPusula/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Müşteri"), "");
    await user.selectOptions(screen.getByLabelText("Proje"), otherProject.id);
    const customerSelect = screen.getByLabelText("Müşteri");
    expect(within(customerSelect).getByRole("option", { name: /Vega Lojistik/ })).toBeInTheDocument();
    expect(within(customerSelect).queryByRole("option", { name: /Atlas Makina/ })).not.toBeInTheDocument();
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
