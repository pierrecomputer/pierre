import assert from 'node:assert';
import test from 'node:test';

import { renderToHtml } from '../dist/index.js';

const dec = new TextDecoder();
const html = (md: string | Uint8Array | ArrayBuffer) =>
  dec.decode(renderToHtml(md));

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
  // the language is the first word after entities are decoded, as in cmark
  for (const [info, cls] of [
    ['a&#32;b', ' class="language-a"'],
    [' a&#x20;', ' class="language-a"'],
    ['&#32;a b', ' class="language-a"'],
    ['&#32;', ''],
    ['a\\_b&amp;', ' class="language-a_b&amp;"'],
  ]) {
    assert.equal(
      html(`\`\`\`${info}\nx\n\`\`\``),
      `<pre><code${cls}>x\n</code></pre>\n`
    );
  }
  assert.equal(html('<div>\nraw\n</div>'), '<div>\nraw\n</div>\n');
});

void test('plain paragraph runs stop at syntax, whitespace, and block boundaries', () => {
  const tails = [
    ['ordinary. Unicode 界é.', 'ordinary. Unicode 界é.'],
    ['literal *em*', 'literal <em>em</em>'],
    ['literal **bold**', 'literal <strong>bold</strong>'],
    ['literal `x&`', 'literal <code>x&amp;</code>'],
    ['literal &copy;', 'literal ©'],
    ['literal < > "\0', 'literal &lt; &gt; &quot;\ufffd'],
    ['literal \\*x', 'literal *x'],
    ['www.example.com', '<a href="http://www.example.com">www.example.com</a>'],
    ['literal [x](/u)', 'literal <a href="/u">x</a>'],
    ['literal  \nlast', 'literal<br />\nlast'],
    ['literal\t\nlast', 'literal\nlast'],
    ['  last', 'last'],
    ['  *em*', '<em>em</em>'],
    ['  "\0', '&quot;\ufffd'],
    ['*em*', '<em>em</em>'],
    ['_x_', '<em>x</em>'],
    ['`x`', '<code>x</code>'],
    ['[x](/u)', '<a href="/u">x</a>'],
    ['1 *em*', '1 <em>em</em>'],
    ['last  ', 'last'],
    ['last\t ', 'last'],
  ];
  for (let pad = 0; pad < 32; pad++) {
    const prefix = 'A'.repeat(pad) + 'lead.\nnext.\nthird.\n';
    for (const [tail, rendered] of tails) {
      const source = prefix + tail;
      const expected = '<p>' + prefix + rendered + '</p>\n';
      assert.equal(html(source), expected, JSON.stringify(source));
      assert.equal(html(source.replaceAll('\n', '\r\n')), expected);
    }
  }
  assert.equal(html('ordinary.\nwords.\n==='), '<h1>ordinary.\nwords.</h1>\n');
  assert.equal(html('p\n# h\nq'), '<p>p</p>\n<h1>h</h1>\n<p>q</p>\n');
  assert.equal(
    html('p\n```\nx\n```\nq'),
    '<p>p</p>\n<pre><code>x\n</code></pre>\n<p>q</p>\n'
  );
  assert.equal(
    html('lead.\nother.\na|b\n-| -\nx|y'),
    '<p>lead.\nother.</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n' +
      '</tr>\n</thead>\n<tbody>\n<tr>\n<td>x</td>\n<td>y</td>\n</tr>\n</tbody>\n</table>\n'
  );
  assert.equal(
    html('plain.\nmore.\n\n*x*\n\nplain.'),
    '<p>plain.\nmore.</p>\n<p><em>x</em></p>\n<p>plain.</p>\n'
  );
});

void test('paragraph candidate masks survive dense periods and line feeds', () => {
  for (let pad = 0; pad < 32; pad++) {
    for (const length of [0, 1, 2, 15, 16, 17, 31, 32, 33, 63, 64, 65, 4096]) {
      const dots = '.'.repeat(length);
      const text = 'A'.repeat(pad) + 'p' + dots + '\nB' + dots + '\nC' + dots;
      assert.equal(html(text), '<p>' + text + '</p>\n');
      assert.equal(html(text + ' \t'), '<p>' + text + '</p>\n');
    }
  }
});

void test('first-nonspace columns reset between lines and survive partial tabs', () => {
  const lines = [
    '## h',
    '',
    'p',
    'q',
    '',
    '> a',
    '> b',
    '',
    '- x',
    '- y',
    '',
    'z',
  ];
  const expected =
    '<h2>h</h2>\n<p>p\nq</p>\n<blockquote>\n<p>a\nb</p>\n</blockquote>\n' +
    '<ul>\n<li>x</li>\n<li>y</li>\n</ul>\n<p>z</p>\n';
  for (const newline of ['\n', '\r\n']) {
    for (let indent = 0; indent < 4; indent++) {
      const source = lines
        .map((line) => (line.length === 0 ? '' : ' '.repeat(indent) + line))
        .join(newline);
      assert.equal(html(source), expected);
    }
    for (let depth = 1; depth < 4; depth++) {
      const prefix = '> '.repeat(depth - 1) + '>\t';
      assert.equal(
        html(prefix + 'a' + newline + prefix + 'b'),
        '<blockquote>\n'.repeat(depth) +
          '<p>a\nb</p>\n' +
          '</blockquote>\n'.repeat(depth)
      );
    }
  }
});

void test('line scans do not mistake other controls or Latin-1 for CR/LF', () => {
  for (let byte = 0; byte < 256; byte++) {
    if (byte === 10 || byte === 13 || (byte >= 32 && byte < 128)) continue;
    const char = String.fromCharCode(byte);
    for (let padding = 0; padding < 16; padding++) {
      const prefix = 'x'.repeat(padding) + 'left';
      assert.equal(
        html(prefix + char + 'right'),
        `<p>${prefix}${byte === 0 ? '\ufffd' : char}right</p>\n`
      );
    }
  }
});

