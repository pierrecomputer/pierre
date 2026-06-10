import { computeLineOffsets } from '../utils/computeFileOffsets';
import type { SearchParams } from './searchPanel';
import type { Position, Range, ResolvedTextEdit } from './textDocument';

const MAX_FIND_MATCHES = 100000;
// TODO(ije): use Intl.Segmenter instead of regex for word separators
const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?' as const;

// A piece is a segment of text that is either original or added.
class Piece {
  static Original = 0;
  static Added = 1;

  constructor(
    public readonly source: number,
    public readonly offset: number,
    public readonly length: number,
    public readonly lineOffsetStart: number,
    public readonly lineOffsetEnd: number
  ) {}

  get lineBreakCount(): number {
    return this.lineOffsetEnd - this.lineOffsetStart;
  }
}

// A text buffer is a string with its line offsets.
class TextBuffer {
  lineOffsets: number[];

  constructor(public text: string) {
    this.lineOffsets = computeLineOffsets(text);
  }

  // the append operation is efficient because it only appends
  // elements to the lineOffsets array in the end
  append(text: string): number {
    const offset = this.text.length;
    const appendedLineOffsets = computeLineOffsets(text);
    for (let i = 1; i < appendedLineOffsets.length; i++) {
      this.lineOffsets.push(offset + appendedLineOffsets[i]);
    }
    this.text += text;
    return offset;
  }
}

// A node in the balanced piece tree.
class PieceNode {
  left: PieceNode | null = null;
  right: PieceNode | null = null;
  parent: PieceNode | null = null;

  constructor(
    public piece: Piece,
    public subtreeLength: number = piece.length,
    public subtreeLineBreakCount: number = piece.lineBreakCount
  ) {}

  updateSubtreeLength(): void {
    this.subtreeLength =
      (this.left?.subtreeLength ?? 0) +
      this.piece.length +
      (this.right?.subtreeLength ?? 0);
    this.subtreeLineBreakCount =
      (this.left?.subtreeLineBreakCount ?? 0) +
      this.piece.lineBreakCount +
      (this.right?.subtreeLineBreakCount ?? 0);
  }
}

/**
 * A piece table is a data structure that allows for efficient insertion and deletion of text.
 * It is a tree of pieces, where each piece is a segment of text that is either original or added.
 * The tree is rebuilt as a balanced tree after edits to keep lookups efficient.
 * Inspired by https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation
 */
export class PieceTable {
  #original: TextBuffer;
  #add = new TextBuffer('');
  #root: PieceNode | null = null;
  #piecesCache: Piece[] = [];
  #length = 0;
  #lineCount = 0;
  #lastVisitedLine: [number, boolean, string] | null = null;
  #lastVisitedLineLength: [number, boolean, number] | null = null;

