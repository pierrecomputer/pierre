import { diffWordsWithSpace } from 'diff';

import { getSharedHighlighter } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  DecorationItem,
  FileContents,
  LineInfo,
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
} from '../types';
import { createWorkerTransformerWithState } from '../utils/createWorkerTransformerWithState';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getLineNodes } from '../utils/getLineNodes';
import { getThemes } from '../utils/getThemes';
import {
  createDiffSpanDecoration,
  pushOrJoinSpan,
} from '../utils/parseDiffDecorations';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { parseLineType } from '../utils/parseLineType';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
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
  WorkerRenderFileOptions,
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

async function handleInitialize(
  request: InitializeWorkerRequest
): Promise<void> {
  const { theme, preferWasmHighlighter } = request.options;
  const langs = new Set(request.options?.langs);
  langs.add('text');
  await getSharedHighlighter({
    themes: getThemes(theme),
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
    disableLineNumbers,
    startingLineNumber,
    ...hastOptions
  } = {},
}: RenderFileRequest): Promise<void> {
  sendFileSuccess(id, {
    lines: renderFileWithHighlighter(file, await getHighlighter(lang, theme), {
      theme,
      lang,
      disableLineNumbers,
      startingLineNumber,
      hastOptions,
    }),
  });
}

async function handleRenderDiffFiles(
  request: RenderDiffFileRequest
): Promise<void> {
  const { oldFile, newFile, options } = request;
  const fileDiff = parseDiffFromFile(oldFile, newFile);
  const oldInfo: Record<number, LineInfo | undefined> = {};
  const newInfo: Record<number, LineInfo | undefined> = {};

  const oldLines = oldFile.contents.split('\n');
  const newLines = newFile.contents.split('\n');
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
    const lineNumber = lineIndex + 1;
    const oldLine = oldLines[lineIndex];
    const newLine = newLines[lineIndex];
    if (oldLine != null) {
      oldInfo[lineNumber] = { type: 'context-expanded', lineNumber, lineIndex };
    }
    if (newLine != null) {
      newInfo[lineNumber] = { type: 'context-expanded', lineNumber, lineIndex };
    }
  }

  const oldDecorations: DecorationItem[] = [];
  const newDecorations: DecorationItem[] = [];
  for (const { additionStart, deletionStart, hunkContent } of fileDiff.hunks) {
    let currentAdditionLine = additionStart;
    let currentDeletionLine = deletionStart;
    for (const content of hunkContent) {
      if (content.type === 'context') {
        for (const rawLine of content.lines) {
          const { type, line } = parseLineType(rawLine);
          const _old = oldInfo[currentDeletionLine];
          const _new = newInfo[currentAdditionLine];
          if (
            _old == null ||
            _new == null ||
            type === 'addition' ||
            type === 'deletion'
          ) {
            console.error({
              _old,
              _new,
              type,
              currentAdditionLine,
              currentDeletionLine,
              newInfo,
              oldInfo,
            });
            throw new Error('');
          }
          _old.type = 'context';
          _new.type = 'context';
          if (type === 'metadata') {
            _old.metadataContent = line.trim();
            _new.metadataContent = line.trim();
          }
          currentAdditionLine++;
          currentDeletionLine++;
        }
      } else {
        const maxLines = Math.max(
          content.deletions.length,
          content.additions.length
        );
        for (let i = 0; i < maxLines; i++) {
          const oldLine = content.deletions[i];
          const newLine = content.additions[i];
          const oldLineInfo = oldInfo[currentDeletionLine];
          const newLineInfo = newInfo[currentDeletionLine];
          if (oldLineInfo != null) {
            oldLineInfo.type = 'change-deletion';
            currentDeletionLine++;
          }
          if (newLineInfo != null) {
            newLineInfo.type = 'change-addition';
            currentAdditionLine++;
          }
          // FIXME(amadeus): If decorations are disabled, we should also early return here
          if (oldLine == null || newLine == null) {
            continue;
          }
          const lineDiff = diffWordsWithSpace(oldLine, newLine);

          const deletionSpans: [0 | 1, string][] = [];
          const additionSpans: [0 | 1, string][] = [];
          // FIXME(amadeus): Add the proper configuration for this
          // const enableJoin = lineDiffType === 'word-alt';
          for (const item of lineDiff) {
            if (!item.added && !item.removed) {
              pushOrJoinSpan({
                item,
                arr: deletionSpans,
                enableJoin: false,
                isNeutral: true,
              });
              pushOrJoinSpan({
                item,
                arr: additionSpans,
                enableJoin: false,
                isNeutral: true,
              });
            } else if (item.removed) {
              pushOrJoinSpan({ item, arr: deletionSpans, enableJoin: false });
            } else {
              pushOrJoinSpan({ item, arr: additionSpans, enableJoin: false });
            }
          }
          let spanIndex = 0;
          for (const span of additionSpans) {
            if (span[0] === 1) {
              newDecorations.push(
                createDiffSpanDecoration({
                  // NOTE(amadeus): Is this off by 1?
                  line: currentAdditionLine - 1,
                  spanStart: spanIndex,
                  spanLength: span[1].length,
                })
              );
            }
            spanIndex += span[1].length;
          }
          spanIndex = 0;
          for (const span of deletionSpans) {
            if (span[0] === 1) {
              oldDecorations.push(
                createDiffSpanDecoration({
                  // NOTE(amadeus): Is this off by 1?
                  line: currentDeletionLine - 1,
                  spanStart: spanIndex,
                  spanLength: span[1].length,
                })
              );
            }
            spanIndex += span[1].length;
          }
        }
      }
    }
  }
  console.time('totalRendering');
  const result = await renderTwoFiles({
    oldFile,
    oldInfo,
    newInfo,
    newFile,
    oldDecorations,
    newDecorations,
    options,
  });
  console.timeEnd('totalRendering');
  sendDiffSuccess(request.id, result);
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

  let hasLongLine = false;
  for (const hunk of diff.hunks) {
    for (const contentBlock of hunk.hunkContent) {
      if (contentBlock.type === 'context') {
        for (const rawLine of contentBlock.lines) {
          const { line, type, longLine } = parseLineType(rawLine, 1000);
          // TODO(amadeus): Add support for `maxLineLength`
          hasLongLine = hasLongLine || longLine;
          if (type === 'addition' || type === 'deletion') {
            throw new Error();
          }
          oldFile.contents += line;
          newFile.contents += line;
        }
      } else {
        for (const rawLine of contentBlock.deletions) {
          oldFile.contents += rawLine.substring(1);
        }
        for (const rawLine of contentBlock.additions) {
          newFile.contents += rawLine.substring(1);
        }
      }
    }
  }
  if (hasLongLine) {
    options ??= {};
    options.lang = 'text';
  }
  sendDiffMetadataSuccess(
    id,
    await renderTwoFiles({
      oldFile,
      oldInfo: {},
      newInfo: {},
      oldDecorations: [],
      newDecorations: [],
      newFile,
      options,
    })
  );
}