void test('line scans preserve Unicode and every line-ending lane through EOF', () => {
  for (let padding = 0; padding < 64; padding++) {
    const first = 'x'.repeat(padding) + 'é';
    const second = '界' + 'z'.repeat(63 - padding);
    for (const eol of ['\n', '\r', '\r\n']) {
      for (const ending of ['', eol]) {
        const source = `${first}${eol}${second}${ending}`;
        const expected = `<p>${first}\n${second}</p>\n`;
        assert.equal(html(source), expected);
        assert.equal(html(Buffer.from(source)), expected);
      }
    }
  }
});

void test('table separator scans preserve byte classes across vector lanes', () => {
  const escapes: Record<string, string> = {
    '"': '&quot;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  };
  const before =
    '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>';
  const after = '</td>\n<td>end</td>\n</tr>\n</tbody>\n</table>\n';
  for (let byte = 0; byte < 256; byte++) {
    if (byte === 10 || byte === 13) continue;
    const char = String.fromCharCode(byte);
    const source = char === '|' || char === '\\' ? `\\${char}` : char;
    const expected = byte === 0 ? '\ufffd' : (escapes[char] ?? char);
    for (let padding = 0; padding < 32; padding++) {
      const prefix = 'left' + 'x'.repeat(padding);
      assert.equal(
        html(`a | b\n--- | ---\n${prefix}${source}z | end`),
        `${before}${prefix}${expected}z${after}`,
        JSON.stringify({ byte, padding })
      );
    }
  }
});

void test('fenced code spans preserve embedded fence bytes, line endings, and EOF', () => {
  for (const fence of ['```', '~~~']) {
    for (const eol of ['\n', '\r\n', '\r']) {
      for (const ending of ['', '\n', '\n\n']) {
        for (let padding = 0; padding < 65; padding++) {
          const body = `first\nsecond\n${'x'.repeat(padding)}${fence} not a closer\n\nlast${ending}`;
          for (const closed of [false, true]) {
            const source = `${fence}\n${body}${closed ? `\n${fence}` : ''}`;
            const expected =
              body + (closed || !body.endsWith('\n') ? '\n' : '');
            assert.equal(
              html(source.replaceAll('\n', eol)),
              `<pre><code>${expected}</code></pre>\n`,
              JSON.stringify({ fence, eol, ending, padding, closed })
            );
          }
        }
      }
    }
  }
});

void test('fenced code renders mixed line endings like LF', () => {
  const lines = ['a', '', 'b `x`', '~~~ c', '', 'd', ''];
  const expected = `<pre><code>${lines.join('\n')}\n</code></pre>\n`;
  for (let mask = 0; mask < 3 ** lines.length; mask++) {
    let source = '```\n';
    for (let i = 0, m = mask; i < lines.length; i++, m = Math.floor(m / 3)) {
      // a CR before an empty line would merge into one CRLF
      const eol = ['\n', '\r\n', '\r'][m % 3];
      source += lines[i] + (eol === '\r' && lines[i + 1] === '' ? '\r\n' : eol);
    }
    assert.equal(html(source + '```'), expected, JSON.stringify(source));
  }
});

void test('merged fenced code lines keep the virtual spaces of a split tab', () => {
  assert.equal(
    html(' ```\n\tfoo\nbar\n```\n'),
    '<pre><code>   foo\nbar\n</code></pre>\n'
  );
  assert.equal(
    html('- Example:\n\n  ```go\n\tfunc main() {\n\n\t}\n  ```\n'),
    '<ul>\n<li>\n<p>Example:</p>\n<pre><code class="language-go">  func main() {\n\n  }\n' +
      '</code></pre>\n</li>\n</ul>\n'
  );
});

void test('single-line code writers keep escaped content between their tags', () => {
  const cases = [
    ['"', '&quot;'],
    [' &< ', '&amp;&lt;'],
    ['  ', '  '],
    ['é界', 'é界'],
    ['\0', '\ufffd'],
  ];
  for (let padding = 0; padding < 32; padding++) {
    const prefix = 'lead' + 'x'.repeat(padding) + ' ';
    for (const [content, expected] of cases) {
      assert.equal(
        html(`${prefix}\`${content}\` *after* [z](/u)`),
        `<p>${prefix}<code>${expected}</code> <em>after</em> <a href="/u">z</a></p>\n`
      );
    }
  }
});

void test('emphasis runs cross bounded output chunks and resume around other marks', () => {
  const source = '***a*** **b *c* d** ~~e~~ [f](/u) ![*g*](/i) `h` ';
  const expected =
    '<em><strong>a</strong></em> <strong>b <em>c</em> d</strong> ' +
    '<del>e</del> <a href="/u">f</a> <img src="/i" alt="g" /> <code>h</code> ';
  for (const padding of [0, 239, 250, 255, 256, 257]) {
    const prefix = 'x'.repeat(padding) + 'é ';
    assert.equal(
      html(prefix + source.repeat(200) + 'end'),
      `<p>${prefix}${expected.repeat(200)}end</p>\n`
    );
  }
});

void test('paragraph source ranges preserve table headers, definitions, and multiline code', () => {
  const cases = [
    [
      'start `a\nb`\nx | y\n--- | ---\nz | q',
      '<p>start <code>a b</code></p>\n<table>\n<thead>\n<tr>\n<th>x</th>\n<th>y</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td>z</td>\n<td>q</td>\n</tr>\n</tbody>\n</table>\n',
    ],
    ['one\nstart `a\nb`\n===', '<h1>one\nstart <code>a b</code></h1>\n'],
    [
      '[u]: /dest\nfirst\nsecond\nthird\n[u]',
      '<p>first\nsecond\nthird\n<a href="/dest">u</a></p>\n',
    ],
  ];
  for (const [source, expected] of cases) {
    for (const eol of ['\n', '\r', '\r\n']) {
      assert.equal(html(source.replaceAll('\n', eol)), expected);
    }
  }
});

void test('reused inline slots initialize each mark kind independently', () => {
  const cases = [
    ['*a* **b** ~~c~~', '<p><em>a</em> <strong>b</strong> <del>c</del></p>\n'],
    ['`code` &amp; \\*', '<p><code>code</code> &amp; *</p>\n'],
    ['a\nb  \nc', '<p>a\nb<br />\nc</p>\n'],
    ['[a](/url "title")', '<p><a href="/url" title="title">a</a></p>\n'],
    ['![*alt*](/image)', '<p><img src="/image" alt="alt" /></p>\n'],
    ['[unclosed', '<p>[unclosed</p>\n'],
  ];
  for (let round = 0; round < 3; round++) {
    for (const [source, expected] of cases) {
      html('***seed*** ~~old~~ [link](/old) '.repeat(100));
      assert.equal(html(source), expected);
    }
  }
});

void test('table cells alternate input aliases and escaped-pipe copies at every alignment', () => {
  for (let padding = 0; padding < 32; padding++) {
    const text = 'x'.repeat(padding);
    const source =
      '| a | b | c |\n|---|---|---|\n' +
      `| ${text}&amp; | \`${text}\\|é\` | \\*${text} |\n`;
    assert.equal(
      html(source),
      '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n<th>c</th>\n</tr>\n</thead>\n' +
        `<tbody>\n<tr>\n<td>${text}&amp;</td>\n<td><code>${text}|é</code></td>\n` +
        `<td>*${text}</td>\n</tr>\n</tbody>\n</table>\n`
    );
  }
});

void test('code newline normalization resets between single-line and multiline content', () => {
  for (let round = 0; round < 3; round++) {
    assert.equal(html('# `a`'), '<h1><code>a</code></h1>\n');
    assert.equal(
      html('`a\nb`\n\n`c`'),
      '<p><code>a b</code></p>\n<p><code>c</code></p>\n'
    );
    assert.equal(
      html('![`a\nb`](/img)'),
      '<p><img src="/img" alt="a b" /></p>\n'
    );
    assert.equal(html('`  `'), '<p><code>  </code></p>\n');
    assert.equal(html('`\n a \n`'), '<p><code>a </code></p>\n');
  }
});

void test('literal soft breaks preserve trimming, markup, and image alt text', () => {
  const cases = [
    ['a\nb\nc', '<p>a\nb\nc</p>\n'],
    ['é\n界 & "x"\ny', '<p>é\n界 &amp; &quot;x&quot;\ny</p>\n'],
    ['a \nb\t\nc', '<p>a\nb\nc</p>\n'],
    ['a\n b\n\tc', '<p>a\nb\nc</p>\n'],
    ['a  \nb\\\nc', '<p>a<br />\nb<br />\nc</p>\n'],
    ['*a\nb*\nc', '<p><em>a\nb</em>\nc</p>\n'],
    ['a\n![b\nc](/img)\nd', '<p>a\n<img src="/img" alt="b c" />\nd</p>\n'],
    ['a\n[b\nc](/u)\nd', '<p>a\n<a href="/u">b\nc</a>\nd</p>\n'],
    ['a\n[unclosed\nb', '<p>a\n[unclosed\nb</p>\n'],
    [
      'a\nwww.example.com',
      '<p>a\n<a href="http://www.example.com">www.example.com</a></p>\n',
    ],
    [
      'a\nme@example.com',
      '<p>a\n<a href="mailto:me@example.com">me@example.com</a></p>\n',
    ],
  ];
  for (const [source, expected] of cases) {
    for (const eol of ['\n', '\r\n', '\r']) {
      assert.equal(html(source.replaceAll('\n', eol)), expected);
    }
  }
});

void test('URL escaping preserves every ASCII byte and Unicode at SIMD boundaries', () => {
  const safe =
    '!#$%()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~';
  const points = [
    ...Array.from({ length: 128 }, (_, i) => i),
    0xe9,
    0x754c,
    0x1f680,
  ];
  for (let padding = 0; padding < 33; padding++) {
    for (const point of points) {
      const value = String.fromCodePoint(point === 0 ? 0xfffd : point);
      const escaped =
        value === '&'
          ? '&amp;'
          : value === "'"
            ? '&#x27;'
            : safe.includes(value)
              ? value
              : [...new TextEncoder().encode(value)]
                  .map(
                    (byte) =>
                      `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
                  )
                  .join('');
      const prefix = '/p' + 'a'.repeat(padding);
      assert.equal(
        html(`[x](<${prefix}&#${point};z>)`),
        `<p><a href="${prefix}${escaped}z">x</a></p>\n`,
        `point=${point} padding=${padding}`
      );
    }
  }
});

void test('HTML escaping handles nearby special bytes and vector tails', () => {
  const escape = (text: string) =>
    text.replace(
      /[&<>"\0]/g,
      (char) =>
        (
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\0': '\ufffd',
          }) as Record<string, string>
        )[char]
    );
  for (let padding = 0; padding < 33; padding++) {
    for (let tail = 0; tail < 33; tail++) {
      const source = 'a'.repeat(padding) + '&"\0<>界&&""<>é' + 'z'.repeat(tail);
      assert.equal(
        html('```\n' + source + '\n```'),
        `<pre><code>${escape(source)}\n</code></pre>\n`
      );
      assert.equal(
        html('`' + source + '`'),
        `<p><code>${escape(source)}</code></p>\n`
      );
    }
  }
});

void test('HTML escaping consumes every subset of a sixteen-byte candidate mask', () => {
  const specials = ['"', '&', '<', '>', '\0'];
  const replacements = ['&quot;', '&amp;', '&lt;', '&gt;', '\ufffd'];
  const source = [];
  const expected = [];
  for (let mask = 0; mask < 1 << 16; mask++) {
    let text = '';
    let escaped = '';
    for (let lane = 0; lane < 16; lane++) {
      if ((mask & (1 << lane)) !== 0) {
        const kind = lane % specials.length;
        text += specials[kind];
        escaped += replacements[kind];
      } else {
        text += 'x';
        escaped += 'x';
      }
    }
    // Each fenced block starts a new text writer at this sixteen-byte word.
    source.push('```\n' + text + '\n```\n');
    expected.push(`<pre><code>${escaped}\n</code></pre>\n`);
  }
  assert.equal(html(source.join('\n')), expected.join(''));
});

void test('literal-gap escaping facts reset across leaves and recognized constructs', () => {
  for (let padding = 0; padding < 33; padding++) {
    const prefix = 'a'.repeat(padding);
    for (const [source, expected] of [
      ['plain *text*', 'plain <em>text</em>'],
      ['a "b" *c*', 'a &quot;b&quot; <em>c</em>'],
      ['a &bogus; *c*', 'a &amp;bogus; <em>c</em>'],
      ['a <broken *c* >', 'a &lt;broken <em>c</em> &gt;'],
      ['a\0b *c*', 'a\ufffdb <em>c</em>'],
      ['&quot; `"` \\"', '&quot; <code>&quot;</code> &quot;'],
      ['![a "b" *c*](/img)', '<img src="/img" alt="a &quot;b&quot; c" />'],
      ['![<i>b</i>](/img)', '<img src="/img" alt="&lt;i&gt;b&lt;/i&gt;" />'],
    ]) {
      assert.equal(
        html(`${prefix}${source}\n\nplain`),
        `<p>${prefix}${expected}</p>\n<p>plain</p>\n`
      );
    }
  }
});

void test('HTML escaping rejects non-escaping bytes with matching low nibbles', () => {
  const source = Array.from({ length: 256 }, (_, byte) => byte)
    .filter((byte) => byte !== 10 && byte !== 13)
    .map((byte) => String.fromCharCode(byte))
    .join('');
  const escaped = source.replace(
    /[&<>"\0]/g,
    (char) =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          '\0': '\ufffd',
        }) as Record<string, string>
      )[char]
  );
  for (let padding = 0; padding < 32; padding++) {
    const prefix = 'a'.repeat(padding + 1);
    assert.equal(
      html('```\n' + prefix + source + '\n```'),
      `<pre><code>${prefix}${escaped}\n</code></pre>\n`
    );
  }
});

