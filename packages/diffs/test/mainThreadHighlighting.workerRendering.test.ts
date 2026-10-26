import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { UnresolvedFile } from '../src/components/UnresolvedFile';
import { Editor } from '../src/editor/editor';
import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';
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

test('File shares a main-thread highlight with other renderers of its cache key', async () => {
  const { manager, container, cleanup } = await createFixture();
  const first = new File({ theme: 'pierre-dark' }, manager);
  const second = new File({ theme: 'pierre-dark' }, manager);
  const secondContainer = document.createElement('div');
  document.body.appendChild(secondContainer);
  try {
    first.render({ file: smallFile, fileContainer: container });
    expect(manager.getFileResultCache(smallFile)?.options).toEqual(
      manager.getFileRenderOptions()
    );

    // The second renderer adopts the cached result instead of tokenizing.
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
      preferredHighlighter: 'shiki-js',
    });
    const codeToTokens = spyOn(highlighter, 'codeToTokens');
    second.render({ file: { ...smallFile }, fileContainer: secondContainer });
    expect(codeToTokens).not.toHaveBeenCalled();
    codeToTokens.mockRestore();
    expect(isLineHighlighted(secondContainer)).toBe(true);
  } finally {
    first.cleanUp();
    second.cleanUp();
    cleanup();
  }
});

test('Editing one File leaves the cached highlight other renderers use unchanged', async () => {
  const dom = installDom();
  // Token-transformer output lets the edited File adopt the cached result.
  const { manager } = await createInitializedManager(
    { theme: 'pierre-dark', useTokenTransformer: true },
    { mainThreadMaxCharacters: MAIN_THREAD_MAX_CHARACTERS }
  );
  const file: FileContents = {
    name: 'shared.ts',
    contents: 'const alpha = 1;\nconst tail = 2;',
    cacheKey: 'main-thread:edited',
  };
  const viewerContainer = document.createElement('div');
  const editedContainer = document.createElement('div');
  document.body.append(viewerContainer, editedContainer);
  const viewer = new File({ theme: 'pierre-dark' }, manager);
  const edited = new File({ theme: 'pierre-dark' }, manager);
  const getCachedLineNumbers = () =>
    manager
      .getFileResultCache(file)
      ?.result.code.map((line) =>
        line.type === 'element' ? line.properties['data-line'] : undefined
      );
  try {
    viewer.render({ file, fileContainer: viewerContainer });
    edited.render({ file, fileContainer: editedContainer });
    edited.__attachEditor(new Editor('file'));
    // A document change without tokenizer rows keeps every shifted row, as a
    // programmatic edit to an offscreen editor does.
    edited.applyDocumentChange(
      new TextDocument(
        'inmemory://edited',
        `const inserted = 0;\n${file.contents}`
      )
    );

    expect(getCachedLineNumbers()).toEqual([1, 2]);
    viewer.render({ file, fileContainer: viewerContainer, forceRender: true });
    expect(
      viewerContainer.shadowRoot?.querySelector('[data-line="1"]')?.textContent
    ).toBe('const alpha = 1;');
  } finally {
    viewer.cleanUp();
    edited.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});

test('File shares a main-thread highlight that waited for its language', async () => {
  const { manager, container, cleanup } = await createFixture();
  const instance = new File({ theme: 'pierre-dark' }, manager);
  // No other test loads Rust, so this render highlights asynchronously.
  const file: FileContents = {
    name: 'main.rs',
    contents: 'fn main() {}\n',
    cacheKey: 'main-thread:rust',
  };
  try {
    instance.render({ file, fileContainer: container });
    expect(manager.getFileResultCache(file)).toBeUndefined();

    await waitFor(() => manager.getFileResultCache(file) != null);
    expect(manager.getFileResultCache(file)?.options).toEqual(
      manager.getFileRenderOptions()
    );
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

test('Renderers drop async highlights that finish after the pool terminates', async () => {
  const dom = installDom();
  const { manager } = await createInitializedManager(
    { theme: 'pierre-dark' },
    { mainThreadMaxCharacters: MAIN_THREAD_MAX_CHARACTERS }
  );
  let renderUpdates = 0;
  const onRenderUpdate = () => {
    renderUpdates++;
  };
  // No other test loads Go or Ruby, so both renders wait for their grammar.
  const file: FileContents = {
    name: 'late.go',
    contents: 'package main\n',
    cacheKey: 'main-thread:late-file',
  };
  const fileDiff = parseDiffFromFile(
    { name: 'late.rb', contents: 'value = []\n', cacheKey: 'late:old' },
    { name: 'late.rb', contents: 'value = [1, 2]\n', cacheKey: 'late:new' }
  );
  const fileRenderer = new FileRenderer(
    { theme: 'pierre-dark' },
    undefined,
    onRenderUpdate,
    manager
  );
  const diffRenderer = new DiffHunksRenderer(
    { theme: 'pierre-dark' },
    undefined,
    onRenderUpdate,
    manager
  );
  try {
    fileRenderer.renderFile(file);
    diffRenderer.renderDiff(fileDiff);
    manager.terminate();
    await waitFor(() => renderUpdates === 2);

    expect(manager.getFileResultCache(file)).toBeUndefined();
    expect(manager.getDiffResultCache(fileDiff)).toBeUndefined();
  } finally {
    fileRenderer.cleanUp();
    diffRenderer.cleanUp();
    dom.cleanup();
  }
});

test('DiffHunksRenderer ignores a refresh canceled by a render options change', async () => {
  const dom = installDom();
  // Start from a Shiki highlighter without Lua, so the refresh's prime has to
  // wait for the grammar however earlier tests left the shared highlighter.
  await recreateHighlighter();
  const { manager } = await createInitializedManager(
    { theme: 'pierre-dark' },
    { mainThreadMaxCharacters: MAIN_THREAD_MAX_CHARACTERS }
  );
  const consoleError = spyOn(console, 'error');
  const fileDiff = parseDiffFromFile(
    {
      name: 'refresh.lua',
      contents: 'local value = 1\n',
      cacheKey: 'refresh:old',
    },
    {
      name: 'refresh.lua',
      contents: 'local value = 2\n',
      cacheKey: 'refresh:new',
    }
  );
  const renderer = new DiffHunksRenderer(
    { theme: 'pierre-dark' },
    undefined,
    undefined,
    manager
  );
  try {
    renderer.renderDiff(fileDiff);
    const refresh = renderer.refreshHighlightedResult();
    // The workers never acknowledge new options in this harness.
    void manager.setRenderOptions({ tokenizeMaxLineLength: 500 });
    await refresh;

    expect(consoleError).not.toHaveBeenCalled();
  } finally {
    consoleError.mockRestore();
    renderer.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});

test('FileDiff shares a main-thread highlight with the pool cache', async () => {
  const { manager, container, cleanup } = await createFixture();
  const instance = new FileDiff({ theme: 'pierre-dark' }, manager);
  const fileDiff = parseDiffFromFile(
    { ...smallFile, cacheKey: 'main-thread:shared-old' },
    {
      ...smallFile,
      contents: 'const alpha = 10;\nconst beta = 2;\n',
      cacheKey: 'main-thread:shared-new',
    }
  );
  try {
    instance.render({ fileDiff, fileContainer: container });

    expect(manager.getDiffResultCache(fileDiff)?.options).toEqual(
      manager.getDiffRenderOptions()
    );
  } finally {
    instance.cleanUp();
    cleanup();
  }
});

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
