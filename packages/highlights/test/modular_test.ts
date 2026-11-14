import {
  type CodeToHtmlOptions,
  createHighlighter,
  type HighlighterOptions,
  type Lang,
  type Language,
  type RegisteredHighlighter,
} from '@pierre/highlights/core';
import { langs } from '@pierre/highlights/langs';
import css from '@pierre/highlights/langs/css';
import html from '@pierre/highlights/langs/html';
import json from '@pierre/highlights/langs/json';
import markdown from '@pierre/highlights/langs/markdown';
import python from '@pierre/highlights/langs/python';
import typescript from '@pierre/highlights/langs/typescript';
import {
  cssVariables,
  pierreDark,
  pierreDarkVibrant,
  pierreLight,
  themes,
} from '@pierre/highlights/themes';
import { expect, expectTypeOf, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

import { HighlightsHighlighter } from '../lib/highlighter';
import { transformLexer } from '../scripts/build';
import { samples as languageSamples } from './_samples';

const decoder = new TextDecoder();
const selectivePromise = createHighlighter({
  langs: [typescript, json, html, css],
  themes: [pierreDark, pierreLight, pierreDarkVibrant, cssVariables],
});
const combinedPromise = createHighlighter({ langs, themes });
const reference = new HighlightsHighlighter(
  new WebAssembly.Module(
    readFileSync(new URL('../dist/highlights.wasm', import.meta.url))
  )
);
const loadLanguage = async (name: string): Promise<Language> =>
  ((await import(`@pierre/highlights/langs/${name}`)) as { default: Language })
    .default;

test('createHighlighter requires options and returns a promise', () => {
  expectTypeOf(createHighlighter).parameters.toEqualTypeOf<
    [HighlighterOptions]
  >();
  expectTypeOf(createHighlighter).returns.toEqualTypeOf<
    Promise<RegisteredHighlighter>
  >();
  expect(selectivePromise).toBeInstanceOf(Promise);
});

test('selective TypeScript lexer registers every ECMAScript alias', async () => {
  const highlighter = await createHighlighter({
    langs: [typescript],
    themes: [pierreDark],
  });
  for (const lang of [
    'typescript',
    'ts',
    'tsx',
    'cts',
    'mts',
    'javascript',
    'js',
    'jsx',
    'mjs',
    'cjs',
  ] as const) {
    const code =
      lang === 'tsx' || lang === 'jsx'
        ? 'const view = <span title="你好">🙂</span>'
        : 'const greeting = "你好🙂";\nconsole.log(greeting)';
    const result = highlighter.codeToTokens(code, {
      lang,
      theme: 'pierre-dark',
    });
    expect(result).toEqual(
      reference.codeToTokens(code, { lang, theme: pierreDark })
    );
    expect(
      decoder.decode(
        highlighter.codeToHtml(code, { lang, theme: 'pierre-dark' })
      )
    ).toBe(
      decoder.decode(reference.codeToHtml(code, { lang, theme: pierreDark }))
    );
  }
  expect(() =>
    highlighter.codeToTokens('print(1)', {
      lang: 'python',
      theme: 'pierre-dark',
    })
  ).toThrow(/lang/i);
  expect(() =>
    highlighter.codeToHtml('const a = 1', {
      lang: 'js',
      theme: 'pierre-light',
    })
  ).toThrow(/theme/i);
});

test('selected languages and the combined lexer preserve HTML and token output', async () => {
  const [selective, combined] = await Promise.all([
    selectivePromise,
    combinedPromise,
  ]);
  const samples: [Lang, string][] = [
    ['ts', 'const 你好 = "🙂<&>";\r\n// café\nlet x: number = 1;\n'],
    ['tsx', 'const node = <div title="&">你好 {value}</div>;'],
    ['json', '{"message": "你好🙂<&>", "answer": 42}\n'],
    [
      'html',
      '<style>.a { color: red }</style>\n<script>const a = 1 < 2;</script>',
    ],
  ];
  for (const [lang, code] of samples) {
    for (const theme of [pierreDark, pierreDarkVibrant]) {
      const name = theme.name.toLowerCase().replaceAll(' ', '-');
      const expectedTokens = reference.codeToTokens(code, { lang, theme });
      const expectedHtml = decoder.decode(
        reference.codeToHtml(code, { lang, theme })
      );
      for (const highlighter of [selective, combined]) {
        expect(highlighter.codeToTokens(code, { lang, theme: name })).toEqual(
          expectedTokens
        );
        expect(
          decoder.decode(highlighter.codeToHtml(code, { lang, theme: name }))
        ).toBe(expectedHtml);
      }
    }
  }
});

test('registered theme names work for multiple themes and CSS variables', async () => {
  const highlighter = await selectivePromise;
  const code = 'const value = "<&🙂>";\r\n';
  for (const defaultColor of ['light', false, 'light-dark()'] as const) {
    const options = {
      lang: 'ts' as const,
      themes: { light: 'pierre-light', dark: 'pierre-dark' },
      defaultColor,
    };
    const expectedOptions = {
      ...options,
      themes: { light: pierreLight, dark: pierreDark },
    };
    expect(highlighter.codeToTokens(code, options)).toEqual(
      reference.codeToTokens(code, expectedOptions)
    );
    expect(decoder.decode(highlighter.codeToHtml(code, options))).toBe(
      decoder.decode(reference.codeToHtml(code, expectedOptions))
    );
  }
  expect(
    decoder.decode(
      highlighter.codeToHtml(code, { lang: 'ts', theme: 'css-variables' })
    )
  ).toBe(
    decoder.decode(
      reference.codeToHtml(code, { lang: 'ts', theme: cssVariables })
    )
  );
});

test('separate highlighters keep their language and theme registrations isolated', async () => {
  const highlighter = await createHighlighter({
    langs: [json],
    themes: [pierreLight],
  });
  const selective = await selectivePromise;
  expect(() =>
    highlighter.codeToTokens('const a = 1', {
      lang: 'ts',
      theme: 'pierre-light',
    })
  ).toThrow(/lang/i);
  expect(() =>
    highlighter.codeToTokens('1', { lang: 'json', theme: 'pierre-dark' })
  ).toThrow(/theme/i);
  expect(
    selective.codeToTokens('1', { lang: 'json', theme: 'pierre-dark' })
      .tokens[0][0].content
  ).toBe('1');
});

test('modular emission handles memory growth, byte input, and repeated calls', async () => {
  const highlighter = await selectivePromise;
  const code = 'const value = "你好🙂<&>";\r\n'.repeat(4096);
  const options = { lang: 'ts', theme: 'pierre-dark' } as const;
  const expected = { lang: 'ts', theme: pierreDark } as const;
  for (const input of [
    code,
    new TextEncoder().encode(code).buffer,
    '',
    'const small = 1',
  ]) {
    expect(decoder.decode(highlighter.codeToHtml(input, options))).toBe(
      decoder.decode(reference.codeToHtml(input, expected))
    );
    expect(highlighter.codeToTokens(input, options)).toEqual(
      reference.codeToTokens(input, expected)
    );
  }
  const malformed = new Uint8Array([102, 111, 128, 10]);
  expect(highlighter.codeToTokens(malformed, options)).toEqual(
    reference.codeToTokens(malformed, expected)
  );
});

test('standalone language modules embed smaller Wasm and langs holds one combined module', () => {
  expect(langs).toHaveLength(1);
  const size = (language: Language): number => (language.wasm as string).length;
  expect(size(typescript)).toBeLessThan(size(langs[0]));
  expect(size(json)).toBeLessThan(size(typescript));
  for (const language of [typescript, json, html, ...langs]) {
    const bytes = Buffer.from(language.wasm as string, 'base64');
    expect(WebAssembly.validate(bytes)).toBe(true);
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes));
    expect(imports.every((entry) => entry.module === 'env')).toBe(true);
  }
});

