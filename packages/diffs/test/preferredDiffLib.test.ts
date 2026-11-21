import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot as createReactRoot } from 'react-dom/client';

import { CodeView } from '../src/components/CodeView';
import { FileDiff } from '../src/components/FileDiff';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { MultiFileDiff } from '../src/react/MultiFileDiff';
import { preloadDiffHTML } from '../src/ssr/preloadDiffs';
import { diffLibs } from '../src/utils/diffLibs';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, renderItems, waitFor } from './domHarness';
import {
  applySessionEdits,
  createEditorInstance,
  createTextDocumentFromLines,
  lineEdit,
} from './editorTestUtils';

const oldFile = { name: 'value.ts', contents: 'const value = "before";\n' };
const newFile = { name: 'value.ts', contents: 'const value = "after";\n' };

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
});
afterAll(disposeHighlighter);

for (const preferredDiffLib of [
  undefined,
  'jsdiff',
  '@pierre/patches',
] as const) {
  test(`${preferredDiffLib ?? 'default'} preserves raw change blocks when line matching is disabled`, () => {
    const oldFile = {
      name: 'image.html',
      contents: 'before\n<div>\n  <img />\n</div>\nafter\n',
    };
    const newFile = {
      name: 'image.html',
      contents: 'before\n<img />\nafter\n',
    };
    const parsed = parseDiffFromFile(
      oldFile,
      newFile,
      { preferredDiffLib, disableLineMatching: true, context: 0 },
      true
    );
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].hunkContent).toEqual([
      {
        type: 'change',
        deletions: 3,
        additions: 1,
        deletionLineIndex: 1,
        additionLineIndex: 1,
      },
    ]);
    const matched = parseDiffFromFile(oldFile, newFile, {
      preferredDiffLib,
      context: 0,
    });
    expect(matched.hunks[0].hunkContent).toHaveLength(3);
  });

  test(`${preferredDiffLib ?? 'default'} parses files, renders SSR, and recomputes edits`, async () => {
    const { cleanup } = installDom();
    const selected = diffLibs[preferredDiffLib ?? 'jsdiff'];
    const patch = spyOn(selected, 'createTwoFilesPatch');
    const words = spyOn(selected, 'diffWordsWithSpace');
    const instance = new FileDiff({
      parseDiffOptions: { preferredDiffLib },
      theme: 'pierre-dark',
      disableFileHeader: true,
      useTokenTransformer: true,
    });
    try {
      const parsed = parseDiffFromFile(oldFile, newFile, { preferredDiffLib });
      expect(parsed.hunks[0]?.additionLines).toBe(1);
      expect(patch).toHaveBeenCalledTimes(1);

      const html = await preloadDiffHTML({
        oldFile,
        newFile,
        options: {
          parseDiffOptions: { preferredDiffLib },
          theme: 'pierre-dark',
        },
      });
      expect(html).toContain('data-diff-span');
      expect(patch).toHaveBeenCalledTimes(2);
      expect(words).toHaveBeenCalled();

      const fileContainer = document.createElement('div');
      document.body.appendChild(fileContainer);
      instance.render({ oldFile, newFile, fileContainer });
      await waitFor(
        () => fileContainer.shadowRoot?.querySelector('[data-line]') != null
      );
      expect(patch).toHaveBeenCalledTimes(3);
      const detach = instance.__attachEditor(createEditorInstance('file-diff'));
      const sessionDocument = createTextDocumentFromLines('file-diff', [
        newFile.contents,
      ]);
      patch.mockClear();
      applySessionEdits(instance, sessionDocument, [
        lineEdit(sessionDocument, 0, oldFile.contents.trimEnd()),
      ]);
      detach();
      expect(patch).toHaveBeenCalled();
    } finally {
      instance.cleanUp();
      patch.mockRestore();
      words.mockRestore();
      cleanup();
    }
  });
}

test('parseDiffFromFile falls back to jsdiff when the selected library fails', () => {
  const patch = spyOn(
    diffLibs['@pierre/patches'],
    'createTwoFilesPatch'
  ).mockImplementation(() => {
    throw new Error('out of memory');
  });
  const log = spyOn(console, 'error').mockImplementation(() => {});
  const options = { preferredDiffLib: '@pierre/patches' } as const;
  try {
    const parsed = parseDiffFromFile(oldFile, newFile, options);
    expect(parsed.hunks[0]?.additionLines).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(() => parseDiffFromFile(oldFile, newFile, options, true)).toThrow(
      'out of memory'
    );
  } finally {
    patch.mockRestore();
    log.mockRestore();
  }
});

test('a page that blocks WebAssembly logs once and then uses jsdiff', () => {
  // the check is cached per process, so blocking wasm needs its own process
  const { stdout, stderr, exitCode } = Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `
    Reflect.deleteProperty(globalThis, 'WebAssembly');
    const { computeLineDiffRanges } = await import('./src/utils/computeLineDiffRanges.ts');
    const { parseDiffFromFile } = await import('./src/utils/parseDiffFromFile.ts');
    let errors = 0;
    console.error = () => errors++;
    const oldFile = ${JSON.stringify(oldFile)};
    const newFile = ${JSON.stringify(newFile)};
    const options = { preferredDiffLib: '@pierre/patches' };
    const additions = [1, 2, 3].map(
      () => parseDiffFromFile(oldFile, newFile, options).hunks[0].additionLines
    );
    const ranges = (lib) => computeLineDiffRanges('a b', 'a c', 'word', 1000, lib);
    const sameRanges =
      JSON.stringify(ranges('@pierre/patches')) === JSON.stringify(ranges('jsdiff'));
    const logged = errors;
    let thrown;
    try {
      parseDiffFromFile(oldFile, newFile, options, true);
    } catch (error) {
      thrown = error.name;
    }
    console.log(JSON.stringify({ additions, sameRanges, logged, thrown }));
  `,
    ],
    {
      cwd: new URL('..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  expect(stderr.toString()).toBe('');
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout.toString())).toEqual({
    additions: [1, 1, 1],
    sameRanges: true,
    logged: 1,
    thrown: 'ReferenceError',
  });
});

