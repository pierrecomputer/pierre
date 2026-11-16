// The cover of a layout by an overlay: any dialog, popover, or drawer of an
// app. The panes that the overlay covers completely stop rendering until the
// release, and the layout element reports the covered and the overlapped
// panes. This module imports nothing from the store or the geometry.
import { OVERLAY, type PaneVisibility, visibilityOf } from '../dom/visibility';

/** The panes under an overlay. */
export interface OverlayCover {
  /** Panes inside the overlay's box. */
  readonly covered: readonly string[];
  /** Panes that the overlay's box crosses: they show in part. */
  readonly overlapped: readonly string[];
}

/**
 * The event that the layout element receives when the panes under an
 * overlay change: when the cover starts, when the workspace or the overlay
 * changes size, and at the release (with no panes).
 */
export const OVERLAY_COVER_EVENT = 'pierre-layouts-cover';
export type OverlayCoverEvent = CustomEvent<
  OverlayCover & { overlay: HTMLElement }
>;

/** How an overlay covers a layout. */
export interface CoverOptions {
  /**
   * `box` (the default): the panes inside the overlay's box. `all`: every
   * pane, at once, for an opaque backdrop or a modal `<dialog>`.
   */
  readonly area?: 'box' | 'all';
  /** Called when the covered or the overlapped panes change, and with no panes at the release. */
  readonly onCover?: (cover: OverlayCover) => void;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const NO_COVER: OverlayCover = { covered: [], overlapped: [] };

/**
 * Sort panes into the ones inside an overlay's box and the ones that cross
 * it. Half a pixel of tolerance absorbs the rounding of fractional boxes.
 */
export function coverOf(
  panes: readonly { id: string; box: Box }[],
  box: Box
): OverlayCover {
  const covered: string[] = [];
  const overlapped: string[] = [];
  const slack = 0.5;
  for (const { id, box: pane } of panes) {
    const inside =
      pane.left >= box.left - slack &&
      pane.top >= box.top - slack &&
      pane.right <= box.right + slack &&
      pane.bottom <= box.bottom + slack;
    const crosses =
      pane.left < box.right - slack &&
      pane.right > box.left + slack &&
      pane.top < box.bottom - slack &&
      pane.bottom > box.top + slack;
    if (inside) covered.push(id);
    else if (crosses) overlapped.push(id);
  }
  return { covered, overlapped };
}

/** The layout element: the element itself, or the first `.pierre-layouts` inside it. */
function layoutRootOf(element: HTMLElement): HTMLElement {
  if (element.classList.contains('pierre-layouts')) return element;
  return element.querySelector<HTMLElement>('.pierre-layouts') ?? element;
}

/** The pane hosts: children of the root, so no query walks pane content. */
function paneHostsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.layoutsPane !== undefined
  );
}

const paneIdOf = (host: HTMLElement): string => host.dataset.layoutsPane ?? '';

// A pane host that shows: not hidden, not an inactive tab, and not under a
// zoom. An overlay covers only these, and reports only these.
const shows = (host: HTMLElement): boolean =>
  host.dataset.hidden !== 'true' && host.dataset.covered !== 'zoom';

// The count of the overlays that cover each pane of a view. A pane renders
// again when the last of them releases it.
const counts = new WeakMap<PaneVisibility, Map<string, number>>();

/**
 * Cover one pane, or release it, for one overlay. The visibility module of
 * the view writes the host and sends the events, and only when the content
 * starts or stops rendering (`DEC-layouts-pane-visibility-owner`).
 */
function coverPane(
  visibility: PaneVisibility,
  host: HTMLElement,
  cover: boolean
): void {
  const id = paneIdOf(host);
  let byId = counts.get(visibility);
  if (byId === undefined) {
    byId = new Map();
    counts.set(visibility, byId);
  }
  const count = (byId.get(id) ?? 0) + (cover ? 1 : -1);
  if (count > 0) byId.set(id, count);
  else byId.delete(id);
  if (count === (cover ? 1 : 0))
    visibility.set(id, OVERLAY, cover ? OVERLAY : 0);
}

let warnedNoRoot = false;

/**
 * The box of an overlay in viewport coordinates, from its layout offsets, so
 * that a running transform of the overlay does not move it, as for the panes.
 * The offsets are relative to the padding edge of the offset parent, which
 * can scroll; with no offset parent (a fixed overlay, or one in the top
 * layer), they are relative to the viewport; with the body as offset parent,
 * they are relative to the document.
 */