void test('long escaped literals resume syntax scanning at every vector alignment', () => {
  const endings = [
    ['', ''],
    ['*b*', '<em>b</em>'],
    ['\nnext', '\nnext'],
    ['[link](/u)', '<a href="/u">link</a>'],
    ['![x](/i)', '<img src="/i" alt="x" />'],
    ['&amp;', '&amp;'],
    ['\\*', '*'],
  ];
  for (let padding = 0; padding < 33; padding++) {
    const literal = '"'.repeat(96 + padding) + '>\0界';
    const escaped = '&quot;'.repeat(96 + padding) + '&gt;\ufffd界';
    for (const [ending, rendered] of endings) {
      assert.equal(
        html(`p ${literal}${ending}\n\nplain`),
        `<p>p ${escaped}${rendered}</p>\n<p>plain</p>\n`
      );
    }
  }
});

void test('link title cleanup and escaping preserve decoding order at vector boundaries', () => {
  for (let padding = 0; padding < 33; padding++) {
    const prefix = 'a'.repeat(padding);
    const title = `${prefix}plain &amp; \\* < > &bogus; 界 &quot; \\&amp;`;
    const expected = `${prefix}plain &amp; * &lt; &gt; &amp;bogus; 界 &quot; &amp;amp;`;
    assert.equal(
      html(`[x](/u "${title}")`),
      `<p><a href="/u" title="${expected}">x</a></p>\n`
    );
    assert.equal(
      html(`[x][ref]\n\n[ref]: /u "${title}"`),
      `<p><a href="/u" title="${expected}">x</a></p>\n`
    );
  }
});

