import type { Properties } from 'hast';

export type { DiffsEditorTokenizer } from './DiffsEditorTokenizer';
export type { DiffsHighlighter } from './DiffsHighlighter';
export type {
  DiffsEditorTokenizerOptions,
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
