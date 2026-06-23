import type { EditorSelection } from './selection';
import type { TextDocument, TextEdit } from './textDocument';
import { h } from './utils';

export interface SelectionActionContext<LAnnotation> {
  /** The current selection. */
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
// into the editor's overlay layer and is positioned with a transform, mirroring
// the marker hover popover, so it never reflows the document the way the old
// inline gutter-triggered row did. The consumer's element can hold any number of
// actions; the editor only owns where the popover sits.
export class SelectionActionWidget {
  // The line the popover is anchored to (the selection's head). The editor reads
  // this to decide whether the anchor is still on a visible line.
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
  // space (the same space caret/selection overlays use).
  reposition(left: number, top: number): void {
    this.#popover.style.transform = `translateX(${left}px) translateY(${top}px)`;
  }

  cleanup(): void {
    this.#popover.remove();
  }
}
