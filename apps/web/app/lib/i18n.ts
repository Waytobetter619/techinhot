// The reader's language on the web. The address decides it: /en and every page under /en/ are English, the rest
// Chinese, so the CDN (which keeps one copy per address) never serves one language to a reader of the other, and a
// shared link opens in the language it was shared in. No cookie, no Accept-Language, no redirect by browser language.
// The words themselves (t, L, zh, Phrase, Text) are the engine's, in @techinhot/contracts/i18n.
import { useLocation } from "react-router";
import { hasEnglish } from "@techinhot/contracts/reader-pages";
export { hasEnglish, localizePath } from "@techinhot/contracts/reader-pages";
export { readingApi as apiIn } from "@techinhot/contracts/english";
import { ENGLISH } from "@techinhot/contracts/english";
import { inLanguage, localeOf, pagePath, translator, type Locale, type Translate } from "@techinhot/contracts/i18n";

export { isPhrase, L, localeOf, pagePath, shownIn, translator, zh } from "@techinhot/contracts/i18n";
export type { Locale, Phrase, Text, Translate } from "@techinhot/contracts/i18n";

export function useLocale(): Locale {
  return localeOf(useLocation().pathname);
}

/** t(…) for the page being rendered; the same function for every render in one language. */
export function useT(): Translate {
  return translator(useLocale());
}

/** A feed's address for a page in this language: English pages offer the English feeds (/en/feed…), on a site with an English edition. */
export function feedPath(path: string, locale: Locale): string {
  return ENGLISH ? inLanguage(path, locale) : path;
}

/** A share image's address for a page in this language: English pages show the English cards (/og/en/…). */
export function ogPath(path: string, locale: Locale): string {
  return locale === "en" && ENGLISH && path.startsWith("/og/") ? `/og/en/${path.slice(4)}` : path;
}

/** A page's path in the other language: what the language switch links to; null when there is no such page. */
export function counterpart(pathname: string, to: Locale): string | null {
  if (to === "zh") return pagePath(pathname);
  if (localeOf(pathname) === "en") return pathname;
  return hasEnglish(pathname) ? inLanguage(pathname, to) : null;
}
