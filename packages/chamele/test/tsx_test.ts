import assert from 'node:assert';
import t from 'node:test';

import type { Theme } from '../lib/index';
import { createHighlighter } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  bodyOf,
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestHlOptions,
  type TestLang,
  textOf,
  themeColor,
} from './util';

let tsx: TestLang;

t.before(() => {
  tsx = loadLang('tsx', '$hlTsx');
});

// pierre-dark colors resolved from themes/pierre-dark.json (see themeColor)
const BG = themeColor('background');
const FG = themeColor('foreground');
const KEYWORD = themeColor('keyword'); // and every keyword.* bucket the theme leaves plain
const BOOL = themeColor('boolean');
const VSPEC = themeColor('variable.special'); // this / super
const FUNC = themeColor('function'); // and function.method
const VAR = themeColor('variable'); // and variable.jsdoc via the prefix rule
const PROP = themeColor('property'); // and property.json_key
const CONST = themeColor('constant'); // and constant.builtin (null, undefined, NaN, SCREAMING_CASE)
const CTOR = themeColor('type.class'); // constructors, class heads
const ATTR = themeColor('attribute'); // and attribute.jsx
const TYPE = themeColor('type');
const OP = themeColor('operator');
const PUNCT = themeColor('punctuation.bracket'); // and .delimiter, including the .jsx/.html kinds
const SPECIAL = themeColor('punctuation.special');
const STR = themeColor('string');
const ESC = themeColor('string.escape');
const RX = themeColor('string.regex');
const NUM = themeColor('number');
const COMMENT = themeColor('comment');
const TAG = themeColor('tag'); // and tag.jsx

// a theme that separates every keyword bucket, for bucket-precision tests
const bucketTheme = {
  name: 'buckets',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: {
      keyword: '#000001',
      'keyword.control': '#000002',
      'keyword.declaration': '#000003',
      'keyword.import': '#000006',
      comment: '#00000a',
      'comment.doc': '#00000b',
    },
  },
};

void t.test('tsx: wrapper carries the theme background and foreground', () => {
  const html = tsx.hl('1');
  assert.ok(
    html.startsWith(
      `<pre class="chamele" style="background-color:${BG};color:${FG}"><code>`
    ) === true
  );
  assert.match(html, /<\/code><\/pre>$/);
});

void t.test('tsx: empty input', () => {
  assert.equal(
    tsx.hl(''),
    `<pre class="chamele" style="background-color:${BG};color:${FG}"><code></code></pre>`
  );
});

void t.test('tsx: keyword buckets resolve to distinct capture names', () => {
  const html = checkInvariants(
    tsx.hl,
    'if (a) {} else {} switch (a) { case 1: default: }\n' +
      'for (;;) {} while (a) {} do {} while (a)\n' +
      'function f() { return 1 }\n' +
      'try { throw e } catch (e) {} finally {}\n' +
      "import x from 'm'; export default x;\n" +
      'async function g() { await g() }\n' +
      "new X(); delete a.b; typeof x; a instanceof X; 'k' in a; void 0;\n" +
      'class C {} const c = 1; let l; var v; yield 1;',
    { theme: bucketTheme }
  );
  for (const [word, color] of [
    ['if', '#000002'],
    ['else', '#000002'],
    ['switch', '#000002'],
    ['case', '#000002'],
    ['default', '#000002'],
    ['for', '#000002'],
    ['while', '#000002'],
    ['do', '#000002'],
    ['return', '#000002'],
    ['try', '#000002'],
    ['throw', '#000002'],
    ['catch', '#000002'],
    ['finally', '#000002'],
    ['await', '#000002'],
    ['yield', '#000002'],
    ['import', '#000006'],
    ['export', '#000006'],
    ['function', '#000003'],
    ['class', '#000003'],
    ['const', '#000003'],
    ['let', '#000003'],
    ['var', '#000003'],
    ['async', '#000001'],
    ['new', '#000001'],
    ['delete', '#000001'],
    ['typeof', '#000001'],
    ['instanceof', '#000001'],
    ['in', '#000001'],
    ['void', '#000001'],
  ]) {
    // exact-word match: substring search would find "in" inside "finally"
    assert.equal(
      spansOf(html).find((s) => s.text.trim() === word)?.color,
      color,
      word
    );
  }
});

