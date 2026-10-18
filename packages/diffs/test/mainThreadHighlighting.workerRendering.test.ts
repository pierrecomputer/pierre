import { afterAll, beforeAll, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { UnresolvedFile } from '../src/components/UnresolvedFile';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait } from './domHarness';
import { createInitializedManager } from './workerPoolHarness';

// Files and diffs below this many characters highlight on the main thread.
const MAIN_THREAD_MAX_CHARACTERS = 200;

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

const smallFile: FileContents = {
  name: 'small.ts',
  contents: 'const alpha = 1;\nconst beta = 2;\n',
  cacheKey: 'main-thread:small',
};

async function createFixture() {
  const dom = installDom();
  const { manager, worker } = await createInitializedManager(
    { theme: 'pierre-dark' },
    { mainThreadMaxCharacters: MAIN_THREAD_MAX_CHARACTERS }
  );
  const container = document.createElement('div');
  document.body.appendChild(container);
  return {
    manager,
    worker,
    container,
    cleanup() {
      manager.terminate();
      dom.cleanup();
    },
  };
}

// Plain text renders each line as a single token, so more than one child
// means the row was syntax highlighted.
function isLineHighlighted(container: HTMLElement): boolean {
  const line = container.shadowRoot?.querySelector('[data-line="1"]');
  return line != null && line.children.length > 1;
}

