import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { envelopeSchema, MAX_TRANSFER_BYTES } from "@/features/bypusula/contract";
import { getSyncConfiguration, validSyncHeaders, validSyncSignature } from "@/features/bypusula/sync-auth";
import { receiveAutomaticTransfer, SyncAccessDenied } from "@/features/bypusula/sync-service";
import { TransferConflict } from "@/features/bypusula/service";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { readBoundedRequestText, isJsonWriteRequest } from "@/platform/http/write-request";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });

export async function POST(request: NextRequest) {
  const configuration = getSyncConfiguration();
  if (!configuration || !validSyncHeaders(request, configuration)) return json({ status: "not_found" }, 404);
  if (!isJsonWriteRequest(request)) return json({ status: "invalid_request" }, 415);
  try {
    const body = await readBoundedRequestText(request, MAX_TRANSFER_BYTES);
    if (!validSyncSignature(request, configuration, body)) return json({ status: "not_found" }, 404);
    const envelope = envelopeSchema.parse(JSON.parse(body));
    if (envelope.instanceId !== configuration.instanceId || envelope.accountId !== configuration.accountId) return json({ status: "not_found" }, 404);
    const pool = getPlatformDatabasePool(getDatabaseProbeEnvironment());
    const result = await receiveAutomaticTransfer(pool, envelope, configuration, `bypusula:${randomUUID()}`);
    return json(result, result.status === "synced" ? 200 : 202);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return json({ status: "invalid_request" }, 400);
    if (error instanceof SyncAccessDenied) return json({ status: "not_found" }, 404);
    if (error instanceof TransferConflict && error.code === "snapshot_conflict") return json({ status: "snapshot_conflict" }, 409);
    return json({ status: "unavailable" }, 503);
  }
}
