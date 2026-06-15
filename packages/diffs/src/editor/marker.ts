import { selectionIntersects } from './selection';
import type { Position, Range, TextDocument } from './textDocument';
import { addEventListener, getLineNumberAttr, h } from './utils';

const MARKER_POPUP_SHOW_DELAY_MS = 300;
const MARKER_POPUP_HIDE_DELAY_MS = 100;

export type MarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface Marker extends Range {
  severity: MarkerSeverity;
  message: string | { html: string } | HTMLElement;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface EditorStub {
  getLineHeight: () => number;
  getFileContainer: () => HTMLElement | undefined;
  getCharX: (line: number, character: number) => [number, number];
  getLineY: (line: number) => number;
  isMouseDown: () => boolean;
}

export class MarkerRenderer {
  #editor: EditorStub;
  #markers: Marker[] = [];
  #markerPopupElement?: HTMLElement;
  #markerPopupEventDisposes?: (() => void)[];
  #markerEventDisposes?: (() => void)[];
  #markerPopupShowTimeout?: ReturnType<typeof setTimeout>;
  #markerPopupHideTimeout?: ReturnType<typeof setTimeout>;
  #pendingMarkerPopupIndex?: number;
  #hoveredMarkerIndex?: number;
  #isMarkerPopupHovered = false;

  constructor(editor: EditorStub) {
    this.#editor = editor;
  }

  get markers(): readonly Marker[] {
    return this.#markers;
  }

  isPopupVisible(): boolean {
    return this.#hoveredMarkerIndex !== undefined;
  }

  setMarkers<LAnnotation>(
    markers: Marker[],
    textDocument: TextDocument<LAnnotation>
  ): void {
    this.#markers = markers.map((marker) => ({
      ...marker,
      start: textDocument.normalizePosition(marker.start),
      end: textDocument.normalizePosition(marker.end),
    }));
    this.removePopup();
  }

  listenHover(contentEl: HTMLElement): void {
    this.#markerEventDisposes?.forEach((dispose) => dispose());
    this.#markerEventDisposes = undefined;
    if (this.#markers.length === 0) {
      return;
    }

    this.#markerEventDisposes = [
      addEventListener(contentEl, 'mouseover', (e) => {
        if (this.#editor.isMouseDown()) {
          return;
        }
        const target = e.composedPath()[0] as HTMLElement | undefined;
        if (target === undefined) {
          return;
        }

        const hoverMarkerIndex = this.#findHoveredMarkerIndex(target);
        if (hoverMarkerIndex !== undefined) {
          this.#scheduleMarkerPopup(hoverMarkerIndex);
        } else {
          this.#cancelMarkerPopupShow();
          this.#scheduleMarkerPopupHide();
        }
      }),
      addEventListener(contentEl, 'mouseleave', () => {
        this.#cancelMarkerPopupShow();
        this.#scheduleMarkerPopupHide();
      }),
    ];
  }

  removePopup(): void {
    this.#cancelMarkerPopupShow();
    this.#cancelMarkerPopupHide();
    this.#dismissMarkerPopup();
  }

  cleanup(): void {
    this.#markerEventDisposes?.forEach((dispose) => dispose());
    this.#markerEventDisposes = undefined;
    this.removePopup();
    this.#markers = [];
  }

  #findHoveredMarkerIndex(target: HTMLElement): number | undefined {
    const lineElement = target.closest('[data-line]');
    if (lineElement == null) {
      return;
    }

    const lineNumber = getLineNumberAttr(lineElement as HTMLElement);
    if (lineNumber === undefined) {
      return;
    }

    let character: number | undefined;
    if (target.tagName === 'SPAN') {
      const char = target.dataset.char;
      if (char === undefined) {
        return;
      }
      character = parseInt(char, 10);
      if (Number.isNaN(character)) {
        return;
      }
    } else if (target.tagName === 'BR') {
      character = 0;
    } else {
      return;
    }

    const position: Position = { line: lineNumber - 1, character };
    for (let i = this.#markers.length - 1; i >= 0; i--) {
      if (
        selectionIntersects(
          { start: position, end: position },
          this.#markers[i]
        )
      ) {
        return i;
      }
    }
    return undefined;
  }

  #cancelMarkerPopupShow(): void {
    if (this.#markerPopupShowTimeout !== undefined) {
      clearTimeout(this.#markerPopupShowTimeout);
      this.#markerPopupShowTimeout = undefined;
    }
    this.#pendingMarkerPopupIndex = undefined;
  }

  #cancelMarkerPopupHide(): void {
    if (this.#markerPopupHideTimeout !== undefined) {
      clearTimeout(this.#markerPopupHideTimeout);
      this.#markerPopupHideTimeout = undefined;
    }
  }

  #scheduleMarkerPopup(markerIndex: number): void {
    if (
      markerIndex === this.#hoveredMarkerIndex ||
      markerIndex === this.#pendingMarkerPopupIndex
    ) {
      this.#cancelMarkerPopupHide();
      return;
    }

    this.#cancelMarkerPopupShow();
    this.#cancelMarkerPopupHide();
    if (this.#markerPopupElement !== undefined) {
      this.#renderMarkerPopup(markerIndex);
      return;
    }

    this.#pendingMarkerPopupIndex = markerIndex;
    this.#markerPopupShowTimeout = setTimeout(() => {
      this.#markerPopupShowTimeout = undefined;
      this.#pendingMarkerPopupIndex = undefined;
      this.#renderMarkerPopup(markerIndex);
    }, MARKER_POPUP_SHOW_DELAY_MS);
  }

  #scheduleMarkerPopupHide(): void {
    if (this.#isMarkerPopupHovered) {
      return;
    }

    this.#cancelMarkerPopupHide();
    this.#markerPopupHideTimeout = setTimeout(() => {
      this.#markerPopupHideTimeout = undefined;
      if (!this.#isMarkerPopupHovered) {
        this.removePopup();
      }
    }, MARKER_POPUP_HIDE_DELAY_MS);
  }

  #dismissMarkerPopup(): void {
    this.#markerPopupEventDisposes?.forEach((dispose) => dispose());
    this.#markerPopupEventDisposes = undefined;
    this.#markerPopupElement?.remove();
    this.#markerPopupElement = undefined;
    this.#hoveredMarkerIndex = undefined;
    this.#isMarkerPopupHovered = false;
  }

  #renderMarkerPopup(hoveredMarkerIndex: number): void {
    if (hoveredMarkerIndex === this.#hoveredMarkerIndex) {
      return;
    }

    const fileContainer = this.#editor.getFileContainer();
    const preElement =
      fileContainer?.shadowRoot?.querySelector<HTMLElement>('pre');
    const codeElement = preElement?.querySelector<HTMLElement>('[data-code]');
    if (
      hoveredMarkerIndex >= this.#markers.length ||
      preElement == null ||
      codeElement == null
    ) {
      return;
    }

    const { start, message } = this.#markers[hoveredMarkerIndex];
    const { line, character } = start;
    const { getCharX, getLineY, getLineHeight } = this.#editor;
    const [left, wrapLine] = getCharX(line, character);
    const lineHeight = getLineHeight();
    const y = getLineY(line) + wrapLine * lineHeight + lineHeight;
    const transform = `translateX(${codeElement.offsetLeft + left}px) translateY(${codeElement.offsetTop + y}px)`;
    const popup = this.#markerPopupElement;

    if (popup !== undefined) {
      popup.style.transform = transform;
      const content = popup.firstElementChild as HTMLElement | null;
      if (content?.dataset.markerMessage !== undefined) {
        if (typeof message === 'string') {
          content.textContent = message;
        } else if (message instanceof HTMLElement) {
          content.replaceChildren(message);
        } else {
          content.innerHTML = message.html;
        }
      }
      this.#hoveredMarkerIndex = hoveredMarkerIndex;
      return;
    }

    this.#markerPopupElement = h(
      'div',
      {
        dataset: ['editorWidget', 'markerPopup'],
        style: { transform },
        children: [
          h('div', {
            dataset: 'markerMessage',
            ...(typeof message === 'string'
              ? { textContent: message }
              : message instanceof HTMLElement
                ? { children: [message] }
                : { innerHTML: message.html }),
          }),
        ],
      },
      preElement
    );
    this.#hoveredMarkerIndex = hoveredMarkerIndex;
    this.#markerPopupEventDisposes = [
      addEventListener(this.#markerPopupElement, 'mouseenter', () => {
        this.#isMarkerPopupHovered = true;
        this.#cancelMarkerPopupHide();
      }),
      addEventListener(this.#markerPopupElement, 'mouseleave', () => {
        this.#isMarkerPopupHovered = false;
        this.#scheduleMarkerPopupHide();
      }),
    ];
  }
}

export function markerSeverityDatasetKey(severity: MarkerSeverity): string {
  switch (severity) {
    case 'error':
      return 'markerError';
    case 'warning':
      return 'markerWarning';
    case 'info':
      return 'markerInfo';
    case 'hint':
      return 'markerHint';
  }
}