  constructor(originalText: string) {
    this.#original = new TextBuffer(originalText);
    this.#setPieces([
      this.#createPiece(Piece.Original, 0, originalText.length),
    ]);
  }

  get lineCount(): number {
    return this.#lineCount;
  }

  getText(range?: Range): string {
    if (range === undefined) {
      return this.#textFromPieces();
    }
    const start = this.offsetAt(range.start);
    const end = this.offsetAt(range.end);
    return this.getTextSlice(start, end);
  }

  getLineText(line: number, includeLineBreak = false): string {
    if (
      this.#lastVisitedLine !== null &&
      this.#lastVisitedLine[0] === line &&
      this.#lastVisitedLine[1] === includeLineBreak
    ) {
      return this.#lastVisitedLine[2];
    }
    const offset = this.#getLineOffset(line);
    if (offset === undefined) {
      throw new Error(`Line index out of range: ${line}`);
    }
    const text = this.getTextSlice(offset[0], offset[1], !includeLineBreak);
    this.#lastVisitedLine = [line, includeLineBreak, text];
    this.#lastVisitedLineLength = [line, includeLineBreak, text.length];
    return text;
  }

  getLineLength(line: number, includeLineBreak = false): number {
    const lastVisitedLineLength = this.#lastVisitedLineLength;
    const lastVisitedLine = this.#lastVisitedLine;
    if (
      lastVisitedLineLength !== null &&
      lastVisitedLineLength[0] === line &&
      lastVisitedLineLength[1] === includeLineBreak
    ) {
      return lastVisitedLineLength[2];
    }
    if (
      lastVisitedLine !== null &&
      lastVisitedLine[0] === line &&
      lastVisitedLine[1] === includeLineBreak
    ) {
      const length = lastVisitedLine[2].length;
      this.#lastVisitedLineLength = [line, includeLineBreak, length];
      return length;
    }
    const offset = this.#getLineOffset(line);
    if (offset === undefined) {
      throw new Error(`Line index out of range: ${line}`);
    }
    const [start, end] = offset;
    let length = end - start;
    if (!includeLineBreak) {
      while (
        length > 0 &&
        isEOL(this.charAt(start + length - 1).charCodeAt(0))
      ) {
        length--;
      }
    }
    this.#lastVisitedLineLength = [line, includeLineBreak, length];
    return length;
  }

  getTextSlice(start: number, end: number, trimEOF = false): string {
    if (start >= end) {
      return '';
    }

    const sliceStart = clamp(start, 0, this.#length);
    const sliceEnd = clamp(end, sliceStart, this.#length);
    if (sliceStart >= sliceEnd) {
      return '';
    }

    const location = this.#findPieceAtOffset(sliceStart);
    if (location === undefined) {
      return '';
    }

    const chunks: string[] = [];
    let [node, offsetInPiece] = location as [PieceNode | null, number];
    let remaining = sliceEnd - sliceStart;
    while (node !== null && remaining > 0) {
      const takeLength = Math.min(node.piece.length - offsetInPiece, remaining);
      const buffer = this.#bufferFor(node.piece.source);
      const start = node.piece.offset + offsetInPiece;
      let end = start + takeLength;
      if (trimEOF) {
        while (end > start && isEOL(buffer.text.charCodeAt(end - 1))) {
          end--;
        }
      }
      chunks.push(buffer.text.slice(start, end));
      remaining -= takeLength;
      offsetInPiece = 0;
      node = this.#nextNode(node);
    }

    return chunks.join('');
  }

  charAt(offset: number): string {
    const location = this.#findPieceAtOffset(offset);
    if (location === undefined) {
      return '';
    }

    const [node, offsetInPiece] = location;
    const buffer = this.#bufferFor(node.piece.source);
    return buffer.text.charAt(node.piece.offset + offsetInPiece);
  }

  includes(needle: string): boolean {
    if (needle.length === 0) {
      return true;
    }

    const prefixTable = createPrefixTable(needle);
    let matched = 0;
    let found = false;
    this.#forEachPieceSegment((segment) => {
      for (let offset = segment.start; offset < segment.end; offset++) {
        const charCode = segment.text.charCodeAt(offset);
        while (matched > 0 && charCode !== needle.charCodeAt(matched)) {
          matched = prefixTable[matched - 1];
        }
        if (charCode === needle.charCodeAt(matched)) {
          matched++;
        }
        if (matched === needle.length) {
          found = true;
          return false;
        }
      }
      return true;
    });
    return found;
  }

  findNextNonOverlappingSubstring(
    needle: string,
    occupied: readonly [start: number, end: number][]
  ): number | undefined {
    if (needle.length === 0 || needle.length > this.#length) {
      return undefined;
    }

    const ranges = normalizeRanges(occupied, this.#length);
    const pivot = ranges.reduce((max, [, end]) => Math.max(max, end), 0);
    const prefixTable = createPrefixTable(needle);
    let matched = 0;
    let documentOffset = 0;
    let wrappedOffset: number | undefined;
    let foundOffset: number | undefined;

    this.#forEachPieceSegment((segment) => {
      for (let offset = segment.start; offset < segment.end; offset++) {
        const charCode = segment.text.charCodeAt(offset);
        while (matched > 0 && charCode !== needle.charCodeAt(matched)) {
          matched = prefixTable[matched - 1];
        }
        if (charCode === needle.charCodeAt(matched)) {
          matched++;
        }
        if (matched === needle.length) {
          const start = documentOffset - needle.length + 1;
          if (!rangeOverlaps(ranges, start, start + needle.length)) {
            if (start >= pivot) {
              foundOffset = start;
              return false;
            }
            wrappedOffset ??= start;
          }
          matched = prefixTable[matched - 1];
        }
        documentOffset++;
      }
      return true;
    });

    return foundOffset ?? wrappedOffset;
  }

  search(searchParams: SearchParams): [start: number, end: number][] {
    if (searchParams.text.length === 0 || this.#length === 0) {
      return [];
    }

    // Search currently operates line-by-line, so newline-spanning patterns are unsupported.
    if (
      searchParams.text.includes('\n') ||
      searchParams.text.includes('\r') ||
      (searchParams.regex &&
        (searchParams.text.includes('\\n') ||
          searchParams.text.includes('\\r')))
    ) {
      return [];
    }

    let pattern: RegExp;
    try {
      pattern = compileSearchRegExp(
        searchParams.text,
        searchParams.regex,
        searchParams.caseSensitive
      );
    } catch {
      return [];
    }

    return this.#collectSearchMatchesLineByLine(
      pattern,
      searchParams.wholeWord,
      MAX_FIND_MATCHES
    );
  }

  #collectSearchMatchesLineByLine(
    pattern: RegExp,
    wholeWord: boolean,
    limit: number
  ): [number, number][] {
    const out: [number, number][] = [];
    const docLength = this.#length;
    const charAt = (offset: number) => this.charAt(offset);

    for (let line = 0; line < this.#lineCount; line++) {
      const lineText = this.getLineText(line);
      const lineStart = this.offsetAt({ line, character: 0 });
      const re = new RegExp(pattern.source, pattern.flags);
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(lineText)) !== null) {
        const rel = match.index;
        const fragment = match[0];
        if (fragment.length === 0) {
          re.lastIndex = advancePastEmptyMatch(lineText, rel);
          continue;
        }
        const docStart = lineStart + rel;
        if (
          !wholeWord ||
          isWholeWordAtDocOffsets(docStart, fragment.length, docLength, charAt)
        ) {
          out.push([docStart, docStart + fragment.length]);
          if (out.length >= limit) {
            return out;
          }
        }
        if (rel === re.lastIndex) {
          re.lastIndex = advancePastEmptyMatch(lineText, rel);
        }
      }
    }
    return out;
  }

  insert(text: string, offset: number): void {
    if (text.length === 0) {
      return;
    }

    const insertOffset = clamp(offset, 0, this.#length);
    const addOffset = this.#add.append(text);
    const insertedPiece = this.#createPiece(
      Piece.Added,
      addOffset,
      text.length
    );
    const pieces = this.#pieces();
    const nextPieces: Piece[] = [];

    let cursor = 0;
    let inserted = false;

    for (const piece of pieces) {
      const pieceEnd = cursor + piece.length;
      if (!inserted && insertOffset <= pieceEnd) {
        const splitOffset = insertOffset - cursor;
        if (splitOffset > 0) {
          nextPieces.push(
            this.#createPiece(piece.source, piece.offset, splitOffset)
          );
        }
        nextPieces.push(insertedPiece);
        if (splitOffset < piece.length) {
          nextPieces.push(
            this.#createPiece(
              piece.source,
              piece.offset + splitOffset,
              piece.length - splitOffset
            )
          );
        }
        inserted = true;
      } else {
        nextPieces.push(piece);
      }
      cursor = pieceEnd;
    }

    if (!inserted) {
      nextPieces.push(insertedPiece);
    }

    this.#setPieces(nextPieces);
    this.#lastVisitedLine = null;
    this.#lastVisitedLineLength = null;
  }

  delete(offset: number, length: number): void {
    if (length <= 0 || this.#length === 0) {
      return;
    }

    const start = clamp(offset, 0, this.#length);
    const end = clamp(start + length, start, this.#length);
    if (start === end) {
      return;
    }

    const nextPieces: Piece[] = [];
    let cursor = 0;
    for (const piece of this.#pieces()) {
      const pieceStart = cursor;
      const pieceEnd = cursor + piece.length;
      const keepBefore = clamp(start - pieceStart, 0, piece.length);
      const keepAfter = clamp(pieceEnd - end, 0, piece.length);

      if (keepBefore > 0) {
        nextPieces.push(
          this.#createPiece(piece.source, piece.offset, keepBefore)
        );
      }
      if (keepAfter > 0) {
        nextPieces.push(
          this.#createPiece(
            piece.source,
            piece.offset + piece.length - keepAfter,
            keepAfter
          )
        );
      }
      cursor = pieceEnd;
    }

    this.#setPieces(nextPieces);
    this.#lastVisitedLine = null;
    this.#lastVisitedLineLength = null;
  }

  applyEdits(edits: readonly ResolvedTextEdit[]): void {
    if (edits.length === 0) {
      return;
    }

    let pieceIndex = 0;
    let pieceStart = 0;
    let copyCursor = 0;

    const pieces = this.#pieces();
    const insertedPieces = edits.map((edit) =>
      edit.text.length === 0
        ? undefined
        : this.#createPiece(
            Piece.Added,
            this.#add.append(edit.text),
            edit.text.length
          )
    );
    const nextPieces: Piece[] = [];

    const advancePiece = () => {
      const piece = pieces[pieceIndex];
      if (piece !== undefined) {
        pieceStart += piece.length;
        pieceIndex++;
      }
    };

    const appendRange = (start: number, end: number) => {
      let rangeStart = clamp(start, 0, this.#length);
      const rangeEnd = clamp(end, rangeStart, this.#length);
      while (
        pieceIndex < pieces.length &&
        pieceStart + pieces[pieceIndex].length <= rangeStart
      ) {
        advancePiece();
      }
      while (pieceIndex < pieces.length && rangeStart < rangeEnd) {
        const piece = pieces[pieceIndex];
        const pieceEnd = pieceStart + piece.length;
        const offsetInPiece = clamp(rangeStart - pieceStart, 0, piece.length);
        const takeEnd = Math.min(pieceEnd, rangeEnd);
        const takeLength = takeEnd - (pieceStart + offsetInPiece);
        if (takeLength > 0) {
          nextPieces.push(
            offsetInPiece === 0 && takeLength === piece.length
              ? piece
              : this.#createPiece(
                  piece.source,
                  piece.offset + offsetInPiece,
                  takeLength
                )
          );
        }
        rangeStart = takeEnd;
        if (rangeStart >= pieceEnd) {
          advancePiece();
        }
      }
    };

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const start = clamp(edit.start, copyCursor, this.#length);
      const end = clamp(edit.end, start, this.#length);
      appendRange(copyCursor, start);

      const insertedPiece = insertedPieces[i];
      if (insertedPiece !== undefined) {
        nextPieces.push(insertedPiece);
      }
      copyCursor = end;
    }
    appendRange(copyCursor, this.#length);

    this.#setPieces(nextPieces);
    this.#lastVisitedLine = null;
    this.#lastVisitedLineLength = null;
  }

  positionAt(offset: number): Position {
    const clampedOffset = clamp(offset, 0, this.#length);
    if (this.#length === 0) {
      return { line: 0, character: 0 };
    }
    const line = this.#lineAtOffset(clampedOffset);
    const lineStart = line === 0 ? 0 : this.#lineBreakOffset(line - 1);
    return {
      line,
      character: clampedOffset - lineStart,
    };
  }

  positionsAt(offsets: readonly number[]): Position[] {
    const positions: Position[] = Array.from({ length: offsets.length });
    if (offsets.length === 0) {
      return positions;
    }
    if (this.#length === 0) {
      return positions.fill({ line: 0, character: 0 });
    }

    for (let i = 0; i < offsets.length; i++) {
      positions[i] = this.positionAt(offsets[i]);
    }

    return positions;
  }

  offsetAt(position: Position): number {
    if (position.line < 0 || this.#length === 0) {
      return 0;
    }
    if (position.line >= this.#lineCount) {
      throw new Error(`Line index out of range: ${position.line}`);
    }
    const offset = this.#getLineOffset(position.line);
    if (offset === undefined) {
      throw new Error(`Line index out of range: ${position.line}`);
    }
    const character = clamp(position.character, 0, offset[1] - offset[0]);
    return offset[0] + character;
  }

  #findPieceAtOffset(
    offset: number
  ): [node: PieceNode, offsetInPiece: number] | undefined {
    if (offset < 0 || offset >= this.#length) {
      return undefined;
    }

    let node = this.#root;
    let remaining = offset;
    while (node !== null) {
      const leftLength = node.left?.subtreeLength ?? 0;
      if (remaining < leftLength) {
        node = node.left;
        continue;
      }

      remaining -= leftLength;
      if (remaining < node.piece.length) {
        return [node, remaining];
      }

      remaining -= node.piece.length;
      node = node.right;
    }

    return undefined;
  }

  #nextNode(node: PieceNode): PieceNode | null {
    if (node.right !== null) {
      let next = node.right;
      while (next.left !== null) {
        next = next.left;
      }
      return next;
    }

    let current = node;
    while (current.parent !== null && current === current.parent.right) {
      current = current.parent;
    }
    return current.parent;
  }

  #getLineOffset(line: number): [start: number, end: number] | undefined {
    if (line < 0) {
      throw new Error(`Line index out of range: ${line}`);
    }
    if (this.#length === 0) {
      if (line === 0) {
        return [0, 0];
      }
      throw new Error(`Line index out of range: ${line}`);
    }
    if (line >= this.#lineCount) {
      throw new Error(`Line index out of range: ${line}`);
    }

    const start = line === 0 ? 0 : this.#lineBreakOffset(line - 1);
    const end =
      line < this.#lineCount - 1 ? this.#lineBreakOffset(line) : this.#length;
    return [start, end];
  }

  #lineAtOffset(offset: number): number {
    let node = this.#root;
    let remaining = clamp(offset, 0, this.#length);
    let line = 0;

    while (node !== null) {
      const leftLength = node.left?.subtreeLength ?? 0;
      if (remaining < leftLength) {
        node = node.left;
        continue;
      }

      line += node.left?.subtreeLineBreakCount ?? 0;
      remaining -= leftLength;
      if (remaining <= node.piece.length) {
        const buffer = this.#bufferFor(node.piece.source);
        line +=
          upperBound(buffer.lineOffsets, node.piece.offset + remaining) -
          node.piece.lineOffsetStart;
        return line;
      }

      line += node.piece.lineBreakCount;
      remaining -= node.piece.length;
      node = node.right;
    }

    return this.#lineCount - 1;
  }

  #lineBreakOffset(lineBreakIndex: number): number {
    let node = this.#root;
    let remaining = lineBreakIndex;
    let documentOffset = 0;

    while (node !== null) {
      const leftLineBreakCount = node.left?.subtreeLineBreakCount ?? 0;
      if (remaining < leftLineBreakCount) {
        node = node.left;
        continue;
      }

      const leftLength = node.left?.subtreeLength ?? 0;
      documentOffset += leftLength;
      remaining -= leftLineBreakCount;

      if (remaining < node.piece.lineBreakCount) {
        const bufferLineOffset = this.#bufferFor(node.piece.source).lineOffsets[
          node.piece.lineOffsetStart + remaining
        ];
        return documentOffset + (bufferLineOffset - node.piece.offset);
      }

      documentOffset += node.piece.length;
      remaining -= node.piece.lineBreakCount;
      node = node.right;
    }

    return this.#length;
  }

  #textFromPieces(): string {
    const chunks: string[] = [];
    this.#forEachPieceSegment((segment) => {
      chunks.push(segment.text.slice(segment.start, segment.end));
    });
    return chunks.join('');
  }

  #forEachPieceSegment(
    callback: (segment: {
      readonly start: number;
      readonly end: number;
      readonly text: string;
      readonly lineOffsets: number[];
      readonly lineOffsetStart: number;
      readonly lineOffsetEnd: number;
    }) => boolean | void
  ): void {
    this.#walk(this.#root, (node) => {
      const buffer = this.#bufferFor(node.piece.source);
      return callback({
        text: buffer.text,
        lineOffsets: buffer.lineOffsets,
        lineOffsetStart: node.piece.lineOffsetStart,
        lineOffsetEnd: node.piece.lineOffsetEnd,
        start: node.piece.offset,
        end: node.piece.offset + node.piece.length,
      });
    });
  }

  #bufferFor(source: number): TextBuffer {
    return source === Piece.Original ? this.#original : this.#add;
  }

  #createPiece(source: number, offset: number, length: number): Piece {
    const buffer = this.#bufferFor(source);
    return new Piece(
      source,
      offset,
      length,
      upperBound(buffer.lineOffsets, offset),
      upperBound(buffer.lineOffsets, offset + length)
    );
  }

  #pieces(): Piece[] {
    return this.#piecesCache;
  }

  #setPieces(pieces: Piece[]): void {
    const coalescedPieces = coalescePieces(pieces);
    this.#piecesCache = coalescedPieces;
    let length = 0;
    let lineBreakCount = 0;
    for (const piece of coalescedPieces) {
      length += piece.length;
      lineBreakCount += piece.lineBreakCount;
    }
    this.#root = this.#buildBalancedTree(
      coalescedPieces,
      0,
      coalescedPieces.length,
      null
    );
    this.#length = length;
    this.#lineCount = lineBreakCount + 1;
  }

  #buildBalancedTree(
    pieces: Piece[],
    start: number,
    end: number,
    parent: PieceNode | null
  ): PieceNode | null {
    if (start >= end) {
      return null;
    }

    const middle = start + Math.floor((end - start) / 2);
    const node = new PieceNode(pieces[middle]);
    node.parent = parent;
    node.left = this.#buildBalancedTree(pieces, start, middle, node);
    node.right = this.#buildBalancedTree(pieces, middle + 1, end, node);
    node.updateSubtreeLength();
    return node;
  }

  #walk(
    node: PieceNode | null,
    visit: (node: PieceNode) => boolean | void
  ): boolean {
    if (node === null) {
      return true;
    }
    if (!this.#walk(node.left, visit)) {
      return false;
    }
    if (visit(node) === false) {
      return false;
    }
    return this.#walk(node.right, visit);
  }
}

