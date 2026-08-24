import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { EditStack } from '../src/editor/editStack';
import {
  applyEditStateRetention,
  cloneEditorState,
  cloneManagedEditState,
  EditStateManager,
  type EditStateRetention,
  type ManagedFileEditState,
} from '../src/editor/EditStateManager';
import { TextDocument } from '../src/editor/textDocument';
import type {
  DiffLineAnnotation,
  DiffsEditor,
  EditorState,
  RetainedDiffSessionSnapshot,
} from '../src/types';

const RETAIN_ALL: EditStateRetention = {
  document: true,
  history: true,
  selections: true,
  view: true,
};

function createOwner(): DiffsEditor<unknown> {
  return {} as DiffsEditor<unknown>;
}

function createState(): ManagedFileEditState {
  const document = new TextDocument<unknown>(
    'file:///example.ts',
    'const value = 1;',
    'typescript'
  );
  document.applyResolvedEdits([{ start: 14, end: 15, text: '2' }]);
  return {
    documentKind: 'file',
    document,
    fileInfo: { name: 'example.ts', lang: 'typescript' },
    editor: {
      selections: [
        {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 11 },
          direction: 1,
        },
      ],
      view: { scrollLeft: 24, scrollTop: 80 },
    },
  };
}

function createDiffSession(): RetainedDiffSessionSnapshot {
  return {
    oldFile: { name: 'example.ts', lines: ['const value = 1;'] },
    type: 'change',
    hunks: [
      {
        collapsedBefore: 0,
        additionStart: 1,
        additionCount: 1,
        additionLines: 1,
        additionLineIndex: 0,
        deletionStart: 1,
        deletionCount: 1,
        deletionLines: 1,
        deletionLineIndex: 0,
        hunkContent: [
          {
            type: 'change',
            deletions: 1,
            deletionLineIndex: 0,
            additions: 1,
            additionLineIndex: 0,
          },
        ],
        splitLineStart: 0,
        splitLineCount: 1,
        unifiedLineStart: 0,
        unifiedLineCount: 2,
        noEOFCRDeletions: false,
        noEOFCRAdditions: false,
      },
    ],
  };
}

beforeEach(() => {
  EditStateManager.clearAll();
  EditStateManager.setCapacity(100);
});

afterEach(() => {
  EditStateManager.clearAll();
  EditStateManager.setCapacity(100);
});

