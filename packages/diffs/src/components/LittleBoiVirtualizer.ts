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
  private intersectionObserver: IntersectionObserver;
  private scrollY: number = 0;
  private height: number = 0;
  private scrollHeight: number = 0;
  public windowSpecs: VirtualWindowSpecs;

  constructor(private root: Element | Document) {
    if (root === globalThis.document) {
      this.setupWindow();
    } else {
      this.setupElement();
    }
    this.windowSpecs = createWindowFromScrollPosition({
      scrollY: this.scrollY,
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
    this.scrollY = window.scrollY;
    this.height = window.innerHeight;
    this.scrollHeight = globalThis.document.documentElement.scrollHeight;
    window.addEventListener('scroll', this.handleWindowScroll);
    window.addEventListener('resize', this.handleWindowResize);
  }

  private setupElement() {
    if (this.root === globalThis.document) {
      throw new Error(
        'LittleBoiVirtualizer.setupElement: Invalid setup method'
      );
    }
    // FIXME(amadeus): Implement the scrolling/resize
    // observers for the container
    // this.root.addEventListener('scroll', this.handleScroll);
    // TODO(amadeus): Add resize observer probably?
  }

  cleanUp(): void {
    this.intersectionObserver.disconnect();
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
    const { scrollY } = window;
    if (scrollY === this.scrollY) {
      return;
    }
    this.scrollY = scrollY;
    queueRender(this.computeRenderRangeAndEmit);
  };

  private computeRenderRangeAndEmit = () => {
    const windowSpecs = createWindowFromScrollPosition({
      scrollY: this.scrollY,
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
    this.intersectionObserver.unobserve(target);
  }

  observers: Map<SubscribedInstance, HTMLElement> = new Map();

  connect(instance: SubscribedInstance, container: HTMLElement): () => void {
    if (this.observers.has(instance)) {
      throw new Error(
        'LittleBoiVirtualizer.connect: instance is already connected...'
      );
    }
    this.intersectionObserver.observe(container);
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
    this.intersectionObserver.unobserve(element);
    this.observers.delete(instance);
  }
}
