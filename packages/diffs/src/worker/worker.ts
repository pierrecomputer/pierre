import { DEFAULT_THEMES } from '../constants';
import { attachResolvedLanguages } from '../highlighter/languages';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../highlighter/shared_highlighter';
import { attachResolvedThemes } from '../highlighter/themes';
import type {
  PJSHighlighter,
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
  RegisterThemeWorkerRequest,
  RenderDiffRequest,
  RenderDiffSuccessResponse,
  RenderErrorResponse,
  RenderFileRequest,
  RenderFileSuccessResponse,
  WorkerRenderingOptions,
  WorkerRequest,
  WorkerRequestId,
} from './types';

let renderOptions: WorkerRenderingOptions = {
  theme: DEFAULT_THEMES,
  tokenizeMaxLineLength: 1000,
  lineDiffType: 'word-alt',
};

self.addEventListener('error', (event) => {
  console.error('[Shiki Worker] Unhandled error:', event.error);
});

// Handle incoming messages from the main thread
// eslint-disable-next-line @typescript-eslint/no-misused-promises
self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'initialize':
        await handleInitialize(request);
        break;
      case 'register-theme':
        await handleRegisterTheme(request);
        break;
      case 'file':
        await handleRenderFile(request);
        break;
      case 'diff':
        await handleRenderDiffMetadata(request);
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

async function handleInitialize({
  id,
  renderOptions: options,
  resolvedThemes,
  resolvedLanguages,
}: InitializeWorkerRequest) {
  const highlighter = await getHighlighter();
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

async function handleRegisterTheme({
  id,
  theme,
  resolvedThemes,
}: RegisterThemeWorkerRequest) {
  const highlighter = getHighlighterIfLoaded() ?? (await getHighlighter());
  attachResolvedThemes(resolvedThemes, highlighter);
  renderOptions.theme = theme;
  postMessage({
    type: 'success',
    id,
    requestType: 'register-theme',
    sentAt: Date.now(),
  });
}

async function handleRenderFile({
  id,
  file,
  resolvedLanguages,
}: RenderFileRequest): Promise<void> {
  const highlighter = getHighlighterIfLoaded() ?? (await getHighlighter());
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  sendFileSuccess(
    id,
    renderFileWithHighlighter(file, highlighter, renderOptions),
    renderOptions
  );
}

async function handleRenderDiffMetadata({
  id,
  diff,
  resolvedLanguages,
}: RenderDiffRequest) {
  const highlighter = getHighlighterIfLoaded() ?? (await getHighlighter());
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  const result = renderDiffWithHighlighter(diff, highlighter, renderOptions);
  sendDiffMetadataSuccess(id, result, renderOptions);
}

async function getHighlighter(): Promise<PJSHighlighter> {
  return await getSharedHighlighter({ themes: [], langs: ['text'] });
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

function sendDiffMetadataSuccess(
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
