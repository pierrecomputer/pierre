import { parseLineType } from 'src/utils/parseLineType';

import { getSharedHighlighter } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  FileContents,
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getLineNodes } from '../utils/getLineNodes';
import { getThemes } from '../utils/getThemes';
import type {
  InitializeSuccessResponse,
  InitializeWorkerRequest,
  RenderDiffFileRequest,
  RenderDiffMetadataRequest,
  RenderDiffMetadataSuccessResponse,
  RenderDiffResult,
  RenderDiffSuccessResponse,
  RenderErrorResponse,
  RenderFileRequest,
  RenderFileResult,
  RenderFileSuccessResponse,
  RenderOptions,
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
        await handleRenderDiff(request);
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

async function handleInitialize(
  request: InitializeWorkerRequest
): Promise<void> {
  const { themes = ['pierre-dark', 'pierre-light'], preferWasmHighlighter } =
    request.options ?? {};
  const langs = new Set(request.options?.langs);
  langs.add('text');
  await getSharedHighlighter({
    themes,
    langs: Array.from(langs),
    preferWasmHighlighter,
  });

  postMessage({
    type: 'success',
    id: request.id,
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
    preferWasmHighlighter,
    hastOptions,
  } = {},
}: RenderFileRequest): Promise<void> {
  const highlighter = await getHighlighter(lang, theme, preferWasmHighlighter);
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
    if (typeof theme === 'string') {
      return { lang, ...hastOptions, theme };
    }
    return { lang, ...hastOptions, themes: theme };
  })();
  sendFileSuccess(id, {
    lines: getLineNodes(highlighter.codeToHast(file.contents, hastConfig)),
  });
}

async function handleRenderDiff(request: RenderDiffFileRequest): Promise<void> {
  const { oldFile, newFile, options } = request;
  sendDiffSuccess(request.id, await renderTwoFiles(oldFile, newFile, options));
}

async function handleRenderDiffMetadata({
  id,
  options,
  diff,
}: RenderDiffMetadataRequest) {
  const oldFile: FileContents = {
    name: diff.prevName ?? diff.name,
    contents: '',
  };
  const newFile: FileContents = {
    name: diff.name,
    contents: '',
  };

  for (const hunk of diff.hunks) {
    for (const rawLine of hunk.hunkContent ?? []) {
      // TODO(amadeus): Add support for `maxLineLength`
      const { line, type } = parseLineType(rawLine);
      switch (type) {
        case 'context':
          oldFile.contents += line;
          newFile.contents += line;
          break;
        case 'addition':
          newFile.contents += line;
          break;
        case 'deletion':
          oldFile.contents += line;
          break;
        case 'metadata':
          // Unsure what to do about this...
          break;
      }
    }
  }
  sendDiffMetadataSuccess(id, await renderTwoFiles(oldFile, newFile, options));
}

async function renderTwoFiles(
  oldFile: FileContents,
  newFile: FileContents,
  {
    theme = DEFAULT_THEMES,
    lang,
    preferWasmHighlighter,
    hastOptions,
  }: RenderOptions = {}
) {
  const oldLang = lang ?? getFiletypeFromFileName(oldFile.name);
  const newLang = lang ?? getFiletypeFromFileName(newFile.name);
  const highlighter = await getHighlighter(
    [oldLang, newLang],
    theme,
    preferWasmHighlighter
  );
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
    if (typeof theme === 'string') {
      return { lang: 'text', ...hastOptions, theme };
    }
    return { lang: 'text', ...hastOptions, themes: theme };
  })();

  hastConfig.lang = oldLang;
  const oldLines = getLineNodes(
    highlighter.codeToHast(oldFile.contents, hastConfig)
  );
  hastConfig.lang = newLang;
  const newLines = getLineNodes(
    highlighter.codeToHast(newFile.contents, hastConfig)
  );

  return { oldLines, newLines };
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

function sendFileSuccess(id: WorkerRequestId, result: RenderFileResult): void {
  postMessage({
    type: 'success',
    requestType: 'file',
    id,
    result,
    sentAt: Date.now(),
  } satisfies RenderFileSuccessResponse);
}

function sendDiffSuccess(id: WorkerRequestId, result: RenderDiffResult): void {
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
  result: RenderDiffResult
): void {
  postMessage({
    type: 'success',
    requestType: 'diff-metadata',
    id,
    result,
    sentAt: Date.now(),
  } satisfies RenderDiffMetadataSuccessResponse);
}

function sendError(id: WorkerRequestId, error: unknown): void {
  const response: RenderErrorResponse = {
    type: 'error',
    id,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  postMessage(response);
}
