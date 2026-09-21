import { z } from "zod";

export const MAX_TRANSFER_BYTES = 524_288;
export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const sourceId = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const text = (max: number) => z.string().trim().min(1).max(max);

// Links are navigation only: never fetched by the server. No credentials,
// nonce, download token, fragment or arbitrary query parameters are accepted.
const sourceUrl = z.string().max(800).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
      new Set(url.searchParams.keys()).size === [...url.searchParams].length &&
      [...url.searchParams].every(([key, item]) =>
        key === "mk_tab" ? ["report", "improvements"].includes(item) :
          key === "analysis_id" && /^[1-9][0-9]*$/u.test(item));
  } catch { return false; }
}, "Kaynak bağlantısı geçersiz.");

export const stepSchema = z.object({
  code: z.string().regex(/^IMPLEMENTATION_ACTION_[0-9]{2,3}$/u),
  sequence: z.number().int().min(1).max(100),
  title: text(191),
  description: text(2500),
  priority: z.enum(["low", "normal", "high", "urgent"]),
}).strict().refine((step) => step.code === `IMPLEMENTATION_ACTION_${String(step.sequence).padStart(2, "0")}`);

export const programSchema = z.object({
  id: sourceId,
  code: z.string().regex(/^PRG-[A-Z]{2,5}-[0-9]{2}$/u),
  title: text(191),
  phase: z.number().int().min(1).max(5),
  order: z.number().int().min(1).max(43),
  steps: z.array(stepSchema).min(1).max(100),
}).strict();

export const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("bypusula"),
  instanceId: uuidSchema,
  accountId: sourceId,
  // Product v0.17 has a free-text subject company, not an enterprise company ID.
  // Never substitute accountId or a normalized company name for this identity.
  company: z.object({ externalId: text(40), name: text(191) }).strict(),
  analysis: z.object({ id: sourceId, url: sourceUrl, contentVersion: text(80) }).strict(),
  roadmapVersion: text(40),
  programs: z.array(programSchema).min(1).max(43),
}).strict().superRefine((value, context) => {
  const issue = () => context.addIssue({ code: "custom", message: "Kaynak kimliği veya adım listesi tutarsız." });
  if (value.company.externalId !== `analysis-subject:${value.analysis.id}`) issue();
  try {
    const url = new URL(value.analysis.url);
    if (url.searchParams.get("analysis_id") !== value.analysis.id || !["report", "improvements"].includes(url.searchParams.get("mk_tab") ?? "")) issue();
  } catch { issue(); }
  if (new Set(value.programs.map((p) => p.code)).size !== value.programs.length ||
      new Set(value.programs.map((p) => p.id)).size !== value.programs.length ||
      new Set(value.programs.map((p) => p.order)).size !== value.programs.length) issue();
  if (value.programs.reduce((total, p) => total + p.steps.length, 0) > 500) issue();
  for (const program of value.programs) {
    const sequences = program.steps.map((step) => step.sequence).sort((a, b) => a - b);
    if (sequences.some((sequence, index) => sequence !== index + 1)) issue();
  }
});

export type Envelope = z.infer<typeof envelopeSchema>;
export type Program = Envelope["programs"][number];
export type Step = Program["steps"][number];
export const stepKey = (program: Program, step: Step) => `${program.code}/${step.code}`;
export const importSchema = z.object({
  action: z.literal("import"),
  id: uuidSchema,
  digest: hash,
  customerId: uuidSchema,
  projectId: uuidSchema,
  selected: z.array(z.string().regex(/^PRG-[A-Z]{2,5}-[0-9]{2}\/IMPLEMENTATION_ACTION_[0-9]{2,3}$/u)).min(1).max(25),
}).strict().refine((input) => new Set(input.selected).size === input.selected.length);
export type ImportInput = z.infer<typeof importSchema>;
export const approveSyncSchema = z.object({
  action: z.literal("approve_sync"), id: uuidSchema, digest: hash,
  customerId: uuidSchema, projectId: uuidSchema,
}).strict();

export const commandSchema = z.union([
  z.object({ action: z.literal("preview"), envelope: envelopeSchema }).strict(),
  z.object({ action: z.literal("open"), id: uuidSchema }).strict(),
  importSchema,
  approveSyncSchema,
]);

export type Mapping = { customerId: string; projectId: string };
export type Candidate = Mapping & { customerName: string; customerCode: string; projectName: string; projectCode: string };
export function resolveMapping(saved: Mapping | null, candidates: readonly Candidate[]) {
  return saved && candidates.some((candidate) => candidate.customerId === saved.customerId && candidate.projectId === saved.projectId)
    ? { status: "matched" as const, mapping: saved }
    : { status: "pending_mapping" as const, mapping: null };
}

export type Preview = {
  id: string;
  digest: string;
  envelope: Envelope;
  status: "matched" | "pending_mapping";
  mapping: Mapping | null;
  candidates: Candidate[];
  imported: { key: string; taskId: string }[];
  automation: { requested: boolean; approved: boolean; lastReceivedAtUtc: string | null };
};
export type InboxItem = { id: string; companyName: string; analysisId: string; mapped: boolean; automatic: boolean; approved: boolean };
export type ImportResult = { key: string; status: "created" | "existing" | "failed"; taskId?: string; error?: "retryable" | "mapping_changed" };
