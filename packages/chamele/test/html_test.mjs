import assert from 'node:assert';
import t from 'node:test';

import {
  bodyOf,
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  themeColor,
} from './util.mjs';

let html = null;

t.before(() => {
  html = loadLang('html', '$hlHtml');
});

// pierre-dark colors resolved from themes/pierre-dark.json (see themeColor)
const TAG = themeColor('tag'); // and tag.doctype via the prefix rule
const DELIM = themeColor('punctuation.bracket.html'); // and punctuation.delimiter.html
const ATTR = themeColor('attribute');
const STRING = themeColor('string');
const COMMENT = themeColor('comment');
const SPECIAL = themeColor('string.special'); // entities, css hex colors
const KEYWORD = themeColor('keyword');
const PROPERTY = themeColor('property');
const FUNC = themeColor('function');

t.test('html: basic element', () => {
  const out = checkInvariants(html.hl, '<div class="box">text</div>');
  assert.equal(colorOf(out, 'div'), TAG);
  assert.equal(colorOf(out, 'class'), ATTR);
  assert.equal(colorOf(out, '"box"'), STRING);
  assert.equal(colorOf(out, '='), DELIM);
  const spans = spansOf(out);
  assert.equal(spans[0].color, DELIM); // `<`
  // `text` is plain: not inside any span
  assert.ok(!spans.some((s) => s.text.includes('text')));
});

t.test('html: close tag and self-closing', () => {
  const out = checkInvariants(html.hl, '<ul><li/></ul>');
  assert.equal(colorOf(out, 'ul'), TAG);
  assert.equal(colorOf(out, 'li'), TAG);
});

t.test('html: doctype takes the tag color, comment is comment', () => {
  const out = checkInvariants(
    html.hl,
    '<!doctype html>\n<!-- a > b -->\n<p>x</p>'
  );
  assert.equal(colorOf(out, '<!doctype html>'), TAG); // tag.doctype -> tag
  assert.equal(colorOf(out, '<!-- a > b -->'), COMMENT);
});

t.test('html: abrupt-close comments <!--> and <!---> end at their >', () => {
  const out = checkInvariants(html.hl, '<!-->x<div>hi</div>');
  assert.equal(colorOf(out, '<!-->'), COMMENT);
  assert.equal(colorOf(out, 'div'), TAG); // the markup after still highlights
  const out2 = checkInvariants(html.hl, '<!--->x<b>y</b>');
  assert.equal(colorOf(out2, '<!--->'), COMMENT);
  assert.equal(colorOf(out2, 'b'), TAG);
  // a `>` without `--` before it does not close the comment
  const out3 = checkInvariants(html.hl, '<!--a>b-->c');
  assert.equal(colorOf(out3, '<!--a>b-->'), COMMENT);
});

t.test('html: entities in text', () => {
  const out = checkInvariants(
    html.hl,
    'a &amp; b &#x27; c &#10; & d &nosemi e'
  );
  assert.equal(colorOf(out, '&amp;'), SPECIAL);
  assert.equal(colorOf(out, '&#x27;'), SPECIAL);
  assert.equal(colorOf(out, '&#10;'), SPECIAL);
  // bare `&` and `&nosemi ` stay plain
  const spans = spansOf(out);
  assert.equal(spans.filter((s) => s.color === SPECIAL).length, 3);
});

t.test('html: attribute shapes', () => {
  const out = checkInvariants(
    html.hl,
    '<input type=text checked value=\'a b\' data-x="1">'
  );
  assert.equal(colorOf(out, 'input'), TAG);
  assert.equal(colorOf(out, 'type'), ATTR);
  assert.equal(colorOf(out, 'checked'), ATTR);
  // unquoted value after `=` is a string
  const spans = spansOf(out);
  assert.equal(spans.find((s) => s.text.trim() === 'text')?.color, STRING);
  assert.equal(spans.find((s) => s.text.trim() === "'a b'")?.color, STRING);
});

t.test('html: quoted attributes may contain > < and newlines', () => {
  const out = checkInvariants(html.hl, '<a title="1 > 2 < 3\nnext">x</a>');
  assert.equal(colorOf(out, '1 > 2 < 3\nnext'), STRING);
});

t.test('html: raw text elements find their case-insensitive close', () => {
  const src =
    '<script type="module">let a = "</div>";</script><p>after</p><STYLE>.a{}</STYLE>tail';
  const out = checkInvariants(html.hl, src);
  // the close tags are highlighted as tags, the bodies stay in one piece
  assert.equal(colorOf(out, 'script'), TAG);
  assert.equal(colorOf(out, 'STYLE'), TAG);
  assert.equal(colorOf(out, 'after'), undefined); // plain text
  // `</div>` inside the script body must not be treated as a tag
  const spans = spansOf(out);
  assert.ok(!spans.some((s) => s.color === TAG && s.text.includes('div')));
});

t.test('html: script close tag needs a name boundary', () => {
  // `</scripts>` does not close a script element
  const out = checkInvariants(html.hl, '<script>a</scripts>b</script>c');
  const spans = spansOf(out);
  assert.ok(!spans.some((s) => s.color === TAG && s.text.includes('scripts')));
});

