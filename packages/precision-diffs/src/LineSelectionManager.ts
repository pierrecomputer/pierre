import type { AnnotationSide } from './types';

export type SelectionSide = AnnotationSide | 'both';

export interface SelectedLineRange {
  first: number;
  last: number;
  side?: SelectionSide;
  rowStart?: number;
  rowEnd?: number;
}

export interface LineSelectionOptions {
  /**
   * Enable line selection via clicking line numbers
   * @default false
   */
  enableLineSelection?: boolean;

  /**
   * Callback fired when line selection changes
   */
  onLineSelected?: (range: SelectedLineRange | null) => void;
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
  private selectedRange: SelectedLineRange | undefined;
  private anchorLine: number | undefined;
  private anchorLineIndex: number | undefined;
  private isDragging = false;
  private selectionSide: SelectionSide | undefined;
  private selectedRowRange:
    | {
        first: number;
        last: number;
      }
    | undefined;

  constructor(private options: LineSelectionOptions = {}) {}

  setOptions(options: LineSelectionOptions): void {
    this.options = { ...this.options, ...options };
  }

  cleanUp(): void {
    this.removeEventListeners();
    this.clearSelection();
    this.pre = undefined;
  }

  setup(pre: HTMLPreElement): void {
    this.cleanUp();
    this.pre = pre;

    const { enableLineSelection = false } = this.options;
    if (!enableLineSelection) {
      return;
    }

    this.attachEventListeners();
  }

  /**
   * Programmatically set the selected line range
   */
  setSelection(
    range: SelectedLineRange | null,
    options: { silent?: boolean } = {}
  ): void {
    const { silent = false } = options;
    if (range == null) {
      this.clearSelection();
    } else {
      const side = range.side ?? this.selectionSide ?? 'both';
      this.selectionSide = side;
      this.selectedRange = { ...range, side };
      this.anchorLine = range.first;
      this.anchorLineIndex = range.rowStart;
      const rowRange =
        this.getRowRangeFromSelection(range) ??
        this.deriveRowRangeFromDOM({ ...range, side });
      this.setRowRange(rowRange);
      if (rowRange != null && this.anchorLineIndex == null) {
        this.anchorLineIndex = rowRange.first;
      }
      this.applySelectionToDOM();
    }
    if (!silent) {
      this.notifySelectionChange();
    }
  }

  /**
   * Get the current selected line range
   */
  getSelection(): SelectedLineRange | null {
    return this.selectedRange ?? null;
  }

  private attachEventListeners(): void {
    if (this.pre == null) return;
    this.pre.addEventListener('mousedown', this.handleMouseDown);
  }

  private removeEventListeners(): void {
    if (this.pre == null) return;
    this.pre.removeEventListener('mousedown', this.handleMouseDown);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  }

  private handleMouseDown = (event: MouseEvent): void => {
    // Only handle left mouse button
    if (event.button !== 0) return;

    const lineElement = this.getLineElementFromEvent(event);
    if (lineElement == null) return;

    const lineNumber = this.getLineNumber(lineElement);
    const lineIndex = this.getLineIndex(lineElement);
    if (lineIndex == null) return;

    // Check if click was on a line number column
    const target = event.target as HTMLElement;
    const isNumberColumn = this.isLineNumberColumn(target, event);
    if (!isNumberColumn) return;

    event.preventDefault();

    const isShiftKey = event.shiftKey;
    const clickedSide = this.getLineSideFromElement(lineElement);

    if (isShiftKey && this.selectedRange != null && this.selectedRowRange != null) {
      const oldFirst = this.selectedRange.first;
      const oldLast = this.selectedRange.last;
      const side =
        this.selectionSide == null
          ? clickedSide
          : this.selectionSide === clickedSide
            ? this.selectionSide
            : 'both';
      this.selectionSide = side;

      // Anchor to the opposite end of the existing selection
      const useStart = lineNumber >= oldFirst;
      this.anchorLine = useStart ? oldFirst : oldLast;
      this.anchorLineIndex = useStart
        ? this.selectedRowRange.first
        : this.selectedRowRange.last;
      this.updateSelection(lineNumber, lineIndex);
    } else {
      // Check if clicking on already selected single line (to unselect)
      if (
        this.selectedRange != null &&
        this.selectedRange.first === lineNumber &&
        this.selectedRange.last === lineNumber
      ) {
        this.clearSelection();
        this.notifySelectionChange();
        return;
      }

      // Start new selection anchored to this line
      this.clearSelection();
      this.anchorLine = lineNumber;
      this.anchorLineIndex = lineIndex;
      this.selectionSide = clickedSide;
      this.updateSelection(lineNumber, lineIndex);
    }

    this.isDragging = true;
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.isDragging || this.anchorLine == null) return;

    const lineElement = this.getLineElementFromEvent(event);
    if (lineElement == null) return;

    const lineNumber = this.getLineNumber(lineElement);
    const lineIndex = this.getLineIndex(lineElement);
    if (lineIndex == null) return;

