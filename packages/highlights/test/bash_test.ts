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

let bash: TestLang;

t.before(() => {
  bash = loadLang('bash', '$hlBash');
});

const COMMENT = themeColor('comment');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const KEYWORD = themeColor('keyword.control');
const DECLARATION = themeColor('keyword.declaration');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const FUNCTION_DEF = themeColor('function.definition');
const OPERATOR = themeColor('operator');
const BRACKET = themeColor('punctuation.bracket');

void t.test('bash: shebangs and lexical comments', () => {
  const src = '#!/usr/bin/env bash\necho foo#bar # trailing note';
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, '#!/usr/bin/env bash'), COMMENT);
  assert.equal(colorOf(html, '# trailing note'), COMMENT);
  assert.notEqual(colorOf(html, '#bar'), COMMENT);
});

void t.test('bash: strings, ANSI-C strings, and escapes', () => {
  const src = "printf '%s' \"line\\n$name\" $'tab\\t' `cmd`";
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, "'%s'"), STRING);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`\t`), ESCAPE);
  assert.equal(colorOf(html, '$name'), VARIABLE);
  assert.equal(colorOf(html, '`cmd`'), themeColor('string.special'));
});

void t.test('bash: variables and substitutions', () => {
  const src = 'echo $plain ${HOME:-/tmp} $(date) $((count + 1))';
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, '$plain'), VARIABLE);
  assert.equal(colorOf(html, 'HOME:-/tmp'), VARIABLE);
  assert.equal(colorOf(html, '$('), themeColor('punctuation.special'));
  assert.equal(colorOf(html, 'count'), VARIABLE);
});

void t.test(
  'bash: control words, declarations, commands, and functions',
  () => {
    const src =
      'function greet { local name=world; if true; then printf \'%s\' "$name"; fi; }\ngoodbye() { return 0; }';
    const html = checkInvariants(bash.hl, src);
    assert.equal(colorOf(html, 'function'), DECLARATION);
    assert.equal(colorOf(html, 'greet'), FUNCTION_DEF);
    assert.equal(colorOf(html, 'goodbye'), FUNCTION_DEF);
    assert.equal(colorOf(html, 'local'), DECLARATION);
    assert.equal(colorOf(html, 'if'), KEYWORD);
    assert.equal(colorOf(html, 'then'), KEYWORD);
    assert.equal(colorOf(html, 'printf'), FUNCTION);
  }
);

void t.test('bash: numbers, operators, and brackets', () => {
  const src = 'if [[ $n -ge 0 && $n != 42 ]]; then n=$((n+1)); fi';
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, '42'), NUMBER);
  assert.equal(colorOf(html, '&&'), OPERATOR);
  assert.equal(colorOf(html, '!='), OPERATOR);
  assert.equal(colorOf(html, '[['), BRACKET);
  assert.equal(colorOf(html, ']]'), BRACKET);
});

void t.test('bash: simple here-documents are bounded strings', () => {
  const src = "cat <<'EOF'\npayload $name\nEOF\necho done";
  const html = checkInvariants(bash.hl, src);
  assert.equal(colorOf(html, "'EOF'"), STRING);
  assert.equal(colorOf(html, 'payload $name'), STRING);
  assert.equal(colorOf(html, 'EOF\n'), STRING);
  assert.equal(colorOf(html, 'echo'), FUNCTION);
});

void t.test('bash: malformed and UTF-8 input stays lossless', () => {
  for (const src of [
    "'unterminated λ",
    '"unterminated $变量 \\',
    '"\\本',
    '${missing',
    '$(unterminated',
    'cat <<EOF\n雪 $x',
    '$',
    '<<<word',
    'echo café 🚀',
  ])
    checkInvariants(bash.hl, src);
});

