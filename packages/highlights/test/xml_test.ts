import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
} from './_util';

let xml: TestLang;
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

void t.test('xml: script and style are XML markup, not HTML raw text', () => {
  assert.deepEqual(
    tokenKinds(
      'xml',
      '<script>if (a < b) {}<Node/></script>\n<style>.a{}</style>'
    ),
    [
      ['<', 'punctuation.bracket.html'],
      ['script', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['if (a < b) {}', null],
      ['<', 'punctuation.bracket.html'],
      ['Node', 'tag'],
      ['/></', 'punctuation.bracket.html'],
      ['script', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['<', 'punctuation.bracket.html'],
      ['style', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['.a{}', null],
      ['</', 'punctuation.bracket.html'],
      ['style', 'tag'],
      ['>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test('xml: processing instructions with and without data', () => {
  assert.deepEqual(
    tokenKinds(
      'xml',
      '<?xml version="1.0" encoding="UTF-8"?>\n<?target data="x"?>\n<?pi?>\n<a/>'
    ),
    [
      ['<?xml version="1.0" encoding="UTF-8"?>', 'preproc'],
      ['<?target data="x"?>', 'preproc'],
      ['<?pi?>', 'preproc'],
      ['<', 'punctuation.bracket.html'],
      ['a', 'tag'],
      ['/>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test('xml: external and internal doctype declarations', () => {
  assert.deepEqual(
    tokenKinds(
      'xml',
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "http://x">\n<!DOCTYPE note [\n<!ELEMENT note (to,from)>\n<!ENTITY x "y">\n]>'
    ),
    [
      [
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "http://x">',
        'tag.doctype',
      ],
      ['<!DOCTYPE note [', 'tag.doctype'],
      ['<!ELEMENT note (to,from)>', 'tag.doctype'],
      ['<!ENTITY x "y">', 'tag.doctype'],
      [']>', 'tag.doctype'],
    ]
  );
});

void t.test(
  'xml: character references, while bare ampersands stay text',
  () => {
    assert.deepEqual(
      tokenKinds('xml', '<a>&amp; &#169; &#x00A9; &lt; &bad text</a>'),
      [
        ['<', 'punctuation.bracket.html'],
        ['a', 'tag'],
        ['>', 'punctuation.bracket.html'],
        ['&amp;', 'string.special'],
        ['&#169;', 'string.special'],
        ['&#x00A9;', 'string.special'],
        ['&lt;', 'string.special'],
        ['&bad text', null],
        ['</', 'punctuation.bracket.html'],
        ['a', 'tag'],
        ['>', 'punctuation.bracket.html'],
      ]
    );
  }
);

void t.test(
  'xml: namespaced names, both quote styles, and empty values',
  () => {
    assert.deepEqual(
      tokenKinds(
        'xml',
        '<x:tag xmlns:x="urn:x" x:attr=\'v\' empty="">t</x:tag>'
      ),
      [
        ['<', 'punctuation.bracket.html'],
        ['x:tag', 'tag'],
        ['xmlns:x', 'attribute'],
        ['=', 'punctuation.delimiter.html'],
        ['"urn:x"', 'string'],
        ['x:attr', 'attribute'],
        ['=', 'punctuation.delimiter.html'],
        ["'v'", 'string'],
        ['empty', 'attribute'],
        ['=', 'punctuation.delimiter.html'],
        ['""', 'string'],
        ['>', 'punctuation.bracket.html'],
        ['t', null],
        ['</', 'punctuation.bracket.html'],
        ['x:tag', 'tag'],
        ['>', 'punctuation.bracket.html'],
      ]
    );
  }
);

void t.test('xml: names with punctuation and non-ASCII letters', () => {
  assert.deepEqual(
    tokenKinds('xml', '<self-closing.tag_1/>\n<é-tag>é</é-tag>'),
    [
      ['<', 'punctuation.bracket.html'],
      ['self-closing.tag_1', 'tag'],
      ['/>', 'punctuation.bracket.html'],
      ['<', 'punctuation.bracket.html'],
      ['é-tag', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['é', null],
      ['</', 'punctuation.bracket.html'],
      ['é-tag', 'tag'],
      ['>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test('xml: comments and CDATA sections span lines', () => {
  assert.deepEqual(
    tokenKinds(
      'xml',
      '<!-- one line -->\n<!-- multi\nline -->\n<![CDATA[one]]>\n<![CDATA[multi\nline]]>'
    ),
    [
      ['<!-- one line -->', 'comment'],
      ['<!-- multi', 'comment'],
      ['line -->', 'comment'],
      ['<![CDATA[one]]>', 'text.literal'],
      ['<![CDATA[multi', 'text.literal'],
      ['line]]>', 'text.literal'],
    ]
  );
  assertLineFedParity(
    'xml',
    '<a>\n<!-- multi\nline -->\n<![CDATA[x\ny]]>\n<b\n c="1"\n d=\'2\'>\n</b></a>\n<?pi\n data?>\n'
  );
});

void t.test(
  'xml: an unterminated comment swallows the rest of the document',
  () => {
    const kinds = tokenKinds('xml', '<a x=\n<!-- unterminated\n<b>');
    assert.deepEqual(kinds.slice(4), [
      ['<!-- unterminated', 'comment'],
      ['<b>', 'comment'],
    ]);
  }
);

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
    '&#;',
    "<é 名='値'>",
    '<>',
    '</>',
    '< a>',
    '<a>text</a',
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
