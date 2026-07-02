import type { DiffLineAnnotation } from '../types';
import { countLineBreaks } from '../utils/computeFileOffsets';
import {
  coalesceEditStackEntries,
  createEditStackEntry,
  EditStack,
  shouldCoalesceEditStackEntry,
} from './editStack';
import { PieceTable } from './pieceTable';
import type { SearchParams } from './searchPanel';
import { type EditorSelection } from './selection';

/**
 * Position in a text document expressed as zero-based line and character offset.
 * The offsets are based on a UTF-16 string representation. So a string of the form
 * `a𐐀b` the character offset of the character `a` is 0, the character offset of `𐐀`
 * is 1 and the character offset of b is 3 since `𐐀` is represented using two code
 * units in UTF-16.
 *
 * Positions are line end character agnostic. So you can not specify a position that
 * denotes `\r|\n` or `\n|` where `|` represents the character offset.
 */
export interface Position {
  /**
   * Line position in a document (zero-based).
   *
   * If a line number is greater than the number of lines in a document, it
   * defaults back to the number of lines in the document.
   * If a line number is negative, it defaults to 0.
   *
   * The above two properties are implementation specific.
   */
  readonly line: number;
  /**
   * Character offset on a line in a document (zero-based).
   *
   * The meaning of this offset is determined by the negotiated
   * `PositionEncodingKind`.
   *
   * If the character value is greater than the line length it defaults back
   * to the line length. This property is implementation specific.
   */
  readonly character: number;
}

/**
 * A range in a text document expressed as (zero-based) start and end positions.
 *
 * If you want to specify a range that contains a line including the line ending
 * character(s) then use an end position denoting the start of the next line.
 * For example:
 * ```ts
 * {
 *     start: { line: 5, character: 23 }
 *     end : { line 6, character : 0 }
 * }
 * ```
 */
export interface Range {
  /**
   * The range's start position.
   */
  readonly start: Position;
  /**
   * The range's end position.
   */
  readonly end: Position;
}

/**
 * A text edit applicable to a text document.
 */
export interface TextEdit {
  /**
   * The range of the text document to be manipulated. To insert
   * text into a document create a range where start === end.
   */
  readonly range: Range;
  /**
   * The string to be inserted. For delete operations use an
   * empty string.
   */
  readonly newText: string;
}

/** Different with `TextEdit`, the range has been resolved to offsets. */
export interface ResolvedTextEdit {
  /** The start offset of the text change. */
  readonly start: number;
  /** The end offset of the text change. */
  readonly end: number;
  /**
   * The string to be inserted. For delete operations use an
   * empty string.
   */
  readonly text: string;
}

export interface TextDocumentLineChange {
  /** Line where this edit starts, adjusted for previous edits in the batch. */
  readonly startLine: number;
  /** Character on the start line where this edit begins. */
  readonly startCharacter: number;
  /** Line where this edit ends, adjusted for previous edits in the batch. */
  readonly endLine: number;
  /** Character on the end line where this edit ends. */
  readonly endCharacter: number;
  /** Number of line breaks inserted by this edit's replacement text. */
  readonly insertedLineBreaks: number;
  /** Difference between old and new line counts for this edit. */
  readonly lineDelta: number;
}

export interface TextDocumentChange {
  /** First line whose rendered content or tokenizer state may have changed. */
  readonly startLine: number;
  /** Character on the first changed line where the edit began. */
  readonly startCharacter: number;
  /** Last line whose rendered content may have changed after the edit. */
  readonly endLine: number;
  /** Line count before the edit was applied. */
  readonly previousLineCount: number;
  /** Line count after the edit was applied. */
  readonly lineCount: number;
  /** Difference between the old and new line counts. */
  readonly lineDelta: number;
  /** Exact rendered line ranges touched by each edit after the edit was applied. */
  readonly changedLineRanges: readonly [startLine: number, endLine: number][];
  /**
   * Per-edit line changes, stored non-enumerably by TextDocument so exact
   * object assertions and public logging keep the compact change shape.
   */
  readonly lineChanges?: readonly TextDocumentLineChange[];
}

/**
 * A vscode-languageserver-textdocument compatible text document.
 */
export class TextDocument<LAnnotation> {
  #uri: string;
  #languageId: string;
  #version: number;
  #pieceTable: PieceTable;
  #editStack: EditStack<LAnnotation>;

  constructor(
    uri: string,
    text: string,
    languageId = 'plaintext',
    version = 0,
    editStack: EditStack<LAnnotation> = new EditStack()
  ) {
    this.#uri = new URL(uri, 'file://').toString();
    this.#languageId = languageId;
    this.#version = version;
    this.#pieceTable = new PieceTable(text);
    this.#editStack = editStack;
  }

  get uri(): string {
    return this.#uri;
  }

  get languageId(): string {
    return this.#languageId;
  }

  get version(): number {
    return this.#version;
  }

  get lineCount(): number {
    return this.#pieceTable.lineCount;
  }