test.each([
  { names: ['html'] },
  { names: ['js', 'jsx', 'ts', 'tsx'] },
  { names: ['markdown'] },
])('standalone %j omits the CSS lexer', ({ names }) => {
  const { code } = transformLexer(names);
  expect(code).not.toContain('(func $hlCss');
  expect(code).not.toContain('(func $cssString');
  expect(code).toContain('(import "env" "embed"');
});

test('themes contains every bundled JSON theme', () => {
  const filenames = readdirSync(new URL('../themes/', import.meta.url)).filter(
    (name) => name.endsWith('.json')
  );
  expect(themes).toHaveLength(filenames.length);
  expect(
    themes.map((theme) => theme.id!).sort((a, b) => a.localeCompare(b))
  ).toEqual(
    filenames
      .map((filename) => filename.slice(0, -5))
      .sort((a, b) => a.localeCompare(b))
  );
  expect(themes).toContain(pierreDark);
  expect(themes).toContain(pierreLight);
  expect(
    themes.every(
      (theme) => typeof theme.name === 'string' && theme.style != null
    )
  ).toBe(true);
});

test('a bundled theme keeps its JSON style and accepts a new one', () => {
  const theme = themes.find(({ id }) => id === 'vesper')!;
  const json = JSON.parse(
    readFileSync(new URL('../themes/vesper.json', import.meta.url), 'utf-8')
  ) as typeof theme;
  expect(Object.keys(theme)).toEqual(['id', 'name', 'appearance', 'style']);
  const { style } = theme;
  expect(style).toEqual(json.style);
  expect(theme.style).toBe(style);
  expect({ ...theme }.style).toBe(style);
  theme.style = {};
  expect(theme.style).toEqual({});
  theme.style = style;
  expect(theme.style).toBe(style);
});

