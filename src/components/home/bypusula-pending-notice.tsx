"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InboxItem } from "@/features/bypusula/contract";
import actions from "./workspace-actions.module.css";

export function BypusulaPendingNotice({ enabled = true }: { enabled?: boolean }) {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/integrations/bypusula", { cache: "no-store" });
        if (!response.ok) return;
        const data: { inbox: InboxItem[] } = await response.json();
        if (active) setPending(data.inbox.filter(item => item.automatic && !item.approved).length);
      } catch { /* The normal task board remains available during sync downtime. */ }
    }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [enabled]);
  return <Link className={actions.secondary} href="/gorevler/bypusula" aria-label={pending ? `ByPusula: ${pending} analiz için proje seçin` : "ByPusula entegrasyonu"}>
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M3 6h13m-4-4 4 4-4 4M17 14H4m4-4-4 4 4 4" /></svg>
    ByPusula aktarımı{pending > 0 && <span className={actions.badge} aria-live="polite">{pending}</span>}
  </Link>;
}
