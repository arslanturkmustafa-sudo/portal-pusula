import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractCustomerInactiveError,
  ContractPeriodConflictError,
  ContractResourceNotFoundError,
  createContractInputSchema,
  createCustomerContract,
  listCustomerContracts,
} from "@/features/contracts";
import { isAdminAuthenticated } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import { PlatformInputError } from "@/platform/validation/canonical-identifiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ContractRouteContext = Readonly<{
  params: Promise<{ id: string }>;
}>;

function json(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  return response;
}

function databasePool() {
  return getPlatformDatabasePool(getDatabaseProbeEnvironment());
}

function bodyIsTooLarge(request: NextRequest): boolean {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  return !Number.isFinite(declaredLength) || declaredLength > 16_384;
}

export async function GET(
  request: NextRequest,
  context: ContractRouteContext,
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }

  try {
    const { id } = await context.params;
    const contracts = await listCustomerContracts(databasePool(), id);
    return json({ contracts });
  } catch (error) {
    if (error instanceof PlatformInputError) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof ContractResourceNotFoundError) {
      return json({ status: "resource_not_found" }, 404);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}

export async function POST(
  request: NextRequest,
  context: ContractRouteContext,
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated(request))) {
    return json({ status: "unauthorized" }, 401);
  }
  if (bodyIsTooLarge(request)) {
    return json({ status: "validation_error" }, 400);
  }

  try {
    const { id } = await context.params;
    const input = createContractInputSchema.parse(await request.json());
    const contract = await createCustomerContract(databasePool(), id, input, {
      correlationId: correlationIdFromHeaders(request.headers),
    });
    return json({ contract }, 201);
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      error instanceof PlatformInputError
    ) {
      return json({ status: "validation_error" }, 400);
    }
    if (error instanceof ContractResourceNotFoundError) {
      return json({ status: "resource_not_found" }, 404);
    }
    if (error instanceof ContractCustomerInactiveError) {
      return json({ status: "customer_inactive" }, 409);
    }
    if (error instanceof ContractPeriodConflictError) {
      return json({ status: "contract_period_conflict" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
