import LRUMapPkg from 'lru_map';
import type { LRUMap } from 'lru_map';

import { DEFAULT_THEMES } from '../constants';
import { resolveHighlighterType } from '../highlighter/highlighterType';
import { areLanguagesAttached } from '../highlighter/languages/areLanguagesAttached';
import { RegisteredHighlightsLanguages } from '../highlighter/languages/constants';
import { getResolvedLanguages } from '../highlighter/languages/getResolvedLanguages';
import { hasResolvedLanguages } from '../highlighter/languages/hasResolvedLanguages';
import { resolveHighlightsLanguages } from '../highlighter/languages/resolveHighlightsLanguages';
import { resolveLanguages } from '../highlighter/languages/resolveLanguages';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
  HighlighterDisposedError,
} from '../highlighter/shared_highlighter';
import { getResolvedThemes } from '../highlighter/themes/getResolvedThemes';
import { hasResolvedThemes } from '../highlighter/themes/hasResolvedThemes';
import { resolveThemes } from '../highlighter/themes/resolveThemes';
import type {
  DiffsHighlighter,
  DiffsTheme,
  DiffsThemeNames,
  ExpandedHunksMap,
  FileContents,
  FileDiffMetadata,
  HighlighterTypes,
  RenderDiffOptions,
  RenderDiffResult,
  RenderFileOptions,
  RenderFileResult,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import { areDiffRenderOptionsEqual } from '../utils/areDiffRenderOptionsEqual';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areFileRenderOptionsEqual } from '../utils/areFileRenderOptionsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { getDefaultWorkerPoolSize } from '../utils/getDefaultWorkerPoolSize';
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
import {
  isHandledWorkerPoolError,
  markWorkerErrorReported,
  WorkerPoolTaskCanceledError,
  WorkerPoolTerminatedError,
  WorkerPoolWorkerError,
} from './errors';
import { decodeHastLines } from './hastLinesTransport';
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
  WorkerStats,
} from './types';
import type {
  InitializeWorkerWireRequest,
  WorkerWireResponse,
} from './workerMessage';

const IGNORE_RESPONSE = Symbol('IGNORE_RESPONSE');
const DEFAULT_WORKER_INITIALIZATION_TIMEOUT = 5_000;

interface GetCachesResult {
  fileCache: LRUMap<string, RenderFileResult>;
  diffCache: LRUMap<string, RenderDiffResult>;
}

interface ManagedWorker {
  worker: Worker;
  requestId: string | undefined;
  pendingSetupRequestId: WorkerRequestId | undefined;
  renderOptionsVersion: number;
  langs: Set<SupportedLanguages>;
  customExtensionsVersion: number;
}

interface WorkerSlot {
  state: 'starting' | 'retrying' | 'ready' | 'failed';
  error?: WorkerPoolWorkerError;
  worker?: ManagedWorker;
  startup?: WorkerStartup;
}

interface WorkerStartup {
  timeout?: ReturnType<typeof setTimeout>;
  resolve(): void;
}

interface PendingPoolInitialization {
  state: 'pending';
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
  stopThemeWait?(): void;
}

type PoolInitializationFailure =
  | { reason: 'preparation'; error: Error; languages: SupportedLanguages[] }
  | { reason: 'workers'; error: WorkerPoolWorkerError };

type PoolInitialization =
  | PendingPoolInitialization
  | { state: 'succeeded' }
  | ({ state: 'failed' } & PoolInitializationFailure);

interface ThemeSubscriber {
  onThemeChange(): void;
}

type RenderTask = RenderFileTask | RenderDiffTask;

type RenderTaskInstance = FileRendererInstance | DiffRendererInstance;

type LocalThemeView = Pick<RenderTaskInstance, 'onHighlightError'>;

export class WorkerPoolManager {
  private readonly preferredHighlighter: HighlighterTypes;
  private renderOptions: WorkerRenderingOptions;
  private renderOptionsRequestVersion = 0;
  private renderOptionsVersion = 0;
  private initialization: PoolInitialization | undefined;
  private readonly configuredWorkers: number;
  private workerSlots: WorkerSlot[] = [];
  private readyWorkerCount = 0;
  // Stays true through explicit retries until one of the workers joins.
  private workerSlotsExhausted = false;
  private resolvedWorkerThemes: DiffsTheme[] = [];
  private resolvedWorkerLanguages: ResolvedLanguage[] = [];
  // Tasks that are waiting to get processed by a worker
  private queuedTasks: RenderTask[] = [];
  private queuedTaskByInstance = new Map<RenderTaskInstance, RenderTask>();

  // Tasks that map to highlightKey are essentially singular, so we only
  // need one map to include queued and active
  private taskByHighlightKey = new Map<string, RenderTask>();
  // Highlight keys whose last task failed, bounded like the result caches
  // and cleared with them when the render options change.
  private failedHighlightKeys: LRUMap<string, true>;

  // Tasks that have already been sent to a worker and are awaiting a response.
  private activeTaskById = new Map<WorkerRequestId, AllWorkerTasks>();
  private activeRequestByInstance = new Map<
    RenderTaskInstance,
    WorkerRequestId
  >();

