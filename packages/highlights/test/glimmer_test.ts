import assert from 'node:assert/strict';
import t from 'node:test';

import type { Lang } from '../lib/core';
import { codeToTokens, LiveTokenizer, StreamTokenizer } from '../lib/core';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  tokenKinds,
} from './_util';

t.before(initFullModule);

const open = [
  ['<', 'punctuation.bracket.html'],
  ['template', 'tag'],
  ['>', 'punctuation.bracket.html'],
] as const;
const close = [
  ['</', 'punctuation.bracket.html'],
  ['template', 'tag'],
  ['>', 'punctuation.bracket.html'],
] as const;

/** Whole input, every line-end stream cut, line-fed, and live lines agree. */
function assertAllModes(lang: Lang, code: string): void {
  const options = { lang, theme: distinctTheme };
  const expected = codeToTokens(code, options).tokens;
  assertLineFedParity(lang, code);
  for (
    let cut = code.indexOf('\n');
    cut !== -1;
    cut = code.indexOf('\n', cut + 1)
  ) {
    const stream = new StreamTokenizer(options);
    const actual = [
      ...stream.pushCode(code.slice(0, cut + 1)),
      ...stream.pushCode(code.slice(cut + 1)),
      ...stream.end(),
    ];
    assert.deepEqual(actual, expected, `${lang}: cut ${cut} of ${code}`);
  }
  const live = new LiveTokenizer({ ...options, code });
  try {
    let offset = 0;
    for (let line = 0; line < live.lineCount; line++) {
      assert.deepEqual(
        live.getLineTokens(line).tokens,
        expected[line].map((token) => ({
          ...token,
          offset: token.offset - offset,
        })),
        `${lang}: live line ${line} of ${code}`
      );
      offset += live.getLineLength(line) + 1;
    }
  } finally {
    live.dispose();
  }
}

