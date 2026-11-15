import { PANE_VISIBILITY_EVENT } from './panes';

// The reasons why a pane does not show all of its content, as bits. A pane
// with no reason shows, and its content renders.

/** The pane is hidden (`setHidden`), or a split above it shows nothing. */
export const HIDDEN = 1;
/** Another tab of the stack of the pane is active. */
export const INACTIVE = 2;
/**
 * The pane, or its stack, is collapsed: its content (`Layout.Content`) does
 * not show, and its header does.
 */
export const COLLAPSED = 4;
/** With `COLLAPSED`: the pane collapses to 0 pixels, so it shows nothing. */
export const COLLAPSED_WHOLE = 8;
/** A zoomed pane covers the pane. */
export const ZOOM = 16;
/** An overlay covers the pane. */
export const OVERLAY = 32;
/**
 * A zoom covers the pane, and its animation still runs. The pane leaves the
 * accessibility tree and the tab order at once (`aria-hidden`, no tab stop),
 * and its content still renders: it changes no style, so it costs no layout
 * of the content. The content stops rendering with `ZOOM`, at the end of the
 * animation.
 */
export const COVERED = 64;

/** The reasons that hide the whole host of a pane. */
export const HOST_HIDDEN: number =
  HIDDEN | INACTIVE | COLLAPSED_WHOLE | ZOOM | OVERLAY;

/** The reasons that come from the layout state. */
export const STATE_REASONS: number =
  HIDDEN | INACTIVE | COLLAPSED | COLLAPSED_WHOLE;

/**
 * The owner of the visibility of the pane hosts of a view. It keeps the
 * reasons of each pane, and it alone writes `inert` and the visibility
 * attributes: `data-pane-hidden` (hidden, an inactive tab, or a collapse to 0
 * pixels: the host does not show), `data-hidden` (under a zoom: the host
 * keeps its box and skips its rendering), `data-overlay-covered`,
 * `data-collapsed`, `aria-hidden`, and the tab stop of a covered host, and
 * `data-collapsed` on the content. A host
 * receives `PANE_VISIBILITY_EVENT` only when its content starts or stops
 * rendering: `COVERED` alone does not stop it.
 */
export interface PaneVisibility {
  /** The callback ref of the host of a pane. It keeps its identity. */
  hostRef(id: string): (element: HTMLElement | null) => void;
  /** The callback ref of the content of a pane (`Layout.Content`). It keeps its identity. */
  contentRef(id: string): (element: HTMLElement | null) => void;
  /** The reasons of a pane, as bits. */
  reasons(id: string): number;
  /** Set the reasons of `mask` for a pane to those in `reasons`. */
  set(id: string, mask: number, reasons: number): void;
  /** Call `listener` after the reasons of any pane change. */
  subscribe(listener: () => void): () => void;
  /** Drop every entry of the panes that are not in `panes`. */
  forget(panes: ReadonlySet<string>): void;
}

// In development, the maps of each visibility module, for the tests of
// `forget`.
const developmentMaps = /* @__PURE__ */ new WeakMap<
  PaneVisibility,
  readonly Map<string, unknown>[]
>();

/**
 * The IDs of the panes that a visibility module keeps an entry for. Tests
 * read it in a development build; in a production build it is empty.
 */
export function visibilityIds(visibility: PaneVisibility): Set<string> {
  return new Set(
    (developmentMaps.get(visibility) ?? []).flatMap((map) => [...map.keys()])
  );
}

/** Set an attribute to `true`, or remove it, only when it changes. */
function mark(element: HTMLElement, name: string, on: boolean): void {
  if ((element.getAttribute(name) === 'true') !== on) {
    if (on) element.setAttribute(name, 'true');
    else element.removeAttribute(name);
  }
}

type ElementRef = (element: HTMLElement | null) => void;

