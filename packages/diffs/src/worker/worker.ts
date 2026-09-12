import { DEFAULT_THEMES } from '../constants';
import { createDiffsHighlighter } from '../highlighter/createDiffsHighlighter';
import type {
  RenderDiffOptions,
  RenderFileOptions,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import { replaceCustomExtensions } from '../utils/getFiletypeFromFileName';
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

const highlighter = createDiffsHighlighter();
let renderOptions: WorkerRenderingOptions = {
  theme: DEFAULT_THEMES,
  useTokenTransformer: false,
  tokenizeMaxLineLength: 1000,
  lineDiffType: 'word-alt',
  maxLineDiffLength: 1000,
};

const EMPTY_REGEXP = /(?:)/;

self.addEventListener('error', (event) => {
  console.error('[Diffs Worker] Unhandled error:', event.error);
});

// Handle incoming messages from the main thread
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  handleMessage(event.data);
});

function handleMessage(request: WorkerRequest) {
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
  } finally {
    // Reset legacy RegExp last-match state so it cannot keep a highlighted
    // source string alive after a highlight job completes.
    EMPTY_REGEXP.exec('');
  }
}

function handleInitialize({
  id,
  renderOptions: options,
  resolvedThemes,
  customExtensionsVersion,
  customExtensionMap,
}: InitializeWorkerRequest): void {
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  highlighter.themeResolver.seedResolvedThemes(
    resolvedThemes.map((theme) => [theme.name, theme])
  );
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
}: SetRenderOptionsWorkerRequest): void {
  highlighter.themeResolver.seedResolvedThemes(
    resolvedThemes.map((theme) => [theme.name, theme])
  );
  renderOptions = options;
  postMessage({
    type: 'success',
    id,
    requestType: 'set-render-options',
    sentAt: Date.now(),
  });
}

function handleRenderFile({
  id,
  file,
  customExtensionsVersion,
  customExtensionMap,
}: RenderFileRequest): void {
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  const fileOptions = {
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

function handleRenderDiff({
  id,
  diff,
  customExtensionsVersion,
  customExtensionMap,
}: RenderDiffRequest): void {
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
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
