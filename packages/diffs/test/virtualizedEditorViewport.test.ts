import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { installDom } from './domHarness';

describe('virtualized editor viewport', () => {
  test('uses the simple Virtualizer root', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const virtualizer = {
      type: 'simple',
      getRoot: () => root,
    } as never;
    const file = new VirtualizedFile({}, virtualizer);
    const fileDiff = new VirtualizedFileDiff({}, virtualizer);

    try {
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });

  test('uses the advanced CodeView container', () => {
    const dom = installDom();
    const root = document.createElement('div');
    const codeView = {
      type: 'advanced',
      getContainerElement: () => root,
    } as never;
    const file = new VirtualizedFile({}, codeView);
    const fileDiff = new VirtualizedFileDiff({}, codeView);

    try {
      expect(file.getEditorViewport()).toBe(root);
      expect(fileDiff.getEditorViewport()).toBe(root);
    } finally {
      file.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