void t.test('tsx: literal words', () => {
  const html = checkInvariants(
    tsx.hl,
    '[true, false, null, undefined, NaN, Infinity, this, super.x]'
  );
  assert.equal(colorOf(html, 'true'), BOOL);
  assert.equal(colorOf(html, 'false'), BOOL);
  assert.equal(colorOf(html, 'null'), CONST);
  assert.equal(colorOf(html, 'undefined'), CONST);
  assert.equal(colorOf(html, 'NaN'), CONST);
  assert.equal(colorOf(html, 'Infinity'), CONST);
  assert.equal(colorOf(html, 'this'), VSPEC);
  assert.equal(colorOf(html, 'super'), VSPEC);
});

void t.test('tsx: strings with escapes, including UTF-8-adjacent ones', () => {
  const html = checkInvariants(tsx.hl, "'a\\nb' + \"c\\u0041d\" + '\\é'");
  assert.equal(colorOf(html, '\\n'), ESC);
  assert.equal(colorOf(html, '\\u0041'), ESC);
  assert.equal(colorOf(html, '\\é'), ESC);
  assert.equal(colorOf(html, "'a"), STR);
  assert.equal(colorOf(html, 'd"'), STR);
});

void t.test('tsx: escape spans never split a UTF-8 code point', () => {
  for (const src of [
    '"a\\éb"',
    '"\\日本語"',
    "'x\\",
    '`t\\é${x}`',
    '"\\u12é"',
  ]) {
    checkInvariants(tsx.hl, src);
  }
});

void t.test(
  'tsx: \\xNN and \\u{...} escape spans cover exactly the escape',
  () => {
    const html = checkInvariants(tsx.hl, String.raw`"z\x41z\u{1F600}z\u0041z"`);
    const esc = spansOf(html)
      .filter((s) => s.color === ESC)
      .map((s) => s.text);
    assert.deepEqual(esc, ['\\x41', '\\u{1F600}', '\\u0041']);
    // a short escape must not swallow the closing quote
    const short = checkInvariants(tsx.hl, String.raw`"\u12"+z`);
    assert.ok(
      spansOf(short).some((s) => s.color === ESC && s.text === '\\u12')
    );
    assert.equal(colorOf(short, '+'), OP);
  }
);

void t.test('tsx: numbers', () => {
  const html = checkInvariants(
    tsx.hl,
    '0xAB_CDn + 1e-2 + .5 + 1_000 + 0b10_01 + 10n + 1..toString()'
  );
  assert.equal(colorOf(html, '0xAB_CDn'), NUM);
  assert.equal(colorOf(html, '1e-2'), NUM);
  assert.equal(colorOf(html, '.5'), NUM);
  assert.equal(colorOf(html, '1_000'), NUM);
  assert.equal(colorOf(html, '0b10_01'), NUM);
  assert.equal(colorOf(html, '10n'), NUM);
  assert.equal(colorOf(html, '1.'), NUM);
  assert.equal(colorOf(html, 'toString'), FUNC);
});

void t.test(
  'tsx: template literals split into string, escapes, and ${ } specials',
  () => {
    const html = checkInvariants(tsx.hl, '`a\\t${b}c${d}e`');
    assert.equal(colorOf(html, '`a'), STR);
    assert.equal(colorOf(html, '\\t'), ESC);
    const spans = spansOf(html);
    // `${` and the resuming `}` are punctuation.special around the plain b
    assert.deepEqual(
      spans.filter((s) => s.color === SPECIAL).map((s) => s.text),
      ['${', '}', '${', '}']
    );
    assert.equal(colorOf(html, 'c'), STR);
    assert.equal(colorOf(html, 'e`'), STR);
  }
);

