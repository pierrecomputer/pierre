import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  disableFileHeader: true,
  lineNumbers: false,
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const HIGHLIGHTS_HIGHLIGHTER_EXAMPLES = {
  highlightsHtml: {
    file: {
      name: 'html.ts',
      contents: `import { codeToHtml } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const html = codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: pierreDark,
});

return new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8' },
});`,
    },
    options,
  },
  highlightsTokensAndHast: {
    file: {
      name: 'tokens-and-hast.ts',
      contents: `import { codeToHast, codeToTokens } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const source = 'const answer = 42;';
const options = { lang: 'ts', theme: pierreDark } as const;

const { tokens, fg, bg, themeName, rootStyle } = codeToTokens(
  source,
  options
);

const root = codeToHast(source, {
  ...options,
  decorations: [{
    start: 6,
    end: 12,
    properties: { class: 'highlighted-word' },
  }],
  transformers: [{
    name: 'code-class',
    code(node) {
      this.addClassToHast(node, 'source-code');
    },
  }],
});`,
    },
    options,
  },
  highlightsStream: {
    file: {
      name: 'stream.ts',
      contents: `import { StreamTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const stream = new StreamTokenizer({ lang: 'tsx', theme: pierreDark });

try {
  for await (const chunk of chunks) {
    for (const lineTokens of stream.pushCode(chunk)) {
      render(lineTokens);
    }
  }
  for (const lineTokens of stream.end()) {
    render(lineTokens);
  }
} finally {
  stream.dispose();
}`,
    },
    options,
  },
  highlightsLive: {
    file: {
      name: 'editor.ts',
      contents: `import { LiveTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const live = new LiveTokenizer({
  code,
  lang: 'tsx',
  theme: pierreDark,
  renderRange: [0, 100],
  onDeferTokenize(lines) {
    for (const [line, tokens] of lines) render(line, tokens);
  },
});

const update = live.applyEdits(edits, { renderRange: [0, 100] });
for (const [line, tokens] of update.lines) render(line, tokens);

live.flush();
const { tokens, bracketIgnoredRanges } = live.getLineTokens(10);
live.dispose();`,
    },
    options,
  },
  highlightsThemes: {
    file: {
      name: 'themes.ts',
      contents: `import { codeToHtml, codeToTokens } from '@pierre/highlights';
import { cssVariables, toCSS } from '@pierre/highlights/themes';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';
// or
import customZedTheme from './custom-zed-theme.json';

const html = codeToHtml(source, { lang: 'ts', theme: vitesseDark });
const themeCSS = toCSS(vitesseDark);

const portable = codeToHtml(source, {
  lang: 'ts',
  theme: cssVariables,
});

const { tokens } = codeToTokens(source, {
  lang: 'ts',
  themes: { dark: vitesseDark, light: lightTheme },
  cssVariablePrefix: '--code-',
  defaultColor: false,
});`,
    },
    options,
  },
  highlightsDiffs: {
    file: {
      name: 'diffs.tsx',
      contents: `import {
  setHighlighter,
  shikiHighlighter,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import {
  highlightsHighlighter,
  registerHighlightsTheme,
} from '@pierre/diffs/highlights';
import customTheme from './custom-theme.json';

registerHighlightsTheme('custom-dark', customTheme);
setHighlighter(highlightsHighlighter);

const view = <FileDiff fileDiff={fileDiff} options={{ theme: 'custom-dark' }} />;

// Restore the default when Highlights is only needed temporarily.
setHighlighter(shikiHighlighter);`,
    },
    options,
  },
  highlightsPreload: {
    file: {
      name: 'preload.ts',
      contents: `import { preloadHighlighter, setHighlighter } from '@pierre/diffs';
import { highlightsHighlighter } from '@pierre/diffs/highlights';

setHighlighter(highlightsHighlighter);

await preloadHighlighter({
  langs: [],
  themes: ['pierre-dark', 'pierre-light'],
});`,
    },
    options,
  },
  highlightsApiRuntime: {
    file: {
      name: 'runtime-api.ts',
      contents: `import {
  codeToHast,
  codeToHtml,
  codeToTokens,
  createHighlighter,
  init,
  isSupportedLanguage,
  LiveTokenizer,
  tokenNames,
  StreamTokenizer,
} from '@pierre/highlights';`,
    },
    options,
  },
  highlightsApiTypes: {
    file: {
      name: 'types.ts',
      contents: `import type {
  // Core
  CodeToHtmlOptions,
  CodeToTokensBaseOptions,
  CodeToTokensOptions,
  Highlighter,
  Lang,
  ThemedToken,
  TokensResult,

  // HAST
  CodeToHastOptions,
  Decoration,
  HastElement,
  HastRoot,
  HastText,
  Transformer,
  TransformerContext,
  TransformerContextCommon,

  // Themes
  Theme,
  ThemeFamily,
  ThemePlayer,
  ThemeStyle,
  ThemeSyntaxSettings,

  // Live editing
  HighlightedToken,
  LiveLineChange,
  LivePosition,
  LiveTextEdit,
  LiveTokenizerOptions,
  LiveTokenizerUpdate,
  LiveTokenRecords,
  LiveUpdateOptions,
} from '@pierre/highlights';`,
    },
    options,
  },
} as const satisfies Readonly<
  Record<string, PreloadFileOptions<undefined, undefined>>
>;

export const {
  highlightsApiRuntime: HIGHLIGHTS_API_RUNTIME,
  highlightsApiTypes: HIGHLIGHTS_API_TYPES,
  highlightsDiffs: HIGHLIGHTS_DIFFS,
  highlightsHtml: HIGHLIGHTS_HTML,
  highlightsLive: HIGHLIGHTS_LIVE,
  highlightsPreload: HIGHLIGHTS_PRELOAD,
  highlightsStream: HIGHLIGHTS_STREAM,
  highlightsThemes: HIGHLIGHTS_THEMES,
  highlightsTokensAndHast: HIGHLIGHTS_TOKENS_AND_HAST,
} = HIGHLIGHTS_HIGHLIGHTER_EXAMPLES;
