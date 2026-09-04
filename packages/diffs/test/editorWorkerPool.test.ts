import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { parseDiffFromFile } from '../src';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import {
  DiffHunksRenderer,
  type HunksRenderResult,
} from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type {
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  HighlightedToken,
} from '../src/types';
import { getDiffHunksRendererOptions } from '../src/utils/getDiffHunksRendererOptions';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import type { RenderDiffRequest } from '../src/worker/types';
import type { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import { createRoot, installDom, wait } from './domHarness';
import { createEditorInstance } from './editorTestUtils';
import { createDeferred, type Deferred } from './testUtils';
import {
  createInitializedManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  respondToFileRequest,
  type TestWorker,
  withTimeout,
} from './workerPoolHarness';

// During an edit session (begun at editor attach), File/FileDiff renderers
// stay on the main thread: renders use editor-compatible token-transformer
// markup, no worker requests are issued for the edited surface, and pool
// results that were already in flight are refused. These tests cover that
// behavior at the renderer level plus the component wiring.

let restoreAnimationFrame: (() => void) | undefined;

function createKeylessSessionDiff(
  externalDiff: FileDiffMetadata
): FileDiffMetadata {
  const sessionDiff = { ...externalDiff };
  delete sessionDiff.cacheKey;
  return sessionDiff;
}

class DeferredHighlighterDiffRenderer extends DiffHunksRenderer {
  readonly initializations: Deferred<DiffsHighlighter>[] = [];

  override initializeHighlighter(): Promise<DiffsHighlighter> {
    const deferred = createDeferred<DiffsHighlighter>();
    this.initializations.push(deferred);
    return deferred.promise;
  }
}

let sharedHighlighter: DiffsHighlighter;

beforeAll(async () => {
  restoreAnimationFrame = installAnimationFramePolyfill();
  sharedHighlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

const FILE_CONTENTS = 'const a = 1;\n\nconst b = 2;\n';

function createFile(cacheKey: string): FileContents {
  return { name: 'demo.ts', contents: FILE_CONTENTS, cacheKey };
}

function createEditSessionFile(file: FileContents): FileContents {
  const editSessionFile = { ...file };
  delete editSessionFile.cacheKey;
  return editSessionFile;
}

// A structurally valid plain (non-transformer) worker result for `contents`:
// one line element per line, the shape processFileResult requires.
function plainFileCode(contents: string): ElementContent[] {
  return contents.split('\n').map((text, index) => ({
    type: 'element',
    tagName: 'div',
    properties: {
      'data-line': index + 1,
      'data-line-type': 'context',
      'data-line-index': index,
    },
    children: [{ type: 'text', value: text.length > 0 ? text : '\n' }],
  }));
}

function renderedDiffHtml(
  result: ReturnType<DiffHunksRenderer['renderDiff']>
): string {
  return toHtml([
    ...(result?.unifiedContentAST ?? []),
    ...(result?.additionsContentAST ?? []),
    ...(result?.deletionsContentAST ?? []),
  ]);
}

function createWorkerDiff(
  cacheKeyPrefix: string,
  contents: string,
  name = 'pending.ts'
): FileDiffMetadata {
  return parseDiffFromFile(
    {
      name,
      contents: name.endsWith('.txt') ? 'before\n' : 'const before = 0;\n',
      cacheKey: `${cacheKeyPrefix}:old`,
    },
    {
      name,
      contents,
      cacheKey: `${cacheKeyPrefix}:new`,
    }
  );
}

function respondWithHighlightedDiff(
  manager: WorkerPoolManager,
  worker: TestWorker,
  request: RenderDiffRequest,
  diff: FileDiffMetadata
): void {
  const options = manager.getDiffRenderOptions();
  worker.respond({
    type: 'success',
    requestType: 'diff',
    id: request.id,
    result: renderDiffWithHighlighter(diff, sharedHighlighter, options),
    options,
    sentAt: Date.now(),
  });
}

async function renderHighlightedDiff(
  renderer: DiffHunksRenderer,
  manager: WorkerPoolManager,
  worker: TestWorker,
  diff: FileDiffMetadata
): Promise<HunksRenderResult> {
  renderer.renderDiff(diff);
  const request = await withTimeout(worker.waitForDiffRequest());
  respondWithHighlightedDiff(manager, worker, request, diff);
  await waitFor(() => expect(manager.getDiffResultCache(diff)).toBeDefined());

  const result = renderer.renderDiff(diff);
  if (result == null) {
    throw new Error('Expected the highlighted diff to render');
  }
  return result;
}

// Budget stays below bun's 5s test timeout so a failing poll rejects (and
// the test's finally-cleanup runs) before bun abandons the test — a zombie
// cleanup firing mid-way through a later test tears down its DOM globals.
async function waitFor(
  assertion: () => void,
  timeoutMs = 4_000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeoutMs) {
        throw error;
      }
      await wait(10);
    }
  }
}

