import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Editor } from '../src/editor/editor';
import { EditStack } from '../src/editor/editStack';
import {
  cloneEditorViewState,
  EditStateManager,
  type ManagedFileEditSession,
} from '../src/editor/EditStateManager';
import { TextDocument } from '../src/editor/textDocument';
import type { EditorViewState, FileEditState } from '../src/editor/types';
import type { LineAnnotation } from '../src/types';

function createOwner(
  getState: () => FileEditState<unknown> = createState
): Editor<'file', unknown> {
  const owner = new Editor<'file', unknown>('file');
  owner.getEditState = getState;
  return owner;
}

function createDiffOwner(): Editor<'file-diff', unknown> {
  return new Editor<'file-diff', unknown>('file-diff');
}

function createState(): FileEditState<unknown> {
  const document = new TextDocument<'file'>(
    'file:///example.ts',
    'const value = 1;',
    'typescript'
  );
  document.applyResolvedEdits([{ start: 14, end: 15, text: '2' }]);
  return {
    type: 'file',
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

function retainFileState(key: string, state = createState()): void {
  const owner = createOwner(() => state);
  EditStateManager.activate('file', key, owner, state);
  EditStateManager.releaseFile(key, owner);
}

function inspectFileState(key: string): FileEditState<unknown> | undefined {
  const state = EditStateManager.get('file', key);
  return state;
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
  test('adopts caller-owned state without cloning its data', () => {
    const document = new TextDocument<'file'>(
      'file:///example.ts',
      'const value = 1;',
      'typescript',
      3,
      new EditStack<'file'>({ maxEntries: 25 })
    );
    const state: FileEditState<unknown> = {
      type: 'file',
      document,
      fileInfo: { name: 'example.ts', lang: 'typescript' },
      editor: {
        view: { scrollLeft: 24 },
      },
    };
    const owner = createOwner(() => state);
    const session = EditStateManager.activate(
      'file',
      'caller-owned',
      owner,
      state
    );

    expect(session).toBe(state);
    expect(session.document).toBe(document);
    expect(session.fileInfo).toBe(state.fileInfo);
    expect(session.editor).toBe(state.editor);
    EditStateManager.releaseFile('caller-owned', owner);
  });

  test('keeps one session object from empty activation through resume', () => {
    const key = 'empty-session';
    const firstOwner = createOwner();
    const session = EditStateManager.activate(
      'file',
      key,
      firstOwner
    ) as ManagedFileEditSession;
    const state = createState();
    session.document = state.document;
    session.fileInfo = state.fileInfo;
    session.editor = state.editor;

    EditStateManager.releaseFile(key, firstOwner);

    const nextOwner = createOwner();
    expect(EditStateManager.activate('file', key, nextOwner)).toBe(session);
    EditStateManager.releaseFile(key, nextOwner);
  });

  test('reads active state from the managed session without querying its owner', () => {
    const state = createState();
    const owner = createOwner(() => {
      throw new Error('owner state should not be queried');
    });
    EditStateManager.activate('file', 'active-session', owner, state);

    expect(EditStateManager.get('file', 'active-session')).toBe(state);
    EditStateManager.releaseFile('active-session', owner);
  });

  test('keeps complete dormant state in independent surface namespaces', () => {
    const key = 'shared-key';
    const fileOwner = createOwner();
    const diffOwner = createDiffOwner();
    const fileState = createState();
    expect(EditStateManager.activate('file', key, fileOwner, fileState)).toBe(
      fileState
    );
    EditStateManager.releaseFile(key, fileOwner);

    expect(EditStateManager.activate('file-diff', key, diffOwner)).toEqual({
      type: 'file-diff',
    });
    EditStateManager.releaseFileDiff(key, diffOwner);

    const nextOwner = createOwner();
    const resumed = EditStateManager.activate('file', key, nextOwner);
    expect(resumed).toBe(fileState);
    expect(resumed.document!.getText()).toBe('const value = 2;');
    expect(resumed.document!.canUndo).toBe(true);
    expect(resumed?.editor).toEqual({
      selections: [
        {
          start: { line: 0, character: 6 },
          end: { line: 0, character: 11 },
          direction: 1,
        },
      ],
      view: { scrollLeft: 24, scrollTop: 80 },
    });
    EditStateManager.releaseFile(key, nextOwner);
  });

  test('preserves ownership while moving the same state between active and dormant', () => {
    const key = 'managed-state';
    const firstOwner = createOwner();
    const secondOwner = createOwner();
    const state = createState();
    expect(EditStateManager.activate('file', key, firstOwner, state)).toBe(
      state
    );
    expect(EditStateManager.activate('file', key, firstOwner)).toBe(state);
    expect(() => EditStateManager.activate('file', key, secondOwner)).toThrow(
      `Editor: editStateKey "${key}" is already attached to another editor`
    );
    EditStateManager.releaseFile(key, secondOwner);
    expect(() => EditStateManager.activate('file', key, secondOwner)).toThrow();

    EditStateManager.releaseFile(key, firstOwner);

    expect(EditStateManager.activate('file', key, secondOwner)).toBe(state);
    EditStateManager.releaseFile(key, secondOwner);

    const finalOwner = createOwner();
    const restored = EditStateManager.activate('file', key, finalOwner);
    expect(restored).toBe(state);
    expect(restored.document!.getText()).toBe('const value = 2;');
    EditStateManager.releaseFile(key, finalOwner);
  });

  test('evicts complete dormant entries without counting active sessions', () => {
    EditStateManager.setCapacity(1);
    const firstOwner = createOwner();
    const firstState = createState();
    EditStateManager.activate('file', 'first', firstOwner, firstState);
    EditStateManager.releaseFile('first', firstOwner);

    const activeOwner = createOwner();
    expect(EditStateManager.activate('file', 'first', activeOwner)).toBe(
      firstState
    );

    const secondOwner = createOwner();
    const secondState = createState();
    EditStateManager.activate('file', 'second', secondOwner, secondState);
    EditStateManager.releaseFile('second', secondOwner);
    EditStateManager.releaseFile('first', activeOwner);

    const checkSecondOwner = createOwner();
    expect(
      EditStateManager.activate('file', 'second', checkSecondOwner)
    ).toEqual({ type: 'file' });
    EditStateManager.releaseFile('second', checkSecondOwner);

    const checkFirstOwner = createOwner();
    expect(EditStateManager.activate('file', 'first', checkFirstOwner)).toBe(
      firstState
    );
    EditStateManager.releaseFile('first', checkFirstOwner);
  });

  test('restores a reactivated state as most recently used', () => {
    EditStateManager.setCapacity(2);
    for (const key of ['first', 'second']) {
      const owner = createOwner();
      EditStateManager.activate('file', key, owner, createState());
      EditStateManager.releaseFile(key, owner);
    }

    const reactivatedOwner = createOwner();
    const firstState = EditStateManager.activate(
      'file',
      'first',
      reactivatedOwner
    );
    EditStateManager.releaseFile('first', reactivatedOwner);

    const thirdOwner = createOwner();
    EditStateManager.activate('file', 'third', thirdOwner, createState());
    EditStateManager.releaseFile('third', thirdOwner);

    const secondOwner = createOwner();
    expect(EditStateManager.activate('file', 'second', secondOwner)).toEqual({
      type: 'file',
    });
    EditStateManager.releaseFile('second', secondOwner);

    const firstOwner = createOwner();
    expect(EditStateManager.activate('file', 'first', firstOwner)).toBe(
      firstState
    );
    EditStateManager.releaseFile('first', firstOwner);
  });

  test('exposes application annotation records through live state', () => {
    const metadata = { id: 'annotation' };
    const annotation: LineAnnotation<unknown> = {
      lineNumber: 1,
      metadata,
    };
    const publicSource = createState();
    publicSource.document.setLastUndoLineAnnotations(
      [annotation],
      [annotation]
    );
    const publicState = publicSource;
    const publicAnnotation =
      publicState.document.history.undoStack[0].lineAnnotationsBefore![0];
    expect(publicAnnotation).toBe(annotation);
    expect(publicAnnotation.metadata).toBe(metadata);
  });

  test('does not clear an active session', () => {
    const key = 'active-state';
    const state = createState();
    retainFileState(key, state);

    const secondOwner = createOwner();
    expect(EditStateManager.activate('file', key, secondOwner)).toBe(state);
    expect(EditStateManager.clear('file', key)).toBe(false);
    expect(EditStateManager.get('file', key)).toBe(state);
    EditStateManager.releaseFile(key, secondOwner);

    const thirdOwner = createOwner();
    expect(EditStateManager.activate('file', key, thirdOwner)).toBe(state);
    EditStateManager.releaseFile(key, thirdOwner);
  });

  test('gets live state without changing LRU recency', () => {
    EditStateManager.setCapacity(2);
    const firstState = createState();
    retainFileState('first', firstState);
    retainFileState('second');

    const inspected = EditStateManager.get('file', 'first')!;
    expect(inspected.document).toBe(firstState.document);
    expect(inspected.fileInfo).toBe(firstState.fileInfo);
    expect(inspected.document.getText()).toBe('const value = 2;');
    expect(inspected.document.languageId).toBe('typescript');
    expect(inspected.document.version).toBe(1);
    expect(inspected.document.eol).toBe('\n');
    expect(inspected.document.history.undoStack).toBe(
      firstState.document.history.undoStack
    );
    expect(inspected.editor).toBe(firstState.editor);
    inspected.document.history.undoStack.length = 0;
    Object.assign(inspected.editor.selections![0].start, { character: 0 });
    inspected.editor.view!.scrollLeft = 0;

    expect(firstState.document.getText()).toBe('const value = 2;');
    expect(firstState.document.canUndo).toBe(false);
    expect(firstState.editor?.selections?.[0].start.character).toBe(0);
    expect(firstState.editor?.view?.scrollLeft).toBe(0);

    retainFileState('third');
    expect(EditStateManager.get('file', 'first')).toBeUndefined();
    expect(EditStateManager.get('file', 'second')).toBeDefined();
  });

  test('clears dormant state parts independently', () => {
    const state = createState();
    retainFileState('partial', state);

    expect(
      EditStateManager.clear('file', 'partial', {
        history: true,
      })
    ).toBe(true);
    let retained = inspectFileState('partial')!;
    expect(retained.document).toBe(state.document);
    expect(retained.document.getText()).toBe('const value = 2;');
    expect(retained.document.canUndo).toBe(false);
    expect(retained.editor?.selections).toHaveLength(1);
    expect(retained.editor?.view).toEqual({ scrollLeft: 24, scrollTop: 80 });

    expect(
      EditStateManager.clear('file', 'partial', { selections: true })
    ).toBe(true);
    retained = inspectFileState('partial')!;
    expect(retained.editor).toEqual({
      selections: undefined,
      view: { scrollLeft: 24, scrollTop: 80 },
    });

    expect(EditStateManager.clear('file', 'partial', { view: true })).toBe(
      true
    );
    expect(inspectFileState('partial')?.editor).toEqual({
      selections: undefined,
      view: undefined,
    });
    expect(EditStateManager.clear('file', 'partial', {})).toBe(true);
    expect(EditStateManager.clear('file', 'partial')).toBe(true);
    expect(EditStateManager.get('file', 'partial')).toBeUndefined();
    expect(EditStateManager.clear('file', 'partial')).toBe(false);

    const editorState = createState();
    retainFileState('editor', editorState);
    expect(EditStateManager.clear('file', 'editor', { editor: true })).toBe(
      true
    );
    expect(inspectFileState('editor')?.document.canUndo).toBe(true);
    expect(inspectFileState('editor')?.editor).toEqual({});

    retainFileState('document');
    expect(
      EditStateManager.clear('file', 'document', {
        document: true,
        history: false,
      })
    ).toBe(true);
    expect(EditStateManager.get('file', 'document')).toBeUndefined();
  });

  test('does not clear parts of an active session', () => {
    const state = createState();
    const owner = createOwner(() => state);
    state.document.applyResolvedEdits([{ start: 14, end: 15, text: '3' }]);
    state.document.undo();
    expect(state.document.canUndo).toBe(true);
    expect(state.document.canRedo).toBe(true);
    EditStateManager.activate('file', 'active', owner, state);
    const document = state.document;
    const text = document.getText();
    const version = document.version;

    expect(
      EditStateManager.clear('file', 'active', {
        history: true,
        selections: true,
      })
    ).toBe(false);
    expect(state.document).toBe(document);
    expect(document.getText()).toBe(text);
    expect(document.version).toBe(version);
    expect(document.canUndo).toBe(true);
    expect(document.canRedo).toBe(true);
    expect(state.editor?.selections).toHaveLength(1);
    expect(state.editor?.view).toEqual({
      scrollLeft: 24,
      scrollTop: 80,
    });

    EditStateManager.releaseFile('active', owner);
    const dormantSnapshot = inspectFileState('active')!;
    expect(dormantSnapshot.document.canUndo).toBe(true);
    expect(dormantSnapshot.document.canRedo).toBe(true);
    expect(dormantSnapshot.editor?.selections).toHaveLength(1);
  });

  test('clearAll leaves active sessions untouched', () => {
    const state = createState();
    const owner = createOwner(() => state);
    const session = EditStateManager.activate(
      'file',
      'active-document',
      owner,
      state
    );
    const document = state.document;

    EditStateManager.clearAll();
    expect(EditStateManager.get('file', 'active-document')).toBe(state);
    expect(session.document).toBe(document);
    expect(session.fileInfo).toBe(state.fileInfo);
    expect(session.editor).toBe(state.editor);
    expect(document.getText()).toBe('const value = 2;');

    EditStateManager.releaseFile('active-document', owner);
    expect(EditStateManager.get('file', 'active-document')).toBe(state);
  });
});

describe('cloneEditorViewState', () => {
  test('deeply clones selections and view state', () => {
    const state: EditorViewState = {
      selections: [
        {
          start: { line: 1, character: 2 },
          end: { line: 3, character: 4 },
          direction: -1,
        },
      ],
      view: { scrollLeft: 5, scrollTop: 6 },
    };
    const clone = cloneEditorViewState(state);
    Object.assign(clone.selections![0].start, { line: 10 });
    clone.view!.scrollTop = 20;
    expect(state.selections?.[0].start.line).toBe(1);
    expect(state.view?.scrollTop).toBe(6);
  });
});
