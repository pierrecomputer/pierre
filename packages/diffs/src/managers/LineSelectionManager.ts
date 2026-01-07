import type { AnnotationSide } from '../types';
import { areSelectionsEqual } from '../utils/areSelectionsEqual';

export type SelectionSide = AnnotationSide;

export interface SelectedLineRange {
  start: number;
  side?: SelectionSide;
  end: number;
  endSide?: SelectionSide;
}

export interface LineSelectionOptions {
  enableLineSelection?: boolean;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  onLineSelectionStart?: (range: SelectedLineRange | null) => void;
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void;
}

interface MouseInfo {
  lineNumber: number;
  eventSide: AnnotationSide;
  lineIndex: number;
}

/**
 * Manages line selection state and interactions for code/diff viewers.
 * Handles:
 * - Click and drag selection
 * - Shift-click to extend selection
 * - DOM attribute updates (data-selected-line)
 */
export class LineSelectionManager {
  private pre: HTMLPreElement | undefined;
  private selectedRange: SelectedLineRange | null = null;
  private renderedSelectionRange: SelectedLineRange | null | undefined;
  private anchor: { line: number; side: SelectionSide } | undefined;
  private _queuedRender: number | undefined;

  constructor(private options: LineSelectionOptions = {}) {}

  setOptions(options: LineSelectionOptions): void {
    this.options = { ...this.options, ...options };
    this.removeEventListeners();
    if (this.options.enableLineSelection === true) {
      this.attachEventListeners();
    }
  }

  cleanUp(): void {
    this.removeEventListeners();
    if (this._queuedRender != null) {
      cancelAnimationFrame(this._queuedRender);
      this._queuedRender = undefined;
    }
    if (this.pre != null) {
      delete this.pre.dataset.interactiveLineNumbers;
    }
    this.pre = undefined;
  }

  setup(pre: HTMLPreElement): void {
    // Assume we are always dirty after a setup...
    this.setDirty();
    if (this.pre !== pre) {
      this.cleanUp();
      this.pre = pre;
      const { enableLineSelection = false } = this.options;
      if (enableLineSelection) {
        this.attachEventListeners();
      } else {
        this.removeEventListeners();
      }
    }
    this.setSelection(this.selectedRange);
  }

  setDirty(): void {
    this.renderedSelectionRange = undefined;
  }

  isDirty(): boolean {
    return this.renderedSelectionRange === undefined;
  }

  setSelection(range: SelectedLineRange | null): void {
    const isRangeChange = !(
      range === this.selectedRange ||
      areSelectionsEqual(range ?? undefined, this.selectedRange ?? undefined)
    );
    if (!this.isDirty() && !isRangeChange) return;
    this.selectedRange = range;
    this.renderSelection();
    if (isRangeChange) {
      this.notifySelectionChange();
    }
  }

  getSelection(): SelectedLineRange | null {
    return this.selectedRange;
  }

  private attachEventListeners(): void {
    if (this.pre == null) return;
    // Lets run a cleanup, just in case
    this.removeEventListeners();
    this.pre.dataset.interactiveLineNumbers = '';
    this.pre.addEventListener('pointerdown', this.handleMouseDown);
  }

  private removeEventListeners(): void {
    if (this.pre == null) return;
    this.pre.removeEventListener('pointerdown', this.handleMouseDown);
    document.removeEventListener('pointermove', this.handleMouseMove);
    document.removeEventListener('pointerup', this.handleMouseUp);
    delete this.pre.dataset.interactiveLineNumbers;
  }

  private handleMouseDown = (event: PointerEvent): void => {
    // Only handle left mouse button
    const mouseEventData =
      event.button === 0
        ? this.getMouseEventDataForPath(event.composedPath(), 'click')
        : undefined;
    if (mouseEventData == null) {
      return;
    }
    event.preventDefault();
    const { lineNumber, eventSide, lineIndex } = mouseEventData;
    if (event.shiftKey && this.selectedRange != null) {
      const range = this.deriveRowRangeFromDOM(
        this.selectedRange,
        this.pre?.dataset.type === 'split'
      );
      if (range == null) return;
      const useStart =
        range.start <= range.end
          ? lineIndex >= range.start
          : lineIndex <= range.end;
      this.anchor = {
        line: useStart ? this.selectedRange.start : this.selectedRange.end,
        side:
          (useStart
            ? this.selectedRange.side
            : (this.selectedRange.endSide ?? this.selectedRange.side)) ??
          'additions',
      };
      this.updateSelection(lineNumber, eventSide);
      this.notifySelectionStart(this.selectedRange);
    } else {
      // Check if clicking on already selected single line to unselect
      if (
        this.selectedRange?.start === lineNumber &&
        this.selectedRange?.end === lineNumber
      ) {
        this.updateSelection(null);
        this.notifySelectionEnd(null);
        this.notifySelectionChange();
        return;
      }
      this.selectedRange = null;
      this.anchor = { line: lineNumber, side: eventSide };
      this.updateSelection(lineNumber, eventSide);
      this.notifySelectionStart(this.selectedRange);
    }

    document.addEventListener('pointermove', this.handleMouseMove);
    document.addEventListener('pointerup', this.handleMouseUp);
  };

