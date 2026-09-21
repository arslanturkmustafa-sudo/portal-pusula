import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { uuidSchema } from "./contract";

export const SYNC_PATH = "/api/integrations/bypusula/sync";
const configurationSchema = z.object({
  keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
  secret: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  instanceId: uuidSchema,
  accountId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  actorId: uuidSchema,
});
export type SyncConfiguration = z.infer<typeof configurationSchema>;
export function getSyncConfiguration(input: Record<string, string | undefined> = process.env): SyncConfiguration | null {
  if (input.BYPUSULA_SYNC_ENABLED !== "true") return null;
  const parsed = configurationSchema.safeParse({ keyId: input.BYPUSULA_SYNC_KEY_ID, secret: input.BYPUSULA_SYNC_SECRET,
    instanceId: input.BYPUSULA_SYNC_INSTANCE_ID, accountId: input.BYPUSULA_SYNC_ACCOUNT_ID, actorId: input.BYPUSULA_SYNC_ACTOR_ID });
  if (!parsed.success) return null;
  if ([input.SESSION_SECRET, input.CRON_BEARER_TOKEN, input.READINESS_BEARER_TOKEN].includes(parsed.data.secret)) return null;
  return parsed.data;
}

export function syncSignature(configuration: Pick<SyncConfiguration, "keyId" | "secret">, timestamp: string, deliveryId: string, body: string): string {
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return createHmac("sha256", configuration.secret).update(["POST", SYNC_PATH, configuration.keyId, timestamp, deliveryId, digest].join("\n"), "utf8").digest("hex");
}

export function validSyncHeaders(request: Request, configuration: SyncConfiguration, now = Date.now()): boolean {
  const url = new URL(request.url);
  const timestamp = request.headers.get("x-bypusula-timestamp") ?? "";
  const seconds = Number(timestamp);
  return request.method === "POST" && url.pathname === SYNC_PATH && !url.search && !url.hash &&
    !request.headers.has("cookie") && !request.headers.has("content-encoding") &&
    request.headers.get("x-bypusula-key-id") === configuration.keyId &&
    /^[1-9][0-9]{8,12}$/u.test(timestamp) && Number.isSafeInteger(seconds) && Math.abs(now / 1000 - seconds) <= 300 &&
    uuidSchema.safeParse(request.headers.get("x-bypusula-delivery-id")).success &&
    /^[0-9a-f]{64}$/u.test(request.headers.get("x-bypusula-signature") ?? "");
}

export function validSyncSignature(request: Request, configuration: SyncConfiguration, body: string): boolean {
  const supplied = request.headers.get("x-bypusula-signature") ?? "";
  if (!/^[0-9a-f]{64}$/u.test(supplied)) return false;
  const expected = syncSignature(configuration, request.headers.get("x-bypusula-timestamp") ?? "", request.headers.get("x-bypusula-delivery-id") ?? "", body);
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}
