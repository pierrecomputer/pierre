import { getSharedHighlighter, hasLoadedThemes } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  FileContents,
  FileDiffMetadata,
  LineDiffTypes,
  PJSHighlighter,
  PJSThemeNames,
  RenderDiffOptions,
  RenderDiffResult,
  RenderFileOptions,
  RenderFileResult,
  SupportedLanguages,
  ThemesType,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getThemes } from '../utils/getThemes';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type {
  AllWorkerTasks,
  InitializeWorkerTask,
  RenderDiffMetadataTask,
  RenderDiffTask,
  RenderFileTask,
  SubmitRequest,
  WorkerHighlighterOptions,
  WorkerPoolOptions,
  WorkerRequestId,
  WorkerResponse,
  WorkerStats,
} from './types';

interface ManagedWorker {
  worker: Worker;
  busy: boolean;
  initialized: boolean;
  langs: Set<SupportedLanguages>;
}

export class WorkerPoolManager {
  private highlighter: PJSHighlighter | undefined;
  private currentTheme: PJSThemeNames | ThemesType = DEFAULT_THEMES;
  private initialized: Promise<void> | boolean = false;

  private workers: ManagedWorker[] = [];
  private taskQueue: AllWorkerTasks[] = [];
  private pendingTasks = new Map<WorkerRequestId, AllWorkerTasks>();
  private nextRequestId = 0;

  constructor(
    private options: WorkerPoolOptions,
    private highlighterOptions: WorkerHighlighterOptions
  ) {}

  async setTheme(theme: PJSThemeNames | ThemesType): Promise<void> {
    if (hasLoadedThemes(getThemes(theme)) && this.highlighter != null) {
      this.currentTheme = theme;
    } else {
      this.highlighter = await getSharedHighlighter({
        themes: getThemes(theme),
        langs: ['text'],
      });
      this.currentTheme = theme;
    }
  }

  isInitialized(): boolean {
    return this.initialized === true;
  }

  async initialize(): Promise<void> {
    if (this.initialized === true) {
      return;
    } else if (this.initialized === false) {
      this.initialized = new Promise((resolve) => {
        void (async () => {
          const [highlighter] = await Promise.all([
            getSharedHighlighter({
              themes: getThemes(this.currentTheme),
              preferWasmHighlighter:
                this.highlighterOptions.preferWasmHighlighter,
              langs: ['text'],
            }),
            this.initializeWorkers(),
          ]);
          this.currentTheme = this.highlighterOptions.theme;
          this.highlighter = highlighter;
          this.initialized = true;
          resolve();
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

  async renderFileToAST(
    file: FileContents,
    options: RenderFileOptions
  ): Promise<RenderFileResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.submitTask({
      type: 'file',
      file,
      options,
    });
  }

  renderPlainFileToAST(
    file: FileContents,
    startingLineNumber: number = 1
  ): RenderFileResult | undefined {
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

  async renderDiffFilesToAST(
    oldFile: FileContents,
    newFile: FileContents,
    options: RenderDiffOptions
  ): Promise<RenderDiffResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.submitTask({
      type: 'diff-files',
      oldFile,
      newFile,
      options,
    });
  }

  // NOTE(amadeus): Do we even need this API?
  // Currently nothing is using this function
  renderPlainDiffToAST(
    oldFile: FileContents,
    newFile: FileContents
  ): RenderDiffResult | undefined {
    const oldResult = this.renderPlainFileToAST(oldFile, 1);
    const newResult = this.renderPlainFileToAST(newFile, 1);
    if (oldResult == null || newResult == null) {
      return undefined;
    }
    return {
      code: { oldLines: oldResult.code, newLines: newResult.code },
      themeStyles: newResult.themeStyles,
      baseThemeType: newResult.baseThemeType,
    };
  }

  async renderDiffMetadataToAST(
    diff: FileDiffMetadata,
    options: RenderDiffOptions
  ): Promise<RenderDiffResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.submitTask({
      type: 'diff-metadata',
      diff,
      options,
    });
  }

  renderPlainDiffMetadataToAST(
    diff: FileDiffMetadata,
    lineDiffType: LineDiffTypes
  ): RenderDiffResult | undefined {
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
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers.length = 0;
    this.taskQueue.length = 0;
    this.pendingTasks.clear();
    this.highlighter = undefined;
    this.initialized = false;
  }

  getStats(): WorkerStats {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.busy).length,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
    };
  }

  private submitTask<T extends RenderDiffResult | RenderFileResult>(
    request: SubmitRequest
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.generateRequestId();
      const requestStart = Date.now();
      const task = (() => {
        switch (request.type) {
          case 'file':
            return {
              type: 'file',
              id,
              request: { ...request, id },
              resolve,
              reject,
              requestStart,
            };
          case 'diff-files':
            return {
              type: 'diff-files',
              id,
              request: { ...request, id },
              resolve,
              reject,
              requestStart,
            };
          case 'diff-metadata':
            return {
              type: 'diff-metadata',
              id,
              request: { ...request, id },
              resolve,
              reject,
              requestStart,
            };
        }
      })() as RenderFileTask | RenderDiffTask | RenderDiffMetadataTask;

      this.pendingTasks.set(id, task);

      const availableWorker = this.getAvailableWorker(getLangsFromTask(task));
      if (availableWorker != null) {
        this.executeTask(availableWorker, task);
      } else {
        this.taskQueue.push(task);
      }
    });
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerResponse
  ): void {
    const task = this.pendingTasks.get(response.id);

    if (task == null) {
      console.error(
        'handleWorkerMessage: Received response for unknown task:',
        response
      );
    } else if (response.type === 'error') {
      const error = new Error(response.error);
      if (response.stack) {
        error.stack = response.stack;
      }
      task.reject(error);
    } else {
      try {
        switch (response.requestType) {
          case 'initialize':
            if (task.type !== 'initialize') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve();
            break;
          case 'file':
            if (task.type !== 'file') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve(response.result);
            break;
          case 'diff-files':
            if (task.type !== 'diff-files') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve(response.result);
            break;
          case 'diff-metadata':
            if (task.type !== 'diff-metadata') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve(response.result);
            break;
        }
      } catch (e) {
        console.error(e, task, response);
      }
    }

    this.pendingTasks.delete(response.id);
    managedWorker.busy = false;
    const nextTask = this.taskQueue.shift();
    if (nextTask != null) {
      this.executeTask(managedWorker, nextTask);
    }
  }

  private executeTask(
    managedWorker: ManagedWorker,
    task: AllWorkerTasks
  ): void {
    managedWorker.busy = true;
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
      case 'diff-files': {
        langs.add(getFiletypeFromFileName(task.request.newFile.name));
        langs.add(getFiletypeFromFileName(task.request.oldFile.name));
        break;
      }
      case 'diff-metadata': {
        langs.add(getFiletypeFromFileName(task.request.diff.name));
        langs.add(getFiletypeFromFileName(task.request.diff.prevName ?? '-'));
        break;
      }
    }
  }
  langs.delete('text');
  return Array.from(langs);
}