void test('link titles clean long Latin-1 spans and adjacent special bytes', () => {
  const literal =
    Array.from({ length: 256 }, (_, byte) => byte)
      .filter((byte) => byte !== 10 && byte !== 13)
      .map((byte) => String.fromCharCode(byte))
      .join('') + '"<>&\0'.repeat(40);
  const title = literal.replace(/["\\]/g, '\\$&');
  const escaped = literal.replace(
    /[&<>"\0]/g,
    (char) =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          '\0': '\ufffd',
        }) as Record<string, string>
      )[char]
  );
  assert.equal(
    html(`[x](/u "${title}")`),
    `<p><a href="/u" title="${escaped}">x</a></p>\n`
  );
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

void test('an empty list item ends at its first blank line, however indented', () => {
  for (const blank of ['', '  ', '    ', '\t']) {
    assert.equal(
      html(`-\n${blank}\n  foo\n`),
      '<ul>\n<li></li>\n</ul>\n<p>foo</p>\n',
      JSON.stringify(blank)
    );
    assert.equal(
      html(`- a\n-\n${blank}\n  b\n`),
      '<ul>\n<li>a</li>\n<li></li>\n</ul>\n<p>b</p>\n',
      JSON.stringify(blank)
    );
  }
});

void test('lazy continuation lines drop their indentation', () => {
  assert.equal(
    html('> foo\\\n   bar\n'),
    '<blockquote>\n<p>foo<br />\nbar</p>\n</blockquote>\n'
  );
  assert.equal(
    html('> [a]: /u\n   bar\n'),
    '<blockquote>\n<p>bar</p>\n</blockquote>\n'
  );
  // a lazy line and a matched line strip the same whitespace
  for (const line of ['   b`', '>    b`', '\tb`', '  \t b`']) {
    assert.equal(
      html('> `a\n' + line),
      '<blockquote>\n<p><code>a b</code></p>\n</blockquote>\n',
      JSON.stringify(line)
    );
  }
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
    html('a \\\nb'),
    '<p>a <br />\nb</p>\n',
    'a backslash break keeps the spaces before it'
  );
  assert.equal(
    html('<https://x.test/>'),
    '<p><a href="https://x.test/">https://x.test/</a></p>\n'
  );
  assert.equal(html('<em>raw</em>'), '<p><em>raw</em></p>\n');
});

void test('code spans pair after a failed scan, and up to 255 backticks', () => {
  // a scan that reached EOF must not have its memo lowered by later scans
  assert.equal(
    html('Wrap code in ``` fences; inline uses `a` and `b`.'),
    '<p>Wrap code in ``` fences; inline uses <code>a</code> and <code>b</code>.</p>\n'
  );
  assert.equal(
    html('a (`) then ``b`` and ``c``'),
    '<p>a (`) then <code>b</code> and <code>c</code></p>\n'
  );
  for (const n of [65, 255]) {
    const fence = '`'.repeat(n);
    assert.equal(html(fence + 'a' + fence), '<p><code>a</code></p>\n');
    assert.equal(
      html('x ' + fence + 'a' + fence + ' `y` ' + fence),
      `<p>x <code>a</code> <code>y</code> ${fence}</p>\n`
    );
  }
  const long = '`'.repeat(256);
  assert.equal(html(long + 'a' + long), `<p>${long}a${long}</p>\n`);
  // the memo starts empty for each leaf
  assert.equal(
    html('`a ``x\n\n``b`` `c`'),
    '<p>`a ``x</p>\n<p><code>b</code> <code>c</code></p>\n'
  );
});

void test('raw HTML comments end at the first -->', () => {
  assert.equal(html('a <!-- b ---> c'), '<p>a <!-- b ---> c</p>\n');
  assert.equal(html('a <!-- b ----> c'), '<p>a <!-- b ----> c</p>\n');
  assert.equal(html('a <!-- b - -> c'), '<p>a &lt;!-- b - -&gt; c</p>\n');
  assert.equal(html('a <!--> b <!---> c'), '<p>a <!--> b <!---> c</p>\n');
  // a failed opener does not hide a later construct of another kind
  assert.equal(
    html('a <!-- b <? c ?> <![CDATA[ d ]]> <!E f> <!-- g'),
    '<p>a &lt;!-- b <? c ?> <![CDATA[ d ]]> <!E f> &lt;!-- g</p>\n'
  );
  // the flags reset for each leaf
  assert.equal(
    html('x <? a\n\nx <? b ?> <!-- c\n\nx <!-- d -->'),
    '<p>x &lt;? a</p>\n<p>x <? b ?> &lt;!-- c</p>\n<p>x <!-- d --></p>\n'
  );
});

void test('NUL is U+FFFD in raw HTML, destinations, autolinks and flanking', () => {
  assert.equal(html('x <a b="\0">'), '<p>x <a b="�"></p>\n');
  assert.equal(
    html('x <a b="\0\0" c=\'\0\'>'),
    '<p>x <a b="��" c=\'�\'></p>\n'
  );
  assert.equal(
    html('![x <a b="\0">](/i)'),
    '<p><img src="/i" alt="x &lt;a b=&quot;�&quot;&gt;" /></p>\n'
  );
  assert.equal(
    dec.decode(renderToHtml('x <a b="\0">', { skipHtml: true })),
    '<p>x </p>\n'
  );
  assert.equal(html('<div>\0</div>'), '<div>�</div>\n');
  // skipped HTML blocks leave no blank lines behind
  assert.equal(
    dec.decode(
      renderToHtml('a\n\n<b>\n<i>\n\n  <div>\n\nz', { skipHtml: true })
    ),
    '<p>a</p>\n<p>z</p>\n'
  );
  assert.match(html('[a](/u\0v)'), /^<p><a href="\/u[^"]*v">a<\/a><\/p>\n$/);
  assert.match(
    html('<ab:c\0d>'),
    /^<p><a href="ab:c[^"]*d">ab:c�d<\/a><\/p>\n$/
  );
  assert.equal(html('a*\0*b'), '<p>a*�*b</p>\n');
  assert.equal(html('a *\0*'), '<p>a <em>�</em></p>\n');
  // DEL is an ASCII control character
  assert.equal(html('[a](/u\x7Fv)'), '<p>[a](/u\x7Fv)</p>\n');
  assert.equal(html('<ab:c\x7Fd>'), '<p>&lt;ab:c\x7Fd&gt;</p>\n');
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
  // NUL is U+FFFD in a URL as in text, and fits the URL's reservation
  assert.equal(
    html('[a](<x\0y> "t\0t")'),
    '<p><a href="x%EF%BF%BDy" title="t�t">a</a></p>\n'
  );
  assert.equal(
    html('www.a\0b.com'),
    '<p><a href="http://www.a%EF%BF%BDb.com">www.a�b.com</a></p>\n'
  );
  const nuls = '\0'.repeat(5000);
  assert.ok(
    html(`[a](<${nuls}>) after`).includes(
      `${'%EF%BF%BD'.repeat(5000)}">a</a> after`
    )
  );
});

