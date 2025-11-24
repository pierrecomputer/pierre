import { diffWordsWithSpace } from 'diff';
import { DEFAULT_THEMES } from 'src/constants';

import type {
  CodeToHastOptions,
  DecorationItem,
  FileContents,
  FileDiffMetadata,
  LineInfo,
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
} from '../types';
import type { RenderDiffResult, WorkerRenderFileOptions } from '../worker';
import { cleanLastNewline } from './cleanLastNewline';
import { createWorkerTransformerWithState } from './createWorkerTransformerWithState';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getLineNodes } from './getLineNodes';
import {
  createDiffSpanDecoration,
  pushOrJoinSpan,
} from './parseDiffDecorations';

interface RenderOptions {
  lang?: SupportedLanguages;
  theme?: PJSThemeNames | Record<'dark' | 'light', PJSThemeNames>;
  disableLineNumbers?: boolean;
  hastOptions?: Partial<CodeToHastOptions<PJSThemeNames>>;
}

export function renderDiffWithHighlighter(
  diff: FileDiffMetadata,
  highlighter: PJSHighlighter,
  options: RenderOptions
): RenderDiffResult {
  // If we've received a diff with both files
  if (diff.newLines != null && diff.oldLines != null) {
    const oldInfo: Record<number, LineInfo | undefined> = {};
    const newInfo: Record<number, LineInfo | undefined> = {};
    const oldDecorations: DecorationItem[] = [];
    const newDecorations: DecorationItem[] = [];
    let lineIndex = 0;
    let newLineNumber = 1;
    let oldLineNumber = 1;
    let oldContent = '';
    let newContent = '';
    for (const hunk of diff.hunks) {
      // If there's content prior to the hunk, lets fill it up
      while (
        newLineNumber < hunk.additionStart &&
        oldLineNumber < hunk.deletionStart
      ) {
        oldInfo[oldLineNumber] = {
          type: 'context-expanded',
          lineNumber: oldLineNumber,
          lineIndex,
        };
        newInfo[newLineNumber] = {
          type: 'context-expanded',
          lineNumber: newLineNumber,
          lineIndex,
        };
        oldContent += diff.oldLines[oldLineNumber - 1];
        newContent += diff.newLines[newLineNumber - 1];
        oldLineNumber++;
        newLineNumber++;
        lineIndex++;
      }

      // Lets process the actual hunk content
      for (const hunkContent of hunk.hunkContent) {
        if (hunkContent.type === 'context') {
          for (const line of hunkContent.lines) {
            oldInfo[oldLineNumber] = {
              type: 'context',
              lineNumber: oldLineNumber,
              lineIndex,
            };
            newInfo[newLineNumber] = {
              type: 'context',
              lineNumber: newLineNumber,
              lineIndex,
            };
            oldContent += line;
            newContent += line;
            newLineNumber++;
            oldLineNumber++;
            lineIndex++;
          }
        } else {
          const len = Math.max(
            hunkContent.additions.length,
            hunkContent.deletions.length
          );
          let i = 0;
          while (i < len) {
            const oldLine = hunkContent.deletions[i];
            const newLine = hunkContent.additions[i];
            computeLineDiffDecorations({
              newLine,
              oldLine,
              oldLineNumber,
              newLineNumber,
              oldDecorations,
              newDecorations,
            });
            if (oldLine != null) {
              oldInfo[oldLineNumber] = {
                type: 'change-deletion',
                lineNumber: oldLineNumber,
                lineIndex,
              };
              oldContent += oldLine;
              oldLineNumber++;
            }
            if (newLine != null) {
              newInfo[newLineNumber] = {
                type: 'change-addition',
                lineNumber: newLineNumber,
                lineIndex,
              };
              newContent += newLine;
              newLineNumber++;
            }
            lineIndex++;
            i++;
          }
        }
      }

      if (hunk !== diff.hunks[diff.hunks.length - 1]) continue;
      // If we are on the last hunk, we should fully iterate through the rest
      // of the lines
      while (
        oldLineNumber <= diff.oldLines.length ||
        newLineNumber <= diff.oldLines.length
      ) {
        const oldLine = diff.oldLines[oldLineNumber - 1];
        const newLine = diff.newLines[newLineNumber - 1];
        if (oldLine != null) {
          oldInfo[oldLineNumber] = {
            type: 'context-expanded',
            lineNumber: oldLineNumber,
            lineIndex,
          };
          oldContent += oldLine;
          oldLineNumber++;
        }
        if (newLine != null) {
          newInfo[newLineNumber] = {
            type: 'context-expanded',
            lineNumber: newLineNumber,
            lineIndex,
          };
          newContent += newLine;
          newLineNumber++;
        }
        lineIndex++;
      }
    }
    const oldFile = {
      name: diff.prevName ?? diff.name,
      contents: cleanLastNewline(oldContent),
    };
    const newFile = {
      name: diff.name,
      contents: cleanLastNewline(newContent),
    };
    return renderTwoFiles({
      oldFile,
      oldInfo,
      oldDecorations,

      newFile,
      newInfo,
      newDecorations,

      highlighter,
      options,
    });
  }
  // TODO(amadeus): Fix up support for hunk-only highlighting
  return { hunks: [] };
}

