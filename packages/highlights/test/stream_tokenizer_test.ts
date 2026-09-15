import assert from 'node:assert';
import t from 'node:test';

import type { CodeToTokensOptions, ThemedToken } from '../lib/index';
import { codeToTokens, StreamTokenizer } from '../lib/index';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { tokenizerSamples } from './_samples';
import { initFullModule, makeRand } from './_util';

t.before(initFullModule);

const encoder = new TextEncoder();

/** Join a line's token contents back together. */
const lineText = (tokens: ThemedToken[]) =>
  tokens.map((token) => token.content).join('');

void t.test(
  'StreamTokenizer: pipeThrough decodes UTF-8 bytes and flushes on close',
  async () => {
    const options = {
      lang: 'ts',
      themes: { dark: pierreDark, light: pierreLight },
    } as const;
    for (const input of [
      ...[
        '',
        '\n',
        '/* é€🙂\r\nstill */\nlast',
        'const x = 1\n',
        '\ufefflet x = 1\n',
      ].map((code) => encoder.encode(code)),
      new Uint8Array([0xe2, 0x82]), // Incomplete UTF-8 at the end of the stream.
      new Uint8Array([0x61, 0xff, 0x0a, 0xf0, 0x9f]), // Invalid and incomplete UTF-8.
    ]) {
      const stream = new StreamTokenizer(options);
      assert.ok(stream instanceof TransformStream);
      const source = new ReadableStream<Uint8Array>({
        start(controller) {
          // Split multi-byte UTF-8 characters and CRLF, including empty chunks.
          for (let i = 0; i < input.length; i++) {
            controller.enqueue(input.subarray(i, i + 1));
            controller.enqueue(new Uint8Array());
          }
          controller.close();
        },
      });
      const actual: ThemedToken[][] = [];
      for await (const line of source.pipeThrough(stream)) actual.push(line);
      assert.deepEqual(actual, codeToTokens(input, options).tokens);
      assert.throws(() => stream.pushCode('next'), /stream has ended/);
      assert.throws(() => stream.end(), /stream has ended/);
    }
  }
);

