// Shared placement logic for the editor's overlay popovers (marker hover
// popup and selection-action popover): each anchors below or above a
// document position, flipping to the opposite side only when the preferred
// side would be clipped by the visible scrollport.

// A popover candidate's vertical extent in overlay coordinate space (the
// same space --popover-y uses).
export interface PopoverPlacementBounds {
  top: number;
  bottom: number;
}

// Lines from the document edge at which the no-viewport fallback heuristic
// (see `atDocumentEdge` below) flips placement.
export const POPOVER_BOUNDARY_LINES = 3;

// Extra clearance (px) `preferred` must regain before a popover that flipped
// to `fallback` flips back, so an anchor sitting right at the flip boundary
// doesn't flicker between sides on every recompute.
const POPOVER_FLIP_HYSTERESIS_PX = 4;

export interface ChoosePopoverPlacementInput {
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
  /**
   * The side chosen on the previous call, if any. Flipping back from
   * `fallback` to `preferred` then requires clearing the viewport by
   * `POPOVER_FLIP_HYSTERESIS_PX`. Omit for popovers that recompute rarely
   * enough that flicker isn't a concern (e.g. hover-triggered popups).
   */
  previousPlacement?: 'preferred' | 'fallback';
}

// Flips to the opposite side only when the preferred side would be clipped by
// the real scrollport and the fallback side fits; without viewport geometry,
// falls back to the document-edge signal so the first/last rows still flip.
export function choosePopoverPlacement(
  input: ChoosePopoverPlacementInput
): 'preferred' | 'fallback' {
  const {
    preferred,
    fallback,
    viewport,
    popoverHeight,
    atDocumentEdge,
    previousPlacement,
  } = input;
  if (viewport !== undefined && popoverHeight > 0) {
    const fits = (bounds: PopoverPlacementBounds, margin = 0): boolean =>
      bounds.top >= viewport.top + margin &&
      bounds.bottom <= viewport.bottom - margin;
    if (
      previousPlacement === 'fallback' &&
      fits(fallback) &&
      !fits(preferred, POPOVER_FLIP_HYSTERESIS_PX)
    ) {
      return 'fallback';
    }
    if (!fits(preferred) && fits(fallback)) {
      return 'fallback';
    }
    return 'preferred';
  }
  return atDocumentEdge ? 'fallback' : 'preferred';
}
