import { getSharedHighlighter } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  PJSHighlighter,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getThemes } from '../utils/getThemes';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type {
  InitializeSuccessResponse,
  InitializeWorkerRequest,
  RenderDiffFileRequest,
  RenderDiffMetadataRequest,
  RenderDiffMetadataSuccessResponse,
  RenderDiffSuccessResponse,
  RenderErrorResponse,
  RenderFileRequest,
  RenderFileSuccessResponse,
  WorkerRequest,
  WorkerRequestId,
} from './types';

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
      case 'file':
        await handleRenderFile(request);
        break;
      case 'diff-files':
        await handleRenderDiffFiles(request);
        break;
      case 'diff-metadata':
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

async function handleInitialize({ id, options }: InitializeWorkerRequest) {
  const langs = new Set(options?.langs);
  langs.add('text');
  await getSharedHighlighter({
    themes: getThemes(options.theme),
    langs: Array.from(langs),
    preferWasmHighlighter: options.preferWasmHighlighter,
  });
  postMessage({
    type: 'success',
    id,
    requestType: 'initialize',
    sentAt: Date.now(),
  } satisfies InitializeSuccessResponse);
}

async function handleRenderFile({
  id,
  file,
  options: {
    theme = DEFAULT_THEMES,
    lang = getFiletypeFromFileName(file.name),
    startingLineNumber,
    tokenizeMaxLineLength,
  },
}: RenderFileRequest): Promise<void> {
  sendFileSuccess(
    id,
    renderFileWithHighlighter(file, await getHighlighter(lang, theme), {
      theme,
      lang,
      startingLineNumber,
      tokenizeMaxLineLength,
    })
  );
}

async function handleRenderDiffFiles({
  id,
  oldFile,
  newFile,
  options,
}: RenderDiffFileRequest) {
  const oldLang = options?.lang ?? getFiletypeFromFileName(oldFile.name);
  const newLang = options?.lang ?? getFiletypeFromFileName(newFile.name);
  const fileDiff = parseDiffFromFile(oldFile, newFile);
  const highlighter = await getHighlighter([oldLang, newLang], options?.theme);
  const result = renderDiffWithHighlighter(fileDiff, highlighter, options);
  sendDiffSuccess(id, result);
}

async function handleRenderDiffMetadata({
  id,
  options,
  diff,
}: RenderDiffMetadataRequest) {
  const { lang } = options ?? {};
  const oldLang = lang ?? getFiletypeFromFileName(diff.prevName ?? diff.name);
  const newLang = lang ?? getFiletypeFromFileName(diff.name);
  const highlighter = await getHighlighter([oldLang, newLang], options?.theme);
  const result = renderDiffWithHighlighter(diff, highlighter, options);
  sendDiffMetadataSuccess(id, result);
}

async function getHighlighter(
  lang: SupportedLanguages | SupportedLanguages[],
  theme: string | Record<'dark' | 'light', string> = DEFAULT_THEMES,
  preferWasmHighlighter = false
): Promise<PJSHighlighter> {
  const filteredLangs = new Set(!Array.isArray(lang) ? [lang] : lang);
  filteredLangs.add('text');
  return await getSharedHighlighter({
    themes: getThemes(theme),
    langs: Array.from(filteredLangs),
    preferWasmHighlighter,
  });
}

function sendFileSuccess(id: WorkerRequestId, result: ThemedFileResult) {
  postMessage({
    type: 'success',
    requestType: 'file',
    id,
    result,
    sentAt: Date.now(),
  } satisfies RenderFileSuccessResponse);
}

function sendDiffSuccess(id: WorkerRequestId, result: ThemedDiffResult) {
  postMessage({
    type: 'success',
    requestType: 'diff-files',
    id,
    result,
    sentAt: Date.now(),
  } satisfies RenderDiffSuccessResponse);
}

function sendDiffMetadataSuccess(
  id: WorkerRequestId,
  result: ThemedDiffResult
) {
  postMessage({
    type: 'success',
    requestType: 'diff-metadata',
    id,
    result,
    sentAt: Date.now(),
  } satisfies RenderDiffMetadataSuccessResponse);
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
