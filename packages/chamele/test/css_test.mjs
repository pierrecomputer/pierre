import assert from 'node:assert';
import t from 'node:test';

import {
  bodyOf,
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  textOf,
  themeColor,
} from './util.mjs';

let css = null;

t.before(() => {
  css = loadLang('css', '$hlCss');
});

// pierre-dark colors resolved from themes/pierre-dark.json (see themeColor)
const BG = themeColor('background');
const FG = themeColor('foreground');
const TAG = themeColor('tag');
const ATTRIBUTE = themeColor('attribute'); // also selector.class (.class)
const FUNCTION = themeColor('function'); // rgb(, var(, calc(, url( and selector.id (#id)
const OPERATOR = themeColor('operator'); // also keyword.operator, selector.pseudo
const DIRECTIVE = themeColor('keyword'); // @media, !important
const PROPERTY = themeColor('property');
const VALUE = themeColor('number');
const CONST = themeColor('constant.builtin'); // plain values, unquoted url bodies
const COLOR = themeColor('string.special'); // #hex colors
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const VARIABLE = themeColor('variable'); // --custom-prop
const PUNCT = themeColor('punctuation.bracket'); // also punctuation.delimiter
const COMMENT = themeColor('comment');
const NAMESPACE = themeColor('namespace');

t.test('css: wrapper carries the theme background and foreground', () => {
  const html = css.hl('a{}');
  assert.ok(
    html.startsWith(
      `<pre class="chamele" style="background-color:${BG};color:${FG}"><code>`
    )
  );
  assert.match(html, /<\/code><\/pre>$/);
});

t.test('css: empty input', () => {
  assert.equal(
    css.hl(''),
    `<pre class="chamele" style="background-color:${BG};color:${FG}"><code></code></pre>`
  );
});

t.test('css: selector kinds', () => {
  const html = checkInvariants(
    css.hl,
    '@namespace svg url("urn:svg"); svg|nav.menu#top:hover::before > *, em[data-k="1"] ~ input {}'
  );
  assert.equal(colorOf(html, 'svg'), NAMESPACE);
  assert.equal(colorOf(html, 'nav'), TAG);
  assert.equal(colorOf(html, '.menu'), ATTRIBUTE);
  assert.equal(colorOf(html, '#top'), FUNCTION);
  assert.equal(colorOf(html, ':hover'), OPERATOR);
  assert.equal(colorOf(html, '::before'), OPERATOR);
  assert.equal(colorOf(html, '>'), OPERATOR);
  assert.equal(colorOf(html, '*'), OPERATOR);
  assert.equal(colorOf(html, 'em'), TAG);
  assert.equal(colorOf(html, 'data-k'), ATTRIBUTE); // tag.attribute
  assert.equal(colorOf(html, '"1"'), STRING);
  assert.equal(colorOf(html, '~'), OPERATOR);
  assert.equal(colorOf(html, 'input'), TAG);
  assert.equal(colorOf(html, ','), PUNCT);
  assert.equal(colorOf(html, '{}'), PUNCT);
  const eq = spansOf(html).find((s) => s.text.includes('='));
  assert.equal(eq?.color, OPERATOR);
});

t.test('css: compound selectors and comma lists', () => {
  const html = checkInvariants(css.hl, 'h1, h2.big, h3 > small {}');
  assert.equal(colorOf(html, 'h1'), TAG);
  assert.equal(colorOf(html, '.big'), ATTRIBUTE);
  assert.equal(colorOf(html, 'small'), TAG);
});

t.test('css: attribute selector operators stay lossless', () => {
  for (const src of [
    'a[href^="https:"]{}',
    'a[lang|=en]{}',
    'img[alt~="x" i]{}',
    "b[q$='z']{}",
  ]) {
    const html = checkInvariants(css.hl, src);
    assert.equal(
      colorOf(html, 'href') ??
        colorOf(html, 'lang') ??
        colorOf(html, 'alt') ??
        colorOf(html, 'q'),
      ATTRIBUTE
    );
  }
});