test('themes resolve by canonical ID, including accented display names', async () => {
  const highlighter = await combinedPromise;
  for (const theme of themes) {
    if (theme.id === undefined) throw new Error(`Missing ID: ${theme.name}`);
    expect(
      highlighter.codeToTokens('const a = 1', { lang: 'ts', theme: theme.id })
    ).toEqual(reference.codeToTokens('const a = 1', { lang: 'ts', theme }));
  }
});

test('selective browser bundles omit the combined Wasm and unused theme data', async () => {
  const source = `
    import { createHighlighter } from '@pierre/highlights/core';
    import typescript from '@pierre/highlights/langs/typescript';
    import { pierreDark } from '@pierre/highlights/themes';
    export const highlighter = createHighlighter({ langs: [typescript], themes: [pierreDark] });
  `;
  const buildProcess = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
      const result = await Bun.build({
        entrypoints: ['highlights-entry'],
        target: 'browser',
        minify: true,
        plugins: [{
          name: 'highlights-entry',
          setup(builder) {
            builder.onResolve({ filter: /^highlights-entry$/ }, () => ({ path: 'entry', namespace: 'highlights' }));
            builder.onLoad({ filter: /.*/, namespace: 'highlights' }, () => ({ contents: ${JSON.stringify(source)}, loader: 'ts' }));
            builder.onResolve({ filter: /^@pierre[/]/, namespace: 'highlights' }, (args) => ({ path: Bun.resolveSync(args.path, process.cwd()), namespace: 'file' }));
          }
        }],
      });
      if (!result.success) throw new AggregateError(result.logs, 'Build failed');
      console.log(await result.outputs[0].text());
    `,
    ],
    {
      cwd: new URL('..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(buildProcess.stdout).text(),
    new Response(buildProcess.stderr).text(),
    buildProcess.exited,
  ]);
  expect(errors).toBe('');
  expect(exitCode).toBe(0);
  expect(output.includes(typescript.wasm as string)).toBe(true);
  expect(output.includes(langs[0].wasm as string)).toBe(false);
  expect(
    output.includes(
      readFileSync(
        new URL('../dist/highlights.wasm', import.meta.url)
      ).toString('base64')
    )
  ).toBe(false);
  expect(output.includes('Pierre Dark')).toBe(true);
  expect(output.includes('Pierre Light')).toBe(false);
  expect(output.includes('Catppuccin')).toBe(false);
});

test.each(Object.entries(languageSamples))(
  'standalone %s preserves output with embedded languages registered',
  async (name, { code }) => {
    const entry = ['tsx', 'javascript', 'jsx'].includes(name)
      ? 'typescript'
      : name;
    const language = await loadLanguage(entry);
    const selective = await createHighlighter({
      langs: [...langs, language],
      themes: [cssVariables],
    });
    const combined = await combinedPromise;
    const options = { lang: name, theme: cssVariables };
    const expectedTokens = reference.codeToTokens(code, options);
    const expectedHtml = decoder.decode(reference.codeToHtml(code, options));
    for (const highlighter of [selective, combined]) {
      expect(highlighter.codeToTokens(code, options)).toEqual(expectedTokens);
      expect(decoder.decode(highlighter.codeToHtml(code, options))).toBe(
        expectedHtml
      );
    }
  }
);

test.each(['markdown', 'mdx'] as const)(
  'standalone %s uses registered TypeScript and Python fences',
  async (lang) => {
    const language = await loadLanguage(lang);
    const selective = await createHighlighter({
      langs: [language, typescript, python],
      themes: [cssVariables],
    });
    const combined = await combinedPromise;
    const code =
      '# Examples\n\n```ts\nconst text: string = "你好🙂";\n```\n\n```python\ndef hello(name):\n    return f"Hello {name}"\n```\n';
    const options = { lang, theme: cssVariables };
    const expectedTokens = reference.codeToTokens(code, options);
    const expectedHtml = decoder.decode(reference.codeToHtml(code, options));
    for (const highlighter of [selective, combined]) {
      expect(highlighter.codeToTokens(code, options)).toEqual(expectedTokens);
      expect(decoder.decode(highlighter.codeToHtml(code, options))).toBe(
        expectedHtml
      );
    }
  }
);

test('HTML embeds registered scripts and leaves unregistered styles plain', async () => {
  const highlighter = await createHighlighter({
    langs: [typescript, html],
    themes: [pierreDark],
  });
  const style = '.card { color: red; }';
  const code = `<script>const answer = 42;</script>\n<style>${style}</style>`;
  const result = highlighter.codeToTokens(code, {
    lang: 'html',
    theme: 'pierre-dark',
  });
  const tokens = result.tokens.flat();
  expect(tokens.find((token) => token.content === 'const')?.color).not.toBe(
    result.fg
  );
  expect(tokens.find((token) => token.content === style)?.color).toBe(
    result.fg
  );
  const markupOnly = await createHighlighter({
    langs: [html],
    themes: [pierreDark],
  });
  const plain = markupOnly.codeToTokens(code, {
    lang: 'html',
    theme: 'pierre-dark',
  });
  expect(
    plain.tokens.flat().find((token) => token.content === 'const answer = 42;')
      ?.color
  ).toBe(plain.fg);
});

test('Markdown preserves registered lexer state across quoted fence lines', async () => {
  const highlighter = await createHighlighter({
    langs: [markdown, typescript],
    themes: [pierreDark],
  });
  const code =
    '> ```typescript\n> /* comment\n> still comment */\n> const answer = 42;\n> ```\n';
  expect(
    highlighter.codeToTokens(code, { lang: 'markdown', theme: 'pierre-dark' })
  ).toEqual(
    reference.codeToTokens(code, { lang: 'markdown', theme: pierreDark })
  );
  const missing = '```python\ndef hello():\n    return 42\n```\n';
  const result = highlighter.codeToTokens(missing, {
    lang: 'markdown',
    theme: 'pierre-dark',
  });
  expect(result.tokens[1].map((token) => token.content)).toEqual([
    'def hello():',
  ]);
  expect(result.tokens[2].map((token) => token.content).join('')).toBe(
    '    return 42'
  );
});

test.each([
  { lang: 'python', body: 'text = """first\nsecond"""\nprint(text)' },
  { lang: 'css', body: '.card {\n/* first\nsecond */ color: red;\n}' },
  {
    lang: 'html',
    body:
      '<script>/* unfinished</script>\n<script>\nconst answer = 42;\n</script>\n' +
      '<style>\n.card { color: red; }\n</style>',
  },
])(
  'quoted $lang fences preserve child stream state',
  async ({ lang, body }) => {
    const highlighter = await createHighlighter({
      langs: [markdown, typescript, python, html, css],
      themes: [pierreDark],
    });
    const code = `> \`\`\`${lang}\n${body
      .split('\n')
      .map((line) => `> ${line}\n`)
      .join('')}> \`\`\`\n`;
    expect(
      highlighter.codeToTokens(code, { lang: 'markdown', theme: 'pierre-dark' })
    ).toEqual(
      reference.codeToTokens(code, { lang: 'markdown', theme: pierreDark })
    );
  }
);

