import assert from 'node:assert/strict';
import test from 'node:test';

import { createHtmlRenderer } from '../dist/html.js';
import {
  createHtmlSession,
  renderToAnsi,
  renderToHtml,
} from '../dist/index.js';
import { createMermaidPlugin } from '../dist/mermaid.js';

const dec = new TextDecoder();
const html = (md: string, options?: { cjk?: boolean; math?: boolean }) =>
  dec.decode(renderToHtml(md, options));
// The glyphs of an SVG, in order.
const glyphs = (out: string): string =>
  [...out.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join('');

void test('cjk lets emphasis flank CJK text', () => {
  const cases = [
    [
      '**このアスタリスクは強調記号として認識されず、そのまま表示されます。**この文のせいで。',
      '<strong>このアスタリスクは強調記号として認識されず、そのまま表示されます。</strong>この文のせいで。',
    ],
    [
      '**该星号不会被识别，而是直接显示。**这是因为',
      '<strong>该星号不会被识别，而是直接显示。</strong>这是因为',
    ],
    [
      '**이 별표는 (괄호 때문에)**이 문장 때문에.',
      '<strong>이 별표는 (괄호 때문에)</strong>이 문장 때문에.',
    ],
    ['~~削除。~~です', '<del>削除。</del>です'],
    // an ideographic variation selector belongs to the CJK character before it
    ['**「葛\u{E0100}」**です', '<strong>「葛\u{E0100}」</strong>です'],
  ];
  for (const [source, expected] of cases) {
    assert.equal(html(source, { cjk: true }), `<p>${expected}</p>\n`);
    assert.doesNotMatch(html(source), /<(strong|del)>/);
  }
  // `_` and non-CJK text keep the CommonMark rules
  assert.equal(
    html('__日本語。__です', { cjk: true }),
    '<p>__日本語。__です</p>\n'
  );
  // A variation selector stands for the character before it, for `_` too,
  // unless that character is a space separator; tab and LF are not.
  assert.equal(html('☺\uFE0E_foo_'), '<p>☺\uFE0E_foo_</p>\n');
  assert.equal(
    html('☺\uFE0E_foo_', { cjk: true }),
    '<p>☺\uFE0E<em>foo</em></p>\n'
  );
  assert.equal(html('*a\t\uFE00*b', { cjk: true }), '<p>*a\t\uFE00*b</p>\n');
  assert.equal(
    html('\u3000\uFE00*(a)*', { cjk: true }),
    '<p>\u3000\uFE00<em>(a)</em></p>\n'
  );
  assert.equal(
    html('a**"b"**c', { cjk: true }),
    '<p>a**&quot;b&quot;**c</p>\n'
  );
  assert.ok(
    dec
      .decode(renderToAnsi('**強調。**です', { cjk: true }))
      .includes('\u001b[1m強調。')
  );
});

void test('cjk completion repairs runs between CJK characters', () => {
  const render = (source: string, cjk: boolean) =>
    createHtmlSession().render(source, { incomplete: true, cjk }).html;
  assert.equal(
    render('**中文。**这是**未完', true),
    '<p><strong>中文。</strong>这是<strong>未完</strong></p>\n'
  );
  assert.equal(render('这是**未完', false), '<p>这是**未完</p>\n');
  // other intraword runs are often arithmetic
  assert.equal(render('a**b', true), '<p>a**b</p>\n');
  // as in a full render, `_` after a variation selector sees the base character
  assert.equal(render('☺\uFE0E_foo', true), '<p>☺\uFE0E<em>foo</em></p>\n');
});

void test('math is off by default', () => {
  assert.equal(html('$x$ and $$y$$'), '<p>$x$ and $$y$$</p>\n');
  assert.equal(html('$$\nx\n$$'), '<p>$$\nx\n$$</p>\n');
});

void test('inline math renders as SVG', () => {
  const out = html('Euler $e^{i\\pi}+1=0$.', { math: true });
  assert.match(
    out,
    /^<p>Euler <svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+em"/
  );
  assert.match(
    out,
    /style="display:inline;vertical-align:-?[\d.]+em;overflow:visible"/
  );
  assert.match(out, /role="img" aria-label="e\^\{i\\pi\}\+1=0"/);
  assert.equal(glyphs(out), '𝑒𝑖𝜋+1=0');
  assert.match(out, /<\/svg>\.<\/p>\n$/);
  // `$$` in a paragraph is display math
  assert.match(html('$$\\sum_i i$$', { math: true }), /style="display:block;/);
});

void test('single dollars follow the pandoc rules', () => {
  const plain = [
    'costs $5 and $10',
    '$ x$',
    '$x $',
    // Unicode spaces count too: ideographic space and no-break space
    '$\u3000x$',
    '$x\u3000$',
    '$\u00a0x$',
    '$x$5',
    '\\$x$',
    '$$$x$$$',
  ];
  for (const source of plain)
    assert.doesNotMatch(html(source, { math: true }), /<svg/, source);
  assert.match(html('$x$, $2^n$', { math: true }), /<svg[^]*<svg/);
  // a `$` that cannot close leaves its opener as text; later math still pairs
  for (const source of [
    'It costs $5 and $x$ is the count',
    'Pay $5, $10 or $20 if $x$ holds',
    '$1 $2 $x$',
    '$y$5 and $x$',
  ]) {
    const out = html(source, { math: true });
    assert.deepEqual(
      [...out.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]),
      ['x'],
      source
    );
  }
  assert.equal(glyphs(html('$\\#\\%$', { math: true })), '#%');
  // a backslash escape inside math belongs to TeX
  assert.equal(glyphs(html('$\\$5 \\{x\\}$', { math: true })), '$5{𝑥}');
  // math takes precedence over emphasis and code inside it
  assert.equal(glyphs(html('$a*b*c$ `$`', { math: true })), '𝑎∗𝑏∗𝑐');
});

void test('math blocks: $$ fences and math code fences', () => {
  for (const source of [
    '$$\n\\frac{a}{b}\n$$',
    '```math\n\\frac{a}{b}\n```',
    '- $$\n  \\frac{a}{b}\n  $$',
  ]) {
    const out = html(source, { math: true });
    assert.match(
      out,
      /<svg[^>]*style="display:block;margin:1em auto;overflow:visible"/,
      source
    );
    assert.equal(glyphs(out), '𝑎𝑏', source);
    assert.match(out, /<rect /, source);
  }
  // an unclosed fence runs to the end, like code
  assert.equal(glyphs(html('$$\nx^2', { math: true })), '𝑥2');
  // text after the opening `$$` and before the closing `$$` is math
  for (const source of [
    '$$x^2\n+ y$$\n\nafter',
    '$$x^2\n+ y\n$$\nafter',
    '$$\nx^2\n+ y $$\nafter',
    '$$x^2\r\n+ y$$\r\nafter',
  ]) {
    const out = html(source, { math: true });
    assert.equal(glyphs(out), '𝑥2+𝑦', source);
    assert.match(out, /^<svg[^]*<\/svg>\n<p>after<\/p>\n$/, source);
  }
  assert.match(
    html('- $$x^2\n  + y$$\n- b', { math: true }),
    /<li>\n<svg[^]*<\/svg>\n<\/li>\n<li>b<\/li>/
  );
  assert.equal(glyphs(html('$$x^2 + y', { math: true })), '𝑥2+𝑦');
  assert.doesNotMatch(html('$$$\nx\n$$$', { math: true }), /<svg/);
  // a `$$` line with more dollars is a paragraph
  assert.match(html('$$ a $$ b', { math: true }), /^<p><svg/);
  // a math block holds no blank line, so a stray `$$` line stays text
  assert.equal(
    html('Total\n$$100 off\n\nNext\n\n# H', { math: true }),
    '<p>Total\n$$100 off</p>\n<p>Next</p>\n<h1>H</h1>\n'
  );
  // in a quote, a `>` line is that blank line
  assert.equal(
    html('> $$\n> x\n>\n> y\n> $$', { math: true }),
    '<blockquote>\n<p>$$\nx</p>\n<p>y\n$$</p>\n</blockquote>\n'
  );
  assert.match(
    html('> - $$\n>   x\n>\n>   y', { math: true }),
    /<li>\n<p>\$\$\nx<\/p>/
  );
  // a lone `$$` needs a later line, so a last `$$` stays text
  for (const source of ['a\n$$', '$$\n', '> a\n> $$', '$$\nx\n\ny\n$$'])
    assert.doesNotMatch(html(source, { math: true }), /<svg/, source);
  // the closing line must continue the opener's containers
  assert.equal(
    html('- $$\nword', { math: true }),
    '<ul>\n<li>$$\nword</li>\n</ul>\n'
  );
  // a later `$$` line outside the item is no closer: the item holds text
  // with inline display math
  assert.match(
    html('- $$\n  x\nword $$', { math: true }),
    /^<ul>\n<li><svg[^]*<\/svg><\/li>\n<\/ul>\n$/
  );
  for (const source of [
    '-\t$$\n\tx\n\t$$',
    '>\t$$\n>\tx $$',
    '1. > $$\n   > x\n   > $$',
  ])
    assert.equal(glyphs(html(source, { math: true })), '𝑥', source);
  // the closing line drops its indent everywhere
  for (const source of ['$$\n  x $$', '> $$\n>   x $$'])
    assert.match(html(source, { math: true }), /aria-label="x \n"/, source);
  // openers in and out of quotes do not rescan each other's lines
  const mixed = '$$ a\n> $$ a\n'.repeat(20000) + '\nend';
  assert.match(html(mixed, { math: true }), /^<p>/);
  const nested = '> $$ a\n> > $$ a\n'.repeat(20000) + '\nend';
  assert.match(html(nested, { math: true }), /^<blockquote>/);
  const items = '- x\n' + '  $$ a\n'.repeat(50000) + '\nend';
  assert.match(html(items, { math: true }), /^<ul>/);
  // `\$$` is an escaped dollar, not the closing `$$`
  assert.equal(glyphs(html('$$\nx = 5\\$$\ny\n$$', { math: true })), '𝑥=5$𝑦');
  assert.match(
    html('$$\na \\\\$$\nafter', { math: true }),
    /<\/svg>\n<p>after/
  );
  // other fences stay code
  assert.match(
    html('```tex\nx\n```', { math: true }),
    /<code class="language-tex">/
  );
});

void test('math layout covers common constructs', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  assert.equal(glyphs(svg('\\alpha\\beta\\Gamma')), '𝛼𝛽Γ');
  assert.equal(
    glyphs(svg('\\mathbb{R}\\mathbf{v}\\mathcal{L}\\mathrm{d}x')),
    'ℝ𝐯ℒd𝑥'
  );
  assert.equal(glyphs(svg('a\\le b \\ne c \\not\\in d')), '𝑎≤𝑏≠𝑐∉𝑑');
  assert.equal(glyphs(svg('\\lim_{x\\to 0}')), 'lim𝑥→0');
  assert.match(svg('\\lim_{x\\to 0}'), />lim<\/text>/);
  assert.match(svg('\\sqrt[3]{x}'), /<path /);
  assert.match(svg('\\left( \\frac{a}{b} \\right)'), /<path d="M/);
  // an accent over one letter takes scripts as the letter does
  const subY = (tex: string) =>
    /<text[^>]*font-size="700"[^>]*>/.exec(svg(tex))?.[0];
  assert.equal(subY('\\hat{y}_c'), subY('y_c'));
  assert.notEqual(subY('{y}_c'), subY('y_c'));
  // fractions are ordinary atoms: no space before an opening parenthesis
  assert.match(svg('\\frac{1}{2}(x)'), /<text x="740" y="0">\(/);
  // `\over` splits its group into the same fraction as `\frac`
  assert.equal(
    svg('x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}').replace(
      /aria-label="[^"]*"/,
      ''
    ),
    svg('x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}').replace(
      /aria-label="[^"]*"/,
      ''
    )
  );
  assert.equal(
    svg('\\left( a \\over b \\right) + {{a \\over b} \\over c}').replace(
      /aria-label="[^"]*"/,
      ''
    ),
    svg('\\left( \\frac{a}{b} \\right) + \\frac{\\frac{a}{b}}{c}').replace(
      /aria-label="[^"]*"/,
      ''
    )
  );
  assert.match(
    svg('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'),
    /<path d="M/
  );
  assert.equal(
    glyphs(svg('\\begin{cases} a & b \\\\ c & d \\end{cases}')),
    'abcd'.replace(/./g, (c) =>
      String.fromCodePoint(0x1d44e + c.charCodeAt(0) - 97)
    )
  );
  assert.match(svg('\\text{if } x'), /style="white-space:pre">if <\/text>/);
  assert.match(svg('\\color{red}{x}'), /<g color="red" fill="red">/);
  // colors that could leave the attribute are dropped
  assert.doesNotMatch(svg('\\color{red" onload="x}{x}'), /<g color/);
  // an unknown command shows in red
  assert.match(
    svg('\\foo x'),
    /<g color="#c00" fill="#c00"><text[^>]*>\\foo<\/text>/
  );
  // a backslash before a multibyte character keeps it whole
  assert.match(
    svg('\\é'),
    /<g color="#c00" fill="#c00"><text[^>]*>\\é<\/text>/
  );
  assert.equal(glyphs(svg('\\text{\\é}')), 'é');
  // invalid UTF-8 after a backslash reads as the host decodes it
  const bytes = Uint8Array.of(0x24, 0x5c, 0xf0, 0x9f, 0x24);
  assert.equal(
    dec.decode(renderToHtml(bytes, { math: true })),
    html(dec.decode(bytes), { math: true })
  );
  assert.equal(glyphs(svg('a\\lt b\\gt c')), '𝑎&lt;𝑏&gt;𝑐');
  // \displaylimits puts the scripts of an integral above and below it
  assert.equal(
    svg('\\int\\displaylimits_a^b').replace(/aria-label="[^"]*"/, ''),
    svg('\\int\\limits_a^b').replace(/aria-label="[^"]*"/, '')
  );
  // \boxed sets its argument in display style, even inline
  assert.doesNotMatch(
    html('$\\boxed{\\frac{a}{b}}$', { math: true }),
    /font-size="700"/
  );
  // a NUL byte is U+FFFD, not the end of the formula
  assert.equal(glyphs(svg('a\0b')), '𝑎\ufffd𝑏');
  // huge dimensions stop at 1000em instead of overflowing
  assert.match(svg('a\\kern{3000in}b'), /<text x="1000560" y="0">𝑏/);
});