t.test('css: nested CSS - nested selectors, & parent refs, combinators', () => {
  const src = `.card {
  color: red;
  .child { margin: 0 auto; }
  &:hover { top: 1px; }
  > .kid { left: 2px; }
  aside:focus { right: 3px; }
}`;
  const html = checkInvariants(css.hl, src);
  assert.equal(colorOf(html, '.card'), ATTRIBUTE);
  assert.equal(colorOf(html, 'color'), PROPERTY);
  assert.equal(colorOf(html, 'red'), CONST);
  assert.equal(colorOf(html, '.child'), ATTRIBUTE); // decided as nested selector
  assert.equal(colorOf(html, 'margin'), PROPERTY);
  assert.equal(spansOf(html).find((s) => s.text.trim() === '0')?.color, VALUE);
  assert.equal(colorOf(html, 'auto'), CONST);
  assert.equal(colorOf(html, '&'), OPERATOR);
  assert.equal(colorOf(html, ':hover'), OPERATOR);
  assert.equal(colorOf(html, 'top'), PROPERTY);
  assert.equal(colorOf(html, '1px'), VALUE);
  assert.equal(colorOf(html, '.kid'), ATTRIBUTE);
  // a nested selector that starts like a declaration would (`aside:focus`)
  const aside = spansOf(html).find((s) => s.text.trim() === 'aside');
  assert.equal(aside?.color, TAG);
  assert.equal(colorOf(html, ':focus'), OPERATOR);
  assert.equal(colorOf(html, 'right'), PROPERTY);
});

t.test(
  'css: last declaration without a semicolon is still a declaration',
  () => {
    const html = checkInvariants(css.hl, 'p { color: red }');
    assert.equal(colorOf(html, 'color'), PROPERTY);
    assert.equal(colorOf(html, 'red'), CONST);
  }
);

t.test('css: @media with feature queries', () => {
  const html = checkInvariants(
    css.hl,
    '@media screen and (min-width: 600px), print { body { margin: 0; } }'
  );
  assert.equal(colorOf(html, '@media'), DIRECTIVE);
  assert.equal(colorOf(html, 'screen'), CONST); // constant.builtin -> constant
  assert.equal(colorOf(html, 'and'), OPERATOR); // keyword.operator, like Zed
  assert.equal(colorOf(html, 'min-width'), PROPERTY);
  assert.equal(colorOf(html, '600px'), VALUE);
  assert.equal(colorOf(html, 'body'), TAG);
  assert.equal(colorOf(html, 'margin'), PROPERTY);
});

t.test('css: @import and @charset', () => {
  const html = checkInvariants(
    css.hl,
    '@import "theme.css";\n@charset "utf-8";'
  );
  assert.equal(colorOf(html, '@import'), DIRECTIVE);
  assert.equal(colorOf(html, '"theme.css"'), STRING);
  assert.equal(colorOf(html, '@charset'), DIRECTIVE);
});

t.test('css: @keyframes with % steps', () => {
  const html = checkInvariants(
    css.hl,
    '@keyframes spin { from { opacity: 0 } 50% { opacity: .5 } to { transform: rotate(360deg) } }'
  );
  assert.equal(colorOf(html, '@keyframes'), DIRECTIVE);
  assert.equal(colorOf(html, 'spin'), CONST); // prelude ident
  const from = spansOf(html).find((s) => s.text.trim() === 'from');
  assert.equal(from?.color, TAG);
  assert.equal(colorOf(html, '50%'), VALUE);
  assert.equal(colorOf(html, '.5'), VALUE);
  assert.equal(colorOf(html, 'rotate'), FUNCTION);
  assert.equal(colorOf(html, '360deg'), VALUE);
});

t.test('css: @supports', () => {
  const html = checkInvariants(
    css.hl,
    '@supports (display: grid) and (not (float: left)) { i {} }'
  );
  assert.equal(colorOf(html, '@supports'), DIRECTIVE);
  assert.equal(colorOf(html, 'display'), PROPERTY);
  assert.equal(colorOf(html, 'grid'), CONST);
  assert.equal(colorOf(html, 'float'), PROPERTY);
  assert.equal(
    spansOf(html).find((s) => s.text.trim() === 'and')?.color,
    OPERATOR
  );
  assert.equal(
    spansOf(html).find((s) => s.text.trim() === 'not')?.color,
    OPERATOR
  );
});

t.test('css: minified prelude operators glued to ( stay operators', () => {
  const html = checkInvariants(
    css.hl,
    '@supports(display:flex)and(gap:1px){a{color:red}}'
  );
  assert.equal(colorOf(html, '@supports'), DIRECTIVE);
  assert.equal(
    spansOf(html).find((s) => s.text.trim() === 'and')?.color,
    OPERATOR
  );
  assert.equal(colorOf(html, 'gap'), PROPERTY);
});

