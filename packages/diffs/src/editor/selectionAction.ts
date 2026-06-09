import type { EditorSelection } from './selection';
import { getEditorIconSvg } from './sprite';
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

export class SelectionActionWidget {
  static renderIcon(
    x: number,
    y: number,
    container: HTMLElement | DocumentFragment,
    onclick: () => void
  ): HTMLElement {
    return h(
      'div',
      {
        dataset: { selectionActionIcon: '', visible: 'false' },
        title: 'Selection Action',
        style: {
          transform: `translateY(${y}px) translateX(${x}px)`,
        },
        innerHTML: getEditorIconSvg('quick'),
        onclick,
      },
      container
    );
  }

  #gutterBuffer: HTMLElement;
  #selectionActionContainer: HTMLElement;
  #slot: HTMLElement;
  #observer: ResizeObserver;
  #handleDomResize: () => void;

  constructor(
    public line: number,
    selectionActionElement: HTMLElement,
    fileContainer: HTMLElement,
    leadingWhitespaces = 0,
    handleDomResize: () => void
  ) {
    const slotName = 'selection-action-' + line;
    this.#slot = h(
      'div',
      {
        dataset: 'selectionActionSlot',
        slot: slotName,
        style: 'white-space: normal',
        children: [selectionActionElement],
      },
      fileContainer
    );
    this.#gutterBuffer = h('div', {
      dataset: { gutterBuffer: 'selectionAction', bufferSize: '1' },
      style: 'grid-row: span 1',
    });
    this.#selectionActionContainer = h('div', {
      dataset: { selectionAction: String(line) },
      style: {
        paddingInlineStart: leadingWhitespaces + 1 + 'ch', // +1 align css `padding-inline`
      },
      contentEditable: 'false',
      children: [h('slot', { name: slotName })],
    });
    this.#observer = new ResizeObserver(handleDomResize);
    this.#observer.observe(this.#slot);
    this.#handleDomResize = handleDomResize;
  }

  render(containerElement: HTMLElement): void {
    const gutterElement =
      containerElement.previousElementSibling as HTMLElement | null;
    const lineNumber = this.line + 1;
    const gutterLineElement = gutterElement?.querySelector<HTMLElement>(
      `[data-column-number="${lineNumber}"]`
    );
    const contentLineElement = containerElement.querySelector<HTMLElement>(
      `[data-line="${lineNumber}"]`
    );
    if (
      gutterElement != null &&
      gutterLineElement != null &&
      contentLineElement != null
    ) {
      gutterLineElement.after(this.#gutterBuffer);
      contentLineElement.after(this.#selectionActionContainer);
      gutterElement.style.gridRow = 'span ' + gutterElement.children.length;
      containerElement.style.gridRow =
        'span ' + containerElement.children.length;
      this.#handleDomResize();
    }
  }

  cleanup(): void {
    const gutter = this.#gutterBuffer.parentElement;
    const content = this.#selectionActionContainer.parentElement;

    this.#gutterBuffer.remove();
    this.#selectionActionContainer.remove();

    if (gutter != null && content != null) {
      gutter.style.gridRow = 'span ' + gutter.children.length;
      content.style.gridRow = 'span ' + content.children.length;
    }
    this.#handleDomResize();

    this.#slot.remove();
    this.#observer.disconnect();
  }
}
