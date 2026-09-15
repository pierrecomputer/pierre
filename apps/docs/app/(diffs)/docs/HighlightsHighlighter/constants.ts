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

const markup = new TextDecoder().decode(html);
console.log(markup); // <pre class="highlights" ...><code>...</code></pre>`,
    },
    options,
  },
  highlightsTokens: {
    file: {
      name: 'tokens.ts',
      contents: `import { codeToTokens } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const source = 'const answer = 42;';

const { tokens, fg, bg } = codeToTokens(source, {
  lang: 'ts',
  theme: pierreDark,
});

console.log(tokens[0]); // ThemedToken[] for the first line
console.log(tokens[0].map((token) => token.content).join('')); // const answer = 42;
console.log(fg, bg); // The theme's foreground and background colors`,
    },
    options,
  },
  highlightsStreamPipe: {
    file: {
      name: 'stream-pipe.ts',
      contents: `const lines = response.body.pipeThrough(
  new StreamTokenizer({ lang: 'ts', theme: pierreDark })
);

for await (const tokens of lines) {
  console.log(tokens);
}`,
    },
    options,
  },
  highlightsStream: {
    file: {
      name: 'stream.ts',
      contents: `import { StreamTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });

try {
  console.log(stream.pushCode('const answer =')); // []: no complete line yet
  const bytes = new TextEncoder().encode(' 42;\\nconsole.log(answer);');
  console.log(stream.pushCode(bytes)); // First line
  console.log(stream.end()); // Final line; also disposes the stream
} finally {
  // Also release the instance if consuming the stream throws.
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
  code: 'const answer = 41;\\nconsole.log(answer);',
  lang: 'ts',
  theme: pierreDark,
});

try {
  const update = live.applyEdits([
    {
      range: {
        start: { line: 0, character: 15 },
        end: { line: 0, character: 17 },
      },
      newText: '42',
    },
  ]);

  console.log(live.getLineText(0)); // const answer = 42;
  for (const change of update.lineChanges) {
    for (let line = change.newStartLine; line < change.newEndLine; line++) {
      const { tokens, bracketIgnoredRanges } = live.getLineTokens(line);
      console.log(line, tokens, bracketIgnoredRanges);
    }
  }
} finally {
  live.dispose();
}`,
    },
    options,
  },
  highlightsViewport: {
    file: {
      name: 'viewport.ts',
      contents: `import { LiveTokenizer } from '@pierre/highlights';
import { pierreDark } from '@pierre/highlights/themes';

const live = new LiveTokenizer({
  code: 'const answer = 41;\\nconsole.log(answer);',
  lang: 'ts',
  theme: pierreDark,
  renderRange: [0, 1], // Prioritize the first line.
  onDeferTokenize(lines) {
    // May run before the constructor returns; do not read live here.
    for (const [line, tokens] of lines) console.log(line, tokens);
  },
});

try {
  // Read the initial viewport after construction.
  console.log(live.getLineTokens(0));

  const update = live.applyEdits([
    {
      range: {
        start: { line: 0, character: 15 },
        end: { line: 0, character: 17 },
      },
      newText: '42',
    },
  ], { renderRange: [0, 1] });

  for (const [line, tokens] of update.lines) console.log(line, tokens);
  live.flush(); // Finish pending lines before reading the whole document.
} finally {
  live.dispose();
}`,
    },
    options,
  },
  highlightsThemes: {
    file: {
      name: 'themes.ts',
      contents: `import { codeToHtml } from '@pierre/highlights';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const source = 'const answer = 42;';
const html = codeToHtml(source, { lang: 'ts', theme: vitesseDark });
const markup = new TextDecoder().decode(html);`,
    },
    options,
  },
  highlightsCssVariables: {
    file: {
      name: 'css-variables.ts',
      contents: `import { codeToHtml } from '@pierre/highlights';
import { cssVariables, toCSS } from '@pierre/highlights/themes';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const html = codeToHtml('const answer = 42;', {
  lang: 'ts',
  theme: cssVariables,
});
const markup = new TextDecoder().decode(html);
const stylesheet = '.highlights { ' + toCSS(vitesseDark) + ' }';

// Include the declarations alongside the generated markup.
const page = '<style>' + stylesheet + '</style>' + markup;`,
    },
    options,
  },
  highlightsDualThemes: {
    file: {
      name: 'dual-themes.ts',
      contents: `import { codeToHtml, codeToTokens } from '@pierre/highlights';
import { pierreLight } from '@pierre/highlights/themes';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const options = {
  lang: 'ts',
  themes: { dark: vitesseDark, light: pierreLight },
  cssVariablePrefix: '--code-',
  defaultColor: false,
} as const;

const html = new TextDecoder().decode(codeToHtml('const answer = 42;', options));
// <pre class="highlights" style="--code-dark:...;--code-light:...;--code-dark-bg:...;...">
//   <code><span style="--code-dark:...;--code-light:...">const</span> ...

const { tokens, rootStyle } = codeToTokens('const answer = 42;', options);
console.log(rootStyle); // --code-dark:...;--code-light:...;--code-dark-bg:...;...
console.log(tokens[0][0].htmlStyle); // { '--code-dark': '...', '--code-light': '...' }`,
    },
    options,
  },
  highlightsDualThemesCss: {
    file: {
      name: 'dual-themes.css',
      contents: `.code {
  color: var(--code-light);
  background-color: var(--code-light-bg);
}

.code span {
  color: var(--code-light);
  font-style: var(--code-light-font-style, normal);
  font-weight: var(--code-light-font-weight, normal);
}

@media (prefers-color-scheme: dark) {
  .code {
    color: var(--code-dark);
    background-color: var(--code-dark-bg);
  }

  .code span {
    color: var(--code-dark);
    font-style: var(--code-dark-font-style, normal);
    font-weight: var(--code-dark-font-weight, normal);
  }
}`,
    },
    options,
  },
  highlightsThemeLoader: {
    file: {
      name: 'theme-loader.ts',
      contents: `import { themes } from '@pierre/highlights/themes/loader';

const { default: theme } = await themes['pierre-dark']();`,
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
  highlightsCssVariables: HIGHLIGHTS_CSS_VARIABLES,
  highlightsDualThemes: HIGHLIGHTS_DUAL_THEMES,
  highlightsDualThemesCss: HIGHLIGHTS_DUAL_THEMES_CSS,
  highlightsHtml: HIGHLIGHTS_HTML,
  highlightsLive: HIGHLIGHTS_LIVE,
  highlightsStream: HIGHLIGHTS_STREAM,
  highlightsStreamPipe: HIGHLIGHTS_STREAM_PIPE,
  highlightsThemeLoader: HIGHLIGHTS_THEME_LOADER,
  highlightsThemes: HIGHLIGHTS_THEMES,
  highlightsTokens: HIGHLIGHTS_TOKENS,
  highlightsViewport: HIGHLIGHTS_VIEWPORT,
} = HIGHLIGHTS_HIGHLIGHTER_EXAMPLES;
