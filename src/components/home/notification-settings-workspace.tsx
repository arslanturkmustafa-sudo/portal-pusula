"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { PortalPageHeader } from "@/components/portal/portal-page-header";
import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

import styles from "./notification-settings-workspace.module.css";

type NotificationSettings = Readonly<{
  recipientEmail: string;
  usesAccountEmail: boolean;
}>;

type RequestState = "error" | "loading" | "ready" | "saved" | "saving";

class SettingsRequestError extends Error {
  constructor(readonly status: number) {
    super(`Notification settings request failed with status ${status}.`);
  }
}

function readSettings(payload: unknown): NotificationSettings | null {
  if (!payload || typeof payload !== "object" || !("settings" in payload)) return null;
  const settings = payload.settings;
  if (
    !settings ||
    typeof settings !== "object" ||
    !("recipientEmail" in settings) ||
    typeof settings.recipientEmail !== "string" ||
    !("usesAccountEmail" in settings) ||
    typeof settings.usesAccountEmail !== "boolean"
  ) {
    return null;
  }
  return {
    recipientEmail: settings.recipientEmail,
    usesAccountEmail: settings.usesAccountEmail,
  };
}

function saveErrorMessage(status: number): string {
  if (status === 400) return "Geçerli bir e-posta adresi girin.";
  if (status === 403) return "Bildirim ayarlarını değiştirme yetkiniz yok.";
  if (status === 409) {
    return "Ayar başka bir işlemle değişti. Sayfayı yenileyip tekrar deneyin.";
  }
  if (status === 503) {
    return "Bildirim ayarları şu anda kaydedilemiyor. Kısa bir süre sonra tekrar deneyin.";
  }
  return "Bildirim adresi kaydedilemedi. Lütfen tekrar deneyin.";
}

export function NotificationSettingsWorkspace() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/settings/notifications", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToPortalLogin();
          return null;
        }
        if (!response.ok) throw new SettingsRequestError(response.status);
        const nextSettings = readSettings(await response.json());
        if (!nextSettings) throw new SettingsRequestError(500);
        return nextSettings;
      })
      .then((nextSettings) => {
        if (!nextSettings) return;
        setSettings(nextSettings);
        setRecipientEmail(nextSettings.recipientEmail);
        setRequestState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const status = error instanceof SettingsRequestError ? error.status : 0;
        setErrorMessage(
          status === 403
            ? "Bildirim ayarlarını görüntüleme yetkiniz yok."
            : "Bildirim ayarlarına şu anda ulaşılamıyor.",
        );
        setRequestState("error");
      });

    return () => controller.abort();
  }, [reloadKey]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = recipientEmail.trim();
    if (!normalizedEmail) {
      setErrorMessage("Geçerli bir e-posta adresi girin.");
      setRequestState("error");
      return;
    }

    setRequestState("saving");
    setErrorMessage("");
    try {
      const response = await fetch("/api/settings/notifications", {
        body: JSON.stringify({ recipientEmail: normalizedEmail }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) {
        redirectToPortalLogin();
        return;
      }
      if (!response.ok) throw new SettingsRequestError(response.status);
      const nextSettings = readSettings(await response.json());
      if (!nextSettings) throw new SettingsRequestError(500);

      setSettings(nextSettings);
      setRecipientEmail(nextSettings.recipientEmail);
      setRequestState("saved");
    } catch (error: unknown) {
      const status = error instanceof SettingsRequestError ? error.status : 0;
      setErrorMessage(saveErrorMessage(status));
      setRequestState("error");
    }
  }

  const changed = settings?.recipientEmail !== recipientEmail.trim();

  return (
    <>
      <PortalPageHeader
        context="Uygulama yönetimi"
        note="Portal davranışlarını tek bir merkezden yönetin. Yeni ayar alanları ihtiyaç oldukça buraya eklenecek."
        title="Ayarlar"
      />

      <div className={styles.workspace}>
        <aside className={styles.categories} aria-label="Ayar kategorileri">
          <p>Ayar kategorileri</p>
          <Link aria-current="page" className={styles.activeCategory} href="/ayarlar">
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h16M4 18h16" />
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="8" cy="18" r="2" />
            </svg>
            <span>
              <strong>Bildirimler</strong>
              <small>E-posta teslimatı</small>
            </span>
          </Link>
        </aside>

        <section className={styles.panel} aria-labelledby="notification-settings-title">
          <header className={styles.panelHeader}>
            <div className={styles.mailIcon} aria-hidden="true">
              <svg fill="none" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m4 7 8 6 8-6" />
              </svg>
            </div>
            <div>
              <p>Bildirim kanalı</p>
              <h2 id="notification-settings-title">E-posta bildirimleri</h2>
              <span>
                Günlük iş özetleri ve yeni gider kayıtları belirlediğiniz adrese gönderilir.
              </span>
            </div>
          </header>

          {requestState === "loading" ? (
            <div className={styles.loading} role="status">
              <span aria-hidden="true" />
              Bildirim ayarları yükleniyor…
            </div>
          ) : null}

          {requestState === "error" && !settings ? (
            <div className={styles.loadError} role="alert">
              <p>{errorMessage}</p>
              <button
                className="text-action"
                onClick={() => {
                  setRequestState("loading");
                  setErrorMessage("");
                  setReloadKey((value) => value + 1);
                }}
                type="button"
              >
                Yeniden dene
              </button>
            </div>
          ) : null}

          {settings ? (
            <form className={styles.form} onSubmit={saveSettings}>
              <div className={styles.deliveryStatus}>
                <span className={styles.statusDot} aria-hidden="true" />
                <span>
                  <strong>E-posta teslimatı açık</strong>
                  <small>
                    {settings.usesAccountEmail
                      ? "Şu anda sahip hesabının giriş e-postası kullanılıyor."
                      : "Bildirimler için giriş hesabından bağımsız bir adres kullanılıyor."}
                  </small>
                </span>
              </div>

              <div className={styles.emailField}>
                <label htmlFor="notification-recipient-email">
                  Bildirim e-posta adresi
                </label>
                <input
                  aria-describedby="notification-email-help"
                  autoComplete="email"
                  id="notification-recipient-email"
                  maxLength={254}
                  onChange={(event) => {
                    setRecipientEmail(event.target.value);
                    if (requestState === "saved" || (requestState === "error" && settings)) {
                      setRequestState("ready");
                      setErrorMessage("");
                    }
                  }}
                  required
                  type="email"
                  value={recipientEmail}
                />
                <small id="notification-email-help">
                  Portal bildirimleri yalnız bu adrese gönderilir. Giriş e-posta adresiniz değişmez.
                </small>
              </div>

              <div className={styles.formFooter}>
                <p aria-live="polite">
                  {requestState === "saved"
                    ? "Bildirim adresi kaydedildi."
                    : requestState === "error"
                      ? errorMessage
                      : ""}
                </p>
                <button
                  className="primary-action"
                  disabled={requestState === "saving" || !changed}
                  type="submit"
                >
                  {requestState === "saving" ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </>
  );
}
