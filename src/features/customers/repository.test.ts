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
  archive_reason: null,
  archived_at_utc: null,
  archived_by_user_account_id: null,
  contact_note: null,
  created_at_utc: "2026-09-01 08:00:00.000000",
  customer_status: "active",
  display_name: "Öncü Üretim",
  email: "yonetim@oncu.example",
  id: "10000000-0000-4000-8000-000000000001",
  phone: null,
  short_code: "ONCU",
  updated_at_utc: "2026-09-01 08:00:00.000000",
  version: 1,
};

describe("customer repository", () => {
  it("groups active projects into a deterministic customer projection", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          ...customerBase,
          active_contract_count: 2,
          billing_currency: "TRY",
          billing_vat_mode: "mixed",
          monthly_fee_amount: "175000.0000",
          next_visit_on: "2026-09-10",
          payment_days: "5,15",
          project_display_name: "ByPusula",
          project_id: "20000000-0000-4000-8000-000000000001",
          project_short_code: "BYPUSULA",
          project_status: "active",
        },
        {
          ...customerBase,
          active_contract_count: 2,
          billing_currency: "TRY",
          billing_vat_mode: "mixed",
          monthly_fee_amount: "175000.0000",
          next_visit_on: "2026-09-10",
          payment_days: "5,15",
          project_display_name: "Mühendis Kafası",
          project_id: "20000000-0000-4000-8000-000000000002",
          project_short_code: "MUHENDIS_KAFASI",
          project_status: "on_hold",
        },
      ],
      [],
    ]);

    await expect(
      listCustomerRecords(
        { execute } as unknown as PoolConnection,
        {
          businessDate: "2026-09-07",
          includeBilling: true,
          includeContact: true,
          includeVisits: true,
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        displayName: "Öncü Üretim",
        overview: {
          billing: {
            activeContractCount: 2,
            currency: "TRY",
            monthlyFeeAmount: "175000.0000",
            paymentDays: [5, 15],
            vatMode: "mixed",
          },
          nextVisitOn: "2026-09-10",
        },
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
        /LEFT JOIN customer_project[\s\S]*monthly_visit_commitment[\s\S]*visit\.committed_on >= \?[\s\S]*SUM\(monthly_fee_amount\)[\s\S]*starts_on <= \?[\s\S]*ends_on >= \?[\s\S]*p\.display_name ASC/iu,
      ),
      ["2026-09-07", "2026-09-07", "2026-09-07"],
    );
    expect(String(execute.mock.calls[0]?.[0])).not.toContain("CURRENT_DATE");
  });

  it("requires an explicit canonical business date for visit or billing projections", async () => {
    const execute = vi.fn();

    await expect(
      listCustomerRecords(
        { execute } as unknown as PoolConnection,
        { includeVisits: true },
      ),
    ).rejects.toThrow("Customer projection business date is invalid.");
    await expect(
      listCustomerRecords(
        { execute } as unknown as PoolConnection,
        { businessDate: "2026-02-30", includeBilling: true },
      ),
    ).rejects.toThrow("Customer projection business date is invalid.");
    expect(execute).not.toHaveBeenCalled();
  });

  it("never selects billing columns unless the caller explicitly allows them", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          ...customerBase,
          active_contract_count: null,
          billing_currency: null,
          billing_vat_mode: null,
          monthly_fee_amount: null,
          next_visit_on: null,
          payment_days: null,
          project_display_name: null,
          project_id: null,
          project_short_code: null,
          project_status: null,
        },
      ],
      [],
    ]);

    const result = await listCustomerRecords(
      { execute } as unknown as PoolConnection,
    );

    expect(result[0]?.overview).toEqual({ nextVisitOn: null });
    expect(JSON.stringify(result)).not.toContain("monthlyFeeAmount");
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("NULL AS contact_note");
    expect(sql).toContain("NULL AS next_visit_on");
    expect(sql).not.toContain("monthly_visit_commitment");
    expect(sql).not.toContain("c.contact_note");
    expect(execute).toHaveBeenCalledWith(
      expect.not.stringMatching(/FROM consulting_contract\s+WHERE status = 'active'/u),
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
        /consulting_contract[\s\S]*work_task_project[\s\S]*task\.status NOT IN \('done', 'cancelled'\)/u,
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
