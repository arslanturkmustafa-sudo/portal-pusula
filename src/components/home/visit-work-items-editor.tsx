"use client";

import {
  MAX_VISIT_WORK_ITEM_LENGTH,
  MAX_VISIT_WORK_ITEMS,
} from "@/features/contracts/visit-work-items";

import styles from "./visit-work-items-editor.module.css";

type VisitWorkItemsEditorProps = Readonly<{
  addLabel?: string;
  disabled: boolean;
  hint?: string;
  itemLabel?: string;
  itemKeys?: readonly (number | string)[];
  items: readonly string[];
  legend?: string;
  onAdd?: () => void;
  onChange?: (items: string[]) => void;
  onRemove?: (index: number) => void;
  onUpdate?: (index: number, value: string) => void;
  placeholder?: string;
  removeItemLabel?: string;
}>;

export function VisitWorkItemsEditor({
  addLabel = "+ Çalışma ekle",
  disabled,
  hint = "Her madde firma görev raporuna tamamlanmış görev olarak eklenir. Boş satırlar kaydedilmez.",
  itemLabel = "Çalışma",
  itemKeys,
  items,
  legend = "Tamamlanan çalışmalar",
  onAdd,
  onChange,
  onRemove,
  onUpdate,
  placeholder = "Örn. Süreç akışı çıkarıldı",
  removeItemLabel = "çalışma maddesini",
}: VisitWorkItemsEditorProps) {
  function updateItem(index: number, value: string) {
    if (onUpdate) {
      onUpdate(index, value);
      return;
    }
    onChange?.(
      items.map((item, itemIndex) => (itemIndex === index ? value : item)),
    );
  }

  function removeItem(index: number) {
    if (onRemove) {
      onRemove(index);
      return;
    }
    const next = items.filter((_, itemIndex) => itemIndex !== index);
    onChange?.(next.length === 0 ? [""] : next);
  }

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      <p className={styles.hint}>{hint}</p>
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li className={styles.row} key={itemKeys?.[index] ?? index}>
            <label className={styles.field}>
              <span>{itemLabel} {index + 1}</span>
              <input
                autoComplete="off"
                maxLength={MAX_VISIT_WORK_ITEM_LENGTH}
                placeholder={placeholder}
                value={item}
                onChange={(event) => updateItem(index, event.target.value)}
              />
            </label>
            {items.length > 1 ? (
              <button
                aria-label={`${index + 1}. ${removeItemLabel} kaldır`}
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
        onClick={() => (onAdd ? onAdd() : onChange?.([...items, ""]))}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
