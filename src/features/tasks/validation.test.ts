import { describe, expect, it } from "vitest";

import {
  createTaskInputSchema,
  updateTaskInputSchema,
} from "@/features/tasks/validation";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("task input", () => {
  it("trims text and supplies the Kanban defaults", () => {
    expect(
      createTaskInputSchema.parse({
        description: "  Teklif öncesi hazırlık  ",
        title: "  Süreç haritasını tamamla  ",
      }),
    ).toEqual({
      customerId: null,
      description: "Teklif öncesi hazırlık",
      dueOn: null,
      priority: "normal",
      status: "backlog",
      title: "Süreç haritasını tamamla",
    });
  });

  it("canonicalizes explicit empty optional values to null", () => {
    expect(
      createTaskInputSchema.parse({
        assigneeUserAccountId: " ",
        customerId: "",
        description: " ",
        dueOn: " ",
        title: "Yeni görev",
      }),
    ).toMatchObject({
      assigneeUserAccountId: null,
      customerId: null,
      description: null,
      dueOn: null,
    });
  });

  it("rejects impossible dates, non-canonical identities and unknown states", () => {
    expect(() =>
      createTaskInputSchema.parse({ title: "Görev", dueOn: "2026-02-30" }),
    ).toThrow();
    expect(() =>
      createTaskInputSchema.parse({
        assigneeUserAccountId: accountId.toUpperCase(),
        title: "Görev",
      }),
    ).toThrow();
    expect(() =>
      createTaskInputSchema.parse({ status: "working", title: "Görev" }),
    ).toThrow();
  });

  it("requires an optimistic version and at least one actual change", () => {
    expect(() => updateTaskInputSchema.parse({ version: 1 })).toThrow();
    expect(() => updateTaskInputSchema.parse({ title: "Eksik sürüm" })).toThrow();
    expect(
      updateTaskInputSchema.parse({ status: "in_progress", version: 3 }),
    ).toEqual({ status: "in_progress", version: 3 });
  });
});
