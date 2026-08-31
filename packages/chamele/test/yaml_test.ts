import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  type TestLang,
  themeColor,
} from './util';

let yaml: TestLang;
t.before(() => (yaml = loadLang('yaml', '$hlYaml')));

const PROPERTY = themeColor('property');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const BOOLEAN = themeColor('boolean');
const CONSTANT = themeColor('constant.builtin');
const COMMENT = themeColor('comment');
const TYPE = themeColor('type');

void t.test('yaml: mappings, sequences, scalars, and comments', () => {
  const src =
    'name: chamele\nenabled: true\ncount: 12\nnothing: null\nitems:\n  - one\n  - two # tail\n';
  const html = checkInvariants(yaml.hl, src);
  assert.equal(colorOf(html, 'name'), PROPERTY);
  assert.equal(colorOf(html, 'chamele'), STRING);
  assert.equal(colorOf(html, 'true'), BOOLEAN);
  assert.equal(colorOf(html, '12'), NUMBER);
  assert.equal(colorOf(html, 'null'), CONSTANT);
  assert.equal(colorOf(html, '# tail'), COMMENT);
});

void t.test('yaml: quoted keys, escapes, anchors, aliases, and tags', () => {
  const src =
    '"quoted": "a\\nb"\nbase: &base value\ncopy: *base\ntagged: !thing x\n';
  const html = checkInvariants(yaml.hl, src);
  assert.equal(colorOf(html, '"quoted"'), PROPERTY);
  assert.equal(colorOf(html, '\\n'), ESCAPE);
  assert.equal(colorOf(html, '&base'), TYPE);
  assert.equal(colorOf(html, '*base'), TYPE);
  assert.equal(colorOf(html, '!thing'), TYPE);
});

void t.test('yaml: document markers and flow collections', () => {
  const html = checkInvariants(
    yaml.hl,
    '---\nmap: {a: 1, b: [yes, no, off]}\nempty: ~\n...\n'
  );
  assert.equal(colorOf(html, 'off'), BOOLEAN);
  assert.equal(colorOf(html, '~'), CONSTANT);
});

void t.test(
  'yaml: hashes in plain scalars and key lookahead stay on their line',
  () => {
    const html = checkInvariants(
      yaml.hl,
      'value: foo#bar\nlonely\n: invalid\n# real\n'
    );
    assert.equal(colorOf(html, 'foo#bar'), STRING);
    assert.equal(colorOf(html, 'lonely'), STRING);
    assert.equal(colorOf(html, '# real'), COMMENT);
  }
);

void t.test('yaml: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    "'unterminated",
    '"\\é',
    'a:',
    '#',
    '---',
    '[a, {b:',
    'é: 日本語',
  ]) {
    checkInvariants(yaml.hl, src);
  }
  const splitSrc = 'a: "\\é"\n';
  for (
    let split = 0;
    split <= new TextEncoder().encode(splitSrc).length;
    split++
  ) {
    checkInvariants(loadLang('yaml', '$hlYaml', split).hl, splitSrc);
  }
});
