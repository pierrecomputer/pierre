import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  spansOf,
  type TestLang,
  tokenKinds,
} from './util';

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

void t.test(
  'diff: file headers keep their marker and color only the path',
  () => {
    assert.deepEqual(
      tokenKinds(
        'diff',
        '--- a/x.txt\n+++ b/x.txt\n--- /dev/null\n+++ /dev/null\n'
      ),
      [
        ['---', 'punctuation.special'],
        ['a/x.txt', 'diff.minus'],
        ['+++', 'punctuation.special'],
        ['b/x.txt', 'diff.plus'],
        ['---', 'punctuation.special'],
        ['/dev/null', 'diff.minus'],
        ['+++', 'punctuation.special'],
        ['/dev/null', 'diff.plus'],
      ]
    );
  }
);

void t.test('diff: every diff command line shape', () => {
  assert.deepEqual(
    tokenKinds(
      'diff',
      'diff --git a/x b/x\ndiff -u a b\ndiff a b\ndiff\ndifference\n'
    ),
    [
      ['diff', 'function'],
      ['--git', 'variable.parameter'],
      ['a/x b/x', null],
      ['diff', 'function'],
      ['-u', 'variable.parameter'],
      ['a b', null],
      ['diff', 'function'],
      ['a', 'variable.parameter'],
      ['b', null],
      ['diff', 'function'],
      // `diff` followed by other letters is not the command
      ['difference', null],
    ]
  );
});

void t.test('diff: index lines with and without a mode', () => {
  assert.deepEqual(
    tokenKinds(
      'diff',
      'index 1a2b3c4..5d6e7f8 100644\nindex 1a2b3c4..5d6e7f8\nindex abc\nindex\n'
    ),
    [
      ['index', 'keyword'],
      ['1a2b3c4', 'constant'],
      ['..', 'punctuation.special'],
      ['5d6e7f8', 'constant'],
      ['100644', 'number'],
      ['index', 'keyword'],
      ['1a2b3c4', 'constant'],
      ['..', 'punctuation.special'],
      ['5d6e7f8', 'constant'],
      ['index', 'keyword'],
      ['abc', 'constant'],
      ['index', 'keyword'],
    ]
  );
});

void t.test('diff: rename, copy, mode, binary, and similarity metadata', () => {
  assert.deepEqual(
    tokenKinds(
      'diff',
      'rename from a\nrename to b\ncopy from a\ncopy to b\nnew file mode 100644\ndeleted file mode 100755\nold mode 100644\nnew mode 100755\nBinary files a and b differ\nsimilarity index 88%\n'
    ),
    [
      ['rename from a', 'label'],
      ['rename to b', 'label'],
      ['copy from a', 'label'],
      ['copy to b', 'label'],
      ['new file mode', 'label'],
      ['100644', 'number'],
      ['deleted file mode', 'label'],
      ['100755', 'number'],
      ['old mode', 'label'],
      ['100644', 'number'],
      ['new mode', 'label'],
      ['100755', 'number'],
      ['Binary files a and b differ', 'label'],
      ['similarity index', 'label'],
      ['88%', 'number'],
    ]
  );
});

void t.test('diff: hunk headers keep their function context', () => {
  assert.deepEqual(
    tokenKinds('diff', '@@ -1,4 +1,5 @@ int main()\n@@@ -1 -1 +1 @@@\n@@\n'),
    [
      ['@@ -1,4 +1,5 @@ int main()', 'attribute'],
      ['@@@ -1 -1 +1 @@@', 'attribute'],
      ['@@', 'attribute'],
    ]
  );
});

void t.test(
  'diff: payload lines, empty markers, and the no-newline note',
  () => {
    assert.deepEqual(
      tokenKinds(
        'diff',
        '+added\n-removed\n context\n+\n-\n\\ No newline at end of file\nplain\n'
      ),
      [
        ['+', 'punctuation.special'],
        ['added', 'diff.plus'],
        ['-', 'punctuation.special'],
        ['removed', 'diff.minus'],
        ['context', null],
        ['+', 'punctuation.special'],
        ['-', 'punctuation.special'],
        ['\\ No newline at end of file', null],
        ['plain', null],
      ]
    );
  }
);

void t.test('diff: CRLF terminators and commit headers', () => {
  assert.deepEqual(
    tokenKinds('diff', '# note\r\n+\r\n-x\r\ncommit abc\r\nAuthor: x\r\n'),
    [
      ['# note', 'comment'],
      ['+', 'punctuation.special'],
      ['-', 'punctuation.special'],
      ['x', 'diff.minus'],
      ['commit abc', null],
      ['Author: x', null],
    ]
  );
});

void t.test('diff: every line kind streams line-fed', () => {
  assertLineFedParity(
    'diff',
    'diff --git a/x b/x\nsimilarity index 88%\nrename from a\nrename to b\nindex 1a2b3c4..5d6e7f8 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ fn\n ctx\n-old\n+new\n\\ No newline at end of file\n# comment\nBinary files a and b differ\n'
  );
  assertLineFedParity('diff', '+one\r\n-two\r\n three\r\n');
});

void t.test('diff: malformed and bounded ranges stay lossless', () => {
  for (const src of [
    '',
    '+',
    '-',
    '@@',
    'é\n+日',
    '\r\n+++',
    'diff --git',
    'index',
    'index ..',
    'similarity index',
    'new file mode',
    '--- ',
    '+++',
    '\\',
  ]) {
    checkInvariants(diff.hl, src);
  }
  const split = loadLang('diff', '$hlDiff', 3);
  checkInvariants(split.hl, '+é\n-rest');
});
