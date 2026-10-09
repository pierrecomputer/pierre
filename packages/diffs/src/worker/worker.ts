import { DEFAULT_THEMES } from '../constants';
import { attachResolvedLanguages } from '../highlighter/languages/attachResolvedLanguages';
import { createHighlighter } from '../highlighter/shared_highlighter';
import { attachResolvedThemes } from '../highlighter/themes/attachResolvedThemes';
import type { DiffsHighlighter, HighlighterTypes } from '../types';
import { replaceCustomExtensions } from '../utils/getFiletypeFromFileName';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { encodeHastLines } from './hastLinesTransport';
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
import type {
  EncodedDiffSuccessResponse,
  EncodedFileSuccessResponse,
  InitializeWorkerWireRequest,
  WorkerWireRequest,
} from './workerMessage';

let highlighter: Promise<DiffsHighlighter> | DiffsHighlighter | undefined;
let compactResults = false;
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

self.addEventListener('message', (event: MessageEvent<WorkerWireRequest>) => {
  void handleMessage(event.data);
});

async function handleMessage(request: WorkerWireRequest) {
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
  } finally {
    // Reset legacy RegExp last-match state so it cannot keep a highlighted
    // source string alive after a highlight job completes.
    EMPTY_REGEXP.exec('');
  }
}

async function handleInitialize({
  id,
  renderOptions: options,
  preferredHighlighter,
  resolvedThemes,
  resolvedLanguages,
  customExtensionsVersion,
  customExtensionMap,
  resultFormat,
}: InitializeWorkerWireRequest): Promise<void> {
  let highlighter = getHighlighter(preferredHighlighter);
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  attachResolvedThemes(resolvedThemes, highlighter);
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  renderOptions = options;
  compactResults = resultFormat === 'hast-ops-v1';
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
  customExtensionsVersion,
  customExtensionMap,
}: RenderFileRequest): Promise<void> {
  let highlighter = getHighlighter();
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  const fileOptions = {
    theme: renderOptions.theme,
    useTokenTransformer: renderOptions.useTokenTransformer,
    tokenizeMaxLineLength: renderOptions.tokenizeMaxLineLength,
  };
  const result = renderFileWithHighlighter(file, highlighter, fileOptions);
  const code = compactResults ? encodeHastLines(result.code) : undefined;
  const response: RenderFileSuccessResponse = {
    type: 'success',
    requestType: 'file',
    id,
    result,
    options: fileOptions,
    sentAt: Date.now(),
  };
  postMessage(
    code == null
      ? response
      : ({
          ...response,
          result: { ...result, code },
        } satisfies EncodedFileSuccessResponse),
    code == null ? [] : [code.ops.buffer, code.offsets.buffer]
  );
}

async function handleRenderDiff({
  id,
  diff,
  resolvedLanguages,
  customExtensionsVersion,
  customExtensionMap,
}: RenderDiffRequest): Promise<void> {
  let highlighter = getHighlighter();
  if ('then' in highlighter) {
    highlighter = await highlighter;
  }
  syncCustomExtensionsFromRequest({
    customExtensionsVersion,
    customExtensionMap,
  });
  if (resolvedLanguages != null) {
    attachResolvedLanguages(resolvedLanguages, highlighter);
  }
  const result = renderDiffWithHighlighter(diff, highlighter, renderOptions);
  const code = compactResults
    ? {
        deletionLines: encodeHastLines(result.code.deletionLines),
        additionLines: encodeHastLines(result.code.additionLines),
      }
    : undefined;
  const response: RenderDiffSuccessResponse = {
    type: 'success',
    requestType: 'diff',
    id,
    result,
    options: renderOptions,
    sentAt: Date.now(),
  };
  postMessage(
    code == null
      ? response
      : ({
          ...response,
          result: { ...result, code },
        } satisfies EncodedDiffSuccessResponse),
    code == null
      ? []
      : [
          code.deletionLines.ops.buffer,
          code.deletionLines.offsets.buffer,
          code.additionLines.ops.buffer,
          code.additionLines.offsets.buffer,
        ]
  );
}

function getHighlighter(
  preferredHighlighter?: HighlighterTypes
): Promise<DiffsHighlighter> | DiffsHighlighter {
  highlighter ??= createHighlighter(preferredHighlighter);
  return highlighter;
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

function sendError(id: WorkerRequestId, error: unknown) {
  const response: RenderErrorResponse = {
    type: 'error',
    id,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  postMessage(response);
}