function overlayBox(overlay: HTMLElement): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const parent = overlay.offsetParent;
  let left = overlay.offsetLeft;
  let top = overlay.offsetTop;
  if (parent === document.body) {
    left -= scrollX;
    top -= scrollY;
  } else if (parent instanceof HTMLElement) {
    const box = parent.getBoundingClientRect();
    left += box.left + parent.clientLeft - parent.scrollLeft;
    top += box.top + parent.clientTop - parent.scrollTop;
  }
  return {
    left,
    top,
    right: left + overlay.offsetWidth,
    bottom: top + overlay.offsetHeight,
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Start to cover the panes of a layout with an overlay element: any dialog,
 * popover, or drawer of the app. The panes that the overlay covers completely
 * stop rendering until the release, and the layout element receives
 * `OVERLAY_COVER_EVENT` with the covered and the overlapped panes. Call it
 * when the overlay opens, and call the release when its close starts, so that
 * the panes render under its exit. A pane under two overlays renders again
 * after both release it. An element that `Layout.Root` does not render gets
 * no cover, and a warning in development.
 */
export function coverLayout(
  layout: HTMLElement,
  overlay: HTMLElement,
  options: CoverOptions = {}
): () => void {
  const root = layoutRootOf(layout);
  const visibility = visibilityOf(root);
  if (visibility === undefined) {
    if (process.env.NODE_ENV !== 'production' && !warnedNoRoot) {
      warnedNoRoot = true;
      console.warn(
        '@pierre/layouts: coverLayout found no layout that Layout.Root renders, so it covers nothing.'
      );
    }
    return () => {};
  }
  const hidden = new Map<string, HTMLElement>();
  let cover = NO_COVER;
  const report = (next: OverlayCover): void => {
    if (
      sameList(next.covered, cover.covered) &&
      sameList(next.overlapped, cover.overlapped)
    )
      return;
    cover = next;
    options.onCover?.(next);
    root.dispatchEvent(
      new CustomEvent(OVERLAY_COVER_EVENT, { detail: { ...next, overlay } })
    );
  };
  // Hide exactly the panes in `ids`, among the hosts that show.
  const hideOnly = (
    hosts: readonly HTMLElement[],
    ids: ReadonlySet<string>
  ) => {
    for (const host of hosts) {
      const id = paneIdOf(host);
      if (ids.has(id) && !hidden.has(id)) {
        hidden.set(id, host);
        coverPane(visibility, host, true);
      }
    }
    for (const [id, host] of hidden)
      if (!ids.has(id)) {
        hidden.delete(id);
        coverPane(visibility, host, false);
      }
  };
  const update = (): void => {
    const workspace = root.getBoundingClientRect();
    const hosts = paneHostsOf(root).filter(shows);
    // Offsets ignore the transforms of running animations, so these are the
    // boxes at the end of them.
    const next =
      options.area === 'all'
        ? { covered: hosts.map(paneIdOf), overlapped: [] }
        : coverOf(
            hosts.map((host) => ({
              id: paneIdOf(host),
              box: {
                left: workspace.left + host.offsetLeft,
                top: workspace.top + host.offsetTop,
                right: workspace.left + host.offsetLeft + host.offsetWidth,
                bottom: workspace.top + host.offsetTop + host.offsetHeight,
              },
            })),
            overlayBox(overlay)
          );
    hideOnly([...hosts, ...hidden.values()], new Set(next.covered));
    report(next);
  };
  // With `area: 'all'`, every pane stops rendering before the overlay shows,
  // so that a modal `<dialog>` that makes the page inert gives the covered
  // content no new style.
  if (options.area === 'all') {
    const hosts = paneHostsOf(root).filter(shows);
    hideOnly(hosts, new Set(hosts.map(paneIdOf)));
  }
  // Read the boxes after the browser lays them out, in the same frame: a read
  // now would force that layout in this task.
  const observer = new ResizeObserver(update);
  observer.observe(root);
  observer.observe(overlay);
  return () => {
    observer.disconnect();
    for (const host of hidden.values()) coverPane(visibility, host, false);
    hidden.clear();
    report(NO_COVER);
  };
}
