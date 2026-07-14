import type { EditorState } from '../types';

export interface IStateStorage {
  /** Read the editor state stored for a file cache key. */
  get(
    cacheKey: string
  ): EditorState | undefined | Promise<EditorState | undefined>;
  /** Store the editor state for a file cache key. */
  set(cacheKey: string, state: EditorState): void | Promise<void>;
}

export type PersistStateStorage = 'inMemory' | 'indexedDB' | IStateStorage;

export function cloneEditorState(state: EditorState): EditorState {
  return {
    selections: state.selections?.map((selection) => ({
      start: { ...selection.start },
      end: { ...selection.end },
      direction: selection.direction,
    })),
    view: state.view === undefined ? undefined : { ...state.view },
  };
}

export function createStateStorage(
  storage: PersistStateStorage
): IStateStorage {
  return typeof storage === 'object'
    ? storage
    : storage === 'indexedDB'
      ? new IndexedDBStateStorage()
      : new InMemoryStateStorage();
}

class InMemoryStateStorage implements IStateStorage {
  #states = new Map<string, EditorState>();

  get(cacheKey: string): EditorState | undefined {
    const state = this.#states.get(cacheKey);
    return state === undefined ? undefined : cloneEditorState(state);
  }

  set(cacheKey: string, state: EditorState): void {
    this.#states.set(cacheKey, cloneEditorState(state));
  }
}

const DATABASE_NAME = 'pierre-diffs-editor-state';
const DATABASE_VERSION = 1;
const STORE_NAME = 'states';

class IndexedDBStateStorage implements IStateStorage {
  #database = openDatabase();

  async get(cacheKey: string): Promise<EditorState | undefined> {
    const database = await this.#database;
    if (database === undefined) {
      return undefined;
    }
    const state = await requestToPromise<EditorState | undefined>(
      database
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(cacheKey)
    );
    return state === undefined ? undefined : cloneEditorState(state);
  }

  async set(cacheKey: string, state: EditorState): Promise<void> {
    const database = await this.#database;
    if (database === undefined) {
      return;
    }
    await requestToPromise(
      database
        .transaction(STORE_NAME, 'readwrite')
        .objectStore(STORE_NAME)
        .put(cloneEditorState(state), cacheKey)
    );
  }
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  try {
    const factory = globalThis.indexedDB;
    if (factory === undefined) {
      return Promise.resolve(undefined);
    }

    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    return requestToPromise(request);
  } catch {
    return Promise.resolve(undefined);
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
