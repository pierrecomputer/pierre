import type { CreatePatchOptionsNonabortable } from 'diff';

import type {
  FileContents,
  FileDiffMetadata,
  Hunk,
  HunkExpansionRegion,
} from '../types';
import { cloneHunks } from '../utils/cloneFileDiffMetadata';
import { countLineBreaks } from '../utils/computeFileOffsets';
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
import { readAllLines, readChangedLines } from './documentLines';
import { LineMap } from './LineMap';
import type {
  DiffModelChange,
  DiffSide,
  DocumentLineChange,
  DocumentLines,
  HunkBlock,
  RetainedDiffSessionSnapshot,
} from './types';

/** What the renderer hands the model with each change and when editing ends. */
export interface ModelSessionState {
  /** Options for recomputing hunks. */
  parseDiffOptions?: CreatePatchOptionsNonabortable;
  /** How far each hunk's collapsed context is expanded, by hunk index. */
  expandedHunks?: Map<number, HunkExpansionRegion>;
}

export interface StartSessionOptions {
  /** Options for the recompute an empty or renamed new file needs at the start. */
  parseDiffOptions?: CreatePatchOptionsNonabortable;
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
  static fromDiff(diff: FileDiffMetadata): DiffModel {
    return new DiffModel(diff, undefined);
  }

  /**
   * A live model for editing `inputDiff`'s new file. The diff is a shallow
   * copy without a cache key; its arrays are shared with the input until an
   * edit replaces them, and the input is never written to.
   */
  static startEditSession(
    inputDiff: FileDiffMetadata,
    options: StartSessionOptions = {}
  ): DiffModel {
    const { document, snapshot, parseDiffOptions } = options;
    if (inputDiff.isPartial) {
      throw new Error(
        'DiffModel.startEditSession: the diff must not be partial'
      );
    }
    const inputContents = inputDiff.additionLines.join('');
    const restoresSnapshot =
      snapshot != null && canRestoreSnapshot(snapshot, inputDiff);
    if (snapshot != null && !restoresSnapshot) {
      throw new Error(
        'DiffModel.startEditSession: the retained session was diffed against a different old file'
      );
    }
    if (
      document != null &&
      document.contents !== inputContents &&
      !restoresSnapshot
    ) {
      throw new Error(
        'DiffModel.startEditSession: retained edits are missing their diff session state'
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
      new LineMap(countLineBreaks(diff.additionLines.join('')) + 1)
    );
    // An empty new file still needs one editable line for the caret. When
    // editing starts this recompute also sets the diff's type, so a deleted
    // file edited from scratch shows its new side.
    if (diff.additionLines.length === 0) {
      Object.assign(diff, recomputeEmptyDocumentDiff(diff, parseDiffOptions));
      diff.editSessionDirty = true;
    }
    return model;
  }

  readonly diff: FileDiffMetadata;
  readonly #lines: LineMap | undefined;
  // The additions array the model started with, shared with the input diff.
  // It is copied once, before the first edit that changes a line in place.
  readonly #sharedAdditionLines: readonly string[];
  #blockIndex: BlockIndex | undefined;

  private constructor(diff: FileDiffMetadata, lines: LineMap | undefined) {
    this.diff = diff;
    this.#lines = lines;
    this.#sharedAdditionLines = diff.additionLines;
  }

  /** Whether this model follows an editor's document. */
  get live(): boolean {
    return this.#lines != null;
  }

  /**
   * The number of new-file lines: the editor document's while editing,
   * otherwise the diff's.
   */
  get lineCount(): number {
    return this.#lines?.lineCount ?? this.diff.additionLines.length;
  }

  /** A stable id for a new-file line while editing; the index otherwise. */
  lineId(line: number): number {
    return this.#lines?.idAt(line) ?? line;
  }

  /** The text of a new-file line, with its line break. */
  lineText(line: number): string {
    return this.diff.additionLines[line] ?? '';
  }

  /** The new-file line that has this id, or undefined once it was deleted. */
  lineOf(id: number): number | undefined {
    return (
      this.#lines?.lineOf(id) ??
      (id < this.diff.additionLines.length ? id : undefined)
    );
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
    document: DocumentLines,
    session: ModelSessionState = {}
  ): DiffModelChange {
    const lines = this.#lines;
    if (lines == null) {
      throw new Error('DiffModel.applyChange: the model is not live');
    }
    const removedLineIds = lines.applyChange(change);
    const { diff } = this;
    const { parseDiffOptions } = session;
    let expandedHunks = session.expandedHunks ?? new Map();
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
        if (diff.additionLines === this.#sharedAdditionLines) {
          diff.additionLines = diff.additionLines.slice();
        }
        diff.additionLines[line] = text;
        diff.additionCharacterCount += text.length - previous.length;
        changedLines.push(line);
        previousTexts.set(line, previous);
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
          expandedHunks = remapExpansion(expandedHunks, regionChange);
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
        expandedHunks = remapExpansion(
          expandedHunks,
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
    return {
      changedLines,
      removedLineIds,
      lineDelta: change.lineDelta,
      regionsChanged,
      expandedHunks,
    };
  }

  /** The id of every line, in line order. */
  lineIds(): number[] {
    return (
      this.#lines?.ids() ??
      Array.from({ length: this.lineCount }, (_, line) => line)
    );
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
   * whether a recompute ran, and the expansion to use from now on.
   */
  finish(
    collapsedContextThreshold: number,
    session: ModelSessionState = {}
  ): { changed: boolean; expandedHunks: Map<number, HunkExpansionRegion> } {
    const { diff } = this;
    const { parseDiffOptions } = session;
    const expandedHunks = session.expandedHunks ?? new Map();
    if (diff.editSessionDirty !== true) {
      return { changed: false, expandedHunks };
    }
    const anchors = captureExpansionAnchors(
      diff,
      expandedHunks,
      collapsedContextThreshold
    );
    finishEditSessionForDiff(diff, parseDiffOptions);
    this.#blockIndex = undefined;
    return {
      changed: true,
      expandedHunks: rebuildExpansionFromAnchors(diff, anchors),
    };
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

// The expansion after a change that moved or replaced regions; unchanged when
// the regions stayed.
function remapExpansion(
  expandedHunks: Map<number, HunkExpansionRegion>,
  change: SessionRegionChange | undefined
): Map<number, HunkExpansionRegion> {
  return change == null
    ? expandedHunks
    : remapExpandedHunksForRegionChange(expandedHunks, change);
}
