import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  setActiveLocale,
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  LOCALE_FLAGS,
  type AppLocale,
} from "../../i18n";

// Compact locale picker — visible chip shows just the flag of the
// active locale; an invisible <select> overlays it so clicking opens
// the native dropdown rendering the full labels via <option>
// textContent. Per-browser persistence only (no Firestore profile
// field for this in kanban today).
export function LocaleSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? "en") as AppLocale;

  async function handleChange(next: AppLocale) {
    await setActiveLocale(next);
  }

  return (
    <div className="relative inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
      <span className="text-base leading-none select-none" aria-hidden>
        {LOCALE_FLAGS[current] ?? LOCALE_FLAGS.en}
      </span>
      <ChevronDown
        className="h-3.5 w-3.5 text-surface-500 dark:text-surface-400"
        aria-hidden
      />
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={t("common.language")}
        value={current}
        onChange={(e) => handleChange(e.target.value as AppLocale)}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
