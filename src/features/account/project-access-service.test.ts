// @vitest-environment node
import type { Pool } from "mysql2/promise";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), replacePermissions: vi.fn(), readScope: vi.fn(), replaceScope: vi.fn(), audit: vi.fn() }));
vi.mock("@/features/account/repository", () => ({
  findUserAccountForUpdate: mocks.find,
  findUserAccountById: mocks.find,
  updateUserAccountStatus: mocks.update,
  replaceUserPermissions: mocks.replacePermissions,
  listUserPermissionCodes: () => ["tasks.read"],
}));
vi.mock("./project-access-repository", () => ({ readUserProjectScope: mocks.readScope, replaceUserProjectScope: mocks.replaceScope }));
vi.mock("@/platform/audit/repository", () => ({ appendAuditEvent: mocks.audit }));
vi.mock("@/platform/jobs/mysql-transaction", () => ({ withUtcTransaction: async (_pool: unknown, operation: (connection: object) => unknown) => operation({}) }));
import { updateManagedUser, validateAccountPrincipalSession } from "./service";

it("revokes the old session when the last project is removed and audits the new scope", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const account = { id, role: "member", status: "active", credentialVersion: 1, displayName: "Ekip", email: "ekip@example.test" };
  mocks.find.mockResolvedValue(account);
  mocks.update.mockImplementation(async (_connection: unknown, changes: { credentialVersion: number }) => { account.credentialVersion = changes.credentialVersion; return true; });
  mocks.readScope.mockResolvedValue([]);
  const result = await updateManagedUser({} as Pool, id, { permissions: ["tasks.read"], status: "active", projectIds: [] }, { actorId: "20000000-0000-4000-8000-000000000001", correlationId: "scope-test" });
  expect(result.projectIds).toEqual([]);
  expect(mocks.replaceScope).toHaveBeenCalledWith({}, id, []);
  expect(mocks.audit).toHaveBeenCalledWith({}, expect.objectContaining({ afterSummary: expect.objectContaining({ projectIds: [], credentialVersion: 2 }) }));
  expect(await validateAccountPrincipalSession({} as Pool, id, 1)).toBeNull();
  expect(await validateAccountPrincipalSession({} as Pool, id, 2)).toMatchObject({ projectIds: [] });
});