  private handleMouseMove = (event: PointerEvent): void => {
    const mouseEventData = this.getMouseEventDataForPath(
      event.composedPath(),
      'move'
    );
    if (mouseEventData == null || this.anchor == null) return;
    const { lineNumber, eventSide } = mouseEventData;
    this.updateSelection(lineNumber, eventSide);
  };

  private handleMouseUp = (): void => {
    this.anchor = undefined;
    document.removeEventListener('pointermove', this.handleMouseMove);
    document.removeEventListener('pointerup', this.handleMouseUp);
    this.notifySelectionEnd(this.selectedRange);
    this.notifySelectionChange();
  };

  private updateSelection(currentLine: null): void;
  private updateSelection(currentLine: number, side: AnnotationSide): void;
  private updateSelection(
    currentLine: number | null,
    side?: AnnotationSide
  ): void {
    if (currentLine == null) {
      this.selectedRange = null;
    } else {
      const anchorSide = this.anchor?.side ?? side;
      const anchorLine = this.anchor?.line ?? currentLine;
      this.selectedRange = {
        start: anchorLine,
        end: currentLine,
        side: anchorSide,
        endSide: anchorSide !== side ? side : undefined,
      };
    }
    this._queuedRender ??= requestAnimationFrame(this.renderSelection);
  }

  private renderSelection = (): void => {
    if (this._queuedRender != null) {
      cancelAnimationFrame(this._queuedRender);
      this._queuedRender = undefined;
    }
    if (
      this.pre == null ||
      this.renderedSelectionRange === this.selectedRange
    ) {
      return;
    }

    // First clear existing selections, maybe we
    // can cache this to better avoid this query?
    const allSelected = this.pre.querySelectorAll('[data-selected-line]');
    for (const element of allSelected) {
      element.removeAttribute('data-selected-line');
    }

    this.renderedSelectionRange = this.selectedRange;
    if (this.selectedRange == null) {
      return;
    }

    const codeElements = this.pre.querySelectorAll('[data-code]');
    if (codeElements.length === 0) return;
    if (codeElements.length > 2) {
      console.error(codeElements);
      throw new Error(
        'LineSelectionManager.applySelectionToDOM: Somehow there are more than 2 code elements...'
      );
    }
    const split = this.pre.dataset.type === 'split';
    const rowRange = this.deriveRowRangeFromDOM(this.selectedRange, split);
    if (rowRange == null) {
      console.error({ rowRange, selectedRange: this.selectedRange });
      throw new Error(
        'LineSelectionManager.renderSelection: No valid rowRange'
      );
    }
    const isSingle = rowRange.start === rowRange.end;
    const first = Math.min(rowRange.start, rowRange.end);
    const last = Math.max(rowRange.start, rowRange.end);
    for (const code of codeElements) {
      for (const element of code.children) {
        if (!(element instanceof HTMLElement)) continue;
        const lineIndex = this.getLineIndex(element, split);
        if ((lineIndex ?? 0) > last) break;
        if (lineIndex == null || lineIndex < first) continue;
        let attributeValue = isSingle
          ? 'single'
          : lineIndex === first
            ? 'first'
            : lineIndex === last
              ? 'last'
              : '';
        element.setAttribute('data-selected-line', attributeValue);
        // If we have a line annotation following our selected line, we should
        // mark it as selected as well
        if (
          element.nextSibling instanceof HTMLElement &&
          element.nextSibling.hasAttribute('data-line-annotation')
        ) {
          // Depending on the line's attribute value, lets go ahead and correct
          // it when adding in the annotation row
          if (isSingle) {
            // Single technically becomes 2 selected lines
            attributeValue = 'last';
            element.setAttribute('data-selected-line', 'first');
          } else if (lineIndex === first) {
            // We don't want apply 'first' to the line annotation
            attributeValue = '';
          } else if (lineIndex === last) {
            // the annotation will become the last selected line and therefore
            // our existing line should no longer be last
            element.setAttribute('data-selected-line', '');
          }
          element.nextSibling.setAttribute(
            'data-selected-line',
            attributeValue
          );
        }
      }
    }
  };

  private deriveRowRangeFromDOM(
    range: SelectedLineRange,
    split: boolean
  ): { start: number; end: number } | undefined {
    if (range == null) return undefined;
    const start = this.findRowIndexForLineNumber(
      range.start,
      range.side,
      split
    );
    const end =
      range.end === range.start &&
      (range.endSide == null || range.endSide === range.side)
        ? start
        : this.findRowIndexForLineNumber(
            range.end,
            range.endSide ?? range.side,
            split
          );
    return start != null && end != null ? { start, end } : undefined;
  }

