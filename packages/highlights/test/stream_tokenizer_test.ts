import assert from 'node:assert';
import t from 'node:test';

import type { CodeToTokensOptions, ThemedToken } from '../lib/index';
import { codeToTokens, StreamTokenizer } from '../lib/index';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { tokenizerSamples } from './_samples';
import { initFullModule, makeRand } from './_util';

t.before(initFullModule);

/** Join a line's token contents back together. */
const lineText = (tokens: ThemedToken[]) =>
  tokens.map((token) => token.content).join('');

void t.test(
  'StreamTokenizer: emits completed lines and buffers the final line',
  () => {
    const options = { lang: 'ts', theme: pierreDark } as const;
    const expected = codeToTokens('let x = 1\r\n"é🙂"\nlast\r', options).tokens;
    const stream = new StreamTokenizer(options);
    assert.deepEqual(stream.pushCode('let x = 1\r'), []);
    assert.deepEqual(stream.pushCode(''), []);
    assert.deepEqual(stream.pushCode('\n"é'), [expected[0]]);
    assert.deepEqual(stream.pushCode('🙂"\nlast\r'), [expected[1]]);
    assert.deepEqual(stream.end(), [expected[2]]);
  }
);

void t.test(
  'StreamTokenizer: every UTF-16 split preserves terminators and surrogates',
  () => {
    const options = { lang: 'ts', theme: pierreDark } as const;
    for (const code of [
      '',
      '\n',
      '\r',
      '\r\n',
      '\n\n',
      'a\r\n\nb\r',
      '"é🙂"\r\n// 𝛼\n',
      '"\ud800"\n\udc00',
      'x\ud800',
    ]) {
      const expected = codeToTokens(code, options).tokens;
      for (let at = 0; at <= code.length; at++) {
        const stream = new StreamTokenizer(options);
        const actual = [
          ...stream.pushCode(''),
          ...stream.pushCode(code.slice(0, at)),
          ...stream.pushCode(''),
          ...stream.pushCode(code.slice(at)),
          ...stream.pushCode(''),
          ...stream.end(),
        ];
        assert.deepEqual(actual, expected, `${JSON.stringify(code)} at ${at}`);
      }
    }
  }
);

void t.test(
  'StreamTokenizer: interleaved streams retain their own language and theme',
  () => {
    const leftOptions = { lang: 'ts', theme: pierreDark } as const;
    const rightOptions = { lang: 'json', theme: pierreLight } as const;
    const leftCode = '/* open\nstill */ const x = "🙂";\n';
    const rightCode = '{\n  "key": true\n}\n';
    const left = new StreamTokenizer(leftOptions);
    const right = new StreamTokenizer(rightOptions);
    const leftTokens = left.pushCode('/* open\n');
    const rightTokens = right.pushCode('{\n');
    const expectedLeft = codeToTokens(leftCode, leftOptions).tokens;
    const expectedRight = codeToTokens(rightCode, rightOptions).tokens;
    leftTokens.push(
      ...left.pushCode('still */ const x = "🙂";\n'),
      ...left.end()
    );
    rightTokens.push(...right.pushCode('  "key": true\n}\n'), ...right.end());
    assert.deepEqual(leftTokens, expectedLeft);
    assert.deepEqual(rightTokens, expectedRight);
  }
);

void t.test(
  'StreamTokenizer: preserves font styles and multiple theme properties',
  () => {
    const theme = {
      name: 'styled',
      appearance: 'dark',
      style: {
        syntax: {
          comment: { color: '#123456', font_style: 'italic', font_weight: 700 },
        },
      },
    };
    const code = '/* one\ntwo */\nconst x = 1;\n';
    const variants: CodeToTokensOptions[] = [
      { lang: 'ts', theme },
      {
        lang: 'ts',
        themes: { dark: theme, light: pierreLight },
        defaultColor: false,
        cssVariablePrefix: '--test-',
      },
    ];
    for (const options of variants) {
      const stream = new StreamTokenizer(options);
      const actual = [
        ...stream.pushCode('/* one\n'),
        ...stream.pushCode('two */\nconst x = 1;\n'),
        ...stream.end(),
      ];
      assert.deepEqual(actual, codeToTokens(code, options).tokens);
      for (const line of actual.slice(0, 2)) {
        assert.equal(line[0].type, 1);
        if (options.theme !== undefined) {
          assert.equal(line[0].color, '#123456');
          assert.equal(line[0].fontStyle, 3);
        } else {
          assert.equal(line[0].htmlStyle?.['--test-dark'], '#123456');
          assert.equal(line[0].htmlStyle?.['--test-dark-font-style'], 'italic');
          assert.equal(line[0].htmlStyle?.['--test-dark-font-weight'], '700');
        }
      }
    }
  }
);

void t.test(
  'StreamTokenizer: chunked output matches codeToTokens (fuzz)',
  () => {
    const rand = makeRand(0x51ed2701);
    for (const [lang, code] of tokenizerSamples) {
      const direct = codeToTokens(code, { lang, theme: pierreDark }).tokens;
      for (let round = 0; round < 16; round++) {
        const stream = new StreamTokenizer({ lang, theme: pierreDark });
        const streamed: ThemedToken[][] = [];
        let at = 0;
        while (at < code.length) {
          const step = 1 + (rand() % 9);
          streamed.push(...stream.pushCode(code.slice(at, at + step)));
          at += step;
        }
        streamed.push(...stream.end());
        assert.deepEqual(streamed, direct, `${lang} round ${round}`);
      }
    }
  }
);

void t.test('StreamTokenizer: empty stream yields one empty line', () => {
  const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
  assert.deepEqual(stream.pushCode(''), []);
  assert.deepEqual(stream.end(), [[]]);
  assert.throws(() => stream.pushCode('next'), /stream has ended/);
  assert.throws(() => stream.end(), /stream has ended/);
});

void t.test('StreamTokenizer: dispose abandons the stream', () => {
  const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
  stream.pushCode('/* open\nbuffered');
  stream.dispose();
  assert.throws(() => stream.pushCode('next'), /stream has ended/);
  assert.throws(() => stream.end(), /stream has ended/);
  stream.dispose(); // idempotent

  const next = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
  const code = 'const x = 1\n';
  assert.deepEqual(
    [...next.pushCode(code), ...next.end()],
    codeToTokens(code, { lang: 'ts', theme: pierreDark }).tokens
  );
});

void t.test('StreamTokenizer: ASCII resumed after a multi-byte line', () => {
  // the resumed byte offset (3 for `é\n`) exceeds the char offset (2); the
  // ASCII fast path must not treat record byte ends as string offsets
  const code = 'é\nconst x = 1\n';
  const direct = codeToTokens(code, { lang: 'ts', theme: pierreDark }).tokens;
  const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
  const streamed = [
    ...stream.pushCode('é\n'),
    ...stream.pushCode('const x = 1\n'),
  ];
  streamed.push(...stream.end());
  assert.deepEqual(streamed, direct);
  assert.equal(lineText(streamed[1]), 'const x = 1');
});

void t.test('StreamTokenizer: surrogate pair split across chunks', () => {
  const code = 'const s = "🎈"\nlet x = 1\n';
  const direct = codeToTokens(code, { lang: 'ts', theme: pierreDark }).tokens;
  const [high, low] = ['🎈'[0], '🎈'[1]];
  const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
  const streamed = [
    ...stream.pushCode(`const s = "${high}`),
    ...stream.pushCode(`${low}"\nlet x = 1\n`),
    ...stream.end(),
  ];
  assert.deepEqual(streamed, direct);
});
