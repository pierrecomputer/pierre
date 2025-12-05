import type {
  FileContents,
  FileDiffMetadata,
  LanguageRegistration,
  LineDiffTypes,
  PJSThemeNames,
  RenderDiffOptions,
  RenderFileOptions,
  SupportedLanguages,
  ThemeRegistrationResolved,
  ThemedDiffResult,
  ThemedFileResult,
  ThemesType,
} from '../types';

export type WorkerRequestId = string;

export interface WorkerRenderingOptions {
  theme: PJSThemeNames | ThemesType;
  tokenizeMaxLineLength: number;
  lineDiffType: LineDiffTypes;
}

export interface FileRendererInstance {
  onHighlightSuccess(
    file: FileContents,
    result: ThemedFileResult,
    options: RenderFileOptions
  ): unknown;
  onHighlightError(error: unknown): unknown;
}

export interface DiffRendererInstance {
  onHighlightSuccess(
    diff: FileDiffMetadata,
    result: ThemedDiffResult,
    options: RenderDiffOptions
  ): unknown;
  onHighlightError(error: unknown): unknown;
}

export interface RenderFileRequest {
  type: 'file';
  id: WorkerRequestId;
  file: FileContents;
  resolvedLanguages?: ResolvedLanguage[];
}

export interface RenderDiffRequest {
  type: 'diff';
  id: WorkerRequestId;
  diff: FileDiffMetadata;
  resolvedLanguages?: ResolvedLanguage[];
}

export interface InitializeWorkerRequest {
  type: 'initialize';
  id: WorkerRequestId;
  renderOptions: WorkerRenderingOptions;
  resolvedThemes: ThemeRegistrationResolved[];
  resolvedLanguages?: ResolvedLanguage[];
}

export interface ResolvedLanguage {
  name: Exclude<SupportedLanguages, 'text'>;
  data: LanguageRegistration[];
}

export interface RegisterThemeWorkerRequest {
  type: 'register-theme';
  id: WorkerRequestId;
  theme: PJSThemeNames | ThemesType;
  resolvedThemes: ThemeRegistrationResolved[];
}

export type SubmitRequest =
  | Omit<RenderFileRequest, 'id'>
  | Omit<RenderDiffRequest, 'id'>;

export type WorkerRequest =
  | RenderFileRequest
  | RenderDiffRequest
  | InitializeWorkerRequest
  | RegisterThemeWorkerRequest;

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
  requestType: 'register-theme';
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
   * This is called once per worker in the pool during initialization.
   */
  workerFactory: () => Worker;

  /**
   * Number of workers to create in the pool.
   * @default 8
   */
  poolSize?: number;

  /**
   * Enables caching of rendered file and diff AST results using an LRU cache.
   *
   * When enabled, the pool manager will store the highlighted AST results for
   * files and diffs. Subsequent requests for the same file/diff content will
   * return the cached result immediately instead of re-processing through a
   * worker. This works automatically for both React and Vanilla JS APIs.
   *
   * The cache is automatically invalidated when:
   * - The theme changes via `setTheme()`
   * - The pool is terminated
   *
   * **Note:** This is an experimental feature and is disabled by default while
   * it is being validated in production use cases.
   *
   * @default false
   */
  enableASTCache?: boolean;
}

export interface WorkerHighlighterOptions
  extends Partial<WorkerRenderingOptions> {
  langs?: SupportedLanguages[];
}

export interface InitializeWorkerTask {
  type: 'initialize';
  id: WorkerRequestId;
  request: InitializeWorkerRequest;
  resolve(value?: undefined): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface RegisterThemeWorkerTask {
  type: 'register-theme';
  id: WorkerRequestId;
  request: RegisterThemeWorkerRequest;
  resolve(value?: undefined): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface RenderFileTask {
  type: 'file';
  id: WorkerRequestId;
  request: RenderFileRequest;
  instance: FileRendererInstance;
  requestStart: number;
}

export interface RenderDiffTask {
  type: 'diff';
  id: WorkerRequestId;
  request: RenderDiffRequest;
  instance: DiffRendererInstance;
  requestStart: number;
}

export type AllWorkerTasks =
  | InitializeWorkerTask
  | RegisterThemeWorkerTask
  | RenderFileTask
  | RenderDiffTask;

export interface WorkerStats {
  totalWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  pendingTasks: number;
}
