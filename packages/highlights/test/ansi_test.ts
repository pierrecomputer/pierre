import assert from 'node:assert/strict';
import t from 'node:test';
import { createHighlighter } from 'shiki';

import {
  codeToHtml,
  codeToTokens,
  isSupportedLanguage,
  LiveTokenizer,
  StreamTokenizer,
  type Theme,
  type ThemedToken,
} from '../lib/index';
import { ansiNames, isThemeColor } from '../lib/theme';
import * as themes from '../themes/index';
import { initFullModule, makeRand, textOf } from './_util';

const decoder = new TextDecoder();
const { cssVariables, toCSS } = themes;
const palette = ansiNames.map(
  (_, i) => `#${(0x102030 + i * 0x0a0b0c).toString(16)}`
);
const theme: Theme = {
  name: 'ANSI',
  appearance: 'dark',
  style: {
    'editor.foreground': '#fafafa',
    'editor.background': '#0a0a0a',
    ...Object.fromEntries(
      ansiNames.map((name, i) => [`terminal.ansi.${name}`, palette[i]])
    ),
  },
};
const light: Theme = {
  name: 'ANSI Light',
  appearance: 'light',
  style: {
    'editor.foreground': '#111111',
    'editor.background': '#ffffff',
    'terminal.ansi.red': '#aa0000',
  },
};

t.before(initFullModule);

/** Visible runs with merged equal styles, without offsets. */
function runs(lines: ThemedToken[][]) {
  return lines.map((line) => {
    const merged: [string, string?, string?, number?][] = [];
    for (const { content, color, bgColor, fontStyle } of line) {
      const prev = merged.at(-1);
      if (
        prev !== undefined &&
        prev[1] === color &&
        prev[2] === bgColor &&
        prev[3] === fontStyle
      ) {
        prev[0] += content;
      } else merged.push([content, color, bgColor, fontStyle]);
    }
    return merged;
  });
}

void t.test('ansi: supported in any case', () => {
  assert.ok(isSupportedLanguage('ansi'));
  assert.ok(isSupportedLanguage('ANSI'));
});

void t.test('ansi: SGR styles match Shiki', async () => {
  const shiki = await createHighlighter({
    langs: [],
    themes: [
      {
        name: 'ansi-parity',
        type: 'dark',
        colors: {
          'editor.foreground': '#fafafa',
          'editor.background': '#0a0a0a',
          ...Object.fromEntries(
            ansiNames.map((name, i) => [
              `terminal.ansi${name
                .split('_')
                .map((part) => part[0].toUpperCase() + part.slice(1))
                .join('')}`,
              palette[i],
            ])
          ),
        },
        tokenColors: [],
      },
    ],
  });
  // Shiki applies resets before other codes in one sequence, so the fuzz
  // sends one attribute per sequence.
  const codes = [
    ...['0', '1', '2', '3', '4', '7', '9', '21', '22', '23', '24', '27'],
    ...['29', '39', '49', '38;5;3', '48;5;200', '38;5;250', '38;2;300;7;9'],
    ...['48;2;1;2;3', '31', '37', '42', '93', '106'],
  ];
  const rand = makeRand(0x0a751);
  for (let n = 0; n < 300; n++) {
    let code = '';
    for (let i = rand() % 24; i > 0; i--) {
      const r = rand() % 10;
      code +=
        r < 5
          ? `\x1b[${codes[rand() % codes.length]}m`
          : r < 8
            ? 'ab<'.slice(0, (rand() % 3) + 1)
            : r < 9
              ? '\n'
              : '\r\n';
    }
    const expected = shiki.codeToTokens(code, {
      lang: 'ansi',
      theme: 'ansi-parity',
    }).tokens;
    const actual = codeToTokens(code, { lang: 'ansi', theme }).tokens;
    assert.deepEqual(runs(actual), runs(expected), JSON.stringify(code));
  }
  shiki.dispose();
});

