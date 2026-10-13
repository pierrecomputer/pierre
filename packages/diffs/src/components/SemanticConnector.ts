/**
 * Plain-DOM port of the sema playground's canvas connector bands to SVG.
 * See SEMANTIC_DIFF_RENDERER.md for where the numbers come from.
 */

import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import { prefersReducedMotion } from '../utils/prefersReducedMotion';

export type ConnectorKind =
  | 'added'
  | 'deleted'
  | 'moved'
  | 'modified'
  | 'reformatted';

/** Vertical extent in pixels relative to the top of the SVG layer. Equal top/bottom makes a wedge. */
export interface SideBounds {
  top: number;
  bottom: number;
}

export interface Connector {
  /** Stable and unique within this layer across layout updates. */
  id: string;
  base: SideBounds;
  target: SideBounds;
  kind: ConnectorKind;
  /** The host sorts by this rank. Higher paints later and ends up on top. */
  rank: number;
}

interface SemanticConnectorOptions {
  /** Draw connectors on the first render; additions join an active entrance. Defaults to false. */
  animateIn?: boolean;
  /** Entrance duration per connector in milliseconds. */
  drawDuration?: number;
  /** Milliseconds between connector starts, ordered from top to bottom. */
  stagger?: number;
}

interface SemanticConnectorBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SemanticConnectorRenderProps {
  /** Supplies the SVG's positioning context and layout space. */
  container: HTMLElement;
  /** Pixel bounds within the container; connector regions are local to this origin. */
  bounds: SemanticConnectorBounds;
  /** The complete connector set in paint order, with stable, unique IDs. */
  connectors: readonly Connector[];
  /**
   * Hunk separator rows, drawn as full-width bars above the connectors so a
   * separator reads as one bar across the split columns.
   */
  separators: readonly SideBounds[];
}

interface ConnectorEntry {
  path: SVGPathElement;
  connector: Connector;
  lastPath?: string;
}

