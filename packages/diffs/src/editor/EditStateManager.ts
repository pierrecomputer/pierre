import LRUMapPkg from 'lru_map';

import type { FileContents } from '../types';
import type { Editor } from './editor';
import { TextDocument } from './textDocument';
import type {
  EditorDocumentKind,
  EditorViewState,
  EditState,
  RetainedDiffSessionSnapshot,
} from './types';

const DEFAULT_EDIT_STATE_CAPACITY = 100;

interface ManagedEditSessionBase<LAnnotation = unknown> {
  document?: TextDocument<LAnnotation>;
  fileInfo?: Pick<FileContents, 'lang' | 'name'>;
  editor?: EditorViewState;
}

export interface ManagedFileEditSession<
  LAnnotation = unknown,
> extends ManagedEditSessionBase<LAnnotation> {
  documentKind: 'file';
  diffSession?: never;
}

export interface ManagedFileDiffEditSession<
  LAnnotation = unknown,
> extends ManagedEditSessionBase<LAnnotation> {
  documentKind: 'file-diff';
  diffSession?: RetainedDiffSessionSnapshot;
}

export type ManagedEditSession<
  TDocumentKind extends EditorDocumentKind = EditorDocumentKind,
  LAnnotation = unknown,
> = TDocumentKind extends 'file'
  ? ManagedFileEditSession<LAnnotation>
  : ManagedFileDiffEditSession<LAnnotation>;

interface EditStateManagerSession<K extends EditorDocumentKind> {
  owner: Editor<K, unknown>;
  session: ManagedEditSession<K>;
}

/** Owns dormant edit state and active-key exclusion for one surface kind. */
class EditStateManagerNamespace<K extends EditorDocumentKind> {
  #states = new LRUMapPkg.LRUMap<string, EditState<K>>(
    DEFAULT_EDIT_STATE_CAPACITY
  );
  #sessions = new Map<string, EditStateManagerSession<K>>();

  constructor(readonly documentKind: K) {}

  activate<LAnnotation>(
    editStateKey: string,
    owner: Editor<K, LAnnotation>,
    initialState?: ManagedEditSession<K, LAnnotation>
  ): ManagedEditSession<K, LAnnotation> {
    const activeSession = this.#sessions.get(editStateKey);
    if (activeSession != null && activeSession.owner !== owner) {
      throw new Error(
        `Editor: editStateKey "${editStateKey}" is already attached to another editor`
      );
    }
    if (activeSession != null) {
      if (initialState != null) {
        activeSession.session = initialState;
      }
      return activeSession.session as ManagedEditSession<K, LAnnotation>;
    }
    const retainedState = this.#states.delete(editStateKey);
    const emptyState = {
      documentKind: this.documentKind,
    } as ManagedEditSession<K>;
    const state = (initialState ??
      retainedState ??
      emptyState) as ManagedEditSession<K, LAnnotation>;
    this.#sessions.set(editStateKey, {
      owner: owner as Editor<K, unknown>,
      session: state as ManagedEditSession<K>,
    });
    return state;
  }

  release<LAnnotation>(
    editStateKey: string,
    owner: Editor<K, LAnnotation>,
    discard = false
  ): void {
    const activeSession = this.#sessions.get(editStateKey);
    if (activeSession?.owner !== owner) {
      return;
    }
    this.#sessions.delete(editStateKey);
    if (discard) {
      return;
    }
    const retainedState = toManagedEditState(activeSession.session);
    if (retainedState != null) {
      this.#states.set(editStateKey, retainedState as EditState<K>);
    }
  }

  get<LAnnotation>(
    editStateKey: string
  ): EditState<K, LAnnotation> | undefined {
    const activeSession = this.#sessions.get(editStateKey);
    if (activeSession != null) {
      const state = toManagedEditState(
        activeSession.session as ManagedEditSession<K, LAnnotation>
      );
      if (state == null) {
        return undefined;
      }
      return state;
    }
    const state = this.#states.find(editStateKey);
    return state as EditState<K, LAnnotation> | undefined;
  }

  /** Clear dormant state for a key. Omit `parts` to clear everything. */
  clear(editStateKey: string, parts?: ClearEditStateOptions): boolean {
    if (this.#sessions.has(editStateKey)) {
      return false;
    }

    const state = this.#states.find(editStateKey);
    if (state == null) {
      return false;
    }
    if (parts == null || parts.document === true) {
      this.#states.delete(editStateKey);
    } else {
      applyClearEditStateOptions(state, parts);
    }
    return true;
  }

  clearAll(): void {
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
}