interface ProcessLineDiffProps {
  oldLine: string | undefined;
  newLine: string | undefined;
  oldLineNumber: number;
  newLineNumber: number;
  oldDecorations: DecorationItem[];
  newDecorations: DecorationItem[];
}

function computeLineDiffDecorations({
  oldLine,
  newLine,
  oldLineNumber,
  newLineNumber,
  oldDecorations,
  newDecorations,
}: ProcessLineDiffProps) {
  // FIXME(amadeus): Figure out how to get the line diff settings back in here
  if (oldLine == null || newLine == null) {
    return;
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
  for (const span of deletionSpans) {
    if (span[0] === 1) {
      oldDecorations.push(
        createDiffSpanDecoration({
          // Decoration indexes start at 0
          line: oldLineNumber - 1,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
  spanIndex = 0;
  for (const span of additionSpans) {
    if (span[0] === 1) {
      newDecorations.push(
        createDiffSpanDecoration({
          // Decoration indexes start at 0
          line: newLineNumber - 1,
          spanStart: spanIndex,
          spanLength: span[1].length,
        })
      );
    }
    spanIndex += span[1].length;
  }
}

interface ProcessLinesProps {}

function processLines({}: any) {}

interface RenderTwoFilesProps {
  oldFile: FileContents;
  newFile: FileContents;
  oldInfo: Record<number, LineInfo | undefined>;
  newInfo: Record<number, LineInfo | undefined>;
  oldDecorations: DecorationItem[];
  newDecorations: DecorationItem[];
  options?: WorkerRenderFileOptions;
  highlighter: PJSHighlighter;
}

function renderTwoFiles({
  oldFile,
  newFile,
  oldInfo,
  newInfo,
  highlighter,
  oldDecorations,
  newDecorations,
  options: { theme = DEFAULT_THEMES, lang, ...hastOptions } = {},
}: RenderTwoFilesProps) {
  const oldLang = lang ?? getFiletypeFromFileName(oldFile.name);
  const newLang = lang ?? getFiletypeFromFileName(newFile.name);
  const { state, transformers } = createWorkerTransformerWithState();
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
    return typeof theme === 'string'
      ? {
          ...hastOptions,
          lang: 'text',
          theme,
          transformers,
          decorations: undefined,
        }
      : {
          ...hastOptions,
          lang: 'text',
          themes: theme,
          transformers,
          decorations: undefined,
        };
  })();

  console.time('renderingOld');
  hastConfig.lang = oldLang;
  state.lineInfo = oldInfo;
  hastConfig.decorations = oldDecorations;
  const oldLines = getLineNodes(
    highlighter.codeToHast(oldFile.contents, hastConfig)
  );
  console.timeEnd('renderingOld');
  console.time('renderingNew');
  hastConfig.lang = newLang;
  hastConfig.decorations = newDecorations;
  state.lineInfo = newInfo;
  const newLines = getLineNodes(
    highlighter.codeToHast(newFile.contents, hastConfig)
  );
  console.timeEnd('renderingNew');

  return { oldLines, newLines };
}
