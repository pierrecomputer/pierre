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