void test('more than 255 open brackets keep the newest ones', () => {
  const open = '['.repeat(300);
  assert.equal(
    html(open + 'a](b)'),
    `<p>${'['.repeat(299)}<a href="b">a</a></p>\n`
  );
  assert.equal(
    html(open + '![x](a) y](b)'),
    `<p>${'['.repeat(299)}<a href="b"><img src="a" alt="x" /> y</a></p>\n`
  );
  // the oldest brackets were dropped and stay literal
  assert.equal(
    html('[' + open + 'a' + ']'.repeat(301) + '(b)'),
    `<p>[${open}a${']'.repeat(301)}(b)</p>\n`
  );
  assert.equal(
    html(open + 'a' + ']'.repeat(300) + '[c](d)'),
    `<p>${open}a${']'.repeat(300)}<a href="d">c</a></p>\n`
  );
});

void test('link labels hold at most 999 characters', () => {
  for (const [ch, n, linked] of [
    ['a', 999, true],
    ['a', 1000, false],
    ['é', 999, true],
    ['é', 1000, false],
  ] as const) {
    const label = ch.repeat(n);
    const out = html(`[${label}]: /u\n\n[${label}]\n`);
    assert.equal(out.startsWith('<p><a href="/u">'), linked, `${ch} x ${n}`);
  }
  assert.equal(
    html(`[x][${'a'.repeat(1000)}]\n\n[${'a'.repeat(1000)}]: /u`),
    `<p>[x][${'a'.repeat(1000)}]</p>\n<p>[${'a'.repeat(1000)}]: /u</p>\n`
  );
});

