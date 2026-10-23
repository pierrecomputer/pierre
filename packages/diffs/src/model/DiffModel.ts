import type { CreatePatchOptionsNonabortable } from 'diff';

import { DEFAULT_EXPANDED_REGION } from '../constants';
import type {
  ExpansionDirections,
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
} from '../types';
import { cloneHunks } from '../utils/cloneFileDiffMetadata';
import { linesFromFileContents } from '../utils/computeFileOffsets';
import {
  applySessionChangedLines,
  captureExpansionAnchors,
  finishEditSessionForDiff,
  rebuildExpansionFromAnchors,
  rebuildSessionHunks,
  remapExpandedHunksForRegionChange,
  type SessionRegionChange,
} from '../utils/editSessionHunks';
import { splitFileContents } from '../utils/splitFileContents';
import {
  recomputeDiffRenderLineCounts,
  recomputeEmptyDocumentDiff,
  recomputeTopAlignedAdditionDiff,
  shouldTopAlignAdditionRecompute,
} from '../utils/updateDiffHunks';
import { countLineBreaks, LineMap } from './LineMap';
import type {
  DiffModelChange,
  DiffSide,
  DocumentLineChange,
  DocumentLines,
  HunkBlock,
  RetainedDiffSessionSnapshot,
} from './types';

export interface DiffModelOptions {
  parseDiffOptions?: CreatePatchOptionsNonabortable;
}

export interface StartSessionOptions extends DiffModelOptions {
  /**
   * The editor's document when it is not the input's new file: a retained
   * draft from an earlier session, split like the parsed diff (no entry for
   * the empty line a final line break implies).
   */
  document?: FileContents;
  /** The hunks and old file the retained draft was diffed against. */
  snapshot?: RetainedDiffSessionSnapshot;
}

// Blocks of one side in document order, with the first line each covers and
// the first line after it, for binary search by line index.
interface SideBlocks {
  starts: number[];
  ends: number[];
  blocks: HunkBlock[];
}

interface BlockIndex {
  hunks: Hunk[];
  deletions: SideBlocks;
  additions: SideBlocks;
}

/**
 * The diff a component renders: the old lines, the new lines, and the hunks
 * that pair them. A static model wraps a `FileDiffMetadata` and never changes
 * it. A live model owns its diff for an edit session: `applyChange` keeps the
 * new lines and hunks current as the editor's document changes, using the
 * session rules (regions keep their old-side bounds, a reverted region stays
 * as context until `finish`), and `LineMap` gives every document line a
 * stable id.
 */
export class DiffModel {
  /** A read-only model over a diff the caller owns. Nothing is copied. */
  static fromDiff(
    diff: FileDiffMetadata,
    options: DiffModelOptions = {}
  ): DiffModel {
    return new DiffModel(diff, undefined, options.parseDiffOptions);
  }

