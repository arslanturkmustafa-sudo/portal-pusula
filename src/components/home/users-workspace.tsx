"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { PortalPageHeader } from "@/components/portal/portal-page-header";
import type { PermissionCode } from "@/platform/auth/permissions";
import { redirectToPortalLogin } from "@/platform/navigation/portal-return-path";

import styles from "./users-workspace.module.css";

type ManagedUser = Readonly<{
  createdAtUtc: string;
  credentialVersion: number;
  displayName: string;
  email: string;
  id: string;
  permissions: readonly PermissionCode[];
  role: "member" | "owner";
  status: "active" | "disabled";
  updatedAtUtc: string;
}>;

const permissionGroups: readonly Readonly<{
  description: string;
  label: string;
  permissions: readonly Readonly<{ code: PermissionCode; label: string }>[];
}>[] = [
  {
    description: "Firma kartları, iletişim ve danışmanlık planı",
    label: "Müşteriler",
    permissions: [
      { code: "customers.read", label: "Görüntüle" },
      { code: "customers.write", label: "Düzenle" },
      { code: "customers.lifecycle", label: "Pasife al / arşivle" },
      { code: "customers.contact.read", label: "İletişim bilgileri" },
      { code: "contracts.read", label: "Sözleşme dönemleri" },
      { code: "contracts.write", label: "Sözleşme düzenle" },
      { code: "contracts.lifecycle", label: "Sözleşme kapat / arşivle" },
      { code: "visits.read", label: "Ziyaretleri görüntüle" },
      { code: "visits.write", label: "Ziyaretleri düzenle" },
    ],
  },
  {
    description: "Günlük çalışma, proje ve görev akışları",
    label: "Operasyon",
    permissions: [
      { code: "daily-plan.read", label: "Günlük plan" },
      { code: "projects.read", label: "Projeleri görüntüle" },
      { code: "projects.write", label: "Projeleri düzenle" },
      { code: "projects.lifecycle", label: "Projeleri arşivle" },
      { code: "tasks.read", label: "Görevleri görüntüle" },
      { code: "tasks.write", label: "Görevleri düzenle" },
      { code: "tasks.lifecycle", label: "Görev iptal / arşiv" },
      { code: "tasks.assign", label: "Görev ata" },
      { code: "tasks.reports.export", label: "Firma raporu / PDF" },
    ],
  },
  {
    description: "Ücret, tahsilat ve diğer hassas parasal kayıtlar",
    label: "Finans — hassas",
    permissions: [
      { code: "contracts.billing.read", label: "Sözleşme ücretlerini gör" },
      { code: "contracts.billing.write", label: "Sözleşme ücretlerini düzenle" },
      { code: "finance.receivables.read", label: "Alacakları gör" },
      { code: "finance.receivables.write", label: "Alacak/tahsilat düzenle" },
      { code: "finance.receivables.reverse", label: "Tahsilat ters kaydı" },
      { code: "finance.expenses.read", label: "Giderleri gör" },
      { code: "finance.expenses.write", label: "Giderleri düzenle" },
      { code: "finance.expenses.reverse", label: "Gider iptal / düzeltme" },
      { code: "finance.cards.read", label: "Kart planını gör" },
      { code: "finance.cards.write", label: "Kart planını düzenle" },
      { code: "finance.accounts.read", label: "Kasa ve banka hesaplarını gör" },
      { code: "finance.accounts.write", label: "Kasa ve banka hesaplarını düzenle" },
      { code: "finance.partnership.read", label: "Ortaklık hesabını gör" },
      { code: "finance.partnership.write", label: "Ortaklık hesabını düzenle" },
      { code: "finance.partnership.reverse", label: "Ortaklık ters kaydı" },
      { code: "finance.taxes.read", label: "Vergileri gör" },
      { code: "finance.taxes.write", label: "Vergileri düzenle" },
      { code: "finance.reports.read", label: "Finans raporlarını gör" },
      { code: "finance.reports.export", label: "Finans raporu dışa aktar" },
      { code: "audit.read", label: "Kayıt geçmişini gör" },
    ],
  },
] as const;

const permissionDependencies: Partial<
  Record<PermissionCode, readonly PermissionCode[]>