void test('math supports the KaTeX symbols and aliases', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  const strip = (tex: string) => svg(tex).replace(/aria-label="[^"]*"/, '');
  assert.equal(glyphs(svg('\\hbar')), 'ℏ');
  assert.equal(glyphs(svg('\\N\\R\\Z\\Complex\\Bbbk')), 'ℕℝℤℂ𝕜');
  assert.equal(glyphs(svg('\\Alpha\\Beta\\mathbf{\\Alpha}')), 'ΑΒ𝚨');
  assert.equal(glyphs(svg('\\lrArr\\llbracket\\lBrace\\nprec')), '⇔⟦⦃⊀');
  assert.equal(strip('a\\sub b\\isin c'), strip('a\\subset b\\in c'));
  assert.equal(glyphs(svg('\\textdollar\\textendash\\ss')), '$–ß');
  assert.equal(glyphs(svg('\\text{\\textdollar 5}')), '$5');
  assert.equal(glyphs(svg('\\H{o}\\v{c}')), '𝑜˝𝑐ˇ');
  assert.equal(glyphs(svg('\\argmax_x')), 'arg max𝑥'.replace(' ', ''));
  // \argmax and \plim take limits below like \lim
  assert.match(
    svg('\\argmax_x'),
    /<text x="[^"]*" y="[1-9][^"]*" font-size="700">𝑥/
  );
  assert.match(svg('a \\coloneq b'), />∶<\/text>/);
  assert.match(svg('\\TeX'), /T<\/text>.*E<\/text>.*X<\/text>/);
  // no command of the KaTeX sets is unknown, except the skipped ones
  for (const name of ['\\varliminf', '\\dddot', '\\utilde', '\\Overrightarrow'])
    assert.doesNotMatch(svg(`${name}{x}`), /#c00/);
  assert.match(svg('\\def'), /#c00/);
});

void test('math macros take their argument and fit their buffer', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  const strip = (tex: string) => svg(tex).replace(/aria-label="[^"]*"/, '');
  assert.equal(strip('\\bra{\\psi}'), strip('\\mathinner{\\langle{\\psi}|}'));
  assert.equal(strip('\\bra\\psi'), strip('\\bra{\\psi}'));
  // \set puts \mid for a top-level |, \Set and \Braket a \middle bar
  assert.equal(strip('\\set{x|y}'), strip('\\{\\,x\\mid y\\,\\}'));
  assert.equal(
    strip('\\Set{x|y}'),
    strip('\\left\\{\\:x\\;\\middle|\\;y\\:\\right\\}')
  );
  assert.equal(strip('\\set{\\{a|b\\}}'), strip('\\{\\,\\{a\\mid b\\}\\,\\}'));
  assert.equal(strip('\\set{{a|b}}'), strip('\\{\\,{a|b}\\,\\}'));
  assert.equal(
    strip('\\sum_{\\substack{i<m\\\\j<n}}'),
    strip('\\sum_{\\begin{subarray}{c}i<m\\\\j<n\\end{subarray}}')
  );
  // nested expansions that outgrow the buffer fail instead of writing past it
  assert.match(svg('\\bra{'.repeat(80) + 'x'), /<code>/);
  const long = '\\text{' + 'y'.repeat(15300) + '}\\bra{';
  assert.match(svg(long + 'y'.repeat(50) + '}'), /<svg/);
  assert.match(svg(long + 'y'.repeat(600) + '}'), /<code>/);
  assert.match(svg('\\text{\\bf a}'.repeat(300)), /<svg/);
});

