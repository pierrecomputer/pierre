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
  highlightsTokens: {
    file: {
      name: 'tokens.ts',
      contents: `import { codeToTokens } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const source = 'const answer = 42;';
const options = { lang: 'ts', theme: pierreDark } as const;

const { tokens, fg, bg, themeName, rootStyle } = codeToTokens(
  source,
  options
);`,
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
import { cssVariables, pierreLight, toCSS } from '@pierre/highlights/themes';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const html = codeToHtml(source, { lang: 'ts', theme: vitesseDark });
const themeCSS = toCSS(vitesseDark);

const portable = codeToHtml(source, {
  lang: 'ts',
  theme: cssVariables,
});

const { tokens } = codeToTokens(source, {
  lang: 'ts',
  themes: { dark: vitesseDark, light: pierreLight },
  cssVariablePrefix: '--code-',
  defaultColor: false,
});`,
    },
    options,
  },
  highlightsDiffs: {
    file: {
      name: 'diffs.tsx',
      contents: `import { setHighlighter } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import {
  highlightsHighlighter,
  registerHighlightsTheme,
} from '@pierre/diffs/highlights';
import customTheme from './custom-theme.json';

registerHighlightsTheme('custom-dark', customTheme);
setHighlighter(highlightsHighlighter);

const view = <FileDiff fileDiff={fileDiff} options={{ theme: 'custom-dark' }} />;`,
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
  highlightsSsr: {
    file: {
      name: 'server.ts',
      contents: `import { highlightsHighlighter } from '@pierre/diffs/highlights';
import { preloadFile } from '@pierre/diffs/ssr';

const result = await preloadFile({
  file: { name: 'example.ts', contents: 'const answer = 42;' },
  highlighter: highlightsHighlighter,
  options: { theme: 'pierre-dark' },
});

// Pass result to <File {...result} /> on the client.
// Register highlightsHighlighter in the client before hydrating.`,
    },
    options,
  },
  highlightsApiRuntime: {
    file: {
      name: 'runtime-api.ts',
      contents: `import {
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
  highlightsSsr: HIGHLIGHTS_SSR,
  highlightsStream: HIGHLIGHTS_STREAM,
  highlightsThemes: HIGHLIGHTS_THEMES,
  highlightsTokens: HIGHLIGHTS_TOKENS,
} = HIGHLIGHTS_HIGHLIGHTER_EXAMPLES;
