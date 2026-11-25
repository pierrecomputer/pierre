import { afterEach, beforeEach, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { FileContents, LineAnnotation } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import { createRoot, installDom, waitFor } from './domHarness';
import { createInitializingManager, withTimeout } from './workerPoolHarness';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

const createFile = (name: string): FileContents => ({
  name: 'virtualized.ts',
  cacheKey: `virtualized-theme-ready:${name}`,
  contents:
    Array.from(
      { length: 1000 },
      (_, index) => `const ${name}${index + 1} = ${index + 1};`
    ).join('\n') + '\n',
});
const original = { name: 'answer.ts', contents: 'const answer = 0;\n' };
const updated = { ...original, contents: 'const answer = 42;\n' };
const SCROLL_TOP = 19_600;

test('virtualized items paint plain rows on the local theme and take worker tokens after a pending replacement', async () => {
  const dom = installDom();
  const { manager, worker, initialization } = createInitializingManager({
    theme: 'pierre-dark',
    lineDiffType: 'none',
  });
  const root = createRoot();
  const content = document.createElement('div');
  root.appendChild(content);
  Object.defineProperty(root, 'scrollHeight', { value: 30_000 });
  root.scrollTop = SCROLL_TOP;
  // jsdom has no layout: place each item at a fixed offset in the scroller.
  const place = (offset: number) => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () =>
      ({ top: offset - root.scrollTop, height: 0 }) as DOMRect;
    content.appendChild(container);
    return container;
  };
  const fileContainer = place(0);
  const diffContainer = place(20_100);
  const virtualizer = new Virtualizer();
  virtualizer.setup(root, content);

  // The file is unmanaged: it retains its input, renders its own annotations
  // and retries through the virtualizer. The diff stays owner-managed.
  let file = createFile('alpha');
  const fileDiff = parseDiffFromFile(original, updated);
  const fileView = new VirtualizedFile<string>(
    {
      renderAnnotation({ metadata }) {
        const element = document.createElement('span');
        element.textContent = metadata;
        return element;
      },
    },
    virtualizer,
    undefined,
    manager
  );
  const diffView: VirtualizedFileDiff = new VirtualizedFileDiff(
    { diffStyle: 'unified' },
    virtualizer,
    undefined,
    manager,
    () => diffView.render({ fileDiff })
  );
  const fileRow = (line: number) =>
    fileContainer.shadowRoot?.querySelector(`[data-line="${line}"]`);
  const diffRow = () =>
    diffContainer.shadowRoot?.querySelector(
      '[data-line][data-line-type="change-addition"]'
    );
  const hasConstToken = (row: Element | null | undefined) =>
    Array.from(row?.children ?? []).some(
      (span) => span.textContent === 'const'
    );
  try {
    fileView.render({ file, fileContainer, lineAnnotations: [] });
    diffView.render({ fileDiff, fileContainer: diffContainer });
    dom.triggerIntersectionObserver(fileContainer, true);
    dom.triggerIntersectionObserver(diffContainer, true);
    expect(fileRow(990)).toBeNull();
    expect(diffRow()).toBeNull();

    // The cold theme loads while the worker's initialize reply is held.
    await waitFor(() => fileRow(990) != null && diffRow() != null);
    expect(manager.getStats().readyWorkers).toBe(0);
    expect(fileRow(990)?.textContent).toBe('const alpha990 = 990;');
    expect(fileRow(990)?.children.length).toBe(1);
    expect(fileRow(1)).toBeNull();
    expect(diffRow()?.textContent).toBe('const answer = 42;');
    expect(diffRow()?.children.length).toBe(1);

    // Replace the file while the worker is still pending.
    file = createFile('beta');
    const lineAnnotations: LineAnnotation<string>[] = [
      { lineNumber: 990, metadata: 'beta note' },
    ];
    fileView.render({ file, lineAnnotations });
    expect(fileRow(990)?.textContent).toBe('const beta990 = 990;');
    expect(fileContainer.textContent).toContain('beta note');

    const setup = await withTimeout(worker.waitForInitializeRequest());
    worker.respond({
      type: 'success',
      requestType: 'initialize',
      id: setup.id,
      sentAt: Date.now(),
    });
    await initialization;
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const diffRequest = await withTimeout(worker.waitForDiffRequest());
    const diffOptions = manager.getDiffRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'diff',
      id: diffRequest.id,
      options: diffOptions,
      result: renderDiffWithHighlighter(
        diffRequest.diff,
        highlighter,
        diffOptions
      ),
      sentAt: Date.now(),
    });
    const fileRequest = await withTimeout(worker.waitForFileRequest());
    expect(fileRequest.file.cacheKey).toBe(file.cacheKey);
    const fileOptions = manager.getFileRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'file',
      id: fileRequest.id,
      options: fileOptions,
      result: renderFileWithHighlighter(
        fileRequest.file,
        highlighter,
        fileOptions
      ),
      sentAt: Date.now(),
    });

    // Wait for worker tokens in both rows, then one frame for any scheduled
    // owner render to settle.
    await waitFor(
      () => hasConstToken(fileRow(990)) && hasConstToken(diffRow())
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // The unmanaged file re-rendered its retained beta input and annotations.
    expect(fileRow(990)?.textContent).toBe('const beta990 = 990;');
    expect(hasConstToken(fileRow(990))).toBe(true);
    expect(fileRow(1)).toBeNull();
    expect(fileContainer.shadowRoot?.textContent).not.toContain('alpha');
    expect(fileContainer.textContent?.match(/beta note/g)).toHaveLength(1);
    expect(diffRow()?.textContent).toBe('const answer = 42;');
    expect(hasConstToken(diffRow())).toBe(true);
    expect(root.scrollTop).toBe(SCROLL_TOP);
    expect(virtualizer.getScrollTop()).toBe(SCROLL_TOP);
  } finally {
    void initialization.catch(() => {});
    fileView.cleanUp();
    diffView.cleanUp();
    virtualizer.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});