void t.test('ansi: escape sequences are removed from tokens', () => {
  const code =
    'a\x1b[31mb\x1b[mc\x1b[2K\x1b(B\x1b]8;;https://x.dev\x1b\\d\x1b]0;t\x07' +
    '\x1b[>4;2me\x1b\r\nf\x1b';
  const { tokens } = codeToTokens(code, { lang: 'ansi', theme });
  assert.deepEqual(
    tokens.map((line) =>
      line.map(({ content, offset, color }) => [content, offset, color])
    ),
    [
      [
        ['a', 0, '#fafafa'],
        ['b', 6, palette[1]],
        ['cde\x1b', 10, '#fafafa'],
      ],
      [['f\x1b', code.indexOf('f'), '#fafafa']],
    ]
  );
});

void t.test('ansi: themes without terminal colors use the defaults', () => {
  const { tokens } = codeToTokens('\x1b[31ma\x1b[94mb', {
    lang: 'ansi',
    theme: { ...theme, style: { 'editor.foreground': '#fafafa' } },
  });
  assert.deepEqual(
    tokens[0].map((token) => token.color),
    ['#cd3131', '#3b8eea']
  );
});

void t.test('ansi: multiple themes use htmlStyle', () => {
  const code = '\x1b[31;1;4ma\x1b[0;7mb';
  const { tokens } = codeToTokens(code, {
    lang: 'ansi',
    themes: { dark: theme, light },
  });
  assert.deepEqual(
    tokens[0].map((token) => token.htmlStyle),
    [
      {
        color: '#aa0000',
        'font-weight': 'bold',
        'text-decoration': 'underline',
        '--hls-dark': palette[1],
        '--hls-dark-font-weight': 'bold',
        '--hls-dark-text-decoration': 'underline',
      },
      {
        color: '#ffffff',
        'background-color': '#111111',
        '--hls-dark': '#0a0a0a',
        '--hls-dark-bg': '#fafafa',
      },
    ]
  );
  const lightDark = codeToTokens(code, {
    lang: 'ansi',
    themes: { dark: theme, light },
    defaultColor: 'light-dark()',
  }).tokens[0].map((token) => token.htmlStyle);
  assert.deepEqual(lightDark[0], {
    color: `light-dark(#aa0000, ${palette[1]})`,
    'font-weight': 'bold',
    'text-decoration': 'underline',
  });
});

void t.test('ansi: CSS-variable themes use the terminal ansi variables', () => {
  const { tokens } = codeToTokens('\x1b[91ma\x1b[2mb', {
    lang: 'ansi',
    theme: cssVariables,
  });
  assert.deepEqual(
    tokens[0].map((token) => token.color),
    [
      'var(--hls-terminal-ansi-bright-red)',
      'color-mix(in srgb, var(--hls-terminal-ansi-bright-red) 50%, transparent)',
    ]
  );
  const css = toCSS(theme);
  assert.ok(css.includes(`--hls-terminal-ansi-red: ${palette[1]};`));
  assert.ok(css.includes(`--hls-terminal-ansi-bright-white: ${palette[15]};`));
});

