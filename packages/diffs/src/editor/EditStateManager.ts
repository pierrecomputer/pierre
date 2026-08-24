import LRUMapPkg from 'lru_map';

import type {
  DiffsEditor,
  EditorDocumentKind,
  EditorState,
  FileContents,
  RetainedDiffSessionSnapshot,
} from '../types';
import { cloneRetainedDiffSessionSnapshot } from '../utils/cloneFileDiffMetadata';
import type { TextDocument } from './textDocument';

const DEFAULT_EDIT_STATE_CAPACITY = 100;

interface ManagedEditStateBase {
  document: TextDocument<unknown>;
  fileInfo: Pick<FileContents, 'lang' | 'name'>;
  editor?: EditorState;
}

export interface ManagedFileEditState extends ManagedEditStateBase {
  documentKind: 'file';
  diffSession?: never;
}

export interface ManagedFileDiffEditState extends ManagedEditStateBase {
  documentKind: 'file-diff';
  diffSession: RetainedDiffSessionSnapshot;
}

export type ManagedEditState = ManagedFileEditState | ManagedFileDiffEditState;

type ManagedEditStateFor<K extends EditorDocumentKind> = Extract<
  ManagedEditState,
  { documentKind: K }
>;

export interface EditStateManagerAttachment<K extends EditorDocumentKind> {
  documentKind: K;
  editStateKey: string;
  state?: ManagedEditStateFor<K>;
}

export type AnyEditStateManagerAttachment =
  | EditStateManagerAttachment<'file'>
  | EditStateManagerAttachment<'file-diff'>;

export interface EditStateRetention {
  document: boolean;
  history: boolean;
  selections: boolean;
  view: boolean;
}

interface EditStateManagerSession<K extends EditorDocumentKind> {
  owner: DiffsEditor<unknown>;
  attachment?: EditStateManagerAttachment<K>;
  retention: EditStateRetention;
}

/** Owns dormant edit state and active-key exclusion for one surface kind. */
class EditStateManagerNamespace<K extends EditorDocumentKind> {
  #states = new LRUMapPkg.LRUMap<string, ManagedEditStateFor<K>>(
    DEFAULT_EDIT_STATE_CAPACITY
  );
  #sessions = new Map<string, EditStateManagerSession<K>>();

  constructor(readonly documentKind: K) {}

  acquire(editStateKey: string, owner: DiffsEditor<unknown>): boolean {
    const session = this.#sessions.get(editStateKey);
    if (session != null && session.owner !== owner) {
      throw new Error(
        `Editor: editStateKey "${editStateKey}" is already attached to another editor`
      );
    }
    if (session != null) {
      return false;
    }
    this.#sessions.set(editStateKey, {
      owner,
      retention: createEditStateRetention(),
    });
    return true;
  }

  beginAttachment(
    editStateKey: string,
    owner: DiffsEditor<unknown>
  ): EditStateManagerAttachment<K> {
    const session = this.#sessions.get(editStateKey);
    if (session?.owner !== owner) {
      throw new Error(
        `Editor: editStateKey "${editStateKey}" must be acquired before attachment`
      );
    }
    const attachment: EditStateManagerAttachment<K> = {
      documentKind: this.documentKind,
      editStateKey,
      state: this.#states.delete(editStateKey),
    };
    session.attachment = attachment;
    return attachment;
  }

  commitAttachment(attachment: EditStateManagerAttachment<K>): void {
    const session = this.#sessions.get(attachment.editStateKey);
    if (session?.attachment === attachment) {
      session.attachment = undefined;
    }
  }

  rollbackAttachment(attachment: EditStateManagerAttachment<K>): void {
    const session = this.#sessions.get(attachment.editStateKey);
    if (session?.attachment !== attachment) {
      return;
    }
    session.attachment = undefined;
    const state = applyEditStateRetention(attachment.state, session.retention);
    if (state != null) {
      this.#retain(attachment.editStateKey, state);
    }
    attachment.state = undefined;
  }

  release(
    editStateKey: string,
    owner: DiffsEditor<unknown>,
    state?: ManagedEditStateFor<K>
  ): void {
    const session = this.#sessions.get(editStateKey);
    if (session?.owner !== owner) {
      return;
    }
    session.attachment = undefined;
    this.#sessions.delete(editStateKey);
    const retainedState = applyEditStateRetention(state, session.retention);
    if (retainedState != null) {
      this.#retain(editStateKey, retainedState);
    }
  }

  dispose(editStateKey: string): boolean {
    const session = this.#sessions.get(editStateKey);
    if (session != null) {
      session.retention = createEditStateRetention(false);
      if (session.attachment != null) {
        session.attachment.state = undefined;
      }
    }
    return this.#states.delete(editStateKey) != null || session != null;
  }

  clear(): void {
    this.#sessions.forEach((session) => {
      session.retention = createEditStateRetention(false);
      if (session.attachment != null) {
        session.attachment.state = undefined;
      }
    });
    this.#states.clear();
  }

  setCapacity(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(
        'EditStateManager: capacity must be a positive integer'
      );
    }
    while (this.#states.size > capacity) {
      this.#states.shift();
    }
    this.#states.limit = capacity;
  }

  #retain(editStateKey: string, state: ManagedEditStateFor<K>): void {
    if (
      this.#states.find(editStateKey) == null &&
      this.#states.size >= this.#states.limit
    ) {
      this.#states.shift();
    }
    this.#states.set(editStateKey, state);
  }
}

