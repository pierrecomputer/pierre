import type {
  ChangeContent,
  ChangeTypes,
  ContextContent,
  Hunk,
} from '../types';

export type DiffSide = 'deletions' | 'additions';

/**
 * One entry of a hunk's `hunkContent`: either a run of unchanged lines
 * (context), or a run of old lines replaced by a run of new lines (change).
 * Within a change, the old and new lines pair up by position: the first old
 * line with the first new line, and so on, until the shorter side runs out.
 */
export type HunkBlock = ChangeContent | ContextContent;

/** Position in a document as a zero-based line and UTF-16 character offset. */
export interface LinePosition {
  readonly line: number;
  readonly character: number;
}

/** One applied edit: the replaced range in the document before the edit. */
export interface DocumentLineEdit {
  readonly range: { readonly start: LinePosition; readonly end: LinePosition };
  readonly text: string;
}

/**
 * What the model needs to know about an applied document change. The editor's
 * `TextDocumentChange` satisfies this shape.
 */
export interface DocumentLineChange {
  /** The edits that were applied, in document order. */
  readonly changes: readonly DocumentLineEdit[];
  /** First line whose content may have changed. */
  readonly startLine: number;
  /** Last line whose content may have changed, after the edit. */
  readonly endLine: number;
  /** Line count after the edit minus the line count before it. */
  readonly lineDelta: number;
  /** Line count after the edit. */
  readonly lineCount: number;
  /** Changed line ranges after the edit, adjacent ranges merged. */
  readonly changedLineRanges: readonly (readonly [
    startLine: number,
    endLine: number,
  ])[];
  /** Per-edit changed line ranges after the edit, with each edit's line delta. */
  readonly changedLineChanges?: readonly (readonly [
    startLine: number,
    endLine: number,
    lineDelta: number,
    ...rest: unknown[],
  ])[];
}

/** Line access on the editor's document, in document coordinates. */
export interface DocumentLines {
  readonly lineCount: number;
  getLineText(line: number, includeLineBreak?: boolean): string;
  getText(range?: {
    readonly start: LinePosition;
    readonly end: LinePosition;
  }): string;
}

/** FileDiff baseline and hunk state needed to resume an editing session. */
export interface RetainedDiffSessionSnapshot {
  oldFile: { name: string; lines: string[] } | null;
  type: ChangeTypes;
  hunks: Hunk[];
}

/** What one applied change did to the diff beyond its text. */
export interface DiffModelChange {
  /** New-file line indexes whose text changed, after the edit. */
  readonly changedLines: readonly number[];
  readonly lineDelta: number;
  /** Hunks were rebuilt: regions appeared, disappeared or changed bounds. */
  readonly regionsChanged: boolean;
  /** A block's shape changed, so some rows have a new line type. */
  readonly blocksChanged: boolean;
  /** The runs of rows each split-view column shows changed. */
  readonly splitRowsChanged: boolean;
}
