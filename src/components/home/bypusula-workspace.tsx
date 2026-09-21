"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { stepKey, type InboxItem, type Preview } from "@/features/bypusula/contract";
import styles from "./bypusula-workspace.module.css";
import actions from "./workspace-actions.module.css";

const endpoint = "/api/integrations/bypusula";
const priorities = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };
const errors: Record<string, string> = {
  unauthorized: "Oturumunuz sona erdi. Yeniden giriş yapın.",
  forbidden: "Bu işlem için gerekli izinleriniz yok.",
  validation_error: "Aktarım bilgileri geçersiz. Listeyi yenileyin.",
  snapshot_conflict: "Analizin kaynak içeriği değişmiş. İlk alınan içerik ve mevcut görevler korundu.",
  mapping_changed: "Seçilen proje veya müşteri bağı artık aktif değil ya da eşleme daha önce kilitlenmiş. Listeyi yenileyin.",
  selection_invalid: "Bu kayıt henüz otomatik bağlantıdan alınmamış.",
  not_found: "Aktarım bulunamadı.",
};
async function request(body?: unknown) {
  const response = await fetch(endpoint, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(errors[data.status] ?? "İşlem tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin.");
  return data;
}

export function BypusulaWorkspace({ canCreateProject, canLinkCustomer }: { canCreateProject: boolean; canLinkCustomer: boolean }) {
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mappingKey, setMappingKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    request().then(async (data) => {
      if (!active) return;
      setInbox(data.inbox); setConnected(data.connected);
      const pending = (data.inbox as InboxItem[]).find(item => item.automatic && !item.approved);
      if (pending) {
        const opened = await request({ action: "open", id: pending.id });
        if (active) { setPreview(opened.preview); setMappingKey(""); }
      }
    }).catch(() => { if (active) setError("Aktarımlar yüklenemedi. Listeyi yenileyin."); });
    return () => { active = false; };
  }, []);

  function showPreview(value: Preview) {
    setPreview(value);
    setMappingKey(value.mapping ? `${value.mapping.customerId}:${value.mapping.projectId}` : "");
  }
  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "İşlem tamamlanamadı."); }
    finally { setBusy(false); }
  }
  async function refresh() {
    const data = await request(); setInbox(data.inbox); setConnected(data.connected);
    if (preview) showPreview((await request({ action: "open", id: preview.id })).preview);
  }
  async function approve() {
    const candidate = preview?.candidates.find(item => `${item.customerId}:${item.projectId}` === mappingKey);
    if (!preview || !candidate) return;
    await perform(async () => {
      const data = await request({ action: "approve_sync", id: preview.id, digest: preview.digest,
        customerId: candidate.customerId, projectId: candidate.projectId });
      showPreview(data.preview);
      setInbox((await request()).inbox);
      setMessage(data.sync?.status === "synced" ? "Aktarım tamamlandı. Görevler seçtiğiniz projeye eklendi." : "Proje seçiminiz kaydedildi. Kalan adımlar otomatik aktarılacak; bu sayfayı kapatabilirsiniz.");
    });
  }

  const imported = new Set(preview?.imported.map(item => item.key) ?? []);
  const total = preview?.envelope.programs.reduce((count, program) => count + program.steps.length, 0) ?? 0;
  const pendingCount = inbox.filter(item => item.automatic && !item.approved).length;
  const locked = Boolean(preview?.automation.approved) || imported.size > 0;

  return <div className={styles.workspace}>
    <PortalPageHeader context="Otomatik görev aktarımı" title="ByPusula entegrasyonu" note="Analizler ByPusula’dan otomatik gelir. Eşleşme yoksa aktif projeyi seçip aktarımı onaylayın." actions={<Link className={actions.secondary} href="/gorevler"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="5" height="14" rx="1" /><rect x="12" y="3" width="5" height="9" rx="1" /></svg>Görev panosu</Link>} />
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p role="status" aria-live="polite">{message || (busy ? "İşlem sürüyor…" : "")}</p>
    <section className={styles.panel} aria-labelledby="transfer-inbox-title">
      <div className={styles.row}><h2 id="transfer-inbox-title">{pendingCount ? `${pendingCount} analiz için proje seçimi bekleniyor` : "ByPusula’dan gelen analizler"}</h2><button className={actions.secondary} type="button" disabled={busy} onClick={() => void perform(refresh)}><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M16 7a6.5 6.5 0 1 0 .2 5M16 3v4h-4" /></svg>Listeyi yenile</button></div>
      {!connected && <p>Otomatik bağlantının kurulumu bekleniyor. Bağlantı açıldığında tamamlanmış analizler bu listede görünecek.</p>}
      {!inbox.length ? <p>Henüz analiz gelmedi.</p> : <ul className={styles.inbox}>{inbox.map(item => <li key={item.id}>
        <button className={styles.analysisButton} aria-pressed={preview?.id === item.id} type="button" disabled={busy} onClick={() => void perform(async () => { showPreview((await request({ action: "open", id: item.id })).preview); })}>
          <span><strong>{item.companyName} · Analiz #{item.analysisId}</strong><small>{!item.automatic ? "Önceki aktarım kaydı" : item.approved ? "Proje seçildi · Otomatik aktarım" : "Proje seçmeniz gerekiyor"}</small></span><span className={styles.arrow} aria-hidden="true">›</span>
        </button>
      </li>)}</ul>}
    </section>
    {preview && <>
      <section className={styles.panel} aria-labelledby="transfer-mapping-title">
        <h2 id="transfer-mapping-title">{preview.envelope.company.name} · Analiz #{preview.envelope.analysis.id}</h2>
        <p>{imported.size} / {total} adım görev olarak aktarıldı.</p>
        <progress className={styles.progress} aria-label="Aktarım ilerlemesi" value={imported.size} max={total} />
        <a className={styles.sourceLink} href={preview.envelope.analysis.url} target="_blank" rel="noreferrer noopener">ByPusula kaynak analizini aç ↗</a>
        {locked ? <>
          <p>{preview.mapping ? "Proje seçiminiz kaydedildi. Kalan adımlar aynı projeye otomatik aktarılır." : "Kayıtlı proje veya müşteri bağı artık aktif değil. Devam etmek için mevcut bağı yeniden aktif hale getirin."}</p>
          {preview.mapping && <p><strong>{preview.candidates.find(item => item.customerId === preview.mapping?.customerId && item.projectId === preview.mapping?.projectId)?.projectName}</strong></p>}
        </> : <>
          <p>Bu analizin adımları hangi projeye eklensin? Firma adından otomatik eşleştirme yapılmaz.</p>
          <label className={styles.field}>Aktif proje
            <select value={mappingKey} disabled={busy || !preview.automation.requested} onChange={event => setMappingKey(event.target.value)}>
              <option value="">Aktif projeler arasından seçin</option>
              {preview.candidates.map(item => <option key={`${item.customerId}:${item.projectId}`} value={`${item.customerId}:${item.projectId}`}>{item.projectName} ({item.projectCode}) · {item.customerName}</option>)}
            </select>
          </label>
          <p>Onayladığınızda {total} uygulama adımının tümü seçtiğiniz projeye görev olarak eklenecek.</p>
          <button type="button" className={actions.primary} disabled={busy || !mappingKey || !preview.automation.requested} onClick={() => void approve()}><svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>Bu projeye aktarımı başlat</button>
          {!preview.automation.requested && <p>Bu eski kayıt, otomatik bağlantıdan doğrulandıktan sonra aktarılabilir.</p>}
        </>}
        <details className={styles.help}><summary>İlgili proje listede yok</summary>
          <p>Yalnız aktif müşterilere aktif bağla bağlı, aktif ve arşivlenmemiş projeler gösterilir. Bağı düzenledikten sonra listeyi yenileyin.</p>
          <div className={styles.row}>
            {canCreateProject && <Link href="/projeler" target="_blank" rel="noreferrer">Projeler’i aç ↗</Link>}
            {canLinkCustomer && <Link href="/musteriler" target="_blank" rel="noreferrer">Müşteri–proje bağını düzenle ↗</Link>}
          </div>
        </details>
      </section>
      <section className={styles.panel} aria-labelledby="transfer-steps-title">
        <h2 id="transfer-steps-title">Otomatik aktarılacak uygulama adımları</h2>
        <p>Her adım ayrı görev olur. Tekrar denemede mevcut görevler, durumları ve elle yaptığınız değişiklikler korunur.</p>
        {preview.envelope.programs.map(program => <details key={`${preview.id}:${program.code}`} className={styles.program}>
          <summary><span className={styles.chevron} aria-hidden="true">›</span><span><small>#{program.order} · Aşama {program.phase}</small><strong>{program.title}</strong></span><span className={styles.programCount}>{program.steps.filter(step => imported.has(stepKey(program, step))).length}/{program.steps.length}<small>aktarıldı</small></span></summary>
          <div className={styles.steps}>
          {program.steps.map(step => <div key={step.code} className={styles.step}>
            <div className={styles.check}><strong>{step.sequence}. {step.title}</strong><span>{imported.has(stepKey(program, step)) ? "Aktarıldı" : priorities[step.priority]}</span></div>
            <details><summary>Açıklamayı göster</summary><p className={styles.description}>{step.description}</p></details>
          </div>)}
          </div>
        </details>)}
      </section>
    </>}
  </div>;
}
