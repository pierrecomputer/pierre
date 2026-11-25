import type { Language as HighlightsLanguage } from '@pierre/highlights';
import type { LanguageRegistration } from 'shiki';

import type {
  DiffLib,
  DiffsTheme,
  DiffsThemeNames,
  ExtensionFormatMap,
  FileContents,
  FileDiffMetadata,
  HighlighterTypes,
  LineDiffTypes,
  RenderDiffOptions,
  RenderFileOptions,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
  ThemesType,
} from '../types';

export type WorkerRequestId = string;

export interface WorkerRenderingOptions {
  theme: DiffsThemeNames | ThemesType;
  useTokenTransformer: boolean;
  tokenizeMaxLineLength: number;
  lineDiffType: LineDiffTypes;
  preferredDiffLib?: DiffLib;
  maxLineDiffLength: number;
}

export interface FileRendererInstance {
  readonly __id: string;
  onHighlightSuccess(
    file: FileContents,
    result: ThemedFileResult,
    options: RenderFileOptions
  ): unknown;
  onHighlightError(error: unknown): unknown;
  /** The pool dropped this renderer's queued work. Redraw using the local highlighter. */
  onLocalFallback(): unknown;
}

export interface DiffRendererInstance {
  readonly __id: string;
  onHighlightSuccess(
    diff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions
  ): unknown;
  onHighlightError(error: unknown): unknown;
  /** The pool dropped this renderer's queued work. Redraw using the local highlighter. */
  onLocalFallback(): unknown;
}

export interface RenderFileRequest {
  type: 'file';
  id: WorkerRequestId;
  file: FileContents;
  resolvedLanguages?: ResolvedLanguage[];
  customExtensionsVersion?: number;
  customExtensionMap?: ExtensionFormatMap;
}

export interface RenderDiffRequest {
  type: 'diff';
  id: WorkerRequestId;
  diff: FileDiffMetadata;
  resolvedLanguages?: ResolvedLanguage[];
  customExtensionsVersion?: number;
  customExtensionMap?: ExtensionFormatMap;
}

export interface InitializeWorkerRequest {
  type: 'initialize';
  id: WorkerRequestId;
  renderOptions: WorkerRenderingOptions;
  preferredHighlighter: HighlighterTypes;
  resolvedThemes: DiffsTheme[];
  resolvedLanguages?: ResolvedLanguage[];
  customExtensionsVersion?: number;
  customExtensionMap?: ExtensionFormatMap;
}

export interface ResolvedLanguage {
  name: Exclude<SupportedLanguages, 'text'>;
  data: LanguageRegistration[];
  /** A lexer from `registerCustomLanguage(name, loader, files, 'highlights')`. */
  highlights?: HighlightsLanguage;
}

export interface SetRenderOptionsWorkerRequest {
  type: 'set-render-options';
  id: WorkerRequestId;
  renderOptions: WorkerRenderingOptions;
  resolvedThemes: DiffsTheme[];
}

export type SubmitRequest =
  | Omit<RenderFileRequest, 'id'>
  | Omit<RenderDiffRequest, 'id'>;

export type WorkerRequest =
  | RenderFileRequest
  | RenderDiffRequest
  | InitializeWorkerRequest
  | SetRenderOptionsWorkerRequest;

export interface RenderFileSuccessResponse {
  type: 'success';
  requestType: 'file';
  id: WorkerRequestId;
  result: ThemedFileResult;
  options: RenderFileOptions;
  sentAt: number;
}

export interface RenderDiffSuccessResponse {
  type: 'success';
  requestType: 'diff';
  id: WorkerRequestId;
  result: ThemedDiffResult;
  options: RenderDiffOptions;
  sentAt: number;
}

export interface InitializeSuccessResponse {
  type: 'success';
  requestType: 'initialize';
  id: WorkerRequestId;
  sentAt: number;
}

export interface RegisterThemeSuccessResponse {
  type: 'success';
  requestType: 'set-render-options';
  id: WorkerRequestId;
  sentAt: number;
}

export interface RenderErrorResponse {
  type: 'error';
  id: WorkerRequestId;
  error: string;
  stack?: string;
}

export type RenderSuccessResponse =
  | RenderFileSuccessResponse
  | RenderDiffSuccessResponse;

