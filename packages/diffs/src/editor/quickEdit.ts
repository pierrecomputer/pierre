import type { EditorSelection } from './selection';
import type { TextDocument, TextEdit } from './textDocument';
import { h } from './utils';

export interface QuickEditContext<LAnnotation> {
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
  /** Closes the quick edit. */
  close: () => void;
}

export class QuickEditWidget {
  static renderIcon(
    x: number,
    y: number,
    container: HTMLElement | DocumentFragment,
    onclick: () => void
  ): HTMLElement {
    return h(
      'div',
      {
        dataset: { quickEditIcon: '', visible: 'false' },
        title: 'Quick Edit',
        style: {
          transform: `translateY(${y}px) translateX(${x}px)`,
        },
        innerHTML: `<svg width="16" height="16" viewBox="0 0 20 20">
          <polygon points="11 3 9 9 16 9 9 17 11 11 4 11 11 3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" fill="currentColor"></polygon>
          </svg>
        `,
        onclick,
      },
      container
    );
  }

  #gutterBuffer: HTMLElement;
  #quickEditContainer: HTMLElement;
  #slot: HTMLElement;
  #observer: ResizeObserver;
  #handleDomResize: () => void;

  constructor(
    public line: number,
    quickEditElement: HTMLElement,
    fileContainer: HTMLElement,
    leadingWhitespaces = 0,
    handleDomResize: () => void
  ) {
    const slotName = 'quick-edit-' + line;
    this.#slot = h(
      'div',
      {
        dataset: 'quickEditSlot',
        slot: slotName,
        style: 'white-space: normal',
        children: [quickEditElement],
      },
      fileContainer
    );
    this.#gutterBuffer = h('div', {
      dataset: { gutterBuffer: 'quickEdit', bufferSize: '1' },
      style: 'grid-row: span 1',
    });
    this.#quickEditContainer = h('div', {
      dataset: { quickEdit: String(line) },
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
      contentLineElement.after(this.#quickEditContainer);
      gutterElement.style.gridRow = 'span ' + gutterElement.children.length;
      containerElement.style.gridRow =
        'span ' + containerElement.children.length;
      this.#handleDomResize();
    }
  }

  cleanup(): void {
    const gutter = this.#gutterBuffer.parentElement;
    const content = this.#quickEditContainer.parentElement;

    this.#gutterBuffer.remove();
    this.#quickEditContainer.remove();

    if (gutter != null && content != null) {
      gutter.style.gridRow = 'span ' + gutter.children.length;
      content.style.gridRow = 'span ' + content.children.length;
    }
    this.#handleDomResize();

    this.#slot.remove();
    this.#observer.disconnect();
  }
}
