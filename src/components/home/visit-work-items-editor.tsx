"use client";

import {
  MAX_VISIT_WORK_ITEM_LENGTH,
  MAX_VISIT_WORK_ITEMS,
} from "@/features/contracts/visit-work-items";

import styles from "./visit-work-items-editor.module.css";

type VisitWorkItemsEditorProps = Readonly<{
  disabled: boolean;
  items: readonly string[];
  onChange: (items: string[]) => void;
}>;

export function VisitWorkItemsEditor({
  disabled,
  items,
  onChange,
}: VisitWorkItemsEditorProps) {
  function updateItem(index: number, value: string) {
    onChange(items.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function removeItem(index: number) {
    const next = items.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length === 0 ? [""] : next);
  }

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>Tamamlanan çalışmalar</legend>
      <p className={styles.hint}>
        Her madde firma görev raporuna tamamlanmış görev olarak eklenir. Boş
        satırlar kaydedilmez.
      </p>
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li className={styles.row} key={index}>
            <label className={styles.field}>
              <span>Çalışma {index + 1}</span>
              <input
                autoComplete="off"
                maxLength={MAX_VISIT_WORK_ITEM_LENGTH}
                placeholder="Örn. Süreç akışı çıkarıldı"
                value={item}
                onChange={(event) => updateItem(index, event.target.value)}
              />
            </label>
            {items.length > 1 ? (
              <button
                aria-label={`${index + 1}. çalışma maddesini kaldır`}
                className={styles.remove}
                type="button"
                onClick={() => removeItem(index)}
              >
                Kaldır
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <button
        className={styles.add}
        disabled={disabled || items.length >= MAX_VISIT_WORK_ITEMS}
        type="button"
        onClick={() => onChange([...items, ""])}
      >
        + Çalışma ekle
      </button>
    </fieldset>
  );
}
