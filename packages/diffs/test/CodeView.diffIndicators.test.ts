import { afterAll, describe, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { CodeViewItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForRenderedPre(
  root: ParentNode,
  predicate: (pre: HTMLPreElement) => boolean,
  message: string
): Promise<HTMLPreElement> {
  let lastAttribute: string | null | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    const pre = findRenderedPre(root);
    lastAttribute = pre?.getAttribute('data-indicators');
    if (pre != null && predicate(pre)) {
      return pre;
    }
    await wait(10);
  }
  throw new Error(`${message}; last data-indicators=${String(lastAttribute)}`);
}

function findRenderedPre(root: ParentNode): HTMLPreElement | null {
  const directPre = root.querySelector('pre');
  if (directPre instanceof HTMLPreElement) {
    return directPre;
  }

  for (const element of root.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    const shadowRoot = element.shadowRoot;
    if (shadowRoot == null) {
      continue;
    }
    const shadowPre = findRenderedPre(shadowRoot);
    if (shadowPre != null) {
      return shadowPre;
    }
  }

  return null;
}

function makeFile(name: string, contents: string): FileContents {
  return { name, contents };
}

function makeDiffItem(): CodeViewItem<undefined> {
  return {
    id: 'diff:indicator-style',
    type: 'diff',
    fileDiff: parseDiffFromFile(
      makeFile('src/example.ts', 'const value = 1;\n'),
      makeFile('src/example.ts', 'const value = 2;\n')
    ),
  };
}

describe('CodeView diff indicators', () => {
  test('updates rendered indicator attributes when options change', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      diffIndicators: 'bars',
      disableErrorHandling: true,
      disableFileHeader: true,
    });
    const root = createRoot();

    try {
      viewer.setup(root);
      viewer.setItems([makeDiffItem()]);
      viewer.render(true);

      await waitForRenderedPre(
        root,
        (pre) => pre.getAttribute('data-indicators') === 'bars',
        'Expected initial bars indicators'
      );

      viewer.setOptions({
        diffIndicators: 'classic',
        disableErrorHandling: true,
        disableFileHeader: true,
      });
      viewer.render(true);

      await waitForRenderedPre(
        root,
        (pre) => pre.getAttribute('data-indicators') === 'classic',
        'Expected classic indicators after option change'
      );

      viewer.setOptions({
        diffIndicators: 'none',
        disableErrorHandling: true,
        disableFileHeader: true,
      });
      viewer.render(true);

      await waitForRenderedPre(
        root,
        (pre) => !pre.hasAttribute('data-indicators'),
        'Expected indicators to be removed after option change'
      );
    } finally {
      viewer.cleanUp();
      cleanup();
    }
  });
});
