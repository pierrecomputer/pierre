import { beforeAll, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { installDom, preloadTestHighlighter, wait } from './domHarness';

beforeAll(preloadTestHighlighter);

test('applies measured split annotation and column sizes after resize delivery', async () => {
  const dom = installDom();
  const diff = new FileDiff({
    diffStyle: 'split',
    renderAnnotation: () => document.createElement('div'),
  });
  try {
    const host = document.createElement('div');
    diff.render({
      fileContainer: host,
      oldFile: { name: 'old.ts', contents: 'old\n' },
      newFile: { name: 'old.ts', contents: 'new\n' },
      lineAnnotations: [{ side: 'additions', lineNumber: 1 }],
    });
    await wait();
    diff.flushManagers();
    const code = host.shadowRoot?.querySelector('code');
    const annotations = Array.from(
      host.shadowRoot?.querySelectorAll<HTMLElement>(
        '[data-line-annotation]'
      ) ?? []
    );
    const [left, right] = annotations;
    if (
      code?.firstElementChild == null ||
      left?.firstElementChild == null ||
      right?.firstElementChild == null
    ) {
      throw new Error(
        'Expected a split diff with paired annotation rows and a gutter'
      );
    }
    const sizes = () => [
      ...annotations.map((row) =>
        row.style.getPropertyValue('--diffs-annotation-min-height')
      ),
      code.style.getPropertyValue('--diffs-column-width'),
      code.style.getPropertyValue('--diffs-column-content-width'),
    ];
    const before = sizes();
    const resize = (target: Element, width: number, height: number) => {
      target.getBoundingClientRect = () =>
        new window.DOMRect(0, 0, width, height);
      dom.triggerResizeObserver(target);
    };
    resize(left.firstElementChild, 0, 12);
    resize(right.firstElementChild, 0, 48);
    resize(code, 320, 0);
    resize(code.firstElementChild, 40, 0);
    expect(sizes()).toEqual(before);
    await wait();
    expect(sizes()).toEqual(['48px', '48px', '320px', '280px']);
  } finally {
    diff.cleanUp();
    dom.cleanup();
  }
});