void test('math fractions: infix forms and \\genfrac', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  const strip = (tex: string) => svg(tex).replace(/aria-label="[^"]*"/, '');
  assert.equal(strip('{n \\choose k}'), strip('\\binom{n}{k}'));
  assert.equal(strip('{a \\over b}'), strip('\\genfrac{}{}{}{}{a}{b}'));
  assert.equal(strip('{a \\atop b}'), strip('\\genfrac{}{}{0pt}{}{a}{b}'));
  assert.equal(strip('{a \\brack b}'), strip('\\genfrac[]{0pt}{}{a}{b}'));
  assert.equal(strip('{a \\brace b}'), strip('\\genfrac\\{\\}{0pt}{}{a}{b}'));
  assert.equal(strip('\\tbinom{a}{b}'), strip('\\genfrac(){0pt}{1}{a}{b}'));
  // \above takes the rule thickness
  assert.match(svg('{a \\above 2pt b}'), /<rect [^>]*height="200"\/>/);
  // an \over in a macro argument splits only that argument
  assert.match(svg('\\set{a \\over b}'), /<rect /);
  // nested numerators are split once each, not once per enclosing split
  let nested = 'a';
  for (let i = 0; i < 16; i++) nested = `{${nested}\\over b}`;
  assert.equal(svg(nested).match(/<rect /g)?.length, 16);
  // the first pass before a split frees its nodes, so a numerator is as
  // long as a whole formula can be
  const terms = Array.from({ length: 280 }, (_, i) => `a_${i}`).join('+');
  assert.match(svg(`{${terms}\\over 2}`), /<rect /);
});

