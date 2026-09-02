"use client";

import { useEffect, useState, type FormEvent } from "react";

type AccountView = Readonly<{
  email: string;
  passwordChangedAtUtc: string | null;
  passwordManagementAvailable: boolean;
  requiresCurrentPassword: boolean;
}>;

type AccountWorkspaceProps = Readonly<{
  live?: boolean;
}>;

const previewAccount: AccountView = {
  email: "yonetici@example.com",
  passwordChangedAtUtc: null,
  passwordManagementAvailable: true,
  requiresCurrentPassword: true,
};

function passwordChangedLabel(value: string | null): string {
  if (!value) return "Henüz uygulama içinden değiştirilmedi";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "Parola değişiklik tarihi kayıtlı";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long",
    timeZone: "Europe/Istanbul",
  }).format(date);
}

function redirectToLogin(): void {
  window.location.assign(new URL("/giris", window.location.origin).toString());
}

export function AccountWorkspace({ live = false }: AccountWorkspaceProps) {
  const [account, setAccount] = useState<AccountView | null>(
    live ? null : previewAccount,
  );
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    live ? "loading" : "ready",
  );
  const [saveState, setSaveState] = useState<
    "error" | "idle" | "saving" | "success"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    void fetch("/api/account", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return null;
        }
        if (!response.ok) throw new Error("Account is unavailable.");
        return (await response.json()) as { account?: AccountView };
      })
      .then((payload) => {
        if (!payload) return;
        if (!payload.account) throw new Error("Account response is invalid.");
        setAccount(payload.account);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });
    return () => controller.abort();
  }, [live]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account?.passwordManagementAvailable || !live) return;

    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaveState("saving");
    setErrorMessage("");

    try {
      const currentPassword = fields.get("currentPassword");
      const response = await fetch("/api/account/password", {
        body: JSON.stringify({
          confirmation: fields.get("confirmation"),
          ...(account.requiresCurrentPassword
            ? { currentPassword }
            : {}),
          newPassword: fields.get("newPassword"),
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        account?: AccountView;
        status?: string;
      };
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok || !payload.account) {
        if (payload.status === "current_password_invalid") {
          setErrorMessage("Mevcut parola doğrulanamadı.");
        } else if (payload.status === "validation_error") {
          setErrorMessage(
            "Yeni parola 8-256 karakter olmalı ve parola tekrarı eşleşmelidir.",
          );
        } else if (payload.status === "forbidden") {
          setErrorMessage(
            "Güvenlik doğrulaması tamamlanamadı. Sayfayı yenileyip tekrar deneyin.",
          );
        } else if (payload.status === "not_available") {
          setErrorMessage(
            "Bu kurulumda uygulama içinden parola değiştirme kullanılamıyor.",
          );
        } else if (payload.status === "service_unavailable") {
          setErrorMessage(
            "Parola servisine şu anda ulaşılamadı. Birkaç saniye sonra yeniden deneyin.",
          );
        } else {
          setErrorMessage("Parola değiştirilemedi. Lütfen yeniden deneyin.");
        }
        setSaveState("error");
        return;
      }

      setAccount({ ...payload.account, passwordManagementAvailable: true });
      setSaveState("success");
      form.reset();
    } catch {
      setErrorMessage("Parola değiştirilemedi. Bağlantıyı kontrol edin.");
      setSaveState("error");
    }
  }

  return (
    <section
      className="account-workspace"
      id="hesabim"
      aria-labelledby="account-workspace-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">Hesap ve güvenlik</p>
          <h2 id="account-workspace-title">Hesabım</h2>
        </div>
      </div>

      {loadState === "loading" ? (
        <p className="account-workspace-note" role="status">
          Hesap bilgileri yükleniyor…
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="entry-error" role="alert">
          Hesap bilgilerine ulaşılamadı. Sayfayı yenileyip yeniden deneyin.
        </p>
      ) : null}

      {account ? (
        <div className="account-workspace-grid">
          <div className="account-identity">
            <span>Giriş e-postası</span>
            <strong>{account.email}</strong>
            <small>
              Son parola değişikliği: {passwordChangedLabel(account.passwordChangedAtUtc)}
            </small>
          </div>

          <form className="account-password-form" onSubmit={submitPassword}>
            {account.requiresCurrentPassword ? (
              <label>
                <span>Mevcut parola</span>
                <input
                  autoComplete="current-password"
                  maxLength={256}
                  minLength={1}
                  name="currentPassword"
                  required
                  type="password"
                />
              </label>
            ) : (
              <p className="account-workspace-note">
                Mevcut oturumunuz doğrulandı. İlk uygulama parolanızı belirleyin.
              </p>
            )}
            <label>
              <span>Yeni parola</span>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={8}
                name="newPassword"
                required
                type="password"
              />
            </label>
            <label>
              <span>Yeni parola tekrarı</span>
              <input
                autoComplete="new-password"
                maxLength={256}
                minLength={8}
                name="confirmation"
                required
                type="password"
              />
            </label>
            <p className="account-password-hint">En az 8 karakter kullanın.</p>
            <div className="entry-actions">
              <button
                className="primary-action"
                disabled={
                  saveState === "saving" ||
                  !account.passwordManagementAvailable ||
                  !live
                }
                type="submit"
              >
                {saveState === "saving" ? "Değiştiriliyor…" : "Parolayı değiştir"}
              </button>
            </div>
            {saveState === "error" ? (
              <p className="entry-error" role="alert">{errorMessage}</p>
            ) : null}
            {saveState === "success" ? (
              <p className="account-workspace-success" role="status">
                Parolanız değiştirildi ve yeni güvenli oturumunuz oluşturuldu.
              </p>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}
