import type { RenderFileResult } from 'src/worker';

import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  FileContents,
  PJSHighlighter,
  PJSThemeNames,
  SupportedLanguages,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { createTransformerWithState } from './createTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getLineNodes } from './getLineNodes';

export interface RenderOptions {
  lang?: SupportedLanguages;
  theme?: PJSThemeNames | Record<'dark' | 'light', PJSThemeNames>;
  startingLineNumber?: number;
  tokenizeMaxLineLength: number;
}

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: PJSHighlighter,
  {
    theme = DEFAULT_THEMES,
    startingLineNumber = 1,
    lang = getFiletypeFromFileName(file.name),
    tokenizeMaxLineLength,
  }: RenderOptions
): RenderFileResult {
  const { state, transformers } = createTransformerWithState();
  const baseThemeType = (() => {
    if (typeof theme === 'string') {
      return highlighter.getTheme(theme).type;
    }
    return undefined;
  })();
  const themeStyles = getHighlighterThemeStyles({
    theme,
    highlighter,
  });
  state.lineInfo = (shikiLineNumber: number) => ({
    type: 'context',
    lineIndex: shikiLineNumber - 1,
    lineNumber: startingLineNumber + (shikiLineNumber - 1),
  });
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
    if (typeof theme === 'string') {
      return {
        lang,
        theme,
        transformers,
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix(),
        tokenizeMaxLineLength,
      };
    }
    return {
      lang,
      themes: theme,
      transformers,
      defaultColor: false,
      cssVariablePrefix: formatCSSVariablePrefix(),
      tokenizeMaxLineLength,
    };
  })();
  return {
    code: getLineNodes(
      highlighter.codeToHast(cleanLastNewline(file.contents), hastConfig)
    ),
    themeStyles,
    baseThemeType: baseThemeType,
  };
}
