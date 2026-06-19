import { afterAll, describe, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';

import { CodeView } from '../src/components/CodeView';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  CodeViewDiffItem,
  CodeViewItem,
  FileContents,
} from '../src/types';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { createRoot, installDom, renderItems, wait } from './domHarness';
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

function createPartialChange(name = 'partial.txt'): {
  oldFile: FileContents;
  newFile: FileContents;
  partialItem: CodeViewDiffItem<undefined>;
} {
  const oldFile: FileContents = {
    name,
    contents: ['keep 1\n', 'old value\n', 'keep 3\n', 'keep 4\n'].join(''),
    cacheKey: `${name}:old`,
  };
  const newFile: FileContents = {
    name,
    contents: ['keep 1\n', 'new value\n', 'keep 3\n', 'keep 4\n'].join(''),
    cacheKey: `${name}:new`,
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
  assertDefined(partial, 'expected patch to contain one file');
  expect(partial.isPartial).toBe(true);

  return {
    oldFile,
    newFile,
    partialItem: {
      id: 'diff:partial',
      type: 'diff',
      fileDiff: partial,
    },
  };
}

function expectDiffItem(
  item: CodeViewItem<undefined> | undefined
): CodeViewDiffItem<undefined> {
  assertDefined(item, 'expected CodeView item to exist');
  expect(item.type).toBe('diff');
  return item as CodeViewDiffItem<undefined>;
}

async function waitForCodeViewHydrated(
  viewer: CodeView<undefined>,
  itemId: string
): Promise<CodeViewDiffItem<undefined>> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const item = expectDiffItem(viewer.getItem(itemId));
    if (item.fileDiff.isPartial === false) {
      return item;
    }
    await wait(10);
  }
  throw new Error('Timed out waiting for CodeView partial diff hydration');
}

describe('CodeView partial hydration', () => {
  test('updates the owned diff item before rerendering hydrated partial diffs', async () => {
    const { cleanup } = installDom();
    const root = createRoot();
    const { oldFile, newFile, partialItem } = createPartialChange();
    const initialPartialFileDiff = partialItem.fileDiff;
    const loadedContents = { oldFile, newFile };
    const deferred = createDeferred<typeof loadedContents>();
    let loadCalls = 0;
    const viewer = new CodeView<undefined>({
      disableErrorHandling: true,
      disableFileHeader: true,
      loadDiffFiles: (fileDiff) => {
        loadCalls++;
        expect(fileDiff).toBe(initialPartialFileDiff);
        return deferred.promise;
      },
    });

    try {
      viewer.setup(root);
      await renderItems(viewer, [partialItem]);

      const renderedItem = viewer.getRenderedItems()[0];
      assertDefined(renderedItem, 'expected rendered CodeView item');
      if (renderedItem.type !== 'diff') {
        throw new Error('expected rendered CodeView item to be a diff');
      }
      const diffInstance = renderedItem.instance;
      diffInstance.expandHunk(0, 'down', 1);

      expect(loadCalls).toBe(1);
      expect(expectDiffItem(viewer.getItem(partialItem.id)).fileDiff).toBe(
        initialPartialFileDiff
      );

      deferred.resolve(loadedContents);
      const hydratedItem = await waitForCodeViewHydrated(
        viewer,
        partialItem.id
      );
      const hydratedInstanceFileDiff = diffInstance.fileDiff;
      assertDefined(
        hydratedInstanceFileDiff,
        'expected diff instance to keep hydrated file diff'
      );

      expect(hydratedItem.fileDiff).toBe(hydratedInstanceFileDiff);
      expect(hydratedItem.fileDiff).not.toBe(initialPartialFileDiff);
      expect(partialItem.fileDiff).toBe(hydratedItem.fileDiff);

      viewer.render(true);
      const rerenderedInstanceFileDiff = diffInstance.fileDiff;
      assertDefined(
        rerenderedInstanceFileDiff,
        'expected diff instance to keep hydrated file diff after rerender'
      );

      expect(rerenderedInstanceFileDiff).toBe(hydratedItem.fileDiff);
      expect(rerenderedInstanceFileDiff.isPartial).toBe(false);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
