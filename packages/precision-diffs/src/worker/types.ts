import type { ElementContent } from 'hast';

import type {
  FileContents,
  FileDiffMetadata,
  PJSThemeNames,
  RenderDiffOptions,
  RenderDiffResult,
  RenderFileOptions,
  RenderFileResult,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
  ThemesType,
} from '../types';

export type WorkerRequestId = string;

export interface RenderFileRequest {
  type: 'file';
  id: WorkerRequestId;
  file: FileContents;
  options: RenderFileOptions;
}

export interface RenderDiffFileRequest {
  type: 'diff-files';
  id: WorkerRequestId;
  oldFile: FileContents;
  newFile: FileContents;
  options: RenderDiffOptions;
}

export interface RenderDiffMetadataRequest {
  type: 'diff-metadata';
  id: WorkerRequestId;
  diff: FileDiffMetadata;
  options: RenderDiffOptions;
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
  requestType: 'diff-files';
  id: WorkerRequestId;
  result: ThemedDiffResult;
  sentAt: number;
}

export interface RenderDiffMetadataSuccessResponse {
  type: 'success';
  requestType: 'diff-metadata';
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
