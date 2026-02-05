import type { SelectionSide } from '../types';
import { areSelectionsEqual } from '../utils/areSelectionsEqual';

export interface SelectedLineRange {
  start: number;
  side?: SelectionSide;
  end: number;
  endSide?: SelectionSide;
}

export type GetLineIndexUtility = (
  lineNumber: number,
  side?: SelectionSide
) => [number, number] | undefined;

export interface LineSelectionOptions {
  enableLineSelection?: boolean;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  onLineSelectionStart?: (range: SelectedLineRange | null) => void;
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void;
  getLineIndex?: GetLineIndexUtility;
}

interface MouseInfo {
  lineNumber: number;
  eventSide: SelectionSide | undefined;
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
  private anchor: { line: number; side: SelectionSide | undefined } | undefined;
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
    this.pre?.removeAttribute('data-interactive-line-numbers');
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

  getLineIndex(
    lineNumber: number,
    side?: SelectionSide
  ): [number, number] | undefined {
    const { getLineIndex } = this.options;
    return getLineIndex != null
      ? getLineIndex(lineNumber, side)
      : [lineNumber - 1, lineNumber - 1];
  }

  private attachEventListeners(): void {
    if (this.pre == null) return;
    // Lets run a cleanup, just in case
    this.removeEventListeners();
    this.pre.setAttribute('data-interactive-line-numbers', '');
    this.pre.addEventListener('pointerdown', this.handleMouseDown);
  }

  private removeEventListeners(): void {
    if (this.pre == null) return;
    this.pre.removeEventListener('pointerdown', this.handleMouseDown);
    document.removeEventListener('pointermove', this.handleMouseMove);
    document.removeEventListener('pointerup', this.handleMouseUp);
    this.pre.removeAttribute('data-interactive-line-numbers');
  }

