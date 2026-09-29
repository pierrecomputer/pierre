import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  CodeViewItem,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';
import { assertDefined, createDeferred } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

function createPartialChange(): {
  oldFile: FileContents;
  newFile: FileContents;
  partial: FileDiffMetadata;
} {
  const oldFile: FileContents = {
    name: 'partial.ts',
    contents: 'keep 1\nold value\nkeep 3\nkeep 4\n',
    cacheKey: 'partial:old',
  };
  const newFile: FileContents = {
    name: oldFile.name,
    contents: 'keep 1\nnew value\nkeep 3\nkeep 4\n',
    cacheKey: 'partial:new',
  };
  const partial = parsePatchFiles(
    createTwoFilesPatch(
      oldFile.name,
      newFile.name,
      oldFile.contents,
      newFile.contents,
      undefined,
      undefined,
      { context: 0 }
    ),
    'partial',
    true
  )[0]?.files[0];
  assertDefined(partial, 'expected patch to contain one partial diff');
  expect(partial.isPartial).toBe(true);
  return { oldFile, newFile, partial };
}

describe('CodeView partial hydration', () => {
  for (const teardown of ['remove', 'reset'] as const) {
    test(`${teardown} fully cleans an edit item while its files load`, async () => {
      const { cleanup } = installDom();
      const { oldFile, newFile, partial } = createPartialChange();
      const deferred = createDeferred<{
        oldFile: FileContents;
        newFile: FileContents;
      }>();
      const item: CodeViewItem<undefined> = {
        id: 'diff:partial.ts',
        type: 'diff',
        fileDiff: partial,
        edit: true,
      };
      const viewer = new CodeView({
        createEditor: (type, options) => new Editor(type, options),
        loadDiffFiles: () => deferred.promise,
      });
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);
        const renderedItem = viewer.getRenderedItems()[0];
        assertDefined(renderedItem, 'expected partial diff to render');
        if (renderedItem.type !== 'diff') {
          throw new Error('expected a diff item');
        }
        expect(viewer.getEditor(item.id)).toBeUndefined();

        if (teardown === 'remove') {
          viewer.removeItem(item.id);
        } else {
          viewer.reset();
        }
        expect(renderedItem.instance.fileDiff).toBeUndefined();
        expect(viewer.getItem(item.id)).toBeUndefined();

        deferred.resolve({ oldFile, newFile });
        await wait(0);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(renderedItem.instance.fileDiff).toBeUndefined();
      } finally {
        errorSpy.mockRestore();
        viewer.cleanUp();
        cleanup();
      }
    });
  }

  test('reset fully cleans a read-only file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        {
          id: 'file:read-only.ts',
          type: 'file',
          file: { name: 'read-only.ts', contents: 'const value = 1;\n' },
        },
      ]);
      const renderedItem = viewer.getRenderedItems()[0];
      assertDefined(renderedItem, 'expected file to render');
      if (renderedItem.type !== 'file') {
        throw new Error('expected a file item');
      }

      viewer.reset();
      expect(renderedItem.instance.file).toBeUndefined();
    } finally {
      viewer.cleanUp();
      cleanup();
    }
  });

  test('hydrates the caller fileDiff in place when consuming the staged clone', async () => {
    const { cleanup } = installDom();
    const { oldFile, newFile, partial } = createPartialChange();
    const loadedContents = { oldFile, newFile };
    const deferred = createDeferred<typeof loadedContents>();
    const item: CodeViewItem<undefined> = {
      id: 'diff:partial.ts',
      type: 'diff',
      fileDiff: partial,
    };
    const viewer = new CodeView({
      disableFileHeader: true,
      loadDiffFiles(fileDiff) {
        expect(fileDiff).toBe(partial);
        return deferred.promise;
      },
    });

    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      await waitFor(() => viewer.getRenderedItems().length === 1);

      const renderedItem = viewer.getRenderedItems()[0];
      assertDefined(renderedItem, 'expected partial diff to render');
      if (renderedItem.type !== 'diff') {
        throw new Error('expected a rendered diff item');
      }
      renderedItem.instance.expandHunk(0, 'down', 1);

      expect(partial.isPartial).toBe(true);
      deferred.resolve(loadedContents);
      await waitFor(() => {
        const currentItem = viewer.getItem(item.id);
        return (
          currentItem?.type === 'diff' &&
          currentItem.fileDiff.isPartial === false
        );
      });

      const hydratedItem = viewer.getItem(item.id);
      expect(hydratedItem).toBe(item);
      if (hydratedItem?.type !== 'diff') {
        throw new Error('expected a hydrated diff item');
      }
      expect(hydratedItem.fileDiff).toBe(partial);
      expect(renderedItem.instance.fileDiff).toBe(partial);
      expect(partial.isPartial).toBe(false);
      expect(partial.deletionLines).toEqual([
        'keep 1\n',
        'old value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
      expect(partial.additionLines).toEqual([
        'keep 1\n',
        'new value\n',
        'keep 3\n',
        'keep 4\n',
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
