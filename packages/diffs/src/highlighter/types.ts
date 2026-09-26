import type { ThemeResolver } from '@pierre/theming';
import type { Properties } from 'hast';

import type { HighlighterTypes } from '../types';
import type { ResolvedLanguage } from '../worker/types';
import type { DiffsTheme } from './themes/types';
import type {
  DiffsLiveTokenizer,
  DiffsLiveTokenizerOptions,
  DiffsStreamTokenizer,
} from './tokenizer-types';

export type {
  DiffsLiveTokenizer,
  DiffsLiveTokenizerOptions,
  DiffsStreamTokenizer,
} from './tokenizer-types';

/** One styled run, with its absolute UTF-16 offset in the source. */
export interface ThemedToken {
  content: string;
  offset: number;
  color?: string;
  bgColor?: string;
  fontStyle?: number;
  htmlStyle?: Record<string, string>;
  htmlAttrs?: Record<string, string>;
  type?: number;
}

export interface DecorationItem {
  start: number | { line: number; character: number };
  end: number | { line: number; character: number };
  properties?: Properties;
  alwaysWrap?: boolean;
}

export type CodeToTokensOptions = {
  lang: string;
  defaultColor?: string | false;
  cssVariablePrefix?: string;
  tokenizeMaxLineLength?: number;
  tokenizeTimeLimit?: number;
  mergeWhitespaces?: 'never' | 'always';
} & (
  | { theme: string; themes?: undefined }
  | { theme?: undefined; themes: Record<string, string> }
);

export type CodeToHtmlOptions = CodeToTokensOptions & {
  decorations?: DecorationItem[];
};

export interface TokensResult {
  tokens: ThemedToken[][];
  fg?: string;
  bg?: string;
  themeName?: string;
  rootStyle?: string | false;
}

/** Tokenization and theme resolution owned by one highlighter backend. */
export interface DiffsHighlighter {
  readonly name: HighlighterTypes;
  readonly themeResolver: ThemeResolver<DiffsTheme>;
  /**
   * A resolved theme by name. Themes an instance has already used stay
   * available after the shared resolver cache is cleared.
   */
  getTheme(name: string): DiffsTheme;
  codeToHtml(code: string, options: CodeToHtmlOptions): string;
  codeToTokens(code: string, options: CodeToTokensOptions): TokensResult;
  createStreamTokenizer(options: CodeToTokensOptions): DiffsStreamTokenizer;
  createLiveTokenizer(options: DiffsLiveTokenizerOptions): DiffsLiveTokenizer;
  /** Load TextMate grammars when supported by the backend. */
  loadLanguages?(languages: readonly string[]): Promise<void>;
  /** Whether all requested TextMate grammars are loaded. */
  hasLoadedLanguages?(languages: readonly string[]): boolean;
  /** Attach resolved TextMate grammars when supported by the backend. */
  attachLanguages?(languages: readonly ResolvedLanguage[]): void;
  /** Release backend resources. The instance is unusable afterward. */
  dispose(): void;
}