void test('math boxes, lines and laps', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  assert.match(
    svg('\\colorbox{yellow}{x}'),
    /<g color="yellow" fill="yellow"><rect /
  );
  assert.match(
    svg('\\fcolorbox{red}{blue}{x}'),
    /<g color="blue" fill="blue"><rect [^>]*\/><\/g><g color="red" fill="red"><path /
  );
  // colors that could leave the attribute are dropped
  assert.doesNotMatch(svg('\\colorbox{red" x="}{x}'), /<g color|<rect /);
  // \cancel draws a slash, \bcancel a backslash, \xcancel both; no size added
  const lines = (tex: string) => (svg(tex).match(/<path /g) ?? []).length;
  assert.equal(lines('\\cancel{x}'), 1);
  assert.equal(lines('\\xcancel{x}'), 2);
  const size = (tex: string) =>
    /width="[^"]*" height="[^"]*"/.exec(svg(tex))![0];
  assert.equal(size('\\cancel{a+b}'), size('a+b'));
  assert.equal(size('\\xcancel{x}'), size('x'));
  assert.match(svg('\\sout{x}'), /<rect /);
  // laps take no width
  const width = (tex: string) => /width="([^"]*)"/.exec(svg(tex))![1];
  assert.equal(width('a\\mathllap{bbb}'), width('a'));
  assert.equal(width('a\\rlap{bbb}'), width('a'));
  assert.match(
    svg('\\rule{1em}{2em}'),
    /<rect x="0" y="-2000" width="1000" height="2000"\/>/
  );
  assert.match(svg('\\rule{-1em}{1em}'), /width="0"/);
  assert.match(svg('\\raisebox{1em}{x}'), /<text x="0" y="-1000"/);
});

