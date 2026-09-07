"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { redirectToPortalLogin as redirectToLogin } from "@/platform/navigation/portal-return-path";

import styles from "./daily-plan-visit-completion.module.css";
import { VisitWorkItemsEditor } from "./visit-work-items-editor";

type SaveState = "idle" | "saving";

const COMPLETION_TIMEOUT_MS = 12_000;

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Istanbul",
  year: "numeric",
});

type CompletionTarget = Readonly<{
  committedOn: string;
  contractId: string;
  customerId: string;
  customerName: string;
  visitId: string;
}>;

type DailyPlanVisitCompletionProps = Readonly<{
  canWriteTasks?: boolean;
  onCompleted: (visitId: string) => void;
  target: CompletionTarget;
}>;

function monthBounds(value: string): Readonly<{ max: string; min: string }> {
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = value.slice(0, 7);
  return {
    max: `${prefix}-${String(lastDay).padStart(2, "0")}`,
    min: `${prefix}-01`,
  };
}

function completionDateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return dateFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function responseError(status: number, code?: string): string {
  if (status === 403) return "Bu ziyareti tamamlama yetkiniz bulunmuyor.";
  if (status === 404) return "Ziyaret artık bulunamıyor. Planı yenileyin.";
  if (status === 409 && code === "visit_locked") {
    return "Ziyaret daha önce sonuçlandırılmış. Planı yenileyin.";
  }
  if (status === 409 && code === "contract_closed") {
    return "Kapalı sözleşmedeki ziyaret güncellenemez.";
  }
  if (status === 409 && code === "month_outside_contract") {
    return "Gerçekleşme günü planlanan ziyaret ile aynı ayda olmalıdır.";
  }
  if (status === 400) return "Gerçekleşme bilgilerini kontrol edin.";
  return "Ziyaret şu anda tamamlanamadı. Tekrar deneyin.";
}

function trapTab(event: KeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (event.key !== "Tab" || container === null) return;
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]',
    ),
  );
  const first = elements[0];
  const last = elements.at(-1);
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function DailyPlanVisitCompletion({
  canWriteTasks = false,
  onCompleted,
  target,
}: DailyPlanVisitCompletionProps) {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [deliveredOn, setDeliveredOn] = useState(target.committedOn);
  const [note, setNote] = useState("");
  const [workItems, setWorkItems] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const bounds = monthBounds(target.committedOn);

  useEffect(() => {
    if (open) dateRef.current?.focus();
  }, [open]);

  useEffect(
    () => () => {
      requestControllerRef.current?.abort();
    },
    [],
  );

  function openDialog() {
    setDeliveredOn(target.committedOn);
    setNote("");
    setWorkItems([""]);
    setError(null);
    setSaveState("idle");
    setOpen(true);
  }

  function closeDialog() {
    if (saveState === "saving") return;
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  async function completeVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deliveredOn < bounds.min || deliveredOn > bounds.max) {
      setError("Gerçekleşme günü planlanan ziyaret ile aynı ayda olmalıdır.");
      return;
    }

    setError(null);
    setSaveState("saving");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      COMPLETION_TIMEOUT_MS,
    );
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(target.customerId)}/contracts/${encodeURIComponent(target.contractId)}/visits/${encodeURIComponent(target.visitId)}`,
        {
          body: JSON.stringify({
            deliveredOn,
            resolutionNote: note.trim() === "" ? null : note.trim(),
            resolutionStatus: "completed",
            workItems: workItems.map((item) => item.trim()).filter(Boolean),
          }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
          signal: controller.signal,
        },
      );

      if (response.status === 401) {
        setSaveState("idle");
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
        setError(responseError(response.status, payload.status));
        setSaveState("idle");
        return;
      }

      setOpen(false);
      setSaveState("idle");
      onCompleted(target.visitId);
    } catch (requestError) {
      setError(
        requestError instanceof DOMException && requestError.name === "AbortError"
          ? "İstek zaman aşımına uğradı. Pencereyi kapatıp sayfayı yenileyerek ziyaret durumunu kontrol edin."
          : responseError(503),
      );
      setSaveState("idle");
    } finally {
      window.clearTimeout(timeoutId);
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }

  return (
    <>
      <button
        aria-label={`${target.customerName}, ${completionDateLabel(target.committedOn)} ziyaretini tamamla`}
        className={styles.trigger}
        ref={triggerRef}
        type="button"
        onClick={openDialog}
      >
        <span aria-hidden="true">✓</span>
        Ziyareti tamamla
      </button>

      {open ? (
        <div className={styles.backdrop}>
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className={styles.dialog}
            ref={dialogRef}
            role="dialog"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeDialog();
              else trapTab(event, dialogRef.current);
            }}
          >
            <header className={styles.header}>
              <div>
                <p>Ziyaret sonucu</p>
                <h2 id={titleId}>{target.customerName}</h2>
              </div>
              <button
                aria-label="Tamamlama penceresini kapat"
                className={styles.close}
                disabled={saveState === "saving"}
                type="button"
                onClick={closeDialog}
              >
                ×
              </button>
            </header>

            <form onSubmit={(event) => void completeVisit(event)}>
              <p className={styles.explanation}>
                Gerçekleşme gününü doğrulayın. Kaydettikten sonra ziyaret sonucu
                müşteri çalışma alanında da tamamlandı olarak görünür.
              </p>
              <label className={styles.field}>
                <span>Gerçekleşen gün</span>
                <input
                  max={bounds.max}
                  min={bounds.min}
                  ref={dateRef}
                  required
                  type="date"
                  value={deliveredOn}
                  onChange={(event) => setDeliveredOn(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Not <small>isteğe bağlı</small></span>
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              {canWriteTasks ? (
                <VisitWorkItemsEditor
                  disabled={saveState === "saving"}
                  items={workItems}
                  onChange={setWorkItems}
                />
              ) : null}

              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}

              <footer className={styles.actions}>
                <button
                  className={styles.cancel}
                  disabled={saveState === "saving"}
                  type="button"
                  onClick={closeDialog}
                >
                  Vazgeç
                </button>
                <button
                  className={styles.submit}
                  disabled={saveState === "saving"}
                  type="submit"
                >
                  {saveState === "saving" ? "Kaydediliyor…" : "Tamamla ve kaydet"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
