import { getPanes } from '../model';
import type { LayoutStore } from '../store';
import type { SeparatorGeometry } from '../types';
import { paneHosts } from './panes';

/**
 * How a pointer resize applies its ratios. `live` writes them on each pointer
 * move, `frame` once per animation frame, `preview` moves only the separator
 * and writes them on release, and `freeze` writes them live but keeps the size
 * of the content of the affected panes until the pointer pauses. `settle` is
 * `freeze`, but the content takes its new size one pane per frame.
 */
export type ResizeStrategy = 'live' | 'frame' | 'preview' | 'freeze' | 'settle';

// Pause after which a frozen drag lets pane content take its new size.
const FREEZE_PAUSE_MS = 150;

/** The DOM work of pointer resizes, from `createResizeWork`. */
export interface ResizeWork {
  /** Apply the ratios of one pointer move. */
  apply(
    root: HTMLElement,
    strategy: ResizeStrategy,
    separators: readonly SeparatorGeometry[],
    ratios: Record<string, number>,
    corners: readonly { id: string; splitIds: readonly string[] }[]
  ): void;
  /** End the work. Call it while the gesture is active, so that the last ratios do not animate. */
  end(cancel: boolean): void;
}

/**
 * The DOM work of pointer resizes with a resize strategy. The work moves
 * separators and freezes pane content with direct style writes, on each
 * pointer move, because a render of the view for each move would cost the
 * frame that the strategy saves. Each call names the layout root and the
 * strategy of the gesture. The state lives in this closure, so that a
 * minifier can shorten its names.
 */
export function createResizeWork(store: LayoutStore): ResizeWork {
  let strategy: ResizeStrategy = 'live';
  let root: HTMLElement | null = null;
  let frame: number | null = null;
  let pending: Record<string, number> | null = null;
  let moved: HTMLElement[] = [];
  let frozen: HTMLElement[] = [];
  let pause: ReturnType<typeof setTimeout> | null = null;
  let thawing: HTMLElement[] = [];

  /** Move the dragged separators, and the corners that they join, with a transform. */
  function preview(
    separators: readonly SeparatorGeometry[],
    ratios: Record<string, number>,
    corners: readonly { id: string; splitIds: readonly string[] }[]
  ): void {
    if (root === null) return;
    const host = root;
    const move = (element: HTMLElement, x: number, y: number): void => {
      element.style.transform = `translate(${x}px, ${y}px)`;
      element.dataset.preview = 'true';
      if (!moved.includes(element)) moved.push(element);
    };
    // The offset of each dragged split, along its own axis.
    const offsets = new Map<string, number>();
    for (const separator of separators) {
      const element = host.querySelector<HTMLElement>(
        `:scope > [data-layout-flip="separator:${CSS.escape(separator.split.id)}"]`
      );
      if (element === null) continue;
      const horizontal = separator.split.direction === 'horizontal';
      const available = horizontal
        ? separator.container.width - separator.rect.width
        : separator.container.height - separator.rect.height;
      const offset =
        ((ratios[separator.split.id] ?? separator.ratio) - separator.ratio) *
        available;
      offsets.set(separator.split.id, offset);
      move(element, horizontal ? offset : 0, horizontal ? 0 : offset);
    }
    for (const corner of corners) {
      const [horizontal, vertical] = corner.splitIds;
      if (!offsets.has(horizontal) && !offsets.has(vertical)) continue;
      const element = host.querySelector<HTMLElement>(
        `:scope > [data-layout-corner="${CSS.escape(corner.id)}"]`
      );
      if (element === null) continue;
      move(element, offsets.get(horizontal) ?? 0, offsets.get(vertical) ?? 0);
    }
  }

  /**
   * Give the content of each pane under the dragged splits its current size in
   * pixels, so that a ratio change resizes the pane hosts but does not lay out
   * their content. While frozen, the content also has strict containment and
   * its own compositor layer, so that a host that moves or clips it does not
   * paint it again. All sizes are read before the first write.
   */
  function freeze(separators: readonly SeparatorGeometry[]): void {
    if (root === null || frozen.length > 0) return;
    // Content that still waits to thaw is frozen again with the rest.
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    const waiting = thawing;
    thawing = [];
    const ids = new Set(
      separators.flatMap(({ split }) => getPanes(split).map(({ id }) => id))
    );
    const contents = paneHosts(root)
      .filter((host) => ids.has(host.dataset.layoutPane ?? ''))
      .map((host) =>
        host.querySelector<HTMLElement>(
          ':scope > .pierre-layout-pane-inner > .pierre-layout-content'
        )
      )
      .filter((content) => content !== null);
    const sizes = contents.map((content) => content.getBoundingClientRect());
    contents.forEach((content, index) => {
      content.style.flex = 'none';
      content.style.width = `${sizes[index].width}px`;
      content.style.height = `${sizes[index].height}px`;
      content.style.contain = 'strict';
      content.style.willChange = 'transform';
    });
    frozen = [
      ...contents,
      ...waiting.filter((content) => !contents.includes(content)),
    ];
  }

  /** Let frozen content take its new size: at once, or one pane per frame for `settle`. */
  function thaw(): void {
    const release = (content: HTMLElement): void => {
      content.style.flex = '';
      content.style.width = '';
      content.style.height = '';
      content.style.contain = '';
      content.style.willChange = '';
    };
    if (strategy !== 'settle') {
      frozen.forEach(release);
      frozen = [];
      return;
    }
    thawing = [...thawing, ...frozen];
    frozen = [];
    const step = (): void => {
      const next = thawing.shift();
      if (next !== undefined) release(next);
      frame = thawing.length > 0 ? requestAnimationFrame(step) : null;
    };
    if (frame === null) step();
  }

  return {
    apply(element, next, separators, ratios, corners) {
      root = element;
      strategy = next;
      if (strategy === 'frame') {
        pending = ratios;
        frame ??= requestAnimationFrame(() => {
          frame = null;
          if (pending !== null) store.setRatios(pending);
          pending = null;
        });
        return;
      }
      if (strategy === 'preview') {
        pending = ratios;
        preview(separators, ratios, corners);
        return;
      }
      if (strategy === 'freeze' || strategy === 'settle') {
        freeze(separators);
        if (pause !== null) clearTimeout(pause);
        pause = setTimeout(thaw, FREEZE_PAUSE_MS);
      }
      store.setRatios(ratios);
    },
    end(cancel) {
      if (frame !== null && strategy === 'frame') cancelAnimationFrame(frame);
      if (pause !== null) clearTimeout(pause);
      if (!cancel && pending !== null) store.setRatios(pending);
      for (const element of moved) {
        element.style.transform = '';
        delete element.dataset.preview;
      }
      pending = null;
      moved = [];
      pause = null;
      if (strategy === 'frame') frame = null;
      thaw();
    },
  };
}
