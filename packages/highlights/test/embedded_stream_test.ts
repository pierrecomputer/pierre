import assert from 'node:assert/strict';
import t from 'node:test';

import type { Lang } from '../lib/index';
import { codeToTokens, LiveTokenizer, StreamTokenizer } from '../lib/index';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { initFullModule } from './_util';

t.before(initFullModule);

void t.test('embedded regions bound resumed comments and strings', () => {
  const samples: [Lang, string][] = [];
  for (const lang of ['html', 'php', 'vue', 'svelte', 'astro'] as const) {
    for (const body of [
      '<style>/* open</style>\n<b>bold</b> text\n',
      '<style>\n/* open\n</style>\n<b>bold</b> text\n',
      '<style>\n/* open\nclosed */ b { color: red }\n</style>\n<b>bold</b>\n',
    ]) {
      samples.push([lang, body]);
      samples.push(['markdown', `\`\`\`${lang}\n${body}\`\`\`\nplain text\n`]);
    }
  }
  samples.push(['markdown', '---\nname: "open\n---\n# heading\n']);
  for (const [lang, code] of samples) {
    const options = { lang, theme: pierreDark };
    const expected = codeToTokens(code, options).tokens;
    const stream = new StreamTokenizer(options);
    const actual = code
      .match(/[^\n]*\n|[^\n]+$/g)!
      .flatMap((line) => stream.pushCode(line));
    actual.push(...stream.end());
    assert.deepEqual(actual, expected, `${lang}: stream ${code}`);
    const live = new LiveTokenizer({ ...options, code });
    try {
      let offset = 0;
      for (let line = 0; line < live.lineCount; line++) {
        assert.deepEqual(
          live.getLineTokens(line).tokens,
          expected[line].map((token) => ({
            ...token,
            offset: token.offset - offset,
          })),
          `${lang}: live line ${line} of ${code}`
        );
        offset += live.getLineLength(line) + 1;
      }
    } finally {
      live.dispose();
    }
  }
});