test('File highlights a file within the threshold on its first render', async () => {
  const { manager, worker, container, cleanup } = await createFixture();
  const instance = new File(
    { disableErrorHandling: true, theme: 'pierre-dark' },
    manager
  );
  try {
    instance.render({ file: smallFile, fileContainer: container });

    expect(isLineHighlighted(container)).toBe(true);
    await wait();
    expect(worker.fileRequestCount).toBe(0);
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

// Recreates the shared highlighter, leaving renderers holding a disposed one.
async function recreateHighlighter(): Promise<void> {
  await disposeHighlighter();
  await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
}

// Annotation rows live in the shadow DOM and their content in the light DOM;
// both must describe the same rendered content.
function getAnnotationSlots(container: HTMLElement) {
  return {
    rows: Array.from(
      container.shadowRoot?.querySelectorAll('slot[name^="annotation-"]') ?? [],
      (slot) => slot.getAttribute('name')
    ),
    content: Array.from(
      container.querySelectorAll('[slot^="annotation-"]'),
      (element) => element.getAttribute('slot')
    ),
  };
}

function renderAnnotation(annotation: { metadata: string }): HTMLElement {
  const element = document.createElement('span');
  element.textContent = annotation.metadata;
  return element;
}

test('File keeps annotations with the rendered file after the highlighter is recreated', async () => {
  const { manager, container, cleanup } = await createFixture();
  const instance = new File<string>(
    { disableErrorHandling: true, theme: 'pierre-dark', renderAnnotation },
    manager
  );
  try {
    instance.render({
      file: {
        name: 'a.ts',
        contents: 'const alpha = 1;\nconst two = 2;\n',
        cacheKey: 'recreated:a',
      },
      fileContainer: container,
      lineAnnotations: [{ lineNumber: 1, metadata: 'A' }],
    });
    await recreateHighlighter();
    instance.render({
      file: {
        name: 'b.ts',
        contents: 'const beta = 2;\nconst other = 3;\n',
        cacheKey: 'recreated:b',
      },
      fileContainer: container,
      lineAnnotations: [{ lineNumber: 2, metadata: 'B' }],
    });
    await wait();

    expect(getAnnotationSlots(container)).toEqual({
      rows: ['annotation-2'],
      content: ['annotation-2'],
    });
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

test('FileDiff keeps annotations with the rendered diff after the highlighter is recreated', async () => {
  const { manager, container, cleanup } = await createFixture();
  const instance = new FileDiff<string>(
    { disableErrorHandling: true, theme: 'pierre-dark', renderAnnotation },
    manager
  );
  const createDiff = (cacheKey: string, contents: string) =>
    parseDiffFromFile(
      { name: 'a.ts', contents: 'const old = 0;\n', cacheKey: 'recreated:old' },
      { name: 'a.ts', contents, cacheKey }
    );
  try {
    instance.render({
      fileDiff: createDiff(
        'recreated:diff-a',
        'const alpha = 1;\nconst two = 2;\n'
      ),
      fileContainer: container,
      lineAnnotations: [{ side: 'additions', lineNumber: 1, metadata: 'A' }],
    });
    await recreateHighlighter();
    instance.render({
      fileDiff: createDiff(
        'recreated:diff-b',
        'const beta = 2;\nconst other = 3;\n'
      ),
      fileContainer: container,
      lineAnnotations: [{ side: 'additions', lineNumber: 2, metadata: 'B' }],
    });
    await wait();

    expect(getAnnotationSlots(container)).toEqual({
      rows: ['annotation-additions-2'],
      content: ['annotation-additions-2'],
    });
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

test('File primes a file within the threshold synchronously', async () => {
  const { manager, worker, cleanup } = await createFixture();
  const instance = new File({ theme: 'pierre-dark' }, manager);
  try {
    const prime = instance.primeHighlightCache(smallFile);
    expect(manager.getFileResultCache(smallFile)?.options).toEqual(
      manager.getFileRenderOptions()
    );
    await prime;
    expect(worker.fileRequestCount).toBe(0);
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

test('File primes a file within the threshold after loading its language', async () => {
  const { manager, worker, cleanup } = await createFixture();
  const instance = new File({ theme: 'pierre-dark' }, manager);
  // The shared highlighter has not loaded Python yet.
  const file: FileContents = {
    name: 'prime.py',
    contents: 'value = [1, 2]\n',
    cacheKey: 'main-thread:python',
  };
  try {
    const prime = instance.primeHighlightCache(file);
    expect(manager.getFileResultCache(file)).toBeUndefined();
    await prime;
    expect(manager.getFileResultCache(file)?.options).toEqual(
      manager.getFileRenderOptions()
    );
    expect(worker.fileRequestCount).toBe(0);
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

test('FileDiff primes a diff within the threshold synchronously', async () => {
  const { manager, worker, cleanup } = await createFixture();
  const instance = new FileDiff({ theme: 'pierre-dark' }, manager);
  const fileDiff = parseDiffFromFile(
    { ...smallFile, cacheKey: 'main-thread:old' },
    {
      ...smallFile,
      contents: 'const alpha = 10;\nconst beta = 2;\n',
      cacheKey: 'main-thread:new',
    }
  );
  try {
    const prime = instance.primeHighlightCache(fileDiff);
    expect(manager.getDiffResultCache(fileDiff)?.options).toEqual(
      manager.getDiffRenderOptions()
    );
    await prime;
    expect(worker.diffRequestCount).toBe(0);
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

test('UnresolvedFile re-renders a resolved conflict highlighted on the main thread', async () => {
  const { manager, worker, container, cleanup } = await createFixture();
  const instance = new UnresolvedFile(
    { disableErrorHandling: true, theme: 'pierre-dark' },
    manager
  );
  const markerCount = () =>
    container.shadowRoot?.querySelectorAll('[data-merge-conflict-marker-row]')
      .length ?? 0;
  try {
    instance.render({
      file: {
        name: 'conflict.ts',
        contents: [
          'const start = true;',
          '<<<<<<< HEAD',
          'const ttl = 12;',
          '=======',
          'const ttl = 24;',
          '>>>>>>> feature',
          '',
        ].join('\n'),
      },
      fileContainer: container,
    });
    expect(markerCount()).toBeGreaterThan(0);

    // No worker callback follows a main-thread highlight, so resolving the
    // conflict must render the resolved diff itself.
    container.shadowRoot
      ?.querySelector('button[data-merge-conflict-action="current"]')
      ?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, composed: true })
      );
    expect(markerCount()).toBe(0);
    expect(isLineHighlighted(container)).toBe(true);
    await wait();
    expect(worker.diffRequestCount).toBe(0);
  } finally {
    instance.cleanUp();
    cleanup();
  }
});
