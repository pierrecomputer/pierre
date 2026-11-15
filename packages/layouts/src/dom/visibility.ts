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

/** The reasons that hide the whole host of a pane. */
export const HOST_HIDDEN: number =
  HIDDEN | INACTIVE | COLLAPSED_WHOLE | ZOOM | OVERLAY;

/** The reasons that come from the layout state. */
export const STATE_REASONS: number =
  HIDDEN | INACTIVE | COLLAPSED | COLLAPSED_WHOLE;

/**
 * The owner of the visibility of the pane hosts of a view. It keeps the
 * reasons of each pane, and it alone writes `inert` and the visibility
 * attributes: `data-pane-hidden` and `data-collapsed` on the host, and
 * `data-collapsed` on the content. A host receives `PANE_VISIBILITY_EVENT`
 * only when its content starts or stops rendering.
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
      if (host.inert !== hidden) host.inert = hidden;
      mark(host, 'data-pane-hidden', hidden);
      mark(host, 'data-collapsed', collapsed);
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
  return {
    hostRef: (id) => refOf(hostRefs, hosts, id),
    contentRef: (id) => refOf(contentRefs, contents, id),
    reasons: (id) => reasons.get(id) ?? 0,
    set(id, mask, value) {
      const before = reasons.get(id);
      const next = ((before ?? 0) & ~mask) | (value & mask);
      if (next === before) return;
      reasons.set(id, next);
      write(id);
      if (before !== undefined && (before === 0) !== (next === 0))
        hosts.get(id)?.dispatchEvent(
          new CustomEvent(PANE_VISIBILITY_EVENT, {
            detail: { hidden: next !== 0 },
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
  };
}
