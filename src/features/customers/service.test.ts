// @vitest-environment node

import type { Pool } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendAuditEvent: vi.fn(),
  customerProjectLinkIsInUse: vi.fn(),
  findCustomerForUpdate: vi.fn(),
  findProjectForUpdate: vi.fn(),
  insertCustomerProjectLink: vi.fn(),
  insertCustomerRecord: vi.fn(),
  listCustomerProjectLinksForUpdate: vi.fn(),
  listCustomerRecords: vi.fn(),
  updateCustomerProjectLinkStatus: vi.fn(),
  updateCustomerRecord: vi.fn(),
}));

vi.mock("@/features/customers/repository", () => ({
  customerProjectLinkIsInUse: mocks.customerProjectLinkIsInUse,
  findCustomerForUpdate: mocks.findCustomerForUpdate,
  insertCustomerProjectLink: mocks.insertCustomerProjectLink,
  insertCustomerRecord: mocks.insertCustomerRecord,
  listCustomerProjectLinksForUpdate: mocks.listCustomerProjectLinksForUpdate,
  listCustomerRecords: mocks.listCustomerRecords,
  updateCustomerProjectLinkStatus: mocks.updateCustomerProjectLinkStatus,
  updateCustomerRecord: mocks.updateCustomerRecord,
}));
vi.mock("@/features/projects/repository", () => ({
  findProjectForUpdate: mocks.findProjectForUpdate,
}));
vi.mock("@/platform/audit/repository", () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock("@/platform/jobs/mysql-transaction", () => ({
  withUtcTransaction: vi.fn(
    async (_pool: unknown, operation: (connection: object) => unknown) =>
      operation({}),
  ),
}));

import {
  createCustomer,
  CustomerProjectInUseError,
  CustomerProjectUnavailableError,
  listCustomers,
  updateCustomer,
} from "@/features/customers/service";

const customerId = "10000000-0000-4000-8000-000000000001";
const projectAId = "20000000-0000-4000-8000-000000000001";
const projectBId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-03T08:00:00.000Z");
const nowSql = "2026-09-03 08:00:00.000000";
const actorId = "80000000-0000-4000-8000-000000000001";
const context = { actorId, correlationId: "customer-service-test", now };
const projectA = {
  archiveReason: null,
  archivedAtUtc: null,
  archivedByUserAccountId: null,
  displayName: "Mühendis Kafası",
  id: projectAId,
  shortCode: "MUHENDIS_KAFASI",
  status: "active" as const,
  version: 1,
};
const projectB = {
  archiveReason: null,
  archivedAtUtc: null,
  archivedByUserAccountId: null,
  displayName: "ByPusula",
  id: projectBId,
  shortCode: "BYPUSULA",
  status: "planned" as const,
  version: 1,
};
const before = {
  archiveReason: null,
  archivedAtUtc: null,
  archivedByUserAccountId: null,
  contactNote: null,
  createdAtUtc: "2026-09-01 08:00:00.000000",
  displayName: "Öncü Üretim",
  email: null,
  id: customerId,
  overview: { nextVisitOn: null },
  phone: null,
  projects: [projectA],
  shortCode: "ONCU",
  status: "active" as const,
  updatedAtUtc: "2026-09-01 08:00:00.000000",
  version: 1,
};

describe("customer service project links", () => {
  it("redacts other project links and shared notes from a permitted customer", async () => {
    mocks.listCustomerRecords.mockResolvedValue([{ ...before, projects: [projectA, projectB], contactNote: "Other project secret", overview: { nextVisitOn: "2026-09-20" } }]);
    const result = await listCustomers({} as Pool, { projectIds: [projectAId], includeBilling: true, includeVisits: true });
    expect(result[0].projects).toEqual([projectA]);
    expect(result[0].contactNote).toBeNull();
    expect(result[0].overview).toEqual({ nextVisitOn: null });
    expect(mocks.listCustomerRecords).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projectIds: [projectAId], includeBilling: false, includeVisits: false }));
    expect(await listCustomers({} as Pool, { projectIds: [] })).toEqual([]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCustomerForUpdate.mockResolvedValue(before);
    mocks.customerProjectLinkIsInUse.mockResolvedValue(false);
    mocks.findProjectForUpdate.mockImplementation(
      async (_connection: unknown, id: string) =>
        id === projectAId ? projectA : id === projectBId ? projectB : null,
    );
    mocks.listCustomerProjectLinksForUpdate.mockResolvedValue([]);
    mocks.updateCustomerProjectLinkStatus.mockResolvedValue(true);
    mocks.updateCustomerRecord.mockResolvedValue(true);
  });

  it("projects visits and contracts with the Europe/Istanbul business date", async () => {
    mocks.listCustomerRecords.mockResolvedValueOnce([]);

    await expect(
      listCustomers(
        {} as Pool,
        {
          includeBilling: true,
          includeContact: true,
          includeVisits: true,
        },
        new Date("2026-09-06T21:30:00.000Z"),
      ),
    ).resolves.toEqual([]);

    expect(mocks.listCustomerRecords).toHaveBeenCalledWith({}, {
      businessDate: "2026-09-07",
      includeBilling: true,
      includeContact: true,
      includeVisits: true,
    });
  });

  it("creates one customer and all selected active links atomically", async () => {
    const created = await createCustomer(
      {} as Pool,
      {
        contactNote: null,
        displayName: "Öncü Üretim",
        email: null,
        phone: null,
        projectIds: [projectBId, projectAId],
        shortCode: "ONCU",
        status: "active",
      },
      context,
    );

    expect(created.projects).toEqual([
      expect.objectContaining({ id: projectBId }),
      expect.objectContaining({ id: projectAId }),
    ]);
    expect(mocks.findProjectForUpdate.mock.calls.map((call) => call[1])).toEqual([
      projectAId,
      projectBId,
    ]);
    expect(mocks.insertCustomerProjectLink).toHaveBeenCalledTimes(2);
    expect(mocks.insertCustomerProjectLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active", version: 1 }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "customer.created",
        actorId,
        afterSummary: expect.objectContaining({
          projectIds: [projectBId, projectAId],
        }),
      }),
    );
  });

  it("rejects a completed project when it would create a new active link", async () => {
    mocks.findProjectForUpdate.mockResolvedValue({
      ...projectB,
      status: "completed",
    });

    await expect(
      createCustomer(
        {} as Pool,
        {
          contactNote: null,
          displayName: "Öncü Üretim",
          email: null,
          phone: null,
          projectIds: [projectBId],
          shortCode: "ONCU",
          status: "active",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CustomerProjectUnavailableError);
    expect(mocks.insertCustomerRecord).not.toHaveBeenCalled();
  });

  it("deactivates omitted links and reactivates a selected historical link", async () => {
    mocks.listCustomerProjectLinksForUpdate.mockResolvedValue([
      {
        createdAtUtc: before.createdAtUtc,
        customerId,
        projectId: projectAId,
        status: "active",
        updatedAtUtc: before.updatedAtUtc,
        version: 2,
      },
      {
        createdAtUtc: before.createdAtUtc,
        customerId,
        projectId: projectBId,
        status: "inactive",
        updatedAtUtc: before.updatedAtUtc,
        version: 4,
      },
    ]);

    const updated = await updateCustomer(
      {} as Pool,
      customerId,
      { projectIds: [projectBId], version: 1 },
      context,
    );

    expect(updated.projects).toEqual([
      expect.objectContaining({ id: projectBId }),
    ]);
    expect(mocks.updateCustomerProjectLinkStatus).toHaveBeenCalledTimes(2);
    expect(mocks.updateCustomerProjectLinkStatus).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        projectId: projectAId,
        status: "inactive",
        updatedAtUtc: nowSql,
        version: 3,
      }),
      2,
    );
    expect(mocks.updateCustomerProjectLinkStatus).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        projectId: projectBId,
        status: "active",
        updatedAtUtc: nowSql,
        version: 5,
      }),
      4,
    );
  });

  it("keeps a project link when an active contract or unfinished task uses it", async () => {
    mocks.listCustomerProjectLinksForUpdate.mockResolvedValue([
      {
        createdAtUtc: before.createdAtUtc,
        customerId,
        projectId: projectAId,
        status: "active",
        updatedAtUtc: before.updatedAtUtc,
        version: 2,
      },
    ]);
    mocks.customerProjectLinkIsInUse.mockResolvedValue(true);

    await expect(
      updateCustomer(
        {} as Pool,
        customerId,
        { projectIds: [projectBId], version: 1 },
        context,
      ),
    ).rejects.toBeInstanceOf(CustomerProjectInUseError);
    expect(mocks.updateCustomerProjectLinkStatus).not.toHaveBeenCalled();
  });

  it("allows an already-active link to remain after its project closes", async () => {
    mocks.findProjectForUpdate.mockResolvedValue({
      ...projectA,
      status: "completed",
    });
    mocks.listCustomerProjectLinksForUpdate.mockResolvedValue([
      {
        createdAtUtc: before.createdAtUtc,
        customerId,
        projectId: projectAId,
        status: "active",
        updatedAtUtc: before.updatedAtUtc,
        version: 2,
      },
    ]);

    await expect(
      updateCustomer(
        {} as Pool,
        customerId,
        { projectIds: [projectAId], version: 1 },
        context,
      ),
    ).resolves.toMatchObject({
      projects: [expect.objectContaining({ id: projectAId, status: "completed" })],
    });
    expect(mocks.updateCustomerProjectLinkStatus).not.toHaveBeenCalled();
  });
});