/** Keeps file and diff edit state in independent persistence domains. */
class EditStateManagerClass {
  #files = new EditStateManagerNamespace('file');
  #diffs = new EditStateManagerNamespace('file-diff');

  /** Mark a keyed session as active and return its initial or stored state. */
  activate<TDocumentKind extends EditorDocumentKind, LAnnotation>(
    documentKind: TDocumentKind,
    editStateKey: string,
    owner: Editor<TDocumentKind, LAnnotation>,
    initialState?: ManagedEditSession<TDocumentKind, LAnnotation>
  ): ManagedEditSession<TDocumentKind, LAnnotation> {
    return (
      documentKind === 'file'
        ? this.#files.activate(
            editStateKey,
            owner as Editor<'file', LAnnotation>,
            initialState as ManagedFileEditSession<LAnnotation> | undefined
          )
        : this.#diffs.activate(
            editStateKey,
            owner as Editor<'file-diff', LAnnotation>,
            initialState as ManagedFileDiffEditSession<LAnnotation> | undefined
          )
    ) as ManagedEditSession<TDocumentKind, LAnnotation>;
  }

  /**
   * Stop tracking this file session as active and store its current state,
   * unless `discard` is true.
   */
  releaseFile<LAnnotation>(
    editStateKey: string,
    owner: Editor<'file', LAnnotation>,
    discard = false
  ): void {
    this.#files.release(editStateKey, owner, discard);
  }

  /**
   * Stop tracking this diff session as active and store its current state,
   * unless `discard` is true.
   */
  releaseFileDiff<LAnnotation>(
    editStateKey: string,
    owner: Editor<'file-diff', LAnnotation>,
    discard = false
  ): void {
    this.#diffs.release(editStateKey, owner, discard);
  }

  /** Return current state for an active or dormant editing session. */
  get<TDocumentKind extends EditorDocumentKind, LAnnotation>(
    documentKind: TDocumentKind,
    editStateKey: string
  ): EditState<TDocumentKind, LAnnotation> | undefined {
    return (
      documentKind === 'file'
        ? this.#files.get<LAnnotation>(editStateKey)
        : this.#diffs.get<LAnnotation>(editStateKey)
    ) as EditState<TDocumentKind, LAnnotation> | undefined;
  }

  /** Clear a dormant session, returning false when it is active or missing. */
  clear(
    documentKind: EditorDocumentKind,
    editStateKey: string,
    parts?: ClearEditStateOptions
  ): boolean {
    return documentKind === 'file'
      ? this.#files.clear(editStateKey, parts)
      : this.#diffs.clear(editStateKey, parts);
  }

  /** Clear all dormant sessions without affecting active editors. */
  clearAll(): void {
    this.#files.clearAll();
    this.#diffs.clearAll();
  }

  setCapacity(capacity: number): void {
    this.#files.setCapacity(capacity);
    this.#diffs.setCapacity(capacity);
  }
}

export interface ClearEditStateOptions {
  document?: boolean;
  history?: boolean;
  editor?: boolean;
  selections?: boolean;
  view?: boolean;
}

export function cloneEditorViewState(state: EditorViewState): EditorViewState {
  return {
    selections: state.selections?.map((selection) => ({
      ...selection,
      start: { ...selection.start },
      end: { ...selection.end },
    })),
    view: state.view == null ? undefined : { ...state.view },
  };
}

export function toManagedEditState<
  TDocumentKind extends EditorDocumentKind,
  LAnnotation,
>(
  session: ManagedEditSession<TDocumentKind, LAnnotation>
): EditState<TDocumentKind, LAnnotation> | undefined {
  if (session.document == null || session.fileInfo == null) {
    return undefined;
  }
  if (session.documentKind === 'file') {
    session.editor ??= {};
    return session as EditState<TDocumentKind, LAnnotation>;
  }
  if (session.diffSession == null) {
    return undefined;
  }
  session.editor ??= {};
  return session as EditState<TDocumentKind, LAnnotation>;
}

function applyClearEditStateOptions(
  session: ManagedEditSession | undefined,
  parts: ClearEditStateOptions
): void {
  if (session == null) {
    return;
  }
  if (parts.history === true) {
    session.document?.clearHistory();
  }
  if (session.editor != null) {
    if (parts.editor === true || parts.selections === true) {
      session.editor.selections = undefined;
    }
    if (parts.editor === true || parts.view === true) {
      session.editor.view = undefined;
    }
  }
}

export const EditStateManager: EditStateManagerClass =
  new EditStateManagerClass();
