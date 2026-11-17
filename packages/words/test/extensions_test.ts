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
  assert.match(out, /style="vertical-align:-?[\d.]+em;overflow:visible"/);
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
    '$x$5',
    '\\$x$',
    '$$$x$$$',
  ];
  for (const source of plain)
    assert.doesNotMatch(html(source, { math: true }), /<svg/, source);
  assert.match(html('$x$, $2^n$', { math: true }), /<svg[^]*<svg/);
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
  // a `$$` line with more dollars is a paragraph
  assert.match(html('$$ a $$ b', { math: true }), /^<p><svg/);
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
});

void test('math escapes its source and output', () => {
  const out = html('$a<b>c&d$', { math: true });
  assert.match(out, /aria-label="a&lt;b&gt;c&amp;d"/);
  assert.match(out, />&lt;</);
  assert.doesNotMatch(out, /<b>/);
  // text in \text{} is escaped too
  assert.match(html('$\\text{<i>}$', { math: true }), />&lt;i&gt;</);
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
  // a later closer still pairs with the first opener
  assert.match(html('$1 $2 $x$', { math: true }), /aria-label="1 \$2 \$x"/);
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

void test('the Mermaid plugin renders closed mermaid fences', () => {
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
  assert.match(open, /data-language="mermaid"/);
  assert.deepEqual(calls, []);
  const done = renderer.render(
    '```mermaid\ngraph LR\n```\n\n```mermaid\nbad\n```\n',
    false,
    false
  ).html;
  assert.match(
    done,
    /^<div data-markdown="mermaid"><svg data-test="graph LR"><\/svg><\/div>/
  );
  // a diagram that does not parse stays code
  assert.match(done, /data-language="mermaid"[^]*bad/);
  // the last diagram is cached
  createHtmlRenderer({ plugins: { mermaid } }).render(
    '```mermaid\nbad\n```\n',
    false,
    false
  );
  assert.deepEqual(calls, ['graph LR\n', 'bad\n']);
});
