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
import { createWorkerTransformerWithState } from './createWorkerTransformerWithState';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './getFiletypeFromFileName';
import { getLineNodes } from './getLineNodes';

export interface RenderOptions {
  lang?: SupportedLanguages;
  theme?: PJSThemeNames | Record<'dark' | 'light', PJSThemeNames>;
  disableLineNumbers?: boolean;
  startingLineNumber?: number;
  hastOptions?: Partial<CodeToHastOptions<PJSThemeNames>>;
}

export function renderFileWithHighlighter(
  file: FileContents,
  highlighter: PJSHighlighter,
  {
    theme = DEFAULT_THEMES,
    disableLineNumbers,
    startingLineNumber = 1,
    lang = getFiletypeFromFileName(file.name),
    hastOptions,
  }: RenderOptions = { startingLineNumber: 1 }
): ElementContent[] {
  const { state, transformers } =
    createWorkerTransformerWithState(disableLineNumbers);
  state.lineInfo = (shikiLineNumber: number) => ({
    type: 'context',
    lineIndex: shikiLineNumber - 1,
    lineNumber: startingLineNumber + (shikiLineNumber - 1),
  });
  const hastConfig: CodeToHastOptions<PJSThemeNames> = (() => {
    if (typeof theme === 'string') {
      return {
        ...hastOptions,
        lang,
        theme,
        transformers,
        defaultColor: false,
        cssVariablePrefix: formatCSSVariablePrefix(),
      };
    }
    return {
      ...hastOptions,
      lang,
      themes: theme,
      transformers,
      defaultColor: false,
      cssVariablePrefix: formatCSSVariablePrefix(),
    };
  })();
  return getLineNodes(
    highlighter.codeToHast(cleanLastNewline(file.contents), hastConfig)
  );
}