interface RenderTwoFilesProps {
  oldFile: FileContents;
  newFile: FileContents;
  oldInfo: Record<number, LineInfo | undefined>;
  newInfo: Record<number, LineInfo | undefined>;
  oldDecorations: DecorationItem[];
  newDecorations: DecorationItem[];
  options?: WorkerRenderFileOptions;
}

async function renderTwoFiles({
  oldFile,
  newFile,
  oldInfo,
  newInfo,
  options: { theme = DEFAULT_THEMES, lang, ...hastOptions } = {},
}: RenderTwoFilesProps) {
  const oldLang = lang ?? getFiletypeFromFileName(oldFile.name);
  const newLang = lang ?? getFiletypeFromFileName(newFile.name);
  const highlighter = await getHighlighter([oldLang, newLang], theme);
  const { state, transformers } = createWorkerTransformerWithState();
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
    return typeof theme === 'string'
      ? { ...hastOptions, lang: 'text', theme, transformers }
      : {
          ...hastOptions,
          lang: 'text',
          themes: theme,
          transformers,
        };
  })();

  console.time('renderingOld');
  hastConfig.lang = oldLang;
  state.lineInfo = oldInfo;
  const oldLines = getLineNodes(
    highlighter.codeToHast(oldFile.contents, hastConfig)
  );
  console.timeEnd('renderingOld');
  console.time('renderingNew');
  hastConfig.lang = newLang;
  state.lineInfo = newInfo;
  const newLines = getLineNodes(
    highlighter.codeToHast(newFile.contents, hastConfig)
  );
  console.timeEnd('renderingNew');

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