void test('math font switches and bold text', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  // \bf sets the rest of its group; a group or an argument ends it
  assert.equal(glyphs(svg('{a \\bf b} c')), '𝑎𝐛𝑐');
  assert.equal(glyphs(svg('\\frac{\\bf a}{b}')), '𝐚𝑏');
  assert.equal(glyphs(svg('\\left( \\rm a \\right) a')), '(a)𝑎');
  assert.equal(glyphs(svg('\\cal A \\sf B \\tt C \\it D')), '𝒜𝖡𝙲𝐷');
  assert.equal(glyphs(svg('\\mathsfit{Ab}')), '𝘈𝘣');
  // bold text prints math bold letters, digits and Greek, and strokes the rest
  assert.equal(glyphs(svg('\\textbf{Ab1}')), '𝐀𝐛𝟏');
  assert.match(
    svg('\\textbf{a!}'),
    /𝐚<tspan stroke="currentColor" stroke-width="30">!<\/tspan>/
  );
  // a run of stroked characters, with its spaces, shares one tspan
  assert.match(
    svg('\\textbf{中文， 标点!a}'),
    />中文， 标点!<\/tspan>𝐚<\/text>/
  );
  assert.equal(glyphs(svg('\\text{a \\bf b} c')), 'a 𝐛𝑐');
  assert.equal(glyphs(svg('\\text{\\mathbf{x}y}')), '𝐱y');
  assert.equal(glyphs(svg('\\textbf{\\textit{x}}')), '𝒙');
  assert.doesNotMatch(svg('\\textbf{\\textit{x}}'), /font-style/);
  assert.match(
    svg('\\texttt{\\textbf{x}}'),
    /font-weight="bold"[^>]*font-family="monospace"/
  );
});

void test('math arrows, braces and accents of KaTeX', () => {
  const svg = (tex: string) => html(`$$${tex}$$`, { math: true });
  const d = (tex: string) => /<path [^>]*d="([^"]*)"/.exec(svg(tex))![1];
  // a double arrow has two shafts
  assert.equal(d('\\xRightarrow{f}').match(/L/g)!.length, 4);
  // harpoons have one barb, two-way harpoons one each
  assert.equal(d('\\xrightharpoonup{f}').match(/[ML]/g)!.length, 4);
  assert.equal(d('\\xrightleftharpoons{f}').match(/[ML]/g)!.length, 8);
  assert.match(svg('\\overbracket{ab}^n'), /<path [^>]*d="M[^"]*L[^"]*L[^"]*L/);
  // under shapes go below the body; braces take limits, other shapes scripts
  assert.match(svg('\\underleftarrow{ab}'), /d="M0 [1-9]/);
  assert.equal(
    svg('\\overleftrightarrow{x}_1').replace(/aria-label="[^"]*"/, ''),
    svg('{\\overleftrightarrow{x}}_1').replace(/aria-label="[^"]*"/, '')
  );
  assert.match(svg('\\dddot{x}'), /(˙<\/text>.*){3}/);
});

void test('math escapes its source and output', () => {
  const out = html('$a<b>c&d$', { math: true });
  assert.match(out, /aria-label="a&lt;b&gt;c&amp;d"/);
  assert.match(out, />&lt;</);
  assert.doesNotMatch(out, /<b>/);
  // text in \text{} is escaped too
  assert.match(html('$\\text{<i>}$', { math: true }), />&lt;i&gt;</);
});

void test('a formula that overflows leaves no state behind', () => {
  // an overflowing formula writes node 0, which stands for "no box"
  const after = html(
    `$$\n${'\\boxed{x}'.repeat(1500)}\n$$\n\n$\\xrightarrow{a}$`,
    {
      math: true,
    }
  );
  assert.equal(
    after.slice(after.lastIndexOf('<p>')),
    html('$\\xrightarrow{a}$', { math: true })
  );
});

void test('formulas that do not fit show as code', () => {
  const deep = `$$${'{'.repeat(200)}x$$`;
  assert.equal(
    html(deep, { math: true }),
    `<p><code>${'{'.repeat(200)}x</code></p>\n`
  );
  const big = `$$\n${'x'.repeat(20000)}\n$$`;
  assert.match(
    html(big, { math: true }),
    /^<pre><code class="language-|^<pre><code>/
  );
});

