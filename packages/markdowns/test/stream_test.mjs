import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createMarkdownSession, renderToElements } from '../dist/node.mjs';

/** @param {import('@pierre/markdowns').MarkdownNode[]} nodes @returns {string} */
const flatten = (nodes) =>
  nodes
    .map((node) => (node.type === 'text' ? node.value : flatten(node.children)))
    .join('');
/**
 * @param {import('@pierre/markdowns').MarkdownNode[]} nodes
 * @returns {import('@pierre/markdowns').MarkdownElement[]}
 */
const links = (nodes) =>
  nodes.flatMap((node) =>
    node.type === 'text'
      ? []
      : [...(node.tagName === 'a' ? [node] : []), ...links(node.children)]
  );

void test('a delivery-ending label keeps its incomplete link across the ] boundary', () => {
  const session = createMarkdownSession();
  for (const source of [
    'See [l',
    'See [link',
    'See [link]',
    'See [link](',
    'See [link](https://exam',
  ]) {
    const nodes = session.render(source, { incomplete: true });
    assert.equal(
      flatten(nodes),
      source.startsWith('See [link') ? 'See link' : 'See l'
    );
    assert.equal(links(nodes).length, 1);
    assert.equal(links(nodes)[0].properties.href, 'streamdown:incomplete-link');
  }
  assert.equal(
    links(
      session.render('See [link](https://example.com)', { incomplete: true })
    )[0].properties.href,
    'https://example.com'
  );
});

void test('closed streaming labels preserve references, images, and footnotes at EOF', () => {
  const references = [
    '[label]: /target\n\nSee [label]',
    '[label]: /target\n\nSee [label][]',
    '[label]: /target\n\nSee [visible][label]',
    '[É 中]: /unicode\n\nSee [é 中]',
    '[a\\*b]: /escaped\n\nSee [a\\*b]',
    '> [label]: /target\n>\n> See [label]',
    '- [label]: /target\n\n  See [label]',
    '[image]: /image.png\n\n![image]',
    '[image]: /image.png\n\n![image][]',
    '[image]: /image.png\n\n![visible][image]',
    '[^note]: A note\n\nSee[^note]',
    '[^note]: A note\n\n> See[^note]',
  ];
  for (const source of references) {
    const expected = renderToElements(source);
    assert.deepEqual(
      renderToElements(source, { incomplete: true }),
      expected,
      source
    );
    // A following static render must not inherit the synthetic-destination flag.
    assert.deepEqual(renderToElements(source), expected, source);
  }
});

void test('trailing labels keep UTF-8, nested formatting, and synthetic outer emphasis', () => {
  for (const [source, expected] of [
    ['See [é 中]', 'See é 中'],
    ['See [**bold** and `code`]', 'See bold and code'],
  ]) {
    const nodes = renderToElements(source, { incomplete: true });
    assert.equal(flatten(nodes), expected);
    assert.equal(links(nodes).length, 1);
  }
  for (const delimiter of ['*', '**', '_', '__', '~~']) {
    const source = `[label]: /target\n\n${delimiter}See [label]`;
    assert.deepEqual(
      renderToElements(source, { incomplete: true }),
      renderToElements(source + delimiter),
      source
    );
    const unresolved = `${delimiter}See [new]`;
    const nodes = renderToElements(unresolved, { incomplete: true });
    assert.equal(flatten(nodes), 'See new', unresolved);
    assert.equal(links(nodes)[0].properties.href, 'streamdown:incomplete-link');
    assert.notEqual(nodes[0].children[0].type, 'text', unresolved);
  }
});

void test('completion flags never change authored sentinel URLs or static brackets', () => {
  const authored = '[label]: /real\n\n[label](streamdown:incomplete-link)';
  const expected = renderToElements(authored);
  assert.equal(
    links(expected)[0].properties.href,
    'streamdown:incomplete-link'
  );
  renderToElements('See [pending]', { incomplete: true });
  assert.deepEqual(renderToElements(authored), expected);
  assert.deepEqual(renderToElements(authored, { incomplete: true }), expected);
  assert.equal(flatten(renderToElements('See [pending]')), 'See [pending]');
});

void test('closed-label repair never changes code, raw blocks, or reference destinations', () => {
  for (const source of [
    '    [code]',
    '```text\n[code]',
    '<pre>\n[code]',
    '<div>\n[raw]',
    'See [guide]\n\n[guide]: https://example.com/[doc]',
    'See [guide]\n\n[guide]: https://example.com/doc "[title]"',
  ]) {
    assert.deepEqual(
      renderToElements(source, { incomplete: true }),
      renderToElements(source),
      source
    );
  }
});

void test('only the final source label is repaired in rebuilt blocks and table cells', () => {
  for (const [source, expected] of [
    ['[old]\n\n[new]', '[old]new'],
    ['> Earlier\n> See [new]', '\nEarlier\nSee new\n'],
    ['- Earlier\n  See [new]', 'Earlier\nSee new'],
    ['| A | B |\n|---|---|\n| [old] | [new]', 'AB[old]new'],
    ['| A | B |\n|---|---|\n| [old] | a\\|b [new]', 'AB[old]a|b new'],
  ]) {
    const nodes = renderToElements(source, { incomplete: true });
    assert.equal(flatten(nodes), expected, source);
    assert.equal(links(nodes).length, 1, source);
    assert.equal(flatten(links(nodes)[0].children), 'new', source);
  }
});

void test('every conformance-example prefix matches full parsing in both completion modes', () => {
  for (const name of ['commonmark', 'gfm']) {
    const examples = JSON.parse(
      readFileSync(new URL(`./spec/${name}-spec.json`, import.meta.url), 'utf8')
    );
    for (const { markdown, example } of examples) {
      const source = `Completed **prefix**.\n\n${markdown}\n\nTail`;
      for (const incomplete of [false, true]) {
        const session = createMarkdownSession();
        for (let end = 0; end <= source.length; end++) {
          const input = source.slice(0, end);
          assert.deepEqual(
            session.render(input, { incomplete }),
            renderToElements(input, { incomplete }),
            JSON.stringify({ name, example, input, incomplete })
          );
        }
      }
    }
  }
});