test('tagged templates keep nested HTML state and use registered CSS', async () => {
  const code =
    'const view = html`<div class="${html`<b>${value}</b>`}">${value}</div>`;\n' +
    'const style = css`a { color: ${color}; background: red; }`;\n' +
    'const escaped = html`<a title="x\\"y">t</a>`;\n' +
    'const raw = html`<style> a { color: red } </style><script>let a = 1</script>`;';
  const highlighter = await createHighlighter({
    langs: [typescript, html, css],
    themes: [pierreDark],
  });
  expect(
    highlighter.codeToTokens(code, { lang: 'ts', theme: 'pierre-dark' })
  ).toEqual(reference.codeToTokens(code, { lang: 'ts', theme: pierreDark }));
  const withoutCss = await createHighlighter({
    langs: [typescript, html],
    themes: [pierreDark],
  });
  const result = withoutCss.codeToTokens(
    'const style = css`a { color: red; }`;',
    {
      lang: 'ts',
      theme: 'pierre-dark',
    }
  );
  expect(
    result.tokens.flat().find((token) => token.content === 'a { color: red; }')
      ?.color
  ).toBe(result.fg);
});

test.each(['vue', 'svelte', 'astro', 'mdx', 'qml'] as const)(
  '%s highlights expressions with its own lexer',
  async (lang) => {
    const language = await loadLanguage(lang);
    const code =
      lang === 'vue'
        ? '<div>{{ value + 1 }}</div>'
        : lang === 'mdx'
          ? 'export const value = {\n\n  count: 1\n}\n\nResult: {value + 1}\n'
          : lang === 'qml'
            ? 'Item { property int value: Math.max(1, 2) }'
            : '<div>{value + 1}</div>';
    for (const langs of [[language], [language, typescript]]) {
      const highlighter = await createHighlighter({
        langs,
        themes: [pierreDark],
      });
      expect(
        highlighter.codeToTokens(code, { lang, theme: 'pierre-dark' })
      ).toEqual(reference.codeToTokens(code, { lang, theme: pierreDark }));
    }
  }
);

