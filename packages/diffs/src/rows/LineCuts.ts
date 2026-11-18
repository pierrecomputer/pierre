import type { Element as HASTElement } from 'hast';

import { i18n } from '../i18n/I18n';
import type { DiffModel } from '../model/DiffModel';
import type { FileModel } from '../model/FileModel';
import type { AnnotationSide } from '../types';
import { createIconElement } from '../utils/hast_utils';

// The lines one expand button expands, by line number. An unchanged line of a
// diff has a number on each side.
export interface LineExpansion {
  additionLineNumber?: number;
  deletionLineNumber?: number;
}

// A cut-off row, with the lines its button expands and the messages its
// label was translated with.
interface CutRow extends LineExpansion {
  messagesVersion: number;
  row: HASTElement;
}

// How many characters of a line to show when it is longer than `limit`, or
// undefined when the whole line shows.
export function cutLineLength(text: string, limit: number): number | undefined {
  if (limit <= 0 || text.length <= limit) {
    return undefined;
  }
  // A stored line ends with its line break, which does not count.
  if (text.length - lineBreakLength(text) <= limit) {
    return undefined;
  }
  // Never end on the first half of an emoji.
  const last = text.charCodeAt(limit - 1);
  return last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
}

// How many characters the line break at the end of a stored line takes.
function lineBreakLength(text: string): number {
  const end = text.length;
  if (text.charCodeAt(end - 1) !== 10) {
    return 0;
  }
  return text.charCodeAt(end - 2) === 13 ? 2 : 1;
}

// Copies the first `remaining` characters of `row` into `target`, keeping the
// spans around the text. Returns how many characters are still wanted.
function copyPrefix(
  row: HASTElement,
  target: HASTElement,
  remaining: number
): number {
  for (const child of row.children) {
    if (remaining === 0) break;
    if (child.type === 'text') {
      if (child.value.length <= remaining) {
        target.children.push(child);
        remaining -= child.value.length;
      } else {
        target.children.push({
          type: 'text',
          value: child.value.slice(0, remaining),
        });
        return 0;
      }
    } else if (child.type === 'element') {
      const span: HASTElement = { ...child, children: [] };
      remaining = copyPrefix(child, span, remaining);
      target.children.push(span);
    }
  }
  return remaining;
}

// Cuts long lines off. Builds the row that shows only the start of a line,
// with a button to show the rest, and remembers which lines were expanded.
export class LineCuts {
  #limit = 0;
  // Cut-off rows by the row they were cut from.
  #rows = new WeakMap<HASTElement, CutRow>();
  readonly #expanded = {
    additions: new Set<number>(),
    deletions: new Set<number>(),
  };
  #hasCutRows = false;

  // Whether the last layout, or the one under way, was given a cut-off row.
  get hasCutRows(): boolean {
    return this.#hasCutRows;
  }

  // Called by a layout before it builds its rows.
  startLayout(): void {
    this.#hasCutRows = false;
  }

  // Sets the length lines are cut at. 0 cuts nothing.
  setLimit(limit: number): void {
    if (limit !== this.#limit) {
      this.#limit = limit;
      this.#rows = new WeakMap();
    }
  }

  // Marks lines as expanded, so they show their full text.
  expand({ additionLineNumber, deletionLineNumber }: LineExpansion): void {
    const { additions, deletions } = this.#expanded;
    if (additionLineNumber != null) {
      additions.add(additionLineNumber);
    }
    if (deletionLineNumber != null) {
      deletions.add(deletionLineNumber);
    }
  }

  // Forgets every expanded line.
  clear(): void {
    const { additions, deletions } = this.#expanded;
    additions.clear();
    deletions.clear();
  }

  // The row to show for a line of a file, or of a diff's new side: `base`,
  // or a cut-off copy when the line is too long. An unchanged line of a diff
  // passes its old-side line number too, so one button expands both sides.
  additionRow(
    base: HASTElement,
    model: DiffModel | FileModel,
    lineIndex: number,
    lineNumber: number,
    deletionLineNumber?: number
  ): HASTElement {
    return this.#row(
      base,
      model.lineText(lineIndex),
      'additions',
      lineNumber,
      deletionLineNumber
    );
  }

  // The same for a line of a diff's old side.
  deletionRow(
    base: HASTElement,
    model: DiffModel,
    lineIndex: number,
    lineNumber: number,
    additionLineNumber?: number
  ): HASTElement {
    return this.#row(
      base,
      model.diff.deletionLines[lineIndex] ?? '',
      'deletions',
      lineNumber,
      additionLineNumber
    );
  }

  // Returns `base` for a line that fits or was expanded. Otherwise returns
  // its cut-off copy, which is built once and reused.
  #row(
    base: HASTElement,
    text: string,
    side: AnnotationSide,
    lineNumber: number,
    altLineNumber?: number
  ): HASTElement {
    const length = cutLineLength(text, this.#limit);
    if (length == null || this.#expanded[side].has(lineNumber)) {
      return base;
    }
    this.#hasCutRows = true;
    const additionLineNumber =
      side === 'additions' ? lineNumber : altLineNumber;
    const deletionLineNumber =
      side === 'deletions' ? lineNumber : altLineNumber;
    const messagesVersion = i18n.version;
    const cached = this.#rows.get(base);
    if (
      cached != null &&
      cached.messagesVersion === messagesVersion &&
      cached.additionLineNumber === additionLineNumber &&
      cached.deletionLineNumber === deletionLineNumber
    ) {
      return cached.row;
    }
    const row: HASTElement = { ...base, children: [] };
    copyPrefix(base, row, length);
    row.children.push({
      type: 'element',
      tagName: 'button',
      children: [createIconElement({ name: 'diffs-icon-expand' })],
      properties: {
        type: 'button',
        'data-expand-line': '',
        'data-addition-line-number': additionLineNumber,
        'data-deletion-line-number': deletionLineNumber,
        'aria-label': i18n.t('expandLine'),
      },
    });
    this.#rows.set(base, {
      row,
      additionLineNumber,
      deletionLineNumber,
      messagesVersion,
    });
    return row;
  }
}