/** Keeps file and diff edit state in independent persistence domains. */
class EditStateManagerClass {
  #files = new EditStateManagerNamespace('file');
  #diffs = new EditStateManagerNamespace('file-diff');

  acquire(
    documentKind: EditorDocumentKind,
    editStateKey: string,
    owner: DiffsEditor<unknown>
  ): boolean {
    return documentKind === 'file'
      ? this.#files.acquire(editStateKey, owner)
      : this.#diffs.acquire(editStateKey, owner);
  }

  beginAttachment(
    documentKind: 'file',
    editStateKey: string,
    owner: DiffsEditor<unknown>
  ): EditStateManagerAttachment<'file'>;
  beginAttachment(
    documentKind: 'file-diff',
    editStateKey: string,
    owner: DiffsEditor<unknown>
  ): EditStateManagerAttachment<'file-diff'>;
  beginAttachment(
    documentKind: EditorDocumentKind,
    editStateKey: string,
    owner: DiffsEditor<unknown>
  ): AnyEditStateManagerAttachment {
    return documentKind === 'file'
      ? this.#files.beginAttachment(editStateKey, owner)
      : this.#diffs.beginAttachment(editStateKey, owner);
  }

  commitAttachment(attachment: AnyEditStateManagerAttachment): void {
    if (attachment.documentKind === 'file') {
      this.#files.commitAttachment(attachment);
    } else {
      this.#diffs.commitAttachment(attachment);
    }
  }

  rollbackAttachment(attachment: AnyEditStateManagerAttachment): void {
    if (attachment.documentKind === 'file') {
      this.#files.rollbackAttachment(attachment);
    } else {
      this.#diffs.rollbackAttachment(attachment);
    }
  }

  releaseFile(
    editStateKey: string,
    owner: DiffsEditor<unknown>,
    state?: ManagedFileEditState
  ): void {
    this.#files.release(editStateKey, owner, state);
  }

  releaseFileDiff(
    editStateKey: string,
    owner: DiffsEditor<unknown>,
    state?: ManagedFileDiffEditState
  ): void {
    this.#diffs.release(editStateKey, owner, state);
  }

  disposeFile(editStateKey: string): boolean {
    return this.#files.dispose(editStateKey);
  }

  disposeFileDiff(editStateKey: string): boolean {
    return this.#diffs.dispose(editStateKey);
  }

  clearAll(): void {
    this.#files.clear();
    this.#diffs.clear();
  }

  setCapacity(capacity: number): void {
    this.#files.setCapacity(capacity);
    this.#diffs.setCapacity(capacity);
  }
}

export function cloneEditorState(state: EditorState): EditorState {
  return {
    selections: state.selections?.map((selection) => ({
      ...selection,
      start: { ...selection.start },
      end: { ...selection.end },
    })),
    view: state.view == null ? undefined : { ...state.view },
  };
}

export function cloneManagedEditState(
  state: ManagedEditState
): ManagedEditState {
  const base = {
    document: state.document.clone(),
    fileInfo: { ...state.fileInfo },
    editor: state.editor == null ? undefined : cloneEditorState(state.editor),
  };
  return state.documentKind === 'file'
    ? { ...base, documentKind: 'file' }
    : {
        ...base,
        documentKind: 'file-diff',
        diffSession: cloneRetainedDiffSessionSnapshot(state.diffSession),
      };
}

export function applyEditStateRetention<T extends ManagedEditState>(
  state: T | undefined,
  retention: EditStateRetention
): T | undefined {
  if (state == null || !retention.document) {
    return undefined;
  }
  if (retention.history && retention.selections && retention.view) {
    return state;
  }
  const editor = filterEditorState(state.editor, retention);
  return {
    ...state,
    document: retention.history
      ? state.document
      : state.document.cloneWithoutHistory(),
    editor,
  };
}

function createEditStateRetention(retain = true): EditStateRetention {
  return {
    document: retain,
    history: retain,
    selections: retain,
    view: retain,
  };
}

function filterEditorState(
  state: EditorState | undefined,
  retention: EditStateRetention
): EditorState | undefined {
  if (state == null) {
    return undefined;
  }
  const selections = retention.selections
    ? cloneEditorState(state).selections
    : undefined;
  const view =
    retention.view && state.view != null ? { ...state.view } : undefined;
  return selections == null && view == null ? undefined : { selections, view };
}

export const EditStateManager: EditStateManagerClass =
  new EditStateManagerClass();