describe('EditStateManager', () => {
  test('keeps complete dormant state in independent surface namespaces', () => {
    const key = 'shared-key';
    const fileOwner = createOwner();
    const diffOwner = createOwner();
    expect(EditStateManager.acquire('file', key, fileOwner)).toBe(true);
    const initialAttachment = EditStateManager.beginAttachment(
      'file',
      key,
      fileOwner
    );
    expect(initialAttachment.state).toBeUndefined();
    EditStateManager.commitAttachment(initialAttachment);
    EditStateManager.releaseFile(key, fileOwner, createState());

    expect(EditStateManager.acquire('file-diff', key, diffOwner)).toBe(true);
    const diffAttachment = EditStateManager.beginAttachment(
      'file-diff',
      key,
      diffOwner
    );
    expect(diffAttachment.state).toBeUndefined();
    EditStateManager.commitAttachment(diffAttachment);
    EditStateManager.releaseFileDiff(key, diffOwner);

    const nextOwner = createOwner();
    expect(EditStateManager.acquire('file', key, nextOwner)).toBe(true);
    const attachment = EditStateManager.beginAttachment('file', key, nextOwner);
    expect(attachment.state?.document.getText()).toBe('const value = 2;');
    expect(attachment.state?.document.canUndo).toBe(true);
    expect(attachment.state?.editor).toEqual({
      selections: [
        {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 11 },
          direction: 1,
        },
      ],
      view: { scrollLeft: 24, scrollTop: 80 },
    });
    EditStateManager.rollbackAttachment(attachment);
    EditStateManager.releaseFile(key, nextOwner);
  });

  test('preserves ownership and attachment rollback behavior', () => {
    const key = 'transactional-state';
    const firstOwner = createOwner();
    const secondOwner = createOwner();
    expect(EditStateManager.acquire('file', key, firstOwner)).toBe(true);
    expect(EditStateManager.acquire('file', key, firstOwner)).toBe(false);
    expect(() => EditStateManager.acquire('file', key, secondOwner)).toThrow(
      `Editor: editStateKey "${key}" is already attached to another editor`
    );
    EditStateManager.releaseFile(key, secondOwner, createState());
    expect(() => EditStateManager.acquire('file', key, secondOwner)).toThrow();

    const initialAttachment = EditStateManager.beginAttachment(
      'file',
      key,
      firstOwner
    );
    EditStateManager.commitAttachment(initialAttachment);
    EditStateManager.releaseFile(key, firstOwner, createState());

    expect(EditStateManager.acquire('file', key, secondOwner)).toBe(true);
    const attachment = EditStateManager.beginAttachment(
      'file',
      key,
      secondOwner
    );
    expect(attachment.state).toBeDefined();
    EditStateManager.rollbackAttachment(attachment);
    EditStateManager.releaseFile(key, secondOwner);

    const finalOwner = createOwner();
    EditStateManager.acquire('file', key, finalOwner);
    const restoredAttachment = EditStateManager.beginAttachment(
      'file',
      key,
      finalOwner
    );
    expect(restoredAttachment.state?.document.getText()).toBe(
      'const value = 2;'
    );
    EditStateManager.rollbackAttachment(restoredAttachment);
    EditStateManager.releaseFile(key, finalOwner);
  });

  test('evicts complete dormant entries without counting active sessions', () => {
    EditStateManager.setCapacity(1);
    const firstOwner = createOwner();
    EditStateManager.acquire('file', 'first', firstOwner);
    const firstAttachment = EditStateManager.beginAttachment(
      'file',
      'first',
      firstOwner
    );
    EditStateManager.commitAttachment(firstAttachment);
    EditStateManager.releaseFile('first', firstOwner, createState());

    const activeOwner = createOwner();
    EditStateManager.acquire('file', 'first', activeOwner);
    const activeAttachment = EditStateManager.beginAttachment(
      'file',
      'first',
      activeOwner
    );
    expect(activeAttachment.state).toBeDefined();
    EditStateManager.commitAttachment(activeAttachment);

    const secondOwner = createOwner();
    EditStateManager.acquire('file', 'second', secondOwner);
    const secondAttachment = EditStateManager.beginAttachment(
      'file',
      'second',
      secondOwner
    );
    EditStateManager.commitAttachment(secondAttachment);
    EditStateManager.releaseFile('second', secondOwner, createState());
    EditStateManager.releaseFile('first', activeOwner, createState());

    const checkSecondOwner = createOwner();
    EditStateManager.acquire('file', 'second', checkSecondOwner);
    const evictedAttachment = EditStateManager.beginAttachment(
      'file',
      'second',
      checkSecondOwner
    );
    expect(evictedAttachment.state).toBeUndefined();
    EditStateManager.rollbackAttachment(evictedAttachment);
    EditStateManager.releaseFile('second', checkSecondOwner);

    const checkFirstOwner = createOwner();
    EditStateManager.acquire('file', 'first', checkFirstOwner);
    const retainedAttachment = EditStateManager.beginAttachment(
      'file',
      'first',
      checkFirstOwner
    );
    expect(retainedAttachment.state).toBeDefined();
    EditStateManager.rollbackAttachment(retainedAttachment);
    EditStateManager.releaseFile('first', checkFirstOwner);
  });

  test('restores a rolled-back attachment as most recently used', () => {
    EditStateManager.setCapacity(2);
    for (const key of ['first', 'second']) {
      const owner = createOwner();
      EditStateManager.acquire('file', key, owner);
      const attachment = EditStateManager.beginAttachment('file', key, owner);
      EditStateManager.commitAttachment(attachment);
      EditStateManager.releaseFile(key, owner, createState());
    }

    const rollbackOwner = createOwner();
    EditStateManager.acquire('file', 'first', rollbackOwner);
    const rollbackAttachment = EditStateManager.beginAttachment(
      'file',
      'first',
      rollbackOwner
    );
    EditStateManager.rollbackAttachment(rollbackAttachment);
    EditStateManager.releaseFile('first', rollbackOwner);

    const thirdOwner = createOwner();
    EditStateManager.acquire('file', 'third', thirdOwner);
    const thirdAttachment = EditStateManager.beginAttachment(
      'file',
      'third',
      thirdOwner
    );
    EditStateManager.commitAttachment(thirdAttachment);
    EditStateManager.releaseFile('third', thirdOwner, createState());

    const secondOwner = createOwner();
    EditStateManager.acquire('file', 'second', secondOwner);
    const evictedAttachment = EditStateManager.beginAttachment(
      'file',
      'second',
      secondOwner
    );
    expect(evictedAttachment.state).toBeUndefined();
    EditStateManager.rollbackAttachment(evictedAttachment);
    EditStateManager.releaseFile('second', secondOwner);

    const firstOwner = createOwner();
    EditStateManager.acquire('file', 'first', firstOwner);
    const retainedAttachment = EditStateManager.beginAttachment(
      'file',
      'first',
      firstOwner
    );
    expect(retainedAttachment.state).toBeDefined();
    EditStateManager.rollbackAttachment(retainedAttachment);
    EditStateManager.releaseFile('first', firstOwner);
  });

  test('clones document history and editor state without shared mutable data', () => {
    const state = createState();
    const clone = cloneManagedEditState(state);
    expect(clone).not.toBe(state);
    expect(clone.document).not.toBe(state.document);
    expect(clone.document.getText()).toBe(state.document.getText());
    expect(clone.document.canUndo).toBe(true);
    expect(clone.editor).not.toBe(state.editor);
    expect(clone.editor?.selections?.[0]).not.toBe(
      state.editor?.selections?.[0]
    );
    expect(clone.editor?.view).not.toBe(state.editor?.view);

    clone.document.applyResolvedEdits([{ start: 0, end: 0, text: 'export ' }]);
    Object.assign(clone.editor!.selections![0].start, { character: 0 });
    clone.editor!.view!.scrollLeft = 0;
    expect(state.document.getText()).toBe('const value = 2;');
    expect(state.editor?.selections?.[0].start.character).toBe(6);
    expect(state.editor?.view?.scrollLeft).toBe(24);
    clone.document.undo();
    expect(clone.document.getText()).toBe('const value = 2;');
    clone.document.undo();
    expect(clone.document.getText()).toBe('const value = 1;');
    expect(state.document.getText()).toBe('const value = 2;');
  });

  test('isolates history arrays while retaining annotation records by reference', () => {
    const metadata = { id: 'annotation' };
    const annotation: DiffLineAnnotation<unknown> = {
      side: 'additions',
      lineNumber: 1,
      metadata,
    };
    const state = createState();
    state.document.setLastUndoLineAnnotations([annotation], [annotation]);
    const clone = cloneManagedEditState(state);

    const cloneAnnotations = clone.document.undo()?.[2];
    const sourceAnnotations = state.document.undo()?.[2];
    expect(cloneAnnotations).not.toBe(sourceAnnotations);
    expect(cloneAnnotations?.[0]).toBe(annotation);
    expect(sourceAnnotations?.[0]).toBe(annotation);
    expect(cloneAnnotations?.[0].metadata).toBe(metadata);
  });

  test('clones diff resume metadata without shared mutable data', () => {
    const state = {
      ...createState(),
      documentKind: 'file-diff' as const,
      diffSession: createDiffSession(),
    };
    const clone = cloneManagedEditState(state);
    expect(clone.documentKind).toBe('file-diff');
    if (clone.documentKind !== 'file-diff') {
      throw new Error('Expected cloned file-diff state');
    }
    clone.diffSession.oldFile!.lines[0] = 'changed';
    clone.diffSession.hunks[0].hunkContent[0].additionLineIndex = 8;
    expect(state.diffSession.oldFile?.lines[0]).toBe('const value = 1;');
    expect(state.diffSession.hunks[0].hunkContent[0].additionLineIndex).toBe(0);
  });

  test('filters retained history, selections, and view independently', () => {
    const state = createState();
    const withoutHistoryAndSelections = applyEditStateRetention(state, {
      ...RETAIN_ALL,
      history: false,
      selections: false,
    });
    expect(withoutHistoryAndSelections?.document.getText()).toBe(
      state.document.getText()
    );
    expect(withoutHistoryAndSelections?.document.canUndo).toBe(false);
    expect(withoutHistoryAndSelections?.editor).toEqual({
      selections: undefined,
      view: { scrollLeft: 24, scrollTop: 80 },
    });

    const withoutEditorState = applyEditStateRetention(state, {
      ...RETAIN_ALL,
      selections: false,
      view: false,
    });
    expect(withoutEditorState?.document).toBe(state.document);
    expect(withoutEditorState?.editor).toBeUndefined();
    expect(
      applyEditStateRetention(state, { ...RETAIN_ALL, document: false })
    ).toBeUndefined();
  });

  test('preserves line endings and history capacity while filtering', () => {
    const document = new TextDocument(
      'file:///eol.txt',
      'first\r\nsecond',
      'text',
      0,
      new EditStack({ maxEntries: 1 })
    );
    document.applyResolvedEdits([
      { start: 0, end: document.getText().length, text: 'first' },
    ]);
    const state: ManagedFileEditState = {
      documentKind: 'file',
      document,
      fileInfo: { name: 'eol.txt', lang: 'text' },
    };
    const clone = cloneManagedEditState(state);
    expect(clone.document.eol).toBe('\r\n');

    const withoutHistory = applyEditStateRetention(state, {
      ...RETAIN_ALL,
      history: false,
    })!;
    expect(withoutHistory.document.eol).toBe('\r\n');
    withoutHistory.document.applyResolvedEdits(
      [{ start: 5, end: 5, text: ' second' }],
      true,
      undefined,
      undefined,
      true
    );
    withoutHistory.document.applyResolvedEdits(
      [{ start: 12, end: 12, text: ' third' }],
      true,
      undefined,
      undefined,
      true
    );
    withoutHistory.document.undo();
    expect(withoutHistory.document.getText()).toBe('first second');
    expect(withoutHistory.document.undo()).toBeUndefined();
  });

  test('active disposal prevents a staged state from being restored', () => {
    const key = 'disposed-pending-state';
    const firstOwner = createOwner();
    EditStateManager.acquire('file', key, firstOwner);
    const firstAttachment = EditStateManager.beginAttachment(
      'file',
      key,
      firstOwner
    );
    EditStateManager.commitAttachment(firstAttachment);
    EditStateManager.releaseFile(key, firstOwner, createState());

    const secondOwner = createOwner();
    EditStateManager.acquire('file', key, secondOwner);
    const pendingAttachment = EditStateManager.beginAttachment(
      'file',
      key,
      secondOwner
    );
    expect(pendingAttachment.state).toBeDefined();
    expect(EditStateManager.disposeFile(key)).toBe(true);
    EditStateManager.rollbackAttachment(pendingAttachment);
    EditStateManager.releaseFile(key, secondOwner);

    const thirdOwner = createOwner();
    EditStateManager.acquire('file', key, thirdOwner);
    const emptyAttachment = EditStateManager.beginAttachment(
      'file',
      key,
      thirdOwner
    );
    expect(emptyAttachment.state).toBeUndefined();
    EditStateManager.rollbackAttachment(emptyAttachment);
    EditStateManager.releaseFile(key, thirdOwner);
  });
});

describe('cloneEditorState', () => {
  test('deeply clones selections and view state', () => {
    const state: EditorState = {
      selections: [
        {
          start: { line: 1, character: 2 },
          end: { line: 3, character: 4 },
          direction: -1,
        },
      ],
      view: { scrollLeft: 5, scrollTop: 6 },
    };
    const clone = cloneEditorState(state);
    Object.assign(clone.selections![0].start, { line: 10 });
    clone.view!.scrollTop = 20;
    expect(state.selections?.[0].start.line).toBe(1);
    expect(state.view?.scrollTop).toBe(6);
  });
});