  /**
   * A live model for editing `inputDiff`'s new file. The diff is a shallow
   * copy without a cache key; its arrays are shared with the input until an
   * edit replaces them, and the input is never written to.
   */
  static startSession(
    inputDiff: FileDiffMetadata,
    options: StartSessionOptions = {}
  ): DiffModel {
    const { document, snapshot, parseDiffOptions } = options;
    if (inputDiff.isPartial) {
      throw new Error('DiffModel.startSession: the diff must not be partial');
    }
    const inputContents = inputDiff.additionLines.join('');
    const restoresSnapshot =
      snapshot != null && canRestoreSnapshot(snapshot, inputDiff);
    if (snapshot != null && !restoresSnapshot) {
      throw new Error(
        'DiffModel.startSession: the retained session was diffed against a different old file'
      );
    }
    if (
      document != null &&
      document.contents !== inputContents &&
      !restoresSnapshot
    ) {
      throw new Error(
        'DiffModel.startSession: retained edits are missing their diff session state'
      );
    }
    const diff: FileDiffMetadata = { ...inputDiff };
    delete diff.cacheKey;
    const usesInputDocument =
      document == null ||
      (document.name === inputDiff.name &&
        document.lang === inputDiff.lang &&
        document.contents === inputContents);
    if (document != null && !usesInputDocument) {
      diff.name = document.name;
      diff.lang = document.lang;
    }
    if (restoresSnapshot && snapshot != null && document != null) {
      diff.additionLines = splitFileContents(document.contents);
      diff.additionCharacterCount = document.contents.length;
      diff.type = snapshot.type;
      diff.hunks = snapshot.hunks;
      diff.editSessionDirty = true;
      recomputeDiffRenderLineCounts(diff);
    }
    const model = new DiffModel(
      diff,
      new LineMap(countLineBreaks(diff.additionLines.join('')) + 1),
      parseDiffOptions
    );
    // An empty new file still needs one editable line for the caret.
    if (diff.additionLines.length === 0) {
      model.#applyRecompute(recomputeEmptyDocumentDiff(diff, parseDiffOptions));
    }
    return model;
  }

  readonly diff: FileDiffMetadata;
  readonly parseDiffOptions: CreatePatchOptionsNonabortable | undefined;
  expandedHunks: Map<number, HunkExpansionRegion> = new Map();
  readonly #lines: LineMap | undefined;
  #blockIndex: BlockIndex | undefined;

  private constructor(
    diff: FileDiffMetadata,
    lines: LineMap | undefined,
    parseDiffOptions: CreatePatchOptionsNonabortable | undefined
  ) {
    this.diff = diff;
    this.#lines = lines;
    this.parseDiffOptions = parseDiffOptions;
  }

  /** Whether this model follows an editor's document. */
  get live(): boolean {
    return this.#lines != null;
  }

  /** A stable id for a new-file line while editing; the index otherwise. */
  lineId(line: number): number {
    return this.#lines?.idAt(line) ?? line;
  }

  /**
   * The index this new-file line had when the session started, or -1 once an
   * edit touched it. Always the index itself for a static model.
   */
  originalLineIndex(line: number): number {
    return this.#lines?.originalIndexAt(line) ?? line;
  }

  /** The hunk block containing a line, or undefined between hunks. */
  blockAt(side: DiffSide, lineIndex: number): HunkBlock | undefined {
    const { starts, ends, blocks } = this.#getBlockIndex()[side];
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ends[middle] <= lineIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low < blocks.length && starts[low] <= lineIndex
      ? blocks[low]
      : undefined;
  }

  /**
   * The line on the other side that a changed line is paired with, by
   * position inside its change block, for word diff highlights. Undefined for
   * context, for unpaired lines, and for the empty line after a final line
   * break, which is never paired.
   */
  pairFor(side: DiffSide, lineIndex: number): number | undefined {
    const block = this.blockAt(side, lineIndex);
    if (block?.type !== 'change') {
      return undefined;
    }
    const offset =
      lineIndex -
      (side === 'deletions'
        ? block.deletionLineIndex
        : block.additionLineIndex);
    if (offset >= Math.min(block.deletions, block.additions)) {
      return undefined;
    }
    const deletionIndex = block.deletionLineIndex + offset;
    const additionIndex = block.additionLineIndex + offset;
    const { deletionLines, additionLines } = this.diff;
    if (
      !isPairableLine(deletionLines[deletionIndex]) ||
      !isPairableLine(additionLines[additionIndex])
    ) {
      return undefined;
    }
    return side === 'deletions' ? additionIndex : deletionIndex;
  }

