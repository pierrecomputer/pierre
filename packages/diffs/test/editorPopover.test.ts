import { describe, expect, test } from 'bun:test';

import {
  POPOVER_FLIP_HYSTERESIS_PX,
  PopoverManager,
  type PopoverPlacementBounds,
  type PopoverViewportBounds,
  setPopoverPositionStyles,
} from '../src/editor/popover';
import { installDom } from './domHarness';

function makeManager(): PopoverManager {
  return new PopoverManager({
    hasActivePopover: () => false,
    updateActivePopover: () => {},
  });
}

// jsdom performs no layout, so declare the screen-space rect getPlacementBounds
// reads off the code and scroll-container elements.
function stubRect(
  element: HTMLElement,
  top: number,
  bottom: number,
  left = 0,
  right = 0
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        top,
        bottom,
        left,
        right,
        width: right - left,
        height: bottom - top,
        x: left,
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
      stubRect(scroller, 20, 120, 20, 120);
      // The code box spans past the scroller (top 10 -> 200), so the scroller is
      // the binding clip and only its top/bottom drive the vertical bounds.
      stubRect(codeElement, 10, 200, 50, 150);

      manager.setViewportElements(fileContainer, codeElement);
      // Subtract the code element's top so the bounds are relative to it.
      expect(manager.getPlacementBounds()).toEqual({
        top: 10,
        bottom: 110,
        left: 0,
        right: 70,
      });
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
      // The code box spans past the window (0 -> 1000), so the window is the
      // binding clip and its full height drives the vertical bounds.
      stubRect(codeElement, 0, 1000, 50, 150);

      manager.setViewportElements(fileContainer, codeElement);
      expect(manager.getPlacementBounds()).toEqual({
        top: 0,
        bottom: window.innerHeight,
        left: 0,
        right: 100,
      });
    } finally {
      manager.cleanUp();
      dom.cleanup();
    }
  });

  test('clips the bounds to the code box when the file is shorter than the scrollport', () => {
    const dom = installDom();
    const manager = makeManager();
    try {
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      const fileContainer = document.createElement('div');
      const codeElement = document.createElement('div');
      scroller.appendChild(fileContainer);
      document.body.appendChild(scroller);
      stubRect(scroller, 0, 200, 0, 200);
      // A short file (top 50 -> 90) fully inside the scrollport: `[data-code]`
      // uses overflow-y: clip, so its own box, not the taller scroller, bounds
      // the popover.
      stubRect(codeElement, 50, 90, 0, 100);

      manager.setViewportElements(fileContainer, codeElement);
      expect(manager.getPlacementBounds()).toEqual({
        top: 0,
        bottom: 40,
        left: 0,
        right: 100,
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

describe('setPopoverPositionStyles', () => {
  const VIEWPORT_BOUNDS: PopoverViewportBounds = {
    top: 12,
    bottom: 480,
    left: 30,
    right: 620,
  };

  test('writes the vertical viewport bounds so the CSS clamp can keep the popover on-screen', () => {
    const dom = installDom();
    try {
      const popover = document.createElement('div');
      setPopoverPositionStyles(popover, {
        gutterWidth: 40,
        placeAbove: false,
        viewport: VIEWPORT_BOUNDS,
        x: 100,
        y: 500,
      });

      expect(popover.style.getPropertyValue('--popover-viewport-top')).toBe(
        '12px'
      );
      expect(popover.style.getPropertyValue('--popover-viewport-bottom')).toBe(
        '480px'
      );
      expect(popover.style.getPropertyValue('--popover-viewport-left')).toBe(
        '30px'
      );
      expect(popover.style.getPropertyValue('--popover-viewport-right')).toBe(
        '620px'
      );
    } finally {
      dom.cleanup();
    }
  });

  test('removes every viewport bound when no geometry is available, falling back to the CSS sentinels', () => {
    const dom = installDom();
    try {
      const popover = document.createElement('div');
      // Seed values first so the removal branch has something to clear.
      setPopoverPositionStyles(popover, {
        gutterWidth: 40,
        placeAbove: true,
        viewport: VIEWPORT_BOUNDS,
        x: 100,
        y: 500,
      });
      setPopoverPositionStyles(popover, {
        gutterWidth: 40,
        placeAbove: true,
        viewport: undefined,
        x: 100,
        y: 500,
      });

      expect(popover.style.getPropertyValue('--popover-viewport-top')).toBe('');
      expect(popover.style.getPropertyValue('--popover-viewport-bottom')).toBe(
        ''
      );
      expect(popover.style.getPropertyValue('--popover-viewport-left')).toBe(
        ''
      );
      expect(popover.style.getPropertyValue('--popover-viewport-right')).toBe(
        ''
      );
    } finally {
      dom.cleanup();
    }
  });
});
