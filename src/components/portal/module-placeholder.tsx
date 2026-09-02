type ModulePlaceholderProps = Readonly<{
  description: string;
  label: string;
}>;

export function ModulePlaceholder({ description, label }: ModulePlaceholderProps) {
  return (
    <section className="module-placeholder" aria-labelledby="module-placeholder-title">
      <p className="section-kicker">Planlanan çalışma alanı</p>
      <h2 id="module-placeholder-title">{label}</h2>
      <p>{description}</p>
      <div className="next-action">
        <span>Durum</span>
        <strong>Bu modül henüz kullanıma açılmadı.</strong>
        <small>Mevcut kayıtlarınızı etkilemeden sonraki geliştirme adımında eklenecek.</small>
      </div>
    </section>
  );
}
