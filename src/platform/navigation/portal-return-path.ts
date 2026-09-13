const DEFAULT_PORTAL_PATH = "/";

const PORTAL_ROUTE_ROOTS = [
  "/gunum",
  "/musteriler",
  "/gunluk-plan",
  "/gorevler",
  "/finans",
  "/projeler",
  "/ayarlar",
  "/hesabim",
  "/kullanicilar",
] as const;

function isPortalPath(pathname: string): boolean {
  return pathname === "/" || PORTAL_ROUTE_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

export function safePortalReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return DEFAULT_PORTAL_PATH;
  }

  try {
    const base = new URL("https://portal-pusula.invalid");
    const candidate = new URL(value, base);
    if (
      candidate.origin !== base.origin ||
      candidate.username !== "" ||
      candidate.password !== "" ||
      candidate.hash !== "" ||
      !isPortalPath(candidate.pathname)
    ) {
      return DEFAULT_PORTAL_PATH;
    }
    return `${candidate.pathname}${candidate.search}`;
  } catch {
    return DEFAULT_PORTAL_PATH;
  }
}

export function currentPortalReturnPath(): string {
  if (typeof window === "undefined") return DEFAULT_PORTAL_PATH;
  return safePortalReturnPath(`${window.location.pathname}${window.location.search}`);
}

export function redirectToPortalLogin(): void {
  if (typeof window === "undefined") return;
  const loginUrl = new URL("/giris", window.location.origin);
  loginUrl.searchParams.set("next", currentPortalReturnPath());
  window.location.assign(loginUrl.toString());
}
