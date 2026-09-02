"use client";

export function DailyPlanWorkspace() {
  return (
    <section className="day-sheet day-page" aria-labelledby="day-sheet-title">
      <div className="section-heading section-heading-compact">
        <div>
          <p className="section-kicker">Bugün / —</p>
          <h2 id="day-sheet-title">Bugünün planı</h2>
        </div>
      </div>

      <div className="next-action">
        <span>Planlama alanı</span>
        <strong>Takvim adımı henüz açılmadı.</strong>
        <small>
          Ziyaretler, toplantılar ve günlük işler bu sayfada tek zaman çizelgesinde
          birleştirilecek.
        </small>
      </div>
    </section>
  );
}
