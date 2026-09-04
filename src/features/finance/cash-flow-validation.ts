import { z } from "zod";

const MONTH_PATTERN = /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/u;

export const cashFlowFilterSchema = z
  .object({
    month: z.string().regex(MONTH_PATTERN, "Geçerli bir nakit akışı dönemi seçin."),
  })
  .strict();

export type CashFlowFilter = z.infer<typeof cashFlowFilterSchema>;
