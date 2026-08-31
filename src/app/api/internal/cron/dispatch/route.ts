import { configuredCronDispatchHandler } from "@/platform/cron/configured-cron-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = configuredCronDispatchHandler;
export const GET = configuredCronDispatchHandler;
export const HEAD = configuredCronDispatchHandler;
export const PUT = configuredCronDispatchHandler;
export const PATCH = configuredCronDispatchHandler;
export const DELETE = configuredCronDispatchHandler;
export const OPTIONS = configuredCronDispatchHandler;