/** The visibility of the pane hosts of one view. */
export function createPaneVisibility(): PaneVisibility {
  // The reasons of each pane whose host is in the DOM.
  const reasons = new Map<string, number>();
  const hosts = new Map<string, HTMLElement>();
  const contents = new Map<string, HTMLElement>();
  const hostRefs = new Map<string, ElementRef>();
  const contentRefs = new Map<string, ElementRef>();
  const listeners = new Set<() => void>();
  // `inert` is inherited, so on content that renders it lays out all of that
  // content again (about 200 ms for 15 panes of real content). It changes
  // with the attribute that gives `content-visibility: hidden`, in one style
  // update, so the content does not render for either change.
  const write = (id: string): void => {
    const bits = reasons.get(id) ?? 0;
    const collapsed = (bits & COLLAPSED) !== 0;
    const host = hosts.get(id);
    if (host !== undefined) {
      const hidden = (bits & HOST_HIDDEN) !== 0;
      const covered = (bits & COVERED) !== 0;
      if (host.inert !== hidden) host.inert = hidden;
      mark(
        host,
        'data-pane-hidden',
        (bits & (HIDDEN | INACTIVE | COLLAPSED_WHOLE)) !== 0
      );
      mark(host, 'data-hidden', (bits & ZOOM) !== 0);
      mark(host, 'data-overlay-covered', (bits & OVERLAY) !== 0);
      mark(host, 'data-collapsed', collapsed);
      mark(host, 'aria-hidden', covered);
      // `Root` renders each host as a tab stop.
      if (host.tabIndex !== (covered ? -1 : 0))
        host.tabIndex = covered ? -1 : 0;
    }
    const content = contents.get(id);
    if (content !== undefined) {
      if (content.inert !== collapsed) content.inert = collapsed;
      mark(content, 'data-collapsed', collapsed);
    }
  };
  // A callback ref that keeps its identity, so that React calls it only when
  // its element mounts and unmounts.
  const refOf = (
    refs: Map<string, ElementRef>,
    elements: Map<string, HTMLElement>,
    id: string
  ): ElementRef => {
    let ref = refs.get(id);
    if (ref === undefined) {
      ref = (element) => {
        if (element !== null) {
          elements.set(id, element);
          write(id);
        } else {
          elements.delete(id);
          // A host that mounts again starts with no reasons, and its first
          // reasons send no event.
          if (elements === hosts) reasons.delete(id);
        }
      };
      refs.set(id, ref);
    }
    return ref;
  };
  const maps = [reasons, hosts, contents, hostRefs, contentRefs];
  const visibility: PaneVisibility = {
    hostRef: (id) => refOf(hostRefs, hosts, id),
    contentRef: (id) => refOf(contentRefs, contents, id),
    reasons: (id) => reasons.get(id) ?? 0,
    set(id, mask, value) {
      const before = reasons.get(id);
      const next = ((before ?? 0) & ~mask) | (value & mask);
      if (next === before) return;
      reasons.set(id, next);
      write(id);
      const rendered = (before ?? 0) & ~COVERED;
      const rendering = next & ~COVERED;
      if (before !== undefined && (rendered === 0) !== (rendering === 0))
        hosts.get(id)?.dispatchEvent(
          new CustomEvent(PANE_VISIBILITY_EVENT, {
            detail: { hidden: rendering !== 0 },
          })
        );
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    forget(panes) {
      for (const map of maps)
        for (const id of map.keys()) if (!panes.has(id)) map.delete(id);
    },
  };
  if (process.env.NODE_ENV !== 'production')
    developmentMaps.set(visibility, maps);
  return visibility;
}

// The visibility module of each layout element that a view renders, so that
// the cover of an overlay finds it with no import of the view.
const registered = new WeakMap<HTMLElement, PaneVisibility>();

/** Register the visibility module of a layout element, or remove it with null. */
export function registerVisibility(
  element: HTMLElement,
  visibility: PaneVisibility | null
): void {
  if (visibility === null) registered.delete(element);
  else registered.set(element, visibility);
}

/** The visibility module of a layout element, or undefined (the old `Layout` component). */
export const visibilityOf = (
  element: HTMLElement
): PaneVisibility | undefined => registered.get(element);
