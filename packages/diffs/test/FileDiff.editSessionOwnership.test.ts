import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, FileDiff, parseDiffFromFile } from '../src';
import type {
  DiffsEditor,
  DiffsTextDocument,
  FileDiffMetadata,
  HighlightedToken,
} from '../src/types';
import { installDom, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

class TestFileDiff extends FileDiff<undefined> {
  getCurrentDiffForTest(): FileDiffMetadata | undefined {
    return this.getCurrentDiff();
  }

  getRendererDiffForTest(): FileDiffMetadata | undefined {
    return this.hunksRenderer.diffCache;
  }

  isEditorRenderReadyForTest(): boolean {
    return this.hunksRenderer.editorRenderReady();
  }
}

function createEditorStub(): DiffsEditor<undefined> {
  return {
    cleanUp() {},
    edit: () => () => {},
    __captureFocusForDOMReplacement() {},
    __postponeBgTokenizeToNextFrame() {},
    __syncRenderView() {},
  };
}

function createExternalDiff(): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name: 'session.ts', contents: 'alpha\nold value\nomega\n' },
    { name: 'session.ts', contents: 'alpha\nnew value\nomega\n' }
  );
  fileDiff.cacheKey = 'external:session-v1';
  return fileDiff;
}

function makeDirtyLines(
  edits: ReadonlyArray<[number, string]>
): Map<number, HighlightedToken[]> {
  return new Map(edits.map(([line, text]) => [line, [[0, '', text]]]));
}

function makeTextDocument(lines: string[]): DiffsTextDocument {
  return {
    lineCount: lines.length,
    getText: () => lines.join(''),
    getLineText: (lineNumber: number, includeLineBreak = false) => {
      const line = lines[lineNumber] ?? '';
      return includeLineBreak ? line : line.replace(/\r?\n$/, '');
    },
  };
}

async function createAttachedFixture(): Promise<{
  cleanup(): void;
  detach(): void;
  externalDiff: FileDiffMetadata;
  instance: TestFileDiff;
}> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const externalDiff = createExternalDiff();
  const instance = new TestFileDiff({
    disableErrorHandling: true,
    disableFileHeader: true,
  });

  instance.render({
    fileDiff: externalDiff,
    fileContainer,
    forceRender: true,
  });
  const detach = instance.attachEditor(createEditorStub());

  await waitFor(
    () => {
      const sessionDiff = instance.getCurrentDiffForTest();
      return (
        sessionDiff != null &&
        sessionDiff !== externalDiff &&
        instance.isEditorRenderReadyForTest()
      );
    },
    { timeout: 4_000 }
  );
  const sessionDiff = instance.getCurrentDiffForTest();
  expect(sessionDiff).toBeDefined();
  expect(sessionDiff).not.toBe(externalDiff);
  expect(instance.isEditorRenderReadyForTest()).toBe(true);

  return {
    cleanup() {
      instance.cleanUp();
      dom.cleanup();
    },
    detach,
    externalDiff,
    instance,
  };
}

describe('FileDiff edit-session ownership', () => {
  test('attach creates a private keyless shallow session diff', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    try {
      const sessionDiff = instance.getCurrentDiffForTest();
      expect(sessionDiff).toBeDefined();
      if (sessionDiff == null) return;

      expect(sessionDiff).not.toBe(externalDiff);
      expect(sessionDiff.cacheKey).toBeUndefined();
      expect(externalDiff.cacheKey).toBe('external:session-v1');
      expect(sessionDiff.additionLines).toBe(externalDiff.additionLines);
      expect(sessionDiff.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionDiff.hunks).toBe(externalDiff.hunks);
      expect(sessionDiff.hunks[0]).toBe(externalDiff.hunks[0]);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('a same-line edit copies addition lines and keeps hunks shared', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = structuredClone(externalDiff);
    try {
      const sessionBefore = instance.getCurrentDiffForTest();
      expect(sessionBefore).toBeDefined();
      if (sessionBefore == null) return;
      expect(sessionBefore.additionLines).toBe(externalDiff.additionLines);
      expect(sessionBefore.hunks).toBe(externalDiff.hunks);

      instance.updateRenderCache(
        makeDirtyLines([[1, 'edited value']]),
        'light'
      );

      const sessionAfter = instance.getCurrentDiffForTest();
      expect(sessionAfter).toBe(sessionBefore);
      expect(sessionAfter?.additionLines).not.toBe(externalDiff.additionLines);
      expect(sessionAfter?.additionLines[1]).toBe('edited value\n');
      expect(sessionAfter?.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionAfter?.hunks).toBe(externalDiff.hunks);
      expect(sessionAfter?.hunks[0]).toBe(externalDiff.hunks[0]);
      expect(sessionAfter?.editSessionDirty).toBe(true);
      expect(instance.getRendererDiffForTest()).toBe(sessionAfter);
      expect(externalDiff).toEqual(externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });

  test('a structural edit rebuilds an owned hunk graph', async () => {
    const fixture = await createAttachedFixture();
    const { detach, externalDiff, instance } = fixture;
    const externalBefore = structuredClone(externalDiff);
    try {
      const sessionBefore = instance.getCurrentDiffForTest();
      expect(sessionBefore).toBeDefined();
      if (sessionBefore == null) return;
      expect(sessionBefore.hunks).toBe(externalDiff.hunks);

      instance.applyDocumentChange(
        makeTextDocument(['alpha\n', 'inserted\n', 'new value\n', 'omega\n'])
      );

      const sessionAfter = instance.getCurrentDiffForTest();
      expect(sessionAfter).toBe(sessionBefore);
      expect(sessionAfter?.additionLines).not.toBe(externalDiff.additionLines);
      expect(sessionAfter?.additionLines.join('')).toBe(
        'alpha\ninserted\nnew value\nomega\n'
      );
      expect(sessionAfter?.deletionLines).toBe(externalDiff.deletionLines);
      expect(sessionAfter?.hunks).not.toBe(externalDiff.hunks);
      expect(sessionAfter?.hunks[0]).not.toBe(externalDiff.hunks[0]);
      expect(sessionAfter?.cacheKey).toBeUndefined();
      expect(externalDiff).toEqual(externalBefore);
    } finally {
      detach();
      fixture.cleanup();
    }
  });
});
