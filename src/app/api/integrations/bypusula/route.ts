import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canTransfer } from "@/features/bypusula/access";
import { commandSchema, MAX_TRANSFER_BYTES } from "@/features/bypusula/contract";
import { approveAutomaticTransfer, importTransfer, listTransfers, openTransfer, receiveTransfer, TransferConflict } from "@/features/bypusula/service";
import { getSyncConfiguration } from "@/features/bypusula/sync-auth";
import { advanceAutomaticTransfer } from "@/features/bypusula/sync-service";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { isJsonWriteRequest, isSameOriginWriteRequest, readJsonWriteBody } from "@/platform/http/write-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pool = () => getPlatformDatabasePool(getDatabaseProbeEnvironment());
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });

export async function GET(request: NextRequest) {
  try {
    const principal = await authenticatePrincipalRequest(request);
    if (!canTransfer(principal)) return json({ status: principal ? "forbidden" : "unauthorized" }, principal ? 403 : 401);
    if ([...request.nextUrl.searchParams].length) return json({ status: "validation_error" }, 400);
    return json({ inbox: await listTransfers(pool()), connected: getSyncConfiguration() !== null });
  } catch { return json({ status: "service_unavailable" }, 503); }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticatePrincipalRequest(request);
    if (!canTransfer(principal)) return json({ status: principal ? "forbidden" : "unauthorized" }, principal ? 403 : 401);
    if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
    if (!isJsonWriteRequest(request)) return json({ status: "unsupported_media_type" }, 415);
    if ([...request.nextUrl.searchParams].length) return json({ status: "validation_error" }, 400);
    const input = commandSchema.parse(await readJsonWriteBody(request, MAX_TRANSFER_BYTES));
    const context = { actorId: principal.accountId, correlationId: correlationIdFromHeaders(request.headers) };
    if (input.action === "preview") return json({ preview: await receiveTransfer(pool(), input.envelope, context) });
    if (input.action === "open") return json({ preview: await openTransfer(pool(), input.id) });
    if (input.action === "approve_sync") {
      await approveAutomaticTransfer(pool(), input, context);
      const configuration = getSyncConfiguration();
      // Approval remains durable if dispatch cannot run now. The sender retries.
      let sync = null;
      if (configuration) {
        try { sync = await advanceAutomaticTransfer(pool(), input.id, configuration, context.correlationId); } catch { /* retry via durable sender */ }
      }
      return json({ preview: await openTransfer(pool(), input.id), sync });
    }
    return json({ results: await importTransfer(pool(), input, context) });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ status: "validation_error" }, 400);
    if (error instanceof TransferConflict) return json({ status: error.code }, error.code === "not_found" ? 404 : 409);
    // No raw SQL error, source text, credentials or financial fields are logged.
    return json({ status: "service_unavailable" }, 503);
  }
}