> = {
  "contracts.billing.read": ["contracts.read"],
  "contracts.billing.write": [
    "contracts.billing.read",
    "contracts.write",
  ],
  "contracts.read": ["customers.read"],
  "contracts.lifecycle": ["contracts.read", "contracts.write"],
  "contracts.write": ["contracts.read", "projects.read"],
  "customers.write": [
    "customers.read",
    "customers.contact.read",
    "projects.read",
  ],
  "customers.lifecycle": ["customers.read", "customers.write"],
  "finance.cards.write": ["finance.cards.read"],
  "finance.accounts.write": ["finance.accounts.read"],
  "finance.expenses.write": ["finance.expenses.read"],
  "finance.expenses.reverse": ["finance.expenses.read", "finance.expenses.write"],
  "finance.partnership.write": ["finance.partnership.read"],
  "finance.partnership.reverse": [
    "finance.partnership.read",
    "finance.partnership.write",
  ],
  "finance.receivables.write": ["finance.receivables.read"],
  "finance.receivables.reverse": [
    "finance.receivables.read",
    "finance.receivables.write",
  ],
  "finance.taxes.write": ["finance.taxes.read"],
  "finance.reports.export": ["finance.reports.read"],
  "projects.write": ["projects.read"],
  "projects.lifecycle": ["projects.read", "projects.write"],
  "tasks.assign": ["tasks.read", "tasks.write"],
  "tasks.reports.export": ["tasks.read", "customers.read"],
  "tasks.lifecycle": ["tasks.read", "tasks.write"],
  "tasks.write": ["tasks.read", "customers.read", "projects.read"],
  "visits.read": ["contracts.read"],
  "visits.write": ["visits.read"],
};

