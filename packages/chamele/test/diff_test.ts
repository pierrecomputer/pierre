import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, loadLang, spansOf, type TestLang } from './util';

let diff: TestLang;
t.before(() => (diff = loadLang('diff', '$hlDiff')));

const colors = {
  function: '#110001',
  parameter: '#220002',
  keyword: '#330003',
  constant: '#440004',
  punctuation: '#550005',
  number: '#660006',
  minus: '#770007',
  plus: '#880008',
  attribute: '#990009',
  comment: '#aa000a',
  label: '#bb000b',
};
const theme = {
  name: 'diff-capture-buckets',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: {
      function: { color: colors.function },
      'variable.parameter': { color: colors.parameter },
      keyword: { color: colors.keyword },
      constant: { color: colors.constant },
      'punctuation.special': { color: colors.punctuation },
      number: { color: colors.number },
      'diff.minus': { color: colors.minus },
      'diff.plus': { color: colors.plus },
      attribute: { color: colors.attribute },
      comment: { color: colors.comment },
      label: { color: colors.label },
    },
  },
};

void t.test('diff: Zed capture boundaries for git headers and hunks', () => {
  const src = `diff --git a/src/config.js b/src/config.js
index 1a2b3c4..5d6e7f8 100644
--- a/src/config.js
+++ b/src/config.js
@@ -1,4 +1,5 @@
 export const config = {
-  mode: "slow",
+  mode: "simd",
+  batchSize: 16,
 };
`;
  const spans = spansOf(checkInvariants(diff.hl, src, { theme })).map(
    ({ color, text }) => [text.trim(), color]
  );
  assert.deepEqual(spans, [
    ['diff', colors.function],
    ['--git', colors.parameter],
    ['index', colors.keyword],
    ['1a2b3c4', colors.constant],
    ['..', colors.punctuation],
    ['5d6e7f8', colors.constant],
    ['100644', colors.number],
    ['---', colors.punctuation],
    ['a/src/config.js', colors.minus],
    ['+++', colors.punctuation],
    ['b/src/config.js', colors.plus],
    ['@@ -1,4 +1,5 @@', colors.attribute],
    ['-', colors.punctuation],
    ['mode: "slow",', colors.minus],
    ['+', colors.punctuation],
    ['mode: "simd",', colors.plus],
    ['+', colors.punctuation],
    ['batchSize: 16,', colors.plus],
  ]);
});

void t.test('diff: marker-like content is classified by line start', () => {
  const html = checkInvariants(
    diff.hl,
    '+a\n- b\n++++content\n----content\n context + and -\n',
    { theme }
  );
  const spans = spansOf(html);
  assert.ok(
    spans.some(
      (span) => span.text.trim() === 'content' && span.color === colors.plus
    )
  );
  assert.ok(
    spans.some(
      (span) => span.text.trim() === 'content' && span.color === colors.minus
    )
  );
  assert.ok(
    spans.some(
      (span) => span.text.trim() === '++++' && span.color === colors.punctuation
    )
  );
  assert.ok(
    spans.some(
      (span) => span.text.trim() === '----' && span.color === colors.punctuation
    )
  );
});

void t.test('diff: metadata and comments follow Zed captures', () => {
  const src = `# generated patch
new file mode 100644
deleted file mode 100755
old mode 100644
new mode 100755
rename from src/old.js
rename to src/new.js
Binary files a/image.png and b/image.png differ
similarity index 88%
`;
  const spans = spansOf(checkInvariants(diff.hl, src, { theme }));
  const has = (text: string, color: string | null) =>
    spans.some((span) => span.text.includes(text) && span.color === color);
  assert.ok(has('# generated patch', colors.comment));
  assert.ok(has('new file mode', colors.label));
  assert.ok(has('100644', colors.number));
  assert.ok(has('deleted file mode', colors.label));
  assert.ok(has('rename from src/old.js', colors.label));
  assert.ok(
    has('Binary files a/image.png and b/image.png differ', colors.label)
  );
  assert.ok(has('similarity index', colors.label));
  assert.ok(has('88%', colors.number));
});

void t.test('diff: malformed and bounded ranges stay lossless', () => {
  for (const src of ['', '+', '-', '@@', 'é\n+日', '\r\n+++', 'diff --git']) {
    checkInvariants(diff.hl, src);
  }
  const split = loadLang('diff', '$hlDiff', 3);
  checkInvariants(split.hl, '+é\n-rest');
});
