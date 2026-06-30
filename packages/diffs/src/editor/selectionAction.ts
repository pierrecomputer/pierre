import type { EditorSelection } from './selection';
import type { TextDocument, TextEdit } from './textDocument';
import { h } from './utils';

// Vertical extent of a popover placement candidate in the overlay's coordinate
// space (the same space --popover-y uses): `top` is the popover's top edge and
// `bottom` its bottom edge.
export interface PopoverPlacementBounds {
  top: number;
  bottom: number;
}

export interface ChoosePopoverPlacementInput {
  /** Bounds for the direction's preferred side (above for backward, below for forward). */
  preferred: PopoverPlacementBounds;
  /** Bounds for the opposite edge we flip to when the preferred side has no room. */
  fallback: PopoverPlacementBounds;
  /**
   * The visible scrollport in overlay coordinate space, or undefined when no
   * layout geometry is available (e.g. a detached unit-test DOM).
   */
  viewport: PopoverPlacementBounds | undefined;
  /** The popover's measured height; 0 before it has laid out. */
  popoverHeight: number;
  /**
   * Whether the head sits within the document's first/last rows. Used only when
   * `viewport` geometry is unavailable, so placement still flips at the very
   * top/bottom of the document.
   */
  atDocumentEdge: boolean;
}

// Decides whether the selection-action popover keeps its preferred side or flips
// to the opposite edge. When the real scrollport is known it flips only if the
// preferred side would be clipped and the fallback side actually fits, so a
// mid-document selection near the top/bottom of a scrolled viewport no longer
// renders the popover off-screen. Without viewport geometry it falls back to the
// document-edge signal so the very first/last rows still flip.
export function choosePopoverPlacement(
  input: ChoosePopoverPlacementInput
): 'preferred' | 'fallback' {
  const { preferred, fallback, viewport, popoverHeight, atDocumentEdge } =
    input;
  if (viewport !== undefined && popoverHeight > 0) {
    const fits = (bounds: PopoverPlacementBounds): boolean =>
      bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
    if (!fits(preferred) && fits(fallback)) {
      return 'fallback';
    }
    return 'preferred';
  }
  return atDocumentEdge ? 'fallback' : 'preferred';
}

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

// Floating popover that hosts the consumer's selection-action element. It mounts
// into the editor's overlay layer and is positioned via CSS custom properties
// (the shared popover rule in editor.css), mirroring the marker hover popover, so
// it never reflows the document the way the old inline gutter-triggered row did.
// The consumer's element can hold any number of actions; the editor only owns
// where the popover sits.
export class SelectionActionWidget {
  // The line the popover is anchored to. This is usually the selection's head,
  // but near the document boundaries the editor flips placement to the
  // selection's opposite edge, so it may be that edge instead.
  line: number;
  #popover: HTMLElement;
  // Cached border-box height, refreshed only when the popover's own size
  // actually changes (via #resizeObserver below) rather than re-read through
  // offsetHeight on every `height` access. The editor's
  // #updateSelectionActionPopover can run once per keystroke while a ranged
  // selection stays open, so forcing a fresh layout read on every call would
  // add a synchronous reflow to that hot path.
  #height: number;
  #resizeObserver: ResizeObserver;

  constructor(
    line: number,
    selectionActionElement: HTMLElement,
    overlayElement: HTMLElement
  ) {
    this.line = line;
    this.#popover = h(
      'div',
      {
        dataset: { editorWidget: '', selectionActionPopover: '' },
        contentEditable: 'false',
        children: [selectionActionElement],
      },
      overlayElement
    );
    // Measured synchronously once so the very first reposition (right after
    // construction) already has an accurate height instead of waiting for the
    // ResizeObserver's async callback; later size changes (e.g. the
    // consumer's content changing while the selection stays open) are picked
    // up reactively below.
    this.#height = this.#popover.offsetHeight;
    this.#resizeObserver = new ResizeObserver(() => {
      this.#height = this.#popover.offsetHeight;
    });
    this.#resizeObserver.observe(this.#popover);
  }

  // Anchor the popover at `(left, top)`, expressed in the overlay's coordinate
  // space (the same space caret/selection overlays use). Horizontal placement and
  // sizing are handled in CSS via the shared popover rule; `gutterWidth` lets it
  // keep the popover clear of the line-number gutter. When `placeAbove` is true,
  // `top` is the top edge of the anchored row and the popover is shifted up by
  // its own height so it sits above that row rather than covering it.
  reposition(
    left: number,
    top: number,
    gutterWidth: number,
    placeAbove: boolean
  ): void {
    this.#popover.style.setProperty('--gutter-width', gutterWidth + 'px');
    this.#popover.style.setProperty('--popover-x', left + 'px');
    this.#popover.style.setProperty('--popover-y', top + 'px');
    this.#popover.style.setProperty(
      '--popover-y-shift',
      placeAbove ? '-100%' : '0px'
    );
  }

  // The popover's rendered (border-box) height in CSS pixels, or 0 before it has
  // laid out. The editor reads this to decide, against the visible scrollport,
  // whether an above/below placement would be clipped.
  get height(): number {
    return this.#height;
  }

  cleanup(): void {
    this.#resizeObserver.disconnect();
    this.#popover.remove();
  }
}
