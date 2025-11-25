import type { ElementContent } from 'hast';

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
import { getLineNodes } from './getLineNodes';

export interface RenderOptions {
  lang?: SupportedLanguages;
  theme?: PJSThemeNames | Record<'dark' | 'light', PJSThemeNames>;
  disableLineNumbers?: boolean;
  startingLineNumber?: number;
  tokenizeMaxLineLength: number;
}

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: PJSHighlighter,
  {
    theme = DEFAULT_THEMES,
    disableLineNumbers,
    startingLineNumber = 1,
    lang = getFiletypeFromFileName(file.name),
    tokenizeMaxLineLength,
  }: RenderOptions
): ElementContent[] {
  const { state, transformers } =
    createTransformerWithState(disableLineNumbers);
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
  return getLineNodes(
    highlighter.codeToHast(cleanLastNewline(file.contents), hastConfig)
  );
}
