import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import type {
  CodeViewItem,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { createInitializedManager, withTimeout } from './workerPoolHarness';

let sharedHighlighter: DiffsHighlighter;

function loadHighlighter(): Promise<DiffsHighlighter> {
  return getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
}

beforeAll(async () => {
  sharedHighlighter = await loadHighlighter();
});

afterAll(async () => {
  await disposeHighlighter();
});

function makeFile(name: string, lineCount: number): FileContents {
  return {
    name: `${name}.ts`,
    cacheKey: `${name}:${lineCount}`,
    contents: Array.from(
      { length: lineCount },
      (_, line) => `export const ${name}${line} = ${line};\n`
    ).join(''),
  };
}

// A diff that adds `lineCount` lines to an empty file, so its header reads
// `+lineCount`.
function makeDiff(name: string, lineCount: number): FileDiffMetadata {
  return parseDiffFromFile(
    { name: `${name}.ts`, cacheKey: `${name}:old`, contents: '' },
    makeFile(name, lineCount)
  );
}

function makeItem(
  type: 'file' | 'diff',
  collapsed: boolean,
  version: number,
  lineCount = 3
): CodeViewItem<undefined> {
  return type === 'file'
    ? {
        id: 'item',
        type,
        collapsed,
        version,
        file: makeFile('sample', lineCount),
      }
    : {
        id: 'item',
        type,
        collapsed,
        version,
        fileDiff: makeDiff('sample', lineCount),
      };
}

function shadowOf(viewer: CodeView): ShadowRoot | null | undefined {
  return viewer.getRenderedItems()[0]?.element.shadowRoot;
}

function headerText(viewer: CodeView): string {
  return (
    shadowOf(viewer)?.querySelector('[data-diffs-header]')?.textContent ?? ''
  );
}

function codeText(viewer: CodeView): string {
  return shadowOf(viewer)?.querySelector('pre')?.textContent ?? '';
}

describe('a collapsed CodeView item', () => {
  for (const type of ['file', 'diff'] as const) {
    test(`a collapsed ${type} asks the worker pool for no highlight until it opens`, async () => {
      const dom = installDom();
      const { manager, worker } = await createInitializedManager({
        theme: 'pierre-dark',
      });
      const viewer = new CodeView({ theme: 'pierre-dark' }, manager);
      const requestCount = () =>
        type === 'file' ? worker.fileRequestCount : worker.diffRequestCount;
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeItem(type, true, 1)]);
        await waitFor(() => headerText(viewer).includes('sample.ts'));
        expect(headerText(viewer)).toContain('sample.ts');
        await wait(20);
        expect(requestCount()).toBe(0);

        viewer.updateItem(makeItem(type, false, 2));
        viewer.render(true);
        await waitFor(() => requestCount() > 0);
        expect(requestCount()).toBe(1);
        expect(codeText(viewer)).toContain('sample0');
      } finally {
        viewer.cleanUp();
        manager.terminate();
        dom.cleanup();
      }
    });

    test(`a collapsed ${type} is not highlighted on the main thread until it opens`, async () => {
      const dom = installDom();
      const viewer = new CodeView({ theme: 'pierre-dark' });
      const highlight = spyOn(sharedHighlighter, 'codeToTokens');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeItem(type, true, 1)]);
        await waitFor(() => headerText(viewer).includes('sample.ts'));
        expect(headerText(viewer)).toContain('sample.ts');
        await wait(20);
        expect(highlight).not.toHaveBeenCalled();

        viewer.updateItem(makeItem(type, false, 2));
        viewer.render(true);
        await waitFor(() => highlight.mock.calls.length > 0);
        expect(highlight).toHaveBeenCalled();
        expect(codeText(viewer)).toContain('sample0');
      } finally {
        highlight.mockRestore();
        viewer.cleanUp();
        dom.cleanup();
      }
    });

    test(`a collapsed ${type} shows its header once the theme has loaded`, async () => {
      const dom = installDom();
      await disposeHighlighter();
      const viewer = new CodeView({ theme: 'pierre-dark' });
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeItem(type, true, 1)]);
        await waitFor(() => headerText(viewer).includes('sample.ts'));
        expect(headerText(viewer)).toContain('sample.ts');
      } finally {
        viewer.cleanUp();
        dom.cleanup();
        sharedHighlighter = await loadHighlighter();
      }
    });
  }

  test('a highlighted diff that is collapsed and then replaced shows the new diff', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const viewer = new CodeView({ theme: 'pierre-dark' }, manager);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeItem('diff', false, 1, 3)]);
      const request = await withTimeout(worker.waitForDiffRequest());
      const options = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(
          request.diff,
          sharedHighlighter,
          options
        ),
        options,
        sentAt: Date.now(),
      });
      viewer.render(true);
      await waitFor(() => headerText(viewer).includes('+3'));
      expect(headerText(viewer)).toContain('+3');

      viewer.updateItem(makeItem('diff', true, 2, 3));
      viewer.render(true);
      await wait(0);
      expect(codeText(viewer)).toBe('');

      // The replacement adds five lines. Nothing answers a highlight request
      // from here on.
      viewer.updateItem(makeItem('diff', true, 3, 5));
      viewer.render(true);
      await waitFor(() => headerText(viewer).includes('+5'));
      expect(headerText(viewer)).toContain('+5');
      expect(worker.diffRequestCount).toBe(1);

      viewer.updateItem(makeItem('diff', false, 4, 5));
      viewer.render(true);
      await waitFor(() => codeText(viewer).includes('sample4'));
      expect(codeText(viewer)).toContain('sample4');
      expect(headerText(viewer)).toContain('+5');
      expect(worker.diffRequestCount).toBe(2);
    } finally {
      viewer.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });
});

// Hydrated content exists only as the prerendered DOM, which collapsing
// removes. Neither worker request is answered in these tests.
describe('a hydrated item that is collapsed and reopened', () => {
  test('a FileDiff shows its plain rows again', async () => {
    const dom = installDom();
    const { manager } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const options = { theme: 'pierre-dark' } as const;
    const fileDiff = makeDiff('hydrated', 3);
    const instance = new FileDiff(options, manager);
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const code = () =>
      fileContainer.shadowRoot?.querySelector('pre')?.textContent ?? '';
    try {
      const { prerenderedHTML } = await preloadFileDiff({ fileDiff, options });
      instance.hydrate({ fileDiff, fileContainer, prerenderedHTML });
      expect(code()).toContain('hydrated0');

      instance.setOptions({ ...options, collapsed: true });
      instance.render({ fileDiff, fileContainer, forceRender: true });
      expect(code()).toBe('');

      instance.setOptions({ ...options, collapsed: false });
      instance.render({ fileDiff, fileContainer, forceRender: true });
      expect(code()).toContain('hydrated0');
    } finally {
      instance.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });

  test('a File shows its plain rows again', async () => {
    const dom = installDom();
    const { manager } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const options = { theme: 'pierre-dark' } as const;
    const file = makeFile('hydrated', 3);
    const instance = new File(options, manager);
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const code = () =>
      fileContainer.shadowRoot?.querySelector('pre')?.textContent ?? '';
    try {
      const { prerenderedHTML } = await preloadFile({ file, options });
      instance.hydrate({ file, fileContainer, prerenderedHTML });
      expect(code()).toContain('hydrated0');

      instance.setOptions({ ...options, collapsed: true });
      instance.render({ file, fileContainer, forceRender: true });
      expect(code()).toBe('');

      instance.setOptions({ ...options, collapsed: false });
      instance.render({ file, fileContainer, forceRender: true });
      expect(code()).toContain('hydrated0');
    } finally {
      instance.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });
});
