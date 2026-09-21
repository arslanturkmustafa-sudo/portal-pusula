import "server-only";
import { createHash } from "node:crypto";
import { envelopeSchema, type Envelope, type Program, type Step } from "./contract";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const analysisKey = (envelope: Envelope) => digest(["bypusula", envelope.instanceId, envelope.accountId, envelope.analysis.id]);
export const taskSourceKey = (envelope: Envelope, program: Program, step: Step) => digest([analysisKey(envelope), program.code, step.code]);

export function canonicalEnvelope(raw: unknown) {
  const envelope = envelopeSchema.parse(raw);
  envelope.programs.sort((a, b) => a.order - b.order);
  for (const program of envelope.programs) program.steps.sort((a, b) => a.sequence - b.sequence);
  return { envelope, digest: digest(envelope) };
}

export function taskDescription(envelope: Envelope, program: Program, step: Step): string {
  return `${step.description}\n\nByPusula · ${envelope.company.name}\nAnaliz #${envelope.analysis.id} · ${envelope.company.externalId}\n${program.code} — ${program.title}\nAşama ${program.phase} · Program sırası ${program.order} · Adım ${step.sequence}\nÖnerilen öncelik: ${step.priority}\nKaynak: ${envelope.analysis.url}`;
}
