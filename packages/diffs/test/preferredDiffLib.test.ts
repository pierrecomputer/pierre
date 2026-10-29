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
import { createEditorInstance } from './editorTestUtils';

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
  test(`${preferredDiffLib ?? 'default'} parses files, renders SSR, and recomputes edits`, async () => {
    const { cleanup } = installDom();
    const selected = diffLibs[preferredDiffLib ?? 'jsdiff'];
    const patch = spyOn(selected, 'createTwoFilesPatch');
    const words = spyOn(selected, 'diffWordsWithSpace');
    const instance = new FileDiff({
      parseDiffOptions: { preferredDiffLib },
      theme: 'pierre-dark',
      disableFileHeader: true,
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
      patch.mockClear();
      instance.updateRenderCache(
        new Map([[0, [[0, '', oldFile.contents.trimEnd()]]]]),
        'dark'
      );
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

test('FileDiff changes libraries for the same file pair', async () => {
  const { cleanup } = installDom();
  const instance = new FileDiff({ theme: 'pierre-dark', lineDiffType: 'char' });
  const patch = spyOn(diffLibs['@pierre/patches'], 'createTwoFilesPatch');
  const chars = spyOn(diffLibs['@pierre/patches'], 'diffChars');
  try {
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    instance.render({ oldFile, newFile, fileContainer });
    expect(patch).not.toHaveBeenCalled();
    instance.setOptions({
      theme: 'pierre-dark',
      lineDiffType: 'char',
      parseDiffOptions: { preferredDiffLib: '@pierre/patches' },
    });
    instance.render({ oldFile, newFile, fileContainer, forceRender: true });
    await waitFor(() => chars.mock.calls.length > 0);
    expect(patch).toHaveBeenCalledTimes(1);
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
