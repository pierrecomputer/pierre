import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/core';
import { codeToTokens, init, StreamTokenizer } from '../lib/core';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import {
  assertLineFedParity as assertLineFedParityOf,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme as distinctThemeOf,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
  wordColor as wordColorOf,
} from './_util';

let php: TestLang;
t.before(() => {
  php = loadLang('php', '$hlPhp');
  // the full module drives the line-fed StreamTokenizer parity checks below
  const url = new URL('../src/highlights.wat', import.meta.url);
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
  const stream = new StreamTokenizer({ lang, theme: distinctTheme });
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
    for (const w of ['B', 'C', 'D', 'Suit']) {
      assert.equal(wordColor(html, w), D('type.class'), w);
    }
    assert.equal(wordColor(html, 'App'), D('namespace'));
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
      // its own line followed by a non-identifier byte; only a heredoc
      // interpolates `$y`
      assert.equal(
        colorOf(html, src === heredoc ? 'hello ?> ' : 'hello ?> $y'),
        STRING
      );
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

void t.test(
  'php: the first visible line alone decides snippet or markup',
  () => {
    for (const src of [
      'Hello\n<?php\necho 1;\n',
      '>\n<?= $x ?>\n',
      'Hello world\n\n<?php f(); ?>\n<b>x</b>\n',
      '$x = 1;\n<?php echo 2;\n',
      'class Foo\n{\n}\n',
    ]) {
      assertLineFedParity('php', src);
    }
    const html = checkInvariants(php.hl, 'Hello\n<?php\necho 1;\n');
    assert.notEqual(wordColor(html, 'Hello'), VARIABLE);
    assert.equal(colorOf(html, '<?php'), PREPROC);
    const snippet = checkInvariants(php.hl, 'class Foo\n{\n}\n');
    assert.notEqual(wordColor(snippet, 'class'), wordColor(html, 'Hello'));
  }
);

void t.test('php: a paren on the next line does not make a call', () => {
  const html = checkInvariants(php.hl, 'foo\n(1);');
  assert.equal(wordColor(html, 'foo'), VARIABLE);
  assertLineFedParity('php', 'foo\n(1);\n');
  assertLineFedParity('php', '<?php\n$o->bar\n(1);\n');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(php.hl, src, { theme: distinctThemeOf });

void t.test('php: open tags, imports, and declare', () => {
  const html = distinctHl(
    "<?php\nrequire 'x.php'; include_once 'y.php';\ndeclare(strict_types=1);\n?>"
  );
  assert.equal(exactColor(html, '<?php'), distinctColor('preproc'));
  assert.equal(exactColor(html, '?>'), distinctColor('preproc'));
  for (const word of ['require', 'include_once', 'declare']) {
    assert.equal(wordColorOf(html, word), distinctColor('keyword'), word);
  }
  assert.equal(exactColor(html, "'x.php'"), distinctColor('string'));
  assert.equal(exactColor(html, 'strict_types'), distinctColor('variable'));
});

void t.test(
  'php: class heads, members, interfaces, traits, enums, and closures',
  () => {
    const html = distinctHl(
      "<?php\nabstract class Cart extends Base {\n    public static ?int $count = null;\n    private readonly array $items;\n    public function __construct(private readonly string $owner = 'guest') {}\n    final public static function make(): self { return new static(); }\n}\ninterface I { public function f(): void; }\ntrait T { }\nenum Suit: string { case Hearts = 'H'; }\nfunction helper(int ...$xs): ?array { return null; }\n$fn = fn($x) => $x * 2;\n$c = function() use ($a, &$b) { };"
    );
    for (const word of [
      'abstract',
      'public',
      'static',
      'private',
      'readonly',
      'final',
      'fn',
      'use',
    ]) {
      assert.equal(wordColorOf(html, word), distinctColor('keyword'), word);
    }
    for (const word of [
      'class',
      'extends',
      'function',
      'interface',
      'trait',
      'enum',
    ]) {
      assert.equal(
        wordColorOf(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const type of ['Cart', 'Base', 'I', 'T', 'Suit']) {
      assert.equal(exactColor(html, type), distinctColor('type.class'), type);
    }
    for (const type of ['int', 'array', 'string', 'void']) {
      assert.equal(
        wordColorOf(html, type),
        distinctColor('type.builtin'),
        type
      );
    }
    for (const fn of ['__construct', 'make', 'f', 'helper']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const v of [
      '$count',
      '$items',
      '$owner',
      '$xs',
      '$fn',
      '$x',
      '$c',
      '$a',
      '$b',
    ]) {
      assert.equal(wordColorOf(html, v), distinctColor('variable'), v);
    }
    assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
    assert.equal(exactColor(html, "'guest'"), distinctColor('string'));
    assert.equal(wordColorOf(html, 'case'), distinctColor('keyword.control'));
    assert.equal(wordColorOf(html, 'return'), distinctColor('keyword.control'));
    for (const op of ['?', '...', '=>', '*', '&']) {
      assert.equal(wordColorOf(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('php: numeric literals, heredocs, and nowdocs', () => {
  const html = distinctHl(
    "<?php\n$x = 0x1F + 0b101 + 0o17 + 017 + 1_000 + 1e3 + 2.5;\n$s = <<<EOT\nheredoc $x\nEOT;\n$n = <<<'EOT'\nnowdoc $x\nEOT;"
  );
  for (const n of ['0x1F', '0b101', '0o17', '017', '1_000', '1e3', '2.5']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  assert.equal(colorOf(html, 'heredoc '), distinctColor('string'));
  assert.equal(colorOf(html, 'nowdoc $x'), distinctColor('string'));
});

void t.test(
  'php: control flow, match, exceptions, and language constructs',
  () => {
    const html = distinctHl(
      "<?php\nif ($a && $b || !$c) {} elseif ($g) {} else {} while ($w) { break; continue; } do {} while ($x); for ($i = 0; $i < 3; $i++) {} foreach ($arr as $k => $v) {} switch ($s) { case 1: break; default: } match ($m) { 1, 2 => 'a', default => 'b' }; try { throw new E(); } catch (E $e) {} finally {} return; goto end; echo 'x'; print 'y'; isset($x); unset($x); empty($x); global $g; static $s; clone $o; $x instanceof E; $x ?? $y; $x <=> $y; $x === $y; $x !== $y; $x ** 2; $x .= 'a'; $x ??= 1; (int) $x;"
    );
    for (const word of [
      'if',
      'elseif',
      'else',
      'while',
      'break',
      'continue',
      'do',
      'for',
      'foreach',
      'switch',
      'case',
      'default',
      'match',
      'try',
      'throw',
      'catch',
      'finally',
      'return',
      'goto',
      'echo',
      'print',
      'isset',
      'unset',
      'empty',
    ]) {
      assert.equal(
        wordColorOf(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of [
      'as',
      'new',
      'global',
      'static',
      'clone',
      'instanceof',
    ]) {
      assert.equal(wordColorOf(html, word), distinctColor('keyword'), word);
    }
    for (const op of [
      '&&',
      '||',
      '!',
      '++',
      '=>',
      '??',
      '<=>',
      '===',
      '!==',
      '**',
      '.=',
      '??=',
    ]) {
      assert.equal(wordColorOf(html, op), distinctColor('operator'), op);
    }
    assert.equal(exactColor(html, 'int'), distinctColor('type.builtin'));
  }
);

void t.test('php: members, static access, builtins, and constants', () => {
  const html = distinctHl(
    "<?php\n$obj->prop->sub; $obj->method(); $obj?->m(); Cls::CONST; Cls::method(); static::y; strlen($s); array_map(fn($x) => $x, $a); count($a); true; false; null; TRUE; FALSE; NULL; $_GET['x'];"
  );
  for (const p of ['prop', 'sub', 'y']) {
    assert.equal(exactColor(html, p), distinctColor('property'), p);
  }
  // a class constant, and the class named before `::`
  assert.equal(exactColor(html, 'CONST'), distinctColor('constant'));
  assert.equal(exactColor(html, 'Cls'), distinctColor('type'));
  for (const m of ['method', 'm']) {
    assert.equal(exactColor(html, m), distinctColor('function.method'), m);
  }
  for (const op of ['->', '?->', '::']) {
    assert.equal(exactColor(html, op), distinctColor('operator'), op);
  }
  for (const fn of ['strlen', 'array_map', 'count']) {
    assert.equal(exactColor(html, fn), distinctColor('function'), fn);
  }
  for (const b of ['true', 'false', 'TRUE', 'FALSE']) {
    assert.equal(exactColor(html, b), distinctColor('boolean'), b);
  }
  for (const c of ['null', 'NULL']) {
    assert.equal(exactColor(html, c), distinctColor('constant.builtin'), c);
  }
  assert.equal(exactColor(html, '$_GET'), distinctColor('variable'));
});

void t.test('php: comment forms and short echo tags in markup', () => {
  assert.deepEqual(
    tokenKinds(
      'php',
      '<?php\n// line\n# hash\n/* block\n */\nfunction f() {} // tail\n?>\n<div><?= $x ?></div>'
    ),
    [
      ['<?php', 'preproc'],
      ['// line', 'comment'],
      ['# hash', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['function', 'keyword.declaration'],
      ['f', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
      ['?>', 'preproc'],
      ['<', 'punctuation.bracket.html'],
      ['div', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['<?=', 'preproc'],
      ['$x', 'variable'],
      ['?>', 'preproc'],
      ['</', 'punctuation.bracket.html'],
      ['div', 'tag'],
      ['>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test(
  'php: block comments and alternative syntax stream line-fed',
  () => {
    assertLineFedParityOf(
      'php',
      '<?php\n/* a\n b */\n$s = "x\ny";\n?>\n<?php if ($a): ?>\n<p>x</p>\n<?php endif; ?>\n'
    );
  }
);

void t.test(
  'php: single-quoted strings escape only quote and backslash',
  () => {
    const code =
      "<?php\n$re = '/^\\d+$/';\n$q = 'it\\'s \\\\ ok';\n$m = 'one \\n\ntwo \\'\nend';\n";
    assert.deepEqual(tokenKinds('php', code), [
      ['<?php', 'preproc'],
      ['$re', 'variable'],
      ['=', 'operator'],
      ["'/^\\d+$/'", 'string'],
      [';', 'punctuation.delimiter'],
      ['$q', 'variable'],
      ['=', 'operator'],
      ["'it", 'string'],
      ["\\'", 'string.escape'],
      ['s', 'string'],
      ['\\\\', 'string.escape'],
      ["ok'", 'string'],
      [';', 'punctuation.delimiter'],
      ['$m', 'variable'],
      ['=', 'operator'],
      ["'one \\n", 'string'],
      ['two', 'string'],
      ["\\'", 'string.escape'],
      ["end'", 'string'],
      [';', 'punctuation.delimiter'],
    ]);
    assertLineFedParityOf('php', code);
  }
);

void t.test('php: class names after new and before ::, and constants', () => {
  const code =
    '<?php\n$u = new User($id);\n$v = new \\App\\Post();\n$w = new class {};\necho User::class, self::X, PHP_EOL, Attribute::TARGET_CLASS;\n';
  assert.deepEqual(tokenKinds('php', code), [
    ['<?php', 'preproc'],
    ['$u', 'variable'],
    ['=', 'operator'],
    ['new', 'keyword'],
    ['User', 'type.class'],
    ['(', 'punctuation.bracket'],
    ['$id', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['$v', 'variable'],
    ['=', 'operator'],
    ['new', 'keyword'],
    ['\\', 'operator'],
    ['App', 'namespace'],
    ['\\', 'operator'],
    ['Post', 'type.class'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['$w', 'variable'],
    ['=', 'operator'],
    ['new', 'keyword'],
    ['class', 'keyword.declaration'],
    ['{}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['echo', 'keyword.control'],
    ['User', 'type'],
    ['::', 'operator'],
    ['class', 'property'],
    [',', 'punctuation.delimiter'],
    ['self', 'variable'],
    ['::', 'operator'],
    ['X', 'property'],
    [',', 'punctuation.delimiter'],
    ['PHP_EOL', 'constant'],
    [',', 'punctuation.delimiter'],
    ['Attribute', 'type'],
    ['::', 'operator'],
    ['TARGET_CLASS', 'constant'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParityOf('php', code);
});

void t.test('php: an island inside an open HTML tag or body streams', () => {
  for (const src of [
    '<script>\nx = <?= 1 ?>;\n</script>\n',
    '<a\n href="<?= 1 ?>">\n<b>x</b>\n',
    '<style>\na { /* x <?= 1 ?> */ }\n</style>\n',
  ]) {
    assertLineFedParity('php', src);
  }
});

void t.test('php: alternative syntax closers and word operators', () => {
  const code =
    '<?php if ($a and $b or $c xor $d): ?>\n<p>x</p>\n<?php endif; foreach ($xs as $x): endforeach; ?>\n';
  const kinds = tokenKinds('php', code);
  for (const w of ['and', 'or', 'xor']) {
    assert.ok(
      kinds.some(([t, k]) => t === w && k === 'keyword.operator'),
      w
    );
  }
  for (const w of ['endif', 'endforeach']) {
    assert.ok(
      kinds.some(([t, k]) => t === w && k === 'keyword.control'),
      w
    );
  }
});

void t.test('php: constants, imports, and namespace names', () => {
  const code =
    '<?php\nnamespace App\\Shop;\nuse function App\\fmt;\nclass A {\n    const RATE = 1;\n    public const int MAX = 2;\n}\nconst LIMIT = 3;\n';
  assert.deepEqual(tokenKinds('php', code), [
    ['<?php', 'preproc'],
    ['namespace', 'keyword.declaration'],
    ['App', 'namespace'],
    ['\\', 'operator'],
    ['Shop', 'namespace'],
    [';', 'punctuation.delimiter'],
    ['use', 'keyword'],
    ['function', 'keyword.declaration'],
    ['App', 'namespace'],
    ['\\', 'operator'],
    ['fmt', 'variable'],
    [';', 'punctuation.delimiter'],
    ['class', 'keyword.declaration'],
    ['A', 'type.class'],
    ['{', 'punctuation.bracket'],
    ['const', 'keyword.declaration'],
    ['RATE', 'constant'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['public', 'keyword'],
    ['const', 'keyword.declaration'],
    ['int', 'type.builtin'],
    ['MAX', 'constant'],
    ['=', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['const', 'keyword.declaration'],
    ['LIMIT', 'constant'],
    ['=', 'operator'],
    ['3', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParityOf('php', code);
});

void t.test('php: a shebang line is a comment in every path', () => {
  const code = '#!/usr/bin/env php\n<?php\necho "hi";\n';
  assert.deepEqual(tokenKinds('php', code).slice(0, 2), [
    ['#!/usr/bin/env php', 'comment'],
    ['<?php', 'preproc'],
  ]);
  assertLineFedParityOf('php', code);
  assertLineFedParity('php', code);
});

void t.test('php: double-quoted strings and heredocs interpolate', () => {
  assert.deepEqual(tokenKinds('php', '<?php\n$s = "a {$b->c} $d[0] ${e}";\n'), [
    ['<?php', 'preproc'],
    ['$s', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['{', 'punctuation.special'],
    ['$b', 'variable'],
    ['->', 'operator'],
    ['c', 'property'],
    ['}', 'punctuation.special'],
    ['$d', 'variable'],
    ['[', 'punctuation.bracket'],
    ['0', 'number'],
    [']', 'punctuation.bracket'],
    ['${', 'punctuation.special'],
    ['e', 'variable'],
    ['}', 'punctuation.special'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  // a chunk that starts inside a multi-line string or a heredoc resumes it
  for (const src of [
    '<?php\n$u = "one $x\ntwo {$y->z} three\nend";\necho 1;\n',
    '<?php\n$h = <<<EOT\n  Hi $name, {$o->p}\n  {$open\n  EOT;\necho 1;\n',
    "<?php\n$n = <<<'EOT'\n  $raw {$raw}\n  EOT;\n",
    '<?php\n$t = `ls $dir\n$x`;\n',
  ]) {
    assertLineFedParity('php', src);
  }
  const kinds = tokenKinds('php', "<?php\n$n = <<<'EOT'\n  $raw\n  EOT;\n");
  assert.ok(kinds.some(([t, k]) => t === '$raw' && k === 'string'));
});