void test('unmatched dollars do not rescan the paragraph', () => {
  const prices = '$1 '.repeat(50000);
  assert.equal(html(prices, { math: true }), `<p>${prices.trimEnd()}</p>\n`);
  // each unclosed `$$` line must not scan to the blank line again
  const openers = '$$a b\n'.repeat(50000) + '\nend';
  assert.match(html(openers, { math: true }), /^<p>/);
});

void test('completion leaves math alone', () => {
  const render = (source: string) =>
    createHtmlSession()
      .render(source, { incomplete: true, math: true })
      .html.replace(/<svg[^]*?<\/svg>/g, 'M');
  // closed math is literal
  assert.equal(render('For $x \\in [0, 1)$ we have'), '<p>For M we have</p>\n');
  assert.equal(
    render('Let $f^*(x)$ be the dual and'),
    '<p>Let M be the dual and</p>\n'
  );
  assert.equal(
    render('The set $\\{x_i\\}_{i=1}^n$ is `code'),
    '<p>The set M is <code>code</code></p>\n'
  );
  // open math gets no repair inside, and what opened before it still closes
  assert.equal(render('Let $f^*(x'), '<p>Let $f^*(x</p>\n');
  assert.equal(render('where $$x_i [a'), '<p>where $$x_i [a</p>\n');
  assert.equal(
    render('**the dual $f^*(x'),
    '<p><strong>the dual $f^*(x</strong></p>\n'
  );
  // open math is text for now, so what follows it still pairs
  assert.equal(render('**a $b** c'), '<p><strong>a $b</strong> c</p>\n');
  assert.equal(render('*a $b* c'), '<p><em>a $b</em> c</p>\n');
  assert.equal(
    render('[a $x]('),
    '<p><a data-markdown-incomplete>a $x</a></p>\n'
  );
  // a link after open math stops the bracket around it from being one
  assert.equal(render('[x]: /u\n\n[$$ [x]'), '<p>[$$ <a href="/u">x</a></p>\n');
  // repair never turns a `$$` line into a math block
  assert.equal(
    render('[a\n$$\n '),
    '<p><a data-markdown-incomplete>a\n$$\n</a></p>\n'
  );
  assert.equal(
    render('[a\n$$b](c$'),
    '<p><a data-markdown-incomplete>a\n$$b</a></p>\n'
  );
  // a price is text, so repair goes on after it
  assert.equal(
    render('costs $5 and **bold'),
    '<p>costs $5 and <strong>bold</strong></p>\n'
  );
  // an open display block shows the formula so far
  assert.equal(render('$$\\frac{a}{b}'), 'M\n');
});

void test('unknown commands are gray while the block is open', () => {
  const color = (source: string) =>
    /<g color="(#\w+)"/.exec(
      createHtmlSession().render(source, { incomplete: true, math: true }).html
    )?.[1];
  assert.equal(color('$$\n\\fra'), '#888');
  assert.equal(color('```math\n\\begi'), '#888');
  assert.equal(color('$$\n\\fra\n$$'), '#c00');
  assert.equal(color('```math\n\\begi\n```'), '#c00');
});

void test('math in ANSI and alt text shows its source', () => {
  const ansi = dec.decode(renderToAnsi('a $x^2$ b', { math: true }));
  assert.match(ansi, /x\^2/);
  assert.doesNotMatch(ansi, /<svg/);
  assert.match(html('![a $x^2$](p.png)', { math: true }), /alt="a x\^2"/);
});

void test('sessions and the HTML renderer stream math', () => {
  const doc =
    'Euler $e^{i\\pi}+1=0$ and **bold $x^2$** text.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter $5 and $10.\n\n- $$\\sum_i a_i$$\n';
  const session = createHtmlSession();
  for (let at = 1; at <= doc.length; at++)
    session.render(doc.slice(0, at), { math: true });
  assert.equal(
    session.render(doc, { math: true }).html,
    createHtmlSession().render(doc, { math: true }).html
  );
  const renderer = createHtmlRenderer({ math: true, cjk: true });
  for (let at = 1; at <= doc.length; at++)
    renderer.render(doc.slice(0, at), true, true);
  const streamed = renderer.render(doc, false, false).html;
  assert.equal(
    streamed,
    createHtmlRenderer({ math: true, cjk: true }).render(doc, false, false).html
  );
  assert.match(
    streamed,
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" data-markdown="math"/
  );
  assert.match(streamed, /data-markdown="math-display"/);
  // a changed option resets the session
  const toggled = createHtmlSession();
  toggled.render('$x$');
  assert.equal(toggled.render('$x$', { math: true }).reset, true);
  // a last `$$` line is text until a later byte opens display math
  const opener = createHtmlSession();
  for (const prefix of ['a\n\n$', 'a\n\n$$', 'a\n\n$$x'])
    assert.equal(
      opener.render(prefix, { math: true }).html,
      createHtmlSession().render(prefix, { math: true }).html
    );
});