void t.test(
  'StreamTokenizer: writable waits for reads and emits completed lines',
  async () => {
    const options = { lang: 'ts', theme: pierreDark } as const;
    const expected = codeToTokens('const x = 1\nlast', options).tokens;
    const stream = new StreamTokenizer(options);
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let written = false;
    const writing = writer
      .write(encoder.encode('const x = 1\nlast'))
      .then(() => {
        written = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(written, false);
    assert.deepEqual(await reader.read(), { value: expected[0], done: false });
    await writing;
    const closing = writer.close();
    assert.deepEqual(await reader.read(), { value: expected[1], done: false });
    assert.deepEqual(await reader.read(), { value: undefined, done: true });
    await closing;
  }
);

void t.test(
  'StreamTokenizer: cancellation and abort discard buffered code',
  async () => {
    const options = { lang: 'ts', theme: pierreDark } as const;
    for (const cancelReadable of [true, false]) {
      const stream = new StreamTokenizer(options);
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const reason = new Error('stop tokenizing');
      const reading = reader.read();
      const result = cancelReadable
        ? reading.then((value) => assert.equal(value.done, true))
        : assert.rejects(reading, reason);
      const closed = assert.rejects(writer.closed, reason);
      await writer.write(encoder.encode('/* buffered'));
      await writer.write(new Uint8Array([0xf0, 0x9f]));
      if (cancelReadable) await reader.cancel(reason);
      else await writer.abort(reason);
      await Promise.all([result, closed]);
      assert.throws(() => stream.pushCode('next'), /stream has ended/);
      assert.throws(() => stream.end(), /stream has ended/);
      stream.dispose();
    }
    const next = new StreamTokenizer(options);
    assert.deepEqual(next.end(), codeToTokens('', options).tokens);
  }
);

void t.test(
  'StreamTokenizer: pushCode accepts UTF-8 bytes at every split',
  () => {
    const options = { lang: 'ts', theme: pierreDark } as const;
    for (const input of [
      encoder.encode(''),
      encoder.encode('\ufeff/* é€🙂\r\nstill */\nlast'),
      encoder.encode('const x = 1\n'),
      new Uint8Array([0x61, 0xff, 0x0a, 0xf0, 0x9f]),
    ]) {
      const expected = codeToTokens(input, options).tokens;
      for (let at = 0; at <= input.length; at++) {
        const stream = new StreamTokenizer(options);
        const actual = [
          ...stream.pushCode(input.subarray(0, at)),
          ...stream.pushCode(''),
          ...stream.pushCode(new Uint8Array()),
          ...stream.pushCode(input.subarray(at)),
          ...stream.end(),
        ];
        assert.deepEqual(actual, expected, `byte split at ${at}`);
        assert.throws(() => stream.pushCode(input), /stream has ended/);
      }
    }
  }
);

void t.test(
  'StreamTokenizer: mixed strings and bytes preserve chunk order',
  () => {
    const options = { lang: 'ts', theme: pierreDark } as const;
    const cases: { chunks: (string | Uint8Array)[]; code: string }[] = [
      {
        chunks: [
          '/* ',
          encoder.encode('é🙂'),
          '\r',
          encoder.encode('\nstill */\n'),
          'last',
        ],
        code: '/* é🙂\r\nstill */\nlast',
      },
      {
        chunks: [new Uint8Array([0xe2]), 'x\n', new Uint8Array([0x82, 0xac])],
        code: '\ufffdx\n\ufffd\ufffd',
      },
      {
        chunks: ['"\ud83d', encoder.encode('x'), '\ude42"\n'],
        code: '"\ud83dx\ude42"\n',
      },
      {
        chunks: ['"\ud83d', new Uint8Array([0xf0, 0x9f])],
        code: '"\ud83d\ufffd',
      },
    ];
    for (const { chunks, code } of cases) {
      const stream = new StreamTokenizer(options);
      const actual: ThemedToken[][] = [];
      for (const chunk of chunks) actual.push(...stream.pushCode(chunk));
      actual.push(...stream.end());
      assert.deepEqual(actual, codeToTokens(code, options).tokens);
    }
  }
);

void t.test('StreamTokenizer: buffered bytes survive caller mutation', () => {
  const options = { lang: 'ts', theme: pierreDark } as const;
  const code = '/* é🙂\nstill */\nlast';
  for (const split of [false, true]) {
    const stream = new StreamTokenizer(options);
    const first = encoder.encode(split ? '/* é' : '');
    const second = encoder.encode(split ? '🙂\nstill' : '/* é🙂\nstill');
    const actual = stream.pushCode(first);
    first.fill(0);
    actual.push(...stream.pushCode(second));
    second.fill(0);
    actual.push(
      ...stream.pushCode(encoder.encode(' */\nlast')),
      ...stream.end()
    );
    assert.deepEqual(actual, codeToTokens(code, options).tokens);
  }
});

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
        const input = round % 2 === 0 ? code : encoder.encode(code);
        const stream = new StreamTokenizer({ lang, theme: pierreDark });
        const streamed: ThemedToken[][] = [];
        let at = 0;
        while (at < input.length) {
          const step = 1 + (rand() % 9);
          streamed.push(...stream.pushCode(input.slice(at, at + step)));
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

void t.test(
  'StreamTokenizer: small chunks preserve long unfinished lines',
  () => {
    const options = { lang: 'text', theme: pierreDark } as const;
    const chunk = 'x'.repeat(32);
    const code = chunk.repeat(8192);
    for (const input of [chunk, encoder.encode(chunk)]) {
      for (const terminate of [false, true]) {
        const stream = new StreamTokenizer(options);
        for (let i = 0; i < 8192; i++) {
          assert.deepEqual(stream.pushCode(input), []);
        }
        const suffix = terminate ? '\r\nnext\nlast' : '';
        assert.deepEqual(
          [
            ...stream.pushCode(
              typeof input === 'string' ? suffix : encoder.encode(suffix)
            ),
            ...stream.end(),
          ],
          codeToTokens(code + suffix, options).tokens
        );
      }
    }
  }
);

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