test('PHP starts HTML again after each island, as the combined lexer does', async () => {
  const php = await loadLanguage('php');
  const highlighter = await createHighlighter({
    langs: [php, html, typescript, css, markdown],
    themes: [pierreDark],
  });
  for (const code of [
    '<a href="/u/<?= $id ?>/x" class="b">t</a>',
    '<script>var a = <?= $x ?>; go(1);</script>',
    '<style>a { color: <?= $c ?>; }</style><p>x</p>',
  ]) {
    expect(
      highlighter.codeToTokens(code, { lang: 'php', theme: 'pierre-dark' })
    ).toEqual(reference.codeToTokens(code, { lang: 'php', theme: pierreDark }));
  }
});

test('nested Markdown fences stop at the depth limit of the combined lexer', async () => {
  const highlighter = await createHighlighter({
    langs: [markdown, json],
    themes: [pierreDark],
  });
  for (const depth of [8, 9, 10, 70]) {
    let code = '{"a": 1}';
    for (let level = 0; level < depth; level++) {
      const fence = '`'.repeat(level + 4);
      code = `${fence}${level === 0 ? 'json' : 'markdown'}\n${code}\n${fence}`;
    }
    expect(
      highlighter.codeToTokens(code, {
        lang: 'markdown',
        theme: 'pierre-dark',
      })
    ).toEqual(
      reference.codeToTokens(code, { lang: 'markdown', theme: pierreDark })
    );
  }
});

test('the lexer bundle keeps the plain-text names as plain text', async () => {
  const highlighter = await combinedPromise;
  const code = '# t\n\n```text\nhello world\n```\n\n```txt\n<b>\n```\n';
  expect(
    highlighter.codeToTokens(code, { lang: 'markdown', theme: 'pierre-dark' })
  ).toEqual(
    reference.codeToTokens(code, { lang: 'markdown', theme: pierreDark })
  );
  for (const { aliases } of langs) {
    expect(Object.values(aliases)).not.toContain(0);
  }
});

