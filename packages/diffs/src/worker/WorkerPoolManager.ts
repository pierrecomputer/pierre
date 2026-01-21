import LRUMapPkg from 'lru_map';

import { DEFAULT_THEMES } from '../constants';
import { getResolvedLanguages } from '../highlighter/languages/getResolvedLanguages';
import { hasResolvedLanguages } from '../highlighter/languages/hasResolvedLanguages';
import { resolveLanguages } from '../highlighter/languages/resolveLanguages';
import { getSharedHighlighter } from '../highlighter/shared_highlighter';
import { attachResolvedThemes } from '../highlighter/themes/attachResolvedThemes';
import { getResolvedThemes } from '../highlighter/themes/getResolvedThemes';
import { hasResolvedThemes } from '../highlighter/themes/hasResolvedThemes';
import { resolveThemes } from '../highlighter/themes/resolveThemes';
import type {
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  HunkExpansionRegion,
  RenderDiffOptions,
  RenderDiffResult,
  RenderFileOptions,
  RenderFileResult,
  SupportedLanguages,
  ThemeRegistrationResolved,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
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
  RenderDiffRequest,
  RenderDiffTask,
  RenderFileRequest,
  RenderFileTask,
  ResolvedLanguage,
  SetRenderOptionsWorkerTask,
  SubmitRequest,
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
  WorkerRenderingOptions,
  WorkerRequestId,
  WorkerResponse,
  WorkerStats,
} from './types';

const IGNORE_RESPONSE = Symbol('IGNORE_RESPONSE');

interface GetCachesResult {
  fileCache: LRUMapPkg.LRUMap<string, RenderFileResult>;
  diffCache: LRUMapPkg.LRUMap<string, RenderDiffResult>;
}

interface ManagedWorker {
  worker: Worker;
  request_id: string | undefined;
  initialized: boolean;
  langs: Set<SupportedLanguages>;
}

interface ThemeSubscriber {
  rerender(): void;
}

export class WorkerPoolManager {
  private highlighter: DiffsHighlighter | undefined;
  private renderOptions: WorkerRenderingOptions;
  private initialized: Promise<void> | boolean = false;
  private workers: ManagedWorker[] = [];
  private taskQueue: AllWorkerTasks[] = [];
  private pendingTasks = new Map<WorkerRequestId, AllWorkerTasks>();
  private nextRequestId = 0;
  private themeSubscribers = new Set<ThemeSubscriber>();
  private workersFailed = false;
  private instanceRequestMap = new Map<
    FileRendererInstance | DiffRendererInstance,
    string
  >();
  private statSubscribers = new Set<(stats: WorkerStats) => unknown>();
  private fileCache: LRUMapPkg.LRUMap<string, RenderFileResult>;
  private diffCache: LRUMapPkg.LRUMap<string, RenderDiffResult>;
  private _queuedBroadcast: number | undefined;

  constructor(
    private options: WorkerPoolOptions,
    {
      langs,
      theme = DEFAULT_THEMES,
      lineDiffType = 'word-alt',
      tokenizeMaxLineLength = 1000,
    }: WorkerInitializationRenderOptions
  ) {
    this.renderOptions = { theme, lineDiffType, tokenizeMaxLineLength };
    this.fileCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
    this.diffCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
    void this.initialize(langs);
  }

  isWorkingPool(): boolean {
    return !this.workersFailed;
  }

  getFileResultCache(file: FileContents): RenderFileResult | undefined {
    return file.cacheKey != null
      ? this.fileCache.get(file.cacheKey)
      : undefined;
  }

  getDiffResultCache(diff: FileDiffMetadata): RenderDiffResult | undefined {
    return diff.cacheKey != null
      ? this.diffCache.get(diff.cacheKey)
      : undefined;
  }

  inspectCaches(): GetCachesResult {
    const { fileCache, diffCache } = this;
    return { fileCache, diffCache };
  }