t.test(
  'css: a bare-declaration fragment at depth 0 colors as declarations',
  () => {
    const html = checkInvariants(css.hl, 'color: red;\nfont-size: 12px;');
    assert.equal(colorOf(html, 'color'), PROPERTY);
    assert.equal(colorOf(html, 'red'), CONST);
    assert.equal(colorOf(html, 'font-size'), PROPERTY);
    assert.equal(colorOf(html, '12px'), VALUE);
  }
);

t.test('css: nested @media inside a rule', () => {
  const html = checkInvariants(
    css.hl,
    '.a { @media (min-width: 10em) { gap: 1em; } }'
  );
  assert.equal(colorOf(html, '@media'), DIRECTIVE);
  assert.equal(colorOf(html, 'min-width'), PROPERTY);
  assert.equal(colorOf(html, 'gap'), PROPERTY);
});

t.test('css: numbers with units in every shape', () => {
  const html = checkInvariants(
    css.hl,
    '.n { margin: 1.5rem 80% 10px 0 -2px +3vh .5s 1e2q; }'
  );
  for (const n of ['1.5rem', '80%', '10px', '-2px', '+3vh', '.5s', '1e2q']) {
    assert.equal(colorOf(html, n), VALUE, n);
  }
});

t.test('css: hex colors 3/4/6/8 digits', () => {
  const html = checkInvariants(
    css.hl,
    '.h { color: #f00; border-color: #f00a #ff0000 #ff000080; }'
  );
  const spans = spansOf(html);
  for (const h of ['#f00', '#f00a', '#ff0000', '#ff000080']) {
    assert.ok(
      spans.some((s) => s.text.includes(h) && s.color === COLOR),
      h
    );
  }
});

t.test('css: function values, var() and calc() nesting', () => {
  const html = checkInvariants(
    css.hl,
    '.f { background: rgb(255 0 0) var(--main, #fff) calc((100% - 10px) / 3) translate(1px, 2%); }'
  );
  assert.equal(colorOf(html, 'rgb'), FUNCTION);
  assert.equal(colorOf(html, 'var'), FUNCTION);
  assert.equal(colorOf(html, '--main'), VARIABLE);
  assert.equal(colorOf(html, '#fff'), COLOR);
  assert.equal(colorOf(html, 'calc'), FUNCTION);
  assert.equal(colorOf(html, 'translate'), FUNCTION);
  assert.equal(colorOf(html, '100%'), VALUE);
  assert.equal(colorOf(html, '/'), OPERATOR);
  const minus = spansOf(html).find((s) => s.text.trim() === '-');
  assert.equal(minus?.color, OPERATOR);
});

t.test('css: custom property declaration and use', () => {
  const html = checkInvariants(
    css.hl,
    ':root { --main-color: #333; }\n.t { color: var(--main-color); }'
  );
  assert.equal(colorOf(html, ':root'), OPERATOR);
  assert.equal(colorOf(html, '--main-color'), VARIABLE);
  assert.equal(colorOf(html, '#333'), COLOR);
  const uses = spansOf(html).filter((s) => s.text.includes('--main-color'));
  assert.equal(uses.length, 2);
  assert.ok(uses.every((s) => s.color === VARIABLE));
});

t.test('css: url() quoted and unquoted', () => {
  const html = checkInvariants(
    css.hl,
    '.u { background-image: url("a b.png"), url(images/bg.png), url( spaced.png ); }'
  );
  const spans = spansOf(html);
  assert.equal(spans.filter((s) => s.text.includes('url')).length, 3);
  assert.ok(
    spans.every((s) => !s.text.includes('url') || s.color === FUNCTION)
  );
  assert.equal(colorOf(html, '"a b.png"'), STRING); // quoted body is a plain string
  assert.equal(colorOf(html, 'images/bg.png'), CONST); // constant.builtin, like Zed
  assert.equal(colorOf(html, 'spaced.png'), CONST);
});

t.test(
  'css: url() with a data: uri keeps the ; and , inside one url token',
  () => {
    const body = 'data:image/png;base64,iVBORw0KGgo+AAA==';
    const html = checkInvariants(
      css.hl,
      `.d { background: url(${body}) no-repeat; }`
    );
    const span = spansOf(html).find((s) => s.text.includes('base64'));
    assert.equal(span?.color, CONST);
    assert.ok(span.text.includes(body));
    assert.equal(colorOf(html, 'no-repeat'), CONST);
  }
);

