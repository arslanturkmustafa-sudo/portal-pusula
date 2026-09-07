import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ContractCustomerInactiveError,
  ContractPeriodConflictError,
  ContractProjectUnavailableError,
  ContractResourceNotFoundError,
  type ConsultingContract,
  createContractInputSchema,
  createCustomerContract,
  listCustomerContracts,
} from "@/features/contracts";
import { hasPermission } from "@/platform/auth/permissions";
import { authenticatePrincipalRequest } from "@/platform/auth/server-auth";
import { getDatabaseProbeEnvironment } from "@/platform/config/readiness-env";
import { getPlatformDatabasePool } from "@/platform/database/mysql-platform";
import { correlationIdFromHeaders } from "@/platform/http/correlation-id";
import {
  isJsonWriteRequest,
  isSameOriginWriteRequest,
  readJsonWriteBody,
} from "@/platform/http/write-request";
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

function presentContract(
  contract: ConsultingContract,
  includeBilling: boolean,
): ConsultingContract | Omit<
  ConsultingContract,
  "currency" | "monthlyFeeAmount" | "paymentDay" | "vatMode" | "vatRate"
> {
  if (includeBilling) return contract;
  return {
    archiveReason: contract.archiveReason,
    archivedAtUtc: contract.archivedAtUtc,
    archivedByUserAccountId: contract.archivedByUserAccountId,
    createdAtUtc: contract.createdAtUtc,
    customerId: contract.customerId,
    endsOn: contract.endsOn,
    id: contract.id,
    internalNote: contract.internalNote,
    projectId: contract.projectId,
    startsOn: contract.startsOn,
    status: contract.status,
    updatedAtUtc: contract.updatedAtUtc,
    version: contract.version,
  };
}

export async function GET(
  request: NextRequest,
  context: ContractRouteContext,
): Promise<NextResponse> {
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) {
    return json({ status: "unauthorized" }, 401);
  }
  if (!hasPermission(principal, "contracts.read")) {
    return json({ status: "forbidden" }, 403);
  }

  try {
    const { id } = await context.params;
    const contracts = await listCustomerContracts(databasePool(), id);
    const includeBilling = hasPermission(principal, "contracts.billing.read");
    return json({
      contracts: contracts.map((contract) =>
        presentContract(contract, includeBilling),
      ),
    });
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
  const principal = await authenticatePrincipalRequest(request);
  if (!principal) {
    return json({ status: "unauthorized" }, 401);
  }
  if (
    !hasPermission(principal, "contracts.write") ||
    !hasPermission(principal, "contracts.billing.write")
  ) {
    return json({ status: "forbidden" }, 403);
  }
  if (!isSameOriginWriteRequest(request)) return json({ status: "forbidden" }, 403);
  if (!isJsonWriteRequest(request)) {
    return json({ status: "unsupported_media_type" }, 415);
  }

  try {
    const { id } = await context.params;
    const input = createContractInputSchema.parse(
      await readJsonWriteBody(request, 16_384),
    );
    const contract = await createCustomerContract(databasePool(), id, input, {
      actorId: principal.kind === "account" ? principal.accountId : undefined,
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
    if (error instanceof ContractProjectUnavailableError) {
      return json({ status: "project_unavailable" }, 409);
    }
    return json({ status: "service_unavailable" }, 503);
  }
}