test.each([
  ['coffee', 'result = `Math.max(1, 2)`', 'Math.max'],
  ['php', '<div class="box"><?php echo "x"; ?></div>', '<div'],
] as const)(
  '%s leaves unregistered embedded syntax plain',
  async (lang, code, text) => {
    const language = await loadLanguage(lang);
    const highlighter = await createHighlighter({
      langs: [language],
      themes: [pierreDark],
    });
    const result = highlighter.codeToTokens(code, {
      lang,
      theme: 'pierre-dark',
    });
    expect(
      result.tokens.flat().find((token) => token.content.includes(text))?.color
    ).toBe(result.fg);
  }
);

test('plain text and ANSI work without loading language modules', async () => {
  const highlighter = await createHighlighter({
    langs: [],
    themes: [pierreDark],
  });
  for (const lang of ['plain', 'plaintext', 'text', 'txt', 'ansi'] as const) {
    for (const code of ['', '你好🙂<&>\r\n', '\x1b[31mred\x1b[0m\n']) {
      const options = { lang, theme: 'pierre-dark' };
      const expected = { lang, theme: pierreDark };
      expect(highlighter.codeToTokens(code, options)).toEqual(
        reference.codeToTokens(code, expected)
      );
      expect(decoder.decode(highlighter.codeToHtml(code, options))).toBe(
        decoder.decode(reference.codeToHtml(code, expected))
      );
    }
  }
});

test('the main entry adds the combined lexers and all themes to the core API', async () => {
  const core = await import('@pierre/highlights/core');
  const main = await import('@pierre/highlights');
  expect(Object.keys(core).sort()).toEqual([
    'LiveTokenizer',
    'StreamTokenizer',
    'codeToHtml',
    'codeToTokens',
    'createHighlighter',
    'init',
    'isRegisteredLanguage',
    'isSupportedLanguage',
    'registerLanguages',
    'tokenNames',
  ]);
  for (const name of Object.keys(core)) expect(main).toHaveProperty(name);
  for (const name of Object.keys(await import('@pierre/highlights/themes'))) {
    expect(main).toHaveProperty(name);
  }
});

test('shared options reject unknown names while a registered highlighter accepts them', async () => {
  expectTypeOf<CodeToHtmlOptions['lang']>().toEqualTypeOf<Lang>();
  expectTypeOf<'typescrip'>().not.toExtend<Lang>();
  const highlighter = await createHighlighter({
    langs: [json],
    themes: [pierreDark],
  });
  expectTypeOf<
    Parameters<RegisteredHighlighter['codeToHtml']>[1]['lang']
  >().toEqualTypeOf<Lang | (string & {})>();
  const loaded = highlighter.getLoadedLanguages();
  expect(loaded).toContain('json');
  expect(loaded).toContain('plain');
  expect(loaded).toContain('ansi');
  expect(loaded).not.toContain('python');
  for (const lang of loaded) {
    expect(() =>
      highlighter.codeToTokens('1', { lang, theme: 'pierre-dark' })
    ).not.toThrow();
  }
});

test('a theme family registers every member and its own name', async () => {
  const highlighter = await createHighlighter({
    langs: [json],
    themes: [{ name: 'Pierre', themes: [pierreDark, pierreLight] }],
  });
  for (const [name, theme] of [
    ['pierre-dark', pierreDark],
    ['Pierre Dark', pierreDark],
    ['pierre-light', pierreLight],
    ['Pierre Light', pierreLight],
    ['Pierre', pierreDark],
    ['pierre', pierreDark],
  ] as const) {
    expect(
      highlighter.codeToTokens('{"a": 1}', { lang: 'json', theme: name })
    ).toEqual(reference.codeToTokens('{"a": 1}', { lang: 'json', theme }));
  }
  expect(() =>
    highlighter.codeToTokens('1', { lang: 'json', theme: 'pierre-soft' })
  ).toThrow(/theme/i);
});

