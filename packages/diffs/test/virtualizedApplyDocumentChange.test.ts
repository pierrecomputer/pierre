import { describe, expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import type {
  DiffsEditor,
  DiffsTextDocument,
  FileContents,
  RenderRange,
} from '../src/types';

function createStubVirtualizer(type: 'simple' | 'advanced') {
  return {
    type,
    config: {},
    capturePendingLayoutAnchor() {},
    connect() {},
    disconnect() {},
    getWindowSpecs() {
      return { top: 0, bottom: 1000 };
    },
    getOffsetInScrollContainer() {
      return 0;
    },
    instanceChanged() {},
    isInstanceVisible() {
      return true;
    },
    markDOMDirty() {},
    requestHeightReconcile() {},
    render() {},
  } as never;
}

function makeContents(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join(
    '\n'
  );
}

function makeDocument(lineCount: number): DiffsTextDocument {
  const text = makeContents(lineCount);
  return {
    lineCount,
    getLineText: (lineNumber: number) => `line ${lineNumber + 1}`,
    getText: () => text,
  };
}

function makeFile(lineCount: number): FileContents {
  return { name: 'a.txt', contents: makeContents(lineCount), lang: 'text' };
}

function createEditorStub(): DiffsEditor<undefined> {
  return {
    cleanUp() {},
    edit: () => () => {},
    __captureFocusForDOMReplacement() {},
    __emitEditComplete() {},
    __getDocumentContents: () => undefined,
    __getDocumentSessionState: () => undefined,
    __postponeBgTokenizeToNextFrame() {},
    __syncRenderView() {},
  } as unknown as DiffsEditor<undefined>;
}

class BufferRecordingFile extends VirtualizedFile<undefined> {
  public bufferUpdates = 0;

  public seedRenderRange(renderRange: RenderRange): void {
    this.renderRange = renderRange;
  }

  protected override updateBuffers(): void {
    this.bufferUpdates += 1;
  }
}

// The buffer update runs after a content edit against the file represented by
// the existing DOM. These tests do not build DOM, so establish that ownership
// explicitly after attaching the private edit session.
function setRenderedEditSession(instance: BufferRecordingFile): void {
  const state = instance as unknown as {
    editSessionFile: FileContents | undefined;
    renderedFile: FileContents | undefined;
  };
  state.renderedFile = state.editSessionFile;
}

describe('applyDocumentChange buffer updates', () => {
  test('the buffer spacer update only runs in simple mode', () => {
    const seeded: RenderRange = {
      startingLine: 0,
      totalLines: 50,
      bufferBefore: 0,
      bufferAfter: 12_345,
    };

    const advancedInstance = new BufferRecordingFile(
      {},
      createStubVirtualizer('advanced')
    );
    advancedInstance.updateCodeViewLayout(makeFile(50), 0);
    const detachAdvancedEditor =
      advancedInstance.attachEditor(createEditorStub());
    setRenderedEditSession(advancedInstance);
    advancedInstance.seedRenderRange(seeded);
    advancedInstance.applyDocumentChange(makeDocument(1), undefined, true);
    expect(advancedInstance.bufferUpdates).toBe(0);
    detachAdvancedEditor();
    advancedInstance.cleanUp();

    const simpleInstance = new BufferRecordingFile(
      {},
      createStubVirtualizer('simple')
    );
    simpleInstance.updateCodeViewLayout(makeFile(50), 0);
    const detachSimpleEditor = simpleInstance.attachEditor(createEditorStub());
    setRenderedEditSession(simpleInstance);
    simpleInstance.seedRenderRange(seeded);
    simpleInstance.applyDocumentChange(makeDocument(1), undefined, true);
    expect(simpleInstance.bufferUpdates).toBe(1);
    detachSimpleEditor();
    simpleInstance.cleanUp();
  });
});
