import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { parseDiffFromFile } from '../src';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { DiffsEditor, FileContents } from '../src/types';
import { installDom, wait } from './domHarness';
import {
  createInitializedManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  respondToFileRequest,
  withTimeout,
} from './workerPoolHarness';

// During an edit session (begun at editor attach), File/FileDiff renderers
// stay on the main thread: renders use editor-compatible token-transformer
// markup, no worker requests are issued for the edited surface, and pool
// results that were already in flight are refused. These tests cover that
// behavior at the renderer level plus the component wiring.

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

const FILE_CONTENTS = 'const a = 1;\n\nconst b = 2;\n';

function createFile(cacheKey: string): FileContents {
  return { name: 'demo.ts', contents: FILE_CONTENTS, cacheKey };
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

async function waitFor(
  assertion: () => void,
  timeoutMs = 5_000
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
  test('a session render skips the pool and produces token markup', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:session');

      renderer.renderFile(file);
      await withTimeout(worker.waitForFileRequest());
      expect(worker.fileRequestCount).toBe(1);

      renderer.beginEditSession();
      renderer.renderFile(file);

      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      const result = renderer.renderFile(file);
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

  test('a pool result that lands after attach is dropped', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:late');

      renderer.renderFile(file);
      const request = await withTimeout(worker.waitForFileRequest());

      renderer.beginEditSession();
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
      await wait(50);
      expect(renderUpdates).toBe(0);

      const result = renderer.renderFile(file);
      if (result == null) {
        throw new Error('expected a render result');
      }
      expect(toHtml(result.contentAST)).not.toContain('data-pool-result');
    } finally {
      manager.terminate();
    }
  });

  test('a pool with the transformer enabled cannot bypass the session through its cache', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        () => renderUpdates++,
        manager
      );
      const file = createFile('file:pool-transformer');

      renderer.renderFile(file);
      const request = await withTimeout(worker.waitForFileRequest());

      renderer.beginEditSession();
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
      await wait(50);
      expect(renderUpdates).toBe(0);

      // The session render issued at editor attach stays local: no adoption
      // of the refused result, and the local highlight lands when ready.
      let result = renderer.renderFile(file);
      if (result == null) {
        throw new Error('expected a render result');
      }
      expect(toHtml(result.contentAST)).not.toContain('data-pool-result');

      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      result = renderer.renderFile(file);
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

  test('an in-session hydrate does not preload from the pool', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        manager
      );
      renderer.beginEditSession();
      renderer.hydrate(createFile('file:hydrate'));
      await wait(50);
      expect(worker.fileRequestCount).toBe(0);
    } finally {
      manager.terminate();
    }
  });

  test('a dirty edit session ends without resurrecting pre-edit pool markup', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
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

      renderer.beginEditSession();
      renderer.renderFile(file);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(1));

      // Simulate an editor keystroke: line 0 rewritten, cache marked dirty.
      renderer.updateRenderCache(
        new Map([[0, [[0, '#ffffff', 'const edited = 1;']]]]),
        'dark'
      );

      renderer.endEditSession();
      const result = renderer.renderFile(file);
      if (result == null) {
        throw new Error('expected a render result');
      }
      // Ending the session persists the session text into the file and
      // evicts the stale pool cache instead of adopting pre-edit markup.
      expect(file.contents).toContain('const edited = 1;');
      expect(toHtml(result.contentAST)).toContain('const edited = 1;');
    } finally {
      manager.terminate();
    }
  });

  test('ending the session returns rendering to the pool', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        () => renderUpdates++,
        manager
      );
      renderer.beginEditSession();
      const file = createFile('file:detach');

      renderer.renderFile(file);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      expect(worker.fileRequestCount).toBe(0);

      renderer.endEditSession();
      renderer.renderFile(file);
      await withTimeout(worker.waitForFileRequest());
      expect(worker.fileRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });
});

describe('DiffHunksRenderer edit session', () => {
  test('a session render skips the pool and drops late pool results', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        () => renderUpdates++,
        manager
      );
      const diff = parseDiffFromFile(
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

      renderer.renderDiff(diff);
      const request = await withTimeout(worker.waitForDiffRequest());
      expect(worker.diffRequestCount).toBe(1);

      renderer.beginEditSession();
      respondToDiffRequest(manager, worker, request);
      // Refused outright: nothing is applied and nothing is requested — the
      // session render issued at editor attach supplies the highlight.
      await wait(50);
      expect(renderUpdates).toBe(0);

      // The session render stays local and completes the highlight with
      // editor-compatible markup.
      renderer.renderDiff(diff);
      expect(worker.diffRequestCount).toBe(1);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      const result = renderer.renderDiff(diff);
      if (result == null) {
        throw new Error('expected a render result');
      }
      const html = toHtml([
        ...(result.unifiedContentAST ?? []),
        ...(result.additionsContentAST ?? []),
        ...(result.deletionsContentAST ?? []),
      ]);
      expect(html).toContain('data-char');
      expect(worker.diffRequestCount).toBe(1);
    } finally {
      manager.terminate();
    }
  });

  test('an in-session refresh re-highlights locally instead of through the pool', async () => {
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      let renderUpdates = 0;
      const renderer = new DiffHunksRenderer(
        { theme: 'pierre-dark' },
        () => renderUpdates++,
        manager
      );
      renderer.beginEditSession();
      const diff = parseDiffFromFile(
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

      renderer.renderDiff(diff);
      await waitFor(() => expect(renderUpdates).toBeGreaterThan(0));
      expect(worker.diffRequestCount).toBe(0);

      await renderer.refreshHighlightedResult();
      expect(worker.diffRequestCount).toBe(0);
    } finally {
      manager.terminate();
    }
  });
});

describe('File component edit session', () => {
  test('attaching an editor starts the session; detaching ends it', async () => {
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

      const editorStub = {
        cleanUp: () => undefined,
        __syncRenderView: () => undefined,
        __postponeBgTokenizeToNextFrame: () => undefined,
        __captureFocusForDOMReplacement: () => undefined,
      } as unknown as DiffsEditor<undefined>;
      const detach = instance.attachEditor(editorStub);
      instance.rerender();
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });
      expect(worker.fileRequestCount).toBe(1);

      // With the session over, the next render adopts the pool's cached
      // (non-transformer) result: pool markup replaces the editor markup.
      detach();
      instance.rerender();
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').not.toContain(
          'data-char'
        );
      });
      expect(worker.fileRequestCount).toBe(1);
      instance.cleanUp();
    } finally {
      manager.terminate();
      dom.cleanup();
    }
  });
});

describe('FileDiff component edit session', () => {
  test('an attached editor renders the diff locally with token markup', async () => {
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

      const editorStub = {
        cleanUp: () => undefined,
        __syncRenderView: () => undefined,
        __postponeBgTokenizeToNextFrame: () => undefined,
        __captureFocusForDOMReplacement: () => undefined,
      } as unknown as DiffsEditor<undefined>;
      instance.attachEditor(editorStub);
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
