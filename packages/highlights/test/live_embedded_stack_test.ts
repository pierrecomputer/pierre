import assert from 'node:assert';
import t from 'node:test';

import { codeToTokens, LiveTokenizer } from '../lib/index';
import { distinctTheme, initFullModule } from './_util';

t.before(initFullModule);

void t.test(
  'LiveTokenizer: edits restore JSON stacks inside nested fences',
  () => {
    for (const lang of ['markdown', 'mdx'] as const) {
      for (const depth of [0, 1, 3, 7]) {
        const outer = Array.from({ length: depth }, (_, i) =>
          '`'.repeat(depth - i + 3)
        );
        const lines = [
          ...outer.map((fence) => fence + lang),
          '```json',
          '{',
          ' "first": {',
          '   "a": 1,',
          '   "b": 2',
          ' },',
          ' "second": [1]',
          '}',
          '```',
          ...outer.toReversed(),
        ];
        const live = new LiveTokenizer({
          lang,
          theme: distinctTheme,
          code: lines.join('\n'),
        });
        try {
          for (const value of ['3', '1']) {
            live.applyEdits([
              {
                range: {
                  start: { line: depth + 3, character: 8 },
                  end: { line: depth + 3, character: 9 },
                },
                newText: value,
              },
            ]);
            lines[depth + 3] = `   "a": ${value},`;
            const code = lines.join('\n');
            assert.equal(live.getText(), code);
            const fresh = codeToTokens(code, {
              lang,
              theme: distinctTheme,
            }).tokens;
            let offset = 0;
            for (let line = 0; line < lines.length; line++) {
              assert.deepEqual(
                live.getLineTokens(line).tokens,
                fresh[line].map((token) => ({
                  ...token,
                  offset: token.offset - offset,
                })),
                `${lang}, depth ${depth}, line ${line}`
              );
              offset += lines[line].length + 1;
            }
          }
        } finally {
          live.dispose();
        }
      }
    }
  }
);

void t.test(
  'LiveTokenizer: JSON fence stacks survive comments and full templates',
  () => {
    for (const code of [
      [
        '```jsonc',
        '{',
        ' "first": {',
        ' "a":1, /* open',
        ' comment',
        ' */ "b":2',
        ' }, "second":[1]',
        '}',
        '```',
      ].join('\n'),
      [
        '```ts',
        '`x${'.repeat(256),
        '```',
        '```json',
        '['.repeat(1023) + '{',
        ' "a":1,',
        ' "b":2',
        '}' + ']'.repeat(1023),
        '['.repeat(1024) + ']'.repeat(1024),
        '```',
        '```ts',
        '`y${'.repeat(256),
        '```',
      ].join('\n'),
    ]) {
      const options = { lang: 'markdown', theme: distinctTheme } as const;
      const live = new LiveTokenizer({ ...options, code });
      const lines = code.split('\n');
      const line = lines.findIndex((text) => text.includes('"a":1'));
      const character = lines[line].indexOf('1');
      live.applyEdits([
        {
          range: {
            start: { line, character },
            end: { line, character: character + 1 },
          },
          newText: '3',
        },
      ]);
      const expected = code.replace('"a":1', '"a":3');
      const fresh = new LiveTokenizer({ ...options, code: expected });
      try {
        assert.equal(live.getText(), expected);
        for (let i = 0; i < live.lineCount; i++) {
          assert.deepEqual(live.getLineTokens(i), fresh.getLineTokens(i));
        }
      } finally {
        live.dispose();
        fresh.dispose();
      }
    }
  }
);
