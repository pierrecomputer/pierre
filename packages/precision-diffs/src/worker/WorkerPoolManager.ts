import { getSharedHighlighter, hasLoadedThemes } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  FileContents,
  FileDiffMetadata,
  LineDiffTypes,
  PJSHighlighter,
  PJSThemeNames,
  RenderDiffOptions,
  RenderFileOptions,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
  ThemesType,
} from '../types';
import { areThemesEqual } from '../utils/areThemesEqual';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getThemes } from '../utils/getThemes';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type {
  AllWorkerTasks,
  DiffRendererInstance,
  FileRendererInstance,
  InitializeWorkerTask,
  RenderDiffMetadataRequest,
  RenderDiffMetadataTask,
  RenderFileRequest,
  RenderFileTask,
  SubmitRequest,
  WorkerHighlighterOptions,
  WorkerPoolOptions,
  WorkerRequestId,
  WorkerResponse,
  WorkerStats,
} from './types';

const IGNORE_RESPONSE = Symbol('IGNORE_RESPONSE');

interface ManagedWorker {
  worker: Worker;
  busy: boolean;
  initialized: boolean;
  langs: Set<SupportedLanguages>;
}

interface ThemeSubscriber {
  rerender(): void;
}

export class WorkerPoolManager {
  private highlighter: PJSHighlighter | undefined;

  currentTheme: PJSThemeNames | ThemesType = DEFAULT_THEMES;

  private initialized: Promise<void> | boolean = false;
  private workers: ManagedWorker[] = [];
  private taskQueue: AllWorkerTasks[] = [];
  private pendingTasks = new Map<WorkerRequestId, AllWorkerTasks>();
  private nextRequestId = 0;
  private themeSubscribers = new Set<ThemeSubscriber>();
  private instanceRequestMap = new Map<
    FileRendererInstance | DiffRendererInstance,
    string
  >();

  constructor(
    private options: WorkerPoolOptions,
    private highlighterOptions: WorkerHighlighterOptions
  ) {
    void this.initialize();
  }

  async setTheme(theme: PJSThemeNames | ThemesType): Promise<void> {
    if (areThemesEqual(theme, this.currentTheme)) {
      return;
    }
    if (hasLoadedThemes(getThemes(theme)) && this.highlighter != null) {
      this.currentTheme = theme;
    } else {
      this.highlighter = await getSharedHighlighter({
        themes: getThemes(theme),
        langs: ['text'],
      });
      this.currentTheme = theme;
    }
    for (const instance of this.themeSubscribers) {
      instance.rerender();
    }
  }

  subscribeToThemeChanges(instance: ThemeSubscriber): () => void {
    this.themeSubscribers.add(instance);
    return () => {
      this.unsubscribeToThemeChanges(instance);
    };
  }

  unsubscribeToThemeChanges(instance: ThemeSubscriber): void {
    this.themeSubscribers.delete(instance);
  }

  isInitialized(): boolean {
    return this.initialized === true;
  }

  async initialize(): Promise<void> {
    if (this.initialized === true) {
      return;
    } else if (this.initialized === false) {
      this.initialized = new Promise((resolve, reject) => {
        void (async () => {
          try {
            const [highlighter] = await Promise.all([
              getSharedHighlighter({
                themes: getThemes(this.highlighterOptions.theme),
                preferWasmHighlighter:
                  this.highlighterOptions.preferWasmHighlighter,
                langs: ['text'],
              }),
              this.initializeWorkers(),
            ]);
            // If we were terminated while initializing, we should probably kill
            // any workers that may have been created
            if (this.initialized === false) {
              this.terminateWorkers();
              reject();
              return;
            }
            this.currentTheme = this.highlighterOptions.theme;
            this.highlighter = highlighter;
            this.initialized = true;
            this.drainQueue();
            resolve();
          } catch (e) {
            reject(e);
          }
        })();
      });
    } else {
      return this.initialized;
    }
  }

