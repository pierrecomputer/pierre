import type { DEFAULT_TRANSLATIONS } from './constants';

export type GitStatus =
  | 'added'
  | 'deleted'
  | 'ignored'
  | 'modified'
  | 'renamed'
  | 'untracked';

export type GitStatusEntry = {
  path: string;
  status: GitStatus;
};

export type ContextMenuAnchorRect = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  x: number;
  y: number;
}>;

export type FileTreeTranslationKey = keyof typeof DEFAULT_TRANSLATIONS;

/**
 * Every user-visible string the tree renders or reports, keyed like
 * `DEFAULT_TRANSLATIONS`. Set them through `i18n.set()`.
 */
export type FileTreeTranslations = Record<FileTreeTranslationKey, string>;

export interface FileTreeI18nConfig {
  /** BCP 47 locale used to pick plural forms. Defaults to `en`. */
  locale?: string;
  /** Translations to use. Any left out fall back to English. */
  translations?: Partial<FileTreeTranslations>;
}
