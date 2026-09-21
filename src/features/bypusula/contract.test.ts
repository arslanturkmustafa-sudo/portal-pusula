import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { envelopeSchema, resolveMapping, type Candidate } from "./contract";
import { analysisKey, canonicalEnvelope, taskDescription, taskSourceKey } from "./identity";
import { exampleEnvelope } from "./fixtures.test-support";

describe("ByPusula v1 contract", () => {
  it("rejects unknown versions/financial fields, duplicate steps and unsafe or mismatched links", () => {
    const source = structuredClone(exampleEnvelope);
    for (const invalid of [
      { ...source, schemaVersion: 2 }, { ...source, revenue: 500 },
      { ...source, company: { ...source.company, externalId: source.accountId } },
      { ...source, analysis: { ...source.analysis, url: "javascript:alert(1)" } },
      { ...source, analysis: { ...source.analysis, url: `${source.analysis.url}&token=secret` } },
      { ...source, analysis: { ...source.analysis, url: `${source.analysis.url}&analysis_id=999` } },
      { ...source, analysis: { ...source.analysis, url: source.analysis.url.replace("202", "999") } },
      { ...source, programs: [{ ...source.programs[0], steps: [source.programs[0].steps[0], source.programs[0].steps[0]] }] },
    ]) expect(envelopeSchema.safeParse(invalid).success).toBe(false);
  });

  it("uses source scope and immutable codes, never text or ordering, for task identity", () => {
    const source = structuredClone(exampleEnvelope);
    const program = source.programs[0]; const step = program.steps[0];
    const key = taskSourceKey(source, program, step);
    expect(taskSourceKey(source, { ...program, title: "Yeni başlık" }, { ...step, description: "Yeni açıklama" })).toBe(key);
    expect(taskSourceKey({ ...source, accountId: "102" }, program, step)).not.toBe(key);
    expect(analysisKey({ ...source, instanceId: "22222222-2222-4222-8222-222222222222" })).not.toBe(analysisKey(source));
    expect(taskSourceKey(source, program, program.steps[1])).not.toBe(key);
    const shuffled = structuredClone(source); shuffled.programs[0].steps.reverse();
    expect(canonicalEnvelope(shuffled).digest).toBe(canonicalEnvelope(source).digest);
    expect(taskDescription(source, program, step)).toContain(source.analysis.url);
  });

  it("only reuses a confirmed active exact mapping, even with one name match", () => {
    const candidate: Candidate = { customerId: "c1", projectId: "p1", customerName: exampleEnvelope.company.name, customerCode: "C", projectName: "P", projectCode: "P" };
    expect(resolveMapping(null, [candidate]).status).toBe("pending_mapping");
    expect(resolveMapping(candidate, [candidate]).status).toBe("matched");
    expect(resolveMapping(candidate, [{ ...candidate, projectId: "p2" }]).status).toBe("pending_mapping");
    expect(resolveMapping(candidate, []).status).toBe("pending_mapping");
  });
});