for (const [name, theme] of Object.entries(themes)) {
  if (typeof theme !== 'object' || theme === cssVariables) continue;
  void t.test(`ansi: ${name} uses all 16 theme colors`, () => {
    const colors = ansiNames.map((name) => {
      const value = theme.style[`terminal.ansi.${name}`];
      assert.ok(isThemeColor(value), `${name}: missing terminal color`);
      return value
        .trim()
        .toLowerCase()
        .replace(/^(#[0-9a-f]{6})ff$/, '$1');
    });
    const code = colors
      .map(
        (_, i) =>
          `\x1b[${i < 8 ? 30 + i : 90 + i - 8};${i < 8 ? 40 + i : 100 + i - 8}mdirect-${i}\n` +
          `\x1b[38;5;${i};48;5;${i}mindexed-${i}\n`
      )
      .join('');
    const options = { lang: 'ansi', theme } as const;
    const { tokens } = codeToTokens(code, options);
    assert.deepEqual(
      tokens.flat().map(({ color, bgColor }) => [color, bgColor]),
      colors.flatMap((color) => [
        [color, color],
        [color, color],
      ])
    );
    const html = decoder.decode(codeToHtml(code, options));
    const css = toCSS(theme, { cssVariablePrefix: '--term-' });
    for (let i = 0; i < colors.length; i++) {
      for (const label of ['direct', 'indexed']) {
        assert.ok(
          html.includes(
            `<span style="color:${colors[i]};background-color:${colors[i]}">${label}-${i}</span>`
          ),
          `${label}: ${ansiNames[i]}`
        );
      }
      assert.ok(
        css.includes(
          `--term-terminal-ansi-${ansiNames[i].replace('_', '-')}: ${colors[i]};`
        )
      );
    }
    const stream = new StreamTokenizer(options);
    const split = code.indexOf('indexed-8') - 3;
    assert.deepEqual(
      [
        ...stream.pushCode(code.slice(0, split)),
        ...stream.pushCode(code.slice(split)),
        ...stream.end(),
      ],
      tokens
    );
  });
}

void t.test(
  'ansi: CSS palettes use terminal names and configured overrides',
  () => {
    const theme: Theme = {
      name: 'Terminal CSS',
      appearance: 'dark',
      cssVariables: {
        prefix: '--term-',
        defaults: { 'terminal-ansi-red': '#123456', accent: '#654321' },
      },
      style: { 'terminal.ansi.bright_red': 'accent' },
    };
    const code = '\x1b[31;101mred';
    const { tokens } = codeToTokens(code, { lang: 'ansi', theme });
    assert.equal(tokens[0][0].color, 'var(--term-terminal-ansi-red, #123456)');
    assert.equal(tokens[0][0].bgColor, 'var(--term-accent, #654321)');
    const html = decoder.decode(codeToHtml(code, { lang: 'ansi', theme }));
    assert.ok(html.includes('color:var(--term-terminal-ansi-red, #123456)'));
    assert.ok(html.includes('background-color:var(--term-accent, #654321)'));
    const cssOptions = {
      lang: 'ansi',
      theme: cssVariables,
      cssVariablePrefix: '--term-',
    } as const;
    assert.equal(
      codeToTokens(code, cssOptions).tokens[0][0].color,
      'var(--term-terminal-ansi-red)'
    );
    assert.ok(
      decoder
        .decode(codeToHtml(code, cssOptions))
        .includes('background-color:var(--term-terminal-ansi-bright-red)')
    );
  }
);

void t.test('ansi: HTML keeps visible text and line endings', () => {
  const code = 'x \x1b[1;31m<&>\x1b[0m\r\n\n\x1b[42my';
  const html = decoder.decode(codeToHtml(code, { lang: 'ansi', theme }));
  assert.equal(textOf(html), 'x <&>\r\n\ny');
  assert.ok(
    html.startsWith(
      '<pre class="highlights" style="background-color:#0a0a0a;color:#fafafa">'
    )
  );
  assert.ok(
    html.includes(
      `<span style="color:${palette[1]};font-weight:bold">&lt;&amp;&gt;</span>`
    )
  );
  assert.ok(
    html.includes(
      `<span style="color:#fafafa;background-color:${palette[2]}">y`
    )
  );
  const multi = decoder.decode(
    codeToHtml(code, { lang: 'ansi', themes: { dark: theme, light } })
  );
  assert.equal(textOf(multi), 'x <&>\r\n\ny');
  assert.ok(multi.includes(`--hls-dark:${palette[1]};--hls-dark-font-weight`));
});

void t.test('ansi: streams keep SGR state across chunks', () => {
  const code = 'a\x1b[31mb\nc\x1b[1m\r\nd\x1b[0me\n';
  const expected = codeToTokens(code, { lang: 'ansi', theme }).tokens;
  for (let split = 0; split <= code.length; split++) {
    const stream = new StreamTokenizer({ lang: 'ansi', theme });
    const lines = [
      ...stream.pushCode(code.slice(0, split)),
      ...stream.pushCode(new TextEncoder().encode(code.slice(split))),
      ...stream.end(),
    ];
    assert.deepEqual(lines, expected, `split at ${split}`);
  }
});

void t.test('ansi: live documents keep the raw text', () => {
  const live = new LiveTokenizer({ lang: 'ansi', theme, code: '\x1b[31ma' });
  assert.deepEqual(
    live.getLineTokens(0).tokens.map((token) => token.content),
    ['\x1b[31ma']
  );
  live.dispose();
});