t.test('css: !important', () => {
  const html = checkInvariants(
    css.hl,
    '.i { z-index: 10 !important; top: 0 ! important }'
  );
  assert.equal(colorOf(html, '!important'), DIRECTIVE); // keyword
  assert.equal(colorOf(html, 'z-index'), PROPERTY);
  const bang = spansOf(html).find((s) => s.text.trim() === '!');
  assert.equal(bang?.color, OPERATOR); // detached bang stays an operator
});

t.test('css: strings both quotes with escapes', () => {
  const html = checkInvariants(
    css.hl,
    String.raw`.q { content: "a\"b\2014 c" 'it\'s'; }`
  );
  assert.equal(colorOf(html, '"a'), STRING);
  const spans = spansOf(html);
  assert.ok(spans.some((s) => s.color === ESCAPE && s.text === '\\"'));
  assert.ok(spans.some((s) => s.color === ESCAPE && s.text === '\\2014')); // hex escape spans all its digits
  assert.ok(spans.some((s) => s.color === ESCAPE && s.text === "\\'"));
  assert.ok(spans.some((s) => s.color === STRING && s.text.includes('it')));
});

t.test(
  'css: escaped multibyte UTF-8 characters stay whole inside the escape span',
  () => {
    const html = checkInvariants(css.hl, ".q { content: 'a\\éx\\—b'; }");
    const spans = spansOf(html);
    assert.ok(spans.some((s) => s.color === ESCAPE && s.text === '\\é'));
    assert.ok(spans.some((s) => s.color === ESCAPE && s.text === '\\—'));
    assert.ok(spans.some((s) => s.color === STRING && s.text === 'x'));
  }
);

t.test('css: unterminated string stops at the line break', () => {
  const html = checkInvariants(css.hl, ".q { content: 'abc\ndef; }");
  assert.equal(colorOf(html, "'abc"), STRING);
  assert.equal(colorOf(html, 'def'), CONST); // reparsed as a value ident
});

t.test('css: font shorthand slash and 12px/1.5', () => {
  const html = checkInvariants(
    css.hl,
    '.s { font: 12px/1.5 "Fira Sans", sans-serif; }'
  );
  assert.equal(colorOf(html, '12px'), VALUE);
  assert.equal(colorOf(html, '1.5'), VALUE);
  assert.equal(colorOf(html, '"Fira Sans"'), STRING);
  assert.equal(colorOf(html, 'sans-serif'), CONST);
});

t.test('css: comments everywhere', () => {
  const html = checkInvariants(
    css.hl,
    '/* top */ .x /* mid-selector */ { color /* in-prop */ : /* pre-value */ red; /* tail */ }'
  );
  for (const c of [
    '/* top */',
    '/* mid-selector */',
    '/* in-prop */',
    '/* pre-value */',
    '/* tail */',
  ]) {
    assert.equal(colorOf(html, c), COMMENT, c);
  }
  assert.equal(colorOf(html, '.x'), ATTRIBUTE);
  assert.equal(colorOf(html, 'color'), PROPERTY); // decider skipped the comments
  assert.equal(colorOf(html, 'red'), CONST);
});

t.test('css: comment lookahead does not cross $end', () => {
  const prefix = 'x/';
  const ranged = loadLang('css', '$hlCss', prefix.length);
  const html = checkInvariants(ranged.hl, prefix + '*y');
  assert.equal(colorOf(html, '/'), colorOf(css.hl(prefix), '/'));
});

t.test('css: custom-property lookahead does not cross $end', () => {
  const prefix = 'x:-';
  const ranged = loadLang('css', '$hlCss', prefix.length);
  const html = checkInvariants(ranged.hl, prefix + '-y');
  assert.equal(colorOf(html, '-'), colorOf(css.hl(prefix), '-'));
});

t.test('css: numeric lookahead does not cross $end', () => {
  const prefix = 'x:+.';
  const ranged = loadLang('css', '$hlCss', prefix.length);
  const html = checkInvariants(ranged.hl, prefix + '1');
  const standalone = css.hl(prefix);
  assert.equal(colorOf(html, '+'), colorOf(standalone, '+'));
  assert.equal(colorOf(html, '.'), colorOf(standalone, '.'));
});

