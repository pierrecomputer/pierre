import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  type TestLang,
  themeColor,
  tokenKinds,
} from './_util';

let vue: TestLang;
t.before(() => (vue = loadLang('vue', '$hlVue')));

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(vue.hl, src, { theme: distinctTheme });

const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const KEYWORD = themeColor('keyword');
const PROPERTY = themeColor('property');

void t.test('vue: template directives and interpolation expressions', () => {
  const src =
    '<template><button v-if="ok" :class="{ active: ok }" @click="save()">{{ message }}</button></template>';
  const out = checkInvariants(vue.hl, src);
  assert.equal(colorOf(out, 'button'), TAG);
  assert.equal(colorOf(out, 'v-if'), ATTR);
  assert.equal(colorOf(out, 'ok'), VARIABLE);
  assert.equal(colorOf(out, 'save'), FUNCTION);
  assert.equal(colorOf(out, 'message'), VARIABLE);
});

void t.test('vue: script setup and scoped style use embedded lexers', () => {
  const out = checkInvariants(
    vue.hl,
    '<script setup>const ok = true</script><style scoped>.x { color: red }</style>'
  );
  assert.equal(colorOf(out, 'setup'), ATTR);
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, 'scoped'), ATTR);
  assert.equal(colorOf(out, 'color'), PROPERTY);
});

void t.test(
  'vue: every directive form is an attribute with an expression value',
  () => {
    const html = hl(
      '<div v-if="a" v-else-if="b" v-else v-for="(x, i) in xs" :key="i" v-model="m" @click.prevent="go($event)" #default="{ item }" v-bind="obj" v-slot:name></div>'
    );
    for (const attr of [
      'v-if',
      'v-else-if',
      'v-else v-for',
      ':key',
      'v-model',
      '@click.prevent',
      '#default',
      'v-bind',
      'v-slot:name',
    ]) {
      assert.equal(exactColor(html, attr), distinctColor('attribute'), attr);
    }
    for (const name of [
      'a',
      'b',
      'x',
      'i',
      'xs',
      'm',
      'obj',
      'item',
      '$event',
    ]) {
      assert.equal(exactColor(html, name), distinctColor('variable'), name);
    }
    assert.equal(exactColor(html, 'in'), distinctColor('keyword'));
    assert.equal(exactColor(html, 'go'), distinctColor('function'));
    assert.equal(exactColor(html, '"'), distinctColor('string'));
  }
);

void t.test(
  'vue: interpolation delimiters inside strings do not end the interpolation',
  () => {
    assert.deepEqual(
      tokenKinds(
        'vue',
        '<template>{{ a < b }} {{ "}}" }} {{ f({ a: 1 }) }}</template>'
      ).slice(3, -3),
      [
        ['{{', 'punctuation.special'],
        ['a', 'variable'],
        ['<', 'operator'],
        ['b', 'variable'],
        ['}}', 'punctuation.special'],
        ['{{', 'punctuation.special'],
        ['"}}"', 'string'],
        ['}}', 'punctuation.special'],
        ['{{', 'punctuation.special'],
        ['f', 'function'],
        ['({', 'punctuation.bracket'],
        ['a', 'property'],
        [':', 'punctuation.delimiter'],
        ['1', 'number'],
        ['})', 'punctuation.bracket'],
        ['}}', 'punctuation.special'],
      ]
    );
  }
);

void t.test(
  'vue: script blocks keep their JavaScript, plain and setup alike',
  () => {
    const html = hl(
      '<script setup lang="ts">\nconst x = 1\n</script>\n<script>\nexport default { name: \'x\' }\n</script>'
    );
    assert.equal(exactColor(html, 'setup lang'), distinctColor('attribute'));
    assert.equal(exactColor(html, '"ts"'), distinctColor('string'));
    assert.equal(
      exactColor(html, 'const'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exactColor(html, 'export'), distinctColor('keyword.import'));
    assert.equal(exactColor(html, 'default'), distinctColor('keyword.control'));
    assert.equal(exactColor(html, 'name'), distinctColor('property'));
    assert.equal(exactColor(html, "'x'"), distinctColor('string'));
  }
);

void t.test(
  'vue: style blocks with scoped, lang, and module attributes',
  () => {
    const html = hl(
      '<style scoped>.a { color: red }</style>\n<style lang="scss">.b { top: 1px }</style>\n<style module>.d{}</style>'
    );
    for (const attr of ['scoped', 'lang', 'module']) {
      assert.equal(exactColor(html, attr), distinctColor('attribute'), attr);
    }
    assert.equal(exactColor(html, '"scss"'), distinctColor('string'));
    for (const sel of ['.a', '.b', '.d']) {
      assert.equal(exactColor(html, sel), distinctColor('selector.class'), sel);
    }
    assert.equal(exactColor(html, 'color'), distinctColor('property'));
    assert.equal(exactColor(html, 'red'), distinctColor('constant.builtin'));
    assert.equal(exactColor(html, '1px'), distinctColor('number'));
  }
);

void t.test('vue: comments and custom blocks are opaque', () => {
  assert.deepEqual(
    tokenKinds('vue', '<!-- {{ not }} -->\n<i18n>{ "en": {} }</i18n>'),
    [
      ['<!-- {{ not }} -->', 'comment'],
      ['<', 'punctuation.bracket.html'],
      ['i18n', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['{ "en": {} }', null],
      ['</', 'punctuation.bracket.html'],
      ['i18n', 'tag'],
      ['>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test('vue: unquoted attribute values and kebab-case components', () => {
  assert.deepEqual(
    tokenKinds(
      'vue',
      '<template><Comp :a=1 b=c d /><comp-b></comp-b></template>'
    ),
    [
      ['<', 'punctuation.bracket.html'],
      ['template', 'tag'],
      ['><', 'punctuation.bracket.html'],
      ['Comp', 'tag'],
      [':a', 'attribute'],
      ['=', 'punctuation.delimiter.html'],
      ['1', 'number'],
      ['b', 'attribute'],
      ['=', 'punctuation.delimiter.html'],
      ['c', 'string'],
      ['d', 'attribute'],
      ['/><', 'punctuation.bracket.html'],
      ['comp-b', 'tag'],
      ['></', 'punctuation.bracket.html'],
      ['comp-b', 'tag'],
      ['></', 'punctuation.bracket.html'],
      ['template', 'tag'],
      ['>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test(
  'vue: interpolations, start tags, and blocks spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'vue',
      '<template>\n  <div\n    :a="1"\n    @b="c"\n  >{{\n    multi\n  }}</div>\n</template>\n'
    );
    assertLineFedParity(
      'vue',
      '<script setup>\nconst s = `a\nb`\n</script>\n<style scoped>\n.a {\n  color: red;\n}\n</style>\n'
    );
  }
);

void t.test('vue: malformed and split ranges remain bounded', () => {
  for (const src of [
    '{{',
    '{{ "}"',
    '{{ a',
    '}}',
    '<div v-if=',
    '<div v-if="open',
    '<script>{',
    '<style>.x{',
    '<template>{{',
    '<!--',
  ]) {
    checkInvariants(vue.hl, src);
  }
  const split = loadLang('vue', '$hlVue', 17);
  checkInvariants(split.hl, '<template><p v-if="ok">{{ msg }}</p></template>');
});
