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

/**
 * The DOM work of one pointer resize with a resize strategy. The work moves
 * separators and freezes pane content with direct style writes, on each
 * pointer move, because a render of the view for each move would cost the
 * frame that the strategy saves. Each call names the layout root and the
 * strategy of the gesture.
 */
export class ResizeWork {
  private strategy: ResizeStrategy = 'live';
  private root: HTMLElement | null = null;
  private frame: number | null = null;
  private pending: Record<string, number> | null = null;
  private moved: HTMLElement[] = [];
  private frozen: HTMLElement[] = [];
  private pause: ReturnType<typeof setTimeout> | null = null;
  private thawing: HTMLElement[] = [];

  private readonly store: LayoutStore;

  constructor(store: LayoutStore) {
    this.store = store;
  }

  /** Apply the ratios of one pointer move. */
  apply(
    root: HTMLElement,
    strategy: ResizeStrategy,
    separators: readonly SeparatorGeometry[],
    ratios: Record<string, number>,
    corners: readonly { id: string; splitIds: readonly string[] }[]
  ): void {
    this.root = root;
    this.strategy = strategy;
    if (this.strategy === 'frame') {
      this.pending = ratios;
      this.frame ??= requestAnimationFrame(() => {
        this.frame = null;
        if (this.pending !== null) this.store.setRatios(this.pending);
        this.pending = null;
      });
      return;
    }
    if (this.strategy === 'preview') {
      this.pending = ratios;
      this.preview(separators, ratios, corners);
      return;
    }
    if (this.strategy === 'freeze' || this.strategy === 'settle') {
      this.freeze(separators);
      if (this.pause !== null) clearTimeout(this.pause);
      this.pause = setTimeout(() => this.thaw(), FREEZE_PAUSE_MS);
    }
    this.store.setRatios(ratios);
  }

  /** End the work. Call it while the gesture is active, so that the last ratios do not animate. */
  end(cancel: boolean): void {
    if (this.frame !== null && this.strategy === 'frame')
      cancelAnimationFrame(this.frame);
    if (this.pause !== null) clearTimeout(this.pause);
    if (!cancel && this.pending !== null) this.store.setRatios(this.pending);
    for (const element of this.moved) {
      element.style.transform = '';
      delete element.dataset.preview;
    }
    this.pending = null;
    this.moved = [];
    this.pause = null;
    if (this.strategy === 'frame') this.frame = null;
    this.thaw();
  }

  /** Move the dragged separators, and the corners that they join, with a transform. */
  private preview(
    separators: readonly SeparatorGeometry[],
    ratios: Record<string, number>,
    corners: readonly { id: string; splitIds: readonly string[] }[]
  ): void {
    const root = this.root;
    if (root === null) return;
    const move = (element: HTMLElement, x: number, y: number): void => {
      element.style.transform = `translate(${x}px, ${y}px)`;
      element.dataset.preview = 'true';
      if (!this.moved.includes(element)) this.moved.push(element);
    };
    // The offset of each dragged split, along its own axis.
    const offsets = new Map<string, number>();
    for (const separator of separators) {
      const element = root.querySelector<HTMLElement>(
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
      const element = root.querySelector<HTMLElement>(
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
  private freeze(separators: readonly SeparatorGeometry[]): void {
    const root = this.root;
    if (root === null || this.frozen.length > 0) return;
    // Content that still waits to thaw is frozen again with the rest.
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const waiting = this.thawing;
    this.thawing = [];
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
    this.frozen = [
      ...contents,
      ...waiting.filter((content) => !contents.includes(content)),
    ];
  }

  /** Let frozen content take its new size: at once, or one pane per frame for `settle`. */
  private thaw(): void {
    const thaw = (content: HTMLElement): void => {
      content.style.flex = '';
      content.style.width = '';
      content.style.height = '';
      content.style.contain = '';
      content.style.willChange = '';
    };
    if (this.strategy !== 'settle') {
      this.frozen.forEach(thaw);
      this.frozen = [];
      return;
    }
    this.thawing = [...this.thawing, ...this.frozen];
    this.frozen = [];
    const step = (): void => {
      const next = this.thawing.shift();
      if (next !== undefined) thaw(next);
      this.frame = this.thawing.length > 0 ? requestAnimationFrame(step) : null;
    };
    if (this.frame === null) step();
  }
}
