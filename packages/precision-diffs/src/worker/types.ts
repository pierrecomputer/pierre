import type { ElementContent } from 'hast';

import type {
  CodeToHastOptions,
  FileContents,
  FileDiffMetadata,
  PJSThemeNames,
  SupportedLanguages,
  ThemesType,
} from '../types';

export type WorkerRequestId = string;

export interface RenderFileRequest {
  type: 'file';
  id: WorkerRequestId;
  file: FileContents;
  options?: WorkerRenderFileOptions;
}

export interface RenderDiffFileRequest {
  type: 'diff-files';
  id: WorkerRequestId;
  oldFile: FileContents;
  newFile: FileContents;
  options?: WorkerRenderFileOptions;
}

export interface RenderDiffMetadataRequest {
  type: 'diff-metadata';
  id: WorkerRequestId;
  diff: FileDiffMetadata;
  options?: WorkerRenderFileOptions;
}

export interface InitializeWorkerRequest {
  type: 'initialize';
  id: WorkerRequestId;
  options: WorkerHighlighterOptions;
}

export type SubmitRequest =
  | Omit<RenderFileRequest, 'id'>
  | Omit<RenderDiffFileRequest, 'id'>
  | Omit<RenderDiffMetadataRequest, 'id'>;

export type WorkerRequest =
  | RenderFileRequest
  | RenderDiffFileRequest
  | RenderDiffMetadataRequest
  | InitializeWorkerRequest;

export interface RenderFileResult {
  lines: ElementContent[];
}

export interface RenderDiffResult {
  oldLines: ElementContent[];
  newLines: ElementContent[];
}

export interface RenderFileSuccessResponse {
  type: 'success';
  requestType: 'file';
  id: WorkerRequestId;
  result: RenderFileResult;
  sentAt: number;
}

export interface RenderDiffSuccessResponse {
  type: 'success';
  requestType: 'diff-files';
  id: WorkerRequestId;
  result: RenderDiffResult;
  sentAt: number;
}

export interface RenderDiffMetadataSuccessResponse {
  type: 'success';
  requestType: 'diff-metadata';
  id: WorkerRequestId;
  result: RenderDiffResult;
  sentAt: number;
}

export interface InitializeSuccessResponse {
  type: 'success';
  requestType: 'initialize';
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
  | RenderDiffSuccessResponse
  | RenderDiffMetadataSuccessResponse;

export type WorkerResponse =
  | RenderSuccessResponse
  | RenderErrorResponse
  | InitializeSuccessResponse;

// FIXME(amadeus): We may have to do more work here...
export interface WorkerRenderFileOptions
  extends Omit<CodeToHastOptions<PJSThemeNames>, 'lang'> {
  lang?: SupportedLanguages;
  theme?: PJSThemeNames | Record<'dark' | 'light', PJSThemeNames>;
  disableLineNumbers?: boolean;
  startingLineNumber?: number;
}

export interface WorkerPoolOptions {
  workerFactory: () => Worker;
  poolSize?: number;
}

export interface WorkerHighlighterOptions {
  theme: PJSThemeNames | ThemesType;
  langs?: SupportedLanguages[];
  preferWasmHighlighter?: boolean;
}

export interface InitializeWorkerTask {
  type: 'initialize';
  id: WorkerRequestId;
  request: InitializeWorkerRequest;
  resolve(value?: undefined): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface RenderFileTask {
  type: 'file';
  id: WorkerRequestId;
  request: RenderFileRequest;
  resolve(value: RenderFileResult): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface RenderDiffTask {
  type: 'diff-files';
  id: WorkerRequestId;
  request: RenderDiffFileRequest;
  resolve(value: RenderDiffResult): void;
  reject(error: Error): void;
  requestStart: number;
}

export interface RenderDiffMetadataTask {
  type: 'diff-metadata';
  id: WorkerRequestId;
  request: RenderDiffMetadataRequest;
  resolve(value: RenderDiffResult): void;
  reject(error: Error): void;
  requestStart: number;
}

export type AllWorkerTasks =
  | InitializeWorkerTask
  | RenderFileTask
  | RenderDiffTask
  | RenderDiffMetadataTask;

export interface WorkerStats {
  totalWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  pendingTasks: number;
}
