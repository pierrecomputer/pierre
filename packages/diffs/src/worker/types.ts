import type {
  DiffsThemeNames,
  FileContents,
  FileDiffMetadata,
  HighlighterTypes,
  LanguageRegistration,
  LineDiffTypes,
  RenderDiffOptions,
  RenderFileOptions,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
  ThemeRegistrationResolved,
  ThemesType,
} from '../types';

export type WorkerRequestId = string;

export interface WorkerRenderingOptions {
  theme: DiffsThemeNames | ThemesType;
  tokenizeMaxLineLength: number;
  lineDiffType: LineDiffTypes;
}

export interface FileRendererInstance {
  readonly __id: string;
  onHighlightSuccess(
    file: FileContents,
    result: ThemedFileResult,
    options: RenderFileOptions
  ): unknown;
  onHighlightError(error: unknown): unknown;
}

export interface DiffRendererInstance {
  readonly __id: string;
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
  preferredHighlighter: HighlighterTypes;
  resolvedThemes: ThemeRegistrationResolved[];
  resolvedLanguages?: ResolvedLanguage[];
}

export interface ResolvedLanguage {
  name: Exclude<SupportedLanguages, 'text'>;
  data: LanguageRegistration[];
}

export interface SetRenderOptionsWorkerRequest {
  type: 'set-render-options';
  id: WorkerRequestId;
  renderOptions: WorkerRenderingOptions;
  resolvedThemes: ThemeRegistrationResolved[];
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
   * This is called once per worker in the pool during initialization.
   */
  workerFactory: () => Worker;

  /**
   * Number of workers to create in the pool.
   * @default 8
   */
  poolSize?: number;

  totalASTLRUCacheSize?: number;
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
  | SetRenderOptionsWorkerTask
  | RenderFileTask
  | RenderDiffTask;

export interface WorkerStats {
  managerState: 'waiting' | 'initializing' | 'initialized';
  workersFailed: boolean;
  totalWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  pendingTasks: number;
  themeSubscribers: number;
  fileCacheSize: number;
  diffCacheSize: number;
}
