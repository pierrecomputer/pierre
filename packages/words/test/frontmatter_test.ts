import assert from 'node:assert';
import test from 'node:test';

import { type RenderOptions, renderToHtml } from '../dist/index.js';

const dec = new TextDecoder();
const meta = (yaml: string) =>
  renderToHtml(`---\n${yaml}\n---\nbody\n`, { frontmatter: true })[0];

void test('scalars are typed the way YAML says', () => {
  assert.deepEqual(meta('a: hello'), { a: 'hello' });
  assert.deepEqual(meta('a: 42\nb: -1.5\nc: 2e3'), { a: 42, b: -1.5, c: 2e3 });
  assert.deepEqual(meta('a: true\nb: False\nc: null\nd: ~\ne:'), {
    a: true,
    b: false,
    c: null,
    d: null,
    e: null,
  });
  assert.deepEqual(meta('a: "1"\nb: \'2\''), { a: '1', b: '2' });
  assert.deepEqual(
    meta('a: 2024-01-02'),
    { a: '2024-01-02' },
    'a date stays a string'
  );
  // only the three YAML spellings of each word are special
  assert.deepStrictEqual(
    meta('a: True\nb: TRUE\nc: tRUE\nd: NULL\ne: nULL\nf: FALSE\ng: fAlse'),
    { a: true, b: true, c: 'tRUE', d: null, e: 'nULL', f: false, g: 'fAlse' }
  );
});

void test('quoted scalars decode their escapes into valid JSON', () => {
  assert.deepStrictEqual(meta('a: "He said \\"hi\\""'), { a: 'He said "hi"' });
  assert.deepStrictEqual(meta("a: 'It''s here'"), { a: "It's here" });
  assert.deepStrictEqual(meta('a: "x\\ny\\t\\\\\\/\\0\\a\\b\\e\\v\\f\\r\\ "'), {
    a: 'x\ny\t\\/\0\x07\b\x1b\v\f\r ',
  });
  assert.deepStrictEqual(
    meta('a: "\\x41 \\u00e9 \\U0001F600 \\ud83d\\ude00 \\N\\_\\L\\P"'),
    { a: 'A é 😀 😀 \u0085   ' }
  );
  // unknown or short escapes keep their backslash; JSON stays valid
  assert.deepStrictEqual(meta('a: "\\q \\x4"'), { a: '\\q \\x4' });
  assert.deepStrictEqual(meta('a: "\\x4@"'), { a: '\\x4@' });
  assert.deepStrictEqual(meta("\"k\\\"x\": 1\n'k''y': 2"), {
    'k"x': 1,
    "k'y": 2,
  });
  assert.deepStrictEqual(meta('a: "x # y" # z'), { a: 'x # y' });
});

void test('mappings, sequences and comments', () => {
  assert.deepEqual(meta('a:\n  b: 1\n  c: 2'), { a: { b: 1, c: 2 } });
  assert.deepEqual(meta('a:\n  - 1\n  - 2'), { a: [1, 2] });
  assert.deepEqual(meta('- 1\n- 2'), [1, 2]);
  assert.deepEqual(meta('a:\n  - n: x\n    v: 1\n  - n: y'), {
    a: [{ n: 'x', v: 1 }, { n: 'y' }],
  });
  assert.deepEqual(meta('# lead\na: 1 # trailing\n# tail'), { a: 1 });
  assert.deepEqual(meta('a: "has # hash"'), { a: 'has # hash' });
  // a comment after the colon leaves the value to the following lines
  assert.deepStrictEqual(meta('a:    # c\n  b: 1'), { a: { b: 1 } });
  assert.deepStrictEqual(meta('a: # c\n  - 1'), { a: [1] });
});

void test('a comment that holds a colon does not make a key', () => {
  assert.deepStrictEqual(meta('tags:\n  - foo # note: first\n  - bar'), {
    tags: ['foo', 'bar'],
  });
  assert.deepStrictEqual(meta('hello # a: b'), 'hello');
  assert.deepStrictEqual(meta('a: 1 # b: c\nd: 2'), { a: 1, d: 2 });
  // `#` inside a quoted key or without a space before it is no comment
  assert.deepStrictEqual(meta('"k # x": 1\nb#c: 2'), { 'k # x': 1, 'b#c': 2 });
});

void test('a sequence may sit in its key column', () => {
  assert.deepStrictEqual(meta('tags:\n- a\n- b\ntitle: t'), {
    tags: ['a', 'b'],
    title: 't',
  });
  assert.deepStrictEqual(meta('a:\n- x\nb:\n  - y'), { a: ['x'], b: ['y'] });
});

void test('sequence items may be flow mappings or block scalars', () => {
  assert.deepStrictEqual(meta('- {name: A, url: x}\n- [a, b]'), [
    { name: 'A', url: 'x' },
    ['a', 'b'],
  ]);
  assert.deepStrictEqual(meta('- |\n  item\n- >\n  fo\n  ld'), [
    'item\n',
    'fo ld\n',
  ]);
});

