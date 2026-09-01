import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
} from './util';

let php: TestLang;
t.before(() => (php = loadLang('php', '$hlPhp')));

const PREPROC = themeColor('preproc');
const TAG = themeColor('tag');
const KEYWORD = themeColor('keyword.control');
const DECL = themeColor('keyword.declaration');
const FUNCTION = themeColor('function.definition');
const VARIABLE = themeColor('variable');
const STRING = themeColor('string');
const COMMENT = themeColor('comment');
const PROPERTY = themeColor('property');
const TYPE = themeColor('type.builtin');
const PLAIN_KEYWORD = themeColor('keyword');

void t.test('php: mixed HTML and PHP regions', () => {
  const src = '<div><?php echo "hi"; ?></div><?= $name ?>';
  const html = checkInvariants(php.hl, src);
  assert.equal(colorOf(html, 'div'), TAG);
  assert.equal(colorOf(html, '<?php'), PREPROC);
  assert.equal(colorOf(html, 'echo'), KEYWORD);
  assert.equal(colorOf(html, '"hi"'), STRING);
  assert.equal(colorOf(html, '$name'), VARIABLE);

  const plain = checkInvariants(php.hl, '<main>plain HTML</main>');
  assert.equal(colorOf(plain, 'main'), TAG);
});

void t.test(
  'php: declarations, members, comments, and tagless snippets',
  () => {
    const src = 'function greet($name) { // hi\n return $this->value; }';
    const html = checkInvariants(php.hl, src);
    assert.equal(colorOf(html, 'function'), DECL);
    assert.equal(colorOf(html, 'greet'), FUNCTION);
    assert.equal(colorOf(html, '$name'), VARIABLE);
    assert.equal(colorOf(html, '// hi'), COMMENT);
    assert.equal(colorOf(html, 'return'), KEYWORD);
    assert.equal(colorOf(html, 'value'), PROPERTY);
  }
);

void t.test(
  'php: close tags terminate line comments and declarations do not leak',
  () => {
    const mixed = checkInvariants(php.hl, '<?php // tail ?> <b>x</b>');
    assert.equal(colorOf(mixed, '// tail '), COMMENT);
    assert.equal(colorOf(mixed, '?>'), PREPROC);
    assert.equal(colorOf(mixed, 'b'), TAG);

    const code = checkInvariants(
      php.hl,
      'function () use ($x) {}; function f(bool $x) { return .5; }'
    );
    assert.equal(colorOf(code, 'use'), PLAIN_KEYWORD);
    assert.equal(colorOf(code, 'bool'), TYPE);
    assert.equal(colorOf(code, '.5'), themeColor('number'));

    const invalidOpen = checkInvariants(php.hl, '<?phpfoo();');
    assert.notEqual(colorOf(invalidOpen, '<?php'), PREPROC);
  }
);

void t.test('php: malformed constructs remain lossless', () => {
  for (const src of [
    '',
    '<?php',
    "<?php 'unterminated",
    '<b><?php /*',
    '<?=',
    '?>',
    '$',
    'é_日本語',
  ]) {
    checkInvariants(php.hl, src);
  }
});

void t.test('php: named call arguments match Zed variable.parameter', () => {
  const PARAM = themeColor('variable.parameter');
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    php.hl,
    '<?php\n' +
      'setUser(name: $n, role: "admin", active: true);\n' +
      'function f($a, $b) { return $a ? $b : $a; }\n' +
      'switch ($x) { case FOO: break; }\n' +
      'Foo::bar($x); $o->method($y);'
  );
  for (const name of ['name', 'role', 'active']) {
    assert.equal(word(html, name), PARAM, name);
  }
  // declaration parameters are $variables, and other colons stay untouched
  assert.notEqual(word(html, 'FOO'), PARAM);
  assert.notEqual(word(html, 'f'), PARAM);
});