  /**
   * Brings the diff up to date with one change to the editor's document.
   * Same-line-count edits copy the changed lines in and keep the hunks when
   * the session rules allow; line-count edits reread the document and
   * rebuild the session regions.
   */
  applyChange(
    change: DocumentLineChange,
    document: DocumentLines
  ): DiffModelChange {
    const lines = this.#lines;
    if (lines == null) {
      throw new Error('DiffModel.applyChange: the model is not live');
    }
    lines.applyChange(change);
    const { diff, parseDiffOptions } = this;
    const blockSizesBefore = getBlockSizes(diff);
    // A batch whose inserts and deletes cancel out still has the same line
    // count; its changed range covers every line the edits shifted.
    const keepsLineCount = change.lineDelta === 0;
    let changedLines: number[];
    let regionsChanged = false;

    if (keepsLineCount) {
      changedLines = [];
      const previousTexts = new Map<number, string>();
      const lineCount = diff.additionLines.length;
      const canAppendFinalRow = canAppendFinalDocumentRow(
        diff.additionLines,
        document.lineCount
      );
      let nextLines: string[] | undefined;
      for (const [line, text] of readChangedLines(document, change)) {
        // The parsed diff has no entry for the empty line after a final line
        // break. That line joins the file once it has text.
        if (
          line < 0 ||
          line > lineCount ||
          (line === lineCount && (text === '' || !canAppendFinalRow))
        ) {
          continue;
        }
        const previous = diff.additionLines[line] ?? '';
        if (previous === text) {
          continue;
        }
        nextLines ??= diff.additionLines.slice();
        nextLines[line] = text;
        diff.additionCharacterCount += text.length - previous.length;
        changedLines.push(line);
        previousTexts.set(line, previous);
      }
      if (nextLines != null) {
        diff.additionLines = nextLines;
      }
      if (changedLines.length > 0) {
        if (isEmptyDocument(diff)) {
          this.#applyRecompute(
            recomputeEmptyDocumentDiff(diff, parseDiffOptions)
          );
          regionsChanged = true;
        } else if (shouldTopAlignAdditionRecompute(diff, diff.additionLines)) {
          this.#applyRecompute(
            recomputeTopAlignedAdditionDiff(
              diff,
              diff.additionLines,
              diff.additionCharacterCount,
              parseDiffOptions
            )
          );
          regionsChanged = true;
        } else {
          const regionChange = applySessionChangedLines(
            diff,
            changedLines,
            parseDiffOptions,
            previousTexts
          );
          this.#applyExpansionRemap(regionChange);
          regionsChanged = regionChange != null;
        }
      }
    } else {
      const previousLines = diff.additionLines;
      const { lines: nextLines, characterCount } = readAllLines(document);
      diff.additionLines = nextLines;
      diff.additionCharacterCount = characterCount;
      if (isEmptyDocument(diff)) {
        this.#applyRecompute(
          recomputeEmptyDocumentDiff(diff, parseDiffOptions)
        );
      } else if (shouldTopAlignAdditionRecompute(diff, nextLines)) {
        this.#applyRecompute(
          recomputeTopAlignedAdditionDiff(
            diff,
            nextLines,
            characterCount,
            parseDiffOptions
          )
        );
      } else {
        this.#applyExpansionRemap(
          rebuildSessionHunks(
            diff,
            parseDiffOptions,
            (index) => previousLines[index]
          )
        );
      }
      regionsChanged = true;
      changedLines = [];
      for (const [start, end] of change.changedLineRanges) {
        const last = Math.min(end, diff.additionLines.length - 1);
        for (let line = start; line <= last; line++) {
          changedLines.push(line);
        }
      }
    }

    this.#blockIndex = undefined;
    const blockSizesAfter = getBlockSizes(diff);
    const blocksChanged = !areNumberArraysEqual(
      blockSizesBefore,
      blockSizesAfter
    );
    return {
      changedLines,
      lineDelta: change.lineDelta,
      regionsChanged,
      blocksChanged,
      splitRowsChanged:
        blocksChanged &&
        !areNumberArraysEqual(
          getSplitColumnRows(blockSizesBefore),
          getSplitColumnRows(blockSizesAfter)
        ),
    };
  }

  /** Reveals more collapsed context on one side of a hunk gap. */
  expandHunk(
    hunkIndex: number,
    direction: ExpansionDirections,
    lineCount: number
  ): void {
    const region = {
      ...(this.expandedHunks.get(hunkIndex) ?? DEFAULT_EXPANDED_REGION),
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += lineCount;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += lineCount;
    }
    this.expandedHunks.set(hunkIndex, region);
  }

  /** The state another session needs to resume this one's draft. */
  snapshot(): RetainedDiffSessionSnapshot {
    const { diff } = this;
    return {
      oldFile:
        diff.type !== 'new'
          ? {
              name: diff.prevName ?? diff.name,
              lines: [...diff.deletionLines],
            }
          : null,
      type: diff.type,
      hunks: cloneHunks(diff.hunks),
    };
  }

  /** Whether an edit has changed the diff since the session started. */
  get hasChanges(): boolean {
    return this.diff.editSessionDirty === true;
  }

  /**
   * Ends the session: recomputes the hunks the way a plain diff of the final
   * text would, and keeps expansion at the gap edges that survive. Returns
   * whether a recompute ran.
   */
  finish(collapsedContextThreshold: number): boolean {
    const { diff, parseDiffOptions } = this;
    if (diff.editSessionDirty !== true) {
      return false;
    }
    const anchors = captureExpansionAnchors(
      diff,
      this.expandedHunks,
      collapsedContextThreshold
    );
    finishEditSessionForDiff(diff, parseDiffOptions);
    this.expandedHunks = rebuildExpansionFromAnchors(diff, anchors);
    this.#blockIndex = undefined;
    return true;
  }

  // A recompute that replaces the hunks wholesale keeps the session's
  // classification (a rename stays a rename) until finish().
  #applyRecompute(update: ReturnType<typeof recomputeEmptyDocumentDiff>): void {
    const { diff } = this;
    const sessionType = diff.type;
    Object.assign(diff, update);
    diff.type = sessionType;
    diff.editSessionDirty = true;
    this.#blockIndex = undefined;
  }

  #applyExpansionRemap(change: SessionRegionChange | undefined): void {
    if (change != null) {
      this.expandedHunks = remapExpandedHunksForRegionChange(
        this.expandedHunks,
        change
      );
    }
  }

  #getBlockIndex(): BlockIndex {
    const { hunks } = this.diff;
    if (this.#blockIndex?.hunks === hunks) {
      return this.#blockIndex;
    }
    const deletions: SideBlocks = { starts: [], ends: [], blocks: [] };
    const additions: SideBlocks = { starts: [], ends: [], blocks: [] };
    for (const hunk of hunks) {
      for (const block of hunk.hunkContent) {
        const deletionCount =
          block.type === 'context' ? block.lines : block.deletions;
        const additionCount =
          block.type === 'context' ? block.lines : block.additions;
        if (deletionCount > 0) {
          deletions.starts.push(block.deletionLineIndex);
          deletions.ends.push(block.deletionLineIndex + deletionCount);
          deletions.blocks.push(block);
        }
        if (additionCount > 0) {
          additions.starts.push(block.additionLineIndex);
          additions.ends.push(block.additionLineIndex + additionCount);
          additions.blocks.push(block);
        }
      }
    }
    return (this.#blockIndex = { hunks, deletions, additions });
  }
}

