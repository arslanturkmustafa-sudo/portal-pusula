import {
  getDatabaseProbeEnvironment,
  getReadinessBearerToken,
} from "@/platform/config/readiness-env";
import { probeMySqlReadiness } from "@/platform/database/mysql-readiness";
import { createConfiguredReadinessHandler } from "@/platform/health/configured-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createConfiguredReadinessHandler({
  getBearerToken: getReadinessBearerToken,
  getDatabaseEnvironment: getDatabaseProbeEnvironment,
  probeDatabase: probeMySqlReadiness,
});