void t.test('bash: lookahead never crosses split ranges', () => {
  for (const [prefix, tail] of [
    ['#', '!/bin/bash\necho ok'],
    ['$', '{name}'],
    ['<', '<EOF\nbody\nEOF\n'],
    ['"a\\', 'n" tail'],
    ['[', '[ x ]]'],
  ]) {
    const ranged = loadLang('bash', '$hlBash', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

void t.test('bash: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ $\'\\"`{}()[]<>|&;#-=\nλ';
  let state = 0x51a7f00d;
  for (let sample = 0; sample < 160; sample++) {
    let src = '';
    const n = state >>> 27;
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(bash.hl, src);
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(bash.hl, src, { theme: distinctTheme });

void t.test('bash: quoting rules token by token', () => {
  assert.deepEqual(
    tokenKinds(
      'bash',
      "echo 'no $esc \\n' \"yes $var ${v} $(c) \\\" \\$ \\n\" $'ansi\\t' x"
    ),
    [
      ['echo', 'function'],
      ["'no $esc \\n' \"yes", 'string'],
      ['$var', 'variable'],
      ['${', 'punctuation.special'],
      ['v', 'variable'],
      ['}', 'punctuation.special'],
      ['$(', 'punctuation.special'],
      ['c', 'string.special'],
      [')', 'punctuation.special'],
      ['\\"', 'string.escape'],
      ['\\$', 'string.escape'],
      ['\\n', 'string.escape'],
      ['" $\'ansi', 'string'],
      ['\\t', 'string.escape'],
      ["'", 'string'],
      ['x', 'variable'],
    ]
  );
});

void t.test('bash: every here-document and here-string form', () => {
  const src =
    'cat <<EOF\n$expanded\nEOF\ncat <<-EOF\n\tx\n\tEOF\ncat <<\'EOF\'\n$literal\nEOF\ncat <<"EOF"\n$q\nEOF\ncat <<EOF | grep x\ny\nEOF\ncat <<< "here $string"\necho ok';
  assert.deepEqual(tokenKinds('bash', src), [
    ['cat', 'function'],
    ['<<', 'operator'],
    ['EOF', 'string'],
    ['$expanded', 'string'],
    ['EOF', 'string'],
    ['cat', 'function'],
    ['<<-', 'operator'],
    ['EOF', 'string'],
    ['x', 'string'],
    ['EOF', 'string'],
    ['cat', 'function'],
    ['<<', 'operator'],
    ["'EOF'", 'string'],
    ['$literal', 'string'],
    ['EOF', 'string'],
    ['cat', 'function'],
    ['<<', 'operator'],
    ['"EOF"', 'string'],
    ['$q', 'string'],
    ['EOF', 'string'],
    ['cat', 'function'],
    ['<<', 'operator'],
    ['EOF', 'string'],
    ['|', 'operator'],
    ['grep', 'function'],
    ['x', 'variable'],
    ['y', 'string'],
    ['EOF', 'string'],
    ['cat', 'function'],
    ['<<<', 'operator'],
    ['"here', 'string'],
    ['$string', 'variable'],
    ['"', 'string'],
    ['echo', 'function'],
    ['ok', 'variable'],
  ]);
  assertLineFedParity('bash', src + '\n');
});

void t.test('bash: tests, arithmetic, and parameter expansions', () => {
  const html = hl('x=$((1 + 2)); [[ $a == b && -f "$f" ]]; [ "$a" -eq 1 ]');
  for (const bracket of ['[[', ']]', '[', ']']) {
    assert.equal(
      exactColor(html, bracket),
      distinctColor('punctuation.bracket'),
      bracket
    );
  }
  assert.equal(exactColor(html, '=='), distinctColor('operator'));
  assert.equal(exactColor(html, '&&'), distinctColor('operator'));
  assert.equal(exactColor(html, '$(('), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '$a'), distinctColor('variable'));
  assert.equal(exactColor(html, '$f'), distinctColor('variable'));
  const kinds = tokenKinds(
    'bash',
    'echo ${arr[@]} ${#arr} ${x//a/b} ${x:-d} ${x^^} ${!ref} $# $? $$ $! $0 $1 $@ $*'
  );
  for (const body of ['arr[@]', '#arr', 'x//a/b', 'x:-d', 'x^^', '!ref']) {
    assert.ok(
      kinds.some(([text, kind]) => text === body && kind === 'variable'),
      body
    );
  }
  assert.deepEqual(kinds.at(-1), ['$# $? $$ $! $0 $1 $@ $*', 'variable']);
});

void t.test('bash: function definitions in all three forms', () => {
  assert.deepEqual(
    tokenKinds('bash', 'f() { :; }\nfunction g { :; }\nfunction h() { :; }'),
    [
      ['f', 'function.definition'],
      ['() {', 'punctuation.bracket'],
      [':', null],
      [';', 'operator'],
      ['}', 'punctuation.bracket'],
      ['function', 'keyword.declaration'],
      ['g', 'function.definition'],
      ['{', 'punctuation.bracket'],
      [':', null],
      [';', 'operator'],
      ['}', 'punctuation.bracket'],
      ['function', 'keyword.declaration'],
      ['h', 'function.definition'],
      ['() {', 'punctuation.bracket'],
      [':', null],
      [';', 'operator'],
      ['}', 'punctuation.bracket'],
    ]
  );
});

void t.test(
  'bash: control words, declarations, and the commands after them',
  () => {
    const html = hl(
      'if true; then :; elif false; then :; else :; fi; for x in a b; do :; break; done; while :; do :; continue; done; until :; do :; done; case $x in a) ;; esac; select y in a; do :; done; time ls; coproc x\nexport A=1\nlocal b=2\ndeclare c\nreadonly d'
    );
    for (const word of [
      'if',
      'then',
      'elif',
      'else',
      'fi',
      'for',
      'in',
      'do',
      'break',
      'done',
      'while',
      'continue',
      'until',
      'case',
      'esac',
      'select',
    ]) {
      assert.equal(
        exactColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of ['export', 'local', 'declare', 'readonly']) {
      assert.equal(
        exactColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const word of ['time', 'coproc']) {
      assert.equal(exactColor(html, word), distinctColor('keyword'), word);
    }
    for (const command of ['true', 'false']) {
      assert.equal(
        exactColor(html, command),
        distinctColor('function'),
        command
      );
    }
  }
);

void t.test('bash: pipes, lists, redirections, and descriptors', () => {
  assert.deepEqual(
    tokenKinds(
      'bash',
      'ls | grep x || echo n && echo y; ls > out 2>&1 >> app < input; sleep 1 &'
    ),
    [
      ['ls', 'function'],
      ['|', 'operator'],
      ['grep', 'function'],
      ['x', 'variable'],
      ['||', 'operator'],
      ['echo', 'function'],
      ['n', 'variable'],
      ['&&', 'operator'],
      ['echo', 'function'],
      ['y', 'variable'],
      [';', 'operator'],
      ['ls', 'function'],
      ['>', 'operator'],
      ['out', 'variable'],
      ['2', 'number'],
      ['>&', 'operator'],
      ['1', 'number'],
      ['>>', 'operator'],
      ['app', 'variable'],
      ['<', 'operator'],
      ['input', 'variable'],
      [';', 'operator'],
      ['sleep', 'function'],
      ['1', 'number'],
      ['&', 'operator'],
    ]
  );
});

void t.test('bash: assignments and numeric literals', () => {
  assert.deepEqual(
    tokenKinds('bash', 'export FOO=1 BAR="$FOO"\nn=42\nm=0x1F\nf=1.5'),
    [
      ['export', 'keyword.declaration'],
      ['FOO', 'variable'],
      ['=', 'operator'],
      ['1', 'number'],
      ['BAR', 'variable'],
      ['=', 'operator'],
      ['"', 'string'],
      ['$FOO', 'variable'],
      ['"', 'string'],
      ['n', 'variable'],
      ['=', 'operator'],
      ['42', 'number'],
      ['m', 'variable'],
      ['=', 'operator'],
      ['0x1F', 'number'],
      ['f', 'variable'],
      ['=', 'operator'],
      ['1.5', 'number'],
    ]
  );
});

void t.test(
  'bash: case arms, subshells, groups, and multi-line strings stream line-fed',
  () => {
    assertLineFedParity(
      'bash',
      'case "$x" in\n  -h|--help) usage ;;\n  *.txt) echo t ;;\n  *) ;;\nesac\n(cd /tmp && ls)\n{ echo a; echo b; } > f\nx="multi\nline $y"\ny=$(cat <<EOF\nbody\nEOF\n)\n'
    );
  }
);