void test('ill-formed UTF-8 in labels decodes to U+FFFD and never traps', () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(
      parts.flatMap((p) =>
        typeof p === 'string' ? [...new TextEncoder().encode(p)] : p
      )
    );
  // stray continuation bytes used to decode as two-byte leads that fold to
  // six bytes, overrunning the label scratch
  const stray: number[] = [];
  for (let i = 0; i < 100000; i++) stray.push(0x8e, 0x90);
  const out = html(bytes('[', stray, ']'));
  assert.equal(out, `<p>[${'�'.repeat(200000)}]</p>\n`);
  const short = stray.slice(0, 998);
  assert.equal(
    html(bytes('[', short, ']\n\n[', short, ']: /u')),
    `<p><a href="/u">${'�'.repeat(998)}</a></p>\n`
  );
  assert.equal(
    html(
      bytes('[^', stray.slice(0, 900), ']: n\n\nx[^', stray.slice(0, 900), ']')
    ).slice(0, 30),
    '<p>x<sup class="footnote-ref">'
  );
  // each ill-formed subpart is one U+FFFD, as the host decoder shows it
  assert.equal(
    html(bytes('[', [0x8e, 0x90], ']: /u\n\n[��]')),
    '<p><a href="/u">��</a></p>\n'
  );
  assert.equal(
    html(bytes('[a', [0xce], 'b]: /u\n\n[a', [0xce], 'c]')),
    '<p>[a�c]</p>\n'
  );
  assert.equal(html(bytes('*', [0xe4, 0xbd], '*a*')), '<p>*�<em>a</em></p>\n');
});

void test('reference lookups ignore the hash seed and keep namespaces apart', async () => {
  const { init } = await import('../dist/index.js');
  const { readFileSync } = await import('node:fs');
  const wasm = new WebAssembly.Module(
    readFileSync(new URL('../dist/md.wasm', import.meta.url))
  );
  let doc = '';
  for (let i = 0; i < 300; i++)
    doc += `[L${i}]: /u${i}\n[^n${i % 7}]: note ${i}\n`;
  doc += '\n';
  for (let i = 0; i < 400; i++) doc += `[l${(i * 7) % 350}] [^N${i % 9}] `;
  const first = html(doc);
  for (let round = 0; round < 3; round++) {
    init(wasm);
    assert.equal(html(doc), first);
  }
  // footnote labels carry a 0x01 prefix; a link label may start with 0x01 too
  const both =
    '<p>ref<sup class="footnote-ref"><a href="#fn-1" id="fnref-1" data-footnote-ref>1</a></sup>' +
    ' <a href="/u">\x01foo</a></p>\n<section class="footnotes"';
  for (const defs of [
    '[\x01foo]: /u\n\n[^foo]: note',
    '[^foo]: note\n\n[\x01foo]: /u',
  ])
    assert.ok(html(defs + '\n\nref[^foo] [\x01foo]\n').startsWith(both), defs);
});