test('language descriptors accept a compiled module', async () => {
  const highlighter = await createHighlighter({
    langs: [
      {
        ...json,
        wasm: await WebAssembly.compile(
          Buffer.from(json.wasm as string, 'base64')
        ),
      },
    ],
    themes: [pierreDark],
  });
  const code = '{"message": "你好🙂<&>", "answer": 42}\n';
  expect(
    highlighter.codeToTokens(code, { lang: 'json', theme: 'pierre-dark' })
  ).toEqual(reference.codeToTokens(code, { lang: 'json', theme: pierreDark }));
});

test('workerd entries import compiled Wasm instead of embedding bytes', async () => {
  const result = await Bun.build({
    entrypoints: [new URL('./_workerd_entry.ts', import.meta.url).pathname],
    conditions: ['workerd'],
    external: ['*.wasm'],
    target: 'browser',
  });
  expect(result.success).toBe(true);
  const output = await result.outputs[0].text();
  for (const name of ['emitter', 'typescript', 'langs']) {
    expect(output).toMatch(new RegExp(`from "[^"]*${name}\\.wasm"`));
  }
  expect(output.includes(typescript.wasm as string)).toBe(false);
  expect(output.includes(langs[0].wasm as string)).toBe(false);
});

test('embedded languages reuse child lexer instances', async () => {
  const highlighter = await createHighlighter({
    langs: [markdown, typescript, css, html],
    themes: [pierreDark],
  });
  const inputs = [
    [
      'markdown',
      '# t\n\n```ts\nconst a = 1\n```\n\n```css\na{b:c}\n```\n\n> ```html\n> <b>\n> </b>\n> ```\n'.repeat(
        20
      ),
    ],
    [
      'ts',
      'const a = css`a{b:c}`; const b = html`<i>${css`a{b:${c}}`}</i>`;\n'.repeat(
        100
      ),
    ],
    ['html', '<script>var a = 1</script><style>a{b:c}</style>\n'.repeat(50)],
  ] as const;
  const Instance = WebAssembly.Instance;
  let created = 0;
  WebAssembly.Instance = function (
    ...args: ConstructorParameters<typeof WebAssembly.Instance>
  ) {
    created++;
    return new Instance(...args);
  } as unknown as typeof WebAssembly.Instance;
  try {
    for (const [lang, code] of inputs) {
      expect(
        highlighter.codeToTokens(code, { lang, theme: 'pierre-dark' })
      ).toEqual(reference.codeToTokens(code, { lang, theme: pierreDark }));
    }
    // Three root lexers and one child for each language open at a time.
    expect(created).toBeLessThan(16);
    created = 0;
    for (const [lang, code] of inputs) {
      expect(
        decoder.decode(
          highlighter.codeToHtml(code, { lang, theme: 'pierre-dark' })
        )
      ).toBe(
        decoder.decode(reference.codeToHtml(code, { lang, theme: pierreDark }))
      );
    }
    expect(created).toBe(0);
  } finally {
    WebAssembly.Instance = Instance;
  }
});

test('a reused child lexer does not continue its last stream', async () => {
  const astro = await loadLanguage('astro');
  const highlighter = await createHighlighter({
    langs: [markdown, astro, typescript],
    themes: [pierreDark],
  });
  // The first fence leaves a comment open in the stream lexer of `{...}`.
  // The second fence starts its front matter stream with an empty body.
  for (const code of [
    '> ```astro\n>     nt(T) {/*',
    "> ```astro\n> ---\n> import Layout from '../layouts/Layout.astro';",
  ]) {
    expect(
      highlighter.codeToTokens(code, { lang: 'markdown', theme: 'pierre-dark' })
    ).toEqual(
      reference.codeToTokens(code, { lang: 'markdown', theme: pierreDark })
    );
  }
});

test('HTTP keeps its own lexer for bodies that are not JSON or XML', async () => {
  const highlighter = await createHighlighter({
    langs: [await loadLanguage('http'), json, await loadLanguage('xml')],
    themes: [pierreDark],
  });
  for (const code of [
    'POST /a\n\nuser={{name}}&x={{y}}',
    'POST /a\nContent-Type: text/plain\n\nhello {{name}}\n',
    'POST /a\nContent-Type: application/x-www-form-urlencoded\n\na={{b}}&c=d\n',
    'POST /a\nContent-Type: application/json\n\n{"a": "{{b}}", "c": {{d}}}\n',
    'POST /a\nContent-Type: application/xml\n\n<a b="{{c}}">d</a>\n',
  ]) {
    expect(
      highlighter.codeToTokens(code, { lang: 'http', theme: 'pierre-dark' })
    ).toEqual(
      reference.codeToTokens(code, { lang: 'http', theme: pierreDark })
    );
  }
  const { code } = transformLexer(['http']);
  expect(code).toContain('(func $httpText');
  expect(code).not.toContain('(func $hlJson');
  expect(code).not.toContain('(func $hlXml');
});

