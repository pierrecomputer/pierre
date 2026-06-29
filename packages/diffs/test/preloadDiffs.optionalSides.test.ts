import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  preloadDiffHTML,
  type PreloadDiffOptions,
  preloadMultiFileDiff,
} from '../src/ssr/preloadDiffs';
import type { FileContents } from '../src/types';

afterAll(async () => {
  await disposeHighlighter();
});

describe('preload diff optional sides', () => {
  test('preloadDiffHTML renders a new file from an explicit missing oldFile side', async () => {
    const newFile: FileContents = {
      name: 'created.txt',
      contents: 'created\n',
    };

    const html = await preloadDiffHTML({ oldFile: null, newFile });

    expect(html).toContain('data-dehydrated');
    expect(html).toContain('created');
  });

  test('preloadDiffHTML renders a deleted file from an explicit missing newFile side', async () => {
    const oldFile: FileContents = {
      name: 'deleted.txt',
      contents: 'deleted\n',
    };

    const html = await preloadDiffHTML({ oldFile, newFile: null });

    expect(html).toContain('data-dehydrated');
    expect(html).toContain('deleted');
  });

  test('preloadMultiFileDiff returns prerendered HTML for one-sided input', async () => {
    const newFile: FileContents = {
      name: 'created.txt',
      contents: 'created\n',
    };

    const result = await preloadMultiFileDiff({ oldFile: null, newFile });

    expect(result.oldFile).toBeNull();
    expect(result.newFile).toBe(newFile);
    expect(result.prerenderedHTML).toContain('data-dehydrated');
  });

  test('preloadDiffHTML rejects omitted one-sided input', async () => {
    const newFile: FileContents = {
      name: 'created.txt',
      contents: 'created\n',
    };
    let error: unknown;

    try {
      await preloadDiffHTML({ newFile } as PreloadDiffOptions<undefined>);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Pass null');
  });

  test('preloadDiffHTML throws when no diff inputs are provided', async () => {
    let error: unknown;

    try {
      await preloadDiffHTML({} as PreloadDiffOptions<undefined>);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('fileDiff, oldFile, or newFile');
  });
});