describe('FileRenderer edit session', () => {
  test('editing renders locally with editor-compatible token markup', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:session');

      renderer.renderFile(file);
      await withTimeout(worker.waitForFileRequest());
      expect(worker.fileRequestCount).toBe(1);

      const editSessionFile = createEditSessionFile(file);
      renderer.beginEditSession(editSessionFile, file);
      renderer.renderFile(editSessionFile);

      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      const result = renderer.renderFile(editSessionFile);
      if (result == null) {
        throw new Error('expected a render result');
      }
      const html = toHtml(result.contentAST);
      expect(html).toContain('data-char');
      expect(html).toContain('<br>');
      expect(worker.fileRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('ignores a worker result that finishes after editing begins', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:late');

      renderer.renderFile(file);
      const request = await withTimeout(worker.waitForFileRequest());

      const editSessionFile = createEditSessionFile(file);
      renderer.beginEditSession(editSessionFile, file);
      renderer.renderFile(editSessionFile);
      const poolMarker: ElementContent[] = [
        {
          type: 'element',
          tagName: 'div',
          properties: { 'data-line': 1, 'data-pool-result': '' },
          children: [],
        },
      ];
      respondToFileRequest(manager, worker, request, poolMarker);
      // Refused outright: nothing is applied and nothing is requested — the
      // session render issued at editor attach supplies the highlight.
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));

      const result = renderer.renderFile(editSessionFile);
      if (result == null) {
        throw new Error('expected a render result');
      }
      expect(toHtml(result.contentAST)).not.toContain('data-pool-result');
    } finally {
      manager.terminate();
    }
  });

  test('ignores a late worker result even when its render options match the editor', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:pool-transformer');

      renderer.renderFile(file);
      const request = await withTimeout(worker.waitForFileRequest());

      const editSessionFile = createEditSessionFile(file);
      renderer.beginEditSession(editSessionFile, file);
      renderer.renderFile(editSessionFile);
      const poolMarker: ElementContent[] = [
        {
          type: 'element',
          tagName: 'div',
          properties: { 'data-line': 1, 'data-pool-result': '' },
          children: [],
        },
      ];
      // With useTokenTransformer already on, the pool's options equal the
      // session options — the refused result must not sneak back in through
      // the manager's result cache on the next session render.
      respondToFileRequest(manager, worker, request, poolMarker);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));

      // The session render issued at editor attach stays local: no adoption
      // of the refused result, and the local highlight lands when ready.
      let result = renderer.renderFile(editSessionFile);
      if (result == null) {
        throw new Error('expected a render result');
      }
      expect(toHtml(result.contentAST)).not.toContain('data-pool-result');

      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      result = renderer.renderFile(editSessionFile);
      if (result == null) {
        throw new Error('expected a render result');
      }
      const html = toHtml(result.contentAST);
      expect(html).not.toContain('data-pool-result');
      expect(html).toContain('data-char');
      expect(html).toContain('color:');
      expect(worker.fileRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('hydrating a file during editing does not request a worker render', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        undefined,
        manager
      );
      const editSessionFile = createEditSessionFile(createFile('file:hydrate'));
      renderer.beginEditSession(editSessionFile);
      renderer.hydrate(editSessionFile);
      await wait(50);
      expect(worker.fileRequestCount).toBe(0);
    } finally {
      manager.terminate();
    }
  });

  test('ending an edit session preserves private edits without changing the external file', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:dirty');

      // Pool render settles (and populates the manager cache) before the
      // editor attaches.
      renderer.renderFile(file);
      respondToFileRequest(
        manager,
        worker,
        await withTimeout(worker.waitForFileRequest()),
        plainFileCode(FILE_CONTENTS)
      );

      const editSessionFile = createEditSessionFile(file);
      renderer.beginEditSession(editSessionFile, file);
      renderer.renderFile(editSessionFile);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(1));
      renderer.renderFile(editSessionFile);

      // Simulate an editor keystroke: line 0 rewritten, cache marked dirty.
      renderer.updateRenderCache(
        new Map([[0, [[0, '#ffffff', 'const edited = 1;']]]]),
        'dark'
      );

      renderer.endEditSession();
      const result = renderer.renderFile(editSessionFile);
      if (result == null) {
        throw new Error('expected a render result');
      }
      expect(file.contents).toBe(FILE_CONTENTS);
      expect(editSessionFile.contents).toContain('const edited = 1;');
      expect(toHtml(result.contentAST)).toContain('const edited = 1;');
    } finally {
      manager.terminate();
    }
  });

  test('ending an edit session sends later renders back to the worker', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:detach');
      const editSessionFile = createEditSessionFile(file);
      renderer.beginEditSession(editSessionFile, file);

      renderer.renderFile(editSessionFile);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      expect(worker.fileRequestCount).toBe(0);

      renderer.endEditSession();
      renderer.renderFile(editSessionFile);
      await withTimeout(worker.waitForFileRequest());
      expect(worker.fileRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('editing a reused worker render does not change the external cache', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        undefined,
        manager
      );
      const externalFile = createFile('file:cached-external');
      const externalBefore = structuredClone(externalFile);

      renderer.renderFile(externalFile);
      await respondWithRealFileHighlight(manager, worker, externalFile);
      await waitFor(() => {
        expect(manager.getFileResultCache(externalFile)).toBeDefined();
      });
      renderer.renderFile(externalFile);
      const cachedExternalBefore = structuredClone(
        manager.getFileResultCache(externalFile)
      );

      const editSessionFile = createEditSessionFile(externalFile);
      renderer.beginEditSession(editSessionFile, externalFile);
      expect(renderer.editorRenderReady()).toBe(true);
      renderer.updateRenderCache(
        new Map([[0, [[0, '#ffffff', 'const edited = true;']]]]),
        'dark'
      );

      expect(editSessionFile.contents).toContain('const edited = true;');
      expect(externalFile).toEqual(externalBefore);
      expect(manager.getFileResultCache(externalFile)).toEqual(
        cachedExternalBefore
      );
      expect(
        toHtml(manager.getFileResultCache(externalFile)?.result.code ?? [])
      ).not.toContain('const edited = true;');
    } finally {
      manager.terminate();
    }
  });
});

