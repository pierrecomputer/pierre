import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  bodyOf,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
  wordColor,
} from './util';

let html: TestLang;

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

void t.test('html: basic element', () => {
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

void t.test('html: close tag and self-closing', () => {
  const out = checkInvariants(html.hl, '<ul><li/></ul>');
  assert.equal(colorOf(out, 'ul'), TAG);
  assert.equal(colorOf(out, 'li'), TAG);
});

void t.test('html: doctype takes the tag color, comment is comment', () => {
  const out = checkInvariants(
    html.hl,
    '<!doctype html>\n<!-- a > b -->\n<p>x</p>'
  );
  assert.equal(colorOf(out, '<!doctype html>'), TAG); // tag.doctype -> tag
  assert.equal(colorOf(out, '<!-- a > b -->'), COMMENT);
});

void t.test(
  'html: abrupt-close comments <!--> and <!---> end at their >',
  () => {
    const out = checkInvariants(html.hl, '<!-->x<div>hi</div>');
    assert.equal(colorOf(out, '<!-->'), COMMENT);
    assert.equal(colorOf(out, 'div'), TAG); // the markup after still highlights
    const out2 = checkInvariants(html.hl, '<!--->x<b>y</b>');
    assert.equal(colorOf(out2, '<!--->'), COMMENT);
    assert.equal(colorOf(out2, 'b'), TAG);
    // a `>` without `--` before it does not close the comment
    const out3 = checkInvariants(html.hl, '<!--a>b-->c');
    assert.equal(colorOf(out3, '<!--a>b-->'), COMMENT);
  }
);

void t.test('html: entities in text', () => {
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

void t.test('html: attribute shapes', () => {
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

void t.test('html: quoted attributes may contain > < and newlines', () => {
  const out = checkInvariants(html.hl, '<a title="1 > 2 < 3\nnext">x</a>');
  assert.equal(colorOf(out, '1 > 2 < 3\nnext'), STRING);
});

void t.test('html: raw text elements find their case-insensitive close', () => {
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

void t.test('html: script close tag needs a name boundary', () => {
  // `</scripts>` does not close a script element
  const out = checkInvariants(html.hl, '<script>a</scripts>b</script>c');
  const spans = spansOf(out);
  assert.ok(!spans.some((s) => s.color === TAG && s.text.includes('scripts')));
});

void t.test('html: stray < stays text', () => {
  for (const src of ['a < b', '1<2', 'x << y', '<3 <-', '< div>']) {
    const out = checkInvariants(html.hl, src);
    assert.ok(!spansOf(out).some((s) => s.color === TAG), src);
  }
});

void t.test('html: lenient on malformed input, still lossless', () => {
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

void t.test('html: adjacent same-color tokens merge', () => {
  const out = html.hl('<br><br>');
  // < br >< br > : delimiters and tags alternate, but `><` merges
  const spans = spansOf(out);
  assert.ok(spans.some((s) => s.text === '><'));
});

void t.test('html: <script> body is highlighted as JavaScript', () => {
  const out = checkInvariants(
    html.hl,
    '<script>const x = "s"; // c\n</script>'
  );
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, '"s"'), STRING);
  assert.equal(colorOf(out, '// c'), COMMENT);
});

void t.test('html: <style> body is highlighted as CSS', () => {
  const out = checkInvariants(html.hl, '<style>.a { color: #ffd452; }</style>');
  assert.equal(colorOf(out, 'color'), PROPERTY);
  assert.equal(colorOf(out, '#ffd452'), SPECIAL); // string.special, like Zed
});

void t.test('html: embedded bodies stay bounded at their close tag', () => {
  // unterminated string in the script must not swallow the html after it
  const out = checkInvariants(
    html.hl,
    '<script>let s = "oops</script><b>bold</b>'
  );
  assert.equal(colorOf(out, 'let'), KEYWORD);
  const spans = spansOf(out);
  assert.equal(spans.find((s) => s.text.trim() === 'b')?.color, TAG);
});

void t.test('html: partial embedded close tags do not cross $end', () => {
  const prefix = '<script>x</scr';
  const ranged = loadLang('html', '$hlHtml', prefix.length);
  const out = checkInvariants(ranged.hl, prefix + 'ipt>z');
  assert.equal(colorOf(out, '/scr'), colorOf(html.hl(prefix), '/scr'));
});

void t.test('html: unterminated raw text runs embedded to the end', () => {
  const out = checkInvariants(html.hl, '<style>.x { margin: 0');
  assert.equal(colorOf(out, 'margin'), PROPERTY);
});

void t.test('html: full page with both embeds', () => {
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

void t.test('html: large document (SIMD paths)', () => {
  const big =
    '<!doctype html>\n' +
    '<div class="row" data-i="1">cell &amp; more</div>\n'.repeat(2000) +
    '<script>let x = 1;</script>\n' +
    'plain '.repeat(5000);
  const out = checkInvariants(html.hl, big);
  assert.ok(bodyOf(out).length > big.length);
});

void t.test('html: unquoted attribute values keep / and = per spec', () => {
  const out = checkInvariants(html.hl, '<a href=/foo/bar data-x=a=b>x</a>');
  const spans = spansOf(out);
  assert.equal(spans.find((s) => s.text.trim() === '/foo/bar')?.color, STRING);
  assert.equal(spans.find((s) => s.text.trim() === 'a=b')?.color, STRING);
  checkInvariants(html.hl, '<img src=x.png/>');
  checkInvariants(html.hl, '<a href=/>');
});

void t.test('html: <script/> still opens a raw-text body like HTML', () => {
  const out = checkInvariants(html.hl, '<script/>let x = 1</script>ok');
  assert.equal(colorOf(out, 'let'), KEYWORD); // js keyword, not markup
});

void t.test('html: longest named character reference highlights', () => {
  const out = checkInvariants(html.hl, 'x &CounterClockwiseContourIntegral; y');
  assert.equal(colorOf(out, '&CounterClockwiseContourIntegral;'), SPECIAL);
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(html.hl, src, { theme: distinctTheme });

void t.test(
  'html: doctype forms, head elements, and character references',
  () => {
    const src =
      '<!DOCTYPE html>\n<!doctype HTML>\n<html lang="en" data-theme=dark hidden>\n<head><meta charset="utf-8"><title>T &amp; &lt; &#169; &#x1F600; &bogus</title><link rel="stylesheet" href="x.css"></head>';
    const html = distinctHl(src);
    const kinds = tokenKinds('html', src);
    for (const d of ['<!DOCTYPE html>', '<!doctype HTML>']) {
      assert.ok(
        kinds.some(([text, kind]) => text === d && kind === 'tag.doctype'),
        d
      );
    }
    for (const tag of ['html', 'head', 'meta', 'title', 'link']) {
      assert.equal(wordColor(html, tag), distinctColor('tag'), tag);
    }
    for (const attr of [
      'lang',
      'data-theme',
      'hidden',
      'charset',
      'rel',
      'href',
    ]) {
      assert.equal(exactColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const s of ['"en"', 'dark', '"utf-8"', '"stylesheet"', '"x.css"']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const ref of ['&amp;', '&lt;', '&#169;', '&#x1F600;']) {
      assert.equal(exactColor(html, ref), distinctColor('string.special'), ref);
    }
    assert.ok(kinds.some(([text, kind]) => text === '&bogus' && kind === null));
  }
);

void t.test(
  'html: attribute quoting styles, void elements, custom elements, and inline svg',
  () => {
    const html = distinctHl(
      '<body class="a b" id=main style="color: red" onclick="go(1)" aria-label=\'x\' DISABLED>\n<img src=a.png alt="" />\n<br>\n<input type="checkbox" checked>\n<my-element some-attr="1"><slot></slot></my-element>\n<svg viewBox="0 0 10 10"><path d="M0 0" /></svg>\n<a href="https://x.com/?a=1&b=2">l</a>\n<p>text<b>bold</b></p>\n<ul><li>1<li>2</ul>\n</body>'
    );
    for (const attr of [
      'class',
      'id',
      'style',
      'onclick',
      'aria-label',
      'DISABLED',
      'src',
      'alt',
      'type',
      'checked',
      'some-attr',
      'viewBox',
      'd',
      'href',
    ]) {
      assert.equal(exactColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const s of [
      '"a b"',
      'main',
      '"color: red"',
      '"go(1)"',
      "'x'",
      'a.png',
      '""',
      '"checkbox"',
      '"1"',
      '"0 0 10 10"',
      '"M0 0"',
      '"https://x.com/?a=1&b=2"',
    ]) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const tag of [
      'body',
      'img',
      'br',
      'input',
      'my-element',
      'slot',
      'svg',
      'path',
      'a',
      'p',
      'b',
      'ul',
      'li',
    ]) {
      assert.equal(wordColor(html, tag), distinctColor('tag'), tag);
    }
    assert.equal(
      exactColor(html, '/>'),
      distinctColor('punctuation.bracket.html')
    );
  }
);

void t.test('html: script and style bodies embed their languages', () => {
  const src =
    '<script type="module">\nconst a = 1;\n</script>\n<script src="x.js"></script>\n<script>if (a < b && c > d) {}</script>\n<style media="print">\n.a { color: red }\n</style>\n<style>@import "x";</style>\n<noscript><p>x</p></noscript>\n<iframe srcdoc="<p>x</p>"></iframe>';
  const html = distinctHl(src);
  const kinds = tokenKinds('html', src);
  const has = (text: string, kind: string | null) =>
    kinds.some(([t, k]) => t === text && k === kind);
  assert.equal(exactColor(html, 'const'), distinctColor('keyword.declaration'));
  assert.equal(exactColor(html, 'if'), distinctColor('keyword.control'));
  assert.ok(has('<', 'operator'));
  assert.ok(has('>', 'operator'));
  assert.ok(has('&&', 'operator'));
  assert.equal(exactColor(html, '.a'), distinctColor('selector.class'));
  assert.equal(exactColor(html, 'color'), distinctColor('property'));
  assert.equal(exactColor(html, 'red'), distinctColor('constant.builtin'));
  assert.equal(exactColor(html, '@import'), distinctColor('keyword'));
  assert.equal(exactColor(html, '"x"'), distinctColor('string'));
  for (const attr of ['type', 'src', 'media', 'srcdoc']) {
    assert.equal(exactColor(html, attr), distinctColor('attribute'), attr);
  }
  for (const tag of ['noscript', 'iframe']) {
    assert.equal(wordColor(html, tag), distinctColor('tag'), tag);
  }
  assert.equal(exactColor(html, '"<p>x</p>"'), distinctColor('string'));
});

void t.test('html: comment forms, bogus comments, and stray brackets', () => {
  assert.deepEqual(
    tokenKinds(
      'html',
      '<!-- comment -->\n<!-- multi\nline -->\n<!---->\n<?php echo 1 ?>\n<?xml version="1.0"?>\n<>\n< a>\n<1>'
    ),
    [
      ['<!-- comment -->', 'comment'],
      ['<!-- multi', 'comment'],
      ['line -->', 'comment'],
      ['<!---->', 'comment'],
      ['<?php echo 1 ?>', 'comment'],
      ['<?xml version="1.0"?>', 'comment'],
      ['<>', null],
      ['< a>', null],
      ['<1>', null],
    ]
  );
});

void t.test(
  'html: an unterminated attribute value runs to the end of input',
  () => {
    assert.deepEqual(tokenKinds('html', '<a b="unterminated\n<c>'), [
      ['<', 'punctuation.bracket.html'],
      ['a', 'tag'],
      ['b', 'attribute'],
      ['=', 'punctuation.delimiter.html'],
      ['"unterminated', 'string'],
      ['<c>', 'string'],
    ]);
  }
);

void t.test(
  'html: tags, comments, scripts, and styles spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'html',
      '<a\n  href="x"\n  b>y</a>\n<!-- c\n d -->\n<script>\nconst s = `e\nf`;\n</script>\n<style>\n.g {\n  h: 1;\n}\n</style>\n<p\n>z</p>\n'
    );
  }
);
