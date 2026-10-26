import assert from 'node:assert';
import test from 'node:test';

import { renderToAnsi, renderToHtml } from '../dist/node.mjs';

/** xorshift, so a failure is always reproducible from its seed */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const PIECES = [
  '*',
  '**',
  '_',
  '__',
  '~~',
  '`',
  '``',
  '\\',
  '[',
  ']',
  '(',
  ')',
  '!',
  '#',
  '##',
  '>',
  '-',
  '+',
  '1.',
  '|',
  ':',
  '---',
  '===',
  '```',
  '~~~',
  '&amp;',
  '&#65;',
  '&',
  ';',
  '\n',
  '\n\n',
  ' ',
  '  ',
  '\t',
  'a',
  'bc',
  'word',
  'http://x.test/p',
  'www.x.test',
  'a@b.test',
  '<b>',
  '</b>',
  '<!--',
  '-->',
  'é',
  '你',
  '🎉',
  '́',
  '[l]: /u',
  '^',
  '%',
  '{',
  '}',
];

function makeInput(rand, pieces) {
  const n = 1 + Math.floor(rand() * 60);
  let out = '';
  for (let i = 0; i < n; i++) out += pieces[Math.floor(rand() * pieces.length)];
  return out;
}

/** every tag the HTML renderer can emit, with the void ones excluded */
const PAIRED = [
  'p',
  'em',
  'strong',
  'del',
  'a',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

function tagBalance(html) {
  const counts = new Map();
  for (const [, slash, name] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)/g)) {
    if (!PAIRED.includes(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + (slash ? -1 : 1));
  }
  return [...counts].filter(([, n]) => n !== 0);
}

void test('random input never crashes and stays valid UTF-8', () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const rand = rng(0x5eed);
  for (let i = 0; i < 4000; i++) {
    const input = makeInput(rand, PIECES);
    try {
      // each view is only valid until the next call, so decode it right away
      decoder.decode(renderToHtml(input));
      decoder.decode(renderToAnsi(input, { width: 40 }));
    } catch (error) {
      assert.fail(
        `case ${i} threw ${error.message} on ${JSON.stringify(input)}`
      );
    }
  }
});

void test('generated tags are balanced when the input has no raw HTML', () => {
  const decoder = new TextDecoder();
  const pieces = PIECES.filter(
    (p) => !p.includes('<') && !p.includes('>') && !p.includes('&')
  );
  const rand = rng(0xc0ffee);
  for (let i = 0; i < 4000; i++) {
    const input = makeInput(rand, pieces);
    const unbalanced = tagBalance(decoder.decode(renderToHtml(input)));
    assert.deepEqual(unbalanced, [], `case ${i}: ${JSON.stringify(input)}`);
  }
});

void test('rendering is deterministic', () => {
  const decoder = new TextDecoder();
  const rand = rng(0xd0d0);
  for (let i = 0; i < 500; i++) {
    const input = makeInput(rand, PIECES);
    const first = decoder.decode(renderToHtml(input));
    renderToHtml('noise '.repeat(2000));
    assert.equal(
      decoder.decode(renderToHtml(input)),
      first,
      JSON.stringify(input)
    );
  }
});

void test('frontmatter always converts to JSON the host can parse', () => {
  const yaml = [
    '[',
    ']',
    '{',
    '}',
    ',',
    ':',
    ' ',
    'a',
    '1',
    '-',
    '.',
    '0',
    '"',
    "'",
    '#',
    '\\',
    'e',
    '+',
    '~',
    'null',
    'true',
    '|',
    '>',
    '*',
    '&',
    '!',
    '%',
    '@',
    '`',
    '?',
    '\t',
  ];
  const rand = rng(0x7ea11);
  for (let i = 0; i < 6000; i++) {
    const lines = [];
    for (let j = 0; j <= Math.floor(rand() * 4); j++) {
      let line = ' '.repeat(Math.floor(rand() * 4));
      for (let k = 0; k <= Math.floor(rand() * 12); k++)
        line += yaml[Math.floor(rand() * yaml.length)];
      lines.push(line);
    }
    const input = `---\n${lines.join('\n')}\n---\nbody\n`;
    // renderToHtml parses the metadata itself, so a bad conversion throws here
    assert.doesNotThrow(
      () => renderToHtml(input, { frontmatter: true }),
      JSON.stringify(lines)
    );
  }
});
