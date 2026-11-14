import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  disableFileHeader: true,
  lineNumbers: false,
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const HIGHLIGHTS_HIGHLIGHTER_EXAMPLES = {
  highlightsDiff: {
    file: {
      name: 'diff.tsx',
      contents: `<FileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{ preferredHighlighter: 'highlights' }}
/>`,
    },
    options,
  },
  highlightsInstall: {
    file: {
      name: 'pnpm.sh',
      contents: 'pnpm add @pierre/highlights',
    },
    options: {
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      disableFileHeader: true,
      unsafeCSS: CustomScrollbarCSS,
    },
  },
  highlightsSkill: {
    file: {
      name: 'skill.sh',
      contents: 'npx skills add pierrecomputer/pierre --skill highlights',
    },
    options,
  },
  highlightsQuickStart: {
    file: {
      name: 'quick-start.ts',
      contents: `import { codeToHtml, pierreDark } from '@pierre/highlights';

const html = new TextDecoder().decode(
  codeToHtml('const a = 1', { lang: 'ts', theme: pierreDark })
);`,
    },
    options,
  },
  highlightsAllLanguages: {
    file: {
      name: 'all-languages.ts',
      contents: `import { createHighlighter } from '@pierre/highlights/core';
import { langs } from '@pierre/highlights/langs';
import { themes } from '@pierre/highlights/themes';

const highlighter = await createHighlighter({ langs, themes });`,
    },
    options,
  },
  highlightsInit: {
    file: {
      name: 'init.ts',
      contents: `import { init } from '@pierre/highlights/core';

init(
  await WebAssembly.compileStreaming(
    fetch(new URL('@pierre/highlights/highlights.wasm', import.meta.url))
  )
);`,
    },
    options,
  },
  highlightsHtml: {
    file: {
      name: 'html.ts',
      contents: `import { createHighlighter } from '@pierre/highlights/core';
import ts from '@pierre/highlights/langs/typescript';
import { pierreDark } from '@pierre/highlights/themes';

const highlighter = await createHighlighter({ langs: [ts], themes: [pierreDark] });
const html = highlighter.codeToHtml("console.log('Hello world!')", {
  lang: 'js',
  theme: 'pierre-dark',
});

const markup = new TextDecoder().decode(html);
console.log(markup); // <pre class="highlights" ...><code>...</code></pre>`,
    },
    options,
  },
  highlightsTokens: {
    file: {
      name: 'tokens.ts',
      contents: `import { createHighlighter } from '@pierre/highlights/core';
import ts from '@pierre/highlights/langs/typescript';
import { pierreDark } from '@pierre/highlights/themes';

const source = 'const answer = 42;';

const highlighter = await createHighlighter({ langs: [ts], themes: [pierreDark] });
const { tokens, fg, bg } = highlighter.codeToTokens(source, {
  lang: 'ts',
  theme: 'pierre-dark',
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
      contents: `import { createHighlighter } from '@pierre/highlights/core';
import ts from '@pierre/highlights/langs/typescript';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const source = 'const answer = 42;';
const highlighter = await createHighlighter({ langs: [ts], themes: [vitesseDark] });
const html = highlighter.codeToHtml(source, { lang: 'ts', theme: 'vitesse-dark' });
const markup = new TextDecoder().decode(html);`,
    },
    options,
  },
  highlightsCssVariables: {
    file: {
      name: 'css-variables.ts',
      contents: `import { createHighlighter } from '@pierre/highlights/core';
import ts from '@pierre/highlights/langs/typescript';
import { cssVariables, toCSS } from '@pierre/highlights/themes';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const highlighter = await createHighlighter({ langs: [ts], themes: [cssVariables] });
const html = highlighter.codeToHtml('const answer = 42;', {
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
      contents: `import { createHighlighter } from '@pierre/highlights/core';
import ts from '@pierre/highlights/langs/typescript';
import { pierreLight } from '@pierre/highlights/themes';
import vitesseDark from '@pierre/highlights/themes/vitesse-dark';

const highlighter = await createHighlighter({
  langs: [ts],
  themes: [vitesseDark, pierreLight],
});
const options = {
  lang: 'ts',
  themes: { dark: 'vitesse-dark', light: 'pierre-light' },
  cssVariablePrefix: '--code-',
  defaultColor: false,
} as const;

const html = new TextDecoder().decode(highlighter.codeToHtml('const answer = 42;', options));
// <pre class="highlights" style="--code-dark:...;--code-light:...;--code-dark-bg:...;...">
//   <code><span style="--code-dark:...;--code-light:...">const</span> ...

const { tokens, rootStyle } = highlighter.codeToTokens('const answer = 42;', options);
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
      contents: `// All lexers, initialized at import, and all themes.
// '@pierre/highlights/core' exports the same functions without them.
import {
  codeToHtml,
  codeToTokens,
  createHighlighter,
  init,
  isRegisteredLanguage,
  isSupportedLanguage,
  LiveTokenizer,
  registerLanguages,
  StreamTokenizer,
  tokenNames,
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
  HighlighterOptions,
  RegisteredHighlighter,
  Language,
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
  highlightsAllLanguages: HIGHLIGHTS_ALL_LANGUAGES,
  highlightsApiRuntime: HIGHLIGHTS_API_RUNTIME,
  highlightsApiTypes: HIGHLIGHTS_API_TYPES,
  highlightsCssVariables: HIGHLIGHTS_CSS_VARIABLES,
  highlightsDiff: HIGHLIGHTS_DIFF,
  highlightsDualThemes: HIGHLIGHTS_DUAL_THEMES,
  highlightsDualThemesCss: HIGHLIGHTS_DUAL_THEMES_CSS,
  highlightsHtml: HIGHLIGHTS_HTML,
  highlightsInit: HIGHLIGHTS_INIT,
  highlightsInstall: HIGHLIGHTS_INSTALL,
  highlightsLive: HIGHLIGHTS_LIVE,
  highlightsQuickStart: HIGHLIGHTS_QUICK_START,
  highlightsSkill: HIGHLIGHTS_SKILL,
  highlightsStream: HIGHLIGHTS_STREAM,
  highlightsStreamPipe: HIGHLIGHTS_STREAM_PIPE,
  highlightsThemeLoader: HIGHLIGHTS_THEME_LOADER,
  highlightsThemes: HIGHLIGHTS_THEMES,
  highlightsTokens: HIGHLIGHTS_TOKENS,
  highlightsViewport: HIGHLIGHTS_VIEWPORT,
} = HIGHLIGHTS_HIGHLIGHTER_EXAMPLES;
