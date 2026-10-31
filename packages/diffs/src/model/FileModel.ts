import type { FileContents } from '../types';
import { linesFromFileContents } from '../utils/computeFileOffsets';
import { uniformLineEndings } from '../utils/lineEndings';
import { readAllLines, readChangedLines } from './documentLines';
import { LineMap } from './LineMap';
import type { DocumentLineChange, DocumentLines } from './types';

/** What one applied change did to the file beyond its text. */
export interface FileModelChange {
  /** Line indexes whose text changed, after the edit. */
  readonly changedLines: readonly number[];
  /** Ids of the lines the edit deleted, so nothing is kept for them. */
  readonly removedLineIds: readonly number[];
  readonly lineDelta: number;
}

/**
 * The lines of a plain file and, while it is edited, a stable id for each
 * line, so rows are keyed by line rather than by position. The one-sided
 * twin of DiffModel.
 */
export class FileModel {
  /** A model of the file as given, for rendering it read-only. */
  static fromFile(file: FileContents): FileModel {
    return new FileModel(file, linesFromFileContents(file.contents), undefined);
  }

  /**
   * Starts editing a file. The session's file is a copy without the input's
   * cache key; `retained` supplies the name, language and contents of a
   * document the editor kept from an earlier session.
   */
  static startEditSession(
    file: FileContents,
    retained?: FileContents
  ): FileModel {
    const source = retained ?? file;
    // The editor's document gives the file one line ending; the model
    // holds the same text, so the two never disagree.
    const contents = uniformLineEndings(source.contents);
    const sessionFile: FileContents = {
      name: source.name,
      lang: source.lang,
      contents,
    };
    const lines = linesFromFileContents(contents);
    return new FileModel(sessionFile, lines, new LineMap(lines.length));
  }

  #lines: string[];
  readonly #map: LineMap | undefined;

  private constructor(
    readonly file: FileContents,
    lines: string[],
    map: LineMap | undefined
  ) {
    this.#lines = lines;
    this.#map = map;
  }

  /** Whether the file is being edited. */
  get live(): boolean {
    return this.#map != null;
  }

  get lineCount(): number {
    return this.#lines.length;
  }

  /** Every line with its line break, in order. */
  get lines(): readonly string[] {
    return this.#lines;
  }

  /** The text of a line, with its line break. */
  lineText(line: number): string {
    return this.#lines[line] ?? '';
  }

  /** The stable id of a line: its index until edits move it. */
  lineId(line: number): number {
    return this.#map?.idAt(line) ?? line;
  }

  /** The line that currently has this id, or undefined once it was deleted. */
  lineOf(id: number): number | undefined {
    return this.#map?.lineOf(id) ?? (id < this.#lines.length ? id : undefined);
  }

  /** The id of every line, in line order. */
  lineIds(): number[] {
    return this.#map?.ids() ?? this.#lines.map((_, line) => line);
  }

  /** Applies one change of the editor's document; `file` stays current. */
  applyChange(
    change: DocumentLineChange,
    document: DocumentLines
  ): FileModelChange {
    const map = this.#map;
    if (map == null) {
      throw new Error('FileModel.applyChange: the model is not live');
    }
    const removedLineIds = map.applyChange(change);
    const changedLines: number[] = [];
    if (change.lineDelta === 0) {
      for (const [line, text] of readChangedLines(document, change)) {
        if (this.#lines[line] !== text) {
          this.#lines[line] = text;
          changedLines.push(line);
        }
      }
    } else {
      this.#lines = readAllLines(document).lines;
      for (let line = change.startLine; line <= change.endLine; line++) {
        changedLines.push(line);
      }
    }
    this.file.contents = this.#lines.join('');
    return { changedLines, removedLineIds, lineDelta: change.lineDelta };
  }
}