  evictFileFromCache(cacheKey: string): boolean {
    try {
      return this.fileCache.delete(cacheKey) !== undefined;
    } finally {
      this.queueBroadcastStateChanges();
    }
  }

  evictDiffFromCache(cacheKey: string): boolean {
    try {
      return this.diffCache.delete(cacheKey) !== undefined;
    } finally {
      this.queueBroadcastStateChanges();
    }
  }

  async setRenderOptions({
    theme = DEFAULT_THEMES,
    lineDiffType = 'word-alt',
    tokenizeMaxLineLength = 1000,
  }: Partial<WorkerRenderingOptions>): Promise<void> {
    const newRenderOptions: WorkerRenderingOptions = {
      theme,
      lineDiffType,
      tokenizeMaxLineLength,
    };
    if (!this.isInitialized()) {
      await this.initialize();
    }
    const themesEqual = areThemesEqual(
      newRenderOptions.theme,
      this.renderOptions.theme
    );
    if (
      themesEqual &&
      newRenderOptions.lineDiffType === this.renderOptions.lineDiffType &&
      newRenderOptions.tokenizeMaxLineLength ===
        this.renderOptions.tokenizeMaxLineLength
    ) {
      return;
    }

    const themeNames = getThemes(theme);
    let resolvedThemes: ThemeRegistrationResolved[] = [];
    if (!themesEqual) {
      if (hasResolvedThemes(themeNames)) {
        resolvedThemes = getResolvedThemes(themeNames);
      } else {
        resolvedThemes = await resolveThemes(themeNames);
      }
    }

    if (this.highlighter != null) {
      attachResolvedThemes(resolvedThemes, this.highlighter);
      await this.setRenderOptionsOnWorkers(newRenderOptions, resolvedThemes);
    } else {
      const [highlighter] = await Promise.all([
        getSharedHighlighter({ themes: themeNames, langs: ['text'] }),
        this.setRenderOptionsOnWorkers(newRenderOptions, resolvedThemes),
      ]);
      this.highlighter = highlighter;
    }

    this.renderOptions = newRenderOptions;
    this.diffCache.clear();
    this.fileCache.clear();

    for (const instance of this.themeSubscribers) {
      instance.rerender();
    }
  }

  getFileRenderOptions(): RenderFileOptions {
    const { tokenizeMaxLineLength, theme } = this.renderOptions;
    return { theme, tokenizeMaxLineLength };
  }

  getDiffRenderOptions(): RenderDiffOptions {
    return { ...this.renderOptions };
  }

  private async setRenderOptionsOnWorkers(
    renderOptions: WorkerRenderingOptions,
    resolvedThemes: ThemeRegistrationResolved[]
  ): Promise<void> {
    if (this.workersFailed) {
      return;
    }
    if (!this.isInitialized()) {
      await this.initialize();
    }
    const taskPromises: Promise<void>[] = [];
    for (const managedWorker of this.workers) {
      if (!managedWorker.initialized) {
        console.log({ managedWorker });
        throw new Error(
          'setRenderOptionsOnWorkers: Somehow we have an uninitialized worker'
        );
      }
      taskPromises.push(
        new Promise<void>((resolve, reject) => {
          const id = this.generateRequestId();
          const task: SetRenderOptionsWorkerTask = {
            type: 'set-render-options',
            id,
            request: {
              type: 'set-render-options',
              id,
              renderOptions,
              resolvedThemes,
            },
            resolve,
            reject,
            requestStart: Date.now(),
          };
          // NOTE(amadeus): We intentionally ignore the normal pending requests
          // infra because these tasks should technically interrupt the normal
          // flow and should be processed by the worker when ready immediately
          this.pendingTasks.set(id, task);
          managedWorker.worker.postMessage(task.request);
        })
      );
    }
    await Promise.all(taskPromises);
  }

  subscribeToThemeChanges(instance: ThemeSubscriber): () => void {
    this.themeSubscribers.add(instance);
    this.queueBroadcastStateChanges();
    return () => {
      this.unsubscribeToThemeChanges(instance);
      this.queueBroadcastStateChanges();
    };
  }

