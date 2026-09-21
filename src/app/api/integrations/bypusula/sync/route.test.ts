// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("server-only", () => ({}));
vi.mock("@/platform/config/readiness-env", () => ({ getDatabaseProbeEnvironment: vi.fn() }));
vi.mock("@/platform/database/mysql-platform", () => ({ getPlatformDatabasePool: vi.fn() }));
vi.mock("@/features/bypusula/sync-service", async original => {
  const actual = await original<typeof import("@/features/bypusula/sync-service")>();
  return { ...actual, receiveAutomaticTransfer: vi.fn() };
});
import { exampleEnvelope } from "@/features/bypusula/fixtures.test-support";
import { getSyncConfiguration, syncSignature, SYNC_PATH } from "@/features/bypusula/sync-auth";
import { receiveAutomaticTransfer } from "@/features/bypusula/sync-service";
import { TransferConflict } from "@/features/bypusula/service";
import { POST } from "./route";
import { proxy } from "@/proxy";

const configuration = { keyId: "synthetic", secret: "a".repeat(64), instanceId: exampleEnvelope.instanceId, accountId: exampleEnvelope.accountId, actorId: "55555555-5555-4555-8555-555555555555" };
const deliveryId = "66666666-6666-4666-8666-666666666666";
function request(options: { body?: unknown; raw?: string; signedBody?: string; timestamp?: string; headers?: Record<string, string>; query?: string } = {}) {
  const body = options.raw ?? JSON.stringify(options.body ?? exampleEnvelope);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  return new NextRequest(`https://portal.example${SYNC_PATH}${options.query ?? ""}`, { method: "POST", body, headers: {
    "Content-Type": "application/json", "X-ByPusula-Key-Id": configuration.keyId,
    "X-ByPusula-Timestamp": timestamp, "X-ByPusula-Delivery-Id": deliveryId,
    "X-ByPusula-Signature": syncSignature(configuration, timestamp, deliveryId, options.signedBody ?? body), ...options.headers,
  } });
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key,value] of Object.entries({ ENABLED:"true", KEY_ID:configuration.keyId, SECRET:configuration.secret, INSTANCE_ID:configuration.instanceId, ACCOUNT_ID:configuration.accountId, ACTOR_ID:configuration.actorId })) vi.stubEnv(`BYPUSULA_SYNC_${key}`,value);
});
afterEach(() => vi.unstubAllEnvs());

it("passes the exact sync path through the session proxy while retaining HMAC and other session gates", async () => {
  const signed = request();
  expect(proxy(signed).headers.get("x-middleware-next")).toBe("1");
  vi.mocked(receiveAutomaticTransfer).mockResolvedValue({status:"pending_mapping",analysisId:deliveryId,completed:0,total:3});
  expect((await POST(signed)).status).toBe(202);
  const invalid = request({headers:{"X-ByPusula-Signature":"0".repeat(64)}});
  expect(proxy(invalid).headers.get("x-middleware-next")).toBe("1");
  expect((await POST(invalid)).status).toBe(404);
  expect(receiveAutomaticTransfer).toHaveBeenCalledTimes(1);
  for (const path of ["/api/tasks", `${SYNC_PATH}/other`]) {
    expect(proxy(new NextRequest(`https://portal.example${path}`)).status).toBe(401);
  }
  expect(proxy(new NextRequest("https://portal.example/gorevler/bypusula")).status).toBe(307);
});

it("rejects unsigned/tampered/stale/cookie/query requests before intake", async () => {
  for (const bad of [request({headers:{"X-ByPusula-Signature":"0".repeat(64)}}),
    request({signedBody:"{}"}), request({timestamp:String(Math.floor(Date.now()/1000)-301)}),
    request({headers:{Cookie:"synthetic=1"}}), request({query:"?token=no"}), request({headers:{"X-ByPusula-Key-Id":"wrong"}})]) {
    const response = await POST(bad);
    expect(response.status).toBe(404); expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
  expect(receiveAutomaticTransfer).not.toHaveBeenCalled();
});

it("binds the configured source and fails closed for disabled or reused credentials", async () => {
  expect((await POST(request({body:{...exampleEnvelope,accountId:"999"}}))).status).toBe(404);
  expect((await POST(request({body:{...exampleEnvelope,instanceId:deliveryId}}))).status).toBe(404);
  vi.stubEnv("SESSION_SECRET",configuration.secret); expect(getSyncConfiguration()).toBeNull();
  expect((await POST(request())).status).toBe(404);
  vi.stubEnv("BYPUSULA_SYNC_ENABLED","false"); expect((await POST(request())).status).toBe(404);
  expect(receiveAutomaticTransfer).not.toHaveBeenCalled();
});

it("returns 202 while mapping or work remains and 200 only when synced", async () => {
  for (const status of ["pending_mapping","processing","synced"] as const) {
    vi.mocked(receiveAutomaticTransfer).mockResolvedValue({status,analysisId:deliveryId,completed:status==="synced"?3:0,total:3});
    const response = await POST(request());
    expect(response.status).toBe(status==="synced"?200:202);
    expect((await response.json()).status).toBe(status);
  }
});

it("bounds bodies and keeps snapshot conflicts and infrastructure failures explicit without leaking details", async () => {
  expect((await POST(request({raw:"x".repeat(524289)}))).status).toBe(400);
  expect((await POST(request({raw:"{"}))).status).toBe(400);
  expect(receiveAutomaticTransfer).not.toHaveBeenCalled();
  vi.mocked(receiveAutomaticTransfer).mockRejectedValueOnce(new TransferConflict("snapshot_conflict"));
  expect((await POST(request())).status).toBe(409);
  vi.mocked(receiveAutomaticTransfer).mockRejectedValueOnce(new Error("private DB detail"));
  const unavailable = await POST(request()); expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain("private DB");
});