  private async initializeWorkers(): Promise<void> {
    const initPromises: Promise<unknown>[] = [];
    for (let i = 0; i < (this.options.poolSize ?? 8); i++) {
      const worker = this.options.workerFactory();
      const managedWorker: ManagedWorker = {
        worker,
        busy: false,
        initialized: false,
        langs: new Set(['text', ...(this.highlighterOptions.langs ?? [])]),
      };
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(managedWorker, event.data);
        }
      );
      worker.addEventListener('error', (error) =>
        console.error('Worker error:', error)
      );
      this.workers.push(managedWorker);
      initPromises.push(
        new Promise<void>((resolve, reject) => {
          const requestId = this.generateRequestId();
          const task: InitializeWorkerTask = {
            type: 'initialize',
            id: requestId,
            request: {
              type: 'initialize',
              id: requestId,
              options: this.highlighterOptions,
            },
            resolve() {
              managedWorker.initialized = true;
              resolve();
            },
            reject,
            requestStart: Date.now(),
          };
          this.pendingTasks.set(requestId, task);
          this.executeTask(managedWorker, task);
        })
      );
    }
    await Promise.all(initPromises);
  }

  private drainQueue = () => {
    this._queuedDrain = undefined;
    // If we are initializing or things got cancelled while initializing, we
    // should not attempt to drain the queue
    if (this.initialized !== true || this.taskQueue.length === 0) {
      return;
    }
    while (this.taskQueue.length > 0) {
      const task = this.taskQueue[0];
      const availableWorker = this.getAvailableWorker(getLangsFromTask(task));
      if (availableWorker == null) {
        break;
      }
      this.taskQueue.shift();
      this.executeTask(availableWorker, task);
    }
  };

  highlightFileAST(
    instance: FileRendererInstance,
    file: FileContents,
    options: Omit<RenderFileOptions, 'theme'>
  ): void {
    this.submitTask(instance, {
      type: 'file',
      file,
      options: { ...options, theme: this.currentTheme },
    });
  }

  getPlainFileAST(
    file: FileContents,
    startingLineNumber: number = 1
  ): ThemedFileResult | undefined {
    if (this.highlighter == null) {
      void this.initialize();
      return undefined;
    }
    return renderFileWithHighlighter(file, this.highlighter, {
      lang: 'text',
      startingLineNumber,
      theme: this.currentTheme,
      tokenizeMaxLineLength: 1000,
    });
  }

  highlightDiffAST(
    instance: DiffRendererInstance,
    diff: FileDiffMetadata,
    options: Omit<RenderDiffOptions, 'theme'>
  ): void {
    this.submitTask(instance, {
      type: 'diff',
      diff,
      options: { ...options, theme: this.currentTheme },
    });
  }

  getPlainDiffAST(
    diff: FileDiffMetadata,
    lineDiffType: LineDiffTypes
  ): ThemedDiffResult | undefined {
    return this.highlighter != null
      ? renderDiffWithHighlighter(diff, this.highlighter, {
          theme: this.currentTheme,
          lang: 'text',
          tokenizeMaxLineLength: 1000,
          lineDiffType,
        })
      : undefined;
  }

  terminate(): void {
    this.terminateWorkers();
    this.instanceRequestMap.clear();
    this.taskQueue.length = 0;
    this.pendingTasks.clear();
    this.highlighter = undefined;
    this.initialized = false;
  }

  private terminateWorkers() {
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers.length = 0;
  }

  getStats(): WorkerStats {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.busy).length,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
    };
  }

  private submitTask(
    instance: FileRendererInstance,
    request: Omit<RenderFileRequest, 'id'>
  ): void;
  private submitTask(
    instance: DiffRendererInstance,
    request: Omit<RenderDiffMetadataRequest, 'id'>
  ): void;
  private submitTask(
    instance: FileRendererInstance | DiffRendererInstance,
    request: SubmitRequest
  ): void {
    if (this.initialized === false) {
      void this.initialize();
    }

    const id = this.generateRequestId();
    const requestStart = Date.now();
    const task: RenderFileTask | RenderDiffMetadataTask = (() => {
      switch (request.type) {
        case 'file':
          return {
            type: 'file',
            id,
            request: { ...request, id },
            instance: instance as FileRendererInstance,
            requestStart,
          };
        case 'diff':
          return {
            type: 'diff',
            id,
            request: { ...request, id },
            instance: instance as DiffRendererInstance,
            requestStart,
          };
      }
    })();

    this.instanceRequestMap.set(instance, id);
    const availableWorker = this.getAvailableWorker(getLangsFromTask(task));
    if (availableWorker != null) {
      this.executeTask(availableWorker, task);
    } else {
      this.taskQueue.push(task);
    }
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerResponse
  ): void {
    const task = this.pendingTasks.get(response.id);
    try {
      if (task == null) {
        throw new Error(
          'handleWorkerMessage: Received response for unknown task'
        );
      } else if (response.type === 'error') {
        const error = new Error(response.error);
        if (response.stack) {
          error.stack = response.stack;
        }
        if ('reject' in task) {
          task.reject(error);
        } else {
          task.instance.onHighlightError(error);
        }
        throw error;
      } else {
        // If we've gotten a newer request from the same instance, we should
        // ignore this response either because it's out of order or because we
        // have a newer more important request
        if (
          'instance' in task &&
          this.instanceRequestMap.get(task.instance) !== response.id
        ) {
          throw IGNORE_RESPONSE;
        }
        switch (response.requestType) {
          case 'initialize':
            if (task.type !== 'initialize') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve();
            break;
          case 'file': {
            if (task.type !== 'file') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            const { result } = response;
            const { instance, request } = task;
            instance.onHighlightSuccess(request.file, result, request.options);
            break;
          }
          case 'diff': {
            if (task.type !== 'diff') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            const { result } = response;
            const { instance, request } = task;
            instance.onHighlightSuccess(request.diff, result, request.options);
            break;
          }
        }
      }
    } catch (error) {
      if (error !== IGNORE_RESPONSE) {
        console.error(error, task, response);
      }
    }

    if (
      task != null &&
      'instance' in task &&
      this.instanceRequestMap.get(task.instance) === response.id
    ) {
      this.instanceRequestMap.delete(task.instance);
    }
    this.pendingTasks.delete(response.id);
    managedWorker.busy = false;
    if (this.taskQueue.length > 0) {
      // We queue drain so that potentially multiple workers can free up
      // allowing for better language matches if possible
      this.queueDrain();
    }
  }

  private _queuedDrain: Promise<void> | undefined;
  private queueDrain() {
    if (this._queuedDrain != null) return;
    this._queuedDrain = Promise.resolve().then(this.drainQueue);
  }

  private executeTask(
    managedWorker: ManagedWorker,
    task: AllWorkerTasks
  ): void {
    managedWorker.busy = true;
    this.pendingTasks.set(task.id, task);
    for (const lang of getLangsFromTask(task)) {
      managedWorker.langs.add(lang);
    }
    managedWorker.worker.postMessage(task.request);
  }

  private getAvailableWorker(
    langs: SupportedLanguages[]
  ): ManagedWorker | undefined {
    let worker: ManagedWorker | undefined;
    for (const managedWorker of this.workers) {
      if (managedWorker.busy || !managedWorker.initialized) {
        continue;
      }
      worker = managedWorker;
      if (langs.length === 0) {
        break;
      }
      let hasEveryLang = true;
      for (const lang of langs) {
        if (!managedWorker.langs.has(lang)) {
          hasEveryLang = false;
          break;
        }
      }
      if (hasEveryLang) {
        break;
      }
    }
    return worker;
  }

  private generateRequestId(): WorkerRequestId {
    return `req_${++this.nextRequestId}`;
  }
}

function getLangsFromTask(task: AllWorkerTasks): SupportedLanguages[] {
  const langs = new Set<SupportedLanguages>();
  const options = task.request.options ?? {};
  if ('lang' in options && options.lang != null) {
    langs.add(options.lang);
  } else {
    switch (task.type) {
      case 'file': {
        langs.add(getFiletypeFromFileName(task.request.file.name));
        break;
      }
      case 'diff': {
        langs.add(getFiletypeFromFileName(task.request.diff.name));
        langs.add(getFiletypeFromFileName(task.request.diff.prevName ?? '-'));
        break;
      }
    }
  }
  langs.delete('text');
  return Array.from(langs);
}
