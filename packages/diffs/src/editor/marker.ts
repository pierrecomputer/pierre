import { selectionIntersects } from './selection';
import type { Position, Range, TextDocument } from './textDocument';
import { addEventListener, getLineNumberAttr, h } from './utils';

export type MarkerSeverity = 'error' | 'warning' | 'info' | 'hint';

const MARKER_POPUP_SHOW_DELAY_MS = 300;
const MARKER_POPUP_HIDE_DELAY_MS = 100;

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

export interface Marker extends Range {
  severity: MarkerSeverity;
  message: string | { html: string };
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MarkerManagerContext {
  getRenderMarkerMessage?: () => ((marker: Marker) => HTMLElement) | undefined;
  getFileContainer: () => HTMLElement | undefined;
  getCharX: (line: number, character: number) => [number, number];
  getLineY: (line: number) => number;
  getLineHeight: () => number;
  isPointerGestureActive: () => boolean;
}

export class MarkerManager {
  #context: MarkerManagerContext;
  #markers: Marker[] = [];
  #markerSlotElements?: HTMLElement[];
  #markerPopupElement?: HTMLElement;
  #markerPopupEventDisposes?: (() => void)[];
  #markerEventDisposes?: (() => void)[];
  #markerPopupShowTimeout?: ReturnType<typeof setTimeout>;
  #markerPopupHideTimeout?: ReturnType<typeof setTimeout>;
  #pendingMarkerPopupIndex?: number;
  #hoveredMarkerIndex?: number;
  #isMarkerPopupHovered = false;

  constructor(context: MarkerManagerContext) {
    this.#context = context;
  }

  get markers(): readonly Marker[] {
    return this.#markers;
  }

  hasMarkers(): boolean {
    return this.#markers.length > 0;
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
    this.#markerSlotElements?.forEach((el) => el.remove());
    this.#markerSlotElements = undefined;
    this.removePopup();

    if (this.#markers.length === 0) {
      return;
    }

    const renderMarkerMessage = this.#context.getRenderMarkerMessage?.();
    const fileContainer = this.#context.getFileContainer();
    if (renderMarkerMessage !== undefined && fileContainer !== undefined) {
      this.#markerSlotElements = this.#markers.map((marker, index) =>
        h(
          'div',
          {
            dataset: 'markerSlot',
            slot: 'marker-' + index,
            style: {
              whiteSpace: 'normal',
            },
            children: [renderMarkerMessage(marker)],
          },
          fileContainer
        )
      );
    }
  }

  listenHover(contentEl: HTMLElement): void {
    this.#markerEventDisposes?.forEach((dispose) => dispose());
    this.#markerEventDisposes = undefined;
    if (!this.hasMarkers()) {
      return;
    }

    this.#markerEventDisposes = [
      addEventListener(contentEl, 'mouseover', (e) => {
        if (this.#context.isPointerGestureActive()) {
          return;
        }
        const target = e.composedPath()[0] as HTMLElement | undefined;
        if (target === undefined) {
          return;
        }

        const hoverMarkerIndex =
          this.#findHoveredMarkerIndex(target, this.#markers) ?? -1;
        if (hoverMarkerIndex > -1) {
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
    this.#markerSlotElements?.forEach((slot) => slot.remove());
    this.#markerSlotElements = undefined;
    this.#markers = [];
  }

  #findHoveredMarkerIndex(
    target: HTMLElement,
    markers: readonly Marker[]
  ): number | undefined {
    const lineElement = target.closest('[data-line]') as
      | HTMLElement
      | null
      | undefined;
    if (lineElement == null) {
      return;
    }

    const lineNumber = getLineNumberAttr(lineElement);
    if (lineNumber === undefined) {
      return;
    }

    let position: Position | undefined;
    if (target.tagName === 'SPAN') {
      const { char } = target.dataset;
      if (char === undefined) {
        return;
      }
      const character = parseInt(char, 10);
      if (Number.isNaN(character)) {
        return;
      }
      position = { line: lineNumber - 1, character };
    } else if (target.tagName === 'BR') {
      position = { line: lineNumber - 1, character: 0 };
    }
    if (position === undefined) {
      return;
    }

    for (let i = markers.length - 1; i >= 0; i--) {
      const marker = markers[i];
      if (selectionIntersects({ start: position, end: position }, marker)) {
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
    if (markerIndex === this.#hoveredMarkerIndex) {
      this.#cancelMarkerPopupHide();
      return;
    }
    if (markerIndex === this.#pendingMarkerPopupIndex) {
      this.#cancelMarkerPopupHide();
      return;
    }

    this.#cancelMarkerPopupShow();
    this.#cancelMarkerPopupHide();
    if (this.#hoveredMarkerIndex !== undefined) {
      this.#dismissMarkerPopup();
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

    const fileContainer = this.#context.getFileContainer();
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
    const [left, wrapLine] = this.#context.getCharX(line, character);
    const lineHeight = this.#context.getLineHeight();
    const y = this.#context.getLineY(line) + wrapLine * lineHeight + lineHeight;
    const offsetLeft = codeElement.offsetLeft;
    const offsetTop = codeElement.offsetTop;
    const renderMarkerMessage = this.#context.getRenderMarkerMessage?.();

    this.#markerPopupElement = h(
      'div',
      {
        dataset: ['editorWidget', 'markerPopup'],
        style: {
          transform: `translateX(${offsetLeft + left}px) translateY(${offsetTop + y}px)`,
        },
        children: [
          renderMarkerMessage !== undefined
            ? h('slot', { name: 'marker-' + hoveredMarkerIndex })
            : h('div', {
                dataset: 'markerMessage',
                ...(typeof message === 'string'
                  ? { textContent: message }
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
