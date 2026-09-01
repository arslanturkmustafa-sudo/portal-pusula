import { headers } from "next/headers";

import { HomeScreen } from "@/components/home/home-screen";
import { isCurrentAdminAuthenticated } from "@/platform/auth/server-auth";
import {
  CORRELATION_ID_HEADER,
  createCorrelationId,
} from "@/platform/http/correlation-id";
import { requestLogger } from "@/platform/logging/logger";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function HomePage() {
  if (!(await isCurrentAdminAuthenticated())) {
    redirect("/giris");
  }

  const requestHeaders = await headers();
  const correlationId =
    requestHeaders.get(CORRELATION_ID_HEADER) ?? createCorrelationId();

  requestLogger(correlationId).info({
    event: "page.rendered",
    method: "GET",
    pathname: "/",
    statusCode: 200,
  });

  return <HomeScreen live />;
}