function permissionValues(form: HTMLFormElement): PermissionCode[] {
  const data = new FormData(form);
  const selected = new Set(data.getAll("permissions").map(String) as PermissionCode[]);
  const pending = [...selected];
  while (pending.length > 0) {
    const permission = pending.pop();
    if (!permission) continue;
    for (const dependency of permissionDependencies[permission] ?? []) {
      if (!selected.has(dependency)) {
        selected.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return [...selected].sort();
}

function PermissionPicker({ selected }: Readonly<{ selected?: readonly PermissionCode[] }>) {
  const initial = new Set(selected ?? []);
  return (
    <div className={styles.permissionGrid}>
      {permissionGroups.map((group) => (
        <fieldset className={styles.permissionGroup} key={group.label}>
          <legend>{group.label}</legend>
          <p>{group.description}</p>
          <div>
            {group.permissions.map((permission) => (
              <label key={permission.code}>
                <input
                  defaultChecked={initial.has(permission.code)}
                  name="permissions"
                  type="checkbox"
                  value={permission.code}
                />
                <span>{permission.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function UserAccessEditor({
  onSaved,
  user,
}: Readonly<{ onSaved: (user: ManagedUser) => void; user: ManagedUser }>) {
  const [state, setState] = useState<"idle" | "saving" | "error" | "saved">("idle");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    const form = event.currentTarget;
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        body: JSON.stringify({
          permissions: permissionValues(form),
          status: new FormData(form).get("status"),
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (response.status === 401) return redirectToPortalLogin();
      if (!response.ok) throw new Error("User access update failed.");
      const payload = (await response.json()) as { user: ManagedUser };
      onSaved(payload.user);
      setState("saved");
    } catch {
      setState("error");
    }
  }

  if (user.role === "owner") {
    return (
      <div className={styles.ownerNote}>
        Sahip hesabının tam erişimi bu ekrandan daraltılamaz.
      </div>
    );
  }

  return (
    <form className={styles.editor} onSubmit={save}>
      <label className={styles.statusField}>
        <span>Hesap durumu</span>
        <select defaultValue={user.status} name="status">
          <option value="active">Aktif</option>
          <option value="disabled">Devre dışı</option>
        </select>
      </label>
      <PermissionPicker selected={user.permissions} />
      <div className={styles.editorActions}>
        <span aria-live="polite">
          {state === "error"
            ? "Kaydedilemedi. Tekrar deneyin."
            : state === "saved"
              ? "Yetkiler kaydedildi; sonraki istekte geçerli."
              : ""}
        </span>
        <button className="primary-action" disabled={state === "saving"} type="submit">
          {state === "saving" ? "Kaydediliyor…" : "Yetkileri kaydet"}
        </button>
      </div>
    </form>
  );
}

export function UsersWorkspace() {
  const [users, setUsers] = useState<readonly ManagedUser[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [createState, setCreateState] = useState<"idle" | "saving" | "error">("idle");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/users", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToPortalLogin();
          return null;
        }
        if (!response.ok) throw new Error("Users unavailable.");
        return (await response.json()) as { users: ManagedUser[] };
      })
      .then((payload) => {
        if (!payload) return;
        setUsers(payload.users);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadState("error");
      });
    return () => controller.abort();
  }, []);

  const activeCount = useMemo(
    () => users.filter((user) => user.status === "active").length,
    [users],
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreateState("saving");
    try {
      const response = await fetch("/api/users", {
        body: JSON.stringify({
          confirmation: data.get("confirmation"),
          displayName: data.get("displayName"),
          email: data.get("email"),
          password: data.get("password"),
          permissions: permissionValues(form),
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status === 401) return redirectToPortalLogin();
      if (!response.ok) throw new Error("User create failed.");
      const payload = (await response.json()) as { user: ManagedUser };
      setUsers((current) => [...current, payload.user]);
      setCreateState("idle");
      form.reset();
      form.closest("details")?.removeAttribute("open");
    } catch {
      setCreateState("error");
    }
  }

  function replaceUser(updated: ManagedUser) {
    setUsers((current) =>
      current.map((user) => (user.id === updated.id ? updated : user)),
    );
  }

  return (
    <>
      <PortalPageHeader
        context="Ekip ve erişim"
        note="Her hesabın görebileceği modülleri belirleyin; finans yetkileri ayrıca açılır."
        title="Kullanıcılar"
      />

      <section className={styles.summary} aria-label="Kullanıcı özeti">
        <div><span>Toplam hesap</span><strong>{users.length}</strong></div>
        <div><span>Aktif</span><strong>{activeCount}</strong></div>
        <div><span>Finans erişimi</span><strong>{users.filter((user) => user.role === "owner" || user.permissions.some((permission) => permission.startsWith("finance.") || permission.startsWith("contracts.billing."))).length}</strong></div>
      </section>

      <details className={styles.createPanel}>
        <summary>Yeni ekip hesabı oluştur</summary>
        <form className={styles.createForm} onSubmit={create}>
          <div className={styles.identityFields}>
            <label><span>Ad soyad</span><input maxLength={191} name="displayName" required /></label>
            <label><span>E-posta</span><input autoComplete="email" maxLength={254} name="email" required type="email" /></label>
            <label><span>İlk parola</span><input autoComplete="new-password" minLength={12} name="password" required type="password" /></label>
            <label><span>Parola tekrarı</span><input autoComplete="new-password" minLength={12} name="confirmation" required type="password" /></label>
          </div>
          <p className={styles.securityNote}>
            Parolayı güvenli bir kanaldan iletin. Portal parolayı tekrar göstermez veya loglamaz.
          </p>
          <PermissionPicker />
          {createState === "error" ? <p className={styles.error} role="alert">Hesap oluşturulamadı. Alanları, e-posta benzersizliğini ve yetki bağımlılıklarını kontrol edin.</p> : null}
          <button className="primary-action" disabled={createState === "saving"} type="submit">
            {createState === "saving" ? "Hesap oluşturuluyor…" : "Hesabı oluştur"}
          </button>
        </form>
      </details>

      <section className={styles.list} aria-busy={loadState === "loading"}>
        {loadState === "loading" ? <p>Hesaplar yükleniyor…</p> : null}
        {loadState === "error" ? <p className={styles.error} role="alert">Hesaplar şu anda yüklenemiyor.</p> : null}
        {users.map((user) => (
          <details className={styles.userCard} key={user.id}>
            <summary>
              <span className={styles.avatar} aria-hidden="true">{user.displayName.slice(0, 2).toLocaleUpperCase("tr-TR")}</span>
              <span><strong>{user.displayName}</strong><small>{user.email}</small></span>
              <span className={user.status === "active" ? styles.active : styles.disabled}>
                {user.role === "owner" ? "Sahip" : user.status === "active" ? "Aktif" : "Kapalı"}
              </span>
            </summary>
            <UserAccessEditor onSaved={replaceUser} user={user} />
          </details>
        ))}
      </section>
    </>
  );
}