t.test('html: stray < stays text', () => {
  for (const src of ['a < b', '1<2', 'x << y', '<3 <-', '< div>']) {
    const out = checkInvariants(html.hl, src);
    assert.ok(!spansOf(out).some((s) => s.color === TAG), src);
  }
});

t.test('html: lenient on malformed input, still lossless', () => {
  for (const src of [
    '<',
    '</',
    '<>',
    '<div',
    '<div class=',
    '<div class="unterminated',
    '<!-- unterminated',
    '<!doctype without end',
    '<script>never closed',
    '<style>a{color:red}',
    '</unclosed',
    '<a b=c=d e==f>',
    "<a 'lone'>",
    "<?xml version='1.0'?>",
    '<![CDATA[ raw ]]>',
    'text &#; &x; &',
    '<p>é 日本語 &amp; ok</p>',
    "<a\nhref\n=\n'x'\n>",
  ]) {
    checkInvariants(html.hl, src);
  }
});

t.test('html: adjacent same-color tokens merge', () => {
  const out = html.hl('<br><br>');
  // < br >< br > : delimiters and tags alternate, but `><` merges
  const spans = spansOf(out);
  assert.ok(spans.some((s) => s.text === '><'));
});

t.test('html: <script> body is highlighted as TSX', () => {
  const out = checkInvariants(
    html.hl,
    '<script>const x = "s"; // c\n</script>'
  );
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, '"s"'), STRING);
  assert.equal(colorOf(out, '// c'), COMMENT);
});

t.test('html: <style> body is highlighted as CSS', () => {
  const out = checkInvariants(html.hl, '<style>.a { color: #ffd452; }</style>');
  assert.equal(colorOf(out, 'color'), PROPERTY);
  assert.equal(colorOf(out, '#ffd452'), SPECIAL); // string.special, like Zed
});

t.test('html: embedded bodies stay bounded at their close tag', () => {
  // unterminated string in the script must not swallow the html after it
  const out = checkInvariants(
    html.hl,
    '<script>let s = "oops</script><b>bold</b>'
  );
  assert.equal(colorOf(out, 'let'), KEYWORD);
  const spans = spansOf(out);
  assert.equal(spans.find((s) => s.text.trim() === 'b')?.color, TAG);
});

t.test('html: partial embedded close tags do not cross $end', () => {
  const prefix = '<script>x</scr';
  const ranged = loadLang('html', '$hlHtml', prefix.length);
  const out = checkInvariants(ranged.hl, prefix + 'ipt>z');
  assert.equal(colorOf(out, '/scr'), colorOf(html.hl(prefix), '/scr'));
});

t.test('html: unterminated raw text runs embedded to the end', () => {
  const out = checkInvariants(html.hl, '<style>.x { margin: 0');
  assert.equal(colorOf(out, 'margin'), PROPERTY);
});

t.test('html: full page with both embeds', () => {
  const src = `<!doctype html>
<html lang="en">
<head>
  <style>
    body { background: #0a0a0a; }
    .btn:hover { color: rgb(255, 103, 141) !important; }
  </style>
</head>
<body>
  <button class="btn" disabled>Save &amp; close</button>
  <script type="module">
    import { codeToHtml } from "/lib/browser.mjs";
    const html = codeToHtml(\`let n = 1;\`, { lang: "js" });
    document.body.innerHTML += new TextDecoder().decode(html);
  </script>
</body>
</html>`;
  const out = checkInvariants(html.hl, src);
  assert.equal(colorOf(out, 'background'), PROPERTY);
  assert.equal(colorOf(out, 'import'), KEYWORD);
  // the import binding is a variable; the call site is function
  assert.ok(
    spansOf(out).some((s) => s.text.includes('codeToHtml') && s.color === FUNC)
  );
});

t.test('html: large document (SIMD paths)', () => {
  const big =
    '<!doctype html>\n' +
    '<div class="row" data-i="1">cell &amp; more</div>\n'.repeat(2000) +
    '<script>let x = 1;</script>\n' +
    'plain '.repeat(5000);
  const out = checkInvariants(html.hl, big);
  assert.ok(bodyOf(out).length > big.length);
});

t.test('html: unquoted attribute values keep / and = per spec', () => {
  const out = checkInvariants(html.hl, '<a href=/foo/bar data-x=a=b>x</a>');
  const spans = spansOf(out);
  assert.equal(spans.find((s) => s.text.trim() === '/foo/bar')?.color, STRING);
  assert.equal(spans.find((s) => s.text.trim() === 'a=b')?.color, STRING);
  checkInvariants(html.hl, '<img src=x.png/>');
  checkInvariants(html.hl, '<a href=/>');
});

t.test('html: <script/> still opens a raw-text body like HTML', () => {
  const out = checkInvariants(html.hl, '<script/>let x = 1</script>ok');
  assert.equal(colorOf(out, 'let'), KEYWORD); // js keyword, not markup
});

t.test('html: longest named character reference highlights', () => {
  const out = checkInvariants(html.hl, 'x &CounterClockwiseContourIntegral; y');
  assert.equal(colorOf(out, '&CounterClockwiseContourIntegral;'), SPECIAL);
});