// A draft can only resume against the old file it was diffed with.
function canRestoreSnapshot(
  snapshot: RetainedDiffSessionSnapshot,
  inputDiff: FileDiffMetadata
): boolean {
  const { oldFile } = snapshot;
  if (oldFile == null) {
    return inputDiff.type === 'new';
  }
  return (
    inputDiff.type !== 'new' &&
    oldFile.name === (inputDiff.prevName ?? inputDiff.name) &&
    oldFile.lines.length === inputDiff.deletionLines.length &&
    oldFile.lines.every(
      (line, index) => line === inputDiff.deletionLines[index]
    )
  );
}

// The editor keeps an empty row after a final line break that the file does
// not have. That row, stored as '', is never paired with an old line.
function isPairableLine(text: string | undefined): text is string {
  return text != null && text !== '';
}

function isEmptyDocument(diff: FileDiffMetadata): boolean {
  return diff.additionLines.length <= 1 && diff.additionLines.join('') === '';
}

// The editor shows one empty row after a final `\n` that the parsed diff has
// no entry for. Text typed there is file content only when that row is the
// document's single extra line; any other count means the two disagree.
function canAppendFinalDocumentRow(
  additionLines: readonly string[],
  documentLineCount: number
): boolean {
  return (
    documentLineCount === additionLines.length + 1 &&
    additionLines.at(-1)?.endsWith('\n') === true
  );
}

