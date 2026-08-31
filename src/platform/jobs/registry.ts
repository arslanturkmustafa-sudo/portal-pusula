import type { JobRegistry } from "./types";

/**
 * Komut 3B intentionally ships no production handlers. Unknown types fail
 * closed through the dispatcher and can only enter the bounded retry policy.
 */
export const productionJobRegistry: JobRegistry = new Map();