  private handleMouseDown = (event: PointerEvent): void => {
    // Only handle left mouse button
    const mouseEventData =
      event.button === 0
        ? this.getMouseEventDataForPath(event.composedPath(), 'click')
        : undefined;
    if (mouseEventData == null || this.pre == null) {
      return;
    }
    event.preventDefault();
    const { lineNumber, eventSide, lineIndex } = mouseEventData;
    if (event.shiftKey && this.selectedRange != null) {
      const range = this.getIndexesFromSelection(
        this.selectedRange,
        this.pre.getAttribute('data-diff-type') === 'split'
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
  private updateSelection(currentLine: number, side?: SelectionSide): void;
  private updateSelection(
    currentLine: number | null,
    side?: SelectionSide
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

  private getIndexesFromSelection(
    selectedRange: SelectedLineRange,
    split: boolean
  ): { start: number; end: number } | undefined {
    if (this.pre == null) {
      return undefined;
    }
    const startIndexes = this.getLineIndex(
      selectedRange.start,
      selectedRange.side
    );
    const finalIndexes = this.getLineIndex(
      selectedRange.end,
      selectedRange.endSide ?? selectedRange.side
    );

    return startIndexes != null && finalIndexes != null
      ? {
          start: split ? startIndexes[1] : startIndexes[0],
          end: split ? finalIndexes[1] : finalIndexes[0],
        }
      : undefined;
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

    const { children: codeElements } = this.pre;
    if (codeElements.length === 0) return;
    if (codeElements.length > 2) {
      console.error(codeElements);
      throw new Error(
        'LineSelectionManager.applySelectionToDOM: Somehow there are more than 2 code elements...'
      );
    }
    const split = this.pre.getAttribute('data-diff-type') === 'split';
    const rowRange = this.getIndexesFromSelection(this.selectedRange, split);
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
      const [gutter, content] = code.children;
      const len = content.children.length;
      if (len !== gutter.children.length) {
        throw new Error(
          'LineSelectionManager.renderSelection: gutter and content children dont match, something is wrong'
        );
      }
      for (let i = 0; i < len; i++) {
        const contentElement = content.children[i];
        const gutterElement = gutter.children[i];
        if (
          !(contentElement instanceof HTMLElement) ||
          !(gutterElement instanceof HTMLElement)
        ) {
          continue;
        }

        const lineIndex = this.parseLineIndex(contentElement, split);
        if ((lineIndex ?? 0) > last) break;
        if (lineIndex == null || lineIndex < first) continue;
        let attributeValue = isSingle
          ? 'single'
          : lineIndex === first
            ? 'first'
            : lineIndex === last
              ? 'last'
              : '';
        contentElement.setAttribute('data-selected-line', attributeValue);
        gutterElement.setAttribute('data-selected-line', attributeValue);
        // If we have a line annotation following our selected line, we should
        // mark it as selected as well
        if (
          gutterElement.nextSibling instanceof HTMLElement &&
          contentElement.nextSibling instanceof HTMLElement &&
          contentElement.nextSibling.hasAttribute('data-line-annotation')
        ) {
          // Depending on the line's attribute value, lets go ahead and correct
          // it when adding in the annotation row
          if (isSingle) {
            // Single technically becomes 2 selected lines
            attributeValue = 'last';
            contentElement.setAttribute('data-selected-line', 'first');
          } else if (lineIndex === first) {
            // We don't want apply 'first' to the line annotation
            attributeValue = '';
          } else if (lineIndex === last) {
            // the annotation will become the last selected line and therefore
            // our existing line should no longer be last
            contentElement.setAttribute('data-selected-line', '');
          }
          contentElement.nextSibling.setAttribute(
            'data-selected-line',
            attributeValue
          );
          gutterElement.nextSibling.setAttribute(
            'data-selected-line',
            attributeValue
          );
        }
      }
    }
  };

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
    if (this.pre == null) {
      return undefined;
    }
    let lineNumber: number | undefined;
    let lineIndex: number | undefined;
    let isNumberColumn = false;
    let eventSide: SelectionSide | undefined;
    for (const element of path) {
      if (lineNumber != null && lineIndex != null && eventSide != null) {
        break;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      if (element.hasAttribute('data-line-index')) {
        isNumberColumn = element.hasAttribute('data-column-number');
        lineNumber = this.getLineNumber(element);
        lineIndex = this.parseLineIndex(
          element,
          this.pre.getAttribute('data-diff-type') === 'split'
        );
        const lineType = element.getAttribute('data-line-type');
        if (lineType === 'change-deletion') {
          eventSide = 'deletions';
        } else if (lineType === 'change-additions') {
          eventSide = 'additions';
        }
        continue;
      }

      if (eventSide == null && element.hasAttribute('data-code')) {
        eventSide = element.hasAttribute('data-deletions')
          ? 'deletions'
          : element.hasAttribute('data-additions')
            ? 'additions'
            : undefined;
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
      // Default side to 'additions' if we were unable to get a side,
      // otherwise later on we risk the side getting inverted in future if the
      // selection expands into a 'deletions' side
      eventSide: eventSide ?? 'additions',
    };
  }

  private getLineNumber(element: HTMLElement): number | undefined {
    const lineNumber = parseInt(
      element.getAttribute('data-column-number') ??
        element.getAttribute('data-line') ??
        '',
      10
    );
    return !Number.isNaN(lineNumber) ? lineNumber : undefined;
  }

  private parseLineIndex(
    element: HTMLElement,
    split: boolean
  ): number | undefined {
    const lineIndexes = (element.getAttribute('data-line-index') ?? '')
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
}

export function pluckLineSelectionOptions(
  {
    enableLineSelection,
    onLineSelected,
    onLineSelectionStart,
    onLineSelectionEnd,
  }: LineSelectionOptions,
  getLineIndex?: GetLineIndexUtility
): LineSelectionOptions {
  return {
    enableLineSelection,
    onLineSelected,
    onLineSelectionStart,
    onLineSelectionEnd,
    getLineIndex,
  };
}