void test('a top-level scalar or flow collection is the document', () => {
  assert.deepStrictEqual(meta('hello'), 'hello');
  assert.deepStrictEqual(meta('42'), 42);
  assert.deepStrictEqual(meta('"quoted"'), 'quoted');
  assert.deepStrictEqual(meta('[1, 2]'), [1, 2]);
  assert.deepStrictEqual(meta('{a: 1}'), { a: 1 });
});

void test('flow collections and scalars continue on more indented lines', () => {
  assert.deepStrictEqual(meta('a: [1,\n  2]\nb: 3'), { a: [1, 2], b: 3 });
  assert.deepStrictEqual(meta('a: {b: 1, # one\n  c: [2,\n    3]}'), {
    a: { b: 1, c: [2, 3] },
  });
  assert.deepStrictEqual(meta('a: plain\n  more\n\n  after\nb: 1'), {
    a: 'plain more\nafter',
    b: 1,
  });
  assert.deepStrictEqual(meta('a: \'line\n\n  break\'\nb: "x\n  y"'), {
    a: 'line\nbreak',
    b: 'x y',
  });
  assert.deepStrictEqual(meta('{ k:0: it\'s, "q":1 }'), {
    'k:0': "it's",
    q: 1,
  });
});

void test('a flow collection may close in the column of its key', () => {
  assert.deepStrictEqual(
    meta('tags: [\n  a,\n  b # last\n]\nobj: {\n  k: 1\n}\nnext: 2'),
    { tags: ['a', 'b'], obj: { k: 1 }, next: 2 }
  );
  assert.deepStrictEqual(
    meta('a:\n  - [\n    1\n  ]\n  - {\n    k: v\n  }\nb: 2'),
    { a: [[1], { k: 'v' }], b: 2 }
  );
  // only a collection takes the line: a quoted scalar ends at its indentation
  assert.deepStrictEqual(meta('a: "x\n]"\nb: 1'), { a: 'x' });
  assert.deepStrictEqual(meta('a: [1]\n]\nb: 2'), { a: [1] });
});

void test('flow collections and block scalars', () => {
  assert.deepEqual(meta('a: [1, 2, x]'), { a: [1, 2, 'x'] });
  assert.deepEqual(meta('a: {b: 1, c: two}'), { a: { b: 1, c: 'two' } });
  assert.deepEqual(meta('a: [[1, 2], [3]]'), { a: [[1, 2], [3]] });
  assert.deepEqual(meta('a: |\n  one\n  two'), { a: 'one\ntwo\n' });
  assert.deepEqual(meta('a: |-\n  one\n  two'), { a: 'one\ntwo' });
  assert.deepEqual(meta('a: >\n  one\n  two'), { a: 'one two\n' });
  // blank lines inside, before, and (with `+`) after the content
  assert.deepStrictEqual(meta('a: |\n  x\n\n  y'), { a: 'x\n\ny\n' });
  assert.deepStrictEqual(meta('a: |\n\n  x'), { a: '\nx\n' });
  assert.deepStrictEqual(meta('a: >\n  x\n\n  y'), { a: 'x\ny\n' });
  assert.deepStrictEqual(meta('a: |+\n  x\n\nb: 1'), { a: 'x\n\n', b: 1 });
  // an indentation indicator keeps deeper indentation
  assert.deepStrictEqual(meta('a: |2\n    x\n  y'), { a: '  x\ny\n' });
  assert.deepStrictEqual(meta('a: |-2\n    x\n  y'), { a: '  x\ny' });
});

void test('a folded scalar keeps the breaks around more indented lines', () => {
  assert.deepStrictEqual(meta('a: >\n  x\n    y\n  z'), { a: 'x\n  y\nz\n' });
  assert.deepStrictEqual(meta('a: >\n  x\n\n    y\n    y\n\n  z\n  z'), {
    a: 'x\n\n  y\n  y\n\nz z\n',
  });
  assert.deepStrictEqual(meta('a: >-\n  x\n  \ty\n  z'), { a: 'x\n\ty\nz' });
});

void test('the frontmatter is removed from the body', () => {
  const [m, html] = renderToHtml('---\ntitle: T\n---\n# H\n', {
    frontmatter: true,
  });
  assert.deepEqual(m, { title: 'T' });
  assert.equal(dec.decode(html), '<h1>H</h1>\n');
  // after a byte order mark, and with spaces after the closing line
  for (const source of ['﻿---\na: 1\n---\nbody', '---\na: 1\n--- \t\nbody']) {
    const [bom, body] = renderToHtml(source, { frontmatter: true });
    assert.deepStrictEqual(bom, { a: 1 }, JSON.stringify(source));
    assert.equal(dec.decode(body), '<p>body</p>\n', JSON.stringify(source));
  }
});

