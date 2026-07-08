import { addEventListener } from './utils';

// Lines from the document edge at which the no-viewport fallback heuristic
// (see `atDocumentEdge` below) flips placement.
export const POPOVER_BOUNDARY_LINES = 3;

// Extra clearance (px) `preferred` must regain before a popover that flipped
// to `fallback` flips back, so an anchor sitting right at the flip boundary
// doesn't flicker between sides on every recompute.
export const POPOVER_FLIP_HYSTERESIS_PX = 4;

/**
 * The visible scroll viewport expressed in the overlay's coordinate space (the
 * same space --popover-y uses), or undefined when no usable layout geometry
 * exists (e.g. a detached unit-test DOM, where every rect is zero).
 */
export interface PopoverPlacementBounds {
  /** The top of the popover in overlay coordinate space. */
  top: number;
  /** The bottom of the popover in overlay coordinate space. */
  bottom: number;
}

export interface PopoverManagerOptions {
  hasActivePopover: () => boolean;
  updateActivePopover: () => void;
}

/**
 * Shared placement logic for the editor's overlay popovers: each anchors below
 * or above a document position, flipping to the opposite side only when the
 * preferred side would be clipped by the visible scrollport.
 */
export class PopoverManager {
  #fileContainer?: HTMLElement;
  #codeElement?: HTMLElement;
  #scrollContainer?: HTMLElement;
  #scrollContainerSource?: HTMLElement;
  #cachedCodeRect?: DOMRect;
  #cachedScrollContainerRect?: DOMRect;
  #viewportRectsDirty = true;
  #viewportRectListenersDisposes?: (() => void)[];
  #placement?: 'preferred' | 'fallback';

  readonly #hasActivePopover: () => boolean;
  readonly #updateActivePopover: () => void;

  constructor(options: PopoverManagerOptions) {
    this.#hasActivePopover = options.hasActivePopover;
    this.#updateActivePopover = options.updateActivePopover;
  }

  setViewportElements(
    fileContainer: HTMLElement,
    codeElement: HTMLElement
  ): void {
    this.#fileContainer = fileContainer;
    if (this.#codeElement === codeElement) {
      return;
    }
    this.#codeElement = codeElement;
    // A new [data-code] element invalidates the cached viewport rects (e.g. a
    // full re-render loaded a different file, possibly at a different on-screen
    // position) even without an intervening scroll/resize event.
    this.#viewportRectsDirty = true;
  }

  cleanUp(): void {
    this.#codeElement = undefined;
    this.#fileContainer = undefined;
    this.#scrollContainer = undefined;
    this.#scrollContainerSource = undefined;
    this.#cachedCodeRect = undefined;
    this.#cachedScrollContainerRect = undefined;
    this.#viewportRectsDirty = true;
    this.#viewportRectListenersDisposes?.forEach((dispose) => dispose());
    this.#viewportRectListenersDisposes = undefined;
    this.#placement = undefined;
  }

  resetPlacement(): void {
    this.#placement = undefined;
  }

  setPlacement(placement: 'preferred' | 'fallback'): void {
    this.#placement = placement;
  }

  // Flips to the opposite side only when the preferred side would be clipped by
  // the real scrollport and the fallback side fits; without viewport geometry,
  // falls back to the document-edge signal so the first/last rows still flip.
  choosePlacement(input: {
    /** Bounds for the anchor's preferred side (e.g. above for backward, below for forward). */
    preferred: PopoverPlacementBounds;
    /** Bounds for the opposite edge we flip to when the preferred side has no room. */
    fallback: PopoverPlacementBounds;
    /** The visible scrollport in overlay coordinate space, or undefined without layout geometry (e.g. a detached test DOM). */
    viewport: PopoverPlacementBounds | undefined;
    /** The popover's measured height; 0 before it has laid out. */
    popoverHeight: number;
    /** Whether the anchor is within the document's first/last rows; only used as a fallback signal when `viewport` is unavailable. */
    atDocumentEdge: boolean;
  }): 'preferred' | 'fallback' {
    const { preferred, fallback, viewport, popoverHeight, atDocumentEdge } =
      input;
    let placement: 'preferred' | 'fallback';
    if (viewport !== undefined && popoverHeight > 0) {
      const fits = (bounds: PopoverPlacementBounds, margin = 0): boolean =>
        bounds.top >= viewport.top + margin &&
        bounds.bottom <= viewport.bottom - margin;
      if (
        this.#placement === 'fallback' &&
        fits(fallback) &&
        !fits(preferred, POPOVER_FLIP_HYSTERESIS_PX)
      ) {
        placement = 'fallback';
      } else if (!fits(preferred) && fits(fallback)) {
        placement = 'fallback';
      } else {
        placement = 'preferred';
      }
    } else {
      placement = atDocumentEdge ? 'fallback' : 'preferred';
    }
    this.#placement = placement;
    return placement;
  }

