"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";

import type { DailyPlanMonthTask } from "./daily-plan-month-grid";
import styles from "./daily-plan-completed-visit-tasks.module.css";
import { VisitWorkItemsEditor } from "./visit-work-items-editor";

type NewWorkItem = Readonly<{
  id: string;
  title: string;
}>;

type CompletedVisitTarget = Readonly<{
  contractId: string;
  customerId: string;
  deliveredOn: string;
  resolutionNote: string | null;
  visitId: string;
}>;

type DailyPlanCompletedVisitTasksProps = Readonly<{
  canAppend: boolean;
  onSaved: (visitId: string) => void;
  target: CompletedVisitTarget;
  tasks: readonly DailyPlanMonthTask[];
}>;

const SAVE_TIMEOUT_MS = 12_000;

function newWorkItem(): NewWorkItem {
  return { id: crypto.randomUUID(), title: "" };
}

function saveError(status: number, code?: string): string {
  if (status === 403) return "Tamamlanan görev ekleme yetkiniz bulunmuyor.";
  if (status === 404) return "Ziyaret artık bulunamıyor. Planı yenileyin.";
  if (status === 409 && code === "work_item_identity_conflict") {
    return "Bu görev başka bir kayıtta kullanılmış. Yeni bir maddeyle tekrar deneyin.";
  }
  if (status === 400) return "Görev maddelerini kontrol edin.";
  return "Tamamlanan görevler şu anda kaydedilemedi. Tekrar deneyin.";
}

export function DailyPlanCompletedVisitTasks({
  canAppend,
  onSaved,
  target,
  tasks,
}: DailyPlanCompletedVisitTasksProps) {
  const titleId = useId();
  const requestControllerRef = useRef<AbortController | null>(null);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<readonly NewWorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(
    () => () => {
      requestControllerRef.current?.abort();
    },
    [],
  );

  function openEditor() {
    setItems([newWorkItem()]);
    setError(null);
    setEditing(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(false);
    setItems([]);
    setError(null);
  }

  async function saveItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workItems = items
      .map((item) => ({ ...item, title: item.title.trim() }))
      .filter((item) => item.title.length > 0);
    if (workItems.length === 0) {
      setError("En az bir tamamlanan görev yazın.");
      return;
    }

    setError(null);
    setSaving(true);
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);

    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(target.customerId)}/contracts/${encodeURIComponent(target.contractId)}/visits/${encodeURIComponent(target.visitId)}`,
        {
          body: JSON.stringify({
            deliveredOn: target.deliveredOn,
            resolutionNote: target.resolutionNote,
            resolutionStatus: "completed",
            workItems,
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
          signal: controller.signal,
        },
      );

      if (response.status === 401) {
        setSaving(false);
        redirectToLogin();
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        visit?: { id?: string; resolutionStatus?: string };
      };
      if (
        !response.ok ||
        payload.visit?.id !== target.visitId ||
        payload.visit.resolutionStatus !== "completed"
      ) {
        setError(saveError(response.status, payload.status));
        setSaving(false);
        return;
      }

      setEditing(false);
      setItems([]);
      setSaving(false);
      onSaved(target.visitId);
    } catch (requestError) {
      setError(
        requestError instanceof DOMException && requestError.name === "AbortError"
          ? "İstek zaman aşımına uğradı. Planı yenileyip kaydı kontrol edin."
          : saveError(503),
      );
      setSaving(false);
    } finally {
      window.clearTimeout(timeoutId);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }

  return (
    <section className={styles.root} aria-labelledby={titleId}>
      <div className={styles.heading}>
        <h4 id={titleId}>Ziyarete bağlı tamamlanan görevler</h4>
        <span>{tasks.length} kayıt</span>
      </div>

      {tasks.length > 0 ? (
        <ul className={styles.tasks}>
          {tasks.map((task) => (
            <li key={task.id}>
              <span aria-hidden="true">✓</span>
              <strong>{task.title}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Bu ziyarette kayıtlı tamamlanan görev yok.</p>
      )}

      {canAppend && !editing ? (
        <button className={styles.open} type="button" onClick={openEditor}>
          + Tamamlanan görev ekle
        </button>
      ) : null}

      {canAppend && editing ? (
        <form className={styles.form} onSubmit={(event) => void saveItems(event)}>
          <VisitWorkItemsEditor
            addLabel="+ Başka görev ekle"
            disabled={saving}
            hint="Buraya eklenen maddeler bu ziyarete tamamlanmış görev olarak bağlanır ve firma görev raporunda yer alır."
            itemKeys={items.map((item) => item.id)}
            items={items.map((item) => item.title)}
            itemLabel="Tamamlanan görev"
            legend="Yeni tamamlanan görevler"
            placeholder="Örn. Saha kontrol listesi güncellendi"
            removeItemLabel="tamamlanan görev maddesini"
            onAdd={() => setItems((current) => [...current, newWorkItem()])}
            onRemove={(index) => {
              const next = items.filter((_, itemIndex) => itemIndex !== index);
              setItems(next.length === 0 ? [newWorkItem()] : next);
            }}
            onUpdate={(index, title) =>
              setItems((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, title } : item,
                ),
              )
            }
          />

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button disabled={saving} type="button" onClick={closeEditor}>
              Vazgeç
            </button>
            <button className={styles.save} disabled={saving} type="submit">
              {saving ? "Kaydediliyor…" : "Görevleri kaydet"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
