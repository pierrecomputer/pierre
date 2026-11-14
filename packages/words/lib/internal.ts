import type { HtmlSessionOptions, HtmlUpdate } from './types';

// Separate core and renderer bundles share these private, versioned keys.
export const delta = Symbol.for('@pierre/words/stream-delta/v1');
export const format = Symbol.for('@pierre/words/html-format/v1');

/**
 * Asks a session for the final markup of the HTML renderer instead of plain
 * HTML. `flags` are the `$Fmt` bits of `src/html.wat`. `idPrefix` is escaped.
 */
export interface HtmlFormat {
  flags: number;
  idPrefix: string;
}

export const formatFlags = {
  on: 1,
  numbers: 2,
  copy: 4,
  download: 8,
  active: 16,
  slots: 32,
  rawUrls: 64,
};

export interface FenceDelta {
  text: string;
  replaceNewline: boolean;
  firstLine: number;
  lineCount: number;
  html: string;
  lastLineOffset: number;
  readonly fullHtml: string;
}

export type InternalHtmlUpdate = HtmlUpdate & {
  [delta]?: string | FenceDelta;
  /** A code block of this formatted HTML is in slots, each after a NUL. */
  [format]?: boolean;
};

export type InternalSessionOptions = HtmlSessionOptions & {
  [format]?: HtmlFormat;
};