void test('element filters skip self-closing SVG children', () => {
  const doc = '$$\\frac{a}{b}$$\n\nafter\n';
  for (const options of [
    { disallowedElements: ['svg'] },
    { allowedElements: ['p'] },
  ]) {
    const out = createHtmlRenderer({ math: true, ...options }).render(
      doc,
      false,
      false
    ).html;
    assert.doesNotMatch(out, /<svg|<rect|<path/);
    assert.match(out, />after<\/p>/);
  }
  const rects = createHtmlRenderer({
    math: true,
    disallowedElements: ['rect'],
  }).render(doc, false, false).html;
  assert.match(rects, /<\/svg>[^]*>after<\/p>/);
});

void test('the Mermaid plugin renders mermaid fences', () => {
  const calls: string[] = [];
  const mermaid = createMermaidPlugin({
    render(source: string) {
      calls.push(source);
      if (source.includes('bad')) throw new Error('parse error');
      return { svg: `<svg data-test="${source.trim()}"></svg>` };
    },
  });
  const renderer = createHtmlRenderer({ plugins: { mermaid } });
  const open = renderer.render('```mermaid\ngraph LR', true, true).html;
  // an open fence with no diagram yet shows nothing
  assert.equal(open.trim(), '');
  assert.deepEqual(calls, []);
  // an open fence draws its complete lines
  assert.match(
    renderer.render('```mermaid\ngraph LR\nA-', true, true).html,
    /^<div data-markdown="code-block" data-language="mermaid" data-incomplete="true"><div data-markdown="code-header"><span>mermaid<\/span><span><button [^>]*disabled="">Copy<\/button><button [^>]*disabled="">Download<\/button><\/span><\/div><div data-markdown="mermaid"><svg data-test="graph LR"><\/svg><\/div><\/div>/
  );
  // a line that does not parse keeps the last diagram
  assert.match(
    renderer.render('```mermaid\ngraph LR\nbad\nA', true, true).html,
    /<svg data-test="graph LR">/
  );
  // the same complete lines do not render again
  renderer.render('```mermaid\ngraph LR\nbad\nAB', true, true);
  assert.deepEqual(calls, ['graph LR\n', 'graph LR\nbad\n']);
  // a line is complete at its LF, with no next line yet
  assert.match(
    renderer.render('```mermaid\ngraph LR\nbad\nAB\n', true, true).html,
    /<svg data-test="graph LR">/
  );
  assert.deepEqual(calls, [
    'graph LR\n',
    'graph LR\nbad\n',
    'graph LR\nbad\nAB\n',
  ]);
  const fresh = createHtmlRenderer({ plugins: { mermaid } });
  assert.match(
    fresh.render('```mermaid\ngraph LR\nA-B\n', true, true).html,
    /<svg data-test="graph LR\nA-B">/
  );
  calls.length = 0;
  const done = renderer.render(
    '```mermaid\ngraph LR\n```\n\n```mermaid\nbad\n```\n',
    false,
    false
  ).html;
  // a closed diagram sits in the code block frame with enabled buttons
  assert.match(
    done,
    /^<div data-markdown="code-block" data-code="graph LR\n" data-language="mermaid"><div data-markdown="code-header"><span>mermaid<\/span><span><button [^>]*"Copy code">Copy<\/button><button [^>]*"Download code">Download<\/button><\/span><\/div><div data-markdown="mermaid"><svg data-test="graph LR"><\/svg><\/div><\/div>/
  );
  // a diagram that does not parse stays code
  assert.match(done, /data-language="mermaid"[^]*bad/);
  assert.deepEqual(calls, ['graph LR\n', 'bad\n']);
  // an open fence that does not parse yet shows nothing
  assert.equal(
    renderer.render('```mermaid\nbad\nx', true, true).html.trim(),
    ''
  );
  // the source in data-code stays escaped
  assert.match(
    renderer.render('```mermaid\ngraph "<&>"\n```\n', false, false).html,
    /^<div data-markdown="code-block" data-code="graph &quot;&lt;&amp;&gt;&quot;\n" data-language="mermaid">/
  );
  // other renderers sit in the frame only when they ask for it
  const note = { language: 'note', render: () => '<aside></aside>' };
  assert.equal(
    createHtmlRenderer({ plugins: { renderers: [note] } }).render(
      '```note\nn\n```\n',
      false,
      false
    ).html,
    '<aside></aside>\n'
  );
  assert.match(
    createHtmlRenderer({
      plugins: { renderers: [{ ...note, frame: true }] },
    }).render('```note\nn\n```\n', false, false).html,
    /^<div data-markdown="code-block" data-code="n\n" data-language="note"><div data-markdown="code-header">[^]*<\/div><aside><\/aside><\/div>\n$/
  );
});

void test('one Mermaid plugin streams fences of many documents', () => {
  const mermaid = createMermaidPlugin({
    render(source: string) {
      if (source.includes('bad')) throw new Error('parse error');
      return { svg: `<svg data-test="${source.trim()}"></svg>` };
    },
  });
  const a = createHtmlRenderer({ plugins: { mermaid } });
  const b = createHtmlRenderer({ plugins: { mermaid } });
  a.render('```mermaid\ngraph A\nx', true, true);
  b.render('```mermaid\ngraph B\nx', true, true);
  // each fence keeps its own last diagram
  assert.match(
    a.render('```mermaid\ngraph A\nbad\nx', true, true).html,
    /data-test="graph A"/
  );
  assert.match(
    b.render('```mermaid\ngraph B\nbad\nx', true, true).html,
    /data-test="graph B"/
  );
});

