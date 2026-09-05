import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
  wordColor,
} from './util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('groovy', '$hlGroovy');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'groovy: packages, classes, methods, GStrings, maps, and DSL calls',
  () => {
    assert.deepEqual(
      tokenKinds(
        'groovy',
        "package demo\nimport groovy.transform.ToString\n@ToString\nclass Circle implements Shape {\n    static final double PI2 = Math.PI * 2\n    def describe(String name = 'circle') {\n        def msg = \"$name has ${name.size()}\"\n        println msg\n        return [name: name, ok: true]\n    }\n}\ndependencies {\n    implementation 'org.example:lib:1.0'\n}\ndef f = { a, b -> a <=> b }\n"
      ),
      [
        ['package', 'keyword.import'],
        ['demo', 'namespace'],
        ['import', 'keyword.import'],
        ['groovy', 'namespace'],
        ['.', 'punctuation.delimiter'],
        ['transform', 'namespace'],
        ['.', 'punctuation.delimiter'],
        ['ToString', 'namespace'],
        ['@ToString', 'attribute'],
        ['class', 'keyword.declaration'],
        ['Circle', 'type'],
        ['implements', 'keyword.declaration'],
        ['Shape', 'type'],
        ['{', 'punctuation.bracket'],
        ['static final', 'keyword.declaration'],
        ['double', 'type.builtin'],
        ['PI2', 'constant'],
        ['=', 'operator'],
        ['Math', 'type'],
        ['.', 'punctuation.delimiter'],
        ['PI', 'type'],
        ['*', 'operator'],
        ['2', 'number'],
        ['def', 'keyword.declaration'],
        ['describe', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['String', 'type'],
        ['name', 'variable'],
        ['=', 'operator'],
        ["'circle'", 'string'],
        [') {', 'punctuation.bracket'],
        ['def', 'keyword.declaration'],
        ['msg', 'variable'],
        ['=', 'operator'],
        ['"', 'string'],
        ['$name', 'variable'],
        ['has', 'string'],
        ['${', 'punctuation.special'],
        ['name', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['size', 'function.method'],
        ['()', 'punctuation.bracket'],
        ['}', 'punctuation.special'],
        ['"', 'string'],
        ['println', 'function'],
        ['msg', 'variable'],
        ['return', 'keyword.control'],
        ['[', 'punctuation.bracket'],
        ['name', 'property'],
        [':', 'operator'],
        ['name', 'variable'],
        [',', 'punctuation.delimiter'],
        ['ok', 'property'],
        [':', 'operator'],
        ['true', 'boolean'],
        [']', 'punctuation.bracket'],
        ['}', 'punctuation.bracket'],
        ['}', 'punctuation.bracket'],
        ['dependencies', 'function'],
        ['{', 'punctuation.bracket'],
        ['implementation', 'function'],
        ["'org.example:lib:1.0'", 'string'],
        ['}', 'punctuation.bracket'],
        ['def', 'keyword.declaration'],
        ['f', 'variable'],
        ['=', 'operator'],
        ['{', 'punctuation.bracket'],
        ['a', 'variable'],
        [',', 'punctuation.delimiter'],
        ['b', 'variable'],
        ['->', 'operator'],
        ['a', 'variable'],
        ['<=>', 'operator'],
        ['b', 'variable'],
        ['}', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test('groovy: comments, literals, operators, and typed methods', () => {
  const html = distinctHl(
    '#!/usr/bin/env groovy\n/** doc */\nint q = 1\n// note\nint w = 2\n/* block */\ndouble area(int n) { return n ** 2 }\ndef t = \'\'\'multi\nline\'\'\'\ndef u = """triple ${x[0].area()}\nquoted"""\nassert xs.size() == 2L && xs[0] instanceof Circle\ndef y = xs*.radius?.sum() ?: 0x10\nswitch (s) {\n    case 2: println "two"; break\n    default: println \'d\'\n}\nfor (s in xs) { it.toUpperCase() }\nList<String> tags = null\n'
  );
  assert.equal(
    exactColor(html, '#!/usr/bin/env groovy'),
    distinctColor('comment')
  );
  assert.equal(exactColor(html, '/** doc */'), distinctColor('comment.doc'));
  assert.equal(exactColor(html, '// note'), distinctColor('comment'));
  assert.equal(exactColor(html, '/* block */'), distinctColor('comment'));
  assert.equal(exactColor(html, 'double'), distinctColor('type.builtin'));
  assert.equal(exactColor(html, 'area'), distinctColor('function.definition'));
  assert.equal(exactColor(html, 'n'), distinctColor('variable'));
  assert.equal(exactColor(html, '**'), distinctColor('operator'));
  assert.equal(exactColor(html, "'''multi\nline'''"), distinctColor('string'));
  assert.equal(exactColor(html, '"""triple'), distinctColor('string'));
  assert.equal(exactColor(html, '${'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, 'x'), distinctColor('variable'));
  assert.equal(exactColor(html, 'area()'), undefined);
  assert.equal(exactColor(html, 'quoted"""'), distinctColor('string'));
  assert.equal(exactColor(html, 'size'), distinctColor('function.method'));
  assert.equal(exactColor(html, '2L'), distinctColor('number'));
  assert.equal(
    exactColor(html, 'instanceof'),
    distinctColor('keyword.operator')
  );
  assert.equal(exactColor(html, 'Circle'), distinctColor('type'));
  assert.equal(exactColor(html, '*.'), distinctColor('operator'));
  assert.equal(exactColor(html, '?.'), distinctColor('operator'));
  assert.equal(exactColor(html, '?:'), distinctColor('operator'));
  assert.equal(exactColor(html, '0x10'), distinctColor('number'));
  assert.equal(exactColor(html, 'switch'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, 'println'), distinctColor('function'));
  assert.equal(wordColor(html, 'break'), distinctColor('keyword.control'));
  assert.equal(wordColor(html, 'default'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, 'in'), distinctColor('keyword.operator'));
  assert.equal(exactColor(html, 'it'), distinctColor('variable.special'));
  assert.equal(
    exactColor(html, 'toUpperCase'),
    distinctColor('function.method')
  );
  assert.equal(exactColor(html, 'List'), distinctColor('type'));
  assert.equal(exactColor(html, 'String'), distinctColor('type'));
  assert.equal(exactColor(html, 'tags'), distinctColor('variable'));
  assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
});

void t.test('groovy: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#!',
    '#',
    '//',
    '/*',
    '/**',
    '"',
    '"$',
    '"${',
    '"${x',
    "'",
    "'''",
    '"""',
    '$',
    '@',
    '@x',
    '.',
    '?.',
    '*.',
    '->',
    '<=>',
    'def',
    'def x(',
    'é 日本語',
    'a:',
    '::',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('groovy: split ranges bound every lookahead', () => {
  const src =
    'def f(String s = "a ${g(1)} $b.c") { s?.size() ?: 0 } // z\nplugins { id \'java\' }';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('groovy', '$hlGroovy', split).hl, src);
  }
});

void t.test(
  'groovy: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x64,
      0x65,
      0x66,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0x20,
      0xff
    );
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('groovy: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x66d1c3;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?^é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('groovy: multi-line constructs stream line-fed', () => {
  for (const code of [
    'def s = """one ${\n  x\n} two"""\ndef y = 1\n',
    "def t = '''a\nb'''\n/* open\nstill */\ndef y = 1\n",
    'def s = "a \\\nb"\ndef z = 2\n',
    "dependencies {\n    implementation 'x'\n}\n",
  ]) {
    assertLineFedParity('groovy', code);
  }
});
