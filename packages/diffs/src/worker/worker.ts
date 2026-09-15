import type { DynamicImportLanguageRegistration } from 'shiki/core';

import { DEFAULT_THEMES } from '../constants';
import { defaultHighlighter, highlighters } from '../highlighter';
import type {
  DiffsHighlighter,
  DiffsTheme,
  RenderDiffOptions,
  RenderFileOptions,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import {
  getFiletypeFromFileName,
  replaceCustomExtensions,
} from '../utils/getFiletypeFromFileName';
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
const customLanguageLoaders = new Map<
  string,
  DynamicImportLanguageRegistration
>();
let renderOptions: WorkerRenderingOptions = {
  preferredHighlighter: defaultHighlighter,
  theme: DEFAULT_THEMES,
  useTokenTransformer: false,
  tokenizeMaxLineLength: 1000,
  lineDiffType: 'word-alt',
  maxLineDiffLength: 1000,
};

const EMPTY_REGEXP = /(?:)/;
let pendingRequest = Promise.resolve();

self.addEventListener('error', (event) => {
  console.error('[Diffs Worker] Unhandled error:', event.error);
});

// Preserve message order while backends and language grammars load asynchronously.
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  pendingRequest = pendingRequest.then(() => handleMessage(event.data));
});

async function handleMessage(request: WorkerRequest) {
  try {
    if (
      highlighter?.name !== 'highlights' &&
      (request.type === 'file' || request.type === 'diff')
    ) {
      for (const { name, data } of request.resolvedCustomLanguages ?? []) {
        customLanguageLoaders.set(name, () =>
          Promise.resolve({ default: data })
        );
      }
    }
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
  } finally {
    // Reset legacy RegExp last-match state so it cannot keep a highlighted
    // source string alive after a highlight job completes.
    EMPTY_REGEXP.exec('');
  }
}

async function handleInitialize({
  id,
  renderOptions: options,
  resolvedThemes,
  customExtensionsVersion,
  customExtensionMap,
}: InitializeWorkerRequest): Promise<void> {
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  await setHighlighter(options, resolvedThemes);
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
  await setHighlighter(options, resolvedThemes);
  postMessage({
    type: 'success',
    id,
    requestType: 'set-render-options',
    sentAt: Date.now(),
  });
}

// Both setup messages resolve the backend before installing its matching themes.
async function setHighlighter(
  options: WorkerRenderingOptions,
  resolvedThemes: DiffsTheme[]
): Promise<void> {
  const preferredHighlighter =
    options.preferredHighlighter ?? defaultHighlighter;
  const nextHighlighter =
    highlighter?.name === preferredHighlighter
      ? highlighter
      : await (
          await highlighters[preferredHighlighter]()
        ).createDiffsHighlighter(undefined, customLanguageLoaders);
  nextHighlighter.themeResolver.seedResolvedThemes(
    resolvedThemes.map((theme) => [theme.name, theme])
  );
  highlighter = nextHighlighter;
  renderOptions = { ...options, preferredHighlighter };
}

async function handleRenderFile({
  id,
  file,
  customExtensionsVersion,
  customExtensionMap,
}: RenderFileRequest): Promise<void> {
  if (highlighter == null) {
    throw new Error('Worker highlighter is not initialized');
  }
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  await highlighter.loadLanguages?.([
    file.lang ?? getFiletypeFromFileName(file.name),
  ]);
  const fileOptions = {
    preferredHighlighter: renderOptions.preferredHighlighter,
    theme: renderOptions.theme,
    useTokenTransformer: renderOptions.useTokenTransformer,
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
  customExtensionsVersion,
  customExtensionMap,
}: RenderDiffRequest): Promise<void> {
  if (highlighter == null) {
    throw new Error('Worker highlighter is not initialized');
  }
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  await highlighter.loadLanguages?.([
    diff.lang ?? getFiletypeFromFileName(diff.name),
    diff.lang ?? getFiletypeFromFileName(diff.prevName ?? diff.name),
  ]);
  const result = renderDiffWithHighlighter(diff, highlighter, renderOptions);
  sendDiffSuccess(id, result, renderOptions);
}

function syncCustomExtensionsFromRequest({
  customExtensionsVersion,
  customExtensionMap,
}: Pick<
  InitializeWorkerRequest | RenderFileRequest | RenderDiffRequest,
  'customExtensionsVersion' | 'customExtensionMap'
>) {
  if (customExtensionsVersion == null && customExtensionMap == null) {
    return;
  }
  if (customExtensionsVersion == null || customExtensionMap == null) {
    throw new Error(
      'Worker request must include both customExtensionsVersion and customExtensionMap'
    );
  }
  replaceCustomExtensions(customExtensionsVersion, customExtensionMap);
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
