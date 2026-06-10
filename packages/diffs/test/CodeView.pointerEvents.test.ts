import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { dispatchScroll, installDom, wait } from './domHarness';

function getPointerEventsTarget(root: HTMLElement): HTMLDivElement {
  const container = root.firstElementChild;
  if (!(container instanceof HTMLDivElement)) {
    throw new Error('missing CodeView content container');
  }
  const stickyContainer = container.lastElementChild;
  if (!(stickyContainer instanceof HTMLDivElement)) {
    throw new Error('missing CodeView sticky container');
  }
  return stickyContainer;
}

function getCodeOverflowBlock(target: HTMLElement): string {
  return target.style.getPropertyValue('--diffs-overflow-override');
}

describe('CodeView pointer events while scrolling', () => {
  test('disables pointer events by default during scroll and restores after delay', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);

      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('keeps pointer events enabled when opted out', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      pointerEventsOnScroll: true,
    });
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);

      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
      await wait(150);
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('cleanUp restores pointer events immediately', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);
      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');

      viewer.cleanUp();

      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('cleanUp unsets the root overflow anchor style', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      root.style.overflowAnchor = 'auto';

      viewer.setup(root);
      expect(root.style.overflowAnchor).toBe('none');

      viewer.cleanUp();

      expect(root.style.overflowAnchor).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  // Opting out mid-scroll must not strand the view at pointer-events: none;
  // whether setOptions restores immediately or lets the pending timer fire is
  // an implementation choice this test deliberately does not pin.
  test('pointer events are restored after opting out mid-scroll', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);
      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');

      viewer.setOptions({ pointerEventsOnScroll: true });

      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('applies overflow override while scrolling on mobile Safari only', async () => {
    const { cleanup } = installDom({
      navigator: {
        maxTouchPoints: 5,
        platform: 'iPhone',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      },
    });
    const modulePath = '../src/components/CodeView.ts?mobile-safari-test';
    const { CodeView: MobileSafariCodeView } = await import(modulePath);
    const viewer = new MobileSafariCodeView();
    try {
      const root = document.createElement('div');
      viewer.setup(root);
      const pointerEventsTarget = getPointerEventsTarget(root);

      dispatchScroll(root);

      expect(pointerEventsTarget.style.pointerEvents).toBe('none');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('hidden');
      await wait(150);
      expect(pointerEventsTarget.style.pointerEvents).toBe('');
      expect(getCodeOverflowBlock(pointerEventsTarget)).toBe('auto');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
