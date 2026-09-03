import { z } from "zod";

const MONTH_PATTERN = /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/u;

export const projectFinanceReportFilterSchema = z
  .object({
    month: z.string().regex(MONTH_PATTERN, "Geçerli bir rapor dönemi seçin."),
  })
  .strict();

export type ProjectFinanceReportFilter = z.infer<
  typeof projectFinanceReportFilterSchema
>;
