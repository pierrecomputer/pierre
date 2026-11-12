import type { HtmlUpdate } from './types';

// Separate core and renderer bundles share this private, versioned protocol.
export const delta = Symbol.for('@pierre/words/stream-delta/v1');

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
};