interface ConnectorAnimation {
  startTime: number;
  // True draws from the target/right side; false draws from
  // the base/left side. Choose the higher side when queued
  // and keep it fixed through layout updates.
  fromTarget: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class SemanticConnector {
  private readonly options: Required<SemanticConnectorOptions>;
  private svg: SVGSVGElement | undefined;
  // Holds one rect per separator row; stays the SVG's last child so it paints
  // above every connector path.
  private separatorLayer: SVGGElement | undefined;
  private separatorSnapshot: readonly SideBounds[] = [];
  private bounds: SemanticConnectorBounds | undefined;
  private connectorSnapshot: readonly Connector[] = [];
  // Latest render data waiting to be applied: on the next frame during
  // animation, or immediately when idle. Another render replaces it so only
  // the newest data reaches the DOM.
  private pendingRender: SemanticConnectorRenderProps | undefined;
  private entries = new Map<string, ConnectorEntry>();
  private animations = new Map<ConnectorEntry, ConnectorAnimation>();
  private nextAnimationStart = 0;
  private frameQueued = false;
  private disposed = false;

  constructor({
    animateIn = false,
    drawDuration = 450,
    stagger = 50,
  }: SemanticConnectorOptions = {}) {
    this.options = {
      animateIn: animateIn && !prefersReducedMotion(),
      drawDuration,
      stagger,
    };
  }

  /** Available after the first DOM commit, for measuring regions relative to the SVG. */
  public get element(): SVGSVGElement | undefined {
    return this.svg;
  }

  public render({
    container,
    bounds,
    connectors,
    separators,
  }: SemanticConnectorRenderProps): void {
    if (this.disposed) {
      throw new Error('SemanticConnector.render: instance has been cleaned up');
    }

    const previous = this.pendingRender?.connectors ?? this.connectorSnapshot;
    this.pendingRender = {
      container,
      bounds,
      connectors: this.connectorsChanged(connectors, previous)
        ? connectors
        : previous,
      separators,
    };

    if (this.frameQueued) return;

    if (this.svg == null && this.options.animateIn && connectors.length > 0) {
      this.frameQueued = true;
      queueRender(this.onAnimationFrame);
    } else {
      this.commit();
    }
  }

  /** A frame timestamp enables entrance; idle commits show complete geometry. */
  private commit(now?: number): void {
    const { pendingRender: pending } = this;
    this.pendingRender = undefined;
    let redrawAll = false;

    if (pending != null) {
      const { container, bounds, connectors, separators } = pending;
      const svg = this.getOrCreateSVG(container);
      this.drawSeparators(separators);
      const boundsChanged = !areBoundsEqual(this.bounds, bounds);
      const connectorsChanged = this.connectorsChanged(connectors);

      if (boundsChanged) {
        this.applyBounds(svg, bounds);
      }
      if (connectorsChanged) {
        this.connectorSnapshot = connectors;
        const added = this.reconcilePaths(svg, connectors);
        if (now != null) {
          this.queueEntrance(added, now);
        }
      }
      redrawAll = boundsChanged || connectorsChanged;
    }

    if (this.bounds == null) {
      return;
    }
    const entries = redrawAll ? this.entries.values() : this.animations.keys();
    for (const entry of entries) {
      this.drawEntry(entry, this.bounds.width, now);
    }
  }

  /** Ends this instance. Create a new instance when remounting. */
  public cleanUp(): void {
    this.cancelAnimation();
    this.animations.clear();
    this.svg?.remove();
    this.svg = undefined;
    this.separatorLayer = undefined;
    this.separatorSnapshot = [];
    this.entries.clear();
    this.connectorSnapshot = [];
    this.pendingRender = undefined;
    this.bounds = undefined;
    this.disposed = true;
  }

  private getOrCreateSVG(container: HTMLElement): SVGSVGElement {
    if (this.svg == null) {
      this.svg = document.createElementNS(SVG_NS, 'svg');
      this.svg.setAttribute('aria-hidden', 'true');
      this.svg.setAttribute('data-connector-column', '');
      this.svg.style.position = 'absolute';
      this.separatorLayer = document.createElementNS(SVG_NS, 'g');
      this.separatorLayer.setAttribute('data-connector-separators', '');
      this.svg.appendChild(this.separatorLayer);
    }
    if (this.svg.parentNode !== container) {
      container.appendChild(this.svg);
    }
    return this.svg;
  }

  private applyBounds(
    svg: SVGSVGElement,
    bounds: SemanticConnectorBounds
  ): void {
    const { bounds: previous } = this;
    if (previous?.left !== bounds.left) {
      svg.style.left = `${bounds.left}px`;
    }
    if (previous?.top !== bounds.top) {
      svg.style.top = `${bounds.top}px`;
    }
    if (previous?.width !== bounds.width) {
      svg.setAttribute('width', String(bounds.width));
    }
    if (previous?.height !== bounds.height) {
      svg.setAttribute('height', String(bounds.height));
    }
    if (
      previous?.width !== bounds.width ||
      previous?.height !== bounds.height
    ) {
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    }
    this.bounds = bounds;
  }

  // Match one full-width rect to each separator row, reusing rects by index.
  private drawSeparators(separators: readonly SideBounds[]): void {
    const { separatorLayer: layer, separatorSnapshot: previous } = this;
    if (layer == null) {
      throw new Error(
        'SemanticConnector.drawSeparators: the separator layer must exist'
      );
    }
    for (const [index, { top, bottom }] of separators.entries()) {
      const drawn = previous[index];
      if (drawn?.top === top && drawn.bottom === bottom) continue;
      let rect = layer.children[index];
      if (rect == null) {
        rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('data-connector-separator', '');
        rect.setAttribute('x', '0');
        rect.setAttribute('width', '100%');
        layer.appendChild(rect);
      }
      rect.setAttribute('y', String(top));
      rect.setAttribute('height', String(bottom - top));
    }
    while (layer.children.length > separators.length) {
      layer.lastElementChild?.remove();
    }
    this.separatorSnapshot = separators;
  }

  private connectorsChanged(
    connectors: readonly Connector[],
    previous: readonly Connector[] = this.connectorSnapshot
  ): boolean {
    if (connectors === previous) return false;
    if (connectors.length !== previous.length) return true;
    for (let index = 0; index < connectors.length; index++) {
      if (!areConnectorsEqual(previous[index], connectors[index])) return true;
    }
    return false;
  }

  /**
   * Match SVG paths to the new connector list: reuse paths with the same ID, create missing
   * ones, and remove ones no longer needed. Keep paths in the supplied paint order and
   * return the newly created entries so they can join the entrance animation.
   */
  private reconcilePaths(
    svg: SVGSVGElement,
    connectors: readonly Connector[]
  ): ConnectorEntry[] {
    const added: ConnectorEntry[] = [];
    const nextEntries = new Map<string, ConnectorEntry>();
    let nextNode = svg.firstChild;
    for (const connector of connectors) {
      let entry = this.entries.get(connector.id);
      if (entry == null) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('data-connector-id', connector.id);
        path.setAttribute('data-connector-kind', connector.kind);
        entry = { path, connector };
        added.push(entry);
      } else if (!areConnectorsEqual(entry.connector, connector)) {
        if (entry.connector.kind !== connector.kind) {
          entry.path.setAttribute('data-connector-kind', connector.kind);
        }
        entry.connector = connector;
      }
      nextEntries.set(connector.id, entry);

      if (entry.path === nextNode) {
        nextNode = nextNode.nextSibling;
      } else {
        svg.insertBefore(entry.path, nextNode);
      }
    }
    for (const [id, entry] of this.entries) {
      if (!nextEntries.has(id)) {
        entry.path.remove();
        this.animations.delete(entry);
      }
    }
    this.entries = nextEntries;
    return added;
  }

