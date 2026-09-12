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
import { hasPermission } from "@/platform/auth/permissions";
import { authenticateAdminRequest } from "@/platform/auth/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILTERS = new Set(["cardId", "month", "status"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const principal = await authenticateAdminRequest(request, "finance.cards.read");
  if (!principal) {
    return spendingJson({ status: "unauthorized" }, 401);
  }
  try {
    const filters = installmentListFilterSchema.parse(uniqueQuery(request, FILTERS));
    const collection = await listCardInstallments(spendingDatabasePool(), filters);
    if (hasPermission(principal, "finance.accounts.read")) {
      return spendingJson(collection);
    }
    return spendingJson({
      ...collection,
      installments: collection.installments.map((installment) => ({
        ...installment,
        financeTransactionId: null,
        paymentAccountId: null,
        paymentAccountName: null,
        paymentAccountType: null,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return spendingJson({ status: "validation_error" }, 400);
    }
    return spendingJson({ status: "service_unavailable" }, 503);
  }
}