    this.updateSelection(lineNumber, lineIndex);
  };

  private handleMouseUp = (): void => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);

    this.notifySelectionChange();
  };

  private updateSelection(currentLine: number, currentIndex: number): void {
    if (this.anchorLine == null || this.anchorLineIndex == null) return;

    const firstLine = Math.min(this.anchorLine, currentLine);
    const lastLine = Math.max(this.anchorLine, currentLine);

    this.selectedRange = {
      first: firstLine,
      last: lastLine,
      side: this.selectionSide ?? 'both',
    };

    const firstIndex = Math.min(this.anchorLineIndex, currentIndex);
    const lastIndex = Math.max(this.anchorLineIndex, currentIndex);
    this.setRowRange({ first: firstIndex, last: lastIndex });

    this.applySelectionToDOM();
  }

  private clearSelection(): void {
    if (this.pre == null) return;

    const selectedElements = this.pre.querySelectorAll('[data-selected-line]');
    for (const element of selectedElements) {
      element.removeAttribute('data-selected-line');
    }

    this.selectedRange = undefined;
    this.anchorLine = undefined;
    this.anchorLineIndex = undefined;
    this.selectionSide = undefined;
    this.selectedRowRange = undefined;
  }

  private applySelectionToDOM(): void {
    if (this.pre == null || this.selectedRange == null) return;

    // First clear existing selections
    const allSelected = this.pre.querySelectorAll('[data-selected-line]');
    for (const element of allSelected) {
      element.removeAttribute('data-selected-line');
    }

    const rowRange =
      this.selectedRowRange ??
      this.deriveRowRangeFromDOM(this.selectedRange);
    if (rowRange == null) return;
    this.setRowRange(rowRange);

    const allLines = this.getAllLineElements();
    const isSingle = rowRange.first === rowRange.last;

    for (const element of allLines) {
      const lineIndex = this.getLineIndex(element);
      if (lineIndex == null) continue;
      if (lineIndex < rowRange.first || lineIndex > rowRange.last) continue;

      if (isSingle) {
        element.setAttribute('data-selected-line', 'single');
      } else if (lineIndex === rowRange.first) {
        element.setAttribute('data-selected-line', 'first');
      } else if (lineIndex === rowRange.last) {
        element.setAttribute('data-selected-line', 'last');
      } else {
        element.setAttribute('data-selected-line', '');
      }
    }
  }

  private setRowRange(range?: { first: number; last: number }): void {
    this.selectedRowRange = range;
    if (this.selectedRange == null) return;
    if (range == null) {
      this.selectedRange.rowStart = undefined;
      this.selectedRange.rowEnd = undefined;
    } else {
      this.selectedRange.rowStart = range.first;
      this.selectedRange.rowEnd = range.last;
    }
  }

  private getRowRangeFromSelection(
    range: SelectedLineRange | null
  ): { first: number; last: number } | undefined {
    if (range?.rowStart == null || range.rowEnd == null) return undefined;
    return {
      first: Math.min(range.rowStart, range.rowEnd),
      last: Math.max(range.rowStart, range.rowEnd),
    };
  }

  private deriveRowRangeFromDOM(
    range: SelectedLineRange | undefined
  ): { first: number; last: number } | undefined {
    if (range == null) return undefined;
    const startIndex = this.findRowIndexForLineNumber(range.first, range.side);
    const endIndex =
      range.last === range.first
        ? startIndex
        : this.findRowIndexForLineNumber(range.last, range.side);
    if (startIndex == null || endIndex == null) return undefined;
    return {
      first: Math.min(startIndex, endIndex),
      last: Math.max(startIndex, endIndex),
    };
  }

  private findRowIndexForLineNumber(
    lineNumber: number,
    preferredSide: SelectionSide | undefined
  ): number | undefined {
    if (this.pre == null) return undefined;
    const selector = `[data-line="${lineNumber}"]`;
    const elements = Array.from(
      this.pre.querySelectorAll<HTMLElement>(selector)
    );
    if (elements.length === 0) return undefined;

    const filtered =
      preferredSide == null || preferredSide === 'both'
        ? elements
        : elements.filter(
            (element) => this.getLineSideFromElement(element) === preferredSide
          );

    const pool = filtered.length > 0 ? filtered : elements;

    let best: number | undefined;
    for (const element of pool) {
      const idx = this.getLineIndex(element);
      if (idx == null) continue;
      if (best == null || idx < best) {
        best = idx;
      }
    }
    return best;
  }

  private notifySelectionChange(): void {
    const { onLineSelected } = this.options;
    if (onLineSelected == null) return;

    onLineSelected(this.selectedRange ?? null);
  }

  private getLineElementFromEvent(event: MouseEvent): HTMLElement | undefined {
    const path = event.composedPath();
    for (const element of path) {
      if (element instanceof HTMLElement && element.hasAttribute('data-line')) {
        return element;
      }
    }
    return undefined;
  }

  private getLineNumber(element: HTMLElement): number {
    const lineStr = element.dataset.line ?? '0';
    return parseInt(lineStr, 10);
  }

  private getLineIndex(element: HTMLElement): number | undefined {
    const indexStr = element.dataset.lineIndex;
    if (indexStr == null) return undefined;
    const value = parseInt(indexStr, 10);
    return Number.isNaN(value) ? undefined : value;
  }

  private isLineNumberColumn(target: HTMLElement, event: MouseEvent): boolean {
    // Use composedPath to properly handle Shadow DOM
    const path = event.composedPath();
    for (const element of path) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.hasAttribute('data-column-number')) {
        return true;
      }
    }
    return false;
  }

  private getAllLineElements(): HTMLElement[] {
    if (this.pre == null) return [];
    const elements = this.pre.querySelectorAll('[data-line]');
    return Array.from(elements).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    );
  }

  private getLineSideFromElement(element: HTMLElement): SelectionSide {
    const parent = element.closest('[data-code]');
    if (!(parent instanceof HTMLElement)) {
      return 'both';
    }
    if ('additions' in parent.dataset) return 'additions';
    if ('deletions' in parent.dataset) return 'deletions';
    return 'both';
  }
}