void test('closed renderer blocks render once while the tail streams', () => {
  const calls: string[] = [];
  const mermaid = createMermaidPlugin({
    render(source: string) {
      calls.push(source);
      if (source.includes('bad')) throw new Error('parse error');
      return { svg: '<svg></svg>' };
    },
  });
  let notes = 0;
  const renderer = createHtmlRenderer({
    plugins: {
      mermaid,
      renderers: [
        {
          language: 'note',
          render: ({ code, isIncomplete }) =>
            isIncomplete ? null : `<aside>${++notes}:${code}</aside>`,
        },
      ],
    },
  });
  // one list item keeps every fence in the pending output
  const doc =
    '- a\n\n  ```mermaid\n  graph LR\n  ```\n\n  ```mermaid\n  bad\n  ```\n\n  ```note\n  n\n  ```\n\n  tail text that streams';
  let out = '';
  for (let at = 1; at <= doc.length; at++)
    out = renderer.render(doc.slice(0, at), true, true).html;
  // one render per complete line while open, then one when closed
  assert.deepEqual(calls, ['graph LR\n', 'graph LR\n', 'bad\n', 'bad\n']);
  assert.equal(notes, 1);
  assert.match(out, /<aside>1:n\n<\/aside>/);
  // an open fence of a renderer that returns null is a code block
  assert.match(
    createHtmlRenderer({
      plugins: { renderers: [{ language: 'note', render: () => null }] },
    }).render('```note\nn\n```\n', false, false).html,
    /data-language="note"/
  );
});

void test('code blocks expose the info string after the language as meta', () => {
  const metaOf = (source: string): string | undefined =>
    /^<div data-markdown="code-block" data-language="[^"]*"(?: data-meta="([^"]*)")?>/.exec(
      createHtmlRenderer().render(source, false, false).html
    )?.[1];
  assert.equal(metaOf('```ts\nx\n```\n'), undefined);
  assert.equal(metaOf('```ts   \nx\n```\n'), undefined);
  assert.equal(metaOf('```ts &#32;\nx\n```\n'), undefined);
  assert.equal(
    metaOf('```ts  title="debounce.ts" {3-5}  \nx\n```\n'),
    'title=&quot;debounce.ts&quot; {3-5}'
  );
  assert.equal(metaOf('~~~ py\tname=`a`\nx\n~~~\n'), 'name=`a`');
  assert.equal(metaOf("``` js <b>&amp;\\*'\nx\n```\n"), "&lt;b&gt;&amp;*'");
  // CommonMark HTML keeps only the language
  assert.equal(
    dec.decode(renderToHtml('```ts a="1"\nx\n```\n')),
    '<pre><code class="language-ts">x\n</code></pre>\n'
  );

  const seen: string[] = [];
  const hook =
    (from: string) =>
    (options: { language: string; meta: string; isIncomplete: boolean }) => {
      seen.push(
        `${from} ${options.language}|${options.meta}|${options.isIncomplete}`
      );
      return null;
    };
  const renderer = createHtmlRenderer({
    plugins: {
      code: {
        highlight: hook('highlight'),
        createSession: () => ({
          highlight: hook('session'),
          highlightLines: hook('lines'),
          dispose() {},
        }),
      },
      renderers: [{ language: 'note', render: hook('render') }],
    },
  });
  const source =
    '```note a "b"\nn\n```\n\n~~~ts\nx\n~~~\n\n```js x=&lt;1&gt;\nlet a';
  renderer.render(source, true, false);
  renderer.render(source + '\n', true, true);
  renderer.render(source + '\n```\n', false, false);
  // a renderer that returns null falls back to the highlighter
  assert.deepEqual([...new Set(seen)].sort(), [
    'highlight js|x=<1>|false',
    'highlight note|a "b"|false',
    'highlight ts||false',
    'lines js|x=<1>|true',
    'render note|a "b"|false',
    'session js|x=<1>|false',
  ]);
  renderer.dispose();

  // a new meta on the open fence starts a new highlighter session
  // through format() and through formatFence()
  for (const lineUpdates of [false, true]) {
    const metas: string[] = [];
    const rewrite = createHtmlRenderer({
      plugins: {
        code: {
          highlight: () => null,
          createSession: () => {
            let first: string | undefined;
            const lines = (options: { meta: string }) => {
              metas.push((first ??= options.meta));
              return null;
            };
            return {
              highlight: lines,
              highlightLines: lineUpdates ? lines : undefined,
              dispose() {},
            };
          },
        },
      },
    });
    rewrite.render('```ts a=1\nx\n', true, true);
    rewrite.render('```ts b=2\nx\ny\n', true, true);
    assert.deepEqual([...new Set(metas)], ['a=1', 'b=2']);
  }

  // an island name sits in the language, so meta leaves islands working
  const islands = { card: { accepts: () => true, fallback: 'Card' } };
  assert.match(
    createHtmlRenderer({ islands }).render(
      '```island-card name="x"\n{"id":"a"}\n```\n',
      false,
      false
    ).html,
    /data-words-island="card"/
  );
});
