import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { authenticateCurrentPrincipal } from "@/platform/auth/server-auth";
import { safePortalReturnPath } from "@/platform/navigation/portal-return-path";

import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Giriş · Portal Pusula",
  description: "Portal Pusula yetkili kullanıcı girişi.",
};

type LoginPageProps = Readonly<{
  searchParams: Promise<{ hata?: string; next?: string }>;
}>;

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { hata, next } = await searchParams;
  const returnPath = safePortalReturnPath(next);

  if (await authenticateCurrentPrincipal()) {
    redirect(returnPath);
  }

  return (
    <main className={styles.page}>
      <section className={styles.sheet} aria-labelledby="login-title">
        <header className={styles.header}>
          <span className={styles.mark} aria-hidden="true">PP</span>
          <div>
            <p>Portal Pusula</p>
            <h1 id="login-title">Çalışma alanına giriş</h1>
          </div>
        </header>

        <p className={styles.description}>
          Müşteri, planlama ve finans kayıtları yalnız yetkili kullanıcılar tarafından görüntülenir.
        </p>

        <form className={styles.form} action="/api/auth/login" method="post">
          <input name="next" type="hidden" value={returnPath} />
          <label>
            <span>E-posta</span>
            <input
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            <span>Parola</span>
            <input
              autoComplete="current-password"
              maxLength={256}
              name="password"
              required
              type="password"
            />
          </label>

          {hata === "1" ? (
            <p className={styles.error} role="alert">
              Giriş bilgileri doğrulanamadı. Bilgileri kontrol edip yeniden deneyin.
            </p>
          ) : null}

          <button type="submit">Giriş yap</button>
        </form>

        <footer>Portal Pusula · İç kullanım</footer>
      </section>
    </main>
  );
}