for (const lang of ['glimmer-js', 'glimmer-ts'] as const) {
  void t.test(`${lang}: <template> as an expression and a class member`, () => {
    assert.deepEqual(
      tokenKinds(lang, 'const Hi = <template>Hello {{@name}}!</template>;'),
      [
        ['const', 'keyword.declaration'],
        ['Hi', 'type'],
        ['=', 'operator'],
        ...open,
        ['Hello', null],
        ['{{', 'punctuation.special'],
        ['@name', 'variable.special'],
        ['}}', 'punctuation.special'],
        ['!', null],
        ...close,
        [';', 'punctuation.delimiter'],
      ]
    );
    assert.deepEqual(
      tokenKinds(lang, 'export default <template>hi</template>').slice(2, 5),
      open
    );
    // after `{`, `;`, a method body, or a field without a semicolon
    for (const code of [
      'class A extends Component {\n  <template>hi</template>\n}',
      'class A {\n  x = 1;\n  <template>hi</template>\n}',
      'class A {\n  get x() { return 1; }\n  <template>hi</template>\n}',
      'class A {\n  @tracked count = 0\n  <template>hi</template>\n}',
      'foo([<template>a</template>, (<template>b</template>)]);',
      'x ? <template>a</template> : <template>b</template>;',
    ]) {
      const kinds = tokenKinds(lang, code);
      assert.equal(
        kinds.filter(([text, kind]) => text === 'template' && kind === 'tag')
          .length,
        code.split('<template>').length * 2 - 2,
        code
      );
    }
  });

  void t.test(`${lang}: a <template> elsewhere is not a template`, () => {
    for (const code of [
      'const s = "<template>";',
      '// <template>',
      '/* <template> */',
      'const t = `<template>`;',
      'let x = a<template>b;',
      'const y = a < b;',
    ]) {
      assert.ok(
        !tokenKinds(lang, code).some(([, kind]) => kind === 'tag'),
        code
      );
    }
  });

  void t.test(`${lang}: Handlebars inside the body`, () => {
    const kinds = tokenKinds(
      lang,
      '<template>\n' +
        '  <Card @title="x" @count={{this.count}} class="a {{if @on "on"}}" />\n' +
        '  <button {{on "click" this.inc}}>{{{this.html}}}</button>\n' +
        '  {{#each @items as |item i|}}{{item}}{{else}}none{{/each}}\n' +
        '  {{! short }} {{!-- long --}} {{yield (hash a=1)}} &amp;\n' +
        '</template>'
    );
    for (const [text, kind] of [
      ['Card', 'tag'],
      ['@title', 'attribute'],
      ['@count', 'attribute'],
      ['this', 'variable.special'],
      ['count', 'property'],
      ['on', 'function'],
      ['"click"', 'string'],
      ['{{{', 'punctuation.special'],
      ['#each', 'keyword.control'],
      ['@items', 'variable.special'],
      ['as', 'keyword'],
      ['item i', 'variable.parameter'],
      ['else', 'keyword.control'],
      ['/each', 'keyword.control'],
      ['{{! short }}', 'comment'],
      ['{{!-- long --}}', 'comment'],
      ['yield', 'function'],
      ['hash', 'function'],
      ['&amp;', 'string.special'],
    ] as const) {
      assert.ok(
        kinds.some(([t, k]) => t === text && k === kind),
        `${text} as ${kind}: ${JSON.stringify(kinds.filter(([t]) => t === text))}`
      );
    }
  });

  void t.test(`${lang}: the module continues after the body`, () => {
    const kinds = tokenKinds(
      lang,
      'const T = <template>{{x}}</template>;\nconst r = a / b / c;\nfoo(/re/g);'
    );
    assert.ok(
      kinds.some(([text, kind]) => text === '/re/g' && kind === 'string.regex')
    );
    assert.ok(!kinds.some(([text]) => text.startsWith('/ b')));
  });

  void t.test(`${lang}: bodies resume across chunks and live lines`, () => {
    for (const code of [
      'class A extends B {\n  <template>\n    <p class="a\nb">{{x\n y}}</p>\n  </template>\n  get z() { return a / b; }\n}\n',
      'const T = <template>\n  <!-- open\n  still -->\n  <style>\n    .a { color: red; /* x\n    y */ }\n  </style>\n  {{!-- a\n  b --}}\n</template>;\nconst x = 1 / 2;\n',
      // a comment or style body left open stops at `</template>`
      'const T = <template>\n  <!-- never closed\n</template>;\nconst x = 1 / 2;\n',
      'export class C {\n  t = <template>\n  <style>\n  .a { color: red; }\n</template>;\n  n = `a\n${b}`;\n}\n',
      'const a = <template>{{#if x}}\n{{/if}}</template>; const b = <template>\n<b>{{y}}</b>\n</template>;\n',
      'const s = `x\n<template>`;\n/* <template>\n*/\n',
    ]) {
      assertAllModes(lang, code);
      assertAllModes('markdown', `\`\`\`${lang}\n${code}\`\`\`\ntext\n`);
    }
  });
}

void t.test('glimmer-ts: TypeScript syntax around templates', () => {
  const kinds = tokenKinds(
    'glimmer-ts',
    'export default class C extends Component<Sig> {\n  count: number = 0;\n  <template>{{this.count}}</template>\n}'
  );
  assert.ok(kinds.some(([text, kind]) => text === 'Sig' && kind === 'type'));
  assert.ok(
    kinds.some(([text, kind]) => text === 'number' && kind === 'type.builtin')
  );
  assert.ok(
    kinds.some(([text, kind]) => text === 'template' && kind === 'tag')
  );
  // a type assertion is no template
  assert.ok(
    !tokenKinds('glimmer-ts', 'const a = <string>b;').some(
      ([, kind]) => kind === 'tag'
    )
  );
});

void t.test('glimmer: a metadata key never reads the next line', () => {
  for (const lang of ['glimmer-js', 'glimmer-ts'] as const) {
    for (const code of ['template\n{\n', 'template\n"x"\n']) {
      assertLineFedParity(lang, code);
    }
  }
});
