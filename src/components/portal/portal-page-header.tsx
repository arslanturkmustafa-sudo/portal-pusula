function istanbulTodayLabel(): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul",
    weekday: "long",
  }).format(new Date());
}

type PortalPageHeaderProps = Readonly<{
  actions?: React.ReactNode;
  context: string;
  note: string;
  title: string;
}>;

export function PortalPageHeader({
  actions,
  context,
  note,
  title,
}: PortalPageHeaderProps) {
  return (
    <header className="workbench-header">
      <div>
        <p className="eyebrow" suppressHydrationWarning>
          {istanbulTodayLabel()} · {context}
        </p>
        <h1>{title}</h1>
        <p className="header-note">{note}</p>
      </div>
      <div className="header-actions">
        <form action="/api/auth/logout" method="post">
          <button className="text-action" type="submit">Çıkış</button>
        </form>
        {actions}
      </div>
    </header>
  );
}
