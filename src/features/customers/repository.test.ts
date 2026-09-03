// @vitest-environment node

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  customerProjectLinkIsInUse,
  findActiveCustomerProjectForUpdate,
  listCustomerRecords,
  updateCustomerProjectLinkStatus,
} from "@/features/customers/repository";

const customerBase = {
  contact_note: null,
  created_at_utc: "2026-09-01 08:00:00.000000",
  customer_status: "active",
  display_name: "Öncü Üretim",
  email: "yonetim@oncu.example",
  id: "10000000-0000-4000-8000-000000000001",
  phone: null,
  short_code: "ONCU",
  updated_at_utc: "2026-09-01 08:00:00.000000",
};

describe("customer repository", () => {
  it("groups active projects into a deterministic customer projection", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          ...customerBase,
          project_display_name: "ByPusula",
          project_id: "20000000-0000-4000-8000-000000000001",
          project_short_code: "BYPUSULA",
          project_status: "active",
        },
        {
          ...customerBase,
          project_display_name: "Mühendis Kafası",
          project_id: "20000000-0000-4000-8000-000000000002",
          project_short_code: "MUHENDIS_KAFASI",
          project_status: "on_hold",
        },
      ],
      [],
    ]);

    await expect(
      listCustomerRecords({ execute } as unknown as PoolConnection),
    ).resolves.toEqual([
      expect.objectContaining({
        displayName: "Öncü Üretim",
        projects: [
          {
            displayName: "ByPusula",
            id: "20000000-0000-4000-8000-000000000001",
            shortCode: "BYPUSULA",
            status: "active",
          },
          {
            displayName: "Mühendis Kafası",
            id: "20000000-0000-4000-8000-000000000002",
            shortCode: "MUHENDIS_KAFASI",
            status: "on_hold",
          },
        ],
      }),
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /LEFT JOIN customer_project[\s\S]*cp\.status = 'active'[\s\S]*p\.display_name ASC/iu,
      ),
    );
  });

  it("returns an active link and fences status updates by version", async () => {
    const linkRow = {
      created_at_utc: "2026-09-01 08:00:00.000000",
      customer_id: customerBase.id,
      project_id: "20000000-0000-4000-8000-000000000001",
      status: "active",
      updated_at_utc: "2026-09-01 08:00:00.000000",
      version: 2,
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[linkRow], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const connection = { execute } as unknown as PoolConnection;

    const link = await findActiveCustomerProjectForUpdate(
      connection,
      linkRow.customer_id,
      linkRow.project_id,
    );
    expect(link).toEqual({
      createdAtUtc: linkRow.created_at_utc,
      customerId: linkRow.customer_id,
      projectId: linkRow.project_id,
      status: "active",
      updatedAtUtc: linkRow.updated_at_utc,
      version: 2,
    });
    await expect(
      updateCustomerProjectLinkStatus(
        connection,
        { ...link!, status: "inactive", version: 3 },
        2,
      ),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringMatching(/WHERE customer_id = \?[\s\S]*version = \?/u),
      expect.arrayContaining(["inactive", 3, linkRow.customer_id, linkRow.project_id, 2]),
    );
  });

  it("detects contract or unfinished task usage before unlinking a project", async () => {
    const execute = vi.fn().mockResolvedValue([[{ in_use: 1 }], []]);

    await expect(
      customerProjectLinkIsInUse(
        { execute } as unknown as PoolConnection,
        customerBase.id,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /consulting_contract[\s\S]*work_task_project[\s\S]*task\.status <> 'done'/u,
      ),
      [
        customerBase.id,
        "20000000-0000-4000-8000-000000000001",
        customerBase.id,
        "20000000-0000-4000-8000-000000000001",
      ],
    );
  });
});
