import type { ElementContent } from 'hast';

import type {
  FileContents,
  FileDiffMetadata,
  LanguageRegistration,
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
  options: RenderFileOptions;
  resolvedLanguages?: ResolvedLanguage[];
}

export interface RenderDiffRequest {
  type: 'diff';
  id: WorkerRequestId;
  diff: FileDiffMetadata;
  options: RenderDiffOptions;
  resolvedLanguages?: ResolvedLanguage[];
}

export interface InitializeWorkerRequest {
  type: 'initialize';
  id: WorkerRequestId;
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

export interface RenderDiffFilesResult {
  oldLines: ElementContent[];
  newLines: ElementContent[];
  hunks?: undefined;
}

export interface RenderDiffHunksResult {
  hunks: RenderDiffFilesResult[];
  oldLines?: undefined;
  newLines?: undefined;
}

export interface RenderFileSuccessResponse {
  type: 'success';
  requestType: 'file';
  id: WorkerRequestId;
  result: ThemedFileResult;
  sentAt: number;
}

export interface RenderDiffSuccessResponse {
  type: 'success';
  requestType: 'diff';
  id: WorkerRequestId;
  result: ThemedDiffResult;
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
  workerFactory: () => Worker;
  poolSize?: number;
}

export interface WorkerHighlighterOptions {
  theme: PJSThemeNames | ThemesType;
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