describe('FileRenderer worker rendering', () => {
  test('keeps a hydrated file selected when its replacement cannot render synchronously', async () => {
    const { manager } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const renderer = new FileRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    const currentFile: FileContents = {
      name: 'current.ts',
      contents: 'const alpha = 1;\n',
      cacheKey: 'hydrated-file:a',
    };
    const replacementFile: FileContents = {
      name: 'replacement.ts',
      contents: 'const beta = 2;\n',
      cacheKey: 'hydrated-file:b',
    };

    try {
      renderer.hydrate(currentFile);
      expect(renderer.fileCache).toBe(currentFile);
      expect(renderer.renderFile(currentFile)).toBeUndefined();
      expect(renderer.fileCache).toBe(currentFile);
      expect(renderer.getFileForNextRender(replacementFile)).toBe(currentFile);
      expect(renderer.renderFile(replacementFile)).toBeUndefined();
      expect(renderer.fileCache).toBe(currentFile);
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('keeps the current highlighted file visible while highlighting its replacement', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    let renderUpdates = 0;
    const renderer = new FileRenderer(
      { theme: 'pierre-dark' },
      undefined,
      () => renderUpdates++,
      manager
    );
    const currentFile: FileContents = {
      name: 'current.ts',
      contents: 'const currentValue = 1;\n',
      cacheKey: 'file:current',
    };
    const replacementFile: FileContents = {
      name: 'replacement.ts',
      contents: 'const replacementValue = 2;\n',
      cacheKey: 'file:replacement',
    };

    try {
      const primeCurrent = manager.primeFileHighlightCache(currentFile);
      await respondWithRealFileHighlight(manager, worker, currentFile);
      await withTimeout(primeCurrent);
      const currentResult = renderer.renderFile(currentFile);
      expect(toHtml(currentResult?.contentAST ?? [])).toContain('currentValue');

      const pendingResult = renderer.renderFile(replacementFile);
      expect(renderer.getFileForNextRender(replacementFile)).toBe(currentFile);
      expect(pendingResult?.file).toBe(currentFile);
      expect(toHtml(pendingResult?.contentAST ?? [])).toContain('currentValue');
      expect(toHtml(pendingResult?.contentAST ?? [])).not.toContain(
        'replacementValue'
      );

      await waitFor(() => expect(worker.fileRequestCount).toBe(2));
      const replacementRequest = await withTimeout(worker.waitForFileRequest());
      expect(replacementRequest.file.cacheKey).toBe(replacementFile.cacheKey);
      worker.respond({
        type: 'success',
        requestType: 'file',
        id: replacementRequest.id,
        result: renderFileWithHighlighter(
          replacementFile,
          sharedHighlighter,
          manager.getFileRenderOptions()
        ),
        options: manager.getFileRenderOptions(),
        sentAt: Date.now(),
      });
      await waitFor(() =>
        expect(renderer.getFileForNextRender(replacementFile)).toBe(
          replacementFile
        )
      );
      expect(renderer.getFileForNextRender(replacementFile)).toBe(
        replacementFile
      );
      expect(renderer.fileCache).toBe(currentFile);
      const replacementResult = renderer.renderFile(replacementFile);
      expect(renderer.fileCache).toBe(replacementFile);
      expect(replacementResult?.file).toBe(replacementFile);
      expect(toHtml(replacementResult?.contentAST ?? [])).toContain(
        'replacementValue'
      );
      expect(toHtml(replacementResult?.contentAST ?? [])).not.toContain(
        'currentValue'
      );
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });
});

describe('DiffHunksRenderer worker rendering', () => {
  test('keeps a hydrated diff selected until its replacement highlight is ready', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    let renderUpdates = 0;
    const renderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      () => renderUpdates++,
      manager
    );
    try {
      const diffA = createWorkerDiff('hydrated:a', 'const alpha = 1;\n');
      const diffB = createWorkerDiff('hydrated:b', 'const beta = 2;\n');

      renderer.hydrate(diffA);
      const requestA = await withTimeout(worker.waitForDiffRequest());
      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffA);
      expect(renderer.renderDiff(diffB)).toBeUndefined();
      expect(renderer.diffCache).toBe(diffA);

      respondWithHighlightedDiff(manager, worker, requestA, diffA);
      await waitFor(() => expect(worker.diffRequestCount).toBe(2));
      const requestB = await withTimeout(worker.waitForDiffRequest());
      expect(requestB.diff.cacheKey).toBe(diffB.cacheKey);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffA);

      respondWithHighlightedDiff(manager, worker, requestB, diffB);
      await waitFor(() => expect(renderUpdates).toBe(1));
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffB);
      expect(renderer.diffCache).toBe(diffA);

      const renderedB = renderer.renderDiff(diffB);
      expect(renderedB?.fileDiff).toBe(diffB);
      expect(renderedDiffHtml(renderedB)).toContain('beta');
      expect(renderer.diffCache).toBe(diffB);
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('keeps the current highlighted diff visible while highlighting its replacement', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    let renderUpdates = 0;
    const renderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      () => renderUpdates++,
      manager
    );
    try {
      const diffA = parseDiffFromFile(
        {
          name: 'pending.ts',
          contents: 'const before = 0;\n',
          cacheKey: 'pending:a:old',
        },
        {
          name: 'pending.ts',
          contents: 'const alpha = 1;\n',
          cacheKey: 'pending:a:new',
        }
      );
      const diffB = parseDiffFromFile(
        {
          name: 'pending.ts',
          contents: 'const before = 0;\n',
          cacheKey: 'pending:b:old',
        },
        {
          name: 'pending.ts',
          contents: 'const beta = 2;\n',
          cacheKey: 'pending:b:new',
        }
      );
      const options = manager.getDiffRenderOptions();
      const highlightedA = renderDiffWithHighlighter(
        diffA,
        sharedHighlighter,
        options
      );
      const highlightedB = renderDiffWithHighlighter(
        diffB,
        sharedHighlighter,
        options
      );
      renderer.renderDiff(diffA);
      const requestA = await withTimeout(worker.waitForDiffRequest());
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: requestA.id,
        result: highlightedA,
        options,
        sentAt: Date.now(),
      });
      await waitFor(() => expect(renderUpdates).toBe(1));

      const settledA = renderer.renderDiff(diffA);
      const settledAHtml = renderedDiffHtml(settledA);
      expect(settledA?.fileDiff).toBe(diffA);
      expect(settledAHtml).toContain('alpha');
      expect(renderer.diffCache).toBe(diffA);

      renderUpdates = 0;
      const whileBPending = renderer.renderDiff(diffB);
      await waitFor(() => expect(worker.diffRequestCount).toBe(2));
      const requestB = await withTimeout(worker.waitForDiffRequest());

      expect(requestB.diff.cacheKey).toBe(diffB.cacheKey);
      expect(whileBPending?.fileDiff).toBe(diffA);
      expect(renderedDiffHtml(whileBPending)).toBe(settledAHtml);
      expect(renderedDiffHtml(whileBPending)).not.toContain('beta');
      expect(renderer.diffCache).toBe(diffA);
      expect(renderUpdates).toBe(0);

      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: requestB.id,
        result: highlightedB,
        options,
        sentAt: Date.now(),
      });
      await waitFor(() => expect(renderUpdates).toBe(1));

      // Completing B only stages its highlighted result. A stays active until
      // the next render transaction promotes B.
      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffB);
      expect(renderer.diffCache).toBe(diffA);

      const settledB = renderer.renderDiff(diffB);
      const settledBHtml = renderedDiffHtml(settledB);
      expect(settledB?.fileDiff).toBe(diffB);
      expect(settledBHtml).toContain('beta');
      expect(settledBHtml).not.toContain('alpha');
      expect(renderer.diffCache).toBe(diffB);

      renderer.onHighlightSuccess(diffA, highlightedA, options);
      expect(renderUpdates).toBe(1);
      expect(renderer.diffCache).toBe(diffB);
      expect(renderedDiffHtml(renderer.renderDiff(diffB))).toBe(settledBHtml);
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('renders a plain-text replacement immediately instead of retaining highlighted content', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const renderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    try {
      const highlightedDiff = createWorkerDiff(
        'plain:a',
        'const highlighted = 1;\n'
      );
      const plainTextDiff = createWorkerDiff(
        'plain:b',
        'plain replacement\n',
        'pending.txt'
      );
      const current = await renderHighlightedDiff(
        renderer,
        manager,
        worker,
        highlightedDiff
      );
      expect(renderedDiffHtml(current)).toContain('highlighted');

      const replacement = renderer.renderDiff(plainTextDiff);

      expect(replacement?.fileDiff).toBe(plainTextDiff);
      expect(renderedDiffHtml(replacement)).toContain('plain replacement');
      expect(renderedDiffHtml(replacement)).not.toContain('highlighted');
      expect(renderer.diffCache).toBe(plainTextDiff);
      expect(worker.diffRequestCount).toBe(1);
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('renders an already-cached replacement immediately instead of retaining highlighted content', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const renderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    try {
      const currentDiff = createWorkerDiff('cached:a', 'const current = 1;\n');
      const cachedDiff = createWorkerDiff('cached:b', 'const cached = 2;\n');
      const current = await renderHighlightedDiff(
        renderer,
        manager,
        worker,
        currentDiff
      );
      expect(renderedDiffHtml(current)).toContain('current');

      const primeCache = manager.primeDiffHighlightCache(cachedDiff);
      await waitFor(() => expect(worker.diffRequestCount).toBe(2));
      const cachedRequest = await withTimeout(worker.waitForDiffRequest());
      respondWithHighlightedDiff(manager, worker, cachedRequest, cachedDiff);
      await withTimeout(primeCache);

      expect(renderer.diffCache).toBe(currentDiff);
      const replacement = renderer.renderDiff(cachedDiff);

      expect(replacement?.fileDiff).toBe(cachedDiff);
      expect(renderedDiffHtml(replacement)).toContain('cached');
      expect(renderedDiffHtml(replacement)).not.toContain('current');
      expect(renderer.diffCache).toBe(cachedDiff);
      expect(worker.diffRequestCount).toBe(2);
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('keeps hydrated content selected until a local plain-text replacement is ready', async () => {
    let renderUpdates = 0;
    const renderer = new DeferredHighlighterDiffRenderer(
      { theme: 'andromeeda' },
      undefined,
      () => renderUpdates++
    );
    try {
      const diffA = createWorkerDiff('hydrated-local:a', 'const alpha = 1;\n');
      const diffB = createWorkerDiff(
        'hydrated-local:b',
        'plain replacement\n',
        'pending.txt'
      );

      renderer.hydrate(diffA);
      expect(renderer.initializations).toHaveLength(1);
      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffA);

      expect(renderer.renderDiff(diffB)).toBeUndefined();
      expect(renderer.initializations).toHaveLength(2);
      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffA);

      const replacementHighlighter = await getSharedHighlighter({
        themes: ['andromeeda'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      const replacementInitialization = renderer.initializations[1];
      if (replacementInitialization == null) {
        throw new Error('Expected replacement highlighter initialization');
      }
      replacementInitialization.resolve(replacementHighlighter);
      await waitFor(() => expect(renderUpdates).toBe(1));

      expect(renderer.getDiffForNextRender(diffB)).toBe(diffB);
      expect(renderer.diffCache).toBe(diffA);
      const renderedB = renderer.renderDiff(diffB);
      expect(renderedB?.fileDiff).toBe(diffB);
      expect(renderedDiffHtml(renderedB)).toContain('plain replacement');
      expect(renderer.diffCache).toBe(diffB);
    } finally {
      renderer.cleanUp();
    }
  });

  test('keeps a hydrated plain-text diff selected until a local highlighted replacement is ready', async () => {
    let renderUpdates = 0;
    const renderer = new DeferredHighlighterDiffRenderer(
      { theme: 'ayu-dark' },
      undefined,
      () => renderUpdates++
    );
    try {
      const diffA = createWorkerDiff(
        'hydrated-plain:a',
        'plain current\n',
        'current.txt'
      );
      const diffB = createWorkerDiff(
        'hydrated-plain:b',
        'const replacement = 2;\n'
      );

      renderer.hydrate(diffA);
      expect(renderer.initializations).toHaveLength(1);
      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffA);

      expect(renderer.renderDiff(diffB)).toBeUndefined();
      expect(renderer.initializations).toHaveLength(2);
      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffA);

      const replacementHighlighter = await getSharedHighlighter({
        themes: ['ayu-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      const replacementInitialization = renderer.initializations[1];
      if (replacementInitialization == null) {
        throw new Error('Expected replacement highlighter initialization');
      }
      replacementInitialization.resolve(replacementHighlighter);
      await waitFor(() => expect(renderUpdates).toBe(1));

      expect(renderer.getDiffForNextRender(diffB)).toBe(diffB);
      expect(renderer.diffCache).toBe(diffA);
      const renderedB = renderer.renderDiff(diffB);
      expect(renderedB?.fileDiff).toBe(diffB);
      expect(renderedDiffHtml(renderedB)).toContain('replacement');
      expect(renderer.diffCache).toBe(diffB);
    } finally {
      renderer.cleanUp();
    }
  });

  test('keeps the rendered diff active until a local async replacement is promoted', async () => {
    let renderUpdates = 0;
    const renderer = new DeferredHighlighterDiffRenderer(
      { theme: 'pierre-dark' },
      undefined,
      () => renderUpdates++
    );
    try {
      const diffA = createWorkerDiff('local:a', 'const alpha = 1;\n');
      const diffB = createWorkerDiff('local:b', 'const beta = 2;\n');
      const settledA = renderer.renderDiff(diffA);
      expect(settledA?.fileDiff).toBe(diffA);
      expect(renderedDiffHtml(settledA)).toContain('alpha');

      renderer.setOptions({ theme: 'github-dark' });
      const whileBPending = renderer.renderDiff(diffB);
      expect(renderer.initializations).toHaveLength(1);
      expect(whileBPending?.fileDiff).toBe(diffA);
      expect(renderedDiffHtml(whileBPending)).toContain('alpha');
      expect(renderer.diffCache).toBe(diffA);

      const githubHighlighter = await getSharedHighlighter({
        themes: ['github-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      const initialization = renderer.initializations[0];
      if (initialization == null) {
        throw new Error('Expected a pending highlighter initialization');
      }
      initialization.resolve(githubHighlighter);
      await waitFor(() => expect(renderUpdates).toBe(1));

      expect(renderer.diffCache).toBe(diffA);
      expect(renderer.getDiffForNextRender(diffB)).toBe(diffB);
      expect(renderer.diffCache).toBe(diffA);

      const settledB = renderer.renderDiff(diffB);
      expect(settledB?.fileDiff).toBe(diffB);
      expect(renderedDiffHtml(settledB)).toContain('beta');
      expect(renderedDiffHtml(settledB)).not.toContain('alpha');
    } finally {
      renderer.cleanUp();
    }
  });
});

describe('VirtualizedFileDiff worker rendering', () => {
  test('recomputes a pending layout when a replacement highlight completes', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const virtualizer = new Virtualizer();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    let instance: VirtualizedFileDiff<undefined> | undefined;
    const currentDiff = createWorkerDiff(
      'virtualized:current',
      'const current = 1;\n'
    );
    const replacementDiff = createWorkerDiff(
      'virtualized:replacement',
      'const replacement = 2;\n'
    );
    const primeCurrent = manager.primeDiffHighlightCache(currentDiff);

    try {
      const currentRequest = await withTimeout(worker.waitForDiffRequest());
      respondWithHighlightedDiff(manager, worker, currentRequest, currentDiff);
      await withTimeout(primeCurrent);

      const root = createRoot();
      const content = document.createElement('div');
      const fileContainer = document.createElement('div');
      root.appendChild(content);
      content.appendChild(fileContainer);
      virtualizer.setup(root, content);
      instance = new VirtualizedFileDiff<undefined>(
        { theme: 'pierre-dark', disableFileHeader: true },
        virtualizer,
        undefined,
        manager
      );

      expect(instance.render({ fileDiff: currentDiff, fileContainer })).toBe(
        true
      );
      expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain('current');
      dom.triggerIntersectionObserver(fileContainer, true);
      await wait(10);

      // The replacement keeps the highlighted current diff visible, and the
      // following real virtualizer frame records that current diff for layout.
      expect(instance.render({ fileDiff: replacementDiff })).toBe(true);
      expect(fileContainer.shadowRoot?.innerHTML ?? '').not.toContain(
        'replacement'
      );

      await waitFor(() => expect(worker.diffRequestCount).toBe(2));
      const replacementRequest = await withTimeout(worker.waitForDiffRequest());
      await wait(0);
      respondWithHighlightedDiff(
        manager,
        worker,
        replacementRequest,
        replacementDiff
      );
      await waitFor(() =>
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'replacement'
        )
      );
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      instance?.cleanUp();
      virtualizer.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });
});

describe('DiffHunksRenderer edit session', () => {
  test('editing renders the diff locally and ignores a worker result that finishes late', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const externalDiff = parseDiffFromFile(
        {
          name: 'demo.ts',
          contents: 'const value = "old";\n',
          cacheKey: 'd:old',
        },
        {
          name: 'demo.ts',
          contents: 'const value = "new";\n',
          cacheKey: 'd:new',
        }
      );
      const sessionDiff = createKeylessSessionDiff(externalDiff);

      renderer.renderDiff(externalDiff);
      const request = await withTimeout(worker.waitForDiffRequest());
      expect(worker.diffRequestCount).toBe(1);

      renderer.beginEditSession(sessionDiff, externalDiff);
      respondToDiffRequest(manager, worker, request);
      // Refused outright: nothing is applied and nothing is requested — the
      // session render issued at editor attach supplies the highlight.
      await wait(50);
      expect(renderUpdates).toBe(0);

      // The session render stays local and completes the highlight with
      // editor-compatible markup.
      renderer.renderDiff(sessionDiff);
      expect(worker.diffRequestCount).toBe(1);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      const result = renderer.renderDiff(sessionDiff);
      if (result == null) {
        throw new Error('expected a render result');
      }
      const html = toHtml([
        ...(result.unifiedContentAST ?? []),
        ...(result.additionsContentAST ?? []),
        ...(result.deletionsContentAST ?? []),
      ]);
      expect(html).toContain('data-char');
      expect(renderer.diffCache).toBe(sessionDiff);
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(worker.diffRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('refreshing highlights during editing does not request a worker render', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const externalDiff = parseDiffFromFile(
        {
          name: 'demo.ts',
          contents: 'const value = "old";\n',
          cacheKey: 'r:old',
        },
        {
          name: 'demo.ts',
          contents: 'const value = "new";\n',
          cacheKey: 'r:new',
        }
      );
      const sessionDiff = createKeylessSessionDiff(externalDiff);

      renderer.beginEditSession(sessionDiff, externalDiff);
      renderer.renderDiff(sessionDiff);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      expect(worker.diffRequestCount).toBe(0);

      await renderer.refreshHighlightedResult();
      expect(worker.diffRequestCount).toBe(0);
    } finally {
      manager.terminate();
    }
  });

  test('entering edit mode reuses editor-compatible worker markup without modifying its cached copy', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const externalDiff = parseDiffFromFile(
        {
          name: 'cached.ts',
          contents: 'const value = "old";\n',
          cacheKey: 'cached:old',
        },
        {
          name: 'cached.ts',
          contents: 'const value = "new";\n',
          cacheKey: 'cached:new',
        }
      );
      const sessionDiff = createKeylessSessionDiff(externalDiff);

      renderer.renderDiff(externalDiff);
      respondWithHighlightedDiff(
        manager,
        worker,
        await withTimeout(worker.waitForDiffRequest()),
        externalDiff
      );
      await waitFor(() => {
        expect(manager.getDiffResultCache(externalDiff)).toBeDefined();
      });
      const renderedExternal = renderer.renderDiff(externalDiff);
      expect(renderedExternal?.fileDiff).toBe(externalDiff);
      const cachedExternalBefore = manager.getDiffResultCache(externalDiff);
      if (cachedExternalBefore == null) {
        throw new Error('expected a cached external result');
      }
      const cachedExternalSnapshot = structuredClone(cachedExternalBefore);
      const renderUpdatesBeforeSession = renderUpdates;

      renderer.beginEditSession(sessionDiff, externalDiff);
      expect(renderer.editorRenderReady()).toBe(true);
      expect(renderer.diffCache).toBe(sessionDiff);
      expect(renderUpdates).toBe(renderUpdatesBeforeSession);

      renderer.beginEditSession(sessionDiff);
      sessionDiff.additionLines = [...sessionDiff.additionLines];
      renderer.updateRenderCache(
        new Map<number, HighlightedToken[]>([
          [0, [[0, '', 'const edited = true;']]],
        ]),
        'dark'
      );

      const cachedExternalResult = manager.getDiffResultCache(externalDiff);
      expect(cachedExternalResult).toEqual(cachedExternalSnapshot);
      expect(
        toHtml(cachedExternalResult?.result.code.additionLines ?? [])
      ).not.toContain('const edited = true;');
      expect(renderer.diffCache).toBe(sessionDiff);
      expect(sessionDiff.additionLines[0]).toBe('const edited = true;\n');
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(worker.diffRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('entering edit mode does not reuse highlighted markup before it renders', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    let renderUpdates = 0;
    const renderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      () => renderUpdates++,
      manager
    );
    try {
      const externalDiff = createWorkerDiff(
        'pending-edit',
        'const pendingEdit = true;\n'
      );
      const sessionDiff = createKeylessSessionDiff(externalDiff);

      renderer.renderDiff(externalDiff);
      respondWithHighlightedDiff(
        manager,
        worker,
        await withTimeout(worker.waitForDiffRequest()),
        externalDiff
      );
      await waitFor(() => {
        expect(manager.getDiffResultCache(externalDiff)).toBeDefined();
      });

      renderer.beginEditSession(sessionDiff, externalDiff);
      expect(renderer.editorRenderReady()).toBe(false);

      const updatesBeforeSessionRender = renderUpdates;
      renderer.renderDiff(sessionDiff);
      await waitFor(() => {
        expect(renderUpdates).toBeGreaterThan(updatesBeforeSessionRender);
      });
      const result = renderer.renderDiff(sessionDiff);
      expect(renderer.editorRenderReady()).toBe(true);
      expect(result?.fileDiff).toBe(sessionDiff);
      expect(renderedDiffHtml(result)).toContain('data-char');
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('entering edit mode rehighlights settled markup without editor token metadata', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const externalDiff = parseDiffFromFile(
        {
          name: 'incompatible.ts',
          contents: 'const value = "old";\n',
          cacheKey: 'incompatible:old',
        },
        {
          name: 'incompatible.ts',
          contents: 'const value = "new";\n',
          cacheKey: 'incompatible:new',
        }
      );
      const sessionDiff = createKeylessSessionDiff(externalDiff);

      renderer.renderDiff(externalDiff);
      respondToDiffRequest(
        manager,
        worker,
        await withTimeout(worker.waitForDiffRequest())
      );
      await waitFor(() => expect(renderUpdates).toBe(1));

      renderer.beginEditSession(sessionDiff, externalDiff);
      expect(renderer.editorRenderReady()).toBe(false);

      const updatesBeforeSessionHighlight = renderUpdates;
      renderer.renderDiff(sessionDiff);
      await waitFor(() =>
        expect(renderUpdates).toBeGreaterThan(updatesBeforeSessionHighlight)
      );
      const result = renderer.renderDiff(sessionDiff);
      expect(renderer.editorRenderReady()).toBe(true);
      if (result == null) {
        throw new Error('expected an editor-compatible session render');
      }
      const html = toHtml([
        ...(result.unifiedContentAST ?? []),
        ...(result.additionsContentAST ?? []),
        ...(result.deletionsContentAST ?? []),
      ]);

      expect(html).toContain('data-char');
      expect(renderer.diffCache).toBe(sessionDiff);
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(worker.diffRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('entering edit mode does not reuse settled markup from another diff', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        undefined,
        () => renderUpdates++,
        manager
      );
      const renderedExternalDiff = parseDiffFromFile(
        {
          name: 'rendered.ts',
          contents: 'const before = 0;\n',
          cacheKey: 'rendered:old',
        },
        {
          name: 'rendered.ts',
          contents: 'const rendered = 1;\n',
          cacheKey: 'rendered:new',
        }
      );
      const sessionExternalDiff = parseDiffFromFile(
        {
          name: 'session.ts',
          contents: 'const before = 0;\n',
          cacheKey: 'session:old',
        },
        {
          name: 'session.ts',
          contents: 'const session = 2;\n',
          cacheKey: 'session:new',
        }
      );
      const sessionDiff = createKeylessSessionDiff(sessionExternalDiff);

      renderer.renderDiff(renderedExternalDiff);
      respondToDiffRequest(
        manager,
        worker,
        await withTimeout(worker.waitForDiffRequest())
      );
      await waitFor(() => expect(renderUpdates).toBe(1));

      renderer.beginEditSession(sessionDiff, sessionExternalDiff);
      expect(renderer.editorRenderReady()).toBe(false);

      const updatesBeforeSessionHighlight = renderUpdates;
      renderer.renderDiff(sessionDiff);
      await waitFor(() =>
        expect(renderUpdates).toBeGreaterThan(updatesBeforeSessionHighlight)
      );
      const result = renderer.renderDiff(sessionDiff);
      expect(renderer.editorRenderReady()).toBe(true);
      if (result == null) {
        throw new Error('expected an editor-compatible session render');
      }
      const html = toHtml([
        ...(result.unifiedContentAST ?? []),
        ...(result.additionsContentAST ?? []),
        ...(result.deletionsContentAST ?? []),
      ]);

      expect(html).toContain('session');
      expect(html).not.toContain('rendered');
      expect(renderer.diffCache).toBe(sessionDiff);
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(worker.diffRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('an older highlight result cannot overwrite the diff being edited', async () => {
    const renderer = new DeferredHighlighterDiffRenderer({
      theme: 'pierre-dark',
    });
    try {
      // Exercise the renderer's async initialization path without resetting
      // the shared highlighter used by the rest of this file.
      renderer.recycle();
      const externalDiff = parseDiffFromFile(
        {
          name: 'stale.ts',
          contents: 'const value = "old";\n',
        },
        {
          name: 'stale.ts',
          contents: 'const staleResult = true;\n',
        }
      );
      const sessionDiff = createKeylessSessionDiff(externalDiff);

      renderer.renderDiff(externalDiff);
      expect(renderer.initializations).toHaveLength(1);
      renderer.beginEditSession(sessionDiff);
      renderer.renderDiff(sessionDiff);
      expect(renderer.initializations).toHaveLength(2);

      const staleInitialization = renderer.initializations[0];
      const sessionInitialization = renderer.initializations[1];
      if (staleInitialization == null || sessionInitialization == null) {
        throw new Error('expected two pending highlighter initializations');
      }

      sessionInitialization.resolve(sharedHighlighter);
      await wait(0);
      renderer.renderDiff(sessionDiff);
      expect(renderer.diffCache).toBe(sessionDiff);
      expect(renderer.editorRenderReady()).toBe(true);

      sessionDiff.additionLines = [...sessionDiff.additionLines];
      renderer.updateRenderCache(
        new Map<number, HighlightedToken[]>([
          [0, [[0, '', 'const sessionResult = true;']]],
        ]),
        'dark'
      );

      const renderSessionHtml = (): string => {
        const result = renderer.renderDiff(sessionDiff);
        if (result == null) {
          throw new Error('expected a session render result');
        }
        return toHtml([
          ...(result.unifiedContentAST ?? []),
          ...(result.additionsContentAST ?? []),
          ...(result.deletionsContentAST ?? []),
        ]);
      };

      expect(renderSessionHtml()).toContain('sessionResult');

      staleInitialization.resolve(sharedHighlighter);
      await wait(0);

      expect(renderer.diffCache).toBe(sessionDiff);
      expect(renderer.editorRenderReady()).toBe(true);
      expect(renderSessionHtml()).toContain('sessionResult');
      expect(renderSessionHtml()).not.toContain('staleResult');
    } finally {
      renderer.cleanUp();
    }
  });
});

describe('File component edit session', () => {
  test('attaching an editor switches to editor-compatible markup and detaching returns rendering to the worker', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const instance = new File(
        { theme: 'pierre-dark', disableFileHeader: true },
        manager
      );
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const file = createFile('file:component');

      instance.render({ file, fileContainer, forceRender: true });
      const request = await withTimeout(worker.waitForFileRequest());
      expect(worker.fileRequestCount).toBe(1);
      // Resolve the pool highlight before attaching so the session phase
      // starts from settled pool markup and an idle task queue — a session
      // render that leaked to the pool would then show up as request #2.
      respondToFileRequest(
        manager,
        worker,
        request,
        plainFileCode(FILE_CONTENTS)
      );

      const editor = new Editor('file');
      const detach = instance.__attachEditor(editor);
      instance.rerender();
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });
      expect(worker.fileRequestCount).toBe(1);

      // The private session is keyless, so the post-edit worker render cannot
      // reuse the external file's cached result.
      detach();
      instance.rerender();
      expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain('data-char');
      await waitFor(() => expect(worker.fileRequestCount).toBe(2));
      const detachedRequest = await withTimeout(worker.waitForFileRequest());
      respondToFileRequest(
        manager,
        worker,
        detachedRequest,
        plainFileCode(FILE_CONTENTS)
      );
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').not.toContain(
          'data-char'
        );
      });
      instance.cleanUp();
    } finally {
      manager.terminate();
      dom.cleanup();
    }
  });
});

describe('FileDiff component edit session', () => {
  test('attaching an editor renders the diff locally with editor-compatible markup', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const instance = new FileDiff(
        { theme: 'pierre-dark', disableFileHeader: true },
        manager
      );
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const fileDiff = parseDiffFromFile(
        {
          name: 'demo.ts',
          contents: 'const value = "old";\n',
          cacheKey: 'fd:old',
        },
        {
          name: 'demo.ts',
          contents: 'const value = "new";\n',
          cacheKey: 'fd:new',
        }
      );

      instance.render({ fileDiff, fileContainer, forceRender: true });
      await withTimeout(worker.waitForDiffRequest());
      expect(worker.diffRequestCount).toBe(1);

      const editor = new Editor('file-diff');
      instance.__attachEditor(editor);
      instance.rerender();
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });
      instance.cleanUp();
    } finally {
      manager.terminate();
      dom.cleanup();
    }
  });
});

// Renders `file` the way a transformer-configured pool worker would, so
// tests can settle a pool highlight with genuine editor-compatible markup.
async function respondWithRealFileHighlight(
  manager: Awaited<ReturnType<typeof createInitializedManager>>['manager'],
  worker: Awaited<ReturnType<typeof createInitializedManager>>['worker'],
  file: FileContents
): Promise<void> {
  const request = await withTimeout(worker.waitForFileRequest());
  worker.respond({
    type: 'success',
    requestType: 'file',
    id: request.id,
    result: renderFileWithHighlighter(
      file,
      sharedHighlighter,
      manager.getFileRenderOptions()
    ),
    options: manager.getFileRenderOptions(),
    sentAt: Date.now(),
  });
}

describe('rendering when an editor attaches', () => {
  test('reuses an existing editor-compatible worker render for a file', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      let updates = 0;
      const instance = new File(
        {
          theme: 'pierre-dark',
          disableFileHeader: true,
          onPostRender: (_node, _instance, phase) => {
            if (phase === 'update') updates++;
          },
        },
        manager
      );
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const file = createFile('file:entry-ready');

      instance.render({ file, fileContainer, forceRender: true });
      await respondWithRealFileHighlight(manager, worker, file);
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });

      const updatesBefore = updates;
      const lineBefore =
        fileContainer.shadowRoot?.querySelector('[data-line="1"]');
      const detach = instance.__attachEditor(createEditorInstance('file'));
      await wait(50);

      expect(updates).toBe(updatesBefore);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-line="1"]') ===
          lineBefore
      ).toBe(true);
      expect(worker.fileRequestCount).toBe(1);
      detach();
      instance.cleanUp();
    } finally {
      manager.terminate();
      dom.cleanup();
    }
  });

  test('rerenders only the edited file when its worker render is not editor-compatible', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let updates = 0;
      let siblingUpdates = 0;
      const instance = new File(
        {
          theme: 'pierre-dark',
          disableFileHeader: true,
          onPostRender: (_node, _instance, phase) => {
            if (phase === 'update') updates++;
          },
        },
        manager
      );
      const sibling = new File(
        {
          theme: 'pierre-dark',
          disableFileHeader: true,
          onPostRender: (_node, _instance, phase) => {
            if (phase === 'update') siblingUpdates++;
          },
        },
        manager
      );
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const siblingContainer = document.createElement('div');
      siblingContainer.attachShadow({ mode: 'open' });
      const file = createFile('file:entry-plain');
      const siblingFile = createFile('file:entry-sibling');

      instance.render({ file, fileContainer, forceRender: true });
      respondToFileRequest(
        manager,
        worker,
        await withTimeout(worker.waitForFileRequest()),
        plainFileCode(FILE_CONTENTS)
      );
      sibling.render({
        file: siblingFile,
        fileContainer: siblingContainer,
        forceRender: true,
      });
      respondToFileRequest(
        manager,
        worker,
        await withTimeout(worker.waitForFileRequest()),
        plainFileCode(FILE_CONTENTS)
      );
      await wait(50);

      const updatesBefore = updates;
      const siblingUpdatesBefore = siblingUpdates;
      const detach = instance.__attachEditor(createEditorInstance('file'));
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });

      expect(updates - updatesBefore).toBeGreaterThan(0);
      expect(siblingUpdates).toBe(siblingUpdatesBefore);
      expect(siblingContainer.shadowRoot?.innerHTML ?? '').not.toContain(
        'data-char'
      );
      expect(worker.fileRequestCount).toBe(2);
      detach();
      instance.cleanUp();
      sibling.cleanUp();
    } finally {
      manager.terminate();
      dom.cleanup();
    }
  });

  test('renders locally without waiting for a pending worker result and ignores it when it finishes', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      const instance = new File(
        { theme: 'pierre-dark', disableFileHeader: true },
        manager
      );
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const file = createFile('file:entry-inflight');

      instance.render({ file, fileContainer, forceRender: true });
      const request = await withTimeout(worker.waitForFileRequest());

      const detach = instance.__attachEditor(createEditorInstance('file'));
      // The local highlight lands without the pool ever answering. The plain
      // pool AST already carries data-char (transformer-shaped), so only the
      // highlight colors prove the attach-time session render ran.
      await waitFor(() => {
        const html = fileContainer.shadowRoot?.innerHTML ?? '';
        expect(html).toContain('data-char');
        expect(html).toContain('color:');
      });

      // The late pool result is refused silently and replaces nothing.
      respondToFileRequest(manager, worker, request, [
        {
          type: 'element',
          tagName: 'div',
          properties: { 'data-line': 1, 'data-pool-result': '' },
          children: [],
        },
      ]);
      await wait(50);
      expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain('data-char');
      expect(fileContainer.shadowRoot?.innerHTML ?? '').not.toContain(
        'data-pool-result'
      );
      expect(worker.fileRequestCount).toBe(1);
      detach();
      instance.cleanUp();
    } finally {
      manager.terminate();
      dom.cleanup();
    }
  });

  test('entering edit mode reuses an existing editor-compatible render', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    let attaches = 0;
    const editor = new Editor('file-diff', {
      onAttach: () => attaches++,
    });
    try {
      const root = document.createElement('div');
      document.body.appendChild(root);
      let instanceChangedCalls = 0;
      const virtualizer = {
        type: 'simple',
        config: {},
        connect() {},
        disconnect() {},
        getRoot: () => root,
        getWindowSpecs: () => ({ top: 0, bottom: 800 }),
        getOffsetInScrollContainer: () => 0,
        instanceChanged(target: { onRender(dirty: boolean): boolean }) {
          instanceChangedCalls++;
          target.onRender(true);
        },
        isInstanceVisible: () => true,
        markDOMDirty() {},
        requestHeightReconcile() {},
      } as never;
      const instance = new VirtualizedFileDiff<undefined>(
        { theme: 'pierre-dark', disableFileHeader: true },
        virtualizer,
        undefined,
        manager
      );
      const fileContainer = document.createElement('div');
      root.appendChild(fileContainer);
      const fileDiff = parseDiffFromFile(
        {
          name: 'demo.ts',
          contents: 'const value = "old";\n',
          cacheKey: 'vr:old',
        },
        {
          name: 'demo.ts',
          contents: 'const value = "new";\n',
          cacheKey: 'vr:new',
        }
      );

      instance.render({ fileDiff, fileContainer, forceRender: true });
      const request = await withTimeout(worker.waitForDiffRequest());
      // Deliver a genuine transformer-shaped highlight, as a configured
      // pool worker would.
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(
          fileDiff,
          sharedHighlighter,
          manager.getDiffRenderOptions()
        ),
        options: manager.getDiffRenderOptions(),
        sentAt: Date.now(),
      });
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });

      const callsBefore = instanceChangedCalls;
      const contentBefore =
        fileContainer.shadowRoot?.querySelector('[data-content]');
      const lineBefore =
        fileContainer.shadowRoot?.querySelector('[data-line="1"]');
      expect(contentBefore).not.toBeNull();
      expect(lineBefore).not.toBeNull();

      const detach = editor.edit(instance);
      // Compatible transformer markup is retained while its renderer cache is
      // moved onto the private, keyless session model.
      await waitFor(() => expect(attaches).toBe(1));
      await wait(50);

      expect(instanceChangedCalls).toBe(callsBefore);
      expect(fileContainer.shadowRoot?.querySelector('[data-content]')).toBe(
        contentBefore
      );
      expect(fileContainer.shadowRoot?.querySelector('[data-line="1"]')).toBe(
        lineBefore
      );
      expect(editor.getFile()?.cacheKey).toBeUndefined();
      expect(instance.options.useTokenTransformer).toBeUndefined();
      expect(worker.diffRequestCount).toBe(1);
      detach();
      instance.cleanUp();
    } finally {
      editor.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  });

  test('reuses an existing editor-compatible local render', async () => {
    const dom = installDom();
    try {
      let updates = 0;
      const instance = new File({
        theme: 'pierre-dark',
        disableFileHeader: true,
        useTokenTransformer: true,
        onPostRender: (_node, _instance, phase) => {
          if (phase === 'update') updates++;
        },
      });
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const file = createFile('file:nopool-explicit');

      instance.render({ file, fileContainer, forceRender: true });
      await waitFor(() => {
        const html = fileContainer.shadowRoot?.innerHTML ?? '';
        expect(html).toContain('data-char');
        expect(html).toContain('color:');
      });

      const updatesBefore = updates;
      const lineBefore =
        fileContainer.shadowRoot?.querySelector('[data-line="1"]');
      const detach = instance.__attachEditor(createEditorInstance('file'));
      await wait(50);

      expect(updates).toBe(updatesBefore);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-line="1"]') ===
          lineBefore
      ).toBe(true);
      detach();
      instance.cleanUp();
    } finally {
      dom.cleanup();
    }
  });

  // The option snapshots map shouldUseTokenTransformer, so token callbacks
  // alone give a no-pool render its data-char markup — which also means an
  // editor can attach to it without triggering a re-render.
  test('reuses the initial render when token callbacks already made it editor-compatible', async () => {
    const dom = installDom();
    try {
      let updates = 0;
      const instance = new File({
        theme: 'pierre-dark',
        disableFileHeader: true,
        onTokenClick: () => undefined,
        onPostRender: (_node, _instance, phase) => {
          if (phase === 'update') updates++;
        },
      });
      const fileContainer = document.createElement('div');
      fileContainer.attachShadow({ mode: 'open' });
      const file = createFile('file:nopool-callbacks');

      instance.render({ file, fileContainer, forceRender: true });
      await waitFor(() => {
        const html = fileContainer.shadowRoot?.innerHTML ?? '';
        expect(html).toContain('data-char');
        expect(html).toContain('color:');
      });

      const updatesBefore = updates;
      const detach = instance.__attachEditor(createEditorInstance('file'));
      await wait(50);

      expect(updates).toBe(updatesBefore);
      expect(instance.options.useTokenTransformer).toBeUndefined();
      // The diff snapshot applies the same implication.
      expect(
        getDiffHunksRendererOptions({
          theme: 'pierre-dark',
          onTokenClick: () => undefined,
        }).useTokenTransformer
      ).toBe(true);
      detach();
      instance.cleanUp();
    } finally {
      dom.cleanup();
    }
  });
});

describe('local highlighter engine', () => {
  // The shared highlighter keeps the engine selected by its first caller, so
  // a local initialization on a pool-backed surface must consult the pool's
  // configured engine instead of seeding the singleton from component
  // defaults.
  test("file and diff renderers use the worker pool's preferred engine for local highlighting", async () => {
    const { manager } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const preferred = spyOn(manager, 'getPreferredHighlighter');
      const fileRenderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        undefined,
        manager
      );
      await fileRenderer.initializeHighlighter();
      expect(preferred).toHaveBeenCalled();
      fileRenderer.cleanUp();

      preferred.mockClear();
      const diffRenderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        undefined,
        undefined,
        manager
      );
      await diffRenderer.initializeHighlighter();
      expect(preferred).toHaveBeenCalled();
      diffRenderer.cleanUp();
      preferred.mockRestore();
    } finally {
      manager.terminate();
    }
  });
});
