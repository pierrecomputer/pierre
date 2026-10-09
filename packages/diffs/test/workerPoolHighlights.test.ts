import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createInitializedManager,
  createInitializingManager,
  installAnimationFramePolyfill,
  respondToDiffRequest,
  respondToFileRequest,
  withTimeout,
} from './workerPoolHarness';

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});

// Each test loads its backend fresh: only one highlighter type can be loaded.
beforeEach(disposeHighlighter);

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

const oldFile: FileContents = {
  name: 'pool.ts',
  contents: 'const answer = 42;\nexport default function read() {}\n',
  cacheKey: 'pool:old',
};
const newFile: FileContents = {
  name: 'pool.ts',
  contents: 'const answer = 43;\nexport default function read() {}\n',
  cacheKey: 'pool:new',
};
// Mark worker results so tests can distinguish them from main-thread renders.
const poolMarker: ElementContent[] = oldFile.contents
  .split('\n')
  .map((_, index) => ({
    type: 'element',
    tagName: 'div',
    properties: { 'data-line': index + 1, 'data-pool-result': '' },
    children: [],
  }));

describe('a Highlights worker pool', () => {
  test('initializes its workers with the Highlights backend', async () => {
    const { initialization, manager, worker } = createInitializingManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    try {
      const request = await withTimeout(worker.waitForInitializeRequest());
      expect(request.preferredHighlighter).toBe('highlights');
      expect(request.resolvedLanguages).toEqual([]);
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: request.id,
        sentAt: Date.now(),
      });
      await withTimeout(initialization);
      expect(manager.isWorkingPool()).toBe(true);
    } finally {
      manager.terminate();
    }
  });

  test('renders files through its workers and applies their results', async () => {
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    let updated = 0;
    const renderer = new FileRenderer(
      { theme: 'pierre-dark' },
      undefined,
      () => {
        updated++;
      },
      manager
    );
    try {
      renderer.renderFile(oldFile);
      const request = await withTimeout(worker.waitForFileRequest());
      expect(request.file.contents).toBe(oldFile.contents);
      respondToFileRequest(manager, worker, request, poolMarker);
      await Bun.sleep(0);
      expect(updated).toBeGreaterThan(0);
      const result = renderer.renderFile(oldFile);
      if (result == null) throw new Error('expected a file render');
      expect(toHtml(result.contentAST)).toContain('data-pool-result');
      expect(worker.fileRequestCount).toBe(1);
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('renders diffs through its workers and caches their results', async () => {
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    const renderer = new DiffHunksRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    const diff = parseDiffFromFile(oldFile, newFile);
    try {
      renderer.renderDiff(diff);
      const request = await withTimeout(worker.waitForDiffRequest());
      respondToDiffRequest(manager, worker, request);
      await Bun.sleep(0);
      expect(worker.diffRequestCount).toBe(1);
      expect(manager.getDiffResultCache(diff)).toBeDefined();
    } finally {
      renderer.cleanUp();
      manager.terminate();
    }
  });

  test('primes the file cache through its workers', async () => {
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    try {
      const prime = manager.primeFileHighlightCache(oldFile);
      const request = await withTimeout(worker.waitForFileRequest());
      respondToFileRequest(manager, worker, request, poolMarker);
      await withTimeout(prime);
      expect(manager.getFileResultCache(oldFile)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('loads theme changes into a Shiki main-thread highlighter in its own format', async () => {
    const shared = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['text'],
      preferredHighlighter: 'shiki-js',
    });
    const { manager, worker } = await createInitializedManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    try {
      const update = manager.setRenderOptions({ theme: 'pierre-light' });
      const request = await withTimeout(
        worker.waitForSetRenderOptionsRequest()
      );
      expect(request.resolvedThemes.map((theme) => theme.zed != null)).toEqual([
        true,
      ]);
      worker.respond({
        type: 'success',
        requestType: 'set-render-options',
        id: request.id,
        sentAt: Date.now(),
      });
      await withTimeout(update);
      expect(shared.getTheme('pierre-light').textmate).toBeDefined();
      expect(shared.getTheme('pierre-light').zed).toBeUndefined();
      expect(manager.getPlainFileAST(oldFile, 0, Infinity)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('reloads the main-thread highlighter after disposeHighlighter', async () => {
    const { manager } = await createInitializedManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    const diff = parseDiffFromFile(oldFile, newFile);
    try {
      expect(manager.getPlainFileAST(oldFile, 0, Infinity)).toBeDefined();
      await disposeHighlighter();
      expect(manager.getPlainFileAST(oldFile, 0, Infinity)).toBeUndefined();
      expect(manager.getPlainDiffAST(diff, 0, Infinity)).toBeUndefined();
      await withTimeout(manager.initialize());
      expect(manager.getPlainFileAST(oldFile, 0, Infinity)).toBeDefined();
      expect(manager.getPlainDiffAST(diff, 0, Infinity)).toBeDefined();
    } finally {
      manager.terminate();
    }
  });

  test('stays usable when disposeHighlighter runs during startup', async () => {
    const { initialization, manager, worker } = createInitializingManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    try {
      const request = await withTimeout(worker.waitForInitializeRequest());
      await disposeHighlighter();
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: request.id,
        sentAt: Date.now(),
      });
      await withTimeout(initialization);
      expect(manager.isWorkingPool()).toBe(true);
      expect(manager.isInitialized()).toBe(true);
    } finally {
      manager.terminate();
    }
  });

  test('falls back to main-thread Highlights when the pool fails', async () => {
    const logError = spyOn(console, 'error').mockImplementation(() => {});
    const { initialization, manager, worker } = createInitializingManager({
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
    });
    const renderer = new FileRenderer(
      { theme: 'pierre-dark' },
      undefined,
      undefined,
      manager
    );
    try {
      await withTimeout(worker.waitForInitializeRequest());
      worker.emitError(new Error('worker failed to load'));
      await initialization.catch(() => undefined);
      expect(manager.isWorkingPool()).toBe(false);

      const highlighter = await renderer.initializeHighlighter();
      expect(highlighter.name).toBe('highlights');
      const result = renderer.renderFile(oldFile);
      if (result == null) throw new Error('expected a file render');
      expect(toHtml(result.contentAST)).toContain('color:');
      expect(worker.fileRequestCount).toBe(0);
    } finally {
      logError.mockRestore();
      renderer.cleanUp();
      manager.terminate();
    }
  });
});
