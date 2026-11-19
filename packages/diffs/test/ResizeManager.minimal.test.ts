import { beforeAll, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { installDom, preloadTestHighlighter, wait } from './domHarness';

beforeAll(preloadTestHighlighter);

test('expanding a right-side comment leaves the left row alone during resize delivery', async () => {
  const dom = installDom();
  const diff = new FileDiff({
    diffStyle: 'split',
    renderAnnotation: () => document.createElement('div'),
  });
  try {
    const host = document.createElement('div');
    diff.render({
      fileContainer: host,
      oldFile: { name: 'settings.ts', contents: 'const retries = 3;' },
      newFile: { name: 'settings.ts', contents: 'const retries = 5;' },
      lineAnnotations: [{ lineNumber: 1, side: 'additions' }],
    });
    await wait();
    diff.flushManagers();

    const left = host.shadowRoot?.querySelector<HTMLElement>(
      '[data-deletions] [data-line-annotation]'
    );
    const right = host.shadowRoot?.querySelector(
      '[data-additions] [data-line-annotation] > :first-child'
    );
    if (left == null || right == null)
      throw new Error('Expected paired split rows');

    const leftHeight = () =>
      left.style.getPropertyValue('--diffs-annotation-min-height');
    const measureComment = (height: number) => {
      right.getBoundingClientRect = () => new window.DOMRect(0, 0, 300, height);
      dom.triggerResizeObserver(right);
    };

    measureComment(36);
    await wait();
    expect(leftHeight()).toBe('36px');

    measureComment(100);
    expect(leftHeight()).toBe('36px');
    await wait();
    expect(leftHeight()).toBe('100px');
  } finally {
    diff.cleanUp();
    dom.cleanup();
  }
});