  // The line ending the document uses, detected from its first line. Lets
  // inserted or pasted text match the rest of the file instead of leaving
  // mixed endings behind. Recognizes Windows `\r\n` and classic-Mac lone `\r`
  // breaks (both of which the piece table already splits on), defaulting to
  // Unix `\n`.
  get eol(): string {
    if (this.lineCount > 1) {
      const firstLineBreak = this.getLineText(0, true);
      if (firstLineBreak.endsWith('\r\n')) {
        return '\r\n';
      }
      if (firstLineBreak.endsWith('\r')) {
        return '\r';
      }
    }
    return '\n';
  }

  get canUndo(): boolean {
    return this.#editStack.canUndo;
  }

  get canRedo(): boolean {
    return this.#editStack.canRedo;
  }

  positionAt(offset: number): Position {
    return this.#pieceTable.positionAt(offset);
  }

  positionsAt(offsets: readonly number[]): Position[] {
    return this.#pieceTable.positionsAt(offsets);
  }

  offsetAt(position: Position): number {
    return this.#pieceTable.offsetAt(this.normalizePosition(position));
  }

  getText(range?: Range): string {
    if (range === undefined) {
      return this.#pieceTable.getText();
    }
    // Clamp the range to visible line content before extracting text. A
    // preserved vertical-move "goal column" can leave a selection focus whose
    // character overshoots a shorter line; without this, the piece table clamps
    // to the line's offset span (which includes the trailing line break) and
    // copy/cut would pull in that newline. Mirrors `offsetAt`, which normalizes
    // positions the same way.
    return this.#pieceTable.getText({
      start: this.normalizePosition(range.start),
      end: this.normalizePosition(range.end),
    });
  }

  getLineText(line: number, includeLineBreak?: boolean): string {
    return this.#pieceTable.getLineText(line, includeLineBreak);
  }

  // Rewrites every line break in `text` to the document's EOL. Clipboard text
  // can carry Windows (`\r\n`) or classic-Mac (`\r`) breaks; inserting it
  // verbatim would leave mixed line endings in a file that uses one style.
  normalizeEol(text: string): string {
    return text.replace(/\r\n|\r|\n/g, this.eol);
  }

  getLineLength(line: number, includeLineBreak?: boolean): number {
    return this.#pieceTable.getLineLength(line, includeLineBreak);
  }

  charAt(offset: number): string;
  charAt(position: Position): string;
  charAt(positionOrOffset: Position | number): string {
    if (typeof positionOrOffset === 'number') {
      return this.#pieceTable.charAt(positionOrOffset);
    }
    return this.#pieceTable.charAt(this.offsetAt(positionOrOffset));
  }

  getTextSlice(start: number, end: number): string {
    return this.#pieceTable.getTextSlice(start, end);
  }

  findNextNonOverlappingSubstring(
    needle: string,
    occupied: readonly [start: number, end: number][]
  ): number | undefined {
    return this.#pieceTable.findNextNonOverlappingSubstring(needle, occupied);
  }

  search(searchParams: SearchParams): [start: number, end: number][] {
    return this.#pieceTable.search(searchParams);
  }

  applyEdits(
    edits: TextEdit[],
    updateHistory = false,
    selectionsBefore?: EditorSelection[],
    selectionsAfter?: EditorSelection[],
    undoBoundary = false
  ): TextDocumentChange | undefined {
    if (edits.length === 0) {
      return;
    }
    return this.applyResolvedEdits(
      edits.map((edit) => this.#resolveEdit(edit)),
      updateHistory,
      selectionsBefore,
      selectionsAfter,
      undoBoundary
    );
  }

  applyResolvedEdits(
    edits: ResolvedTextEdit[],
    updateHistory = false,
    selectionsBefore?: EditorSelection[],
    selectionsAfter?: EditorSelection[],
    undoBoundary = false
  ): TextDocumentChange | undefined {
    if (edits.length === 0) {
      return undefined;
    }
    const resolvedEdits = this.#sortAndValidateResolvedEdits(edits);
    if (updateHistory) {
      const entry = createEditStackEntry(
        this,
        resolvedEdits,
        this.#version,
        this.#version + 1,
        selectionsBefore,
        selectionsAfter
      );
      if (undoBoundary) {
        entry.undoBoundary = true;
      }
      const previousEntry = this.#editStack.peekUndo();
      const change = this.#applyResolvedEditsToBuffer(resolvedEdits);
      this.#version++;
      if (
        change.lineDelta === 0 &&
        shouldCoalesceEditStackEntry(previousEntry, entry)
      ) {
        this.#editStack.replaceLastUndo(
          coalesceEditStackEntries(previousEntry!, entry)
        );
      } else {
        this.#editStack.push(entry);
      }
      return change;
    }
    const change = this.#applyResolvedEditsToBuffer(resolvedEdits);
    this.#version++;
    return change;
  }

  setLastUndoSelectionsAfter(selections: EditorSelection[]): void {
    this.#editStack.setLastUndoSelectionsAfter(selections);
  }

  setLastUndoLineAnnotations(
    lineAnnotationsBefore: DiffLineAnnotation<LAnnotation>[],
    lineAnnotationsAfter: DiffLineAnnotation<LAnnotation>[]
  ): void {
    this.#editStack.setLastUndoLineAnnotations(
      lineAnnotationsBefore,
      lineAnnotationsAfter
    );
  }

  undo():
    | [
        change: TextDocumentChange,
        selections?: EditorSelection[],
        lineAnnotations?: DiffLineAnnotation<LAnnotation>[],
      ]
    | undefined {
    const entry = this.#editStack.popUndoToRedo();
    if (entry === undefined) {
      return undefined;
    }
    const change = this.#applyResolvedEditsToBuffer(entry.inverseEdits);
    if (change === undefined) {
      return undefined;
    }
    this.#version = entry.versionBefore;
    return [
      change,
      entry.selectionsBefore?.slice(),
      entry.lineAnnotationsBefore?.slice(),
    ];
  }

  redo():
    | [
        change: TextDocumentChange,
        selections?: EditorSelection[],
        lineAnnotations?: DiffLineAnnotation<LAnnotation>[],
      ]
    | undefined {
    const entry = this.#editStack.popRedoToUndo();
    if (entry === undefined) {
      return undefined;
    }
    const change = this.#applyResolvedEditsToBuffer(entry.forwardEdits);
    if (change === undefined) {
      return undefined;
    }
    this.#version = entry.versionAfter;
    return [
      change,
      entry.selectionsAfter?.slice(),
      entry.lineAnnotationsAfter?.slice(),
    ];
  }

  normalizePosition(position: Position): Position {
    const line = Math.max(0, Math.min(position.line, this.lineCount - 1));
    return {
      line,
      character: Math.max(
        0,
        Math.min(position.character, this.getLineLength(line))
      ),
    };
  }

  #resolveEdit(edit: TextEdit): ResolvedTextEdit {
    let start = this.offsetAt(edit.range.start);
    let end = this.offsetAt(edit.range.end);
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    return { start, end, text: edit.newText };
  }

  #sortAndValidateResolvedEdits(edits: ResolvedTextEdit[]): ResolvedTextEdit[] {
    const sortedEdits = [...edits].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sortedEdits.length - 1; i++) {
      if (sortedEdits[i].end > sortedEdits[i + 1].start) {
        throw new Error('Overlapping text edits are not supported');
      }
    }
    return sortedEdits;
  }

  #applyResolvedEditsToBuffer(edits: ResolvedTextEdit[]): TextDocumentChange {
    const previousLineCount = this.#pieceTable.lineCount;
    const editPositions = this.positionsAt(
      edits.flatMap((edit) => [edit.start, edit.end])
    );
    const changedLineRange = this.#computeChangedLineRange(
      edits,
      editPositions
    );
    const startPosition = editPositions[0];
    this.#pieceTable.applyEdits(edits);
    const lineCount = this.#pieceTable.lineCount;
    const change: TextDocumentChange = {
      startLine: changedLineRange.startLine,
      startCharacter: startPosition.character,
      endLine: Math.min(changedLineRange.endLine, Math.max(0, lineCount - 1)),
      previousLineCount,
      lineCount,
      lineDelta: lineCount - previousLineCount,
      changedLineRanges: changedLineRange.ranges,
    };
    Object.defineProperty(change, 'lineChanges', {
      value: changedLineRange.lineChanges,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return change;
  }

  #computeChangedLineRange(
    edits: ResolvedTextEdit[],
    editPositions: Position[]
  ): {
    startLine: number;
    endLine: number;
    ranges: [number, number][];
    lineChanges: TextDocumentLineChange[];
  } {
    let startLine = Infinity;
    let endLine = 0;
    let lineDeltaBeforeEdit = 0;
    const ranges: [number, number][] = [];
    const lineChanges: TextDocumentLineChange[] = [];
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const editStart = editPositions[i * 2];
      const editEnd = editPositions[i * 2 + 1];
      const editStartLine = editStart.line;
      const editEndLine = editEnd.line;
      const insertedLineSpan = countLineBreaks(edit.text);
      const changedStartLine = editStartLine + lineDeltaBeforeEdit;
      const changedEndLine = changedStartLine + insertedLineSpan;
      const lineDelta = insertedLineSpan - (editEndLine - editStartLine);
      startLine = Math.min(startLine, editStartLine);
      endLine = Math.max(endLine, changedEndLine);
      lineChanges.push({
        startLine: changedStartLine,
        startCharacter: editStart.character,
        endLine: editEndLine + lineDeltaBeforeEdit,
        endCharacter: editEnd.character,
        insertedLineBreaks: insertedLineSpan,
        lineDelta,
      });
      const lastRange = ranges[ranges.length - 1];
      if (lastRange !== undefined && changedStartLine <= lastRange[1] + 1) {
        ranges[ranges.length - 1] = [
          lastRange[0],
          Math.max(lastRange[1], changedEndLine),
        ];
      } else {
        ranges.push([changedStartLine, changedEndLine]);
      }
      lineDeltaBeforeEdit += lineDelta;
    }
    if (startLine === Infinity) {
      return {
        startLine: 0,
        endLine: 0,
        ranges: [[0, 0]],
        lineChanges: [],
      };
    }
    return { startLine, endLine, ranges, lineChanges };
  }
}
