import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { parseDiffFromFile } from '../src';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { DiffsEditor, FileContents } from '../src/types';
import { getDiffHunksRendererOptions } from '../src/utils/getDiffHunksRendererOptions';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
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

function createEditorStub(): DiffsEditor<undefined> {
  return {
    cleanUp: () => undefined,
    __syncRenderView: () => undefined,
    __postponeBgTokenizeToNextFrame: () => undefined,
    __captureFocusForDOMReplacement: () => undefined,
  } as unknown as DiffsEditor<undefined>;
}

// Renders `file` the way a transformer-configured pool worker would, so
// tests can settle a pool highlight with genuine editor-compatible markup.
async function respondWithRealFileHighlight(
  manager: Awaited<ReturnType<typeof createInitializedManager>>['manager'],
  worker: Awaited<ReturnType<typeof createInitializedManager>>['worker'],
  file: FileContents
): Promise<void> {
  const request = await withTimeout(worker.waitForFileRequest());
  const highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
  worker.respond({
    type: 'success',
    requestType: 'file',
    id: request.id,
    result: renderFileWithHighlighter(
      file,
      highlighter,
      manager.getFileRenderOptions()
    ),
    options: manager.getFileRenderOptions(),
    sentAt: Date.now(),
  });
}

describe('editor attach entry', () => {
  test('attaching to a settled transformer-pool render needs no re-render', async () => {
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
      const detach = instance.attachEditor(createEditorStub());
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

  test('a non-transformer pool render gets one session render at attach; siblings untouched', async () => {
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
      const detach = instance.attachEditor(createEditorStub());
      await waitFor(() => {
        expect(fileContainer.shadowRoot?.innerHTML ?? '').toContain(
          'data-char'
        );
      });

      // One session render at attach plus its async highlight completion.
      expect(updates - updatesBefore).toBe(2);
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

  test('attaching while the pool highlight is in flight starts the local highlight immediately', async () => {
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

      const detach = instance.attachEditor(createEditorStub());
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

  test('first edit of a settled virtualized diff replaces nothing (playground repro)', async () => {
    const dom = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
      useTokenTransformer: true,
    });
    let attaches = 0;
    const editor = new Editor<undefined>({ onAttach: () => attaches++ });
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
      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(
          fileDiff,
          highlighter,
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

      const contentBefore =
        fileContainer.shadowRoot?.querySelector('[data-content]');
      const lineBefore =
        fileContainer.shadowRoot?.querySelector('[data-line="1"]');
      const callsBefore = instanceChangedCalls;

      const detach = editor.edit(instance);
      // The zero-render path must still deliver a working attachment.
      await waitFor(() => expect(attaches).toBe(1));

      expect(instanceChangedCalls).toBe(callsBefore);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-content]') ===
          contentBefore
      ).toBe(true);
      expect(
        fileContainer.shadowRoot?.querySelector('[data-line="1"]') ===
          lineBefore
      ).toBe(true);
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

  test('a settled no-pool transformer render attaches with zero re-renders', async () => {
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
      const detach = instance.attachEditor(createEditorStub());
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
  test('token callbacks alone produce data-char markup, so an editor attaches without re-rendering', async () => {
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
      const detach = instance.attachEditor(createEditorStub());
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
  test('local highlighter initialization consults the pool engine preference', async () => {
    const { manager } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const preferred = spyOn(manager, 'getPreferredHighlighter');
      const fileRenderer = new FileRenderer(
        { theme: 'pierre-dark' },
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