void test('incomplete repair starts after the frontmatter', () => {
  for (const [source, value, body] of [
    ['---\npattern: "**/*.ts"\n---\nHello world', '**/*.ts', 'Hello world'],
    ['---\nalt: ![x\n---\nbody *em', '![x', 'body <em>em</em>'],
    ['﻿---\na: _x\n---\n`code', '_x', '<code>code</code>'],
  ]) {
    const [m, html] = renderToHtml(source, {
      frontmatter: true,
      incomplete: true,
    });
    assert.deepStrictEqual(Object.values(m ?? {}), [value], source);
    assert.equal(dec.decode(html), `<p>${body}</p>\n`, source);
  }
});

void test('without the option the block is ordinary markdown', () => {
  assert.equal(
    dec.decode(renderToHtml('---\ntitle: T\n---\n# H\n')),
    '<hr />\n<h2>title: T</h2>\n<h1>H</h1>\n'
  );
});

void test('a document with no frontmatter reports none', () => {
  const [m, html] = renderToHtml('# H\n', { frontmatter: true });
  assert.equal(m, null);
  assert.equal(dec.decode(html), '<h1>H</h1>\n');
  assert.deepEqual(
    renderToHtml('---\nunterminated\n', { frontmatter: true })[0],
    null
  );
});

void test('numbers follow the YAML 1.2 core schema in JSON spelling', () => {
  assert.deepStrictEqual(meta('a: 0'), { a: 0 });
  assert.deepStrictEqual(meta('a: -1.5e-3'), { a: -0.0015 });
  assert.deepStrictEqual(meta('a: 1e5'), { a: 100000 });
  for (const [src, value] of [
    ['.5', 0.5],
    ['+.5', 0.5],
    ['5.', 5],
    ['007', 7],
    ['+5', 5],
    ['-00.50', -0.5],
    ['1E+3', 1000],
    ['0x1f', 31],
    ['0o17', 15],
    ['0xFFFFFFFFFFFFFFFF', 2 ** 64],
    // JSON has no infinities or NaN; JSON.stringify also writes null
    ['.inf', null],
    ['-.Inf', null],
    ['.NaN', null],
    // not numbers in the core schema
    ['1e', '1e'],
    ['1.2.3', '1.2.3'],
    ['1_000', '1_000'],
    ['-0x1', '-0x1'],
    ['0x@', '0x@'],
    ['0x1`', '0x1`'],
    ['0x1FFFFFFFFFFFFFFFF', '0x1FFFFFFFFFFFFFFFF'],
    ['.Nan', '.Nan'],
  ] as const) {
    assert.deepStrictEqual(meta(`a: ${src}`), { a: value }, src);
  }
});

void test('a malformed flow collection still yields parseable metadata', () => {
  assert.deepEqual(meta('a: [x, y,]'), { a: ['x', 'y'] });
  assert.deepEqual(meta('a: {x: 1,}'), { a: { x: 1 } });
  assert.deepEqual(meta('a: [,]'), { a: [] });
  assert.deepEqual(meta('a: {x}'), { a: { x: null } });
  assert.deepEqual(meta('a: ['), { a: [] });
  assert.deepEqual(meta('a: {x: '), { a: { x: null } });
  assert.deepEqual(meta('a: [}'), { a: ['}'] });
  assert.deepEqual(meta('a: [{]'), { a: [{ ']': null }] });
  // `k: v` inside a flow sequence is the one-pair mapping YAML says it is
  assert.deepEqual(meta('a: [x: 1, y]'), { a: [{ x: 1 }, 'y'] });
});

void test('a nested flow collection keeps its comments and quoted `#`', () => {
  assert.deepStrictEqual(
    meta('a: [{title: "Issue #12", url: /x}, ["r # y"], z]'),
    { a: [{ title: 'Issue #12', url: '/x' }, ['r # y'], 'z'] }
  );
  assert.deepStrictEqual(
    meta('a: [\n  [1, 2], # one\n  [3, # three\n   4],\n]\nb: 1'),
    {
      a: [
        [1, 2],
        [3, 4],
      ],
      b: 1,
    }
  );
  assert.deepStrictEqual(meta('a: {k: [1, # c\n  2], l: 3}'), {
    a: { k: [1, 2], l: 3 },
  });
});

void test('deeply nested frontmatter does not overflow the stack', () => {
  for (const src of [
    '- '.repeat(100000) + 'x',
    'a: ' + '['.repeat(100000),
    'a: ' + '{'.repeat(50000),
  ]) {
    assert.doesNotThrow(() =>
      renderToHtml(`---\n${src}\n---\nbody\n`, { frontmatter: true })
    );
  }
});

void test('a boolean frontmatter option types as both results', () => {
  const options: RenderOptions = { frontmatter: true };
  const result = renderToHtml('---\na: 1\n---\nb', options);
  // @ts-expect-error The result may be a [meta, html] pair at runtime.
  assert.throws(() => new TextDecoder().decode(result), TypeError);
  assert.ok(Array.isArray(result));
  assert.deepEqual(result[0], { a: 1 });
  const off: RenderOptions & { frontmatter?: false } = { frontmatter: false };
  assert.ok(renderToHtml('a', off) instanceof Uint8Array);
});
