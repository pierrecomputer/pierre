import type { Position, Range } from '../types';
import { computeLineOffsets } from '../utils/computeFileOffsets';
import type { SearchParams } from './searchPanel';
import type { ResolvedTextEdit } from './textDocument';

const MAX_FIND_MATCHES = 100000;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
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
    public readonly lineOffsetEnd: number,
    public readonly hasVirtualTrailingCRBreak: boolean,
    public readonly firstCharCode: number,
    public readonly lastCharCode: number
  ) {}

  // A slice ending between a backing-buffer CRLF needs its own lone-CR break
  // until the tree reconnects it to a piece beginning with LF.
  get lineBreakCount(): number {
    return (
      this.lineOffsetEnd -
      this.lineOffsetStart +
      (this.hasVirtualTrailingCRBreak ? 1 : 0)
    );
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

// A node in the balanced piece tree. `priority` keeps the tree balanced as a
// treap (see PieceTable): the tree is a max-heap on priority while staying a
// binary search tree on document offset.
class PieceNode {
  left: PieceNode | null = null;
  right: PieceNode | null = null;
  parent: PieceNode | null = null;
  priority = 0;

  constructor(
    public piece: Piece,
    public subtreeLength: number = piece.length,
    public subtreeLineBreakCount: number = piece.lineBreakCount,
    public subtreeFirstCharCode: number = piece.firstCharCode,
    public subtreeLastCharCode: number = piece.lastCharCode
  ) {}

  updateSubtreeLength(): void {
    this.subtreeLength =
      (this.left?.subtreeLength ?? 0) +
      this.piece.length +
      (this.right?.subtreeLength ?? 0);
    // Pieces count their edge characters in isolation. Collapse a CRLF only
    // when the two characters are actually adjacent in this subtree.
    this.subtreeLineBreakCount =
      (this.left?.subtreeLineBreakCount ?? 0) +
      this.piece.lineBreakCount +
      (this.right?.subtreeLineBreakCount ?? 0) -
      (formsCRLF(this.left?.subtreeLastCharCode, this.piece.firstCharCode)
        ? 1
        : 0) -
      (formsCRLF(this.piece.lastCharCode, this.right?.subtreeFirstCharCode)
        ? 1
        : 0);
    this.subtreeFirstCharCode =
      this.left?.subtreeFirstCharCode ?? this.piece.firstCharCode;
    this.subtreeLastCharCode =
      this.right?.subtreeLastCharCode ?? this.piece.lastCharCode;
  }
}

/**
 * A piece table is a data structure that allows for efficient insertion and deletion of text.
 * It is a tree of pieces, where each piece is a segment of text that is either original or added.
 * The tree is a treap (a binary search tree that also keeps each node's random priority in heap
 * order, which keeps the tree balanced without an explicit rebalancing pass). Each edit reshapes
 * only the nodes along one root-to-leaf path via split and merge in O(log P), instead of
 * rebuilding all P pieces.
 * Inspired by https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation
 */
export class PieceTable {
  #original: TextBuffer;
  #add = new TextBuffer('');
  #root: PieceNode | null = null;
  #length = 0;
  #lineCount = 0;
  #lastVisitedLine: [number, boolean, string] | null = null;
  #lastVisitedLineLength: [number, boolean, number] | null = null;
  // Seeds the treap priorities. 0x9e3779b9 is the 32-bit golden-ratio
  // constant (2^32 / phi), a well-mixed value commonly used to seed hashes
  // and PRNGs; any fixed nonzero seed works here. A fixed seed keeps the
  // tree shape, and thus performance, deterministic across runs.
  #priorityState = 0x9e3779b9;

  constructor(originalText: string) {
    this.#original = new TextBuffer(originalText);
    const piece = this.#createPiece(Piece.Original, 0, originalText.length);
    this.#root = piece.length > 0 ? this.#createNode(piece) : null;
    this.#length = this.#root?.subtreeLength ?? 0;
    this.#lineCount = (this.#root?.subtreeLineBreakCount ?? 0) + 1;
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

    // Reuse the single compiled pattern across every line, resetting its
    // lastIndex before each line, instead of allocating a fresh RegExp per
    // line. The pattern is global, so lastIndex tracks progress within a line.
    for (let line = 0; line < this.#lineCount; line++) {
      const lineText = this.getLineText(line);
      const lineStart = this.offsetAt({ line, character: 0 });
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(lineText)) !== null) {
        const rel = match.index;
        const fragment = match[0];
        if (fragment.length === 0) {
          pattern.lastIndex = advancePastEmptyMatch(lineText, rel);
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
        if (rel === pattern.lastIndex) {
          pattern.lastIndex = advancePastEmptyMatch(lineText, rel);
        }
      }
    }
    return out;
  }

  insert(text: string, offset: number): void {
    if (text.length === 0) {
      return;
    }
    const start = clamp(offset, 0, this.#length);
    this.#replaceRangeIncremental(start, start, text);
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
    this.#replaceRangeIncremental(start, end, '');
  }

  applyEdits(edits: readonly ResolvedTextEdit[]): void {
    if (edits.length === 0) {
      return;
    }
    // Edits arrive sorted ascending and non-overlapping (TextDocument enforces
    // this). Applying them from last to first keeps each remaining edit's
    // offsets valid, since edits at higher offsets never shift lower ones, and
    // every edit becomes an O(log P) incremental replace.
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i];
      const start = clamp(edit.start, 0, this.#length);
      const end = clamp(edit.end, start, this.#length);
      this.#replaceRangeIncremental(start, end, edit.text);
    }
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

      line +=
        (node.left?.subtreeLineBreakCount ?? 0) -
        (formsCRLF(node.left?.subtreeLastCharCode, node.piece.firstCharCode)
          ? 1
          : 0);
      remaining -= leftLength;
      if (remaining <= node.piece.length) {
        const buffer = this.#bufferFor(node.piece.source);
        const lineOffsetEnd = Math.min(
          upperBound(buffer.lineOffsets, node.piece.offset + remaining),
          node.piece.lineOffsetEnd
        );
        line += lineOffsetEnd - node.piece.lineOffsetStart;
        if (
          remaining === node.piece.length &&
          node.piece.hasVirtualTrailingCRBreak
        ) {
          line++;
        }
        if (
          remaining === node.piece.length &&
          formsCRLF(
            node.piece.lastCharCode,
            this.#nextNode(node)?.piece.firstCharCode
          )
        ) {
          line--;
        }
        return line;
      }

      line +=
        node.piece.lineBreakCount -
        (formsCRLF(node.piece.lastCharCode, node.right?.subtreeFirstCharCode)
          ? 1
          : 0);
      remaining -= node.piece.length;
      node = node.right;
    }

    return this.#lineCount - 1;
  }

  #lineBreakOffset(lineBreakIndex: number): number {
    let node = this.#root;
    let remaining = lineBreakIndex;
    let documentOffset = 0;
    let followingCharCode: number | undefined;

    while (node !== null) {
      const leftLineBreakCount =
        (node.left?.subtreeLineBreakCount ?? 0) -
        (formsCRLF(node.left?.subtreeLastCharCode, node.piece.firstCharCode)
          ? 1
          : 0);
      if (remaining < leftLineBreakCount) {
        followingCharCode = node.piece.firstCharCode;
        node = node.left;
        continue;
      }

      const leftLength = node.left?.subtreeLength ?? 0;
      documentOffset += leftLength;
      remaining -= leftLineBreakCount;

      const nextCharCode =
        node.right?.subtreeFirstCharCode ?? followingCharCode;
      const pieceLineBreakCount =
        node.piece.lineBreakCount -
        (formsCRLF(node.piece.lastCharCode, nextCharCode) ? 1 : 0);
      if (remaining < pieceLineBreakCount) {
        return (
          documentOffset + this.#pieceLineBreakOffset(node.piece, remaining)
        );
      }

      documentOffset += node.piece.length;
      remaining -= pieceLineBreakCount;
      node = node.right;
    }

    return this.#length;
  }

  #pieceLineBreakOffset(piece: Piece, lineBreakIndex: number): number {
    const bufferLineBreakCount = piece.lineOffsetEnd - piece.lineOffsetStart;
    if (lineBreakIndex < bufferLineBreakCount) {
      const bufferLineOffset = this.#bufferFor(piece.source).lineOffsets[
        piece.lineOffsetStart + lineBreakIndex
      ];
      return bufferLineOffset - piece.offset;
    }
    return piece.length;
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
    const end = offset + length;
    const lineOffsetStart = upperBound(buffer.lineOffsets, offset);
    const lineOffsetEnd = upperBound(buffer.lineOffsets, end);
    const lastCharCode = buffer.text.charCodeAt(end - 1);
    return new Piece(
      source,
      offset,
      length,
      lineOffsetStart,
      lineOffsetEnd,
      lastCharCode === CARRIAGE_RETURN &&
        buffer.lineOffsets[lineOffsetEnd - 1] !== end,
      buffer.text.charCodeAt(offset),
      lastCharCode
    );
  }

  // Replaces document range [start, end) with `text` by splitting the tree at
  // both ends, dropping the middle (the deleted span), and joining the inserted
  // piece back in. Each split/merge touches only one root-to-leaf path, so the
  // edit is O(log P) instead of rebuilding all P pieces. `start`/`end` must be
  // clamped into [0, length] with start <= end.
  #replaceRangeIncremental(start: number, end: number, text: string): void {
    if (start === end && text.length === 0) {
      return;
    }

    const [left, rest] = this.#split(this.#root, start);
    const [, right] = this.#split(rest, end - start);

    let root: PieceNode | null;
    if (text.length > 0) {
      const insertedPiece = this.#createPiece(
        Piece.Added,
        this.#add.append(text),
        text.length
      );
      // The inserted text is fresh at the end of the add buffer, so it can only
      // sit next to the piece on its left, never the one on its right.
      root = this.#mergeNodes(
        this.#appendCoalescing(left, insertedPiece),
        right
      );
    } else {
      // Pure deletion: the pieces now meeting at the seam may be contiguous in
      // the same buffer, so re-attach the right side's first piece through the
      // coalescing append to merge them when possible.
      const [seamPiece, restRight] = this.#popLeftmost(right);
      root =
        seamPiece === undefined
          ? left
          : this.#mergeNodes(
              this.#appendCoalescing(left, seamPiece),
              restRight
            );
    }

    if (root !== null) {
      root.parent = null;
    }
    this.#root = root;
    this.#length = root?.subtreeLength ?? 0;
    this.#lineCount = (root?.subtreeLineBreakCount ?? 0) + 1;
    this.#lastVisitedLine = null;
    this.#lastVisitedLineLength = null;
  }

  #nextPriority(): number {
    this.#priorityState =
      (Math.imul(this.#priorityState, 1664525) + 1013904223) >>> 0;
    return this.#priorityState;
  }

  #createNode(piece: Piece): PieceNode {
    const node = new PieceNode(piece);
    node.priority = this.#nextPriority();
    return node;
  }

  // Attaches `child` as a side of `node`, keeping the parent pointer in sync so
  // read-side iteration (#nextNode) can still walk back up the tree.
  #setLeft(node: PieceNode, child: PieceNode | null): void {
    node.left = child;
    if (child !== null) {
      child.parent = node;
    }
  }

  #setRight(node: PieceNode, child: PieceNode | null): void {
    node.right = child;
    if (child !== null) {
      child.parent = node;
    }
  }

  // Splits the subtree into [0, offset) and [offset, length). When the offset
  // falls inside a piece, that piece is sliced in two so the split lands on a
  // clean boundary. Internal parent pointers stay correct; the caller fixes the
  // returned roots' own parents when it reattaches or stores them.
  #split(
    node: PieceNode | null,
    offset: number
  ): [left: PieceNode | null, right: PieceNode | null] {
    if (node === null) {
      return [null, null];
    }

    const leftLength = node.left?.subtreeLength ?? 0;
    if (offset <= leftLength) {
      const [left, right] = this.#split(node.left, offset);
      this.#setLeft(node, right);
      node.updateSubtreeLength();
      return [left, node];
    }

    const pieceLength = node.piece.length;
    if (offset >= leftLength + pieceLength) {
      const [left, right] = this.#split(
        node.right,
        offset - leftLength - pieceLength
      );
      this.#setRight(node, left);
      node.updateSubtreeLength();
      return [node, right];
    }

    // The offset is strictly inside this node's piece: slice it in two. Both
    // halves inherit this node's priority, which keeps the heap valid because
    // this node already outranked both of its children.
    const inPiece = offset - leftLength;
    const leftNode = new PieceNode(
      this.#createPiece(node.piece.source, node.piece.offset, inPiece)
    );
    const rightNode = new PieceNode(
      this.#createPiece(
        node.piece.source,
        node.piece.offset + inPiece,
        pieceLength - inPiece
      )
    );
    leftNode.priority = node.priority;
    rightNode.priority = node.priority;
    this.#setLeft(leftNode, node.left);
    this.#setRight(rightNode, node.right);
    leftNode.updateSubtreeLength();
    rightNode.updateSubtreeLength();
    return [leftNode, rightNode];
  }

  // Joins two subtrees where every offset in `left` precedes every offset in
  // `right`, taking the higher-priority root so the result stays balanced.
  #mergeNodes(
    left: PieceNode | null,
    right: PieceNode | null
  ): PieceNode | null {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    if (left.priority >= right.priority) {
      this.#setRight(left, this.#mergeNodes(left.right, right));
      left.updateSubtreeLength();
      return left;
    }
    this.#setLeft(right, this.#mergeNodes(left, right.left));
    right.updateSubtreeLength();
    return right;
  }

  // Appends `piece` after every node in `tree`. Compatible adjacent pieces in
  // the same buffer are merged in place, keeping sequential typing compact.
  #appendCoalescing(tree: PieceNode | null, piece: Piece): PieceNode {
    if (tree === null) {
      return this.#createNode(piece);
    }
    let last = tree;
    while (last.right !== null) {
      last = last.right;
    }
    if (canCoalescePieces(last.piece, piece)) {
      last.piece = coalesceTwoPieces(last.piece, piece);
      // The last piece grew, so refresh aggregates from it up to the root.
      for (let node: PieceNode | null = last; node !== null; ) {
        node.updateSubtreeLength();
        if (node === tree) {
          break;
        }
        node = node.parent;
      }
      return tree;
    }
    // `tree` is non-null here, so merging in the new node always yields a node.
    return this.#mergeNodes(tree, this.#createNode(piece)) as PieceNode;
  }

  // Removes and returns the first piece of the tree along with the remaining
  // tree, so a deletion seam can re-merge the piece that becomes adjacent to
  // the one on the other side of the deletion.
  #popLeftmost(
    tree: PieceNode | null
  ): [piece: Piece | undefined, rest: PieceNode | null] {
    if (tree === null) {
      return [undefined, null];
    }
    if (tree.left === null) {
      return [tree.piece, tree.right];
    }
    const [piece, newLeft] = this.#popLeftmost(tree.left);
    this.#setLeft(tree, newLeft);
    tree.updateSubtreeLength();
    return [piece, tree];
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

// CRLF seams stay explicit because separately appended buffer chunks may each
// record a break there; the tree aggregate reconciles the document-level pair.
function canCoalescePieces(prev: Piece, next: Piece): boolean {
  return (
    prev.source === next.source &&
    prev.offset + prev.length === next.offset &&
    !formsCRLF(prev.lastCharCode, next.firstCharCode)
  );
}

// Joins two adjacent pieces (see canCoalescePieces) into one. Keeping the table
// compact after every edit is what stops the piece count from growing without
// bound during normal typing.
function coalesceTwoPieces(prev: Piece, next: Piece): Piece {
  return new Piece(
    prev.source,
    prev.offset,
    prev.length + next.length,
    prev.lineOffsetStart,
    next.lineOffsetEnd,
    next.hasVirtualTrailingCRBreak,
    prev.firstCharCode,
    next.lastCharCode
  );
}

function formsCRLF(
  leftCharCode: number | undefined,
  rightCharCode: number | undefined
): boolean {
  return leftCharCode === CARRIAGE_RETURN && rightCharCode === LINE_FEED;
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

/** Expands `$&`, `$1`, `$$`, etc. in a regex replace string using a match. */
function expandReplaceString(
  replacement: string,
  match: RegExpExecArray
): string {
  return replacement.replace(/\$([$&]|\d+)/g, (_token, group: string) => {
    if (group === '$') {
      return '$';
    }
    if (group === '&') {
      return match[0] ?? '';
    }
    const index = Number(group);
    return match[index] ?? '';
  });
}

/**
 * Builds the text to insert for one search match, including regex capture
 * substitution when regex mode is enabled.
 */
export function buildSearchReplacementText(
  positionAt: (offset: number) => Position,
  offsetAt: (position: Position) => number,
  getLineText: (line: number) => string,
  searchParams: SearchParams,
  matchStart: number,
  matchEnd: number
): string {
  if (!searchParams.regex) {
    return searchParams.replaceText;
  }

  const position = positionAt(matchStart);
  const lineText = getLineText(position.line);
  const lineStart = offsetAt({ line: position.line, character: 0 });
  const relStart = matchStart - lineStart;

  let pattern: RegExp;
  try {
    pattern = compileSearchRegExp(
      searchParams.text,
      true,
      searchParams.caseSensitive
    );
  } catch {
    return searchParams.replaceText;
  }

  // Re-run at the original line offset so lookaround can inspect context
  // outside the matched range while captures still come from this exact hit.
  pattern.lastIndex = relStart;
  const match = pattern.exec(lineText);
  if (
    match === null ||
    match.index !== relStart ||
    match[0].length !== matchEnd - matchStart
  ) {
    return searchParams.replaceText;
  }
  return expandReplaceString(searchParams.replaceText, match);
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
