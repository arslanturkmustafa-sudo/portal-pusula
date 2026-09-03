import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  installmentListFilterSchema,
  listCardInstallments,
} from "@/features/finance";
import {
  spendingDatabasePool,
  spendingJson,
  uniqueQuery,
} from "@/features/finance/spending-route-support";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS = new Set(["cardId", "month"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await authenticateAdminRequest(request))) {
    return spendingJson({ status: "unauthorized" }, 401);
  }
  try {
    const filters = installmentListFilterSchema.parse(uniqueQuery(request, FILTERS));
    return spendingJson(
      await listCardInstallments(spendingDatabasePool(), filters),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
