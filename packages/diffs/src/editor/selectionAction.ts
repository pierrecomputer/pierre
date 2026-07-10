import type { EditorSelection, TextEdit } from '../types';
import {
  type PopoverViewportBounds,
  setPopoverPositionStyles,
} from './popover';
import type { TextDocument } from './textDocument';
import { h } from './utils';

export interface SelectionActionContext<LAnnotation> {
  /** The current selection (live: reflects keyboard-driven changes). */
  selection: EditorSelection;
  /** The text document. */
  textDocument: TextDocument<LAnnotation>;
  /** Applies the edits to the text document. */
  applyEdits: (edits: TextEdit[]) => void;
  /** Gets the text of the current selection. */
  getSelectionText: () => string;
  /** Replaces the text of the current selection. */
  replaceSelectionText: (text: string) => void;
  /** Closes the selection action. */
  close: () => void;
}

/**
 * Selection action widget.
 */
export class SelectionActionWidget {
  #root: HTMLElement;
  // Cached border-box height, refreshed only when the popover's own size
  // actually changes (via #resizeObserver below)
  #height: number;
  #resizeObserver: ResizeObserver;

  constructor(
    selectionActionElement: HTMLElement,
    overlayElement: HTMLElement,
    onHeightChange: () => void
  ) {
    this.#root = h(
      'div',
      {
        dataset: { editorWidget: '', selectionActionPopover: '' },
        contentEditable: 'false',
        children: [selectionActionElement],
      },
      overlayElement
    );
    this.#height = this.#root.offsetHeight;
    this.#resizeObserver = new ResizeObserver(() => {
      const height = this.#root.offsetHeight;
      if (height !== this.#height) {
        this.#height = height;
        onHeightChange();
      }
    });
    this.#resizeObserver.observe(this.#root);
  }

  /**
   * Repositions the selection action widget.
   * @param left - The left position of the selection action widget.
   * @param top - The top position of the selection action widget.
   * @param gutterWidth - The width of the gutter.
   * @param placeAbove - Whether the selection action widget should be placed above the anchor.
   */
  reposition(
    left: number,
    top: number,
    gutterWidth: number,
    placeAbove: boolean,
    viewport?: PopoverViewportBounds
  ): void {
    setPopoverPositionStyles(this.#root, {
      gutterWidth,
      placeAbove,
      viewport,
      x: left,
      y: top,
    });
  }

  /**
   * Gets the height of the selection action widget.
   * @returns The height of the selection action widget.
   */
  get height(): number {
    return this.#height;
  }

  /**
   * Cleans up the selection action widget.
   */
  cleanup(): void {
    this.#resizeObserver.disconnect();
    this.#root.remove();
  }
}