test('preloadDiffHTML falls back to jsdiff when inline highlights fail', async () => {
  const lib = diffLibs['@pierre/patches'];
  const failure = () => {
    throw new Error('blocked');
  };
  const patch = spyOn(lib, 'createTwoFilesPatch').mockImplementation(failure);
  const chars = spyOn(lib, 'diffChars').mockImplementation(failure);
  const words = spyOn(lib, 'diffWordsWithSpace').mockImplementation(failure);
  const log = spyOn(console, 'error').mockImplementation(() => {});
  const twoLines = (value: string) => ({
    name: 'value.ts',
    contents: `const a = "${value}";\nconst b = "${value}";\n`,
  });
  try {
    for (const [lineDiffType, spy] of [
      ['char', chars],
      ['word', words],
      ['word-alt', words],
      ['word-line', words],
    ] as const) {
      const options = { theme: 'pierre-dark', lineDiffType } as const;
      const expected = await preloadDiffHTML({
        oldFile: twoLines('before'),
        newFile: twoLines('after'),
        options,
      });
      spy.mockClear();
      log.mockClear();
      const html = await preloadDiffHTML({
        oldFile: twoLines('before'),
        newFile: twoLines('after'),
        options: {
          ...options,
          parseDiffOptions: { preferredDiffLib: '@pierre/patches' },
        },
      });
      expect(html).toBe(expected);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(2);
    }
  } finally {
    patch.mockRestore();
    chars.mockRestore();
    words.mockRestore();
    log.mockRestore();
  }
});

test('FileDiff keeps parsed hunks and highlights with a new library', async () => {
  const { cleanup } = installDom();
  const instance = new FileDiff({ theme: 'pierre-dark', lineDiffType: 'char' });
  const patch = spyOn(diffLibs['@pierre/patches'], 'createTwoFilesPatch');
  const chars = spyOn(diffLibs['@pierre/patches'], 'diffChars');
  try {
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    instance.render({ oldFile, newFile, fileContainer });
    instance.setOptions({
      theme: 'pierre-dark',
      lineDiffType: 'char',
      parseDiffOptions: { preferredDiffLib: '@pierre/patches' },
    });
    instance.render({ oldFile, newFile, fileContainer, forceRender: true });
    await waitFor(() => chars.mock.calls.length > 0);
    expect(patch).not.toHaveBeenCalled();
  } finally {
    instance.cleanUp();
    patch.mockRestore();
    chars.mockRestore();
    cleanup();
  }
});

test('CodeView applies backend changes through inherited item options', async () => {
  const { cleanup } = installDom();
  const viewer = new CodeView({ theme: 'pierre-dark', lineDiffType: 'char' });
  const jsdiff = spyOn(diffLibs.jsdiff, 'diffChars');
  const patches = spyOn(diffLibs['@pierre/patches'], 'diffChars');
  try {
    viewer.setup(createRoot());
    await renderItems(viewer, [
      {
        id: 'diff',
        type: 'diff',
        fileDiff: parseDiffFromFile(oldFile, newFile),
      },
    ]);
    await waitFor(() => jsdiff.mock.calls.length > 0);
    expect(patches).not.toHaveBeenCalled();
    viewer.setOptions({
      theme: 'pierre-dark',
      lineDiffType: 'char',
      parseDiffOptions: { preferredDiffLib: '@pierre/patches' },
    });
    viewer.render(true);
    await waitFor(() => patches.mock.calls.length > 0);
    jsdiff.mockClear();
    viewer.setOptions({ theme: 'pierre-dark', lineDiffType: 'char' });
    viewer.render(true);
    await waitFor(() => jsdiff.mock.calls.length > 0);
  } finally {
    viewer.cleanUp();
    jsdiff.mockRestore();
    patches.mockRestore();
    cleanup();
  }
});

test('React file pairs reparse when only the backend option changes', async () => {
  const actEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT'
  );
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { cleanup } = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createReactRoot(container);
  const patch = spyOn(diffLibs['@pierre/patches'], 'createTwoFilesPatch');
  try {
    await act(() => {
      root.render(
        createElement(MultiFileDiff, {
          oldFile,
          newFile,
          options: { theme: 'pierre-dark' },
        })
      );
      return Promise.resolve();
    });
    expect(patch).not.toHaveBeenCalled();
    await act(() => {
      root.render(
        createElement(MultiFileDiff, {
          oldFile,
          newFile,
          options: {
            theme: 'pierre-dark',
            parseDiffOptions: { preferredDiffLib: '@pierre/patches' },
          },
        })
      );
      return Promise.resolve();
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('diffs-container')?.shadowRoot?.textContent
    ).toContain('after');
  } finally {
    await act(() => {
      root.unmount();
      return Promise.resolve();
    });
    if (actEnvironment != null) {
      Object.defineProperty(
        globalThis,
        'IS_REACT_ACT_ENVIRONMENT',
        actEnvironment
      );
    } else {
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
    patch.mockRestore();
    cleanup();
  }
});
