import { afterAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import { CodeView } from '../src/components/CodeView';
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
import { assertDefined } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

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
  test('hydrates the caller fileDiff in place when consuming the staged clone', async () => {
    const { cleanup } = installDom();
    const { oldFile, newFile, partial } = createPartialChange();
    const loadedContents = { oldFile, newFile };
    const deferred = createDeferred<typeof loadedContents>();
    const item: CodeViewItem = {
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