void t.test('tsx: nested and multiline templates', () => {
  const html = checkInvariants(
    tsx.hl,
    '`1${`2${x}2`}1`\n`multi\nline ${ {a: `y${z}w`} } tail`'
  );
  assert.equal(colorOf(html, 'multi'), STR);
  assert.equal(colorOf(html, 'tail`'), STR);
  assert.equal(colorOf(html, 'w`'), STR);
  checkInvariants(tsx.hl, '`${}`');
  checkInvariants(tsx.hl, '`${{a:{b:1}}}`');
  checkInvariants(tsx.hl, 'tag`a${1}`');
});

void t.test('tsx: regexp vs division', () => {
  for (const [src, re] of [
    ['a = /re[/]x/gi', '/re[/]x/gi'],
    ['typeof /re/', '/re/'],
    ['return/re/g;', '/re/g'],
    ['if (a) /re/', '/re/'],
    ['x=>/re/', '/re/'],
    ['[/a/, /b/]', '/a/'],
    ['a / /*c*/ /re/', '/re/'],
    ['`${/}/}`', '/}/'],
    ['for (v of /re/) {}', '/re/'],
  ]) {
    assert.equal(colorOf(checkInvariants(tsx.hl, src), re), RX, src);
  }
  // division positions: no string.regexp span anywhere
  for (const src of [
    '(1) / 2',
    'a[0] / 2',
    'x = {} / 2',
    'this / 2',
    'x++ / 2',
    '`x`/2/g',
    '10n / 2',
    'a /= 2',
  ]) {
    const spans = spansOf(checkInvariants(tsx.hl, src));
    assert.ok(!spans.some((s) => s.color === RX), src);
  }
});

void t.test('tsx: comments', () => {
  const html = checkInvariants(
    tsx.hl,
    '// line\nlet a; /* block\nmore */ b; /** doc */ c;'
  );
  assert.equal(colorOf(html, '// line'), COMMENT);
  assert.equal(colorOf(html, '/* block'), COMMENT);
  assert.equal(colorOf(html, '/** doc */'), COMMENT); // same color in pierre-dark
  // the doc distinction needs a theme that separates the capture names
  const bhtml = checkInvariants(tsx.hl, '/* plain */ /** doc */ /**/ x', {
    theme: bucketTheme,
  });
  assert.equal(colorOf(bhtml, '/* plain */'), '#00000a');
  assert.equal(colorOf(bhtml, '/** doc */'), '#00000b');
  assert.equal(colorOf(bhtml, '/**/'), '#00000a');
});

void t.test('tsx: JSDoc tags in doc comments', () => {
  const html = checkInvariants(
    tsx.hl,
    '/**\n * Adds widgets. See {@link Widget}.\n' +
      ' * @param {number} opts.count - how many\n' +
      ' * @returns {Promise<Widget>} the result\n' +
      ' */\nfunction add(opts) {}'
  );
  assert.equal(colorOf(html, '@param'), KEYWORD);
  assert.equal(colorOf(html, '@returns'), KEYWORD);
  assert.equal(colorOf(html, '@link'), KEYWORD);
  assert.equal(colorOf(html, 'number'), TYPE);
  assert.equal(colorOf(html, 'Promise<Widget>'), TYPE);
  assert.equal(colorOf(html, 'opts.count'), VAR); // variable.jsdoc -> variable
  // prose, the leading stars, and non-param tag arguments keep the doc color
  assert.equal(colorOf(html, 'Adds widgets'), COMMENT);
  assert.equal(colorOf(html, 'how many'), COMMENT);
  assert.equal(colorOf(html, 'the result'), COMMENT);
  // the type braces are punctuation, split from the type body
  assert.ok(spansOf(html).some((s) => s.text === '{' && s.color === PUNCT));
  // the tag itself is keyword.jsdoc -> keyword, the surrounding text comment.doc
  const bhtml = checkInvariants(tsx.hl, '/** a @param {T} n b */', {
    theme: bucketTheme,
  });
  assert.equal(colorOf(bhtml, 'a '), '#00000b');
  assert.equal(colorOf(bhtml, '@param'), '#000001');
  assert.equal(colorOf(bhtml, ' b '), '#00000b');
});

