import assert from 'node:assert/strict';
import test from 'node:test';

import { createHtmlRenderer } from '../dist/html.js';

void test('retained open-fence updates keep the options used to render them', () => {
  const source = 'First\n\n```text\nhello';
  const renderer = createHtmlRenderer({ controls: false });
  const before = renderer.render(source, true, true);
  const expected = createHtmlRenderer({ controls: false }).render(
    source,
    true,
    true
  ).html;

  renderer.configure({ controls: true });
  const after = renderer.render(source, true, true);
  assert.match(after.html, /data-code-action="copy"/);
  assert.equal(before.html, expected);
  assert.equal(before.stable + before.pending, expected);
  assert.equal(before.code?.pending, before.pending);
  renderer.dispose();
});

void test('retained fence appends keep their render options after reconfiguration', () => {
  for (const controls of [false, true]) {
    const renderer = createHtmlRenderer({ controls });
    renderer.render('```text\nhello', true, true);
    const source = '```text\nhello world\nnext';
    const before = renderer.render(source, true, true);
    const reference = createHtmlRenderer({ controls });
    const expected = reference.render(source, true, true).html;
    reference.dispose();

    renderer.configure({ controls: !controls });
    renderer.render(source, true, true);
    assert.equal(before.html, expected);
    assert.equal(before.stable + before.pending, expected);
    assert.equal(before.code?.pending, before.pending);
    renderer.dispose();
  }
});

void test('a failed highlighter disposal clears the live session before retry', () => {
  let disposed = 0;
  const renderer = createHtmlRenderer({
    plugins: {
      code: {
        highlight: () => null,
        createSession: () => ({
          highlight: () => null,
          dispose() {
            disposed++;
            if (disposed === 1) throw new Error('Disposal failed once');
          },
        }),
      },
    },
  });

  renderer.render('```text\nhello', true, true);
  assert.throws(() => renderer.dispose(), /Disposal failed once/);
  renderer.dispose();
  assert.equal(disposed, 1);
  renderer.render('```text\nhello world', true, true);
  renderer.dispose();
  assert.equal(disposed, 2);
});

// Wasm writes the final markup. Options that need JavaScript take other paths
// through the same output: a URL hook gets unchecked URLs, and plugins and
// filters get code blocks in slots. Each path must give the same HTML.
const formatPaths = [
  { urlTransform: (url: string) => url },
  { plugins: { code: { highlight: () => null } } },
  { disallowedElements: [] },
];

void test('Wasm URL rules match the URL hook path', () => {
  const urls = [
    'javascript:alert(1)',
    'JaVaScRiPt:x',
    'java&#115;cript:x',
    "java'script:x",
    "it's",
    "https://e.com/it's?a=1&b='2'",
    'data:text/html,x',
    'http://a',
    'HtTpS://a:80/p',
    'MAILTO:a@b',
    'mailto:a:b',
    'http:x:y',
    'tel:+1',
    'tel',
    'ftp://x',
    'xmpp:a@b',
    ':x',
    'a:',
    'a/b:c',
    '?a:b',
    '#a:b',
    '//evil.test',
    '/\\evil',
    '<\\\\evil>',
    '',
    '<a b:c>',
    'a&amp;b:c',
    'h&#116;tp:x',
    'é:x',
  ];
  const source = urls
    .map(
      (url) =>
        `[x](${url} "t") ![y](${url}) [![z](${url})](/ok) <${url}> ${url}`
    )
    .join('\n\n');
  const expected = createHtmlRenderer(formatPaths[0]).render(source, false);
  const actual = createHtmlRenderer().render(source, false);
  assert.equal(actual.html, expected.html);
  assert.doesNotMatch(actual.html, /(?:href|src)="(?:javascript|data|\/\/)/i);
});

void test('every format path writes the same code blocks', () => {
  const lines = (count: number): string =>
    Array.from({ length: count }, (_, at) => `line ${at} <&"'>`).join('\n');
  const source = [
    '```ts\n' + lines(64) + '\n```',
    "``` it's&amp;\n" + lines(65) + '\n```',
    '~~~\n' + lines(129) + '\n~~~',
    '```\n```',
    '    indented\n\n    code',
    '- item\n  ```js\n  ' + lines(3).replaceAll('\n', '\n  ') + '\n  ```',
    'x[^1]\n\n[^1]: note\n\n    ```\n    ' + lines(2) + '\n    ```',
    '> ```js\n> open',
  ].join('\n\n');
  for (const base of [
    {},
    { controls: false, lineNumbers: false },
    { controls: { code: { copy: false } }, idPrefix: 'p"é-' },
  ]) {
    for (const active of [false, true]) {
      const expected = createHtmlRenderer(base).render(source, active, active);
      assert.doesNotMatch(expected.html, /\0/);
      assert.equal(expected.stable + expected.pending, expected.html);
      for (const path of formatPaths) {
        const actual = createHtmlRenderer({ ...base, ...path }).render(
          source,
          active,
          active
        );
        assert.equal(actual.html, expected.html);
      }
    }
  }
});

void test('a streamed open fence matches a full render in every format path', () => {
  const source =
    'Intro [a](/b)\n\n```js\nlet a = "1";\n\nlet b = 2;\n```\n\n- x\n  ```\n  nested\n  open';
  for (const path of [{}, ...formatPaths]) {
    const renderer = createHtmlRenderer(path);
    for (let end = 1; end <= source.length; end++) {
      const update = renderer.render(source.slice(0, end), true, true);
      const expected = createHtmlRenderer(path).render(
        source.slice(0, end),
        true,
        true
      );
      assert.doesNotMatch(update.html, /\0/);
      assert.equal(update.html, expected.html);
    }
    renderer.dispose();
  }
});

void test('an id prefix that does not fit Wasm memory throws', () => {
  const renderer = createHtmlRenderer({ idPrefix: 'p'.repeat(4097) });
  assert.throws(() => renderer.render('x[^1]\n\n[^1]: y', false), RangeError);
  const fits = createHtmlRenderer({ idPrefix: 'p'.repeat(4096) });
  assert.match(
    fits.render('x[^1]\n\n[^1]: y', false).html,
    / id="p{4096}fn-1"/
  );
});
