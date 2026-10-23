import type { DocumentLineChange } from './types';

/**
 * Gives every line of an edited document a stable id, and remembers which
 * original line each unchanged line came from.
 *
 * Ids are what rows are keyed by: inserting a line gives the new line a fresh
 * id while every line below keeps its id, so the rows below only change their
 * line numbers. The original index says whether a line still has the text it
 * had when the session started; it is -1 once an edit has touched the line.
 */
export class LineMap {
  #ids: number[];
  #originalIndexes: number[];
  #nextId: number;

  constructor(lineCount: number) {
    if (lineCount < 1) {
      throw new Error('LineMap: a document has at least one line');
    }
    this.#ids = Array.from({ length: lineCount }, (_, index) => index);
    this.#originalIndexes = this.#ids.slice();
    this.#nextId = lineCount;
  }

  get lineCount(): number {
    return this.#ids.length;
  }

  idAt(line: number): number {
    const id = this.#ids[line];
    if (id == null) {
      throw new Error(`LineMap.idAt: line ${line} is out of range`);
    }
    return id;
  }

  /** The line's index at session start, or -1 once an edit touched it. */
  originalIndexAt(line: number): number {
    const index = this.#originalIndexes[line];
    if (index == null) {
      throw new Error(`LineMap.originalIndexAt: line ${line} is out of range`);
    }
    return index;
  }

  /**
   * Applies the edits of one document change. Edits are given in document
   * order with ranges from before the change, so they are applied from the
   * last to the first and earlier ranges stay valid.
   */
  applyChange(change: DocumentLineChange): void {
    const { changes } = change;
    const lineDelta = change.lineCount - this.#ids.length;
    if (changes.length === 1) {
      const { range } = changes[0];
      const replacedLines = range.end.line - range.start.line;
      this.#replace(range.start.line, replacedLines, replacedLines + lineDelta);
    } else if (changes.length > 1) {
      // Counting the line breaks in each edit's text is right unless an
      // inserted `\r` or `\n` joins a neighbor into one CRLF break. The
      // document's line count is the truth: when the counts disagree with
      // it, the whole edited span is treated as one edit.
      let countedDelta = 0;
      for (const { range, text } of changes) {
        countedDelta +=
          countLineBreaks(text) - (range.end.line - range.start.line);
      }
      if (countedDelta === lineDelta) {
        for (let index = changes.length - 1; index >= 0; index--) {
          const { range, text } = changes[index];
          this.#replace(
            range.start.line,
            range.end.line - range.start.line,
            countLineBreaks(text)
          );
        }
      } else {
        const start = changes[0].range.start.line;
        const replacedLines =
          changes[changes.length - 1].range.end.line - start;
        this.#replace(start, replacedLines, replacedLines + lineDelta);
      }
    }
    if (this.#ids.length !== change.lineCount) {
      throw new Error(
        `LineMap.applyChange: the document has ${change.lineCount} lines but the map has ${this.#ids.length}`
      );
    }
  }

  // Replaces the `replacedLines + 1` lines from `start` with
  // `insertedLines + 1` lines. The first lines keep their ids; extra new
  // lines get fresh ids; extra old lines are dropped.
  #replace(start: number, replacedLines: number, insertedLines: number): void {
    const keptLines = Math.min(replacedLines, insertedLines) + 1;
    for (let offset = 0; offset < keptLines; offset++) {
      this.#originalIndexes[start + offset] = -1;
    }
    if (insertedLines > replacedLines) {
      this.#insert(start + replacedLines + 1, insertedLines - replacedLines);
    } else if (insertedLines < replacedLines) {
      this.#remove(start + insertedLines + 1, replacedLines - insertedLines);
    }
  }

  #insert(at: number, count: number): void {
    const ids: number[] = [];
    const originalIndexes: number[] = [];
    for (let offset = 0; offset < count; offset++) {
      ids.push(this.#nextId++);
      originalIndexes.push(-1);
    }
    this.#ids = this.#ids.slice(0, at).concat(ids, this.#ids.slice(at));
    this.#originalIndexes = this.#originalIndexes
      .slice(0, at)
      .concat(originalIndexes, this.#originalIndexes.slice(at));
  }

  #remove(at: number, count: number): void {
    this.#ids.splice(at, count);
    this.#originalIndexes.splice(at, count);
  }
}

/** The number of line breaks in `text`, counting `\r\n` once. */
export function countLineBreaks(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      count++;
    } else if (code === 13) {
      count++;
      if (text.charCodeAt(index + 1) === 10) {
        index++;
      }
    }
  }
  return count;
}
