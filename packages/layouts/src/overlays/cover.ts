// The cover of a layout by an overlay: any dialog, popover, or drawer of an
// app, and the library's own `Modal` and `Drawer`. The panes that the overlay
// covers completely stop rendering until the release, and the layout element
// reports the covered and the overlapped panes. This module imports nothing
// from the store or the geometry.
import { PANE_VISIBILITY_EVENT } from '../dom/pane-visibility-event';
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
export const OVERLAY_COVER_EVENT = 'pierre-layout-cover';
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

/** The options of the library's own overlays. */
export interface CoverControl extends CoverOptions {
  /** False: report the panes, and hide none (the reference of the bench). */
  readonly hide?: boolean;
  /** Cover every pane at once, then only the panes of the box after the first layout. */
  readonly allFirst?: boolean;
  /** Place the overlay over the workspace before each measure. */
  place?(workspace: DOMRect): void;
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

/** The layout element: the element itself, or the first `.pierre-layout` inside it. */
export function layoutRootOf(element: HTMLElement): HTMLElement {
  if (element.classList.contains('pierre-layout')) return element;
  return element.querySelector<HTMLElement>('.pierre-layout') ?? element;
}

/** The pane hosts: children of the root, so no query walks pane content. */
function paneHostsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.layoutPane !== undefined
  );
}

const paneIdOf = (host: HTMLElement): string => host.dataset.layoutPane ?? '';

// A pane host that shows: not hidden, not an inactive tab, and not under a
// zoom. An overlay covers only these, and reports only these.
const shows = (host: HTMLElement): boolean =>
  host.dataset.paneHidden !== 'true' && host.dataset.hidden !== 'true';

// The count of the overlays that cover each pane of a view. A pane renders
// again when the last of them releases it.
const counts = new WeakMap<PaneVisibility, Map<string, number>>();

// The old `Layout` component has no visibility module: the overlays that hide
// each of its hosts, and the writes of the cover on them.
const legacyOverlays = new WeakMap<HTMLElement, Set<object>>();

function notify(host: HTMLElement, hidden: boolean): void {
  host.dispatchEvent(
    new CustomEvent(PANE_VISIBILITY_EVENT, { detail: { hidden } })
  );
}

/** Cover one pane, or release it, for one overlay. */
function coverPane(
  root: HTMLElement,
  host: HTMLElement,
  token: object,
  cover: boolean
): void {
  const visibility = visibilityOf(root);
  const id = paneIdOf(host);
  if (visibility !== undefined) {
    let byId = counts.get(visibility);
    if (byId === undefined) {
      byId = new Map();
      counts.set(visibility, byId);
    }
    const count = (byId.get(id) ?? 0) + (cover ? 1 : -1);
    if (count > 0) byId.set(id, count);
    else byId.delete(id);
    // The module sends the events, and only when the content starts or
    // stops rendering.
    if (count === (cover ? 1 : 0))
      visibility.set(id, OVERLAY, cover ? OVERLAY : 0);
    return;
  }
  // `inert` changes in the same style update as `content-visibility`, so the
  // content gets no new style for either change.
  const overlays = legacyOverlays.get(host) ?? new Set();
  legacyOverlays.set(host, overlays);
  if (cover) {
    if (overlays.has(token)) return;
    overlays.add(token);
    if (overlays.size > 1) return;
    host.dataset.overlayCovered = 'true';
    host.inert = true;
    notify(host, true);
  } else {
    if (!overlays.delete(token) || overlays.size > 0) return;
    delete host.dataset.overlayCovered;
    // A zoom or a hidden pane keeps its own `inert`.
    if (shows(host)) host.inert = false;
    notify(host, false);
  }
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** The cover of the library's own overlays; `coverLayout` is its public form. */
export function startCover(
  layout: HTMLElement,
  overlay: HTMLElement,
  control: CoverControl
): () => void {
  const root = layoutRootOf(layout);
  const token = {};
  const hidden = new Map<string, HTMLElement>();
  let cover = NO_COVER;
  const report = (next: OverlayCover): void => {
    if (
      sameList(next.covered, cover.covered) &&
      sameList(next.overlapped, cover.overlapped)
    )
      return;
    cover = next;
    control.onCover?.(next);
    root.dispatchEvent(
      new CustomEvent(OVERLAY_COVER_EVENT, { detail: { ...next, overlay } })
    );
  };
  // Hide exactly the panes in `ids`, among the hosts that show.
  const hideOnly = (
    hosts: readonly HTMLElement[],
    ids: ReadonlySet<string>
  ) => {
    if (control.hide === false) return;
    for (const host of hosts) {
      const id = paneIdOf(host);
      if (ids.has(id) && !hidden.has(id)) {
        hidden.set(id, host);
        coverPane(root, host, token, true);
      }
    }
    for (const [id, host] of hidden)
      if (!ids.has(id)) {
        hidden.delete(id);
        coverPane(root, host, token, false);
      }
  };
  const update = (): void => {
    const workspace = root.getBoundingClientRect();
    control.place?.(workspace);
    const hosts = paneHostsOf(root).filter(shows);
    // Offsets ignore the transforms of running animations, so these are the
    // boxes at the end of them.
    const next =
      control.area === 'all'
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
            {
              left: overlay.offsetLeft,
              top: overlay.offsetTop,
              right: overlay.offsetLeft + overlay.offsetWidth,
              bottom: overlay.offsetTop + overlay.offsetHeight,
            }
          );
    hideOnly([...hosts, ...hidden.values()], new Set(next.covered));
    report(next);
  };
  // Every pane stops rendering before the overlay shows, so that a modal
  // `<dialog>` that makes the page inert gives the covered content no new
  // style.
  if (control.area === 'all' || control.allFirst === true) {
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
    for (const host of hidden.values()) coverPane(root, host, token, false);
    hidden.clear();
    report(NO_COVER);
  };
}

/**
 * Start to cover the panes of a layout with an overlay element: any dialog,
 * popover, or drawer of the app. The panes that the overlay covers completely
 * stop rendering until the release, and the layout element receives
 * `OVERLAY_COVER_EVENT` with the covered and the overlapped panes. Call it
 * when the overlay opens, and call the release when its close starts, so that
 * the panes render under its exit. A pane under two overlays renders again
 * after both release it.
 */
export function coverLayout(
  layout: HTMLElement,
  overlay: HTMLElement,
  options: CoverOptions = {}
): () => void {
  return startCover(layout, overlay, options);
}
