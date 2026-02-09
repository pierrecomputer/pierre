import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

import { DEFAULT_THEMES } from '../constants';
import { attachResolvedLanguages } from '../highlighter/languages/attachResolvedLanguages';
import { attachResolvedThemes } from '../highlighter/themes/attachResolvedThemes';
import type {
  DiffsHighlighter,
  HighlighterTypes,
  RenderDiffOptions,
  RenderFileOptions,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type {
  InitializeSuccessResponse,
  InitializeWorkerRequest,
  RenderDiffRequest,
  RenderDiffSuccessResponse,
  RenderErrorResponse,
  RenderFileRequest,
  RenderFileSuccessResponse,
  SetRenderOptionsWorkerRequest,
  WorkerRenderingOptions,
  WorkerRequest,
  WorkerRequestId,
} from './types';

let highlighter: Promise<DiffsHighlighter> | DiffsHighlighter | undefined;
let renderOptions: WorkerRenderingOptions = {
  theme: DEFAULT_THEMES,
  tokenizeMaxLineLength: 1000,
  lineDiffType: 'word-alt',
};

self.addEventListener('error', (event) => {
  console.error('[Shiki Worker] Unhandled error:', event.error);
});

// Handle incoming messages from the main thread
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handleMessage(event.data);
});

async function handleMessage(request: WorkerRequest) {
  try {
    switch (request.type) {
      case 'initialize':
        await handleInitialize(request);
        break;
      case 'set-render-options':
        await handleSetRenderOptions(request);
        break;
      case 'file':
        await handleRenderFile(request);
        break;
      case 'diff':
        await handleRenderDiff(request);
        break;
      default:
        throw new Error(
          `Unknown request type: ${(request as WorkerRequest).type}`
        );
    }
  } catch (error) {
    console.error('Worker error:', error);
    sendError(request.id, error);
  }
}

async function handleInitialize({
  id,
  renderOptions: options,
  preferredHighlighter,
  resolvedThemes,
  resolvedLanguages,
}: InitializeWorkerRequest): Promise<void> {
  let highlighter = getHighlighter(preferredHighlighter);
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  attachResolvedThemes(resolvedThemes, highlighter);
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  renderOptions = options;
  postMessage({
    type: 'success',
    id,
    requestType: 'initialize',
    sentAt: Date.now(),
  } satisfies InitializeSuccessResponse);
}

async function handleSetRenderOptions({
  id,
  renderOptions: options,
  resolvedThemes,
}: SetRenderOptionsWorkerRequest): Promise<void> {
  let highlighter = getHighlighter();
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  attachResolvedThemes(resolvedThemes, highlighter);
  renderOptions = options;
  postMessage({
    type: 'success',
    id,
    requestType: 'set-render-options',
    sentAt: Date.now(),
  });
}

async function handleRenderFile({
  id,
  file,
  resolvedLanguages,
}: RenderFileRequest): Promise<void> {
  let highlighter = getHighlighter();
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  const fileOptions = {
    theme: renderOptions.theme,
    tokenizeMaxLineLength: renderOptions.tokenizeMaxLineLength,
  };
  sendFileSuccess(
    id,
    renderFileWithHighlighter(file, highlighter, fileOptions),
    fileOptions
  );
}

async function handleRenderDiff({
  id,
  diff,
  resolvedLanguages,
}: RenderDiffRequest): Promise<void> {
  let highlighter = getHighlighter();
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  const result = renderDiffWithHighlighter(diff, highlighter, renderOptions);
  sendDiffSuccess(id, result, renderOptions);
}

function getHighlighter(
  preferredHighlighter: HighlighterTypes = 'shiki-js'
): Promise<DiffsHighlighter> | DiffsHighlighter {
  highlighter ??= createHighlighterCore({
    themes: [],
    langs: [],
    engine:
      preferredHighlighter === 'shiki-wasm'
        ? createOnigurumaEngine(import('shiki/wasm'))
        : createJavaScriptRegexEngine(),
  }) as Promise<DiffsHighlighter>;
  return highlighter;
}

function sendFileSuccess(
  id: WorkerRequestId,
  result: ThemedFileResult,
  options: RenderFileOptions
) {
  postMessage({
    type: 'success',
    requestType: 'file',
    id,
    result,
    options,
    sentAt: Date.now(),
  } satisfies RenderFileSuccessResponse);
}

function sendDiffSuccess(
  id: WorkerRequestId,
  result: ThemedDiffResult,
  options: RenderDiffOptions
) {
  postMessage({
    type: 'success',
    requestType: 'diff',
    id,
    result,
    options,
    sentAt: Date.now(),
  } satisfies RenderDiffSuccessResponse);
}

function sendError(id: WorkerRequestId, error: unknown) {
  const response: RenderErrorResponse = {
    type: 'error',
    id,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  postMessage(response);
}