t.test('css: pseudo functions and nth arguments', () => {
  const html = checkInvariants(css.hl, 'li:nth-child(2n+1):not(.done) {}');
  assert.equal(colorOf(html, ':nth-child'), OPERATOR);
  assert.equal(colorOf(html, '2n'), VALUE);
  assert.equal(colorOf(html, '1'), VALUE);
  assert.equal(colorOf(html, ':not'), OPERATOR);
  assert.equal(colorOf(html, '.done'), ATTRIBUTE);
});

t.test('css: html-special bytes are escaped', () => {
  const html = checkInvariants(css.hl, 'a > b { content: "<&>"; }');
  assert.ok(bodyOf(html).includes('&lt;&amp;&gt;'));
  assert.ok(bodyOf(html).includes('&gt;')); // the combinator
});

t.test('css: adjacent same-color tokens merge into one span', () => {
  const html = css.hl('div span');
  assert.equal(spansOf(html).length, 1);
  assert.equal(spansOf(html)[0].text, 'div span');
  const brackets = css.hl('a{}');
  const spans = spansOf(brackets);
  assert.equal(spans.length, 2);
  assert.equal(spans[1].text, '{}');
  const ids = css.hl('#a #b');
  assert.equal(spansOf(ids).length, 1);
  assert.equal(spansOf(ids)[0].text, '#a #b');
});

t.test('css: non-ascii bytes are identifier characters', () => {
  const html = checkInvariants(css.hl, '.clàss { còlor: rèd; }');
  assert.equal(colorOf(html, '.clàss'), ATTRIBUTE);
  assert.equal(colorOf(html, 'còlor'), PROPERTY);
  assert.equal(colorOf(html, 'rèd'), CONST);
});

t.test('css: lenient on malformed input, still lossless', () => {
  for (const src of [
    '{',
    '}',
    ';',
    ':',
    '@',
    '@media',
    '@media (min-width: 600px',
    'a {',
    'a { color',
    'a { color:',
    'a { color: red',
    '"unterminated',
    "'unterminated",
    '/*',
    '/* unterminated',
    '*/',
    '/',
    'a { /* }',
    '.',
    '#',
    '..',
    'a[',
    'a[href',
    'a[href="x',
    'a]',
    'url(',
    'a { background: url(',
    'a { background: url(x',
    "a { background: url('y",
    '!',
    'a { x: !',
    '--',
    'a { --',
    'a { --x',
    'a { --x: {ok: 1} }',
    '0',
    '50%',
    '-',
    '-5',
    'a { b: 1e',
    'a { b: .',
    'a { b: c }}}',
    ';;;',
    ':::',
    'a\\{b',
    '\\',
    'x { y: "\\',
    '@#!%^&*',
    'p { color: red; } garbage } { ;',
    '\n\n\n',
    '   ',
    'a { b: c; d: e }',
    'éé { kéy: vál }',
  ]) {
    checkInvariants(css.hl, src);
  }
});

t.test('css: large realistic stylesheet (SIMD paths)', () => {
  const rules = [];
  rules.push(`/* ${'long comment '.repeat(200)} */`);
  for (let i = 0; i < 120; i++) {
    rules.push(
      `.card-${i}[data-idx="${i}"] > .body:nth-child(${i}n+2)::after {\n` +
        `  margin: ${i}.5px ${i}% auto;\n` +
        `  color: #ab${i % 10}def;\n` +
        `  background: url(data:image/svg+xml;base64,${'QUJD'.repeat(60)}) no-repeat;\n` +
        `  content: "block ${'x'.repeat(120)} ${i}";\n` +
        `  width: calc(100% - ${i}px) !important;\n` +
        `}`
    );
    if (i % 10 === 0) {
      rules.push(
        `@media screen and (min-width: ${i * 10}px) { .r${i} { --gap-${i}: ${i}rem; gap: var(--gap-${i}); } }`
      );
    }
  }
  const big = rules.join('\n');
  const html = checkInvariants(css.hl, big);
  assert.ok(html.length > big.length);
  assert.equal(colorOf(html, 'long comment'), COMMENT);
  assert.equal(colorOf(html, '--gap-0'), VARIABLE);
});

t.test('css: unthemed types produce no span', () => {
  const theme = {
    name: 'min',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: { string: '#00ff00' },
    },
  };
  const bare = css.hl('.a { b: c; }', { theme });
  assert.equal(spansOf(bare).length, 0);
  assert.equal(textOf(bare), '.a { b: c; }');
  const html = css.hl('.a { content: "v"; }', { theme });
  assert.equal(spansOf(html).length, 1);
  assert.equal(spansOf(html)[0].color, '#00ff00');
});
