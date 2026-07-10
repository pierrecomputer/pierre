import type { Position, Range } from '../types';
import {
  POPOVER_BOUNDARY_LINES,
  type PopoverManager,
  type PopoverPlacementBounds,
} from './popover';
import { selectionIntersects } from './selection';
import type { TextDocument } from './textDocument';
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

export interface MarkerRenderOptions {
  popoverManager: PopoverManager;
  getLineHeight: () => number;
  getOverlayElement: () => HTMLElement | undefined;
  getGutterWidth: () => number;
  getCharX: (line: number, character: number) => [number, number];
  getLineY: (line: number) => number;
  isMouseDown: () => boolean;
}

export class MarkerRenderer {
  #options: MarkerRenderOptions;
  #markers: Marker[] = [];
  // Document line count, used only by the no-viewport document-edge fallback.
  #lineCount = 0;
  #markerPopupElement?: HTMLElement;
  #markerPopupEventDisposes?: (() => void)[];
  #markerEventDisposes?: (() => void)[];
  #markerPopupShowTimeout?: ReturnType<typeof setTimeout>;
  #markerPopupHideTimeout?: ReturnType<typeof setTimeout>;
  #pendingMarkerPopupIndex?: number;
  #hoveredMarkerIndex?: number;
  #isMarkerPopupHovered = false;

  constructor(editor: MarkerRenderOptions) {
    this.#options = editor;
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
    this.#lineCount = textDocument.lineCount;
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
        if (this.#options.isMouseDown()) {
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

  // Positions the popup in overlay coordinate space (see [data-marker-popup]
  // in editor.css). When `placeAbove` is true, `y` is the top edge of the
  // marker's row and the popup is shifted up by its own height.
  #setMarkerPopupPosition(
    popup: HTMLElement,
    x: number,
    y: number,
    placeAbove: boolean
  ): void {
    popup.style.setProperty(
      '--gutter-width',
      this.#options.getGutterWidth() + 'px'
    );
    popup.style.setProperty('--popover-x', x + 'px');
    popup.style.setProperty('--popover-y', y + 'px');
    popup.style.setProperty('--popover-y-shift', placeAbove ? '-100%' : '0px');
  }

  // Positions the popup for a marker at `(line, character)`: prefers below
  // (the default), flipping above when below would be clipped by the visible
  // scrollport. Must run after the popup's content is final, since it reads
  // the popup's rendered height to decide whether either side fits.
  #positionMarkerPopup(
    popup: HTMLElement,
    line: number,
    character: number
  ): void {
    const { getCharX, getLineY, getLineHeight, popoverManager } = this.#options;
    const [left, wrapLine] = getCharX(line, character);
    const lineHeight = getLineHeight();
    const rowTop = getLineY(line) + wrapLine * lineHeight;
    const popoverHeight = popup.offsetHeight;

    const preferred: PopoverPlacementBounds = {
      top: rowTop + lineHeight,
      bottom: rowTop + lineHeight + popoverHeight,
    };
    const fallback: PopoverPlacementBounds = {
      top: rowTop - popoverHeight,
      bottom: rowTop,
    };
    const atDocumentEdge = line >= this.#lineCount - POPOVER_BOUNDARY_LINES;
    const viewport = popoverManager.getPlacementBounds();
    let placeAbove: boolean;
    if (viewport !== undefined && popoverHeight > 0) {
      const fits = (bounds: PopoverPlacementBounds): boolean =>
        bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
      placeAbove = !fits(preferred) && fits(fallback);
    } else {
      placeAbove = atDocumentEdge;
    }

    this.#setMarkerPopupPosition(
      popup,
      left,
      placeAbove ? rowTop : rowTop + lineHeight,
      placeAbove
    );
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

    const overlayElement = this.#options.getOverlayElement();
    if (hoveredMarkerIndex >= this.#markers.length || overlayElement == null) {
      return;
    }

    const { start, message, severity } = this.#markers[hoveredMarkerIndex];
    const { line, character } = start;
    const popup = this.#markerPopupElement;

    if (popup !== undefined) {
      setMarkerPopupSeverity(popup, severity);
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
      // Position after updating content: a different message size changes
      // the offsetHeight #positionMarkerPopup reads to decide placement.
      this.#positionMarkerPopup(popup, line, character);
      this.#hoveredMarkerIndex = hoveredMarkerIndex;
      return;
    }

    this.#markerPopupElement = h(
      'div',
      {
        dataset: {
          editorWidget: '',
          markerPopup: '',
          [markerSeverityDatasetKey(severity)]: '',
        },
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
      overlayElement
    );
    this.#positionMarkerPopup(this.#markerPopupElement, line, character);
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

const MARKER_SEVERITIES: readonly MarkerSeverity[] = [
  'error',
  'warning',
  'info',
  'hint',
];

// Marks the popup with data-marker-<severity> (the same boolean attribute the
// squiggle range element uses) so the CSS severity palette can target both with
// a single selector. The popup element is reused across hovers, so any
// previously applied severity attribute is cleared first.
function setMarkerPopupSeverity(
  popup: HTMLElement,
  severity: MarkerSeverity
): void {
  for (const candidate of MARKER_SEVERITIES) {
    delete popup.dataset[markerSeverityDatasetKey(candidate)];
  }
  popup.dataset[markerSeverityDatasetKey(severity)] = '';
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