function isEOL(charCode: number): boolean {
  return charCode === /* \n */ 10 || charCode === /* \r */ 13;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createPrefixTable(text: string): number[] {
  const table = Array.from<number>({ length: text.length }).fill(0);
  let matched = 0;
  for (let i = 1; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    while (matched > 0 && charCode !== text.charCodeAt(matched)) {
      matched = table[matched - 1];
    }
    if (charCode === text.charCodeAt(matched)) {
      matched++;
    }
    table[i] = matched;
  }
  return table;
}

function normalizeRanges(
  ranges: readonly [start: number, end: number][],
  length: number
): [start: number, end: number][] {
  const normalized: [start: number, end: number][] = [];
  for (const [rawStart, rawEnd] of ranges) {
    const start = clamp(rawStart, 0, length);
    const end = clamp(rawEnd, start, length);
    if (start < end) {
      normalized.push([start, end]);
    }
  }
  normalized.sort((a, b) => a[0] - b[0]);

  const merged: [start: number, end: number][] = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
      continue;
    }
    merged.push(range);
  }
  return merged;
}

function rangeOverlaps(
  ranges: readonly [start: number, end: number][],
  start: number,
  end: number
): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (ranges[mid][1] <= start) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const range = ranges[low];
  return range !== undefined && range[0] < end;
}

