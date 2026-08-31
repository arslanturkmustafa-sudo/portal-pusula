import type { DatabaseProbeEnvironment } from "@/platform/config/readiness-env.schema";
import { createReadinessHandler } from "@/platform/health/readiness";
import { hasExactBearerAuthorization } from "@/platform/security/exact-bearer";

type ConfiguredReadinessDependencies = {
  getBearerToken: () => string;
  getDatabaseEnvironment: () => DatabaseProbeEnvironment;
  probeDatabase: (environment: DatabaseProbeEnvironment) => Promise<boolean>;
};

export function createConfiguredReadinessHandler({
  getBearerToken,
  getDatabaseEnvironment,
  probeDatabase,
}: ConfiguredReadinessDependencies) {
  return createReadinessHandler({
    authorize(request) {
      try {
        return hasExactBearerAuthorization(request, getBearerToken());
      } catch {
        return false;
      }
    },
    async check() {
      try {
        return await probeDatabase(getDatabaseEnvironment());
      } catch {
        return false;
      }
    },
  });
}
