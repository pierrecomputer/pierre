import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const I18N_SETUP_EXAMPLE = docsCodeSnippet(
  'i18n.ts',
  `import { i18n } from '@pierre/trees';

// Run this once at boot, on the server and on the client, before the
// first tree renders. Every tree reads from this store.
i18n.set({
  locale: 'fr',
  translations: {
    searchPlaceholder: 'Rechercher…',
    contextMenuTrigger: 'Options',
    renameItem: 'Renommer {name}',
    gitStatusModified: 'Statut git : modifié',
    containsGitStatus: 'Contient des modifications git',
    renamePathExists: '« {path} » existe déjà.',
  },
});`
);

export const I18N_SWITCH_EXAMPLE = docsCodeSnippet(
  'LanguageSwitcher.ts',
  `import { i18n, type FileTreeI18nConfig } from '@pierre/trees';

import fr from './locales/fr.json';

// Translation files are plain JSON in the \`FileTreeI18nConfig\` shape, so
// the same file configures the server and the client. English is the
// default, so it needs no file.
const LOCALES = { en: {}, fr } satisfies Record<string, FileTreeI18nConfig>;

export function switchLanguage(locale: keyof typeof LOCALES): void {
  // Mounted trees re-render their text in place. Translations left out
  // fall back to English.
  i18n.set(LOCALES[locale]);
}`
);