void t.test('tsx: JSDoc name arguments', () => {
  const html = checkInvariants(
    tsx.hl,
    '/** @template T */\n/** @typedef {Object} Opts */\n/** @property {string} name */\n' +
      '/** @arg $x_1 */\n/** @callback cb */\n/** @see Other */'
  );
  const spans = spansOf(html);
  for (const name of ['T', 'Opts', 'name', '$x_1', 'cb']) {
    assert.equal(spans.find((s) => s.text.trim() === name)?.color, VAR, name); // variable.jsdoc -> variable
  }
  // @see takes no name argument
  assert.equal(spans.find((s) => s.text.includes('Other'))?.color, COMMENT);
});

void t.test('tsx: malformed JSDoc stays lossless', () => {
  for (const src of [
    '/** @',
    '/** @param',
    '/** @param {num',
    '/** @type {a*/ x',
    '/** @type {a\n * b} */',
    '/** {@} @@ @1 a@b.c */',
    '/**@x*/',
    '/***/',
    '/** @param {{a: {b: string}}} deep.path */',
    '/** @param {string} [opt] */',
    'let a = 1; /** @see Foo */ let b;',
  ]) {
    checkInvariants(tsx.hl, src);
  }
  // an email `@` in prose is not a tag
  const html = checkInvariants(tsx.hl, '/** mail a@example.com */');
  assert.equal(colorOf(html, 'a@example.com'), COMMENT);
  // an unclosed `{` group stays comment-colored
  const html2 = checkInvariants(tsx.hl, '/** @type {num */ x');
  assert.equal(colorOf(html2, '{num'), COMMENT);
});

void t.test('tsx: shebang is a comment', () => {
  const html = checkInvariants(tsx.hl, '#!/usr/bin/env node\nlet x = 1');
  assert.equal(colorOf(html, '#!/usr/bin/env node'), COMMENT);
  // only at the very start
  const html2 = checkInvariants(tsx.hl, 'x\n#!y');
  assert.notEqual(colorOf(html2, '#'), COMMENT);
});

void t.test('tsx: member chains, calls, and identifiers', () => {
  const html = checkInvariants(tsx.hl, 'a.b.c(1); obj?.m(); foo(); bar');
  const spans = spansOf(html);
  assert.equal(spans.find((s) => s.text.trim() === 'a')?.color, VAR);
  assert.equal(colorOf(html, 'b'), VAR); // property
  assert.equal(colorOf(html, 'c'), FUNC); // function.method
  assert.equal(colorOf(html, 'm'), FUNC);
  assert.equal(colorOf(html, 'foo'), FUNC); // function
  assert.equal(colorOf(html, 'bar'), VAR);
});

void t.test(
  'tsx: object keys are property, ternary colon operands are not',
  () => {
    const html = checkInvariants(tsx.hl, '({key: 1, other: cond ? yes : no})');
    assert.equal(colorOf(html, 'key'), PROP);
    assert.equal(colorOf(html, 'other'), PROP);
    assert.equal(colorOf(html, 'yes'), VAR);
    assert.equal(colorOf(html, 'no'), VAR);
    assert.equal(colorOf(html, 'cond'), VAR);
  }
);

void t.test(
  'tsx: interface members are property across `;`/`,` and `?:`',
  () => {
    const html = checkInvariants(
      tsx.hl,
      'interface B { first: number; second: number, third?: string; label: string }'
    );
    assert.equal(colorOf(html, 'first'), PROP);
    assert.equal(colorOf(html, 'second'), PROP);
    assert.equal(colorOf(html, 'third'), PROP);
    assert.equal(colorOf(html, 'label'), PROP);
  }
);

void t.test(
  'tsx: predefined member types and annotation punctuation match Zed',
  () => {
    const theme = {
      name: 'type annotation buckets',
      style: {
        background: '#000000',
        foreground: '#ffffff',
        syntax: {
          type: '#000001',
          'type.builtin': '#000002',
          punctuation: '#000003',
          'punctuation.special': '#000004',
        },
      },
    } as unknown as Theme;
    const html = checkInvariants(
      tsx.hl,
      'type BadgeProps = { label: string; count?: number }; interface I { ok: boolean }; function f(x: symbol): unknown {}',
      { theme }
    );
    for (const word of ['string', 'number', 'boolean', 'symbol', 'unknown']) {
      assert.equal(colorOf(html, word), '#000002', word);
    }
    assert.deepEqual(
      spansOf(html)
        .filter((span) => span.color === '#000004')
        .map((span) => span.text.trim()),
      [':', '?:', ':', ':', ':']
    );

    const runtime = checkInvariants(
      tsx.hl,
      'const string = value, number = 1; use(string, number)',
      { theme }
    );
    assert.notEqual(colorOf(runtime, 'string'), '#000002');
    assert.notEqual(colorOf(runtime, 'number'), '#000002');
  }
);