  private nextRequestId = 0;
  private themeSubscribers = new Set<ThemeSubscriber>();
  // Views that could not render until the local theme loads, with the
  // callback that renders each one.
  private pendingThemeRenders = new Map<LocalThemeView, () => void>();
  private terminated = false;
  private statSubscribers = new Set<(stats: WorkerStats) => unknown>();
  private fileCache: LRUMap<string, RenderFileResult>;
  private diffCache: LRUMap<string, RenderDiffResult>;
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
      preferredDiffLib,
      maxLineDiffLength = 1000,
      tokenizeMaxLineLength = 1000,
      preferredHighlighter,
    }: WorkerInitializationRenderOptions
  ) {
    this.configuredWorkers = options.poolSize ?? getDefaultWorkerPoolSize();
    this.preferredHighlighter = resolveHighlighterType(preferredHighlighter);
    this.renderOptions = {
      theme,
      useTokenTransformer,
      lineDiffType,
      preferredDiffLib,
      maxLineDiffLength,
      tokenizeMaxLineLength,
    };
    this.fileCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
    this.diffCache = new LRUMapPkg.LRUMap(options.totalASTLRUCacheSize ?? 100);
    this.failedHighlightKeys = new LRUMapPkg.LRUMap(
      options.totalASTLRUCacheSize ?? 100
    );
    this.queueInitialization(langs);
  }

  public isWorkingPool(): boolean {
    return !this.terminated && !this.shouldUseLocalFallback();
  }

  public shouldUseLocalFallback(): boolean {
    const { initialization } = this;
    return (
      initialization?.state === 'failed' ||
      (initialization?.state === 'succeeded' && this.readyWorkerCount === 0)
    );
  }

  /**
   * @internal Returns true if the view must wait for the local theme. When
   * the theme is ready, calls the latest callback registered for each view.
   * Optional grammars start loading alongside the theme.
   */
  public renderWhenLocalThemeLoads(
    view: LocalThemeView,
    onRenderUpdate: () => void,
    langs: SupportedLanguages[] = []
  ): boolean {
    if (getHighlighterIfLoaded({ theme: this.renderOptions.theme }) != null) {
      this.pendingThemeRenders.delete(view);
      return false;
    }
    this.pendingThemeRenders.set(view, onRenderUpdate);
    this.loadLocalThemeForRender(this.isWorkingPool() ? undefined : view);
    if (langs.length > 0) {
      void this.loadSharedHighlighter([], langs).catch(() => {});
    }
    return true;
  }

  /** @internal Drops the render callback `view` registered, if any. */
  public cancelLocalThemeRender(view: LocalThemeView): void {
    this.pendingThemeRenders.delete(view);
  }

  // Loads only the theme and plain text. A failed load leaves views waiting
  // until initialize() retries or a later render asks again.
  private loadLocalThemeForRender(fallbackView?: LocalThemeView): void {
    const { theme } = this.renderOptions;
    const { lifecycleGeneration } = this;
    void this.loadSharedHighlighter(getThemes(theme), ['text']).then(
      () => {
        // A mounted view can finish locally after termination. A restarted
        // pool owns its own requests for the active theme.
        if (
          (!this.terminated && !this.isCurrentLifecycle(lifecycleGeneration)) ||
          !areThemesEqual(theme, this.renderOptions.theme)
        ) {
          return;
        }
        this.renderPendingThemeViews();
      },
      (error: unknown) => fallbackView?.onHighlightError(error)
    );
  }

  // Renders the views waiting for the current theme, once it has loaded.
  private renderPendingThemeViews(): void {
    if (getHighlighterIfLoaded({ theme: this.renderOptions.theme }) == null) {
      return;
    }
    // An earlier callback can cancel or replace a later one.
    for (const view of [...this.pendingThemeRenders.keys()]) {
      const onRenderUpdate = this.pendingThemeRenders.get(view);
      if (onRenderUpdate == null) {
        continue;
      }
      this.pendingThemeRenders.delete(view);
      try {
        onRenderUpdate();
      } catch (error) {
        console.error(error);
      }
    }
  }

  /**
   * Whether a file or diff fits within `mainThreadMaxCharacters`, so it
   * highlights on the main thread instead of a worker. Files count `contents`;
   * diffs count both sides.
   */
  public shouldHighlightOnMainThread(
    fileOrDiff: FileContents | FileDiffMetadata
  ): boolean {
    const { mainThreadMaxCharacters = -1 } = this.options;
    const characterCount =
      'contents' in fileOrDiff
        ? fileOrDiff.contents.length
        : fileOrDiff.deletionCharacterCount + fileOrDiff.additionCharacterCount;
    return characterCount <= mainThreadMaxCharacters;
  }

  /**
   * Whether the last highlight of a file or diff failed under the current
   * render options. Inputs without a cache key are never tracked.
   */
  public didHighlightFail(
    fileOrDiff: FileContents | FileDiffMetadata
  ): boolean {
    const highlightKey =
      'contents' in fileOrDiff
        ? this.getFileHighlightKey(fileOrDiff)
        : this.getDiffHighlightKey(fileOrDiff);
    return highlightKey != null && this.failedHighlightKeys.has(highlightKey);
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

  // Returns whether the result was stored. Results without a cache key or
  // rendered with outdated options are dropped.
  public setFileResultCache(
    cacheKey: string | undefined,
    { result, options }: RenderFileResult
  ): boolean {
    if (
      cacheKey == null ||
      !areFileRenderOptionsEqual(options, this.getFileRenderOptions())
    ) {
      return false;
    }
    this.fileCache.set(cacheKey, { result, options });
    this.queueBroadcastStateChanges();
    return true;
  }

  // Returns whether the result was stored. Results without a cache key or
  // rendered with outdated options are dropped.
  public setDiffResultCache(
    cacheKey: string | undefined,
    { result, options }: RenderDiffResult
  ): boolean {
    if (
      cacheKey == null ||
      !areDiffRenderOptionsEqual(options, this.getDiffRenderOptions())
    ) {
      return false;
    }
    this.diffCache.set(cacheKey, { result, options });
    this.queueBroadcastStateChanges();
    return true;
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
    theme = this.renderOptions.theme ?? DEFAULT_THEMES,
    useTokenTransformer = this.renderOptions.useTokenTransformer ?? false,
    lineDiffType = this.renderOptions.lineDiffType ?? 'word-alt',
    preferredDiffLib = this.renderOptions.preferredDiffLib,
    maxLineDiffLength = this.renderOptions.maxLineDiffLength ?? 1000,
    tokenizeMaxLineLength = this.renderOptions.tokenizeMaxLineLength ?? 1000,
  }: Partial<WorkerRenderingOptions>): Promise<void> {
    const { lifecycleGeneration } = this;
    const renderOptionsRequestVersion = ++this.renderOptionsRequestVersion;
    const isCurrentRequest = (): boolean =>
      this.isCurrentLifecycle(lifecycleGeneration) &&
      this.renderOptionsRequestVersion === renderOptionsRequestVersion;
    try {
      const newRenderOptions: WorkerRenderingOptions = {
        theme,
        useTokenTransformer,
        lineDiffType,
        preferredDiffLib,
        maxLineDiffLength,
        tokenizeMaxLineLength,
      };
      if (this.terminated) {
        this.queueInitialization();
      }
      if (
        !isCurrentRequest() ||
        areDiffRenderOptionsEqual(newRenderOptions, this.renderOptions)
      ) {
        return;
      }

      const themeNames = getThemes(theme);
      const themeChanged = !areThemesEqual(theme, this.renderOptions.theme);
      const resolvedThemes =
        !themeChanged && this.resolvedWorkerThemes.length > 0
          ? this.resolvedWorkerThemes
          : hasResolvedThemes(themeNames, this.preferredHighlighter)
            ? getResolvedThemes(themeNames, this.preferredHighlighter)
            : await resolveThemes(themeNames, this.preferredHighlighter);

      if (!isCurrentRequest()) {
        return;
      }

      // Warning: resolvedThemes use the workers' backend. The main-thread
      // highlighter can be another backend, so it loads its own copies.
      if (getHighlighterIfLoaded({ theme }) == null) {
        await this.loadSharedHighlighter(themeNames, ['text']);
        if (!isCurrentRequest()) {
          return;
        }
      }

      this.renderOptions = newRenderOptions;
      this.resolvedWorkerThemes = resolvedThemes;
      this.renderOptionsVersion++;
      if (this.initialization?.state === 'pending') {
        this.initialization.stopThemeWait?.();
      }
      this.diffCache.clear();
      this.fileCache.clear();
      this.failedHighlightKeys.clear();
      this.invalidateRenderTasks();

      if (
        themeChanged &&
        this.initialization?.state === 'failed' &&
        this.initialization.reason === 'preparation'
      ) {
        const { languages } = this.initialization;
        this.initialization = undefined;
        this.queueInitialization(languages);
      }
      const workerSetup = this.setRenderOptionsOnWorkers(themeChanged);

      for (const instance of this.themeSubscribers) {
        instance.onThemeChange();
      }
      // The previous theme's load no longer wakes views still waiting.
      if (themeChanged) {
        this.renderPendingThemeViews();
      }

      await workerSetup;
    } catch (error) {
      if (error instanceof WorkerPoolTerminatedError || !isCurrentRequest()) {
        return;
      }
      throw error;
    }
  }

  public getPreferredHighlighter(): HighlighterTypes {
    return this.preferredHighlighter;
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
    themeChanged: boolean
  ): Promise<void> {
    const { renderOptionsVersion } = this;
    const taskPromises: Promise<void>[] = [];
    for (const slot of this.workerSlots) {
      const { worker } = slot;
      if (slot.state === 'ready' && worker != null) {
        const resolvedThemes =
          themeChanged || worker.pendingSetupRequestId != null
            ? this.resolvedWorkerThemes
            : [];
        taskPromises.push(
          this.setRenderOptionsOnWorker(worker, resolvedThemes).catch(
            (error: unknown) => {
              // Only the current setup can disqualify a worker. Old renders
              // were canceled when the manager committed the new options.
              if (
                slot.worker === worker &&
                this.renderOptionsVersion === renderOptionsVersion
              ) {
                this.failWorkerSlot(slot, normalizeWorkerStartupError(error));
              }
              throw error;
            }
          )
        );
      }
    }
    await Promise.all(taskPromises);
  }

  private setRenderOptionsOnWorker(
    managedWorker: ManagedWorker,
    resolvedThemes: DiffsTheme[]
  ): Promise<void> {
    const { renderOptionsVersion } = this;
    return new Promise<void>((resolve, reject) => {
      const id = this.generateRequestId();
      const task: SetRenderOptionsWorkerTask = {
        type: 'set-render-options',
        id,
        request: {
          type: 'set-render-options',
          id,
          renderOptions: this.renderOptions,
          resolvedThemes,
        },
        resolve() {
          managedWorker.renderOptionsVersion = renderOptionsVersion;
          resolve();
        },
        reject,
        requestStart: Date.now(),
      };
      this.postWorkerSetup(managedWorker, task);
    });
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

  /** Whether a worker has joined since construction or the last termination. */
  public isInitialized(): boolean {
    return this.initialization?.state === 'succeeded';
  }

  public async initialize(languages?: SupportedLanguages[]): Promise<void> {
    const { initialization: current } = this;
    if (current?.state === 'succeeded') {
      if (getHighlighterIfLoaded({ theme: this.renderOptions.theme }) == null) {
        await this.preloadLocalHighlighter(languages ?? []);
      }
      return;
    }
    if (current?.state === 'pending') {
      return current.promise;
    }
    if (current?.state === 'failed') {
      if (current.reason === 'workers') {
        throw current.error;
      }
      languages ??= current.languages;
    }

    this.terminated = false;
    const initialization: PendingPoolInitialization = (this.initialization = {
      state: 'pending',
      promise: Promise.resolve(),
      resolve() {},
      reject() {},
    });
    initialization.promise = new Promise((resolve, reject) => {
      initialization.resolve = resolve;
      initialization.reject = reject;
    });
    this.workerSlots = Array.from({ length: this.configuredWorkers }, () => ({
      state: 'starting',
    }));
    void this.startPool(initialization, languages ?? []);
    this.queueBroadcastStateChanges();
    return initialization.promise;
  }

  private async startPool(
    initialization: PendingPoolInitialization,
    languages: SupportedLanguages[]
  ): Promise<void> {
    const { lifecycleGeneration, renderOptionsVersion } = this;
    const themes = getThemes(this.renderOptions.theme);
    // Local preloading can overlap worker startup. Only worker setup determines
    // when the pool can serve requests.
    void this.preloadLocalHighlighter(languages).catch((error: unknown) => {
      if (this.isCurrentLifecycle(lifecycleGeneration)) {
        console.error(error);
      }
    });
    try {
      try {
        const resolvedThemes = hasResolvedThemes(
          themes,
          this.preferredHighlighter
        )
          ? getResolvedThemes(themes, this.preferredHighlighter)
          : await this.waitForWorkerThemes(initialization, themes);
        if (
          this.initialization === initialization &&
          this.renderOptionsVersion === renderOptionsVersion
        ) {
          this.resolvedWorkerThemes = resolvedThemes;
        }
      } catch (error) {
        // A newer theme can commit while the initial theme is still loading.
        // Its resolved themes are already available for worker setup.
        if (this.renderOptionsVersion === renderOptionsVersion) {
          throw error;
        }
      }
      if (this.initialization !== initialization) {
        return;
      }
      const resolving = this.resolveWorkerLanguages(languages);
      const resolvedLanguages = Array.isArray(resolving)
        ? resolving
        : await resolving;
      if (this.initialization !== initialization) {
        return;
      }

      this.resolvedWorkerLanguages = resolvedLanguages;
      if (this.workerSlots.length === 0) {
        const error = new WorkerPoolWorkerError(
          'WorkerPoolManager: no workers configured'
        );
        this.workerSlotsExhausted = true;
        this.rejectInitialization(initialization, { reason: 'workers', error });
        this.rejectAllQueuedRenderTasks(error);
        return;
      }
      void this.startWorkerAttempts(this.workerSlots, 'starting');
    } catch (error) {
      if (this.initialization !== initialization) {
        return;
      }
      this.workerSlots = [];
      const setupError = normalizeWorkerError(error);
      this.rejectInitialization(initialization, {
        reason: 'preparation',
        error: setupError,
        languages: [...languages],
      });
      this.rejectAllQueuedRenderTasks(setupError);
    }
  }

  // A render-options commit supplies the worker themes itself. Let startup
  // continue with its language preloads even if the original theme never loads.
  private waitForWorkerThemes(
    initialization: PendingPoolInitialization,
    themes: DiffsThemeNames[]
  ): Promise<DiffsTheme[]> {
    const stopped = new Promise<DiffsTheme[]>((resolve) => {
      initialization.stopThemeWait = () => resolve(this.resolvedWorkerThemes);
    });
    return Promise.race([
      resolveThemes(themes, this.preferredHighlighter),
      stopped,
    ]);
  }

  // A previous theme load may have failed while views were waiting to paint.
  // Give those views the new theme load independently of optional grammars.
  private preloadLocalHighlighter(
    languages: SupportedLanguages[]
  ): Promise<void> {
    if (this.pendingThemeRenders.size > 0) {
      this.loadLocalThemeForRender();
    }
    return this.loadSharedHighlighter(getThemes(this.renderOptions.theme), [
      'text',
      ...languages,
    ]);
  }

  // Warning: workers never use the main-thread highlighter. If
  // disposeHighlighter() runs during this load, pool work must not fail; the
  // next plain render loads the highlighter again.
  private async loadSharedHighlighter(
    themes: DiffsThemeNames[],
    langs: SupportedLanguages[]
  ): Promise<void> {
    try {
      await getSharedHighlighter({
        themes,
        langs,
        preferredHighlighter: this.preferredHighlighter,
      });
    } catch (error) {
      if (!(error instanceof HighlighterDisposedError)) {
        throw error;
      }
    }
  }

  /**
   * Give currently failed slots one new attempt each. Resolve when these
   * attempts settle, including if termination cancels them.
   */
  public async retryFailedWorkers(): Promise<WorkerStats> {
    const failedSlots = this.workerSlots.filter(
      (slot) => slot.state === 'failed'
    );
    if (failedSlots.length > 0) {
      await Promise.all(this.startWorkerAttempts(failedSlots, 'retrying'));
    }
    return this.getStats();
  }

  private startWorkerAttempts(
    slots: WorkerSlot[],
    state: 'starting' | 'retrying'
  ): Promise<void>[] {
    const settlements = slots.map(
      (slot) =>
        new Promise<void>((resolve) => {
          const startup: WorkerStartup = { resolve };
          slot.startup = startup;
          slot.state = state;
          slot.error = undefined;
          void this.startWorkerAttempt(slot, startup);
        })
    );
    this.queueBroadcastStateChanges();
    return settlements;
  }

  // The attempt's timeout covers initialization and catching up to the current
  // render options before this worker can take work.
  private async startWorkerAttempt(
    slot: WorkerSlot,
    startup: WorkerStartup
  ): Promise<void> {
    const timeoutMs =
      this.options.workerInitializationTimeout ??
      DEFAULT_WORKER_INITIALIZATION_TIMEOUT;
    startup.timeout = setTimeout(() => {
      this.failWorkerAttempt(
        slot,
        startup,
        new WorkerPoolWorkerError(
          `WorkerPoolManager: worker initialization timed out after ${timeoutMs}ms`
        )
      );
    }, timeoutMs);
    try {
      const worker = this.options.workerFactory();
      const managedWorker: ManagedWorker = {
        worker,
        requestId: undefined,
        pendingSetupRequestId: undefined,
        renderOptionsVersion: this.renderOptionsVersion,
        langs: new Set([
          'text',
          ...this.resolvedWorkerLanguages.map(({ name }) => name),
        ]),
        customExtensionsVersion: 0,
      };
      slot.worker = managedWorker;
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerWireResponse>) => {
          if (slot.worker === managedWorker) {
            this.handleWorkerMessage(managedWorker, event.data);
          }
        }
      );
      worker.addEventListener('error', (event) => {
        if (slot.worker === managedWorker) {
          this.handleWorkerError(slot, managedWorker, event);
        }
      });

      await new Promise<void>((resolve, reject) => {
        const id = this.generateRequestId();
        const request: InitializeWorkerWireRequest = {
          type: 'initialize',
          resultFormat: 'hast-ops-v1',
          id,
          renderOptions: this.renderOptions,
          preferredHighlighter: this.preferredHighlighter,
          resolvedThemes: this.resolvedWorkerThemes,
          resolvedLanguages: this.resolvedWorkerLanguages,
        };
        const task: InitializeWorkerTask = {
          type: 'initialize',
          id,
          request,
          resolve,
          reject,
          requestStart: Date.now(),
        };
        this.postWorkerSetup(managedWorker, task);
      });

      while (
        slot.startup === startup &&
        managedWorker.renderOptionsVersion !== this.renderOptionsVersion
      ) {
        await this.setRenderOptionsOnWorker(
          managedWorker,
          this.resolvedWorkerThemes
        );
      }
      if (slot.startup !== startup) {
        return;
      }

      slot.state = 'ready';
      this.settleWorkerStartup(slot);
      this.readyWorkerCount++;
      this.workerSlotsExhausted = false;
      const { initialization } = this;
      if (initialization?.state !== 'succeeded') {
        this.initialization = { state: 'succeeded' };
        if (initialization?.state === 'pending') {
          initialization.resolve();
        }
      }
      this.queueDrain();
      this.queueBroadcastStateChanges();
    } catch (cause) {
      this.failWorkerAttempt(slot, startup, cause);
    }
  }

  private postWorkerSetup(
    worker: ManagedWorker,
    task: InitializeWorkerTask | SetRenderOptionsWorkerTask
  ): void {
    // Setup can overlap a render already on this worker. Use a separate
    // request ID so neither acknowledgement clears the other's work.
    this.cancelWorkerSetup(worker);
    this.activeTaskById.set(task.id, task);
    worker.pendingSetupRequestId = task.id;
    this.executeTask(worker, task);
  }

  private cancelWorkerSetup(worker: ManagedWorker, error?: Error): void {
    const { pendingSetupRequestId } = worker;
    if (pendingSetupRequestId != null) {
      const task = this.activeTaskById.get(pendingSetupRequestId);
      if (task?.type === 'initialize' || task?.type === 'set-render-options') {
        task.reject(error ?? new WorkerPoolTaskCanceledError());
      }
      this.cleanWorkerAndTask(worker, task, pendingSetupRequestId);
    }
  }

  private retireWorker(slot: WorkerSlot, error: Error): void {
    const { worker } = slot;
    if (worker == null) {
      return;
    }
    slot.worker = undefined;
    this.cancelWorkerSetup(worker, error);
    worker.worker.terminate();
  }

  // If initialization fails, give the same slot a replacement worker when an
  // automatic retry is available. Otherwise, mark the slot as failed.
  private failWorkerAttempt(
    slot: WorkerSlot,
    startup: WorkerStartup,
    cause: unknown
  ): void {
    if (slot.startup !== startup) {
      return;
    }
    const error = normalizeWorkerStartupError(cause);
    if (slot.state !== 'starting') {
      this.failWorkerSlot(slot, error);
      return;
    }

    clearTimeout(startup.timeout);
    // Use a new attempt record so callbacks from the retired worker are stale.
    const replacement: WorkerStartup = { resolve: startup.resolve };
    slot.startup = replacement;
    slot.state = 'retrying';
    this.retireWorker(slot, error);
    this.queueBroadcastStateChanges();
    void this.startWorkerAttempt(slot, replacement);
  }

  // Retire the worker and leave the slot failed until retryFailedWorkers is
  // called. Other ready workers keep taking work.
  private failWorkerSlot(slot: WorkerSlot, error: WorkerPoolWorkerError): void {
    const wasReady = slot.state === 'ready';
    this.retireWorker(slot, error);
    slot.state = 'failed';
    slot.error = error;
    this.settleWorkerStartup(slot);
    if (wasReady) {
      this.readyWorkerCount--;
    }
    this.queueBroadcastStateChanges();
    if (this.readyWorkerCount > 0 || this.workerSlotsExhausted) {
      return;
    }

    const errors = this.workerSlots.map(({ error }) => error);
    if (!errors.every((error) => error != null)) {
      if (wasReady) {
        this.rejectAllQueuedRenderTasks(slot.error);
      }
      return;
    }

    this.workerSlotsExhausted = true;
    const poolError =
      errors.length === 1
        ? slot.error
        : new WorkerPoolWorkerError(
            `WorkerPoolManager: all ${errors.length} worker slots failed`,
            { cause: new AggregateError(errors, 'Worker slot failures') }
          );
    if (errors.length > 1 && errors.every(isHandledWorkerPoolError)) {
      markWorkerErrorReported(poolError);
    }
    const { initialization } = this;
    if (initialization?.state === 'pending') {
      this.rejectInitialization(initialization, {
        reason: 'workers',
        error: poolError,
      });
    }
    this.rejectAllQueuedRenderTasks(poolError);
  }

  private settleWorkerStartup(slot: WorkerSlot): void {
    const { startup } = slot;
    if (startup != null) {
      slot.startup = undefined;
      clearTimeout(startup.timeout);
      startup.resolve();
    }
  }

  private rejectInitialization(
    initialization: PendingPoolInitialization,
    failure: PoolInitializationFailure
  ): void {
    this.initialization = { state: 'failed', ...failure };
    initialization.reject(failure.error);
  }

  // Clear waiting work before notifying renderers so they can immediately
  // rerender using their local highlighter. A renderer may share multiple tasks.
  private rejectAllQueuedRenderTasks(error: Error): void {
    const instances = new Set<RenderTaskInstance>();
    for (const task of this.removeAllQueuedRenderTasks()) {
      this.rejectRenderTaskCallbacks(task, error);
      for (const instance of getInstances(task)) {
        instances.add(instance);
      }
    }
    this.queueBroadcastStateChanges();
    for (const instance of instances) {
      try {
        instance.onLocalFallback();
      } catch (callbackError) {
        console.error(callbackError);
      }
    }
  }

  /**
   * Pass browser errors to onWorkerError, or log them if no callback is set.
   * Only startup errors interrupt the current request. A ready worker can
   * still acknowledge its work after an unrelated error event.
   */
  private handleWorkerError(
    slot: WorkerSlot,
    managedWorker: ManagedWorker,
    event: ErrorEvent | Event
  ): void {
    const { onWorkerError } = this.options;
    if (onWorkerError != null) {
      try {
        onWorkerError(event, managedWorker.worker);
      } catch (hookError) {
        console.error('WorkerPoolManager: onWorkerError threw:', hookError);
      }
    } else {
      console.error('Worker error:', event, managedWorker);
    }
    const { pendingSetupRequestId } = managedWorker;
    if (slot.startup == null || pendingSetupRequestId == null) {
      return;
    }
    const task = this.activeTaskById.get(pendingSetupRequestId);
    if (task == null || !('reject' in task)) {
      return;
    }
    const error = errorFromWorkerErrorEvent(event);
    if (onWorkerError != null) {
      markWorkerErrorReported(error);
    }
    this.cleanWorkerAndTask(managedWorker, task);
    task.reject(error);
  }

  private drainQueue = () => {
    this._queuedDrain = undefined;
    // If we are initializing or things got cancelled while initializing, we
    // should not attempt to drain the queue
    if (this.readyWorkerCount === 0 || this.queuedTasks.length === 0) {
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
      const langs = getLangsFromRequest(task.request);
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

  public primeFileHighlightCache(file: FileContents): Promise<void> {
    if (!this.isWorkingPool()) {
      return Promise.reject(
        new Error(
          'WorkerPoolManager.primeFileHighlightCache: worker pool is not working'
        )
      );
    }

    if (!this.shouldPrimeFileHighlightCache(file)) {
      return Promise.resolve();
    }
    if (this.shouldHighlightOnMainThread(file)) {
      const options = this.getFileRenderOptions();
      return this.primeHighlightCacheOnMainThread(
        getLangsFromRequest({ type: 'file', file }),
        options.theme,
        (highlighter) =>
          this.setFileResultCache(file.cacheKey, {
            result: renderFileWithHighlighter(file, highlighter, options),
            options,
          })
      );
    }
    const task = this.getOrCreateFileHighlightCacheTask(file);
    return task != null
      ? this.createRenderTaskCallbacks(task)
      : Promise.resolve();
  }

  // Priming needs a cache key to store the result under, and skips files that
  // are plain text or already cached with the current render options.
  private shouldPrimeFileHighlightCache(file: FileContents): boolean {
    if (file.cacheKey == null) {
      console.warn(
        `WorkerPoolManager.primeFileHighlightCache: priming highlight cache requires file.cacheKey; skipping "${file.name}".`
      );
      return false;
    }
    const cachedResult = this.getFileResultCache(file);
    return (
      !isFilePlainText(file) &&
      (cachedResult == null ||
        !areFileRenderOptionsEqual(
          cachedResult.options,
          this.getFileRenderOptions()
        ))
    );
  }

  private getOrCreateFileHighlightCacheTask(
    file: FileContents
  ): RenderFileTask | undefined {
    const highlightKey = this.getFileHighlightKey(file);
    if (highlightKey == null) {
      return undefined;
    }
    const existingTask = this.getTaskByHighlightKey(highlightKey);
    if (existingTask != null) {
      if (existingTask.type !== 'file') {
        throw new Error(
          'WorkerPoolManager.getOrCreateFileHighlightCacheTask: Invalid task type'
        );
      }
      existingTask.primeCache = true;
      return existingTask;
    } else {
      const task = this.submitCacheTask({ type: 'file', file }, highlightKey);
      if (task.type !== 'file') {
        throw new Error(
          'WorkerPoolManager.getOrCreateFileHighlightCacheTask: Invalid task created'
        );
      }
      return task;
    }
  }

  public getPlainFileAST(
    file: FileContents,
    startingLine: number,
    totalLines: number,
    lines?: readonly string[]
  ): ThemedFileResult | undefined {
    const highlighter = getHighlighterIfLoaded({
      theme: this.renderOptions.theme,
    });
    if (highlighter == null) {
      this.queueInitialization();
      return undefined;
    }
    return renderFileWithHighlighter(file, highlighter, this.renderOptions, {
      forcePlainText: true,
      startingLine,
      totalLines,
      lines,
    });
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

  public primeDiffHighlightCache(diff: FileDiffMetadata): Promise<void> {
    if (!this.isWorkingPool()) {
      return Promise.reject(
        new Error(
          'WorkerPoolManager.primeDiffHighlightCache: worker pool is not working'
        )
      );
    }

    if (!this.shouldPrimeDiffHighlightCache(diff)) {
      return Promise.resolve();
    }
    if (this.shouldHighlightOnMainThread(diff)) {
      const options = this.getDiffRenderOptions();
      return this.primeHighlightCacheOnMainThread(
        getLangsFromRequest({ type: 'diff', diff }),
        options.theme,
        (highlighter) =>
          this.setDiffResultCache(diff.cacheKey, {
            result: renderDiffWithHighlighter(diff, highlighter, options),
            options,
          })
      );
    }
    const task = this.getOrCreateDiffHighlightCacheTask(diff);
    return task != null
      ? this.createRenderTaskCallbacks(task)
      : Promise.resolve();
  }

  // Priming needs a cache key to store the result under, and skips diffs that
  // are plain text or already cached with the current render options.
  private shouldPrimeDiffHighlightCache(diff: FileDiffMetadata): boolean {
    if (diff.cacheKey == null) {
      console.warn(
        `WorkerPoolManager.primeDiffHighlightCache: priming highlight cache requires diff.cacheKey; skipping "${diff.prevName ?? diff.name}" -> "${diff.name}".`
      );
      return false;
    }
    const cachedResult = this.getDiffResultCache(diff);
    return (
      !isDiffPlainText(diff) &&
      (cachedResult == null ||
        !areDiffRenderOptionsEqual(
          cachedResult.options,
          this.getDiffRenderOptions()
        ))
    );
  }

  // Runs `highlightAndCacheResult` with the main-thread highlighter for primes
  // within the main-thread threshold. It runs synchronously when the
  // highlighter already has the theme and languages, and after loading them
  // otherwise. Like a worker prime, it rejects as canceled when nothing could
  // be cached, such as after a render options change during the load.
  private primeHighlightCacheOnMainThread(
    langs: SupportedLanguages[],
    theme: WorkerRenderingOptions['theme'],
    highlightAndCacheResult: (highlighter: DiffsHighlighter) => boolean
  ): Promise<void> {
    function highlightAndCacheIfLoaded(): boolean {
      const highlighter = getHighlighterIfLoaded({ theme, langs });
      return highlighter != null && highlightAndCacheResult(highlighter);
    }
    if (highlightAndCacheIfLoaded()) {
      return Promise.resolve();
    }
    const { lifecycleGeneration } = this;
    return this.loadSharedHighlighter(getThemes(theme), [
      'text',
      ...langs,
    ]).then(() => {
      if (!this.isCurrentLifecycle(lifecycleGeneration)) {
        throw new WorkerPoolTerminatedError();
      }
      if (!highlightAndCacheIfLoaded()) {
        throw new WorkerPoolTaskCanceledError();
      }
    });
  }

  private getOrCreateDiffHighlightCacheTask(
    diff: FileDiffMetadata
  ): RenderDiffTask | undefined {
    const highlightKey = this.getDiffHighlightKey(diff);
    if (highlightKey == null) {
      return undefined;
    }
    const existingTask = this.getTaskByHighlightKey(highlightKey);
    if (existingTask != null) {
      if (existingTask.type !== 'diff') {
        throw new Error(
          'WorkerPoolManager.getOrCreateDiffHighlightCacheTask: Invalid task type'
        );
      }
      existingTask.primeCache = true;
      return existingTask;
    } else {
      const task = this.submitCacheTask({ type: 'diff', diff }, highlightKey);
      if (task.type !== 'diff') {
        throw new Error(
          'WorkerPoolManager.getOrCreateDiffHighlightCacheTask: Invalid task created'
        );
      }
      return task;
    }
  }

  public getPlainDiffAST(
    diff: FileDiffMetadata,
    startingLine: number,
    totalLines: number,
    expandedHunks?: ExpandedHunksMap | true,
    collapsedContextThreshold?: number
  ): ThemedDiffResult | undefined {
    const highlighter = getHighlighterIfLoaded({
      theme: this.renderOptions.theme,
    });
    if (highlighter == null) {
      this.queueInitialization();
      return undefined;
    }
    return renderDiffWithHighlighter(diff, highlighter, this.renderOptions, {
      forcePlainText: true,
      startingLine,
      totalLines,
      expandedHunks,
      collapsedContextThreshold,
    });
  }

  public terminate(): void {
    this.lifecycleGeneration++;
    const error = new WorkerPoolTerminatedError();
    this.terminated = true;
    this.readyWorkerCount = 0;
    this.workerSlotsExhausted = false;
    if (this.initialization?.state === 'pending') {
      this.initialization.stopThemeWait?.();
      this.initialization.resolve();
    }
    this.initialization = undefined;
    for (const slot of this.workerSlots) {
      this.settleWorkerStartup(slot);
      this.retireWorker(slot, error);
    }
    this.workerSlots.length = 0;
    this.resolvedWorkerThemes.length = 0;
    this.resolvedWorkerLanguages.length = 0;
    for (const task of this.removeAllQueuedRenderTasks()) {
      this.rejectRenderTaskCallbacks(task, error);
    }
    for (const task of this.activeTaskById.values()) {
      if ('reject' in task) {
        task.reject(error);
      } else if (isRenderTask(task)) {
        this.rejectRenderTaskCallbacks(task, error);
      }
    }
    this.fileCache.clear();
    this.diffCache.clear();
    this.failedHighlightKeys.clear();
    this.activeRequestByInstance.clear();
    this.taskByHighlightKey.clear();
    this.activeTaskById.clear();
    this.queueBroadcastStateChanges();
  }

  private isCurrentLifecycle(lifecycleGeneration: number): boolean {
    return this.lifecycleGeneration === lifecycleGeneration;
  }

  public initializeIfNeeded(): void {
    if (this.initialization == null) {
      this.queueInitialization();
    }
  }

  private queueInitialization(languages?: SupportedLanguages[]): void {
    // Plain renders can request setup repeatedly. Leave a failed attempt
    // settled until the host retries or changes the theme.
    if (this.initialization?.state === 'failed') {
      return;
    }
    void this.initialize(languages).catch((error) => {
      // Skip cancellations and worker errors already passed to onWorkerError.
      if (isHandledWorkerPoolError(error)) {
        return;
      }
      console.error(error);
    });
  }

  private removeAllQueuedRenderTasks(): RenderTask[] {
    const { queuedTasks } = this;
    this.queuedTasks = [];
    this.queuedTaskByInstance.clear();
    for (const task of queuedTasks) {
      this.clearHighlightKey(task);
    }
    return queuedTasks;
  }

  public getStats(): WorkerStats {
    const initializationState = this.initialization?.state;
    let totalWorkers = 0;
    let busyWorkers = 0;
    let retryingWorkerSlots = 0;
    let failedWorkerSlots = 0;
    for (const { state, worker } of this.workerSlots) {
      if (worker != null) {
        totalWorkers++;
        if (worker.requestId != null || worker.pendingSetupRequestId != null) {
          busyWorkers++;
        }
      }
      switch (state) {
        case 'retrying':
          retryingWorkerSlots++;
          break;
        case 'failed':
          failedWorkerSlots++;
          break;
      }
    }

    return {
      managerState:
        initializationState === 'succeeded'
          ? 'initialized'
          : initializationState === 'pending'
            ? 'initializing'
            : 'waiting',
      configuredWorkers: this.configuredWorkers,
      totalWorkers,
      readyWorkers: this.readyWorkerCount,
      retryingWorkerSlots,
      failedWorkerSlots,
      workersFailed: this.workerSlotsExhausted,
      busyWorkers,
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
    if (this.shouldUseLocalFallback()) {
      return;
    }
    this.initializeIfNeeded();

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
    const { renderOptionsVersion } = this;
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
            callbacks: new Set(),
            renderOptionsVersion,
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
            callbacks: new Set(),
            renderOptionsVersion,
            requestStart,
          };
      }
    })();
    this.enqueueRenderTask(task, instance);
  }

  private submitCacheTask(
    request: SubmitRequest,
    highlightKey: string
  ): RenderTask {
    this.initializeIfNeeded();
    const id = this.generateRequestId();
    const requestStart = Date.now();
    const { renderOptionsVersion } = this;
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
            callbacks: new Set(),
            renderOptionsVersion,
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
            callbacks: new Set(),
            renderOptionsVersion,
            requestStart,
          };
      }
    })();
    this.enqueueRenderTask(task);
    return task;
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

  // Cached grammars and lexers return without a promise, so a task can start
  // in the same tick.
  private resolveWorkerLanguages(
    langs: SupportedLanguages[]
  ): ResolvedLanguage[] | Promise<ResolvedLanguage[]> {
    if (this.preferredHighlighter === 'highlights') {
      return resolveHighlightsLanguages(langs);
    }
    return hasResolvedLanguages(langs)
      ? getResolvedLanguages(langs)
      : resolveLanguages(langs);
  }

  private async resolveLanguagesAndExecuteTask(
    availableWorker: ManagedWorker,
    task: RenderFileTask | RenderDiffTask,
    langs: SupportedLanguages[]
  ): Promise<void> {
    try {
      // Preload the same languages on the main thread for editing.
      const highlighter = getHighlighterIfLoaded();
      const mainThreadLangs = langs.filter(
        (lang) =>
          highlighter == null || !areLanguagesAttached(lang, highlighter)
      );
      if (mainThreadLangs.length > 0) {
        void this.loadSharedHighlighter(getThemes(this.renderOptions.theme), [
          'text',
          ...mainThreadLangs,
        ]).catch((error: unknown) => {
          console.error(error);
        });
      }
      // Add resolved languages if required
      // Highlights workers need only the lexers registered for Highlights.
      const workerMissingLangs = langs.filter(
        (lang) =>
          !availableWorker.langs.has(lang) &&
          (this.preferredHighlighter !== 'highlights' ||
            RegisteredHighlightsLanguages.has(lang))
      );

      if (workerMissingLangs.length > 0) {
        const resolving = this.resolveWorkerLanguages(workerMissingLangs);
        task.request.resolvedLanguages = Array.isArray(resolving)
          ? resolving
          : await resolving;
      }
      // If the task has been cleaned up after awaiting language resolving,
      // lets fully clean it up
      if (!this.activeTaskById.has(task.id)) {
        if (availableWorker.requestId === task.id) {
          this.cleanWorkerAndTask(availableWorker, task);
          this.queueBroadcastStateChanges();
          if (this.queuedTasks.length > 0) {
            this.queueDrain();
          }
        }
        return;
      }
      this.executeTask(availableWorker, task);
    } catch (error) {
      this.notifyHighlightError(task, error);
      this.rejectRenderTaskCallbacks(task, normalizeWorkerError(error));
      this.cleanWorkerAndTask(availableWorker, task);
      this.queueBroadcastStateChanges();
      if (this.queuedTasks.length > 0) {
        this.queueDrain();
      }
    }
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerWireResponse
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
          this.rejectRenderTaskCallbacks(task, error);
        } else {
          throw new Error('handleWorkerMessage: unknown task type');
        }
        throw error;
      } else {
        // A failed request may not have attached its languages. Only remember
        // them after success so later tasks resend grammars that were rejected.
        if (isRenderTask(task)) {
          for (const { name } of task.request.resolvedLanguages ?? []) {
            managedWorker.langs.add(name);
          }
        }
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
            const { options } = response;
            if (
              !this.isCurrentRenderTask(task) ||
              !areFileRenderOptionsEqual(options, this.getFileRenderOptions())
            ) {
              throw IGNORE_RESPONSE;
            }
            const { request } = task;
            const result: ThemedFileResult = {
              ...response.result,
              code: decodeHastLines(response.result.code),
            };
            this.syncCustomExtensionVersion(managedWorker, request);
            if (task.cacheKeyAtDispatch != null) {
              this.fileCache.set(task.cacheKeyAtDispatch, { result, options });
            }
            this.resolveRenderTaskCallbacks(task);
            this.notifyFileInstances(task, result, options);
            break;
          }
          case 'diff': {
            if (task.type !== 'diff') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            const { options } = response;
            if (
              !this.isCurrentRenderTask(task) ||
              !areDiffRenderOptionsEqual(options, this.getDiffRenderOptions())
            ) {
              throw IGNORE_RESPONSE;
            }
            const { request } = task;
            const result: ThemedDiffResult = {
              ...response.result,
              code: {
                deletionLines: decodeHastLines(
                  response.result.code.deletionLines
                ),
                additionLines: decodeHastLines(
                  response.result.code.additionLines
                ),
              },
            };
            this.syncCustomExtensionVersion(managedWorker, request);
            if (task.cacheKeyAtDispatch != null) {
              this.diffCache.set(task.cacheKeyAtDispatch, { result, options });
            }
            this.resolveRenderTaskCallbacks(task);
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

    this.cleanWorkerAndTask(managedWorker, task, response.id);
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

  private assignWorkerToTask(task: RenderTask, managedWorker: ManagedWorker) {
    managedWorker.requestId = task.id;
    this.clearQueuedInstanceRequests(task);
    this.trackInstanceRequests(task);
    this.activeTaskById.set(task.id, task);
  }

  private cleanWorkerAndTask(
    managedWorker: ManagedWorker,
    task?: AllWorkerTasks,
    requestId: WorkerRequestId | undefined = task?.id
  ) {
    if (managedWorker.requestId === requestId) {
      managedWorker.requestId = undefined;
    }
    if (managedWorker.pendingSetupRequestId === requestId) {
      managedWorker.pendingSetupRequestId = undefined;
    }
    if (task != null) {
      if (isRenderTask(task)) {
        this.rejectRenderTaskCallbacks(task, new WorkerPoolTaskCanceledError());
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
    try {
      // postMessage clones the request now, so keep the matching cache key on
      // the task instead of reading the caller's mutable target on response.
      if (task.type === 'file') {
        task.cacheKeyAtDispatch = task.request.file.cacheKey;
      } else if (task.type === 'diff') {
        task.cacheKeyAtDispatch = task.request.diff.cacheKey;
      }
      managedWorker.worker.postMessage(task.request);
    } catch (error) {
      console.error('Failed to post message to worker:', error);
      if (isRenderTask(task)) {
        this.notifyHighlightError(task, error);
        this.rejectRenderTaskCallbacks(task, normalizeWorkerError(error));
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
    for (const { state, worker: managedWorker } of this.workerSlots) {
      if (
        state !== 'ready' ||
        managedWorker == null ||
        managedWorker.requestId != null ||
        managedWorker.pendingSetupRequestId != null ||
        managedWorker.renderOptionsVersion !== this.renderOptionsVersion
      ) {
        continue;
      }
      worker = managedWorker;
      if (langs.length === 0) {
        break;
      }
      let hasEveryLang = true;
      for (const lang of langs) {
        // Highlights workers bundle every lexer that has no registered loader.
        if (
          !managedWorker.langs.has(lang) &&
          (this.preferredHighlighter !== 'highlights' ||
            RegisteredHighlightsLanguages.has(lang))
        ) {
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
    this.rejectRenderTaskCallbacks(task, new WorkerPoolTaskCanceledError());
    this.clearQueuedInstanceRequests(task);
    this.clearHighlightKey(task);
  }

  private removeActiveTask(task: RenderTask): void {
    this.rejectRenderTaskCallbacks(task, new WorkerPoolTaskCanceledError());
    this.clearInstanceRequests(task);
    this.clearHighlightKey(task);
    this.activeTaskById.delete(task.id);
  }

  private createRenderTaskCallbacks(task: RenderTask): Promise<void> {
    return new Promise((resolve, reject) => {
      task.callbacks.add({ resolve, reject });
    });
  }

  private resolveRenderTaskCallbacks(task: RenderTask): void {
    if (task.highlightKey != null) {
      this.failedHighlightKeys.delete(task.highlightKey);
    }
    for (const callbacks of task.callbacks) {
      callbacks.resolve();
    }
    task.callbacks.clear();
  }

  private rejectRenderTaskCallbacks(task: RenderTask, error: Error): void {
    for (const callbacks of task.callbacks) {
      callbacks.reject(error);
    }
    task.callbacks.clear();
  }

  private invalidateRenderTasks(): void {
    for (let index = this.queuedTasks.length - 1; index >= 0; index--) {
      const task = this.queuedTasks[index];
      if (task.renderOptionsVersion !== this.renderOptionsVersion) {
        this.removeQueuedTask(task);
      }
    }

    for (const task of Array.from(this.activeTaskById.values())) {
      if (
        isRenderTask(task) &&
        task.renderOptionsVersion !== this.renderOptionsVersion
      ) {
        this.removeActiveTask(task);
      }
    }
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
    if (task.highlightKey != null) {
      this.failedHighlightKeys.set(task.highlightKey, true);
    }
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
        this.isCurrentRenderTask(task) &&
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
        this.isCurrentRenderTask(task) &&
        task.instances.has(instance) &&
        areDiffTargetsEqual(task.request.diff, diff)
      ) {
        return true;
      }
    }
    return false;
  }

  private getTaskByHighlightKey(highlightKey: string): RenderTask | undefined {
    const task = this.taskByHighlightKey.get(highlightKey);
    return task != null && this.isCurrentRenderTask(task) ? task : undefined;
  }

  private isCurrentRenderTask(task: RenderTask): boolean {
    return task.renderOptionsVersion === this.renderOptionsVersion;
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

function getLangsFromRequest(request: SubmitRequest): SupportedLanguages[] {
  const langs = new Set<SupportedLanguages>();
  switch (request.type) {
    case 'file': {
      langs.add(
        request.file.lang ?? getFiletypeFromFileName(request.file.name)
      );
      break;
    }
    case 'diff': {
      langs.add(
        request.diff.lang ?? getFiletypeFromFileName(request.diff.name)
      );
      langs.add(
        request.diff.lang ??
          getFiletypeFromFileName(request.diff.prevName ?? '-')
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
  return task.instances;
}

function normalizeWorkerError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (error != null && typeof error === 'object') {
    if ('error' in error && error.error instanceof Error) {
      return error.error;
    }
    if ('message' in error && typeof error.message === 'string') {
      return new Error(error.message);
    }
  }
  return new Error(String(error));
}

function normalizeWorkerStartupError(error: unknown): WorkerPoolWorkerError {
  return error instanceof WorkerPoolWorkerError
    ? error
    : new WorkerPoolWorkerError(normalizeWorkerError(error).message, {
        cause: error,
      });
}

// Convert a worker error event into a startup error, preserving its cause.
// Script load failures can provide a plain Event without an error or message,
// so use a default message when no details are available.
function errorFromWorkerErrorEvent(
  event: ErrorEvent | Event
): WorkerPoolWorkerError {
  const cause: unknown = 'error' in event ? event.error : undefined;
  const message =
    'message' in event &&
    typeof event.message === 'string' &&
    event.message !== ''
      ? event.message
      : cause instanceof Error
        ? cause.message
        : 'the worker script failed to load (the error event carries no message)';
  return new WorkerPoolWorkerError(
    `WorkerPoolManager: worker failed: ${message}`,
    cause instanceof Error ? { cause } : undefined
  );
}