void test('definition indexing preserves first matches across mixed blocks and resets', () => {
  const filler = '# Heading\n\n- item\n\nordinary text\n\n'.repeat(100);
  const reference = '[link]: /first\n\n[^note]: first note\n\n';
  const use = 'See [link] and [^note].';
  const expected = html(reference + filler + use);
  for (let round = 0; round < 3; round++) {
    assert.equal(
      html(
        reference + filler + '[link]: /second\n\n[^note]: second note\n\n' + use
      ),
      expected
    );
    assert.equal(html('[link] [^note]'), '<p>[link] [^note]</p>\n');
    assert.equal(
      html('[link]: /new\n\n[link]'),
      '<p><a href="/new">link</a></p>\n'
    );
    assert.equal(html(reference + filler + use), expected);
  }
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
  // a box no paragraph or heading took does not outlive its item
  for (const item of [
    '- [x] a | b\n  - | -',
    '- [x] \n\n  ***',
    '1. [x]\n   ***',
  ]) {
    assert.equal(
      html(`${item}\n\n> later`).split('<blockquote>')[1],
      '\n<p>later</p>\n</blockquote>\n'
    );
  }
  assert.equal(
    html('- [ ] a\n  ---'),
    '<ul>\n<li>\n<h2>[ ] a</h2>\n</li>\n</ul>\n'
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

void test('a task marker needs paragraph content after it', () => {
  const box = '<input checked="" disabled="" type="checkbox">';
  for (const item of ['* [x]', '- [x]\n', '- [x] \n', '- [x]\t']) {
    assert.equal(
      html(item),
      '<ul>\n<li>[x]</li>\n</ul>\n',
      JSON.stringify(item)
    );
  }
  assert.equal(html('- [ ]'), '<ul>\n<li>[ ]</li>\n</ul>\n');
  // the checkbox never moves to a later block or item
  assert.equal(
    html('- [x]\n- foo\n'),
    '<ul>\n<li>[x]</li>\n<li>foo</li>\n</ul>\n'
  );
  assert.equal(
    html('- [x]\n  # h\n'),
    '<ul>\n<li>[x]\n<h1>h</h1>\n</li>\n</ul>\n'
  );
  assert.equal(
    html('- [x]\n  ===\n'),
    '<ul>\n<li>\n<h1>[x]</h1>\n</li>\n</ul>\n'
  );
  // content on a later line of the paragraph still counts
  assert.equal(html('- [x]\n  foo'), `<ul>\n<li>${box}\nfoo</li>\n</ul>\n`);
  assert.equal(html('- [x] \n  foo'), `<ul>\n<li>${box}\nfoo</li>\n</ul>\n`);
  assert.equal(
    html('- [x] foo\n\n- b'),
    `<ul>\n<li>\n<p>${box} foo</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n`
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

void test('footnote definition labels hold at most 999 characters, like link labels', () => {
  for (const [n, defined] of [
    [999, true],
    [1000, false],
  ] as const) {
    for (const ch of ['a', 'é']) {
      const label = ch.repeat(n);
      const out = html(`x[^${label}]\n\n[^${label}]: note`);
      assert.equal(out.includes('data-footnote-ref'), defined, ch + n);
      assert.equal(out.includes(`<p>[^${label}]: note</p>`), !defined, ch + n);
    }
  }
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
    // unclosed raw HTML openers and rejected www domains used to rescan the
    // rest of the paragraph each time (0.7 to 3 s each at these sizes)
    'x ' + '<!-- '.repeat(40000),
    'x ' + '<?'.repeat(40000),
    'x ' + '<![CDATA[]'.repeat(20000),
    'x ' + '<!A'.repeat(150000),
    'www.a_'.repeat(32000),
    // crafted to collide in the unseeded label hash (0.6 s before)
    collidingLabels(8192, 40000),
    // each container marker once rescanned the rest of the line
    '- '.repeat(100000) + 'x',
    '> ' + '*\t'.repeat(100000) + 'x',
    // each blank line once walked every open level
    '- '.repeat(125) + 'x' + '\n'.repeat(400000) + 'y',
    '[^a]: '.repeat(249) + 'x' + '\n  '.repeat(200000) + 'y',
  ];
  for (const input of inputs) {
    const out = renderToHtml(input);
    assert.ok(out instanceof Uint8Array, JSON.stringify(input.slice(0, 20)));
  }
});

/** Definitions whose labels share one slot of the old FNV-1a low-bit table. */
function collidingLabels(defs: number, refs: number) {
  const prime = 16777619;
  const fnv = (s: string) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++)
      h = Math.imul(h ^ s.charCodeAt(i), prime);
    return h >>> 0;
  };
  let inverse = 1;
  for (let i = 0; i < 5; i++)
    inverse = Math.imul(inverse, 2 - Math.imul(prime, inverse));
  let slots = 16;
  while (slots < 2 * defs) slots *= 2;
  const mask = slots - 1;
  const want = Math.imul(5, inverse) & mask;
  const labels: string[] = [];
  for (let n = 0; labels.length < defs + 1; n++) {
    const stem = 'd' + n.toString(36);
    const last = (fnv(stem) ^ want) & mask;
    // the last byte must finish the collision as a lowercase-safe character
    if (last >= 0x7f || last <= 0x20 || (last >= 0x41 && last <= 0x5d))
      continue;
    labels.push(stem + String.fromCharCode(last));
  }
  const ref = labels.pop();
  return (
    labels.map((l) => `[${l}]: /u`).join('\n') +
    '\n\n' +
    `[${ref}] `.repeat(refs)
  );
}

void test('container markers past the nesting limit stay text on every line', () => {
  const count = (s: string, tag: string) => s.split(tag).length - 1;
  let out = html('>'.repeat(249) + ' - a\n');
  assert.equal(count(out, '<blockquote>'), 249);
  assert.equal(count(out, '<ul>'), 0);
  assert.match(out, /<p>- a<\/p>/);
  out = html('> '.repeat(260) + 'x\n' + '> '.repeat(260) + 'y\n');
  assert.equal(count(out, '<blockquote>'), 250);
  assert.match(out, /<p>(&gt; ){10}x\n(&gt; ){10}y<\/p>/);
  const q = '>'.repeat(252);
  out = html(`${q} \`\`\`\n${q} code\n${q} \`\`\`\n\nafter\n`);
  assert.equal(count(out, '<pre>'), 0);
  assert.ok(out.endsWith('</blockquote>\n<p>after</p>\n'));
  // the deepest list still takes sibling items
  out = html('- '.repeat(126) + 'a\n' + '  '.repeat(124) + '- b\n');
  assert.equal(count(out, '<ul>'), 125);
  assert.equal(count(out, '<li>'), 126);
  assert.match(out, /<li>- a<\/li>\n<li>b<\/li>/);
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

void test('the paragraph above a table header closes like any other', () => {
  const head =
    '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n</table>\n';
  assert.equal(
    html('[foo]: /url\na | b\n--|--\n\n[foo]\n'),
    head + '<p><a href="/url">foo</a></p>\n'
  );
  assert.equal(
    html('[foo]: /url\nrest  \na | b\n--|--\n\n[foo]\n'),
    '<p>rest</p>\n' + head + '<p><a href="/url">foo</a></p>\n'
  );
  // trailing whitespace stays a hard break when no table forms
  assert.equal(html('a | b  \n:-:\n'), '<p>a | b<br />\n:-:</p>\n');
  assert.equal(html('a | b  \n--|--\n'), head);
});

void test('a list item interrupts a paragraph before a table delimiter row', () => {
  assert.equal(
    html('a | b\n- | -\n'),
    '<p>a | b</p>\n<ul>\n<li>| -</li>\n</ul>\n'
  );
  assert.equal(
    html('a | b\n-\t| -\n'),
    '<p>a | b</p>\n<ul>\n<li>| -</li>\n</ul>\n'
  );
  for (const row of ['-|-', '-- | --', '| - | - |', ':- | -:']) {
    assert.match(html(`a | b\n${row}\n`), /^<table>/, row);
  }
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

void test('a thematic break can follow list markers that are not one', () => {
  assert.equal(html('- * * *'), '<ul>\n<li>\n<hr />\n</li>\n</ul>\n');
  assert.equal(
    html('- - * * *'),
    '<ul>\n<li>\n<ul>\n<li>\n<hr />\n</li>\n</ul>\n</li>\n</ul>\n'
  );
  assert.equal(html('* - - -'), '<ul>\n<li>\n<hr />\n</li>\n</ul>\n');
  assert.equal(html('- - -'), '<hr />\n');
  assert.equal(
    html('- - x\n* * *'),
    '<ul>\n<li>\n<ul>\n<li>x</li>\n</ul>\n</li>\n</ul>\n<hr />\n'
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
  // a rejected domain only rejects later `www.` with the same last segments
  assert.equal(
    html('x_www.a_www.b'),
    '<p>x_www.a_<a href="http://www.b">www.b</a></p>\n'
  );
  assert.equal(
    html('www.a_b.c.www.d e'),
    '<p><a href="http://www.a_b.c.www.d">www.a_b.c.www.d</a> e</p>\n'
  );
  assert.equal(
    html('www.a.b_c.www.d_e.f www.g.h'),
    '<p>www.a.b_c.www.d_e.f <a href="http://www.g.h">www.g.h</a></p>\n'
  );
  assert.equal(html('http://a._www.b_c.d x'), '<p>http://a._www.b_c.d x</p>\n');
});

void test('email autolinks take underscore runs into the local part', () => {
  const mail = (a: string) => `<a href="mailto:${a}">${a}</a>`;
  assert.equal(
    html('mail john_@example.com now'),
    `<p>mail ${mail('john_@example.com')} now</p>\n`
  );
  assert.equal(html('_first@x.com'), `<p>${mail('_first@x.com')}</p>\n`);
  assert.equal(html('a_.b@c.de'), `<p>${mail('a_.b@c.de')}</p>\n`);
  assert.equal(html('__init__@x.com'), `<p>${mail('__init__@x.com')}</p>\n`);
  // the absorbed run no longer closes emphasis
  assert.equal(html('_a b_@c.de'), `<p>_a ${mail('b_@c.de')}</p>\n`);
  assert.equal(html('*_a@b.cd*'), `<p><em>${mail('_a@b.cd')}</em></p>\n`);
  // a failed address leaves the delimiters alone
  assert.equal(html('_foo@bar.com_'), '<p><em>foo@bar.com</em></p>\n');
  assert.equal(html('[x] _a@b'), '<p>[x] _a@b</p>\n');
  // a scheme glued to a word is text before a bare address
  assert.equal(
    html('xmailto:foo@bar.com'),
    `<p>xmailto:${mail('foo@bar.com')}</p>\n`
  );
  assert.equal(
    html('xxmpp:foo@bar.com/baz'),
    `<p>xxmpp:${mail('foo@bar.com')}/baz</p>\n`
  );
  assert.equal(
    html('x mailto:foo@bar.com'),
    '<p>x <a href="mailto:foo@bar.com">mailto:foo@bar.com</a></p>\n'
  );
});

void test('named references decode from the table and its lookup cache', async () => {
  const { readFileSync } = await import('node:fs');
  const table = new Map<string, string>();
  for (const line of readFileSync(
    new URL('../src/entities.txt', import.meta.url),
    'utf-8'
  ).split('\n')) {
    if (line === '' || line.startsWith('# ')) continue;
    const i = line.indexOf(' ');
    table.set(
      line.slice(0, i),
      line
        .slice(i + 1)
        .replace(/\\(?:u[0-9a-fA-F]{4}|n|t|\\)/g, (m) =>
          m === '\\n'
            ? '\n'
            : m === '\\t'
              ? '\t'
              : m === '\\\\'
                ? '\\'
                : String.fromCharCode(parseInt(m.slice(2), 16))
        )
    );
  }
  const refs: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  };
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => refs[c]);
  const names = [...table.keys()];
  const source = names.map((n) => `&${n};`).join(' ');
  const expected = `<p>${names.map((n) => escape(table.get(n)!)).join(' ')}</p>\n`;
  // the second render answers short names from the cache
  assert.equal(html(source), expected);
  assert.equal(html(source), expected);
  // near misses: a suffix, a dropped last byte, and flipped case
  for (const n of names) {
    for (const miss of [
      `${n}x`,
      n.slice(0, -1),
      n[0] === n[0].toLowerCase() ? n.toUpperCase() : n.toLowerCase(),
    ]) {
      if (miss === '' || table.has(miss)) continue;
      assert.equal(html(`&${miss};`), `<p>&amp;${miss};</p>\n`, miss);
    }
  }
});