void t.test('tsx: a spaced ternary `?` never reads as an optional key', () => {
  const html = checkInvariants(
    tsx.hl,
    'let x; cond ? a : b; f(y, flag ? c : d)'
  );
  assert.equal(colorOf(html, 'cond'), VAR);
  assert.equal(colorOf(html, 'flag'), VAR);
});

void t.test(
  'tsx: constructors, decorators, private fields, class heads',
  () => {
    const html = checkInvariants(
      tsx.hl,
      '@dec class X extends Y { #p = 1; m() { return new Foo(this.#p) } }'
    );
    assert.equal(colorOf(html, '@dec'), ATTR);
    assert.equal(colorOf(html, 'X'), TYPE);
    assert.equal(colorOf(html, 'Y'), TYPE);
    assert.equal(colorOf(html, '#p'), VAR); // property
    assert.equal(colorOf(html, 'Foo'), CTOR);
    assert.equal(colorOf(html, 'm'), FUNC);
  }
);

void t.test(
  'tsx: function declarations name after the function keyword',
  () => {
    const html = checkInvariants(tsx.hl, 'function fn(a) { return a }');
    assert.equal(colorOf(html, 'fn'), FUNC);
  }
);

void t.test(
  'tsx: TS annotations stay lossless with the uppercase heuristic',
  () => {
    const html = checkInvariants(tsx.hl, 'const x: Foo<Bar> = f<T>(1)');
    assert.equal(colorOf(html, 'Foo'), TYPE);
    assert.equal(colorOf(html, 'Bar'), TYPE);
    const kw = checkInvariants(
      tsx.hl,
      'type A = keyof B; interface I {} declare const d: number; x satisfies Y; abstract class C {}'
    );
    assert.equal(colorOf(kw, 'type'), KEYWORD);
    assert.equal(colorOf(kw, 'keyof'), KEYWORD);
    assert.equal(colorOf(kw, 'interface'), KEYWORD);
    assert.equal(colorOf(kw, 'declare'), KEYWORD);
    assert.equal(colorOf(kw, 'satisfies'), KEYWORD);
    assert.equal(colorOf(kw, 'abstract'), KEYWORD);
    // contextual words in plain expression positions stay identifiers
    const id = checkInvariants(
      tsx.hl,
      'const type = 1; f(get, set); declare = 2'
    );
    assert.equal(colorOf(id, 'type'), VAR);
    assert.equal(colorOf(id, 'get'), VAR);
    assert.equal(colorOf(id, 'declare'), VAR);
  }
);

void t.test('tsx: import/export contextual words', () => {
  const html = checkInvariants(
    tsx.hl,
    'import {a as b} from "mod"; export * as ns from "m2";'
  );
  assert.equal(colorOf(html, 'import'), KEYWORD);
  assert.equal(colorOf(html, 'as'), KEYWORD); // plain keyword in Zed's query
  assert.equal(colorOf(html, 'from'), KEYWORD);
  assert.equal(colorOf(html, '"mod"'), STR);
});

void t.test('tsx: jsx elements, attributes, and containers', () => {
  const html = checkInvariants(
    tsx.hl,
    'const el = <div className="a" data-on={handler} disabled>hi {name} bye</div>;'
  );
  assert.equal(colorOf(html, '<'), PUNCT); // punctuation.bracket.jsx -> punctuation.bracket
  assert.equal(colorOf(html, 'div'), TAG);
  assert.equal(colorOf(html, 'className'), ATTR);
  assert.equal(colorOf(html, 'data-on'), ATTR);
  assert.equal(colorOf(html, 'disabled'), ATTR);
  assert.equal(colorOf(html, '"a"'), STR);
  assert.equal(colorOf(html, 'handler'), VAR);
  assert.equal(colorOf(html, 'name'), VAR);
  // text children carry no span
  assert.ok(!spansOf(html).some((s) => s.text.includes('hi ')));
});

