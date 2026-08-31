import pino, {
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from "pino";

export const LOG_REDACTION_PATHS = [
  "authorization",
  "Authorization",
  "cookie",
  "password",
  "token",
  "bearerToken",
  "accessToken",
  "refreshToken",
  "secret",
  "gateError",
  "cronGateError",
  "databaseUrl",
  "DATABASE_URL",
  "DB_PASSWORD",
  "CRON_BEARER_TOKEN",
  "READINESS_BEARER_TOKEN",
  "dbPassword",
  "readinessBearerToken",
  "taxId",
  "amount",
  "finance",
  "customer",
  "headers.authorization",
  "headers.Authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.Authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "*.authorization",
  "*.Authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.bearerToken",
  "*.accessToken",
  "*.refreshToken",
  "*.secret",
  "*.gateError",
  "*.cronGateError",
  "*.databaseUrl",
  "*.DB_PASSWORD",
  "*.CRON_BEARER_TOKEN",
  "*.READINESS_BEARER_TOKEN",
  "*.dbPassword",
  "*.readinessBearerToken",
  "*.taxId",
  "*.amount",
  "*.*.authorization",
  "*.*.Authorization",
] as const;

function loggerOptions(level: LevelWithSilent): LoggerOptions {
  return {
    name: "portal-pusula",
    level,
    base: {
      service: "portal-pusula",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...LOG_REDACTION_PATHS],
      censor: "[REDACTED]",
    },
  };
}

export function createAppLogger(
  level: LevelWithSilent,
  destination?: DestinationStream,
): Logger {
  return destination
    ? pino(loggerOptions(level), destination)
    : pino(loggerOptions(level));
}
