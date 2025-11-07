import { DEFAULT_THEMES } from 'src/constants';
import { getLineNodes } from 'src/utils/getLineNodes';
import { getThemes } from 'src/utils/getThemes';

import { getSharedHighlighter } from '../SharedHighlighter';
import type {
  CodeToHastOptions,
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import type {
  InitializeWorkerRequest,
  RenderDiffRequest,
  RenderDiffResult,
  RenderErrorResponse,
  RenderFileRequest,
  RenderFileResult,
  WorkerRequest,
  WorkerRequestId,
} from './types';

/**
 * Shiki Web Worker
 *
 * This worker runs in a separate thread and handles Shiki rendering
 * to avoid blocking the main thread during syntax highlighting.
 */

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
      case 'diff':
        await handleRenderDiff(request);
        break;
      default:
        throw new Error(
          `Unknown request type: ${(request as WorkerRequest).type}`
        );
    }
  } catch (error) {
    sendError(request.id, error);
  }
});

async function handleInitialize(
  request: InitializeWorkerRequest
): Promise<void> {
  const { themes, preferWasmHighlighter } = request.options;
  const langs = new Set(request.options.langs);
  langs.add('text');
  // Initialize the highlighter with the requested themes and languages
  await getSharedHighlighter({
    themes,
    langs: Array.from(langs),
    preferWasmHighlighter,
  });

  postMessage({ type: 'initialized', id: request.id });
}

async function handleRenderFile(request: RenderFileRequest): Promise<void> {
  const { file, options } = request;
  const { theme = DEFAULT_THEMES } = options;

  const highlighter = await getHighlighter(
    options.lang ?? getFiletypeFromFileName(file.name),
    theme
  );

  // Determine language
  const lang = options.lang ?? getFiletypeFromFileName(file.name);

  // Render code to HAST
  const hastOptions: CodeToHastOptions<PJSThemeNames> = (() => {
    if (typeof theme === 'string') {
      return { lang, ...options.hastOptions, theme };
    }
    return { lang, ...options.hastOptions, themes: theme };
  })();

  const lines = getLineNodes(
    highlighter.codeToHast(file.contents, hastOptions)
  );

  sendFileSuccess(request.id, { lines });
}

async function handleRenderDiff(request: RenderDiffRequest): Promise<void> {
  const { oldFile, newFile, options } = request;
  const { theme = DEFAULT_THEMES } = options;

  // Determine language from the new file (or old file as fallback)
  const lang =
    options.lang ??
    getFiletypeFromFileName(newFile.name) ??
    getFiletypeFromFileName(oldFile.name);

  const highlighter = await getHighlighter(lang, theme);

  // For diffs, we'll render both files separately
  // The consumer can then use these results to build the diff view
  const hastOptions: CodeToHastOptions<PJSThemeNames> = (() => {
    if (typeof theme === 'string') {
      return { lang, ...options.hastOptions, theme };
    }
    return { lang, ...options.hastOptions, themes: theme };
  })();

  const oldLines = getLineNodes(
    highlighter.codeToHast(oldFile.contents, hastOptions)
  );
  const newLines = getLineNodes(
    highlighter.codeToHast(newFile.contents, hastOptions)
  );

  // Return both results as a composite structure
  sendDiffSuccess(request.id, {
    oldLines,
    newLines,
  });
}

async function getHighlighter(
  lang: SupportedLanguages,
  theme: string | Record<'dark' | 'light', string> = DEFAULT_THEMES,
  preferWasmHighlighter = false
): Promise<PJSHighlighter> {
  return await getSharedHighlighter({
    themes: getThemes(theme),
    langs: [lang],
    preferWasmHighlighter,
  });
}

function sendFileSuccess(id: WorkerRequestId, result: RenderFileResult): void {
  postMessage({
    type: 'success',
    requestType: 'render-file',
    id,
    result,
  });
}

function sendDiffSuccess(id: WorkerRequestId, result: RenderDiffResult): void {
  postMessage({
    type: 'success',
    requestType: 'render-diff',
    id,
    result,
  });
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
