// i18n bootstrap for the Kanban admin. Mirrors the CMS pattern:
//   - Static imports of the 7 locale bundles (en is the source of truth)
//   - Locale resolved at boot from localStorage → navigator.language →
//     DEFAULT_LOCALE (en)
//   - i18next.changeLanguage() called from the LocaleSwitcher updates
//     both localStorage and the live i18next instance
//
// Side-effect imported once by main.tsx — the i18n.init() call below
// runs synchronously at module load so consumers can `useTranslation()`
// immediately.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import fr from "./fr.json";
import de from "./de.json";
import es from "./es.json";
import nl from "./nl.json";
import pt from "./pt.json";
import ko from "./ko.json";

export type AppLocale = "en" | "fr" | "de" | "es" | "nl" | "pt" | "ko";

export const SUPPORTED_LOCALES: AppLocale[] = [
  "en",
  "fr",
  "de",
  "es",
  "nl",
  "pt",
  "ko",
];
export const DEFAULT_LOCALE: AppLocale = "en";
const STORAGE_KEY = "kanbanLocale";

// Native-name labels (with country flag emoji) shown wherever the
// Kanban renders a locale picker.
export const LOCALE_LABELS: Record<AppLocale, string> = {
  fr: "🇫🇷 Français",
  en: "🇬🇧 English",
  de: "🇩🇪 Deutsch",
  es: "🇪🇸 Español",
  nl: "🇳🇱 Nederlands",
  pt: "🇵🇹 Português",
  ko: "🇰🇷 한국어",
};

// Flag-only variant used by the compact LocaleSwitcher chip.
export const LOCALE_FLAGS: Record<AppLocale, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
  de: "🇩🇪",
  es: "🇪🇸",
  nl: "🇳🇱",
  pt: "🇵🇹",
  ko: "🇰🇷",
};

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as string[]).includes(value);
}

// Resolves the locale to use at boot time. Order:
//   1. localStorage — survives reloads.
//   2. navigator.language two-letter prefix, if supported.
//   3. DEFAULT_LOCALE (English).
//
// Unlike the CMS counterpart there is no Firestore profile field
// (kanban's user record doesn't carry a preferences blob today), so
// per-user persistence is browser-scoped — same as the runtime config.
export function resolveInitialLocale(): AppLocale {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isSupportedLocale(stored)) return stored;
    } catch {
      // ignore (private mode etc.)
    }
  }

  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    const prefix = navigator.language.split("-")[0]?.toLowerCase();
    if (isSupportedLocale(prefix)) return prefix;
  }

  return DEFAULT_LOCALE;
}

export function persistLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      de: { translation: de },
      es: { translation: es },
      nl: { translation: nl },
      pt: { translation: pt },
      ko: { translation: ko },
    },
    lng: resolveInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
    // Disable Suspense — resources are loaded synchronously from
    // static imports, so suspending makes no sense and can race with
    // React's reconciler if a parent boundary catches the thrown
    // promise.
    react: { useSuspense: false },
  });

export async function setActiveLocale(locale: AppLocale): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  persistLocale(locale);
  await i18n.changeLanguage(locale);
}

export default i18n;
