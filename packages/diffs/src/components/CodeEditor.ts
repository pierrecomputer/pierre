import { DIFFS_TAG_NAME } from '../constants';
import { Editor, type EditorOptions } from '../editor';
import type {
  DiffsEditorSelection,
  DiffsThemeNames,
  FileContents,
  OpenedFile,
  ThemesType,
  ThemeTypes,
  Workspace,
  WorkspaceStorage,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import type { WorkerPoolManager } from '../worker';
import { VirtualizedFile } from './VirtualizedFile';
import { Virtualizer } from './Virtualizer';

export type {
  OpenedFile,
  Workspace,
  WorkspaceFileSystem,
  WorkspaceStorage,
} from '../types';

interface EditorStorageScrollState {
  left: number;
  top: number;
}

interface EditorStoredFileState {
  contents?: string;
  scroll?: EditorStorageScrollState;
  selections?: DiffsEditorSelection[];
}

interface EditorSubscriber<T> {
  push(data: T): void;
  close(): void;
}

export interface CodeEditorOptions extends EditorOptions<undefined> {
  theme?: DiffsThemeNames | ThemesType;
  overflow?: 'scroll' | 'wrap'; // 'scroll' is default
  themeType?: ThemeTypes; // 'system' is default
  autoSave?: 'onBlur' | 'afterDelay' | 'never';
  autoSaveDelay?: number;
  overscrollSize?: number;
  workspace?: Workspace;
  workerPoolManager?: WorkerPoolManager;
}

export class CodeEditor extends Editor<undefined> {
  private fileContainer?: HTMLElement;
  private fileInstance?: VirtualizedFile;
  private workspace?: Workspace;
  private userOnChange?: CodeEditorOptions['onChange'];
  private userOnBlur?: CodeEditorOptions['onBlur'];
  private autoSave: 'onBlur' | 'afterDelay' | 'never' = 'never';
  private autoSaveDelay: number = 1_000; // 1 second
  private openedFilesSnapshot: OpenedFile[] = [];
  private openedFilesSubscribers = new Set<EditorSubscriber<OpenedFile[]>>();
  private openedFileContents = new Map<string, FileContents>();
  private savedContents = new Map<string, string>();
  private storedFileStates = new Map<string, EditorStoredFileState>();
  private autoSaveTimer?: ReturnType<typeof setTimeout>;
  private scrollSaveTimer?: ReturnType<typeof setTimeout>;
  private storage?: WorkspaceStorage;
  private wrapper?: HTMLElement;
  private overscrollSize?: number;
  private currentFile?: FileContents;
  private workerPoolManager?: WorkerPoolManager;
  private theme?: DiffsThemeNames | ThemesType;
  private overflow?: 'scroll' | 'wrap';
  private themeType?: ThemeTypes;

  constructor(options: CodeEditorOptions = {}) {
    const editorOptions = {
      ...options,
      onChange: (file, lineAnnotations) => {
        this.userOnChange?.(file, lineAnnotations);
        this.onFileChange(file);
      },
      onBlur: () => {
        this.userOnBlur?.();
        if (this.autoSave === 'onBlur') {
          void this.saveCurrentFileIfDirty();
        }
      },
    } satisfies CodeEditorOptions;

    super(editorOptions);

    this.setOptions(options);
  }

  /**
   * Render the editor into `root`. Call once to mount the editor UI and open
   * the initial file from `options.file`, or an untitled file when omitted.
   */
  render(root: HTMLElement, file?: FileContents): void {
    if (this.fileInstance != null) {
      throw new Error('Editor rendered.');
    }

    const wrapper = document.createElement('div');
    const overscrollSize = this.overscrollSize ?? 0;
    const virtualizer = new Virtualizer({
      overscrollSize,
      intersectionObserverMargin: overscrollSize * 4,
    });

    this.fileContainer = document.createElement(DIFFS_TAG_NAME);
    this.fileInstance = new VirtualizedFile<undefined>(
      {
        theme: this.theme,
        overflow: this.overflow,
        themeType: this.themeType,
        useTokenTransformer: true,
        disableFileHeader: true,
      },
      virtualizer,
      undefined,
      this.workerPoolManager
    );
    virtualizer.setup(wrapper);
    Object.assign(wrapper.style, {
      width: '100%',
      height: '100%',
      minHeight: '0',
      overflow: 'auto',
    });
    wrapper.addEventListener('scroll', this.onScroll, { passive: true });
    this.wrapper = wrapper;
    wrapper.appendChild(this.fileContainer);
    root.appendChild(wrapper);

    if (file == null) {
      // TODO(@ije): render placeholder
      return;
    }

    this.fileInstance.render({
      file,
      fileContainer: this.fileContainer,
    });
    this.edit(this.fileInstance);
    this.postOpenFile(file);
  }

  /**
   * Open a file from the workspace and display it in the editor.
   * Requires a `workspace` to be configured on construction.
   */
  async openFile(filename: string): Promise<void> {
    if (this.workspace == null) {
      throw new Error('Workspace is not set');
    }
    await this.persistCurrentFileState();
    let file = this.openedFileContents.get(filename);
    if (file == null) {
      const contents = await this.workspace.fs.read(filename);
      if (contents == null) {
        throw new Error('File not found');
      }
      const storedState = await this.loadStoredFileState(filename);
      this.savedContents.set(filename, contents);
      file = {
        name: filename,
        contents: storedState?.contents ?? contents,
        lang: getFiletypeFromFileName(filename),
        cacheKey: filename,
      };
      if (storedState != null) {
        this.storedFileStates.set(filename, storedState);
      }
    }
    this.fileInstance?.render({ file, fileContainer: this.fileContainer });
    this.postOpenFile(file);
    await this.restoreStoredState(filename);
  }

  override setOptions(options: CodeEditorOptions): void {
    if (options.onChange != null) {
      this.userOnChange = options.onChange;
    }
    if (options.onBlur != null) {
      this.userOnBlur = options.onBlur;
    }
    if (options.autoSave != null) {
      this.autoSave = options.autoSave ?? 'never';
    }
    if (options.autoSaveDelay != null) {
      this.autoSaveDelay = options.autoSaveDelay ?? 1_000; // 1 second
    }
    if (options.overscrollSize != null) {
      this.overscrollSize = options.overscrollSize;
    }
    if (options.workspace != null) {
      this.workspace = options.workspace;
      this.storage = resolveWorkspaceStorage(options.workspace);
    }
    if (options.workerPoolManager != null) {
      this.workerPoolManager = options.workerPoolManager;
    }

    this.theme = options.theme;
    this.overflow = options.overflow;
    this.themeType = options.themeType;

    super.setOptions({
      ...options,
      onChange: (file, lineAnnotations) => {
        this.userOnChange?.(file, lineAnnotations);
        this.onFileChange(file);
      },
      onBlur: () => {
        this.userOnBlur?.();
        if (this.autoSave === 'onBlur') {
          void this.saveCurrentFileIfDirty();
        }
      },
    });

    const fileOptions = {
      theme: this.theme,
      overflow: this.overflow,
      themeType: this.themeType,
      useTokenTransformer: true,
      disableFileHeader: true,
    };
    this.fileInstance?.setOptions(fileOptions);
    this.fileInstance?.rerender();
  }

  setThemeType(themeType: ThemeTypes): void {
    this.themeType = themeType;
    this.fileInstance?.setThemeType(themeType);
  }

  /**
   * Save an unsaved file to the workspace and update the `dirtyFiles` iterator.
   * No-ops when the file is already saved. Requires a `workspace` and that
   * `filename` matches the currently open file.
   */
  async save(filename: string): Promise<void> {
    if (this.workspace == null) {
      throw new Error('Workspace is not set');
    }
    const file = this.resolveFileForSave(filename);
    if (file == null) {
      throw new Error(`File not open: ${filename}`);
    }
    const key = this.fileKey(file);
    const contents = file.contents;
    if (this.savedContents.get(key) === contents) {
      return;
    }
    if (this.autoSaveTimer != null) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
    await this.workspace.fs.write(filename, contents);
    this.savedContents.set(key, contents);
    await this.persistCurrentFileState();
    this.syncDirtyState(file);
  }

  /**
   * Purge state held for the opened file.
   */
  closeFile(filename: string): void {
    void this.persistCurrentFileState();
    this.openedFileContents.delete(filename);
    this.savedContents.delete(filename);
    this.storedFileStates.delete(filename);
    const openedFiles = this.openedFilesSnapshot.filter(
      (file) => file.name !== filename
    );
    if (openedFiles.length === this.openedFilesSnapshot.length) {
      return;
    }
    this.openedFilesSnapshot = openedFiles;
    this.emitOpenedFiles();
  }

  override cleanUp(): void {
    if (this.autoSaveTimer != null) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
    if (this.scrollSaveTimer != null) {
      clearTimeout(this.scrollSaveTimer);
      this.scrollSaveTimer = undefined;
    }
    void this.persistCurrentFileState();
    for (const subscriber of this.openedFilesSubscribers) {
      subscriber.close();
    }
    this.openedFilesSubscribers.clear();
    this.openedFilesSnapshot = [];
    this.openedFileContents.clear();
    this.storedFileStates.clear();
    const fileInstance = this.fileInstance;
    this.fileInstance = undefined;
    this.wrapper?.removeEventListener('scroll', this.onScroll);
    this.wrapper = undefined;
    super.cleanUp();
    fileInstance?.cleanUp();
  }

  public get openedFiles(): AsyncIterable<OpenedFile[]> {
    const subscribers = this.openedFilesSubscribers;
    return {
      [Symbol.asyncIterator]: () => {
        let pending:
          | ((result: IteratorResult<OpenedFile[]>) => void)
          | undefined;
        let closed = false;
        const queue: OpenedFile[][] = [this.openedFilesSnapshot];

        const subscriber: EditorSubscriber<OpenedFile[]> = {
          push: (value) => {
            if (closed) {
              return;
            }
            if (pending != null) {
              pending({ value, done: false });
              pending = undefined;
            } else {
              queue.push(value);
            }
          },
          close: () => {
            if (closed) {
              return;
            }
            closed = true;
            pending?.({ value: undefined, done: true });
            pending = undefined;
            subscribers.delete(subscriber);
          },
        };

        subscribers.add(subscriber);

        return {
          next: () => {
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            if (queue.length > 0) {
              return Promise.resolve({
                value: queue.shift()!,
                done: false,
              });
            }
            return new Promise<IteratorResult<OpenedFile[]>>((resolve) => {
              pending = resolve;
            });
          },
          return: () => {
            subscriber.close();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  private emitOpenedFiles(): void {
    const snapshot = this.openedFilesSnapshot;
    for (const subscriber of this.openedFilesSubscribers) {
      subscriber.push(snapshot);
    }
  }

  private onFileChange(file: FileContents): void {
    this.currentFile = file;
    this.openedFileContents.set(this.fileKey(file), file);
    this.syncDirtyState(file);
    void this.persistFileState(file);
    if (this.autoSave !== 'afterDelay' || this.workspace == null) {
      return;
    }
    const key = this.fileKey(file);
    if (this.savedContents.get(key) === file.contents) {
      return;
    }
    if (this.autoSaveTimer != null) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = setTimeout(() => {
      this.autoSaveTimer = undefined;
      void this.saveCurrentFileIfDirty(file);
    }, this.autoSaveDelay);
  }

  private postOpenFile(file: FileContents): void {
    const key = this.fileKey(file);
    this.openedFileContents.set(key, file);
    if (this.savedContents.has(key)) {
      this.currentFile = file;
      this.syncDirtyState(file);
      return;
    }
    this.currentFile = file;
    this.savedContents.set(this.fileKey(file), file.contents);
    this.syncDirtyState(file);
  }

  private onScroll = () => {
    if (this.currentFile == null) {
      return;
    }
    if (this.scrollSaveTimer != null) {
      clearTimeout(this.scrollSaveTimer);
    }
    this.scrollSaveTimer = setTimeout(() => {
      this.scrollSaveTimer = undefined;
      void this.persistCurrentFileState();
    }, 150);
  };

  private async persistCurrentFileState(): Promise<void> {
    if (this.currentFile == null) {
      return;
    }
    await this.persistFileState(this.currentFile);
  }

  private async persistFileState(file: FileContents): Promise<void> {
    if (this.storage == null) {
      return;
    }
    const key = this.fileKey(file);
    const savedContents = this.savedContents.get(key);
    const previousState = this.storedFileStates.get(key) ?? {};
    const nextState: EditorStoredFileState = {
      ...previousState,
      contents: savedContents === file.contents ? undefined : file.contents,
      scroll:
        this.currentFile?.name === file.name
          ? this.getScrollState()
          : undefined,
      selections:
        this.currentFile?.name === file.name
          ? this.getCurrentSelections()
          : previousState.selections,
    };

    if (
      nextState.contents == null &&
      nextState.scroll == null &&
      nextState.selections == null
    ) {
      this.storedFileStates.delete(key);
      await this.storage.remove(this.storageKey(key));
      return;
    }

    this.storedFileStates.set(key, nextState);
    await this.storage.set(this.storageKey(key), JSON.stringify(nextState));
  }

  private async loadStoredFileState(
    filename: string
  ): Promise<EditorStoredFileState | undefined> {
    if (this.storage == null) {
      return undefined;
    }
    const value = await this.storage.get(this.storageKey(filename));
    if (value == null) {
      return undefined;
    }
    try {
      return JSON.parse(value) as EditorStoredFileState;
    } catch {
      await this.storage.remove(this.storageKey(filename));
      return undefined;
    }
  }

  private async restoreStoredState(filename: string): Promise<void> {
    const state =
      this.storedFileStates.get(filename) ??
      (await this.loadStoredFileState(filename));
    if (state == null || this.currentFile?.name !== filename) {
      return;
    }
    this.storedFileStates.set(filename, state);
    if (
      state.contents != null &&
      this.currentFile.contents !== state.contents
    ) {
      const file = {
        ...this.currentFile,
        contents: state.contents,
      };
      this.fileInstance?.render({ file });
      this.postOpenFile(file);
    }
    if (state.selections != null) {
      this.setSelections(state.selections);
    }
    if (state.scroll != null) {
      requestAnimationFrame(() => {
        if (this.currentFile?.name !== filename) {
          return;
        }
        this.wrapper?.scrollTo({
          left: state.scroll?.left ?? 0,
          top: state.scroll?.top ?? 0,
        });
      });
    }
  }

  private getCurrentSelections(): EditorStoredFileState['selections'] {
    try {
      return this.getState().selections?.map((selection) => ({
        direction:
          selection.direction === -1
            ? 'backward'
            : selection.direction === 1
              ? 'forward'
              : 'none',
        end: selection.end,
        start: selection.start,
      }));
    } catch {
      return undefined;
    }
  }

  private getScrollState(): EditorStorageScrollState | undefined {
    const wrapper = this.wrapper;
    if (wrapper == null) {
      return undefined;
    }
    return {
      left: wrapper.scrollLeft,
      top: wrapper.scrollTop,
    };
  }

  private storageKey(filename: string): string {
    return `pierre-code-editor:${this.workspace?.id ?? ''}:${filename}`;
  }

  private syncDirtyState(file: FileContents): void {
    const key = this.fileKey(file);
    const saved = this.savedContents.get(key);
    const isEdited = saved !== file.contents;
    const fileIndex = this.openedFilesSnapshot.findIndex(
      (openedFile) => openedFile.name === file.name
    );
    if (
      fileIndex !== -1 &&
      this.openedFilesSnapshot[fileIndex]?.isEdited === isEdited
    ) {
      return;
    }
    if (fileIndex === -1) {
      this.openedFilesSnapshot = [
        ...this.openedFilesSnapshot,
        { name: file.name, isEdited },
      ];
    } else {
      const openedFiles = this.openedFilesSnapshot.slice();
      openedFiles[fileIndex] = {
        name: file.name,
        isEdited,
      };
      this.openedFilesSnapshot = openedFiles;
    }
    this.emitOpenedFiles();
  }

  private async saveCurrentFileIfDirty(file?: FileContents): Promise<void> {
    const target = file ?? this.currentFile;
    if (target == null) {
      return;
    }
    await this.save(target.name);
  }

  private resolveFileForSave(filename: string): FileContents | undefined {
    const openedFile = this.openedFileContents.get(filename);
    if (openedFile != null) {
      return openedFile;
    }
    const current = this.currentFile;
    if (current == null) {
      return undefined;
    }
    if (current.name === filename || current.cacheKey === filename) {
      return current;
    }
    return undefined;
  }

  private fileKey(file: FileContents): string {
    return file.cacheKey ?? file.name;
  }
}

function resolveWorkspaceStorage(
  workspace: Workspace | undefined
): WorkspaceStorage | undefined {
  if (workspace == null) {
    return undefined;
  }
  const storage = workspace.storage;
  if (typeof storage === 'object') {
    return storage;
  }
  if (storage === 'localStorage') {
    return new LocalStorage(workspace.id);
  }
  if (storage === 'indexedDB') {
    return new IndexedDBStorage(workspace.id);
  }
  return new InMemoryStorage(workspace.id);
}

const inMemoryKV = new Map<string, string>();

class InMemoryStorage implements WorkspaceStorage {
  readonly #prefix: string;

  constructor(workspaceId: string) {
    this.#prefix = `pierre-code-editor:${workspaceId}:`;
  }

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(inMemoryKV.get(this.#prefix + key));
  }

  set(key: string, value: string): Promise<void> {
    inMemoryKV.set(this.#prefix + key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    inMemoryKV.delete(this.#prefix + key);
    return Promise.resolve();
  }
}

class LocalStorage implements WorkspaceStorage {
  readonly #prefix: string;

  constructor(workspaceId: string) {
    this.#prefix = `pierre-code-editor:${workspaceId}:`;
  }

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(
      globalThis.localStorage.getItem(this.#prefix + key) ?? undefined
    );
  }

  set(key: string, value: string): Promise<void> {
    globalThis.localStorage.setItem(this.#prefix + key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    globalThis.localStorage.removeItem(this.#prefix + key);
    return Promise.resolve();
  }
}

const EDITOR_STORAGE_VERSION = 1;
const EDITOR_STORAGE_STORE = 'entries';

class IndexedDBStorage implements WorkspaceStorage {
  readonly #dbPromise: Promise<IDBDatabase>;

  constructor(workspaceId: string) {
    this.#dbPromise = openIndexedDB(
      `pierre-code-editor:${workspaceId}`,
      EDITOR_STORAGE_VERSION,
      (db) => {
        if (!db.objectStoreNames.contains(EDITOR_STORAGE_STORE)) {
          db.createObjectStore(EDITOR_STORAGE_STORE);
        }
      }
    );
  }

  async get(key: string): Promise<string | undefined> {
    const db = await this.#dbPromise;
    return promisifyIDBRequest<string | undefined>(
      db
        .transaction(EDITOR_STORAGE_STORE, 'readonly')
        .objectStore(EDITOR_STORAGE_STORE)
        .get(key)
    );
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.#dbPromise;
    await promisifyIDBRequest(
      db
        .transaction(EDITOR_STORAGE_STORE, 'readwrite')
        .objectStore(EDITOR_STORAGE_STORE)
        .put(value, key)
    );
  }

  async remove(key: string): Promise<void> {
    const db = await this.#dbPromise;
    await promisifyIDBRequest(
      db
        .transaction(EDITOR_STORAGE_STORE, 'readwrite')
        .objectStore(EDITOR_STORAGE_STORE)
        .delete(key)
    );
  }
}

function openIndexedDB(
  name: string,
  version: number,
  onUpgradeNeeded?: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
  const request = globalThis.indexedDB.open(name, version);
  request.onupgradeneeded = () => {
    onUpgradeNeeded?.(request.result);
  };
  return promisifyIDBRequest(request);
}

function promisifyIDBRequest<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