void t.test(
  'tsx: jsx components and dotted names are types, plain tags are tags',
  () => {
    const html = checkInvariants(
      tsx.hl,
      '<App.Nav item={1}/>; <Comp/>; <span/>; <my-el/>'
    );
    assert.equal(colorOf(html, 'App.Nav'), TYPE);
    assert.equal(colorOf(html, 'Comp'), TYPE);
    assert.equal(colorOf(html, 'span'), TAG);
    assert.equal(colorOf(html, 'my-el'), TAG);
  }
);

void t.test('tsx: jsx fragments, nesting, entities', () => {
  const html = checkInvariants(
    tsx.hl,
    '<>\n  <ul>\n    <li>a &amp; b &#38; c</li>\n  </ul>\n</>'
  );
  assert.equal(colorOf(html, 'ul'), TAG);
  assert.equal(colorOf(html, 'li'), TAG);
  assert.equal(colorOf(html, '&amp;'), ESC);
  assert.equal(colorOf(html, '&#38;'), ESC);
});

void t.test('tsx: jsx containers re-enter the token pipeline', () => {
  const html = checkInvariants(
    tsx.hl,
    '<div>{items.map((i) => <b key={`k${i}`}>{ {x: i}.x }</b>)}</div>'
  );
  assert.equal(colorOf(html, 'map'), FUNC);
  assert.equal(colorOf(html, '`k'), STR);
  assert.equal(colorOf(html, 'b'), TAG);
  // the object key inside the nested container is a property
  assert.equal(spansOf(html).find((s) => s.text.trim() === 'x')?.color, PROP);
});

void t.test('tsx: jsx after return / paren / arrow / ternary', () => {
  for (const src of [
    'function f() { return <div/> }',
    'const a = (<div/>)',
    'cond ? <a/> : <b/>',
    'list.map(() => <li/>)',
    'if (x) return <App/>;',
  ]) {
    const html = checkInvariants(tsx.hl, src);
    assert.ok(
      spansOf(html).some((s) => s.color === TAG || s.color === TYPE),
      src
    );
  }
});

void t.test(
  'tsx: jsx deeper than the 512-entry mode stack keeps close tags matched',
  () => {
    // pushes past capacity are dropped but counted, so every pop matches its
    // push and the tail close tags still color as jsx
    const deep = '<a>'.repeat(513) + "<b c='d'/>" + '</a>'.repeat(513);
    const html = checkInvariants(tsx.hl, deep);
    const spans = spansOf(html);
    assert.equal(spans.at(-1)?.color, PUNCT); // final `>`
    assert.equal(spans.at(-2)?.color, TAG); // final `a`
    assert.equal(spans.at(-3)?.color, PUNCT); // `></`
  }
);

void t.test('tsx: generics bail out of jsx', () => {
  const html = checkInvariants(tsx.hl, 'const f = <T,>(x: T) => x');
  assert.ok(!spansOf(html).some((s) => s.color === TAG));
  assert.equal(colorOf(html, '<'), OP);
  // comparisons never open jsx
  const cmp = checkInvariants(tsx.hl, 'a < b; c<d>e');
  assert.ok(!spansOf(cmp).some((s) => s.color === TAG));
});

void t.test('tsx: unterminated everything stays lossless and total', () => {
  for (const src of [
    "'abc",
    "'a\\",
    '"a\nb"',
    '`ab',
    '`a${b',
    '`a${',
    '}rest`',
    'x = /a\nb/',
    'x = /abc',
    '/* x',
    '// no newline',
    '<div',
    '<div attr',
    '<div a="x',
    '<div>text',
    '<div>{x',
    '<>frag',
    '</',
    '<',
    'a <',
    'const x = <Comp attr={`t${',
    '\\u0041x = 1',
    'x\\u{41} = 1',
    '§ éé 𝑥',
    'a‍b = 1',
    '?.?.??=...',
    '#!x',
    '{ } ] ) } who',
  ]) {
    checkInvariants(tsx.hl, src);
  }
});

