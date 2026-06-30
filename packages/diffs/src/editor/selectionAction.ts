import type { EditorSelection } from './selection';
import type { TextDocument, TextEdit } from './textDocument';
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

  cleanup(): void {
    this.#popover.remove();
  }
}
