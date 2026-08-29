import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  themeColor,
} from './util.mjs';

let xml;
t.before(() => (xml = loadLang('xml', '$hlXml')));

const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const STRING = themeColor('string');
const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');
const LITERAL = themeColor('text.literal');
const SPECIAL = themeColor('string.special');

void t.test('xml: elements, namespaces, attributes, and entities', () => {
  const out = checkInvariants(
    xml.hl,
    '<Root xmlns:x="urn:x"><x:Item ID="A">&amp;</x:Item></Root>'
  );
  assert.equal(colorOf(out, 'Root'), TAG);
  assert.equal(colorOf(out, 'xmlns:x'), ATTR);
  assert.equal(colorOf(out, '"urn:x"'), STRING);
  assert.equal(colorOf(out, '&amp;'), SPECIAL);
});

void t.test('xml: PI, CDATA, comments, and an internal-subset doctype', () => {
  const src =
    '<?xml version="1.0"?>\n<!DOCTYPE Root [<!ELEMENT Root (#PCDATA)>]>\n<Root><![CDATA[a < b]]><!-- note --></Root>';
  const out = checkInvariants(xml.hl, src);
  assert.equal(colorOf(out, '<?xml version="1.0"?>'), PREPROC);
  assert.equal(colorOf(out, '<![CDATA[a < b]]>'), LITERAL);
  assert.equal(colorOf(out, '<!-- note -->'), COMMENT);
  assert.ok(
    spansOf(out).some(
      (span) => span.text.includes('<!DOCTYPE Root') && span.color === TAG
    )
  );
});

void t.test('xml: script is XML markup, not HTML raw text', () => {
  const out = checkInvariants(xml.hl, '<script><Node/></script>');
  assert.equal(colorOf(out, 'Node'), TAG);
});

void t.test('xml: malformed and split ranges remain bounded', () => {
  for (const src of [
    '<',
    '</',
    '<A x=',
    '"',
    '<![CDATA[x',
    '<!--x',
    '<?pi',
    '<!DOCTYPE R [',
    '&bad',
    "<é 名='値'>",
  ]) {
    checkInvariants(xml.hl, src);
  }
  for (const src of [
    '<Root a="x"><Child/></Root>',
    '<![CDATA[x]]>',
    '<!DOCTYPE html>',
  ]) {
    const size = new TextEncoder().encode(src).length;
    for (let split = 0; split <= size; split++) {
      checkInvariants(loadLang('xml', '$hlXml', split).hl, src);
    }
  }
  assert.equal(
    colorOf(
      checkInvariants(loadLang('xml', '$hlXml', 8).hl, '<![CDATA[x]]>'),
      '<![CDATA'
    ),
    undefined
  );
  assert.equal(
    colorOf(
      checkInvariants(loadLang('xml', '$hlXml', 8).hl, '<!DOCTYPE html>'),
      '<!DOCTYP'
    ),
    undefined
  );
});
