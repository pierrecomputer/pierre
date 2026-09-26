import type { ColorScheme, ThemeLike } from '@pierre/theming';

import { deriveChromeTokens } from './deriveChromeTokens';
import { diffshubChromeMapping } from './diffshubChromeMapping';

export const THEME_BOOTSTRAP_CLASS_NAME = 'diffshub-theme-bootstrap';
export const THEME_BOOTSTRAP_RULE_ID = 'diffshub-theme-bootstrap-style';
export const THEME_BOOTSTRAP_SELECTOR = `.${THEME_BOOTSTRAP_CLASS_NAME}.${THEME_BOOTSTRAP_CLASS_NAME}`;
export const THEME_BOOTSTRAP_STORAGE_KEY = 'diffshub-theme-bootstrap';
export const THEME_BOOTSTRAP_VERSION = 2;

export type ThemeBootstrapStyle = Record<string, string>;

export interface ThemeBootstrapEntry {
  style: ThemeBootstrapStyle;
  themeName: string;
}

export interface ThemeBootstrapCache {
  dark?: ThemeBootstrapEntry;
  light?: ThemeBootstrapEntry;
  version: typeof THEME_BOOTSTRAP_VERSION;
}

// Converts the React chrome style into CSS declarations that both the head
// bootstrap script and the live controller can install through CSSOM.
export function buildThemeBootstrapStyle(
  theme: ThemeLike
): ThemeBootstrapStyle {
  const mapped = diffshubChromeMapping(deriveChromeTokens(theme), theme) ?? {};
  const style: ThemeBootstrapStyle = {};
  for (const [property, value] of Object.entries(mapped)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const cssProperty =
      property === 'backgroundColor' ? 'background-color' : property;
    style[cssProperty] = String(value);
  }
  return style;
}

// Installs or replaces the scoped pre-paint rule. The doubled class selector
// beats single Tailwind utility classes, while the resolved inline style still
// takes precedence once React commits.
export function applyThemeBootstrapStyle(style: ThemeBootstrapStyle): void {
  if (typeof document === 'undefined') return;

  let element = document.getElementById(
    THEME_BOOTSTRAP_RULE_ID
  ) as HTMLStyleElement | null;
  if (element == null) {
    element = document.createElement('style');
    element.id = THEME_BOOTSTRAP_RULE_ID;
    document.head.append(element);
  }

  const sheet = element.sheet;
  if (sheet == null) return;
  while (sheet.cssRules.length > 0) sheet.deleteRule(0);
  const index = sheet.insertRule(`${THEME_BOOTSTRAP_SELECTOR} {}`, 0);
  const rule = sheet.cssRules[index];
  if (!(rule instanceof CSSStyleRule)) return;
  for (const [property, value] of Object.entries(style)) {
    rule.style.setProperty(property, value);
  }
}

export function persistThemeBootstrapSnapshot(
  colorScheme: ColorScheme,
  entry: ThemeBootstrapEntry
): void {
  try {
    const stored = globalThis.localStorage?.getItem(
      THEME_BOOTSTRAP_STORAGE_KEY
    );
    let cache: ThemeBootstrapCache = { version: THEME_BOOTSTRAP_VERSION };
    if (stored != null) {
      try {
        const parsed = JSON.parse(stored) as Partial<ThemeBootstrapCache>;
        if (parsed.version === THEME_BOOTSTRAP_VERSION) {
          cache = { ...parsed, version: THEME_BOOTSTRAP_VERSION };
        }
      } catch {
        // Replace malformed data with a fresh cache below.
      }
    }
    cache[colorScheme] = entry;
    const serialized = JSON.stringify(cache);
    if (stored !== serialized) {
      globalThis.localStorage?.setItem(THEME_BOOTSTRAP_STORAGE_KEY, serialized);
    }
  } catch {
    // Storage may be unavailable or full; the built-in fallback still applies.
  }
}
