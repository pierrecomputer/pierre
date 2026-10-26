import assert from 'node:assert';
import test from 'node:test';

import { renderToHtml } from '../dist/node.mjs';

const dec = new TextDecoder();
const html = (md) => dec.decode(renderToHtml(md));

void test('leaf blocks', () => {
  assert.equal(
    html('# Hello, **world**!'),
    '<h1>Hello, <strong>world</strong>!</h1>\n'
  );
  assert.equal(html('Setext\n======'), '<h1>Setext</h1>\n');
  assert.equal(
    html('para one\n\npara two'),
    '<p>para one</p>\n<p>para two</p>\n'
  );
  assert.equal(html('***'), '<hr />\n');
  assert.equal(html('    code'), '<pre><code>code\n</code></pre>\n');
  assert.equal(
    html('```js\nlet x;\n```'),
    '<pre><code class="language-js">let x;\n</code></pre>\n'
  );
  assert.equal(html('<div>\nraw\n</div>'), '<div>\nraw\n</div>\n');
});

void test('container blocks', () => {
  assert.equal(
    html('> quoted'),
    '<blockquote>\n<p>quoted</p>\n</blockquote>\n'
  );
  assert.equal(html('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n');
  assert.equal(
    html('3. a\n4. b'),
    '<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>\n'
  );
  assert.equal(
    html('- a\n\n- b'),
    '<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n',
    'a blank line between items makes the list loose'
  );
  assert.equal(
    html('> - a\n>   - b'),
    '<blockquote>\n<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n</blockquote>\n'
  );
});

void test('inline constructs', () => {
  assert.equal(
    html('*a* **b** ***c***'),
    '<p><em>a</em> <strong>b</strong> <em><strong>c</strong></em></p>\n'
  );
  assert.equal(
    html('。*“foo*'),
    '<p>。<em>“foo</em></p>\n',
    'Unicode punctuation participates in flanking'
  );
  assert.equal(html('`a < b`'), '<p><code>a &lt; b</code></p>\n');
  assert.equal(html('a\\*b\\*'), '<p>a*b*</p>\n');
  assert.equal(html('&amp; &#65; &#x42;'), '<p>&amp; A B</p>\n');
  assert.equal(html('a  \nb'), '<p>a<br />\nb</p>\n');
  assert.equal(
    html('<https://x.test/>'),
    '<p><a href="https://x.test/">https://x.test/</a></p>\n'
  );
  assert.equal(html('<em>raw</em>'), '<p><em>raw</em></p>\n');
});

void test('links and images', () => {
  assert.equal(html('[t](/u)'), '<p><a href="/u">t</a></p>\n');
  assert.equal(html('[t](/u "ti")'), '<p><a href="/u" title="ti">t</a></p>\n');
  assert.equal(
    html("[t][r]\n\n[r]: /u 'ti'"),
    '<p><a href="/u" title="ti">t</a></p>\n'
  );
  assert.equal(html('[t]\n\n[t]: /u'), '<p><a href="/u">t</a></p>\n');
  assert.equal(
    html('![alt](/i.png)'),
    '<p><img src="/i.png" alt="alt" /></p>\n'
  );
  assert.equal(html('![a *b*](/i)'), '<p><img src="/i" alt="a b" /></p>\n');
  assert.equal(
    html('[a](/x?y=1&z=2)'),
    '<p><a href="/x?y=1&amp;z=2">a</a></p>\n'
  );
  assert.equal(html('[a](/ä)'), '<p><a href="/%C3%A4">a</a></p>\n');
});

void test('reference definitions are global and case folded', () => {
  assert.equal(
    html('> [ΑΓΩ]: /u\n\n[αγω]'),
    '<blockquote>\n</blockquote>\n<p><a href="/u">αγω</a></p>\n'
  );
  assert.equal(html('[Foo]\n\n[FOO]: /u'), '<p><a href="/u">Foo</a></p>\n');
  assert.equal(
    html('[x]: /first\n[x]: /second\n\n[x]'),
    '<p><a href="/first">x</a></p>\n'
  );
});

void test('GFM tables', () => {
  assert.equal(
    html('| a | b |\n| - | - |\n| 1 | 2 |'),
    '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n' +
      '<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n'
  );
  assert.match(html('| a |\n| :-: |\n| 1 |'), /<th align="center">a<\/th>/);
  assert.match(
    html('| a | b |\n| - | - |\n| 1 |'),
    /<td>1<\/td>\n<td><\/td>/,
    'short rows are padded'
  );
  assert.match(
    html('| a |\n| - |\n| x \\| y |'),
    /<td>x \| y<\/td>/,
    'escaped pipes stay in the cell'
  );
  assert.equal(
    html('| a |\n| - |'),
    '<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n</table>\n'
  );
});

void test('GFM task lists, strikethrough and autolinks', () => {
  assert.equal(
    html('- [x] done\n- [ ] todo'),
    '<ul>\n<li><input checked="" disabled="" type="checkbox"> done</li>\n' +
      '<li><input disabled="" type="checkbox"> todo</li>\n</ul>\n'
  );
  assert.equal(html('~~gone~~'), '<p><del>gone</del></p>\n');
  assert.equal(html('a ~~~not~~~ b'), '<p>a ~~~not~~~ b</p>\n');
  assert.equal(
    html('www.example.com'),
    '<p><a href="http://www.example.com">www.example.com</a></p>\n'
  );
  assert.equal(
    html('https://x.test/p'),
    '<p><a href="https://x.test/p">https://x.test/p</a></p>\n'
  );
  assert.equal(
    html('a@b.test'),
    '<p><a href="mailto:a@b.test">a@b.test</a></p>\n'
  );
  assert.equal(
    html('<script>x</script>'),
    '&lt;script>x&lt;/script>\n',
    'the tagfilter escapes script'
  );
});

void test('GFM footnotes', () => {
  assert.equal(
    html('a[^1]\n\n[^1]: note'),
    '<p>a<sup class="footnote-ref"><a href="#fn-1" id="fnref-1" data-footnote-ref>1</a></sup></p>\n' +
      '<section class="footnotes" data-footnotes>\n<ol>\n<li id="fn-1">\n' +
      '<p>note <a href="#fnref-1" class="footnote-backref" data-footnote-backref ' +
      'data-footnote-backref-idx="1" aria-label="Back to reference 1">\u21a9</a></p>\n' +
      '</li>\n</ol>\n</section>\n'
  );
  assert.equal(
    html('[^x]: only a definition'),
    '',
    'an unreferenced note renders nothing'
  );
  assert.equal(
    html('a[^missing]'),
    '<p>a[^missing]</p>\n',
    'a reference with no definition is text'
  );
  assert.match(
    html('b[^2]\n\na[^1]\n\n[^1]: one\n[^2]: two'),
    /<li id="fn-1">\n<p>two/,
    'notes are numbered in reference order'
  );
  assert.match(
    html('a[^1]\n\n[^1]: p1\n\n    p2'),
    /<p>p1<\/p>\n<p>p2 <a href="#fnref-1"/,
    'the back reference joins the last paragraph'
  );
  assert.match(
    html('a[^1] b[^1]\n\n[^1]: note'),
    /id="fnref-1-2"/,
    'repeated references are numbered'
  );
});

void test('tabs expand to four-column stops', () => {
  assert.equal(html('\tcode'), '<pre><code>code\n</code></pre>\n');
  assert.equal(
    html('>\t\tfoo'),
    '<blockquote>\n<pre><code>  foo\n</code></pre>\n</blockquote>\n'
  );
  assert.equal(html('#\tFoo'), '<h1>Foo</h1>\n');
});

void test('pathological input terminates', () => {
  const inputs = [
    '*'.repeat(2000),
    '['.repeat(2000),
    '> '.repeat(500) + 'x',
    '- '.repeat(300) + 'x',
    '`'.repeat(1000) + 'a',
    'a' + '_'.repeat(1000) + 'b',
    '!['.repeat(500) + 'x',
    '<'.repeat(2000),
    '|'.repeat(1000) + '\n|-|\n',
    '*a* [b](c) '.repeat(10000),
  ];
  for (const input of inputs) {
    const out = renderToHtml(input);
    assert.ok(out instanceof Uint8Array, JSON.stringify(input.slice(0, 20)));
  }
});

void test('a table can start under any line of a paragraph', () => {
  assert.equal(
    html('Notes:\n| a | b |\n| - | - |\n| 1 | 2 |'),
    '<p>Notes:</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n' +
      '<tbody>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody>\n</table>\n'
  );
  assert.equal(
    html('one\ntwo\n| a |\n| - |'),
    '<p>one\ntwo</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n</table>\n'
  );
});

void test('a block that consumes its whole line does not loosen its list', () => {
  assert.equal(
    html('- ***\n- b'),
    '<ul>\n<li>\n<hr />\n</li>\n<li>b</li>\n</ul>\n'
  );
  assert.equal(
    html('- a\n  ***\n- b'),
    '<ul>\n<li>a\n<hr />\n</li>\n<li>b</li>\n</ul>\n'
  );
  assert.equal(
    html('- | a |\n  | - |\n- b'),
    '<ul>\n<li>\n<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n</table>\n</li>\n<li>b</li>\n</ul>\n'
  );
  assert.equal(
    html('- ```\n  ```\n- b'),
    '<ul>\n<li>\n<pre><code></code></pre>\n</li>\n<li>b</li>\n</ul>\n'
  );
  // a genuinely loose list still is one
  assert.equal(
    html('- a\n\n- b'),
    '<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n'
  );
});

void test('a delimiter run longer than 65535 still pairs correctly', () => {
  for (const n of [65535, 65537]) {
    const out = html('*'.repeat(n) + 'a' + '*'.repeat(n));
    assert.equal(
      (out.match(/<strong>/g) ?? []).length,
      (n - (n % 2)) / 2,
      `strong for ${n}`
    );
    assert.equal((out.match(/<em>/g) ?? []).length, n % 2, `em for ${n}`);
  }
});

void test('a block of more than 65535 lines is not truncated', () => {
  const out = html(Array(70000).fill('a').join('\n'));
  assert.equal((out.match(/a/g) ?? []).length, 70000);
});

void test('extended autolinks reject underscores in the last two domain segments', () => {
  assert.equal(html('www.a_b.com'), '<p>www.a_b.com</p>\n');
  // the rule holds however many segments precede them
  assert.equal(
    html('www.x.x.x.x.x.x.x.x.x.a_b.com'),
    '<p>www.x.x.x.x.x.x.x.x.x.a_b.com</p>\n'
  );
  assert.match(
    html('www.a_b.c.com'),
    /^<p><a href="http:\/\/www\.a_b\.c\.com">/
  );
});