test('an ansi fence is literal text, as an unknown language', async () => {
  const highlighter = await createHighlighter({
    langs: [markdown],
    themes: [pierreDark],
  });
  const code =
    '```ansi\n\x1b[31mred\x1b[0m\n```\n\n> ```ANSI\n> a "b"\n> c\n> ```\n';
  expect(
    highlighter.codeToTokens(code, { lang: 'markdown', theme: 'pierre-dark' })
  ).toEqual(
    reference.codeToTokens(code, { lang: 'markdown', theme: pierreDark })
  );
});

test('a large input does not pin the emitter memory', async () => {
  const highlighter = await createHighlighter({
    langs: [json],
    themes: [pierreDark],
  });
  const options = { lang: 'json', theme: 'pierre-dark' } as const;
  const limit = 8 * 1024 * 1024;
  expect(
    highlighter.codeToHtml('[1, 2, 3]\n'.repeat(200_000), options).buffer
      .byteLength
  ).toBeGreaterThan(limit);
  const html = highlighter.codeToHtml('[1, 2, 3]', options);
  expect(html.buffer.byteLength).toBeLessThanOrEqual(limit);
  expect(decoder.decode(html)).toBe(
    decoder.decode(
      reference.codeToHtml('[1, 2, 3]', { lang: 'json', theme: pierreDark })
    )
  );
});

// WARNING: A quoted fence streams its body line by line. That is the only
// path through the resume branches that the build drops from a standalone
// lexer, so a wrong drop shows only here.
test.each(Object.entries(languageSamples))(
  'standalone %s matches the combined lexer when streamed',
  async (name, { code }) => {
    const entry = ['tsx', 'javascript', 'jsx'].includes(name)
      ? 'typescript'
      : name;
    const language = await loadLanguage(entry);
    const selective = await createHighlighter({
      langs: [...langs, markdown, language],
      themes: [cssVariables],
    });
    const combined = await combinedPromise;
    const lines = code.split('\n');
    for (const quoted of [
      `> \`\`\`${name}\n${lines.map((line) => `> ${line}\n`).join('')}> \`\`\`\n`,
      `- item\n  \`\`\`${name}\n${lines.map((line) => `  ${line}\n`).join('')}  \`\`\`\n`,
    ]) {
      const options = { lang: 'markdown', theme: cssVariables };
      expect(selective.codeToTokens(quoted, options)).toEqual(
        combined.codeToTokens(quoted, options)
      );
    }
  }
);

test.each(['handlebars', 'jinja', 'liquid', 'twig', 'mermaid'])(
  'standalone %s resumes an embedded region when streamed',
  async (name) => {
    const language = await loadLanguage(name);
    const selective = await createHighlighter({
      langs: [...langs, language],
      themes: [cssVariables],
    });
    const combined = await combinedPromise;
    const body =
      name === 'mermaid'
        ? '---\ntitle: Checkout\n---\nflowchart TD\n  A --> B'
        : '<script>\nconst a = 1;\n</script>\n<style>\na { color: red }\n</style>';
    const code = `> \`\`\`${name}\n${body
      .split('\n')
      .map((line) => `> ${line}\n`)
      .join('')}> \`\`\`\n`;
    const options = { lang: 'markdown', theme: cssVariables };
    const result = selective.codeToTokens(code, options);
    expect(result).toEqual(combined.codeToTokens(code, options));
    expect(
      result.tokens
        .flat()
        .find((token) =>
          token.content.startsWith(name === 'mermaid' ? 'title' : 'const')
        )?.color
    ).toBe(
      name === 'mermaid'
        ? 'var(--hls-property)'
        : 'var(--hls-keyword-declaration)'
    );
  }
);