  unsubscribeToThemeChanges(instance: ThemeSubscriber): void {
    this.themeSubscribers.delete(instance);
    this.queueBroadcastStateChanges();
  }

  subscribeToStatChanges(
    callback: (stats: WorkerStats) => unknown
  ): () => void {
    this.statSubscribers.add(callback);
    callback(this.getStats());
    return () => {
      this.statSubscribers.delete(callback);
    };
  }

  private queueBroadcastStateChanges() {
    if (this._queuedBroadcast != null) return;
    this._queuedBroadcast = requestAnimationFrame(this._broadcastStateChanges);
  }

  private _broadcastStateChanges = () => {
    if (this._queuedBroadcast != null) {
      cancelAnimationFrame(this._queuedBroadcast);
      this._queuedBroadcast = undefined;
    }
    const stats = this.getStats();
    for (const callback of this.statSubscribers) {
      callback(stats);
    }
  };

  cleanUpPendingTasks(
    instance: FileRendererInstance | DiffRendererInstance
  ): void {
    this.taskQueue = this.taskQueue.filter((task) => {
      if ('instance' in task) {
        return task.instance !== instance;
      }
      return true;
    });
    for (const [id, task] of Array.from(this.pendingTasks)) {
      if ('instance' in task && task.instance === instance) {
        this.pendingTasks.delete(id);
      }
    }
    this.queueBroadcastStateChanges();
  }

  isInitialized(): boolean {
    return this.initialized === true;
  }

  async initialize(languages: SupportedLanguages[] = []): Promise<void> {
    if (this.initialized === true) {
      return;
    } else if (this.initialized === false) {
      this.initialized = new Promise((resolve, reject) => {
        void (async () => {
          try {
            const themes = getThemes(this.renderOptions.theme);
            let resolvedThemes: ThemeRegistrationResolved[] = [];
            if (hasResolvedThemes(themes)) {
              resolvedThemes = getResolvedThemes(themes);
            } else {
              resolvedThemes = await resolveThemes(themes);
            }

            let resolvedLanguages: ResolvedLanguage[] = [];
            if (hasResolvedLanguages(languages)) {
              resolvedLanguages = getResolvedLanguages(languages);
            } else {
              resolvedLanguages = await resolveLanguages(languages);
            }

            const [highlighter] = await Promise.all([
              getSharedHighlighter({ themes, langs: ['text', ...languages] }),
              this.initializeWorkers(resolvedThemes, resolvedLanguages),
            ]);

            // If we were terminated while initializing, we should probably kill
            // any workers that may have been created
            if (this.initialized === false) {
              this.terminateWorkers();
              throw new Error(
                'WorkerPoolManager: workers failed to initialize'
              );
            }
            this.highlighter = highlighter;
            this.initialized = true;
            this.diffCache.clear();
            this.fileCache.clear();
            this.drainQueue();
            this.queueBroadcastStateChanges();
            resolve();
          } catch (e) {
            this.initialized = false;
            this.workersFailed = true;
            this.queueBroadcastStateChanges();
            reject(e);
          }
        })();
      });
      this.queueBroadcastStateChanges();
    } else {
      return this.initialized;
    }
  }