  private findRowIndexForLineNumber(
    lineNumber: number,
    targetSide: SelectionSide = 'additions',
    split: boolean
  ): number | undefined {
    if (this.pre == null) return undefined;
    const elements = Array.from(
      this.pre.querySelectorAll(`[data-line="${lineNumber}"]`)
    );
    // Given how unified diffs can order things, we need to always process
    // `[data-line]` elements before `[data-alt-line]`
    elements.push(
      ...Array.from(
        this.pre.querySelectorAll(`[data-alt-line="${lineNumber}"]`)
      )
    );
    if (elements.length === 0) return undefined;

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const side = this.getLineSideFromElement(element);
      if (side === targetSide) {
        return this.getLineIndex(element, split);
      } else if (parseInt(element.dataset.altLine ?? '') === lineNumber) {
        return this.getLineIndex(element, split);
      }
    }
    console.error(
      'LineSelectionManager.findRowIndexForLineNumber: Invalid selection',
      lineNumber,
      targetSide
    );
    return undefined;
  }

  private notifySelectionChange(): void {
    const { onLineSelected } = this.options;
    if (onLineSelected == null) return;

    onLineSelected(this.selectedRange ?? null);
  }

  private notifySelectionStart(range: SelectedLineRange | null): void {
    const { onLineSelectionStart } = this.options;
    if (onLineSelectionStart == null) return;
    onLineSelectionStart(range);
  }

  private notifySelectionEnd(range: SelectedLineRange | null): void {
    const { onLineSelectionEnd } = this.options;
    if (onLineSelectionEnd == null) return;
    onLineSelectionEnd(range);
  }

  private getMouseEventDataForPath(
    path: (EventTarget | undefined)[],
    eventType: 'click' | 'move'
  ): MouseInfo | undefined {
    let lineNumber: number | undefined;
    let lineIndex: number | undefined;
    let isNumberColumn = false;
    let eventSide: AnnotationSide | undefined;
    for (const element of path) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element.hasAttribute('data-column-number')) {
        isNumberColumn = true;
        continue;
      }
      if (element.hasAttribute('data-line')) {
        lineNumber = this.getLineNumber(element);
        lineIndex = this.getLineIndex(
          element,
          this.pre?.dataset.type === 'split'
        );
        if (element.dataset.lineType === 'change-deletion') {
          eventSide = 'deletions';
        } else if (element.dataset.lineType === 'change-additions') {
          eventSide = 'additions';
        }
        // if we can't pull out an index or line number, we can't do anything.
        if (lineIndex == null || lineNumber == null) {
          lineIndex = undefined;
          lineNumber = undefined;
          break;
        }
        // If we already have an eventSide, we done computin
        if (eventSide != null) {
          break;
        } else {
          // context type lines will need to be discovered higher up
          // at the data-code level
        }
        continue;
      }
      if (element.hasAttribute('data-code')) {
        eventSide ??= element.hasAttribute('data-deletions')
          ? 'deletions'
          : // context in unified style are assumed to be additions based on
            // their line numbers
            'additions';
        // If we got to the code element, we def done, son
        break;
      }
    }
    if (
      (eventType === 'click' && !isNumberColumn) ||
      lineIndex == null ||
      lineNumber == null
    ) {
      return undefined;
    }
    return {
      lineIndex,
      lineNumber,
      // Normally this shouldn't hit unless we broke early for whatever reason,
      // but for types lets ensure it's additions if undefined
      eventSide: eventSide ?? 'additions',
    };
  }

  private getLineNumber(element: HTMLElement): number | undefined {
    const lineNumber = parseInt(element.dataset.line ?? '', 10);
    return !Number.isNaN(lineNumber) ? lineNumber : undefined;
  }

  private getLineIndex(
    element: HTMLElement,
    split: boolean
  ): number | undefined {
    const lineIndexes = (element.dataset.lineIndex ?? '')
      .split(',')
      .map((value) => parseInt(value))
      .filter((value) => !Number.isNaN(value));

    if (split && lineIndexes.length === 2) {
      return lineIndexes[1];
    } else if (!split) {
      return lineIndexes[0];
    }
    return undefined;
  }

  private getLineSideFromElement(element: HTMLElement): SelectionSide {
    if (element.dataset.lineType === 'change-deletion') {
      return 'deletions';
    }
    if (element.dataset.lineType === 'change-addition') {
      return 'additions';
    }
    const parent = element.closest('[data-code]');
    if (!(parent instanceof HTMLElement)) {
      return 'additions';
    }
    return parent.hasAttribute('data-deletions') ? 'deletions' : 'additions';
  }
}

export function pluckLineSelectionOptions({
  enableLineSelection,
  onLineSelected,
  onLineSelectionStart,
  onLineSelectionEnd,
}: LineSelectionOptions): LineSelectionOptions {
  return {
    enableLineSelection,
    onLineSelected,
    onLineSelectionStart,
    onLineSelectionEnd,
  };
}
