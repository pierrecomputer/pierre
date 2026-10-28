import type { ElementContent, Element as HASTElement, Properties } from 'hast';

import type { LineTypes } from '../types';
import type { DiffLineMetadata } from '../utils/iterateOverDiff';

/**
 * One rendered row of a code column: its gutter cell and its content cell,
 * both as HAST, under a key that stays the same for as long as the row
 * means the same thing. Keys let the DOM be patched by row instead of
 * rebuilt: a new-file line keeps its key through edits above it, an old
 * line is keyed by its index, and separators, annotation rows, buffers and
 * "no newline" markers each have keys of their own.
 */
export interface RowSpec {
  key: RowKey;
  gutter: HASTElement;
  content: HASTElement;
}

/**
 * The key of a rendered line: `a` and the line id of a new-file line, or `d`
 * and the index of an old-file line.
 */
export type LineKey = `a${number}` | `d${number}`;

/**
 * The key of any row. Each kind of row has its own prefix, so a key of one
 * kind can never equal a key of another: `ann:` for an annotation row under a
 * line (or `ann:file` for the file-level one), `sep:` for a hunk separator,
 * `buf:` for a filler row after the row it follows, `eof:` for a "no newline"
 * marker, and `inj:` for a row a host injects.
 */
export type RowKey =
  | LineKey
  | `ann:${LineKey}`
  | 'ann:file'
  | `sep:${string}`
  | `buf:${string}`
  | 'eof:a'
  | 'eof:d'
  | `inj:${string}`;

export interface LayoutColumns {
  unified?: RowSpec[];
  deletions?: RowSpec[];
  additions?: RowSpec[];
}

/**
 * The line types a layout gives a rendered line's gutter and content.
 *
 * The layout keeps what a host returns and reuses rows whose inputs are the
 * same values as last render, so a decoration is treated as immutable once
 * returned: a host that wants a different one returns a new object.
 */
export interface LineDecoration {
  gutterLineType: LineTypes;
  gutterProperties?: Properties;
  contentProperties?: Properties;
}

export interface UnifiedLineDecorationProps {
  type: 'context' | 'context-expanded' | 'change';
  lineType: LineTypes;
  additionLineIndex: number | undefined;
  deletionLineIndex: number | undefined;
}

export interface SplitLineDecorationProps {
  side: 'deletions' | 'additions';
  type: 'context' | 'context-expanded' | 'change';
  lineIndex: number | undefined;
}

/**
 * A row a host adds before or after a line, such as a merge conflict marker.
 * `id` is the host's own identity for the row, for a row that should keep its
 * element when it moves to another line or when rows before it go away.
 * Without one, the row is identified by the line it is injected at and its
 * position among that line's injected rows. Like a decoration, an injected
 * row is treated as immutable once returned.
 */
export interface InjectedRow {
  id?: string;
  content: HASTElement;
  gutter: HASTElement;
}

export interface SplitInjectedRow {
  deletion: InjectedRow | undefined;
  addition: InjectedRow | undefined;
}

export interface UnifiedInjectedRowPlacement {
  before?: InjectedRow[];
  after?: InjectedRow[];
}

export interface SplitInjectedRowPlacement {
  before?: SplitInjectedRow[];
  after?: SplitInjectedRow[];
}

/** Where a line sits in the rendered diff, for hosts that inject rows. */
export interface RenderedLineContext {
  type: 'context' | 'context-expanded' | 'change';
  hunkIndex: number;
  lineIndex: number;
  unifiedLineIndex: number;
  splitLineIndex: number;
  deletionLine?: DiffLineMetadata;
  additionLine?: DiffLineMetadata;
}

/** The gutter and content cells of a column's rows, in order. */
export function columnCells(specs: readonly RowSpec[]): {
  gutter: ElementContent[];
  content: ElementContent[];
} {
  return {
    gutter: specs.map((spec) => spec.gutter),
    content: specs.map((spec) => spec.content),
  };
}