  private drawEntry(entry: ConnectorEntry, width: number, now?: number): void {
    const { connector } = entry;
    const animation = this.animations.get(entry);
    const fromTarget =
      animation?.fromTarget ?? connector.target.top < connector.base.top;
    let progress = 1;
    if (animation != null && now != null) {
      const elapsed = now - animation.startTime;
      if (elapsed < 0) {
        progress = 0;
      } else if (this.options.drawDuration > 0) {
        progress = Math.min(elapsed / this.options.drawDuration, 1);
      }
      if (progress === 1) {
        this.animations.delete(entry);
      }
    }
    const d = connectorPath(
      fromTarget ? connector.target : connector.base,
      fromTarget ? connector.base : connector.target,
      fromTarget ? width : 0,
      fromTarget ? 0 : width,
      1 - (1 - progress) ** 3
    );
    if (entry.lastPath === d) {
      return;
    }
    entry.path.setAttribute('d', d);
    entry.lastPath = d;
  }

  /**
   * Start new paths from top to bottom, keeping paint order for ties. Existing
   * animations keep their start times and direction through layout changes.
   */
  private queueEntrance(entries: ConnectorEntry[], now: number): void {
    if (entries.length === 0) return;
    entries.sort(
      ({ connector: a }, { connector: b }) =>
        Math.min(a.base.top, a.target.top) - Math.min(b.base.top, b.target.top)
    );
    for (const entry of entries) {
      const startTime = Math.max(now, this.nextAnimationStart);
      const { base, target } = entry.connector;
      this.animations.set(entry, {
        startTime,
        fromTarget: target.top < base.top,
      });
      this.nextAnimationStart = startTime + this.options.stagger;
    }
  }

  private onAnimationFrame = (now: number): void => {
    this.frameQueued = false;
    // Another callback may have cleaned up this instance earlier in this frame.
    if (this.disposed) return;
    this.commit(now);
    if (this.animations.size > 0) {
      this.frameQueued = true;
      queueRender(this.onAnimationFrame);
    }
  };

  private cancelAnimation(): void {
    if (!this.frameQueued) return;
    dequeueRender(this.onAnimationFrame);
    this.frameQueued = false;
  }
}

function areBoundsEqual(
  a: SemanticConnectorBounds | undefined,
  b: SemanticConnectorBounds | undefined
): boolean {
  if (a == null || b == null) {
    return a === b;
  }
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

function areConnectorsEqual(a: Connector, b: Connector): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.rank === b.rank &&
    a.base.top === b.base.top &&
    a.base.bottom === b.base.bottom &&
    a.target.top === b.target.top &&
    a.target.bottom === b.target.bottom
  );
}

/**
 * Closed S-band from the base cell's right edge (x0) to the target cell's left
 * edge (x1). Both control points sit at the horizontal midpoint, which gives
 * horizontal tangents where the band meets each cell.
 * Progress draws a prefix of both curves without stretching the finished shape.
 */
function connectorPath(
  base: SideBounds,
  target: SideBounds,
  x0: number,
  x1: number,
  progress = 1
): string {
  const midX = (x0 + x1) / 2;
  const baseTop = base.top;
  const baseBottom = base.bottom;
  const targetTop = target.top;
  const targetBottom = target.bottom;

  // Split both cubic curves at progress using de Casteljau's construction.
  const controlX1 = x0 + (midX - x0) * progress;
  const controlX2 = controlX1 + (midX - controlX1) * progress;
  const otherControlX = midX + (x1 - midX) * progress * progress;
  const endX = controlX2 + (otherControlX - controlX2) * progress;
  const controlProgress = progress * progress;
  const endProgress = controlProgress * (3 - 2 * progress);
  const controlTop = baseTop + (targetTop - baseTop) * controlProgress;
  const controlBottom =
    baseBottom + (targetBottom - baseBottom) * controlProgress;
  const endTop = baseTop + (targetTop - baseTop) * endProgress;
  const endBottom = baseBottom + (targetBottom - baseBottom) * endProgress;

  return [
    `M ${x0} ${baseTop}`,
    `C ${controlX1} ${baseTop}, ${controlX2} ${controlTop}, ${endX} ${endTop}`,
    `L ${endX} ${endBottom}`,
    `C ${controlX2} ${controlBottom}, ${controlX1} ${baseBottom}, ${x0} ${baseBottom}`,
    'Z',
  ].join(' ');
}
