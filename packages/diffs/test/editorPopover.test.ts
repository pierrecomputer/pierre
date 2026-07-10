import { describe, expect, test } from 'bun:test';

import {
  POPOVER_FLIP_HYSTERESIS_PX,
  PopoverManager,
  type PopoverPlacementBounds,
} from '../src/editor/popover';
import { installDom } from './domHarness';

function makeManager(): PopoverManager {
  return new PopoverManager({
    hasActivePopover: () => false,
    updateActivePopover: () => {},
  });
}

// jsdom performs no layout, so declare the screen-space rect getPlacementBounds
// reads off the code and scroll-container elements. Only top/bottom matter.
function stubRect(element: HTMLElement, top: number, bottom: number): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        top,
        bottom,
        left: 0,
        right: 0,
        width: 0,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect,
  });
}

const VIEWPORT: PopoverPlacementBounds = { top: 0, bottom: 100 };

describe('PopoverManager.choosePlacement', () => {
  test('uses the document-edge signal when no viewport geometry is available', () => {
    const manager = makeManager();
    const bounds: PopoverPlacementBounds = { top: 10, bottom: 30 };
    // With no viewport, an anchor at a document edge flips; otherwise it stays.
    expect(
      manager.choosePlacement({
        preferred: bounds,
        fallback: bounds,
        viewport: undefined,
        popoverHeight: 20,
        atDocumentEdge: true,
      })
    ).toBe('fallback');
    expect(
      manager.choosePlacement({
        preferred: bounds,
        fallback: bounds,
        viewport: undefined,
        popoverHeight: 20,
        atDocumentEdge: false,
      })
    ).toBe('preferred');
    // A popover that has not laid out yet (height 0) is treated the same way.
    expect(
      manager.choosePlacement({
        preferred: bounds,
        fallback: bounds,
        viewport: VIEWPORT,
        popoverHeight: 0,
        atDocumentEdge: true,
      })
    ).toBe('fallback');
  });

  test('flips to the fallback side only when the preferred side is clipped and the fallback fits', () => {
    // Preferred fits inside the viewport: keep it.
    expect(
      makeManager().choosePlacement({
        preferred: { top: 10, bottom: 30 },
        fallback: { top: 40, bottom: 60 },
        viewport: VIEWPORT,
        popoverHeight: 20,
        atDocumentEdge: false,
      })
    ).toBe('preferred');
    // Preferred overflows the top and the fallback fits: flip.
    expect(
      makeManager().choosePlacement({
        preferred: { top: -10, bottom: 30 },
        fallback: { top: 40, bottom: 60 },
        viewport: VIEWPORT,
        popoverHeight: 20,
        atDocumentEdge: false,
      })
    ).toBe('fallback');
    // Neither side fits: fall back to the preferred side rather than the clipped
    // fallback.
    expect(
      makeManager().choosePlacement({
        preferred: { top: -10, bottom: 30 },
        fallback: { top: -5, bottom: 200 },
        viewport: VIEWPORT,
        popoverHeight: 20,
        atDocumentEdge: false,
      })
    ).toBe('preferred');
  });

  test('keeps a flipped popover on the fallback side until the preferred side clears the hysteresis margin', () => {
    const manager = makeManager();
    const fallback: PopoverPlacementBounds = { top: 50, bottom: 70 };
    manager.setPlacement('fallback');

    // Preferred fits, but only within the hysteresis margin, so the popover
    // stays flipped to avoid flickering back and forth at the boundary.
    expect(
      manager.choosePlacement({
        preferred: { top: POPOVER_FLIP_HYSTERESIS_PX - 2, bottom: 98 },
        fallback,
        viewport: VIEWPORT,
        popoverHeight: 20,
        atDocumentEdge: false,
      })
    ).toBe('fallback');

    // Once preferred clears the margin on both edges, it flips back.
    expect(
      manager.choosePlacement({
        preferred: { top: 10, bottom: 90 },
        fallback,
        viewport: VIEWPORT,
        popoverHeight: 20,
        atDocumentEdge: false,
      })
    ).toBe('preferred');
  });
});

describe('PopoverManager.getPlacementBounds', () => {
  test('expresses the scroll container viewport in code-relative coordinates', () => {
    const dom = installDom();
    const manager = makeManager();
    try {
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      const fileContainer = document.createElement('div');
      const codeElement = document.createElement('div');
      scroller.appendChild(fileContainer);
      document.body.appendChild(scroller);
      stubRect(scroller, 20, 120);
      stubRect(codeElement, 50, 90);

      manager.setViewportElements(fileContainer, codeElement);
      // Subtract the code element's top so the bounds are relative to it.
      expect(manager.getPlacementBounds()).toEqual({ top: -30, bottom: 70 });
    } finally {
      manager.cleanUp();
      dom.cleanup();
    }
  });

  test('falls back to the window when there is no scrollable ancestor', () => {
    const dom = installDom();
    const manager = makeManager();
    try {
      const fileContainer = document.createElement('div');
      const codeElement = document.createElement('div');
      document.body.appendChild(fileContainer);
      stubRect(codeElement, 50, 90);

      manager.setViewportElements(fileContainer, codeElement);
      expect(manager.getPlacementBounds()).toEqual({
        top: -50,
        bottom: window.innerHeight - 50,
      });
    } finally {
      manager.cleanUp();
      dom.cleanup();
    }
  });

  test('returns undefined without a code element or when the viewport is empty', () => {
    const dom = installDom();
    const manager = makeManager();
    try {
      // No viewport elements set yet.
      expect(manager.getPlacementBounds()).toBeUndefined();

      const scroller = document.createElement('div');
      scroller.style.overflowY = 'scroll';
      const fileContainer = document.createElement('div');
      const codeElement = document.createElement('div');
      scroller.appendChild(fileContainer);
      document.body.appendChild(scroller);
      // An inverted scroll rect (bottom above top) has no usable height.
      stubRect(scroller, 100, 50);
      stubRect(codeElement, 10, 40);

      manager.setViewportElements(fileContainer, codeElement);
      expect(manager.getPlacementBounds()).toBeUndefined();
    } finally {
      manager.cleanUp();
      dom.cleanup();
    }
  });
});
