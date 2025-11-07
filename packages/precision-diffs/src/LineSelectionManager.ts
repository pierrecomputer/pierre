export interface SelectedLineRange {
  first: number;
  last: number;
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
  private isDragging = false;

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
  setSelection(range: SelectedLineRange | null): void {
    if (range == null) {
      this.clearSelection();
    } else {
      this.selectedRange = range;
      this.applySelectionToDOM();
    }
    this.notifySelectionChange();
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

    const lineNumber = this.getLineNumberFromEvent(event);
    if (lineNumber == null) return;

    // Check if click was on a line number column
    const target = event.target as HTMLElement;
    const isNumberColumn = this.isLineNumberColumn(target, event);
    if (!isNumberColumn) return;

    event.preventDefault();

    const isShiftKey = event.shiftKey;

    if (isShiftKey && this.selectedRange != null) {
      // Extend existing selection to include the clicked line
      const oldFirst = this.selectedRange.first;
      const oldLast = this.selectedRange.last;
      const first = Math.min(oldFirst, lineNumber);
      const last = Math.max(oldLast, lineNumber);
      this.selectedRange = { first, last };
      // Set anchor to the opposite end from where we clicked
      this.anchorLine = lineNumber < oldFirst ? last : first;
      this.applySelectionToDOM();
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

      // Start new selection
      this.clearSelection();
      this.anchorLine = lineNumber; // Set anchor AFTER clearing
      this.selectedRange = { first: lineNumber, last: lineNumber };
      this.applySelectionToDOM();
    }

    this.isDragging = true;
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mouseup', this.handleMouseUp);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.isDragging || this.anchorLine == null) return;

    const lineNumber = this.getLineNumberFromEvent(event);
    if (lineNumber == null) return;

    this.updateSelection(lineNumber, true);
  };

  private handleMouseUp = (): void => {
    this.isDragging = false;
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);

    this.notifySelectionChange();
  };

  private updateSelection(currentLine: number, expandExisting: boolean): void {
    if (this.anchorLine == null) return;

    if (expandExisting && this.selectedRange != null) {
      // Expand based on anchor
      const first = Math.min(this.anchorLine, currentLine);
      const last = Math.max(this.anchorLine, currentLine);
      this.selectedRange = { first, last };
    } else {
      this.selectedRange = { first: currentLine, last: currentLine };
    }

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
  }

  private applySelectionToDOM(): void {
    if (this.pre == null || this.selectedRange == null) return;

    // First clear existing selections
    const allSelected = this.pre.querySelectorAll('[data-selected-line]');
    for (const element of allSelected) {
      element.removeAttribute('data-selected-line');
    }

    const { first, last } = this.selectedRange;
    const allLines = this.getAllLineElements();

    if (first === last) {
      // Single line selection
      const element = allLines.find((el) => this.getLineNumber(el) === first);
      if (element != null) {
        element.setAttribute('data-selected-line', 'single');
      }
    } else {
      // Multi-line selection
      for (let i = first; i <= last; i++) {
        const element = allLines.find((el) => this.getLineNumber(el) === i);
        if (element == null) continue;

        if (i === first) {
          element.setAttribute('data-selected-line', 'first');
        } else if (i === last) {
          element.setAttribute('data-selected-line', 'last');
        } else {
          element.setAttribute('data-selected-line', '');
        }
      }
    }
  }

  private notifySelectionChange(): void {
    const { onLineSelected } = this.options;
    if (onLineSelected == null) return;

    onLineSelected(this.selectedRange ?? null);
  }

  private getLineNumberFromEvent(event: MouseEvent): number | undefined {
    // Use composedPath to properly handle Shadow DOM
    const path = event.composedPath();
    for (const element of path) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.hasAttribute('data-line')) {
        return this.getLineNumber(element);
      }
    }
    return undefined;
  }

  private getLineNumber(element: HTMLElement): number {
    const lineStr = element.dataset.line ?? '0';
    return parseInt(lineStr, 10);
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
}
