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
  HighlighterTypes,
  HunkExpansionRegion,
  RenderDiffOptions,
  RenderDiffResult,
  RenderFileOptions,
  RenderFileResult,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
  ThemeRegistrationResolved,
} from '../types';
import { areDiffRenderOptionsEqual } from '../utils/areDiffRenderOptionsEqual';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areFileRenderOptionsEqual } from '../utils/areFileRenderOptionsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import {
  getCustomExtensionsMap,
  getCustomExtensionsVersion,
  getFiletypeFromFileName,
} from '../utils/getFiletypeFromFileName';
import { getThemes } from '../utils/getThemes';
import { isDiffPlainText } from '../utils/isDiffPlainText';
import { isFilePlainText } from '../utils/isFilePlainText';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type {
  AllWorkerTasks,
  DiffRendererInstance,
  FileRendererInstance,
  InitializeWorkerRequest,
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

class WorkerPoolTerminatedError extends Error {
  constructor() {
    super('WorkerPoolManager: operation canceled because the pool terminated');
  }
}

interface GetCachesResult {
  fileCache: LRUMapPkg.LRUMap<string, RenderFileResult>;
  diffCache: LRUMapPkg.LRUMap<string, RenderDiffResult>;
}

interface ManagedWorker {
  worker: Worker;
  request_id: string | undefined;
  initialized: boolean;
  langs: Set<SupportedLanguages>;
  customExtensionsVersion: number;
}

interface ThemeSubscriber {
  rerender(): void;
}

type RenderTask = RenderFileTask | RenderDiffTask;

type RenderTaskInstance = FileRendererInstance | DiffRendererInstance;

export class WorkerPoolManager {
  private highlighter: DiffsHighlighter | undefined;
  private readonly preferredHighlighter: HighlighterTypes;
  private renderOptions: WorkerRenderingOptions;
  private renderOptionsVersion = 0;
  private initialized: Promise<void> | boolean = false;
  private workers: ManagedWorker[] = [];
  // Tasks that are waiting to get processed by a worker
  private queuedTasks: RenderTask[] = [];
  private queuedTaskByInstance = new Map<RenderTaskInstance, RenderTask>();

  // Tasks that map to highlightKey are essentially singular, so we only
  // need one map to include queued and active
  private taskByHighlightKey = new Map<string, RenderTask>();

  // Tasks that have already been sent to a worker and are awaiting a response.
  private activeTaskById = new Map<WorkerRequestId, AllWorkerTasks>();
  private activeRequestByInstance = new Map<
    RenderTaskInstance,
    WorkerRequestId
  >();

  private nextRequestId = 0;
  private themeSubscribers = new Set<ThemeSubscriber>();
  private workersFailed = false;
  private statSubscribers = new Set<(stats: WorkerStats) => unknown>();
  private fileCache: LRUMapPkg.LRUMap<string, RenderFileResult>;
  private diffCache: LRUMapPkg.LRUMap<string, RenderDiffResult>;
  private _queuedBroadcast: number | undefined;
  // Incremented on terminate so async lifecycle work can identify stale results.
  private lifecycleGeneration = 0;

  constructor(
    private options: WorkerPoolOptions,
    {
      langs,
      theme = DEFAULT_THEMES,
      useTokenTransformer = false,
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      tokenizeMaxLineLength = 1000,
      preferredHighlighter = 'shiki-js',
    }: WorkerInitializationRenderOptions
  ) {
    this.preferredHighlighter = preferredHighlighter;
    this.renderOptions = {
      theme,
      useTokenTransformer,
      lineDiffType,
      maxLineDiffLength,
      tokenizeMaxLineLength,
    };
    this.fileCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
    this.diffCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
    this.queueInitialization(langs);
  }

  public isWorkingPool(): boolean {
    return !this.workersFailed;
  }

  public getFileResultCache(file: FileContents): RenderFileResult | undefined {
    return file.cacheKey != null
      ? this.fileCache.get(file.cacheKey)
      : undefined;
  }

  public getDiffResultCache(
    diff: FileDiffMetadata
  ): RenderDiffResult | undefined {
    return diff.cacheKey != null
      ? this.diffCache.get(diff.cacheKey)
      : undefined;
  }

  public inspectCaches(): GetCachesResult {
    const { fileCache, diffCache } = this;
    return { fileCache, diffCache };
  }

  public evictFileFromCache(cacheKey: string): boolean {
    try {
      return this.fileCache.delete(cacheKey) !== undefined;
    } finally {
      this.queueBroadcastStateChanges();
    }
  }

  public evictDiffFromCache(cacheKey: string): boolean {
    try {
      return this.diffCache.delete(cacheKey) !== undefined;
    } finally {
      this.queueBroadcastStateChanges();
    }
  }

  async setRenderOptions({
    theme = DEFAULT_THEMES,
    useTokenTransformer = false,
    lineDiffType = 'word-alt',
    maxLineDiffLength = 1000,
    tokenizeMaxLineLength = 1000,
  }: Partial<WorkerRenderingOptions>): Promise<void> {
    const { lifecycleGeneration } = this;
    try {
      const newRenderOptions: WorkerRenderingOptions = {
        theme,
        useTokenTransformer,
        lineDiffType,
        maxLineDiffLength,
        tokenizeMaxLineLength,
      };
      if (!this.isInitialized()) {
        await this.initialize();
      }
      if (
        !this.isCurrentLifecycle(lifecycleGeneration) ||
        areDiffRenderOptionsEqual(newRenderOptions, this.renderOptions)
      ) {
        return;
      }

      const themeNames = getThemes(theme);
      let resolvedThemes: ThemeRegistrationResolved[] = [];
      if (!areThemesEqual(newRenderOptions.theme, this.renderOptions.theme)) {
        if (hasResolvedThemes(themeNames)) {
          resolvedThemes = getResolvedThemes(themeNames);
        } else {
          resolvedThemes = await resolveThemes(themeNames);
        }
      }

      if (!this.isCurrentLifecycle(lifecycleGeneration)) {
        return;
      }

      if (this.highlighter != null) {
        attachResolvedThemes(resolvedThemes, this.highlighter);
        await this.setRenderOptionsOnWorkers(newRenderOptions, resolvedThemes);
      } else {
        const [highlighter] = await Promise.all([
          getSharedHighlighter({
            themes: themeNames,
            langs: ['text'],
            preferredHighlighter: this.preferredHighlighter,
          }),
          this.setRenderOptionsOnWorkers(newRenderOptions, resolvedThemes),
        ]);
        if (!this.isCurrentLifecycle(lifecycleGeneration)) {
          return;
        }
        this.highlighter = highlighter;
      }

      if (!this.isCurrentLifecycle(lifecycleGeneration)) {
        return;
      }

      this.renderOptions = newRenderOptions;
      this.renderOptionsVersion++;
      this.diffCache.clear();
      this.fileCache.clear();

      for (const instance of this.themeSubscribers) {
        instance.rerender();
      }
    } catch (error) {
      if (
        error instanceof WorkerPoolTerminatedError ||
        !this.isCurrentLifecycle(lifecycleGeneration)
      ) {
        return;
      }
      throw error;
    }
  }

  public getFileRenderOptions(): RenderFileOptions {
    const { tokenizeMaxLineLength, theme, useTokenTransformer } =
      this.renderOptions;
    return { theme, useTokenTransformer, tokenizeMaxLineLength };
  }

  public getDiffRenderOptions(): RenderDiffOptions {
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
          // NOTE(amadeus): We intentionally ignore the normal active requests
          // infra because these tasks should technically interrupt the normal
          // flow and should be processed by the worker when ready immediately
          this.activeTaskById.set(id, task);
          managedWorker.worker.postMessage(task.request);
        })
      );
    }
    await Promise.all(taskPromises);
  }

  public subscribeToThemeChanges(instance: ThemeSubscriber): () => void {
    this.themeSubscribers.add(instance);
    this.queueBroadcastStateChanges();
    return () => {
      this.unsubscribeToThemeChanges(instance);
      this.queueBroadcastStateChanges();
    };
  }

  public unsubscribeToThemeChanges(instance: ThemeSubscriber): void {
    this.themeSubscribers.delete(instance);
    this.queueBroadcastStateChanges();
  }

  public subscribeToStatChanges(
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

  public cleanUpTasks(instance: RenderTaskInstance): void {
    this.detachInstanceFromQueuedTasks(instance);
    const requestId = this.activeRequestByInstance.get(instance);
    if (requestId != null) {
      const task = this.activeTaskById.get(requestId);
      if (isRenderTask(task)) {
        this.detachInstanceFromRenderTask(task, instance);
        if (!task.primeCache && task.instances.size === 0) {
          this.removeActiveTask(task);
        }
      } else {
        this.activeTaskById.delete(requestId);
      }
    }
    this.activeRequestByInstance.delete(instance);
    this.queueBroadcastStateChanges();
  }

  public isInitialized(): boolean {
    return this.initialized === true;
  }

  public async initialize(languages: SupportedLanguages[] = []): Promise<void> {
    if (this.initialized === true) {
      return;
    } else if (this.initialized === false) {
      const { lifecycleGeneration } = this;
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
            if (!this.isCurrentLifecycle(lifecycleGeneration)) {
              resolve();
              return;
            }

            let resolvedLanguages: ResolvedLanguage[] = [];
            if (hasResolvedLanguages(languages)) {
              resolvedLanguages = getResolvedLanguages(languages);
            } else {
              resolvedLanguages = await resolveLanguages(languages);
            }
            if (!this.isCurrentLifecycle(lifecycleGeneration)) {
              resolve();
              return;
            }

            const [highlighter] = await Promise.all([
              getSharedHighlighter({
                themes,
                langs: ['text', ...languages],
                preferredHighlighter: this.preferredHighlighter,
              }),
              this.initializeWorkers(resolvedThemes, resolvedLanguages),
            ]);

            if (!this.isCurrentLifecycle(lifecycleGeneration)) {
              this.terminateWorkers();
              resolve();
              return;
            }
            this.highlighter = highlighter;
            this.initialized = true;
            this.diffCache.clear();
            this.fileCache.clear();
            this.drainQueue();
            this.queueBroadcastStateChanges();
            resolve();
          } catch (e) {
            if (
              e instanceof WorkerPoolTerminatedError ||
              !this.isCurrentLifecycle(lifecycleGeneration)
            ) {
              resolve();
              return;
            }
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
    const customExtensionVersion = getCustomExtensionsVersion();
    const customExtensionMap =
      customExtensionVersion > 0 ? getCustomExtensionsMap() : undefined;
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
        customExtensionsVersion: 0,
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
              preferredHighlighter: this.preferredHighlighter,
              resolvedThemes,
              resolvedLanguages,
              customExtensionsVersion:
                customExtensionMap != null ? customExtensionVersion : undefined,
              customExtensionMap,
            },
            resolve() {
              managedWorker.initialized = true;
              resolve();
            },
            reject,
            requestStart: Date.now(),
          };
          this.activeTaskById.set(id, task);
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
    if (this.initialized !== true || this.queuedTasks.length === 0) {
      return;
    }
    for (let i = 0; i < this.queuedTasks.length; ) {
      const task = this.queuedTasks[i];
      // If any instance has a request in progress, we should wait for it to
      // finish before starting work that would notify that instance.
      if (this.hasActiveRequest(task)) {
        i++;
        continue;
      }
      const langs = getLangsFromTask(task);
      const availableWorker = this.getAvailableWorker(langs);
      if (availableWorker == null) {
        break;
      }
      this.queuedTasks.splice(i, 1);
      this.assignWorkerToTask(task, availableWorker);
      void this.resolveLanguagesAndExecuteTask(availableWorker, task, langs);
    }
    this.queueBroadcastStateChanges();
  };

  public highlightFileAST(
    instance: FileRendererInstance,
    file: FileContents
  ): void {
    const cachedResult = this.getFileResultCache(file);
    // If we've already highlighted the file or it's plain text, we should not
    // attempt to highlight. This should be mostly never hit, but it's just an
    // extra level of safety
    if (
      isFilePlainText(file) ||
      (cachedResult != null &&
        areFileRenderOptionsEqual(
          cachedResult.options,
          this.getFileRenderOptions()
        ))
    ) {
      return;
    }
    if (!this.hasMatchingFileInstanceTask(instance, file)) {
      this.submitTask(instance, { type: 'file', file });
    }
  }

  public primeFileHighlightCache(file: FileContents): void {
    if (file.cacheKey == null) {
      console.warn(
        `WorkerPoolManager.primeFileHighlightCache: priming highlight cache requires file.cacheKey; skipping "${file.name}".`
      );
      return;
    }
    const cachedResult = this.getFileResultCache(file);
    const highlightKey = this.getFileHighlightKey(file);
    if (
      highlightKey == null ||
      isFilePlainText(file) ||
      (cachedResult != null &&
        areFileRenderOptionsEqual(
          cachedResult.options,
          this.getFileRenderOptions()
        ))
    ) {
      return;
    }
    const existingTask = this.getTaskByHighlightKey(highlightKey);
    if (existingTask != null) {
      existingTask.primeCache = true;
    } else {
      this.submitCacheTask({ type: 'file', file }, highlightKey);
    }
  }

  public getPlainFileAST(
    file: FileContents,
    startingLine: number,
    totalLines: number,
    lines?: string[]
  ): ThemedFileResult | undefined {
    if (this.highlighter == null) {
      this.queueInitialization();
      return undefined;
    }
    return renderFileWithHighlighter(
      file,
      this.highlighter,
      this.renderOptions,
      { forcePlainText: true, startingLine, totalLines, lines }
    );
  }

  public highlightDiffAST(
    instance: DiffRendererInstance,
    diff: FileDiffMetadata
  ): void {
    const cachedResult = this.getDiffResultCache(diff);
    // If we've already highlighted the diff or it's plain text, we should not
    // attempt to highlight. This should be mostly never hit, but it's just an
    // extra level of safety
    if (
      isDiffPlainText(diff) ||
      (cachedResult != null &&
        areDiffRenderOptionsEqual(
          cachedResult.options,
          this.getDiffRenderOptions()
        ))
    ) {
      return;
    }
    if (!this.hasMatchingDiffInstanceTask(instance, diff)) {
      this.submitTask(instance, { type: 'diff', diff });
    }
  }

  public primeDiffHighlightCache(diff: FileDiffMetadata): void {
    if (diff.cacheKey == null) {
      console.warn(
        `WorkerPoolManager.primeDiffHighlightCache: priming highlight cache requires diff.cacheKey; skipping "${diff.prevName ?? diff.name}" -> "${diff.name}".`
      );
      return;
    }
    const cachedResult = this.getDiffResultCache(diff);
    const highlightKey = this.getDiffHighlightKey(diff);
    if (
      highlightKey == null ||
      isDiffPlainText(diff) ||
      (cachedResult != null &&
        areDiffRenderOptionsEqual(
          cachedResult.options,
          this.getDiffRenderOptions()
        ))
    ) {
      return;
    }
    const existingTask = this.getTaskByHighlightKey(highlightKey);
    if (existingTask != null) {
      existingTask.primeCache = true;
    } else {
      this.submitCacheTask({ type: 'diff', diff }, highlightKey);
    }
  }

  public getPlainDiffAST(
    diff: FileDiffMetadata,
    startingLine: number,
    totalLines: number,
    expandedHunks?: Map<number, HunkExpansionRegion> | true,
    collapsedContextThreshold?: number
  ): ThemedDiffResult | undefined {
    return this.highlighter != null
      ? renderDiffWithHighlighter(diff, this.highlighter, this.renderOptions, {
          forcePlainText: true,
          startingLine,
          totalLines,
          expandedHunks,
          collapsedContextThreshold,
        })
      : undefined;
  }

  public terminate(): void {
    this.lifecycleGeneration++;
    this.cancelActiveWorkerTasks();
    this.terminateWorkers();
    this.fileCache.clear();
    this.diffCache.clear();
    this.activeRequestByInstance.clear();
    this.queuedTasks.length = 0;
    this.queuedTaskByInstance.clear();
    this.taskByHighlightKey.clear();
    this.activeTaskById.clear();
    this.highlighter = undefined;
    this.initialized = false;
    this.workersFailed = false;
    this.queueBroadcastStateChanges();
  }

  private isCurrentLifecycle(lifecycleGeneration: number): boolean {
    return this.lifecycleGeneration === lifecycleGeneration;
  }

  private queueInitialization(languages?: SupportedLanguages[]): void {
    void this.initialize(languages).catch((error) => {
      console.error(error);
    });
  }

  private cancelActiveWorkerTasks(): void {
    const error = new WorkerPoolTerminatedError();
    for (const task of this.activeTaskById.values()) {
      if ('reject' in task) {
        task.reject(error);
      }
    }
  }

  private terminateWorkers() {
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers.length = 0;
  }

  public getStats(): WorkerStats {
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
      queuedTasks: this.queuedTasks.length,
      activeTasks: this.activeTaskById.size,
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
      this.queueInitialization();
    }

    const highlightKey = this.getHighlightKeyForRequest(request);
    const existingTask =
      highlightKey != null
        ? this.getTaskByHighlightKey(highlightKey)
        : undefined;
    if (existingTask != null) {
      this.detachInstanceFromQueuedTasks(instance, existingTask);
      this.addInstanceToTask(existingTask, instance);
      this.queueBroadcastStateChanges();
      return;
    }

    this.detachInstanceFromQueuedTasks(instance);
    const id = this.generateRequestId();
    const requestStart = Date.now();
    const task: RenderTask = (() => {
      switch (request.type) {
        case 'file':
          return {
            type: 'file',
            id,
            request: { ...request, id },
            instances: new Set([instance as FileRendererInstance]),
            primeCache: false,
            highlightKey,
            requestStart,
          };
        case 'diff':
          return {
            type: 'diff',
            id,
            request: { ...request, id },
            instances: new Set([instance as DiffRendererInstance]),
            primeCache: false,
            highlightKey,
            requestStart,
          };
      }
    })();
    this.enqueueRenderTask(task, instance);
  }

  private submitCacheTask(request: SubmitRequest, highlightKey: string): void {
    if (this.initialized === false) {
      this.queueInitialization();
    }
    const id = this.generateRequestId();
    const requestStart = Date.now();
    const task: RenderTask = (() => {
      switch (request.type) {
        case 'file':
          return {
            type: 'file',
            id,
            request: { ...request, id },
            instances: new Set<FileRendererInstance>(),
            primeCache: true,
            highlightKey,
            requestStart,
          };
        case 'diff':
          return {
            type: 'diff',
            id,
            request: { ...request, id },
            instances: new Set<DiffRendererInstance>(),
            primeCache: true,
            highlightKey,
            requestStart,
          };
      }
    })();
    this.enqueueRenderTask(task);
  }

  private enqueueRenderTask(
    task: RenderTask,
    instance?: RenderTaskInstance
  ): void {
    this.queuedTasks.push(task);
    if (instance != null) {
      this.queuedTaskByInstance.set(instance, task);
    }
    if (task.highlightKey != null) {
      this.taskByHighlightKey.set(task.highlightKey, task);
    }
    this.queueDrain();
  }

  private async resolveLanguagesAndExecuteTask(
    availableWorker: ManagedWorker,
    task: RenderFileTask | RenderDiffTask,
    langs: SupportedLanguages[]
  ): Promise<void> {
    try {
      // Add resolved languages if required
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
      // If the task has been cleaned up after awaiting language resolving,
      // lets fully clean it up
      if (!this.activeTaskById.has(task.id)) {
        if (availableWorker.request_id === task.id) {
          this.cleanWorkerAndTask(availableWorker, task);
          this.queueBroadcastStateChanges();
          if (this.queuedTasks.length > 0) {
            this.queueDrain();
          }
        }
        return;
      }
      this.executeTask(availableWorker, task);
    } catch {
      this.cleanWorkerAndTask(availableWorker, task);
      this.queueBroadcastStateChanges();
      if (this.queuedTasks.length > 0) {
        this.queueDrain();
      }
    }
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerResponse
  ): void {
    const task = this.activeTaskById.get(response.id);
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
        } else if (isRenderTask(task)) {
          this.notifyHighlightError(task, error);
        } else {
          throw new Error('handleWorkerMessage: unknown task type');
        }
        throw error;
      } else {
        switch (response.requestType) {
          case 'initialize':
            if (task.type !== 'initialize') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            this.syncCustomExtensionVersion(managedWorker, task.request);
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
            const { request } = task;
            this.syncCustomExtensionVersion(managedWorker, request);
            if (request.file.cacheKey != null) {
              this.fileCache.set(request.file.cacheKey, { result, options });
            }
            this.notifyFileInstances(task, result, options);
            break;
          }
          case 'diff': {
            if (task.type !== 'diff') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            const { result, options } = response;
            const { request } = task;
            this.syncCustomExtensionVersion(managedWorker, request);
            if (request.diff.cacheKey != null) {
              this.diffCache.set(request.diff.cacheKey, { result, options });
            }
            this.notifyDiffInstances(task, result, options);
            break;
          }
        }
      }
    } catch (error) {
      if (error !== IGNORE_RESPONSE) {
        console.error(error, task, response);
      }
    }

    this.cleanWorkerAndTask(managedWorker, task);
    this.queueBroadcastStateChanges();
    if (this.queuedTasks.length > 0) {
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
    if (isRenderTask(task)) {
      this.clearQueuedInstanceRequests(task);
      this.trackInstanceRequests(task);
    }
    this.activeTaskById.set(task.id, task);
  }

  private cleanWorkerAndTask(
    managedWorker: ManagedWorker,
    task?: AllWorkerTasks
  ) {
    managedWorker.request_id = undefined;
    if (task != null) {
      if (isRenderTask(task)) {
        this.clearInstanceRequests(task);
        this.clearHighlightKey(task);
      }
      this.activeTaskById.delete(task.id);
    }
  }

  private executeTask(
    managedWorker: ManagedWorker,
    task: AllWorkerTasks
  ): void {
    if (shouldSyncCustomExtensions(task.request)) {
      this.maybeAttachCustomExtensions(managedWorker, task.request);
    }
    if (!this.activeTaskById.has(task.id)) {
      this.assignWorkerToTask(task, managedWorker);
    }
    for (const lang of getLangsFromTask(task)) {
      managedWorker.langs.add(lang);
    }
    try {
      managedWorker.worker.postMessage(task.request);
    } catch (error) {
      console.error('Failed to post message to worker:', error);
      if (isRenderTask(task)) {
        this.notifyHighlightError(task, error);
      } else if ('reject' in task) {
        task.reject(error as Error);
      }
      this.cleanWorkerAndTask(managedWorker, task);
      if (this.queuedTasks.length > 0) {
        this.queueDrain();
      }
    }
    this.queueBroadcastStateChanges();
  }

  private maybeAttachCustomExtensions(
    managedWorker: ManagedWorker,
    request: InitializeWorkerRequest | RenderFileRequest | RenderDiffRequest
  ): void {
    if (request.customExtensionsVersion != null) {
      return;
    }
    const version = getCustomExtensionsVersion();
    if (managedWorker.customExtensionsVersion >= version) {
      return;
    }
    request.customExtensionsVersion = version;
    request.customExtensionMap = getCustomExtensionsMap();
  }

  private syncCustomExtensionVersion(
    managedWorker: ManagedWorker,
    request: InitializeWorkerRequest | RenderFileRequest | RenderDiffRequest
  ): void {
    if (request.customExtensionsVersion == null) {
      return;
    }
    managedWorker.customExtensionsVersion = request.customExtensionsVersion;
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

  private getFileHighlightKey(file: FileContents): string | undefined {
    if (file.cacheKey == null) {
      return undefined;
    }
    return `file:${file.cacheKey}:${this.renderOptionsVersion}`;
  }

  private getDiffHighlightKey(diff: FileDiffMetadata): string | undefined {
    if (diff.cacheKey == null) {
      return undefined;
    }
    return `diff:${diff.cacheKey}:${this.renderOptionsVersion}`;
  }

  private getHighlightKeyForRequest(
    request: SubmitRequest
  ): string | undefined {
    switch (request.type) {
      case 'file':
        return this.getFileHighlightKey(request.file);
      case 'diff':
        return this.getDiffHighlightKey(request.diff);
    }
  }

  private hasActiveRequest(task: RenderTask): boolean {
    for (const instance of getInstances(task)) {
      if (this.activeRequestByInstance.has(instance)) {
        return true;
      }
    }
    return false;
  }

  private addInstanceToTask(
    task: RenderTask,
    instance: FileRendererInstance | DiffRendererInstance
  ): void {
    if (task.type === 'file') {
      task.instances.add(instance as FileRendererInstance);
    } else {
      task.instances.add(instance as DiffRendererInstance);
    }
    if (this.activeTaskById.has(task.id)) {
      this.activeRequestByInstance.set(instance, task.id);
    } else {
      this.queuedTaskByInstance.set(instance, task);
    }
  }

  private detachInstanceFromQueuedTasks(
    instance: RenderTaskInstance,
    exceptTask?: RenderTask
  ): void {
    const task = this.queuedTaskByInstance.get(instance);
    if (task == null || task === exceptTask) {
      return;
    }
    this.queuedTaskByInstance.delete(instance);
    this.detachInstanceFromRenderTask(task, instance);
    if (!task.primeCache && task.instances.size === 0) {
      this.removeQueuedTask(task);
    }
  }

  private detachInstanceFromRenderTask(
    task: RenderTask,
    instance: RenderTaskInstance
  ): void {
    if (task.type === 'file') {
      task.instances.delete(instance as FileRendererInstance);
    } else {
      task.instances.delete(instance as DiffRendererInstance);
    }
  }

  private removeQueuedTask(task: RenderTask): void {
    const index = this.queuedTasks.indexOf(task);
    if (index !== -1) {
      this.queuedTasks.splice(index, 1);
    }
    this.clearQueuedInstanceRequests(task);
    this.clearHighlightKey(task);
  }

  private removeActiveTask(task: RenderTask): void {
    this.clearInstanceRequests(task);
    this.clearHighlightKey(task);
    this.activeTaskById.delete(task.id);
  }

  private clearQueuedInstanceRequests(task: RenderTask): void {
    for (const instance of getInstances(task)) {
      if (this.queuedTaskByInstance.get(instance) === task) {
        this.queuedTaskByInstance.delete(instance);
      }
    }
  }

  private clearHighlightKey(task: RenderTask): void {
    if (
      task.highlightKey != null &&
      this.taskByHighlightKey.get(task.highlightKey) === task
    ) {
      this.taskByHighlightKey.delete(task.highlightKey);
    }
  }

  private trackInstanceRequests(task: RenderTask): void {
    for (const instance of getInstances(task)) {
      this.activeRequestByInstance.set(instance, task.id);
    }
  }

  private clearInstanceRequests(task: RenderTask): void {
    for (const instance of getInstances(task)) {
      if (this.activeRequestByInstance.get(instance) === task.id) {
        this.activeRequestByInstance.delete(instance);
      }
    }
  }

  private notifyFileInstances(
    task: RenderFileTask,
    result: ThemedFileResult,
    options: RenderFileOptions
  ): void {
    for (const instance of task.instances) {
      if (this.activeRequestByInstance.get(instance) === task.id) {
        instance.onHighlightSuccess(task.request.file, result, options);
      }
    }
  }

  private notifyDiffInstances(
    task: RenderDiffTask,
    result: ThemedDiffResult,
    options: RenderDiffOptions
  ): void {
    for (const instance of task.instances) {
      if (this.activeRequestByInstance.get(instance) === task.id) {
        instance.onHighlightSuccess(task.request.diff, result, options);
      }
    }
  }

  private notifyHighlightError(task: RenderTask, error: unknown): void {
    for (const instance of getInstances(task)) {
      if (this.activeRequestByInstance.get(instance) === task.id) {
        instance.onHighlightError(error);
      }
    }
  }

  private hasMatchingFileInstanceTask(
    instance: FileRendererInstance,
    file: FileContents
  ): boolean {
    for (const task of this.iterateRenderTasks()) {
      if (
        task.type === 'file' &&
        task.instances.has(instance) &&
        areFilesEqual(file, task.request.file)
      ) {
        return true;
      }
    }
    return false;
  }

  private hasMatchingDiffInstanceTask(
    instance: DiffRendererInstance,
    diff: FileDiffMetadata
  ): boolean {
    for (const task of this.iterateRenderTasks()) {
      if (
        task.type === 'diff' &&
        task.instances.has(instance) &&
        areDiffTargetsEqual(task.request.diff, diff)
      ) {
        return true;
      }
    }
    return false;
  }

  private getTaskByHighlightKey(highlightKey: string): RenderTask | undefined {
    return this.taskByHighlightKey.get(highlightKey);
  }

  private *iterateRenderTasks(): Generator<RenderTask> {
    for (const task of this.queuedTasks) {
      yield task;
    }
    for (const task of this.activeTaskById.values()) {
      if (isRenderTask(task)) {
        yield task;
      }
    }
  }

  private generateRequestId(): WorkerRequestId {
    return `req_${++this.nextRequestId}`;
  }
}

function shouldSyncCustomExtensions(
  request: AllWorkerTasks['request']
): request is InitializeWorkerRequest | RenderFileRequest | RenderDiffRequest {
  return (
    request.type === 'initialize' ||
    request.type === 'file' ||
    request.type === 'diff'
  );
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

function isRenderTask(task: AllWorkerTasks | undefined): task is RenderTask {
  return task?.type === 'file' || task?.type === 'diff';
}

function getInstances(
  task: RenderTask
): Set<FileRendererInstance | DiffRendererInstance> {
  return task.instances as Set<FileRendererInstance | DiffRendererInstance>;
}
