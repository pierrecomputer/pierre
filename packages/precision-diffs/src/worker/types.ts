import type { ElementContent } from 'hast';

import type {
  CodeToHastOptions,
  FileContents,
  PJSThemeNames,
  SupportedLanguages,
} from '../types';

/**
 * Message types for communication between main thread and worker threads
 */

export type WorkerRequestId = string | number;

// Request messages sent from main thread to worker

export interface RenderFileRequest {
  type: 'file';
  id: WorkerRequestId;
  file: FileContents;
  options: RenderOptions;
}

export interface RenderDiffRequest {
  type: 'diff';
  id: WorkerRequestId;
  oldFile: FileContents;
  newFile: FileContents;
  options: RenderOptions;
}

export interface InitializeWorkerRequest {
  type: 'initialize';
  id: WorkerRequestId;
  options: WorkerInitOptions;
}

export type WorkerRequest =
  | RenderFileRequest
  | RenderDiffRequest
  | InitializeWorkerRequest;

// Result types for different operations
export interface RenderFileResult {
  lines: ElementContent[];
}

export interface RenderDiffResult {
  oldLines: ElementContent[];
  newLines: ElementContent[];
}

export interface RenderFileSuccessResponse {
  type: 'success';
  requestType: 'render-file';
  id: WorkerRequestId;
  result: RenderFileResult;
}

export interface RenderDiffSuccessResponse {
  type: 'success';
  requestType: 'render-diff';
  id: WorkerRequestId;
  result: RenderDiffResult;
}

export type RenderSuccessResponse =
  | RenderFileSuccessResponse
  | RenderDiffSuccessResponse;

export interface RenderErrorResponse {
  type: 'error';
  id: WorkerRequestId;
  error: string;
  stack?: string;
}

export interface InitializeSuccessResponse {
  type: 'initialized';
  id: WorkerRequestId;
  result: void;
}

export type WorkerResponse =
  | RenderSuccessResponse
  | RenderErrorResponse
  | InitializeSuccessResponse;

// Options types

export interface RenderOptions {
  lang?: SupportedLanguages;
  theme?: PJSThemeNames | Record<'dark' | 'light', PJSThemeNames>;
  preferWasmHighlighter?: boolean;
  // Pass through any additional CodeToHastOptions
  hastOptions?: Partial<CodeToHastOptions<PJSThemeNames>>;
}

export interface WorkerInitOptions {
  themes: PJSThemeNames[];
  // Pre-load specific languages
  langs?: SupportedLanguages[];
  preferWasmHighlighter?: boolean;
}

// Worker pool types

export interface WorkerPoolOptions {
  /**
   * Number of worker threads to create
   * @default 4
   */
  poolSize?: number;
  initOptions?: WorkerInitOptions;
}

// Discriminated WorkerTask types - each task type maps to its result type
export interface InitializeWorkerTask {
  type: 'initialize';
  id: WorkerRequestId;
  request: InitializeWorkerRequest;
  resolve: (value: void) => void;
  reject: (error: Error) => void;
}

export interface RenderFileTask {
  type: 'file';
  id: WorkerRequestId;
  request: RenderFileRequest;
  resolve: (value: RenderFileResult) => void;
  reject: (error: Error) => void;
}

export interface RenderDiffTask {
  type: 'diff';
  id: WorkerRequestId;
  request: RenderDiffRequest;
  resolve: (value: RenderDiffResult) => void;
  reject: (error: Error) => void;
}

export type WorkerTask = InitializeWorkerTask | RenderFileTask | RenderDiffTask;
