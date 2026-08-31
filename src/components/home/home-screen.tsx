const navigationItems = [
  { code: "01", href: "#genel-bakis", label: "Genel bakış", meta: "Bugün" },
  { code: "02", href: "#projeler", label: "Projeler", meta: "03" },
  { code: "03", href: "#gorevler", label: "Görevler", meta: "08" },
  { code: "04", href: "#takvim", label: "Takvim", meta: "02" },
  { code: "05", href: "#finans", label: "Finans", meta: "—" },
] as const;

const summaryItems = [
  { label: "Bugünün ritmi", value: "04", note: "zamanlanmış adım" },
  { label: "Açık iş", value: "08", note: "öncelik sırasına alınmış" },
  { label: "Karar bekleyen", value: "03", note: "netleştirme kuyruğunda" },
  { label: "Blokaj", value: "01", note: "bugün ele alınacak" },
] as const;

const agendaItems = [
  {
    time: "09:30",
    title: "Haftalık planı kilitle",
    context: "İç operasyon · Bugün",
    status: "Bekliyor",
    tone: "signal",
  },
  {
    time: "11:00",
    title: "Arayüz dilimini gözden geçir",
    context: "Portal Pusula · Tasarım",
    status: "İncele",
    tone: "attention",
  },
  {
    time: "14:30",
    title: "Finans kayıt akışını tanımla",
    context: "Operasyon · Veri sınırı",
    status: "Planlı",
    tone: "quiet",
  },
] as const;

const projects = [
  {
    code: "P-014",
    name: "Portal Pusula",
    focus: "Dilim 0 · Arayüz kabuğu",
    status: "Devam ediyor",
    progress: 72,
  },
  {
    code: "P-009",
    name: "Mühendis Kafası",
    focus: "İçerik ve yayın düzeni",
    status: "Sırada",
    progress: 46,
  },
  {
    code: "P-004",
    name: "Operasyon sistemi",
    focus: "Süreç standardı",
    status: "İzlemede",
    progress: 28,
  },
] as const;

const weekDays = [
  { day: "Pzt", date: "Bugün", current: true },
  { day: "Sal", date: "01", current: false },
  { day: "Çar", date: "02", current: false },
  { day: "Per", date: "03", current: false },
  { day: "Cum", date: "04", current: false },
] as const;

const financeRows = [
  { label: "Nakit akışı", value: "Veri bağlantısı bekliyor" },
  { label: "Yaklaşan yükümlülükler", value: "Takvimlenmedi" },
  { label: "Mutabakat", value: "Kaynak tanımlanmadı" },
] as const;

