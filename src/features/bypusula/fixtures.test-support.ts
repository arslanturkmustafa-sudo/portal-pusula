import type { Envelope } from "./contract";

// Synthetic contract fixture only; never copied from a customer record.
export const exampleEnvelope: Envelope = {
  schemaVersion: 1, source: "bypusula",
  instanceId: "11111111-1111-4111-8111-111111111111", accountId: "101",
  company: { externalId: "analysis-subject:202", name: "Örnek Firma" },
  analysis: { id: "202", url: "https://bypusula.example/panel/?mk_tab=improvements&analysis_id=202", contentVersion: "v2.0.0" },
  roadmapVersion: "2026.09.2",
  programs: [{ id: "303", code: "PRG-GOV-01", title: "Strateji ve Hedef", phase: 1, order: 1,
    steps: [1, 2, 3].map((sequence) => ({ code: `IMPLEMENTATION_ACTION_0${sequence}`, sequence, title: `Örnek adım ${sequence}`, description: "Süreç sahipleriyle kapsamı belirleyin.", priority: "normal" })),
  }],
};