// Keeps the table compact after repeated edits by joining neighboring pieces
// that already point at contiguous text in the same backing buffer.
function coalescePieces(pieces: Piece[]): Piece[] {
  const coalescedPieces: Piece[] = [];
  for (const piece of pieces) {
    if (piece.length === 0) {
      continue;
    }

    const previous = coalescedPieces[coalescedPieces.length - 1];
    if (
      previous !== undefined &&
      previous.source === piece.source &&
      previous.offset + previous.length === piece.offset
    ) {
      coalescedPieces[coalescedPieces.length - 1] = new Piece(
        previous.source,
        previous.offset,
        previous.length + piece.length,
        previous.lineOffsetStart,
        piece.lineOffsetEnd
      );
      continue;
    }

    coalescedPieces.push(piece);
  }
  return coalescedPieces;
}

// Returns the index of the first element in the array that is greater than the target.
function upperBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (values[mid] <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordSeparatorCharCode(charCode: number): boolean {
  if (charCode <= 32 || charCode === 127) {
    return true;
  }
  const ch = String.fromCharCode(charCode);
  return WORD_SEPARATORS.includes(ch);
}

// Checks if the given text is a whole word by checking if the
// characters before and after are word separators.
function isWholeWordAtDocOffsets(
  docStart: number,
  length: number,
  docLength: number,
  charAt: (offset: number) => string
): boolean {
  const beforeOk =
    docStart <= 0 ||
    isWordSeparatorCharCode(charCodeUnitAt(charAt, docStart - 1));
  const afterOk =
    docStart + length >= docLength ||
    isWordSeparatorCharCode(charCodeUnitAt(charAt, docStart + length));
  return beforeOk && afterOk;
}

function charCodeUnitAt(
  charAt: (offset: number) => string,
  offset: number
): number {
  const unit = charAt(offset);
  return unit.length === 0 ? 0 : unit.charCodeAt(0);
}

function compileSearchRegExp(
  source: string,
  isRegex: boolean,
  caseSensitive: boolean
): RegExp {
  const body = isRegex ? source : escapeRegExp(source);
  const flags = `g${caseSensitive ? '' : 'i'}${isRegex ? 'm' : ''}`;
  return new RegExp(body, flags);
}

function advancePastEmptyMatch(text: string, index: number): number {
  if (index + 1 < text.length) {
    const first = text.charCodeAt(index);
    const second = text.charCodeAt(index + 1);
    if (
      first >= 0xd800 &&
      first <= 0xdbff &&
      second >= 0xdc00 &&
      second <= 0xdfff
    ) {
      return index + 2;
    }
  }
  return index + 1;
}
