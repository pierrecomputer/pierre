import { DEFAULT_THEMES } from '../constants';
import type {
  CodeToHastOptions,
  DiffsHighlighter,
  DiffsThemeNames,
  FileContents,
  RenderFileOptions,
  ThemedFileResult,
} from '../types';
import { cleanLastNewline } from './cleanLastNewline';
import { createTransformerWithState } from './createTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';
import { getLineNodes } from './getLineNodes';

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: DiffsHighlighter,
  { theme = DEFAULT_THEMES, tokenizeMaxLineLength }: RenderFileOptions,
  forcePlainText = false
): ThemedFileResult {
  const { state, transformers } = createTransformerWithState();
  const lang = forcePlainText
    ? 'text'
    : (file.lang ?? getFiletypeFromFileName(file.name));
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
    lineNumber: shikiLineNumber,
  });
  const hastConfig: CodeToHastOptions<DiffsThemeNames> = (() => {
    if (typeof theme === 'string') {
      return {
        lang,
        theme,
        transformers,
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix('token'),
        tokenizeMaxLineLength,
      };
    }
    return {
      lang,
      themes: theme,
      transformers,
      defaultColor: false,
      cssVariablePrefix: formatCSSVariablePrefix('token'),
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