export function HomeScreen() {
  return (
    <>
      <a className="skip-link" href="#ana-icerik">
        Ana içeriğe geç
      </a>

      <div className="ops-shell">
        <aside className="ops-rail">
          <div className="ops-brand" aria-label="Portal Pusula">
            <span className="ops-brand-mark" aria-hidden="true">
              <span>PP</span>
            </span>
            <span className="ops-brand-copy">
              <strong>Portal Pusula</strong>
              <small>Operasyon masası</small>
            </span>
          </div>

          <div className="workspace-label" aria-label="Aktif çalışma alanı">
            <span>Çalışma alanı</span>
            <strong>Mühendis Kafası</strong>
          </div>

          <nav className="ops-nav" aria-label="Ana navigasyon">
            {navigationItems.map((item) => (
              <a
                className="ops-nav-link"
                href={item.href}
                key={item.code}
              >
                <span className="ops-nav-code" aria-hidden="true">
                  {item.code}
                </span>
                <span className="ops-nav-label">{item.label}</span>
                <span className="ops-nav-meta" aria-hidden="true">
                  {item.meta}
                </span>
              </a>
            ))}
          </nav>

          <div className="rail-status">
            <span className="status-light" aria-hidden="true" />
            <span>
              <strong>Yerel çalışma</strong>
              <small>Canlı veri bağlı değil</small>
            </span>
          </div>
        </aside>

        <main className="ops-main" id="ana-icerik" tabIndex={-1}>
          <header className="ops-header" id="genel-bakis">
            <div>
              <p className="ops-breadcrumb">Operasyon / Genel bakış</p>
              <h1>Günlük operasyon</h1>
              <p className="ops-intro">
                Bugünün işleri, yaklaşan temaslar ve karar bekleyen konular tek
                çalışma yüzeyinde.
              </p>
            </div>
            <div className="preview-boundary" role="note">
              <span>Yerel tasarım önizlemesi</span>
              <strong>Örnek içerik · gerçek iş verisi değil</strong>
            </div>
          </header>

          <section className="summary-strip" aria-label="Operasyon özeti">
            {summaryItems.map((item) => (
              <div className="summary-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.note}</small>
              </div>
            ))}
          </section>

          <div className="desk-grid">
            <section
              className="desk-section desk-section-agenda"
              id="gorevler"
              aria-labelledby="gorevler-title"
            >
              <div className="desk-section-heading">
                <div>
                  <span className="section-index">01 / Akış</span>
                  <h2 id="gorevler-title">Görevler</h2>
                </div>
                <span className="section-aside">Öncelik sırası</span>
              </div>

              <ol className="agenda-list">
                {agendaItems.map((item) => (
                  <li className="agenda-row" key={`${item.time}-${item.title}`}>
                    <time>{item.time}</time>
                    <span className="agenda-copy">
                      <strong>{item.title}</strong>
                      <small>{item.context}</small>
                    </span>
                    <span className={`row-state row-state-${item.tone}`}>
                      {item.status}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="queue-note">
                <span>Sonraki sıra</span>
                <strong>2 iş yarına taşınmaya aday</strong>
              </div>
            </section>

            <section
              className="desk-section desk-section-calendar"
              id="takvim"
              aria-labelledby="takvim-title"
            >
              <div className="desk-section-heading">
                <div>
                  <span className="section-index">02 / Zaman</span>
                  <h2 id="takvim-title">Takvim</h2>
                </div>
                <span className="section-aside">Bu hafta</span>
              </div>

              <div className="week-strip" aria-label="Beş günlük görünüm">
                {weekDays.map((item) => (
                  <div className={item.current ? "is-current" : undefined} key={item.day}>
                    <span>{item.day}</span>
                    <strong>{item.date}</strong>
                  </div>
                ))}
              </div>

              <div className="calendar-events">
                <p>
                  <time>09:30</time>
                  <span>Planlama oturumu</span>
                </p>
                <p>
                  <time>11:00</time>
                  <span>Tasarım inceleme</span>
                </p>
                <p>
                  <time>14:30</time>
                  <span>Finans kontrol penceresi</span>
                </p>
              </div>
            </section>

            <section
              className="desk-section desk-section-projects"
              id="projeler"
              aria-labelledby="projeler-title"
            >
              <div className="desk-section-heading">
                <div>
                  <span className="section-index">03 / Portföy</span>
                  <h2 id="projeler-title">Projeler</h2>
                </div>
                <span className="section-aside">3 aktif kayıt</span>
              </div>

              <div className="project-table-wrap">
                <table className="project-table">
                  <thead>
                    <tr>
                      <th scope="col">Kod</th>
                      <th scope="col">Proje / odak</th>
                      <th scope="col">Durum</th>
                      <th scope="col">İlerleme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((project) => (
                      <tr key={project.code}>
                        <td data-label="Kod">
                          <span className="project-code">{project.code}</span>
                        </td>
                        <td data-label="Proje / odak">
                          <strong>{project.name}</strong>
                          <small>{project.focus}</small>
                        </td>
                        <td data-label="Durum">{project.status}</td>
                        <td data-label="İlerleme">
                          <span className="progress-value">{project.progress}%</span>
                          <span className="progress-track" aria-hidden="true">
                            <span style={{ width: `${project.progress}%` }} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="desk-section desk-section-finance"
              id="finans"
              aria-labelledby="finans-title"
            >
              <div className="desk-section-heading">
                <div>
                  <span className="section-index">04 / Kontrol</span>
                  <h2 id="finans-title">Finans</h2>
                </div>
                <span className="section-aside">Bağlantısız</span>
              </div>

              <dl className="finance-list">
                {financeRows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="data-boundary-note">
                Finans modülü açılana kadar tutar veya müşteri verisi gösterilmez.
              </p>
            </section>

            <section className="desk-section desk-section-decisions" aria-labelledby="kararlar-title">
              <div className="desk-section-heading">
                <div>
                  <span className="section-index">05 / Karar</span>
                  <h2 id="kararlar-title">Karar kuyruğu</h2>
                </div>
                <span className="section-aside">3 başlık</span>
              </div>
              <ul className="decision-list">
                <li>
                  <span>Ana navigasyon isimleri</span>
                  <strong>Karar bekliyor</strong>
                </li>
                <li>
                  <span>Takvim varsayılan görünümü</span>
                  <strong>Taslak</strong>
                </li>
                <li>
                  <span>Finans veri kaynağı</span>
                  <strong>Bağlantı yok</strong>
                </li>
              </ul>
            </section>
          </div>

          <footer className="ops-footer">
            <span>Portal Pusula · Operasyon masası</span>
            <span>Yerel arayüz dilimi / canlı sistem değişmedi</span>
          </footer>
        </main>
      </div>
    </>
  );
}
