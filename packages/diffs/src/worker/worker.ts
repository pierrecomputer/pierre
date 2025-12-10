import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import { createHighlighterCoreSync } from 'shiki/core';

import { DEFAULT_THEMES } from '../constants';
import { attachResolvedLanguages } from '../highlighter/languages/attachResolvedLanguages';
import { attachResolvedThemes } from '../highlighter/themes/attachResolvedThemes';
import type {
  DiffsHighlighter,
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

let highlighter: DiffsHighlighter | undefined;
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
  const request = event.data;

  try {
    switch (request.type) {
      case 'initialize':
        handleInitialize(request);
        break;
      case 'set-render-options':
        handleSetRenderOptions(request);
        break;
      case 'file':
        handleRenderFile(request);
        break;
      case 'diff':
        handleRenderDiff(request);
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
});

function handleInitialize({
  id,
  renderOptions: options,
  resolvedThemes,
  resolvedLanguages,
}: InitializeWorkerRequest) {
  const highlighter = getHighlighter();
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

function handleSetRenderOptions({
  id,
  renderOptions: options,
  resolvedThemes,
}: SetRenderOptionsWorkerRequest) {
  const highlighter = getHighlighter();
  attachResolvedThemes(resolvedThemes, highlighter);
  renderOptions = options;
  postMessage({
    type: 'success',
    id,
    requestType: 'set-render-options',
    sentAt: Date.now(),
  });
}

function handleRenderFile({ id, file, resolvedLanguages }: RenderFileRequest) {
  const highlighter = getHighlighter();
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

function handleRenderDiff({ id, diff, resolvedLanguages }: RenderDiffRequest) {
  const highlighter = getHighlighter();
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  const result = renderDiffWithHighlighter(diff, highlighter, renderOptions);
  sendDiffSuccess(id, result, renderOptions);
}

function getHighlighter(): DiffsHighlighter {
  highlighter ??= createHighlighterCoreSync({
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }) as DiffsHighlighter;
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
