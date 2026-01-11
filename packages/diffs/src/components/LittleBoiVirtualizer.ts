import { queueRender } from 'src/managers/UniversalRenderingManager';
import { areVirtualWindowSpecsEqual } from 'src/utils/areVirtualWindowSpecsEqual';

import type { VirtualWindowSpecs } from '../types';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';

interface SubscribedInstance {
  onScrollUpdate(windowSpecs: VirtualWindowSpecs): void;
  onResize(windowSpecs: VirtualWindowSpecs): void;
}

let lastScrollPosition = 0;

declare global {
  interface Window {
    STOP?: boolean;
    TOGGLE?: () => void;
  }
}

export class LittleBoiVirtualizer {
  private intersectionObserver: IntersectionObserver | undefined;
  private scrollTop: number = 0;
  private height: number = 0;
  private scrollHeight: number = 0;
  public windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };
  private root: HTMLElement | Document | undefined;

  setup(root: HTMLElement | Document): void {
    this.root = root;
    if (root === globalThis.document) {
      this.setupWindow();
    } else {
      this.setupElement();
    }
    this.windowSpecs = createWindowFromScrollPosition({
      scrollY: this.scrollTop,
      height: this.height,
      scrollHeight: this.scrollHeight,
      containerOffset: 0,
      // FIXME(amadeus): Implement this
      fitPerfectly: false,
      // FIXME(amadeus): Make this configurable probably?
      overscrollMultiplier: 1.2,
    });
    // NOTE(amadeus): Figure how to use this mufugga
    this.intersectionObserver = new IntersectionObserver(
      this.handleIntersectionChange,
      {
        root: this.root,
        // FIXME(amadeus): Figure out the other settings we'll want in here, or
        // if we should make them configurable...
      }
    );

    window.TOGGLE = () => {
      if (window.STOP === true) {
        window.STOP = false;
        window.scrollTo({ top: lastScrollPosition });
        queueRender(this.computeRenderRangeAndEmit);
      } else {
        lastScrollPosition = window.scrollY;
        window.STOP = true;
      }
    };
  }

  private setupWindow() {
    this.scrollTop = window.scrollY;
    this.height = window.innerHeight;
    this.scrollHeight = globalThis.document.documentElement.scrollHeight;
    window.addEventListener('scroll', this.handleWindowScroll, {
      passive: true,
    });
    window.addEventListener('resize', this.handleWindowResize, {
      passive: true,
    });
  }

  private setupElement() {
    if (this.root == null || this.root instanceof Document) {
      throw new Error(
        'LittleBoiVirtualizer.setupElement: Invalid setup method'
      );
    }
    this.scrollTop = this.root.scrollTop;
    this.height = this.root.clientHeight;
    this.scrollHeight = this.root.scrollHeight;
    this.root.addEventListener('scroll', this.handleElementScroll, {
      passive: true,
    });
    // FIXME(amadeus): Implement the resize observer stuff probably?
  }

  cleanUp(): void {
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.root = undefined;
  }

  getOffsetFromRoot(element: Element | null): number {
    let top = 0;
    while (element instanceof HTMLElement && element !== this.root) {
      top += element.offsetTop;
      element = element.offsetParent;
    }
    return top;
  }

  private handleWindowResize = () => {
    if (window.STOP === true) return;
    const { innerHeight } = window;
    if (innerHeight === this.height) {
      return;
    }
    this.height = window.innerHeight;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private handleWindowScroll = () => {
    if (window.STOP === true) return;
    const { scrollY: scrollTop } = window;
    if (scrollTop === this.scrollTop) {
      return;
    }
    this.scrollTop = scrollTop;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private handleElementScroll = () => {
    if (
      window.STOP === true ||
      this.root == null ||
      this.root instanceof Document
    ) {
      return;
    }
    // FIXME(amadeus): We should not be grabbing scroll height here... lol this
    // might cause thrash too
    const { scrollTop, scrollHeight } = this.root;
    if (scrollTop === this.scrollTop && scrollHeight === this.scrollHeight) {
      return;
    }
    this.scrollTop = scrollTop;
    this.scrollHeight = scrollHeight;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private computeRenderRangeAndEmit = () => {
    const windowSpecs = createWindowFromScrollPosition({
      scrollY: this.scrollTop,
      height: this.height,
      scrollHeight: this.scrollHeight,
      containerOffset: 0,
      // FIXME(amadeus): Implement this
      fitPerfectly: false,
      // FIXME(amadeus): Make this configurable probably?
      overscrollMultiplier: 1.2,
    });
    if (areVirtualWindowSpecsEqual(this.windowSpecs, windowSpecs)) {
      return;
    }
    this.windowSpecs = windowSpecs;
    for (const instace of this.observers.keys()) {
      instace.onScrollUpdate(this.windowSpecs);
    }
  };

  private handleIntersectionChange = (
    _entries: IntersectionObserverEntry[]
  ): void => {
    // FIXME(amadeus): Not quite sure how I will be able to use this yet, but I
    // think it might be able to help in situations where an element has
    // positionally moved somehow, and then it comes into view via scrolling,
    // forcing us to query it's scroll position
    // console.log('ZZZZ - entries', entries);
  };

  unobserver(target: HTMLElement): void {
    this.intersectionObserver?.unobserve(target);
  }

  observers: Map<SubscribedInstance, HTMLElement> = new Map();

  connect(instance: SubscribedInstance, container: HTMLElement): () => void {
    if (this.observers.has(instance)) {
      throw new Error(
        'LittleBoiVirtualizer.connect: instance is already connected...'
      );
    }
    this.intersectionObserver?.observe(container);
    this.observers.set(instance, container);
    return () => this.disconnect(instance);
  }

  disconnect(instance: SubscribedInstance): void {
    const element = this.observers.get(instance);
    if (element == null) {
      throw new Error(
        'LittleBoiVirtualizer.disconnect: instance already disconnected...'
      );
    }
    this.intersectionObserver?.unobserve(element);
    this.observers.delete(instance);
  }
}
