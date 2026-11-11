import {
  createHighlighter,
  type HighlighterOptions,
  type Lang,
  type Language,
  type RegisteredHighlighter,
} from '@pierre/highlights';
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

test('standalone language modules embed smaller Wasm and the full bundle embeds one module', () => {
  expect(langs).toHaveLength(1);
  expect(typescript.wasm.length).toBeLessThan(langs[0].wasm.length);
  expect(json.wasm.length).toBeLessThan(typescript.wasm.length);
  for (const language of [typescript, json, html, ...langs]) {
    const bytes = Buffer.from(language.wasm, 'base64');
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

test('the full theme bundle resolves canonical IDs, including accented display names', async () => {
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
    import { createHighlighter } from '@pierre/highlights';
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
  expect(output.includes(typescript.wasm)).toBe(true);
  expect(output.includes(langs[0].wasm)).toBe(false);
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
    const entry = ['ts', 'tsx', 'js', 'jsx'].includes(name)
      ? 'typescript'
      : name;
    const { default: language }: { default: Language } = await import(
      `@pierre/highlights/langs/${entry}`
    );
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
    const { default: language }: { default: Language } = await import(
      `@pierre/highlights/langs/${lang}`
    );
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
    'const style = css`a { color: ${color}; background: red; }`;';
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

test.each(['vue', 'svelte', 'astro', 'mdx'] as const)(
  '%s keeps expression boundaries when TypeScript is not registered',
  async (lang) => {
    const { default: language }: { default: Language } = await import(
      `@pierre/highlights/langs/${lang}`
    );
    const code =
      lang === 'vue'
        ? '<div>{{ value + 1 }}</div>'
        : lang === 'mdx'
          ? 'export const value = {\n\n  count: 1\n}\n\nResult: {value + 1}\n'
          : '<div>{value + 1}</div>';
    const plain = await createHighlighter({
      langs: [language],
      themes: [pierreDark],
    });
    const result = plain.codeToTokens(code, { lang, theme: 'pierre-dark' });
    expect(
      result.tokens.flat().find((token) => token.content.includes('value + 1'))
        ?.color
    ).toBe(result.fg);
    const registered = await createHighlighter({
      langs: [language, typescript],
      themes: [pierreDark],
    });
    expect(
      registered.codeToTokens(code, { lang, theme: 'pierre-dark' })
    ).toEqual(reference.codeToTokens(code, { lang, theme: pierreDark }));
  }
);

test.each([
  ['qml', 'Item { property int value: Math.max(1, 2) }', 'Math.max'],
  ['coffee', 'result = `Math.max(1, 2)`', 'Math.max'],
  ['php', '<div class="box"><?php echo "x"; ?></div>', '<div'],
] as const)(
  '%s leaves unregistered embedded syntax plain',
  async (lang, code, text) => {
    const { default: language }: { default: Language } = await import(
      `@pierre/highlights/langs/${lang}`
    );
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