  private async initializeWorkers(
    resolvedThemes: ThemeRegistrationResolved[],
    resolvedLanguages: ResolvedLanguage[]
  ): Promise<void> {
    this.workersFailed = false;
    const initPromises: Promise<unknown>[] = [];
    if (this.workers.length > 0) {
      this.terminateWorkers();
    }
    for (let i = 0; i < (this.options.poolSize ?? 8); i++) {
      const worker = this.options.workerFactory();
      const managedWorker: ManagedWorker = {
        worker,
        request_id: undefined,
        initialized: false,
        langs: new Set(['text', ...resolvedLanguages.map(({ name }) => name)]),
      };
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(managedWorker, event.data);
        }
      );
      worker.addEventListener('error', (error) =>
        console.error('Worker error:', error, managedWorker)
      );
      this.workers.push(managedWorker);
      initPromises.push(
        new Promise<void>((resolve, reject) => {
          const id = this.generateRequestId();
          const task: InitializeWorkerTask = {
            type: 'initialize',
            id,
            request: {
              type: 'initialize',
              id,
              renderOptions: this.renderOptions,
              resolvedThemes,
              resolvedLanguages,
            },
            resolve() {
              managedWorker.initialized = true;
              resolve();
            },
            reject,
            requestStart: Date.now(),
          };
          this.pendingTasks.set(id, task);
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
      const langs = getLangsFromTask(task);
      const availableWorker = this.getAvailableWorker(langs);
      if (availableWorker == null) {
        break;
      }
      this.assignWorkerToTask(task, availableWorker);
      this.taskQueue.shift();
      void this.resolveLanguagesAndExecuteTask(availableWorker, task, langs);
    }
    this.queueBroadcastStateChanges();
  };

  highlightFileAST(instance: FileRendererInstance, file: FileContents): void {
    const computedLang = file.lang ?? getFiletypeFromFileName(file.name);
    if (computedLang === 'text') return;
    // If we already have a task in progress for this same file content, we
    // should drop it
    for (const tasks of [this.taskQueue, this.pendingTasks.values()]) {
      for (const task of tasks) {
        if (
          'instance' in task &&
          task.instance === instance &&
          task.request.type === 'file' &&
          areFilesEqual(file, task.request.file)
        ) {
          return;
        }
      }
    }
    this.submitTask(instance, { type: 'file', file });
  }

  getPlainFileAST(file: FileContents): ThemedFileResult | undefined {
    if (this.highlighter == null) {
      void this.initialize();
      return undefined;
    }
    return renderFileWithHighlighter(
      file,
      this.highlighter,
      this.renderOptions,
      true
    );
  }

  highlightDiffAST(
    instance: DiffRendererInstance,
    diff: FileDiffMetadata
  ): void {
    const computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
    if (computedLang === 'text') return;
    // If we already have a task in progress for this same diff content, we
    // should ignore executing it again
    for (const tasks of [this.taskQueue, this.pendingTasks.values()]) {
      for (const task of tasks) {
        if (
          'instance' in task &&
          task.instance === instance &&
          task.request.type === 'diff' &&
          task.request.diff === diff
        ) {
          return;
        }
      }
    }
    this.submitTask(instance, { type: 'diff', diff });
  }

  getPlainDiffAST(
    diff: FileDiffMetadata,
    startingLine: number,
    totalLines: number,
    expandedHunks?: Map<number, HunkExpansionRegion> | true
  ): ThemedDiffResult | undefined {
    return this.highlighter != null
      ? renderDiffWithHighlighter(diff, this.highlighter, this.renderOptions, {
          forcePlainText: true,
          startingLine,
          totalLines,
          expandedHunks,
        })
      : undefined;
  }

  terminate(): void {
    this.terminateWorkers();
    this.fileCache.clear();
    this.diffCache.clear();
    this.instanceRequestMap.clear();
    this.taskQueue.length = 0;
    this.pendingTasks.clear();
    this.highlighter = undefined;
    this.initialized = false;
    this.workersFailed = false;
    this.queueBroadcastStateChanges();
  }

  private terminateWorkers() {
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers.length = 0;
  }

  getStats(): WorkerStats {
    return {
      managerState: (() => {
        if (this.initialized === false) {
          return 'waiting';
        }
        if (this.initialized !== true) {
          return 'initializing';
        }
        return 'initialized';
      })(),
      totalWorkers: this.workers.length,
      workersFailed: this.workersFailed,
      busyWorkers: this.workers.filter((w) => w.request_id != null).length,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
      themeSubscribers: this.themeSubscribers.size,
      fileCacheSize: this.fileCache.size,
      diffCacheSize: this.diffCache.size,
    };
  }

  private submitTask(
    instance: FileRendererInstance,
    request: Omit<RenderFileRequest, 'id'>
  ): void;
  private submitTask(
    instance: DiffRendererInstance,
    request: Omit<RenderDiffRequest, 'id'>
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
    const task: RenderFileTask | RenderDiffTask = (() => {
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
    this.taskQueue.push(task);
    this.queueDrain();
  }

  private async resolveLanguagesAndExecuteTask(
    availableWorker: ManagedWorker,
    task: AllWorkerTasks,
    langs: SupportedLanguages[]
  ): Promise<void> {
    // Add resolved languages if required
    if (task.type === 'file' || task.type === 'diff') {
      const workerMissingLangs = langs.filter(
        (lang) => !availableWorker.langs.has(lang)
      );

      if (workerMissingLangs.length > 0) {
        if (hasResolvedLanguages(workerMissingLangs)) {
          task.request.resolvedLanguages =
            getResolvedLanguages(workerMissingLangs);
        } else {
          task.request.resolvedLanguages =
            await resolveLanguages(workerMissingLangs);
        }
      }
    }
    this.executeTask(availableWorker, task);
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerResponse
  ): void {
    const task = this.pendingTasks.get(response.id);
    try {
      if (task == null) {
        // If we can't find a task for this response, it probably means the
        // component has been unmounted, so we should silently ignore it
        throw IGNORE_RESPONSE;
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
          case 'set-render-options':
            if (task.type !== 'set-render-options') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve();
            break;
          case 'file': {
            if (task.type !== 'file') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            const { result, options } = response;
            const { instance, request } = task;
            if (request.file.cacheKey != null) {
              this.fileCache.set(request.file.cacheKey, { result, options });
            }
            instance.onHighlightSuccess(request.file, result, options);
            break;
          }
          case 'diff': {
            if (task.type !== 'diff') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            const { result, options } = response;
            const { instance, request } = task;
            if (request.diff.cacheKey != null) {
              this.diffCache.set(request.diff.cacheKey, { result, options });
            }
            instance.onHighlightSuccess(request.diff, result, options);
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
    managedWorker.request_id = undefined;
    this.queueBroadcastStateChanges();
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
    this.queueBroadcastStateChanges();
  }

  private assignWorkerToTask(
    task: AllWorkerTasks,
    managedWorker: ManagedWorker
  ) {
    managedWorker.request_id = task.id;
    this.pendingTasks.set(task.id, task);
  }

  private executeTask(
    managedWorker: ManagedWorker,
    task: AllWorkerTasks
  ): void {
    this.assignWorkerToTask(task, managedWorker);
    for (const lang of getLangsFromTask(task)) {
      managedWorker.langs.add(lang);
    }
    try {
      managedWorker.worker.postMessage(task.request);
    } catch (error) {
      // If postMessage fails, clean up the worker state
      managedWorker.request_id = undefined;
      this.pendingTasks.delete(task.id);
      console.error('Failed to post message to worker:', error);
      if ('instance' in task) {
        task.instance.onHighlightError(error);
      } else if ('reject' in task) {
        task.reject(error as Error);
      }
    }
    this.queueBroadcastStateChanges();
  }

  private getAvailableWorker(
    langs: SupportedLanguages[]
  ): ManagedWorker | undefined {
    let worker: ManagedWorker | undefined;
    for (const managedWorker of this.workers) {
      if (managedWorker.request_id != null || !managedWorker.initialized) {
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
  if (task.type === 'initialize' || task.type === 'set-render-options') {
    return [];
  }
  switch (task.type) {
    case 'file': {
      langs.add(
        task.request.file.lang ??
          getFiletypeFromFileName(task.request.file.name)
      );
      break;
    }
    case 'diff': {
      langs.add(
        task.request.diff.lang ??
          getFiletypeFromFileName(task.request.diff.name)
      );
      langs.add(
        task.request.diff.lang ??
          getFiletypeFromFileName(task.request.diff.prevName ?? '-')
      );
      break;
    }
  }
  langs.delete('text');
  return Array.from(langs);
}
