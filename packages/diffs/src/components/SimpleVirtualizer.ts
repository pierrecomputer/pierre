import { queueRender } from '../managers/UniversalRenderingManager';
import type { VirtualWindowSpecs } from '../types';
import { areVirtualWindowSpecsEqual } from '../utils/areVirtualWindowSpecsEqual';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';

interface SubscribedInstance {
  onScrollUpdate(windowSpecs: VirtualWindowSpecs): void;
  onResize(windowSpecs: VirtualWindowSpecs): void;
  reconcileHeights(): void;
}

interface ScrollAnchor {
  fileElement: HTMLElement;
  fileTypeOffset: 'top' | 'bottom';
  fileOffset: number;
  lineIndex: string | undefined;
  lineOffset: number | undefined;
}

let lastScrollPosition = 0;

// FIXME(amadeus): Make this configurable probably?
const OVERSCROLL_SIZE = 500;
const RESIZE_DEBUGGING = false;
const RESIZE_OBSERVER_MARGIN = OVERSCROLL_SIZE * 4;
let lastSize = 0;

export class SimpleVirtualizer {
  private intersectionObserver: IntersectionObserver | undefined;
  private scrollTop: number = 0;
  private height: number = 0;
  private scrollHeight: number = 0;
  public windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };
  private root: HTMLElement | Document | undefined;

  private resizeObserver: ResizeObserver | undefined;
  private observers: Map<HTMLElement, SubscribedInstance> = new Map();
  private visibleInstances: Map<HTMLElement, SubscribedInstance> = new Map();
  private visibleInstancesDirty: boolean = false;
  private instancesChanged: Set<SubscribedInstance> = new Set();

  private scrollDirty = true;
  private heightDirty = true;
  private scrollHeightDirty = true;
  private renderedObservers = 0;
  private connectQueue: Map<HTMLElement, SubscribedInstance> = new Map();

  setup(root: HTMLElement | Document, contentContainer?: Element): void {
    this.root = root;
    this.resizeObserver = new ResizeObserver(this.handleContainerResize);
    this.intersectionObserver = new IntersectionObserver(
      this.handleIntersectionChange,
      {
        root: this.root,
        threshold: [0, 0.000001, 0.99999, 1],
        rootMargin: `${RESIZE_OBSERVER_MARGIN}px 0px ${RESIZE_OBSERVER_MARGIN}px 0px`,
        // FIXME(amadeus): Figure out the other settings we'll want in here, or
        // if we should make them configurable...
      }
    );
    if (root instanceof Document) {
      this.setupWindow();
    } else {
      this.setupElement(contentContainer);
    }

    // FIXME(amadeus): Remove me before release
    window.__INSTANCE = this;
    window.__TOGGLE = () => {
      if (window.__STOP === true) {
        window.__STOP = false;
        window.scrollTo({ top: lastScrollPosition });
        queueRender(this.computeRenderRangeAndEmit);
      } else {
        lastScrollPosition = window.scrollY;
        window.__STOP = true;
      }
    };
    for (const [container, instance] of this.connectQueue.entries()) {
      this.connect(container, instance);
    }
    this.connectQueue.clear();
    this.markDOMDirty();
    queueRender(this.computeRenderRangeAndEmit);
  }

  instanceChanged(instance: SubscribedInstance): void {
    this.instancesChanged.add(instance);
    queueRender(this.computeRenderRangeAndEmit);
  }

  private handleContainerResize = (entries: ResizeObserverEntry[]) => {
    if (RESIZE_DEBUGGING) {
      const currentSize = entries[0].borderBoxSize[0].blockSize;
      console.log('handleContainerResize', {
        change: currentSize - lastSize,
        size: currentSize,
      });
      lastSize = currentSize;
    }
    this.heightDirty = true;
    this.scrollHeightDirty = true;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private setupWindow() {
    if (this.root == null || !(this.root instanceof Document)) {
      throw new Error('SimpleVirtualizer.setupWindow: Invalid setup method');
    }
    window.addEventListener('scroll', this.handleWindowScroll, {
      passive: true,
    });
    window.addEventListener('resize', this.handleWindowResize, {
      passive: true,
    });
    this.resizeObserver?.observe(this.root.documentElement);
  }

  private setupElement(contentContainer: Element | undefined) {
    if (this.root == null || this.root instanceof Document) {
      throw new Error('SimpleVirtualizer.setupElement: Invalid setup method');
    }
    this.root.addEventListener('scroll', this.handleElementScroll, {
      passive: true,
    });
    contentContainer ??= this.root.firstElementChild ?? undefined;
    if (contentContainer != null) {
      this.resizeObserver?.observe(contentContainer);
    }
  }

  cleanUp(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.root = undefined;
  }

  getOffsetInScrollContainer(element: HTMLElement | null): number {
    return element != null
      ? this.getScrollTop() +
          getRelativeBoundingTop(element, this.getScrollContainerElement())
      : 0;
  }

  connect(container: HTMLElement, instance: SubscribedInstance): () => void {
    if (this.observers.has(container)) {
      throw new Error(
        'SimpleVirtualizer.connect: instance is already connected...'
      );
    }
    // If we are racing against the intersectionObserver, then we should just
    // queue up the connection for when the observer does get set up
    if (this.intersectionObserver == null) {
      this.connectQueue.set(container, instance);
    } else {
      this.intersectionObserver.observe(container);
      this.observers.set(container, instance);
      this.markDOMDirty();
      queueRender(this.computeRenderRangeAndEmit);
    }
    return () => this.disconnect(container);
  }

  disconnect(container: HTMLElement): void {
    const instance = this.observers.get(container);
    this.connectQueue.delete(container);
    if (instance == null) {
      return;
    }
    this.intersectionObserver?.unobserve(container);
    this.observers.delete(container);
    this.markDOMDirty();
    queueRender(this.computeRenderRangeAndEmit);
  }

  private handleWindowResize = () => {
    if (window.__STOP === true) return;
    this.markDOMDirty();
    queueRender(this.computeRenderRangeAndEmit);
  };

  private handleWindowScroll = () => {
    if (window.__STOP === true) return;
    this.scrollDirty = true;

    // FIXME(amadeus): Laziness assumption here... bad for business probably
    // basically we should be relying on resize observers for stuff like this
    // probably...
    this.heightDirty = true;
    this.scrollHeightDirty = true;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private handleElementScroll = () => {
    if (
      window.__STOP === true ||
      this.root == null ||
      this.root instanceof Document
    ) {
      return;
    }
    this.scrollDirty = true;

    // FIXME(amadeus): Laziness assumption here... bad for business probably
    // basically we should be relying on resize observers for stuff like this
    // probably...
    this.heightDirty = true;
    this.scrollHeightDirty = true;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private computeRenderRangeAndEmit = () => {
    if (window.__STOP === true) {
      return;
    }
    if (
      !this.scrollDirty &&
      !this.scrollHeightDirty &&
      !this.heightDirty &&
      this.renderedObservers === this.observers.size &&
      !this.visibleInstancesDirty &&
      this.instancesChanged.size === 0
    ) {
      // NOTE(amadeus): Is this a safe assumption/optimization?
      return;
    }

    let fitPerfectly = false;
    // If we got an emitted update from a bunch of instances, we should
    // attempt to re-render with the existing windowing logic first, and then
    // queue up a corrected render after
    if (this.instancesChanged.size === 0) {
      const { scrollTop: oldScrollTop } = this;
      const scrollTop = this.getScrollTop();
      const height = this.getHeight();
      fitPerfectly = Math.abs(scrollTop - oldScrollTop) > height;
      const windowSpecs = createWindowFromScrollPosition({
        scrollTop,
        height,
        scrollHeight: this.getScrollHeight(),
        fitPerfectly,
        overscrollSize: OVERSCROLL_SIZE,
      });
      if (
        areVirtualWindowSpecsEqual(this.windowSpecs, windowSpecs) &&
        this.renderedObservers === this.observers.size &&
        !this.visibleInstancesDirty &&
        this.instancesChanged.size === 0
      ) {
        return;
      }
      this.windowSpecs = windowSpecs;
    }
    this.visibleInstancesDirty = false;
    this.renderedObservers = this.observers.size;
    const anchor = this.getScrollAnchor(this.height);
    const updatedInstances = new Set<SubscribedInstance>();
    for (const instance of this.visibleInstances.values()) {
      instance.onScrollUpdate(this.windowSpecs);
      updatedInstances.add(instance);
    }
    for (const instance of this.instancesChanged) {
      if (updatedInstances.has(instance)) continue;
      instance.onScrollUpdate(this.windowSpecs);
    }
    this.scrollFix(anchor);
    // Scroll fix may have marked the dom as dirty, but if there instance
    // changes, we should definitely mark as dirty
    if (this.instancesChanged.size > 0) {
      this.markDOMDirty();
    }

    // Is this safe? Maybe not, but lets try it for now...
    for (const instance of updatedInstances) {
      instance.reconcileHeights();
    }

    if (fitPerfectly || this.instancesChanged.size > 0) {
      queueRender(this.computeRenderRangeAndEmit);
    }
    updatedInstances.clear();
    this.instancesChanged.clear();
  };

  private scrollFix(anchor: ScrollAnchor | undefined) {
    if (anchor == null) {
      return;
    }
    const scrollContainer = this.getScrollContainerElement();
    const { lineIndex, lineOffset, fileElement, fileOffset, fileTypeOffset } =
      anchor;
    if (lineIndex != null && lineOffset != null) {
      const element = fileElement.shadowRoot?.querySelector(
        `[data-line-index="${lineIndex}"]`
      );
      if (element instanceof HTMLElement) {
        const top = getRelativeBoundingTop(element, scrollContainer);
        if (top !== lineOffset) {
          const scrollOffset = top - lineOffset;
          this.applyScrollFix(scrollOffset);
        }
        return;
      }
    }
    const top = getRelativeBoundingTop(fileElement, scrollContainer);
    if (fileTypeOffset === 'top') {
      if (top !== fileOffset) {
        this.applyScrollFix(top - fileOffset);
      }
    } else {
      const bottom = top + fileElement.getBoundingClientRect().height;
      if (bottom !== fileOffset) {
        this.applyScrollFix(bottom - fileOffset);
      }
    }
  }

  private applyScrollFix(scrollOffset: number) {
    if (this.root == null || this.root instanceof Document) {
      window.scrollTo({
        top: window.scrollY + scrollOffset,
        behavior: 'instant',
      });
    } else {
      this.root.scrollTo({
        top: this.root.scrollTop + scrollOffset,
        behavior: 'instant',
      });
    }
    // Because we fixed our scroll positions, it means something resized or
    // moved around, so we should mark everything as dirty so the
    // reconciliation call will get the latest data when figuring calling
    // .getOffsetInScrollContainer
    this.markDOMDirty();
  }

  // This function tries to figure out the closest file or line to the viewport
  // top that's visible to use as a relative marker for how to fix scroll
  // position after issuing dom updates
  private getScrollAnchor(viewportHeight: number): ScrollAnchor | undefined {
    const scrollContainer = this.getScrollContainerElement();
    let bestAnchor: ScrollAnchor | undefined;

    for (const [fileElement] of this.visibleInstances.entries()) {
      const fileTop = getRelativeBoundingTop(fileElement, scrollContainer);
      const fileBottom = fileTop + fileElement.offsetHeight;

      // Determine file offset and type based on position
      // Only use bottom anchor when entire file is above viewport
      let fileOffset: number;
      let fileTypeOffset: 'top' | 'bottom';
      if (fileBottom <= 0) {
        // Entire file is above viewport - use bottom as anchor
        fileOffset = fileBottom;
        fileTypeOffset = 'bottom';
      } else {
        // File is at least partially visible or below - use top
        fileOffset = fileTop;
        fileTypeOffset = 'top';
      }

      // Find the best line (first fully visible) within this file
      let bestLineIndex: string | undefined;
      let bestLineOffset: number | undefined;

      // Only search for lines if file potentially intersects viewport
      if (fileBottom > 0 && fileTop < viewportHeight) {
        for (const line of fileElement.shadowRoot?.querySelectorAll(
          '[data-line-index]'
        ) ?? []) {
          if (!(line instanceof HTMLElement)) continue;
          const lineIndex = line.dataset.lineIndex;
          if (lineIndex == null) continue;

          const lineOffset = getRelativeBoundingTop(line, scrollContainer);

          // Ignore lines with negative offsets (above viewport top)
          if (lineOffset < 0) continue;

          // First visible line in DOM order is the best one because
          // querySelectorAll will grab lines in order as they appear in the
          // DOM
          bestLineIndex = lineIndex;
          bestLineOffset = lineOffset;
          break;
        }
      }

      // If we already have an anchor with a visible line, skip files without one
      if (bestAnchor?.lineOffset != null && bestLineOffset == null) {
        continue;
      }

      // Decide if this file should become the new best anchor
      let shouldReplace = false;
      // If we don't already have an anchor we should set one
      if (bestAnchor == null) {
        shouldReplace = true;
      }
      // If we found a better line anchor, we should replace the old one
      else if (
        bestLineOffset != null &&
        (bestAnchor.lineOffset == null ||
          bestLineOffset < bestAnchor.lineOffset)
      ) {
        shouldReplace = true;
      }
      // Otherwise we need to compare file only anchors
      else if (bestLineOffset == null && bestAnchor.lineOffset == null) {
        // Favor files with their tops in view
        if (
          fileOffset >= 0 &&
          (bestAnchor.fileOffset < 0 || fileOffset < bestAnchor.fileOffset)
        ) {
          shouldReplace = true;
        }
        // Or the closest file
        else if (
          fileOffset < 0 &&
          bestAnchor.fileOffset < 0 &&
          fileOffset > bestAnchor.fileOffset
        ) {
          shouldReplace = true;
        }
      }

      if (shouldReplace) {
        bestAnchor = {
          fileElement,
          fileTypeOffset,
          fileOffset,
          lineIndex: bestLineIndex,
          lineOffset: bestLineOffset,
        };
      }
    }

    return bestAnchor;
  }

  private handleIntersectionChange = (
    entries: IntersectionObserverEntry[]
  ): void => {
    for (const { target, isIntersecting } of entries) {
      if (!(target instanceof HTMLElement)) {
        throw new Error(
          'SimpleVirtualizer.handleIntersectionChange: target not an HTMLElement'
        );
      }
      const instance = this.observers.get(target);
      if (instance == null) {
        throw new Error(
          'SimpleVirtualizer.handleIntersectionChange: no instance for target'
        );
      }
      if (isIntersecting && !this.visibleInstances.has(target)) {
        this.visibleInstancesDirty = true;
        this.visibleInstances.set(target, instance);
      } else if (!isIntersecting && this.visibleInstances.has(target)) {
        this.visibleInstancesDirty = true;
        this.visibleInstances.delete(target);
      }
    }

    if (this.visibleInstancesDirty) {
      // Since this call is already debounced, should we just call
      // computeRenderRangeAndEmit directly?
      queueRender(this.computeRenderRangeAndEmit);
    }
    // Debug logging for visible instances
    // console.log(
    //   'handleIntersectionChange',
    //   ...Array.from(this.visibleInstances.keys())
    // );
  };

  private getScrollTop() {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    let scrollTop = (() => {
      if (this.root == null) {
        return 0;
      }
      if (this.root instanceof Document) {
        return window.scrollY;
      }
      return this.root.scrollTop;
    })();

    // Lets always make sure to clamp scroll position cases of
    // over/bounce scroll
    scrollTop = Math.max(
      0,
      Math.min(scrollTop, this.getScrollHeight() - this.getHeight())
    );
    this.scrollTop = scrollTop;
    return scrollTop;
  }

  private getScrollHeight() {
    if (!this.scrollHeightDirty) {
      return this.scrollHeight;
    }
    this.scrollHeightDirty = false;
    this.scrollHeight = (() => {
      if (this.root == null) {
        return 0;
      }
      if (this.root instanceof Document) {
        return this.root.documentElement.scrollHeight;
      }
      return this.root.scrollHeight;
    })();
    return this.scrollHeight;
  }

  private getHeight() {
    if (!this.heightDirty) {
      return this.height;
    }
    this.heightDirty = false;
    this.height = (() => {
      if (this.root == null) {
        return 0;
      }
      if (this.root instanceof Document) {
        return globalThis.innerHeight;
      }
      return this.root.getBoundingClientRect().height;
    })();
    return this.height;
  }

  private markDOMDirty() {
    this.scrollDirty = true;
    this.scrollHeightDirty = true;
    this.heightDirty = true;
  }

  private getScrollContainerElement(): HTMLElement | undefined {
    return this.root == null || this.root instanceof Document
      ? undefined
      : this.root;
  }
}

// This function is like a generalized getBoundingClientRect for it's relative
// scroll container
function getRelativeBoundingTop(
  element: HTMLElement,
  scrollContainer: HTMLElement | undefined
) {
  const rect = element.getBoundingClientRect();
  const scrollContainerTop = scrollContainer?.getBoundingClientRect().top ?? 0;
  return rect.top - scrollContainerTop;
}
