import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const I18N_SETUP: PreloadFileOptions<undefined, undefined> = {
  file: {
    name: 'i18n.ts',
    contents: `import { i18n } from '@pierre/diffs';

// Run this once at boot, on the server and on the client, before the
// first diff renders. Every component reads from this store.
i18n.set({
  locale: 'fr',
  messages: {
    unmodifiedLines:
      '{count, plural, one {# ligne inchangée} other {# lignes inchangées}}',
    unknownUnmodifiedLines: 'Plus de contexte peut être disponible',
    expandAll: 'Tout déplier',
    noNewlineAtEndOfFile: 'Pas de saut de ligne à la fin du fichier',
    acceptCurrentChange: 'Accepter la modification actuelle',
    acceptIncomingChange: 'Accepter la modification entrante',
    acceptBoth: 'Accepter les deux',
  },
});`,
  },
  options,
};

export const I18N_SWITCH: PreloadFileOptions<undefined, undefined> = {
  file: {
    name: 'LanguageSwitcher.ts',
    contents: `import { i18n, type DiffsI18nConfig } from '@pierre/diffs';

import fr from './locales/fr.json';
import ru from './locales/ru.json';

// Message files are plain JSON in the \`DiffsI18nConfig\` shape, so the
// same file configures the server and the client. English is the default,
// so it needs no file.
const LOCALES = {
  en: {},
  'en-US': { locale: 'en-US' },
  'en-GB': { locale: 'en-GB' },
  fr,
  ru,
} satisfies Record<string, DiffsI18nConfig>;

export function switchLanguage(locale: keyof typeof LOCALES): void {
  // Mounted diffs re-render their text in place. Messages left out
  // fall back to English.
  i18n.set(LOCALES[locale]);
}`,
  },
  options,
};

export const I18N_PLURALS: PreloadFileOptions<undefined, undefined> = {
  file: {
    name: 'locales/ru.json',
    contents: `{
  "locale": "ru",
  "messages": {
    "unmodifiedLines": "{count, plural, one {# неизменённая строка} few {# неизменённые строки} many {# неизменённых строк} other {# неизменённой строки}}",
    "unknownUnmodifiedLines": "Может быть доступен дополнительный контекст",
    "expandAll": "Развернуть всё",
    "noNewlineAtEndOfFile": "Нет новой строки в конце файла",
    "acceptCurrentChange": "Принять текущее изменение",
    "acceptIncomingChange": "Принять входящее изменение",
    "acceptBoth": "Принять оба"
  }
}`,
  },
  options,
};
