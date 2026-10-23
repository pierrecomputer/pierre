import type { Element as HASTElement, Properties } from 'hast';

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
  key: string;
  gutter: HASTElement;
  content: HASTElement;
}

export interface LayoutColumns {
  unified?: RowSpec[];
  deletions?: RowSpec[];
  additions?: RowSpec[];
}

/** The line types a layout gives a rendered line's gutter and content. */
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

/** A row a host adds before or after a line, such as a merge conflict marker. */
export interface InjectedRow {
  key: string;
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