void t.test('tsx: adjacent same-color tokens merge into one span', () => {
  const html = tsx.hl('[[]]');
  assert.equal(spansOf(html).length, 1);
  assert.equal(spansOf(html)[0].text, '[[]]');
  // merging across a whitespace gap
  const html2 = tsx.hl('( ) ;');
  assert.equal(spansOf(html2).length, 1);
});

void t.test('tsx: html-special bytes are escaped', () => {
  const html = checkInvariants(tsx.hl, 'a < b && "x>y" + `<&>`');
  assert.ok(bodyOf(html).includes('&lt;'));
  assert.ok(bodyOf(html).includes('&gt;'));
  assert.ok(bodyOf(html).includes('&amp;'));
});

void t.test(
  'tsx: sub-range scans stay $end-bounded (the html embedding contract)',
  () => {
    // a harness that scans the input as two sub-ranges split at the midpoint,
    // exactly like html.wat drives embedded <script> bodies: during the first
    // scan live bytes sit past $end and no NUL sentinel stops the lexer
    const watUrl = new URL('./test_tsx_sub.wat', import.meta.url);
    const src = `(module
  (memory (export "memory") 3)
  (import "../src/langs/tsx.wat")
  (func (export "highlight")
    (local $mid i32)
    (call $hlBegin)
    (local.set $mid (i32.add (global.get $ptr)
      (i32.shr_u (i32.sub (global.get $end) (global.get $ptr)) (i32.const 1))))
    (global.set $end (local.get $mid))
    (call $hlTsx)
    (global.set $end (global.get $eof))
    (call $hlTsx)
    (call $hlEnd))
)`;
    const { code } = transformWat(watUrl, src);
    const highlighter = createHighlighter(
      new WebAssembly.Module(wat2wasm(watUrl.href, code))
    );
    const dec = new TextDecoder();
    const hlSub = (input: unknown, options?: TestHlOptions) =>
      dec.decode(
        highlighter.codeToHtml(input as string, {
          lang: 'tsx',
          theme: pierreDark,
          ...options,
        })
      );
    const tricky =
      'const s = \'ab\\ncd\' + `t${x + 1}y` /* c */ + <div a="v">t&amp;x{y}</div> // z';
    // leading padding walks the midpoint through every construct
    for (let pad = 0; pad < 2 * tricky.length; pad += 1) {
      checkInvariants(hlSub, ' '.repeat(pad) + tricky);
    }
  }
);

void t.test('tsx: unthemed types produce no span', () => {
  const theme = {
    name: 'min',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: { string: '#00ff00' },
    },
  };
  const bare = tsx.hl('let x = 1;', { theme });
  assert.equal(spansOf(bare).length, 0);
  assert.equal(textOf(bare), 'let x = 1;');
  const html = tsx.hl("let x = 'v';", { theme });
  assert.equal(spansOf(html).length, 1);
  assert.equal(spansOf(html)[0].color, '#00ff00');
});

void t.test('tsx: keyof and JSX division regressions', () => {
  // keyof before a paren is still the type operator
  assert.equal(
    colorOf(checkInvariants(tsx.hl, 'type K = keyof (typeof x);'), 'keyof'),
    KEYWORD
  );
  // a completed jsx element inside a container is an ended expression:
  // the following / divides, it does not open a regexp
  const out = checkInvariants(tsx.hl, 'let y = <a>{<b/> / 2}</a>;');
  assert.ok(
    !spansOf(out).some((s) => s.color === RX),
    'no regexp span expected'
  );
  assert.equal(colorOf(out, '2'), NUM);
});

void t.test('tsx: non-object themes throw a clean TypeError', () => {
  for (const theme of [null, 'str', 5, true] as unknown[]) {
    assert.throws(
      () => tsx.hl('let x = 1;', { theme: theme as Theme }),
      TypeError
    );
  }
});
