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
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('nix', '$hlNix');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'nix: parameters, attributes, inherit, lists, and applications',
  () => {
    assert.deepEqual(
      tokenKinds(
        'nix',
        '{ config, lib, ... }:\nlet\n  inherit (lib) mkOption;\n  version = "1.2.3";\n  src = ./src;\nin rec {\n  packages = with pkgs; [ hello git ];\n  f = x: if x == null then throw "bad" else x // 1;\n}\n'
      ),
      [
        ['{', 'punctuation.bracket'],
        ['config', 'variable.parameter'],
        [',', 'punctuation.delimiter'],
        ['lib', 'variable.parameter'],
        [',', 'punctuation.delimiter'],
        ['...', 'variable.special'],
        ['}', 'punctuation.bracket'],
        [':', 'operator'],
        ['let', 'keyword'],
        ['inherit', 'keyword'],
        ['(', 'punctuation.bracket'],
        ['lib', 'property'],
        [')', 'punctuation.bracket'],
        ['mkOption', 'property'],
        [';', 'punctuation.delimiter'],
        ['version', 'property'],
        ['=', 'operator'],
        ['"1.2.3"', 'string'],
        [';', 'punctuation.delimiter'],
        ['src', 'property'],
        ['=', 'operator'],
        ['./src', 'string.special'],
        [';', 'punctuation.delimiter'],
        ['in rec', 'keyword'],
        ['{', 'punctuation.bracket'],
        ['packages', 'property'],
        ['=', 'operator'],
        ['with', 'keyword'],
        ['pkgs', 'variable'],
        [';', 'punctuation.delimiter'],
        ['[', 'punctuation.bracket'],
        ['hello git', 'variable'],
        [']', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['f', 'property'],
        ['=', 'operator'],
        ['x', 'variable.parameter'],
        [':', 'operator'],
        ['if', 'keyword.control'],
        ['x', 'variable'],
        ['==', 'operator'],
        ['null', 'constant.builtin'],
        ['then', 'keyword.control'],
        ['throw', 'function'],
        ['"bad"', 'string'],
        ['else', 'keyword.control'],
        ['x', 'variable'],
        ['//', 'operator'],
        ['1', 'number'],
        [';', 'punctuation.delimiter'],
        ['}', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test('nix: strings, splices, escapes, paths, and URIs', () => {
  const html = distinctHl(
    "greeting = \"hello ${config.user.name}!\";\nbanner = ''\n  multi ${version}\n  ''${escaped} and '''q'''\n'';\nurl = https://example.org/x?y=1;\nsearch = <nixpkgs>;\nhome = ~/.config;\nesc = \"a\\nb\\\"c\";\nlist = builtins.map (n: n + 1) [ 1 2 ];\nok = true && !false || (count >= 10);\n/* block\n comment */\nz = 1;\n# line\n"
  );
  assert.equal(exactColor(html, '"hello'), distinctColor('string'));
  assert.equal(exactColor(html, '${'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, 'config'), distinctColor('variable'));
  assert.equal(exactColor(html, 'user'), distinctColor('property'));
  assert.equal(exactColor(html, 'name'), distinctColor('property'));
  assert.equal(exactColor(html, '}'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, "''$"), distinctColor('string.escape'));
  assert.equal(exactColor(html, "'''"), distinctColor('string.escape'));
  assert.equal(exactColor(html, 'version'), distinctColor('variable'));
  assert.equal(
    exactColor(html, 'https://example.org/x?y=1'),
    distinctColor('string')
  );
  assert.equal(exactColor(html, '<nixpkgs>'), distinctColor('string.special'));
  assert.equal(exactColor(html, '~/.config'), distinctColor('string.special'));
  assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '\\"'), distinctColor('string.escape'));
  assert.equal(exactColor(html, 'builtins'), distinctColor('namespace'));
  assert.equal(exactColor(html, 'map'), distinctColor('function'));
  assert.equal(exactColor(html, 'n'), distinctColor('variable.parameter'));
  assert.equal(exactColor(html, '1 2'), distinctColor('number'));
  assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  assert.equal(exactColor(html, '&& !'), distinctColor('operator'));
  assert.equal(exactColor(html, '>='), distinctColor('operator'));
  assert.equal(
    exactColor(html, '/* block\n comment */'),
    distinctColor('comment')
  );
  assert.equal(exactColor(html, '# line'), distinctColor('comment'));
});

void t.test('nix: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '/*',
    '"',
    '"${',
    '"${x',
    "''",
    "''${",
    "'",
    '${',
    '{',
    '}',
    '.',
    '..',
    '...',
    './',
    '/',
    '<',
    '<x',
    'https://',
    'a-',
    '-',
    'é 日本語',
    '{ a, b }:',
    'inherit',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('nix: split ranges bound every lookahead', () => {
  const src =
    "{ a ? 1, ... }: let b = \"x${a}y\"; c = ''p''${q} ''; in [ ./z <n> ] // f a";
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('nix', '$hlNix', split).hl, src);
  }
});

void t.test(
  'nix: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x7b,
      0x20,
      0x61,
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

void t.test('nix: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x5e1f33;
  const alphabet = 'abcXYZ09_ /\\"\'\n\t{}[]().,:;+-*=!<>&|#$@%~?é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('nix: multi-line constructs stream line-fed', () => {
  for (const code of [
    'x = "one ${\n  y\n} two";\nz = 1;\n',
    "z = ''\n  multi ${a}\n  ''${b}\n'';\nw = 1;\n",
    '/* open\nstill */\nw = 1;\n',
    '{\n  a,\n  b ? 2,\n  ...\n}: a\n',
  ]) {
    assertLineFedParity('nix', code);
  }
});