export type WorkerResponse =
  | RenderSuccessResponse
  | RenderErrorResponse
  | InitializeSuccessResponse
  | RegisterThemeSuccessResponse;

export interface WorkerPoolOptions {
  /**
   * Factory function that creates a new Web Worker instance for the pool.
   * Called for the initial workers and their replacements. Do not perform any
   * additional side effects in this function other than creating a worker
   * instance.
   */
  workerFactory: () => Worker;

  /**
   * Number of workers to create in the pool.
   * Defaults to one fewer than the reported logical processor count,
   * with a minimum of 1 and a maximum of 3. Uses 1 if the count is unavailable.
   */
  poolSize?: number;

  /**
   * Timeout in milliseconds for initializing a worker.
   * @default 5000
   */
  workerInitializationTimeout?: number;

  /**
   * Called for each worker error instead of logging it with console.error.
   * Call event.preventDefault() to prevent the browser from also reporting it
   * as an uncaught error.
   *
   * Script load failures may provide a plain Event without message or error;
   * uncaught exceptions provide an ErrorEvent. Components highlight on the
   * main thread if every worker slot fails to start.
   *
   * Several workers can report the same script load failure. Track errors in
   * this callback if your application should report that failure only once.
   */
  onWorkerError?: (event: ErrorEvent | Event, worker: Worker) => void;

  totalASTLRUCacheSize?: number;

  /**
   * Files and diffs with at most this many characters highlight on the main
   * thread instead of a worker. Small highlights finish faster than a worker
   * round trip, so they render highlighted without a plain-text pass. Files
   * count `contents`; diffs count both sides of the diff. Main-thread results
   * share the pool's highlight cache, and priming the cache follows the same
   * rule.
   *
   * When unset, every highlight uses a worker.
   */
  mainThreadMaxCharacters?: number;
}

export interface WorkerInitializationRenderOptions extends Partial<WorkerRenderingOptions> {
  langs?: SupportedLanguages[];
  preferredHighlighter?: HighlighterTypes;
}

export interface InitializeWorkerTask {
  type: 'initialize';
  id: WorkerRequestId;
  request: InitializeWorkerRequest;
  resolve(value?: undefined): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface SetRenderOptionsWorkerTask {
  type: 'set-render-options';
  id: WorkerRequestId;
  request: SetRenderOptionsWorkerRequest;
  resolve(value?: undefined): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface RenderTaskCallbacks {
  resolve(): void;
  reject(error: Error): void;
}

export interface RenderFileTask {
  type: 'file';
  id: WorkerRequestId;
  request: RenderFileRequest;
  /** Cache key included in the payload when it was dispatched to the worker. */
  cacheKeyAtDispatch?: string;
  instances: Set<FileRendererInstance>;
  // If primeCache is true, then the request will still be sent to workers
  // regardless of whether there's any instances subscribed to the task
  primeCache: boolean;
  highlightKey?: string;
  callbacks: Set<RenderTaskCallbacks>;
  renderOptionsVersion: number;
  requestStart: number;
}

export interface RenderDiffTask {
  type: 'diff';
  id: WorkerRequestId;
  request: RenderDiffRequest;
  /** Cache key included in the payload when it was dispatched to the worker. */
  cacheKeyAtDispatch?: string;
  instances: Set<DiffRendererInstance>;
  // If primeCache is true, then the request will still be sent to workers
  // regardless of whether there's any instances subscribed to the task
  primeCache: boolean;
  highlightKey?: string;
  callbacks: Set<RenderTaskCallbacks>;
  renderOptionsVersion: number;
  requestStart: number;
}

export type AllWorkerTasks =
  | InitializeWorkerTask
  | SetRenderOptionsWorkerTask
  | RenderFileTask
  | RenderDiffTask;

export interface WorkerStats {
  managerState: 'waiting' | 'initializing' | 'initialized';
  /** The pool fell back to local highlighting after all worker slots failed. */
  workersFailed: boolean;
  configuredWorkers: number;
  totalWorkers: number;
  readyWorkers: number;
  retryingWorkerSlots: number;
  failedWorkerSlots: number;
  busyWorkers: number;
  queuedTasks: number;
  activeTasks: number;
  themeSubscribers: number;
  fileCacheSize: number;
  diffCacheSize: number;
}