  /**
   * Returns the bounds of the popover in overlay coordinate space.
   */
  getPlacementBounds(): PopoverPlacementBounds | undefined {
    const codeRect = this.#getCodeRect();
    if (codeRect === undefined) {
      return undefined;
    }
    const scrollContainerRect = this.#getScrollContainerRect();
    let topScreen: number;
    let bottomScreen: number;
    if (scrollContainerRect !== undefined) {
      topScreen = scrollContainerRect.top;
      bottomScreen = scrollContainerRect.bottom;
    } else {
      // No scrollable ancestor: the page itself scrolls, so the window is the
      // clip region.
      topScreen = 0;
      bottomScreen = window.innerHeight;
    }
    if (bottomScreen <= topScreen) {
      return undefined;
    }
    return {
      top: topScreen - codeRect.top,
      bottom: bottomScreen - codeRect.top,
    };
  }

  // The nearest scrollable ancestor of the file container -- the element whose
  // overflow clips overlay widgets. Walks the light-DOM ancestor chain (the
  // overlay lives in the file container's shadow root) and caches the result per
  // file container so it is not re-resolved on every render.
  //
  // Known limitations: this only inspects light-DOM ancestors outside the
  // shadow root, so it cannot see a clip boundary inside it (e.g. `[data-code]`
  // itself uses `overflow-y: clip`, which also is not one of the values matched
  // below) and cannot cross into an outer shadow root if the file container is
  // itself nested in another web component. It also only considers the
  // *nearest* scrollable ancestor, not the intersection of every clipping
  // ancestor, so a popover could still be clipped by an outer scroll context
  // even when it fits within this nearer one.
  #getScrollContainer(): HTMLElement | undefined {
    const fileContainer = this.#fileContainer;
    if (fileContainer === undefined) {
      return undefined;
    }
    if (this.#scrollContainerSource === fileContainer) {
      // A cached element can detach across re-mounts; re-resolve in that case
      // but otherwise trust the cache (including a cached "no scroller" result).
      if (
        this.#scrollContainer === undefined ||
        this.#scrollContainer.isConnected
      ) {
        return this.#scrollContainer;
      }
    }
    let element: HTMLElement | null = fileContainer.parentElement;
    while (element !== null) {
      const overflowY = getComputedStyle(element).overflowY;
      if (
        overflowY === 'auto' ||
        overflowY === 'scroll' ||
        overflowY === 'overlay'
      ) {
        this.#scrollContainer = element;
        this.#scrollContainerSource = fileContainer;
        return element;
      }
      element = element.parentElement;
    }
    this.#scrollContainer = undefined;
    this.#scrollContainerSource = fileContainer;
    return undefined;
  }

  // Lazily measures and caches the screen-space rects getOverlayViewport needs,
  // refreshing only when a scroll or resize event marks them dirty rather than
  // on every call. Selection-action placement can run once per keystroke while a
  // ranged selection stays open, so re-measuring via getBoundingClientRect on
  // every call would force a synchronous layout reflow on that hot path.
  #refreshViewportRectsIfNeeded(): void {
    if (!this.#viewportRectsDirty) {
      return;
    }
    this.#ensureViewportRectListeners();
    this.#cachedCodeRect = this.#codeElement?.getBoundingClientRect();
    this.#cachedScrollContainerRect =
      this.#getScrollContainer()?.getBoundingClientRect();
    this.#viewportRectsDirty = false;
  }

  #getCodeRect(): DOMRect | undefined {
    this.#refreshViewportRectsIfNeeded();
    return this.#cachedCodeRect;
  }

  #getScrollContainerRect(): DOMRect | undefined {
    this.#refreshViewportRectsIfNeeded();
    return this.#cachedScrollContainerRect;
  }

  // Subscribes once to events that can move or resize the cached rects: a scroll
  // on the resolved scroll container (or the window, when the page itself
  // scrolls) and a window resize. Scrolling/resizing can change whether the open
  // popover still fits, so this re-runs placement rAF-throttled.
  #ensureViewportRectListeners(): void {
    if (this.#viewportRectListenersDisposes !== undefined) {
      return;
    }
    let repositionRafId: number | undefined;
    const markDirty = () => {
      this.#viewportRectsDirty = true;
      if (!this.#hasActivePopover() || repositionRafId !== undefined) {
        return;
      }
      repositionRafId = requestAnimationFrame(() => {
        repositionRafId = undefined;
        this.#updateActivePopover();
      });
    };
    const scroller = this.#getScrollContainer();
    this.#viewportRectListenersDisposes = [
      scroller !== undefined
        ? addEventListener(scroller, 'scroll', markDirty, { passive: true })
        : addEventListener(window, 'scroll', markDirty, { passive: true }),
      addEventListener(window, 'resize', markDirty, { passive: true }),
      () => {
        if (repositionRafId !== undefined) {
          cancelAnimationFrame(repositionRafId);
          repositionRafId = undefined;
        }
      },
    ];
  }
}
