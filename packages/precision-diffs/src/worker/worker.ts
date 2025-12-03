import {
  getSharedHighlighter,
  loadResolvedLanguagesAndUpdateMap,
  registerResolvedTheme,
} from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  PJSHighlighter,
  SupportedLanguages,
  ThemedDiffResult,
  ThemedFileResult,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getThemes } from '../utils/getThemes';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import type {
  InitializeSuccessResponse,
  InitializeWorkerRequest,
  RegisterThemeWorkerRequest,
  RenderDiffMetadataRequest,
  RenderDiffMetadataSuccessResponse,
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
      case 'register-theme':
        handleRegisterTheme(request);
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
  options,
  resolvedThemes,
  resolvedLanguages,
}: InitializeWorkerRequest) {
  // Register all resolved themes (both custom and bundled)
  if (resolvedThemes != null) {
    for (const { name, data } of resolvedThemes) {
      if (data != null) {
        registerResolvedTheme(name, data);
      }
    }
  }

  const langs = new Set(options?.langs);
  langs.add('text');
  await getSharedHighlighter({
    themes: getThemes(options.theme),
    langs: Array.from(langs),
  });

  // Load any resolved languages and update the Map
  if (resolvedLanguages != null) {
    await loadResolvedLanguagesAndUpdateMap(resolvedLanguages);
  }
  postMessage({
    type: 'success',
    id,
    requestType: 'initialize',
    sentAt: Date.now(),
  } satisfies InitializeSuccessResponse);
}

function handleRegisterTheme({ id, themes }: RegisterThemeWorkerRequest) {
  for (const { name, data } of themes) {
    if (data != null) {
      registerResolvedTheme(name, data);
    }
  }
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
  options: {
    theme = DEFAULT_THEMES,
    lang = getFiletypeFromFileName(file.name),
    startingLineNumber,
    tokenizeMaxLineLength,
  },
  resolvedLanguages,
}: RenderFileRequest): Promise<void> {
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    await loadResolvedLanguagesAndUpdateMap(resolvedLanguages);
  }

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

async function handleRenderDiffMetadata({
  id,
  options,
  diff,
  resolvedLanguages,
}: RenderDiffMetadataRequest) {
  // Load resolved languages if provided
  if (resolvedLanguages != null) {
    await loadResolvedLanguagesAndUpdateMap(resolvedLanguages);
  }

  const { lang } = options ?? {};
  const oldLang = lang ?? getFiletypeFromFileName(diff.prevName ?? diff.name);
  const newLang = lang ?? getFiletypeFromFileName(diff.name);
  const highlighter = await getHighlighter([oldLang, newLang], options?.theme);
  const result = renderDiffWithHighlighter(diff, highlighter, options);
  sendDiffMetadataSuccess(id, result);
}

async function getHighlighter(
  lang: SupportedLanguages | SupportedLanguages[],
  theme: string | Record<'dark' | 'light', string> = DEFAULT_THEMES
): Promise<PJSHighlighter> {
  const filteredLangs = new Set(!Array.isArray(lang) ? [lang] : lang);
  filteredLangs.add('text');
  return await getSharedHighlighter({
    themes: getThemes(theme),
    langs: Array.from(filteredLangs),
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

function sendDiffMetadataSuccess(
  id: WorkerRequestId,
  result: ThemedDiffResult
) {
  postMessage({
    type: 'success',
    requestType: 'diff',
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
