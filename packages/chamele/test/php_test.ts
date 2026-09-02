import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, TokenizeStream } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
} from './util';

let php: TestLang;
t.before(() => {
  php = loadLang('php', '$hlPhp');
  // the full module drives the line-fed TokenizeStream parity checks below
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

// every token type gets its own color, so a parity check also catches kinds
// that pierre-dark paints alike (keyword vs keyword.control, tag vs type)
const distinctTheme: Theme = {
  name: 'distinct',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: Object.fromEntries(
      tokenTypes
        .filter((name) => !['background', 'foreground', 'none'].includes(name))
        .map((name, i) => [name, '#' + (0x100000 + i * 0x101).toString(16)])
    ),
  },
};

/**
 * Assert that feeding `code` one line per `pushCode` - the LiveTokenizer
 * shape, where every line break is a chunk boundary - yields exactly the
 * tokens of one whole-buffer run.
 */
function assertLineFedParity(lang: Lang, code: string): void {
  const whole = codeToTokens(code, { lang, theme: distinctTheme }).tokens;
  const stream = new TokenizeStream({ lang, theme: distinctTheme });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  assert.deepEqual(streamed, whole, `${lang}: ${JSON.stringify(code)}`);
}

/** The color of the span whose trimmed text is exactly `text`. */
function wordColor(html: string, text: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === text)?.color;
}

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

void t.test(
  'php: keywords before `(` are not calls, modifiers are keywords',
  () => {
    // the distinct theme keeps every bucket apart; pierre-dark paints keyword,
    // keyword.control, and keyword.declaration alike
    const D = (name: string) => themeColor(name, distinctTheme);
    const html = checkInvariants(
      php.hl,
      '<?php\n' +
        'foreach ($a as $b) { switch ($x) { default: break; } }\n' +
        'public static function f(): void {}\n' +
        'namespace App; class B extends C implements D {}\n' +
        'enum Suit {} $x instanceof E;\n' +
        'require "a"; Require_Once "b"; include "c"; include_once "d";\n' +
        'abstract final readonly yield;\n' +
        'isset($a); empty($b); unset($c); print 1; requires(); includes;\n',
      { theme: distinctTheme }
    );
    // the word's own span, or the same-styled run it merged into
    const word = (text: string) => wordColor(html, text) ?? colorOf(html, text);
    for (const w of [
      'foreach',
      'switch',
      'isset',
      'empty',
      'unset',
      'default',
      'print',
    ]) {
      assert.equal(word(w), D('keyword.control'), w);
    }
    for (const w of [
      'public',
      'static',
      'instanceof',
      'require',
      'Require_Once',
      'include',
      'include_once',
      'abstract',
      'final',
      'readonly',
      'yield',
    ]) {
      assert.equal(word(w), D('keyword'), w);
    }
    for (const w of ['namespace', 'enum', 'extends', 'implements']) {
      assert.equal(word(w), D('keyword.declaration'), w);
    }
    // a declaration keyword primes the name that follows it
    for (const w of ['App', 'B', 'C', 'D', 'Suit']) {
      assert.equal(wordColor(html, w), D('type.class'), w);
    }
    assert.equal(wordColor(html, 'void'), D('type.builtin'));
    assert.equal(wordColor(html, 'f'), D('function.definition'));
    // near misses stay identifiers
    assert.equal(wordColor(html, 'requires'), D('function'));
    assert.equal(wordColor(html, 'includes'), D('variable'));
  }
);

void t.test(
  'php: heredoc and nowdoc bodies resume across line-fed chunks',
  () => {
    const heredoc = '<?php\n$x = <<<EOT\nhello ?> $y\nEOT;\necho $x;\n';
    const nowdoc = heredoc.replace('<<<EOT', "<<<'EOT'");
    for (const src of [heredoc, nowdoc]) {
      const html = checkInvariants(php.hl, src);
      // `?>` inside the body is literal text, and the label only closes on
      // its own line followed by a non-identifier byte
      assert.equal(colorOf(html, 'hello ?> $y'), STRING);
      assert.equal(colorOf(html, 'echo'), KEYWORD);
      assertLineFedParity('php', src);
    }
    assertLineFedParity(
      'php',
      '<?php\n$x = <<<"EOT"\n  a\n  EOT;\n$y = <<<EOT\r\nb\r\nEOT\r\n'
    );
    assertLineFedParity(
      'php',
      '<?php\n$x = <<<EOT\nEOTX\n EOT )\necho 2;\n?>\n<i>y</i>\n<?= $z ?>\n'
    );
    // an unterminated body runs to the end in both shapes
    assertLineFedParity('php', '<?php\n$x = <<<EOT\nstill\nopen\n');
    assertLineFedParity('php', '<?php\n$x = <<<EOT');
    // a label longer than the 32-byte checkpoint still lexes whole-buffer
    const label = 'A'.repeat(40);
    const long = checkInvariants(
      php.hl,
      `<?php\n$s = <<<${label}\nbody\n${label};\n`
    );
    assert.equal(colorOf(long, 'body'), STRING);
  }
);

void t.test('php: markup stays markup across line-fed chunks', () => {
  // html after `?>`, and blank or text lines before `<?php`
  for (const src of [
    '<?php\necho 1;\n?>\n<b>x</b>\n',
    '\n<?php\necho 1;\n',
    '\n<b>x</b>\n',
    '\n\nfoo();\n',
    '<div\n class="x">text\n<?php f(); ?>\n',
    '<p>x</p>\n<?php\nfunction f() { return 1; }\n?>\n\n<i>y</i>\n',
    'echo 1; ?> <b>x</b>\nfoo\n',
  ]) {
    assertLineFedParity('php', src);
  }
  // the snippet-versus-markup decision looks past leading line breaks
  const html = checkInvariants(php.hl, '\n<b>x</b>\n');
  assert.equal(colorOf(html, 'b'), TAG);
  // a snippet's `?>` is a close tag and markup follows it
  const snippet = checkInvariants(php.hl, 'echo 1; ?> <b>x</b>');
  assert.equal(colorOf(snippet, '?>'), PREPROC);
  assert.equal(colorOf(snippet, 'b'), TAG);
});

void t.test('php: a paren on the next line does not make a call', () => {
  const html = checkInvariants(php.hl, 'foo\n(1);');
  assert.equal(wordColor(html, 'foo'), VARIABLE);
  assertLineFedParity('php', 'foo\n(1);\n');
  assertLineFedParity('php', '<?php\n$o->bar\n(1);\n');
});
