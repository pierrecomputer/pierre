import { LRUMap } from 'lru_map';

import { DEFAULT_THEMES } from '../constants';
import {
  getResolvedLanguages,
  hasResolvedLanguages,
  resolveLanguages,
} from '../highlighter/languages';
import { getSharedHighlighter } from '../highlighter/shared_highlighter';
import {
  attachResolvedThemes,
  getResolvedThemes,
  hasResolvedThemes,
  resolveThemes,
} from '../highlighter/themes';
import type {
  FileContents,
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  RenderDiffOptions,
  RenderDiffResult,
  RenderFileOptions,
  RenderFileResult,
  SupportedLanguages,
  ThemeRegistrationResolved,
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
  RegisterThemeWorkerTask,
  RenderDiffRequest,
  RenderDiffTask,
  RenderFileRequest,
  RenderFileTask,
  ResolvedLanguage,
  SubmitRequest,
  WorkerHighlighterOptions,
  WorkerPoolOptions,
  WorkerRenderingOptions,
  WorkerRequestId,
  WorkerResponse,
  WorkerStats,
} from './types';

const IGNORE_RESPONSE = Symbol('IGNORE_RESPONSE');

interface GetCachesResult {
  fileCache: LRUMap<FileContents, RenderFileResult>;
  diffCache: LRUMap<FileDiffMetadata, RenderDiffResult>;
}

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
  private fileCache: LRUMap<FileContents, RenderFileResult> = new LRUMap(50);
  private diffCache: LRUMap<FileDiffMetadata, RenderDiffResult> = new LRUMap(
    50
  );

  constructor(
    private options: WorkerPoolOptions,
    {
      langs,
      theme = DEFAULT_THEMES,
      lineDiffType = 'word-alt',
      tokenizeMaxLineLength = 1000,
    }: WorkerHighlighterOptions
  ) {
    this.renderOptions = { theme, lineDiffType, tokenizeMaxLineLength };
    void this.initialize(langs);
  }

  isWorkingPool(): boolean {
    return !this.workersFailed;
  }

  getFileResultCache(file: FileContents): RenderFileResult | undefined {
    return this.fileCache.get(file);
  }

  getDiffResultCache(diff: FileDiffMetadata): RenderDiffResult | undefined {
    return this.diffCache.get(diff);
  }

  inspectCaches(): GetCachesResult {
    const { fileCache, diffCache } = this;
    return { fileCache, diffCache };
  }

  // FIXME(amadeus): Add an API to potentially change the other render options
  // dynamically, or replace this method with that...
  async setTheme(theme: PJSThemeNames | ThemesType): Promise<void> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    if (areThemesEqual(theme, this.renderOptions.theme)) {
      return;
    }

    const themeNames = getThemes(theme);
    let resolvedThemes: ThemeRegistrationResolved[] = [];
    if (hasResolvedThemes(themeNames)) {
      resolvedThemes = getResolvedThemes(themeNames);
    } else {
      resolvedThemes = await resolveThemes(themeNames);
    }

    if (this.highlighter != null) {
      attachResolvedThemes(resolvedThemes, this.highlighter);
      await this.registerThemesOnWorkers(theme, resolvedThemes);
      this.renderOptions.theme = theme;
    } else {
      const [highlighter] = await Promise.all([
        getSharedHighlighter({ themes: themeNames, langs: ['text'] }),
        this.registerThemesOnWorkers(theme, resolvedThemes),
      ]);
      this.highlighter = highlighter;
      this.renderOptions.theme = theme;
    }

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

  private async registerThemesOnWorkers(
    theme: PJSThemeNames | ThemesType,
    resolvedThemes: ThemeRegistrationResolved[]
  ): Promise<void> {
    if (resolvedThemes.length === 0 || this.workersFailed) {
      return;
    }
    if (!this.isInitialized()) {
      await this.initialize();
    }
    const registerPromises: Promise<void>[] = [];
    for (const managedWorker of this.workers) {
      if (!managedWorker.initialized) {
        console.log({ managedWorker });
        throw new Error(
          'registerThemesOnWorkers: Somehow we have an uninitialized worker'
        );
      }
      registerPromises.push(
        new Promise<void>((resolve, reject) => {
          const id = this.generateRequestId();
          const task: RegisterThemeWorkerTask = {
            type: 'register-theme',
            id,
            request: { type: 'register-theme', id, theme, resolvedThemes },
            resolve,
            reject,
            requestStart: Date.now(),
          };
          this.pendingTasks.set(id, task);
          managedWorker.worker.postMessage(task.request);
        })
      );
    }
    await Promise.all(registerPromises);
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
              reject();
              return;
            }
            this.highlighter = highlighter;
            this.initialized = true;
            this.diffCache.clear();
            this.fileCache.clear();
            this.drainQueue();
            resolve();
          } catch (e) {
            this.initialized = false;
            this.workersFailed = true;
            reject(e);
          }
        })();
      });
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
        busy: false,
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
      this.taskQueue.shift();
      void this.resolveLanguagesAndExecuteTask(availableWorker, task, langs);
    }
  };

  highlightFileAST(instance: FileRendererInstance, file: FileContents): void {
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
    this.submitTask(instance, { type: 'diff', diff });
  }

  getPlainDiffAST(diff: FileDiffMetadata): ThemedDiffResult | undefined {
    return this.highlighter != null
      ? renderDiffWithHighlighter(
          diff,
          this.highlighter,
          this.renderOptions,
          true
        )
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
          case 'register-theme':
            if (task.type !== 'register-theme') {
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
            if (this.options.enableASTCache === true) {
              this.fileCache.set(request.file, { result, options });
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
            if (this.options.enableASTCache === true) {
              this.diffCache.set(request.diff, { result, options });
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
  if (task.type === 'initialize' || task.type === 'register-theme') {
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