// The current text of every line an edit touched, by line, including lines
// the editor's window does not show.
function readChangedLines(
  document: DocumentLines,
  change: DocumentLineChange
): Map<number, string> {
  const ranges =
    change.changedLineChanges?.some(([, , lineDelta]) => lineDelta !== 0) ===
    true
      ? [[change.startLine, change.endLine] as const]
      : change.changedLineRanges;
  const lines = new Map<number, string>();
  for (const [start, end] of ranges) {
    const last = Math.min(end, document.lineCount - 1);
    if (last < start) continue;
    if (last === start) {
      lines.set(start, document.getLineText(start, true));
      continue;
    }
    const endPosition =
      last + 1 < document.lineCount
        ? { line: last + 1, character: 0 }
        : { line: last, character: document.getLineText(last).length };
    const contents = document.getText({
      start: { line: start, character: 0 },
      end: endPosition,
    });
    const rangeLines = linesFromFileContents(contents);
    for (let line = start; line <= last; line++) {
      lines.set(line, rangeLines[line - start]);
    }
  }
  return lines;
}

// Every document line with its line break, plus their total length.
function readAllLines(document: DocumentLines): {
  lines: string[];
  characterCount: number;
} {
  const lines: string[] = [];
  let characterCount = 0;
  for (let line = 0; line < document.lineCount; line++) {
    const text = document.getLineText(line, true);
    lines.push(text);
    characterCount += text.length;
  }
  return { lines, characterCount };
}

// The kind and size of every hunk block, in order, three numbers per block: 0
// and its line count for context, 1 and its old and new line counts for
// changes, and 2 between hunks.
function getBlockSizes(diff: FileDiffMetadata): number[] {
  const sizes: number[] = [];
  for (const hunk of diff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') sizes.push(0, content.lines, 0);
      else sizes.push(1, content.deletions, content.additions);
    }
    sizes.push(2, 0, 0);
  }
  return sizes;
}

// The rows each split view column shows for the blocks from `getBlockSizes`:
// a run of line rows as a positive count, a run of filler rows as a negative
// count, and 0 between hunks.
function getSplitColumnRows(sizes: number[]): number[] {
  const rows: number[] = [];
  const pushLines = (count: number) => {
    if (count <= 0) return;
    const last = rows.length - 1;
    if (last >= 0 && rows[last] > 0) rows[last] += count;
    else rows.push(count);
  };
  for (const side of ['deletions', 'additions']) {
    for (let index = 0; index < sizes.length; index += 3) {
      const kind = sizes[index];
      const deletions = sizes[index + 1];
      const additions = sizes[index + 2];
      if (kind === 2) {
        rows.push(0);
      } else if (kind === 0) {
        pushLines(deletions);
      } else {
        const lines = side === 'deletions' ? deletions : additions;
        pushLines(lines);
        if (lines < Math.max(deletions, additions)) {
          rows.push(lines - Math.max(deletions, additions));
        }
      }
    }
  }
  return rows;
}

function areNumberArraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
