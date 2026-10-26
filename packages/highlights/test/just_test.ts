import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('just: settings, assignments, aliases, and modules', () => {
  expect(
    tokenKinds(
      'just',
      'set dotenv-load\nexport HOME_DIR := env_var("HOME")\nalias b := build\nmod? tools'
    )
  ).toEqual([
    ['set', 'keyword'],
    ['dotenv-load', 'property'],
    ['export', 'keyword.declaration'],
    ['HOME_DIR', 'variable'],
    [':=', 'operator'],
    ['env_var', 'function'],
    ['(', 'punctuation.bracket'],
    ['"HOME"', 'string'],
    [')', 'punctuation.bracket'],
    ['alias', 'keyword.declaration'],
    ['b', 'function.definition'],
    [':=', 'operator'],
    ['build', 'function'],
    ['mod', 'keyword.import'],
    ['?', 'operator'],
    ['tools', 'namespace'],
  ]);
  // a keyword before `:=` or `:` is a plain name
  expect(tokenKinds('just', 'set := "x"\nset:')).toEqual([
    ['set', 'variable'],
    [':=', 'operator'],
    ['"x"', 'string'],
    ['set', 'function.definition'],
    [':', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('just', 'x := if a == "b" { \'c\' } else { `d` } # note')
  ).toEqual([
    ['x', 'variable'],
    [':=', 'operator'],
    ['if', 'keyword.control'],
    ['a', 'variable'],
    ['==', 'operator'],
    ['"b"', 'string'],
    ['{', 'punctuation.bracket'],
    ["'c'", 'string'],
    ['}', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['`d`', 'string.special'],
    ['}', 'punctuation.bracket'],
    ['# note', 'comment'],
  ]);
});

test('just: recipe headers, attributes, and dependencies', () => {
  expect(
    tokenKinds(
      'just',
      '[no-cd, group(\'ci\')]\n@test $env +args=x: build (lint "a" b) && deploy'
    )
  ).toEqual([
    ['[', 'punctuation.bracket'],
    ['no-cd', 'attribute'],
    [',', 'punctuation.delimiter'],
    ['group', 'attribute'],
    ['(', 'punctuation.bracket'],
    ["'ci'", 'string'],
    [')]', 'punctuation.bracket'],
    ['@', 'operator'],
    ['test', 'function.definition'],
    ['$', 'operator'],
    ['env', 'variable.parameter'],
    ['+', 'operator'],
    ['args', 'variable.parameter'],
    ['=', 'operator'],
    ['x', 'variable'],
    [':', 'punctuation.delimiter'],
    ['build', 'function'],
    ['(', 'punctuation.bracket'],
    ['lint', 'function'],
    ['"a"', 'string'],
    ['b', 'variable'],
    [')', 'punctuation.bracket'],
    ['&&', 'operator'],
    ['deploy', 'function'],
  ]);
});

test('just: recipe bodies are shell lines with interpolations', () => {
  expect(
    tokenKinds(
      'just',
      'a:\n  @echo "v{{ver}}" {{{{x}} $HOME\n  -rm -f out; ls {{ dir / "x" }}\n# top\n  b'
    )
  ).toEqual([
    ['a', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['@', 'operator'],
    ['echo', 'function'],
    ['"v', 'string'],
    ['{{', 'punctuation.special'],
    ['ver', 'variable'],
    ['}}', 'punctuation.special'],
    ['"', 'string'],
    ['{{{{', 'string.escape'],
    ['x}}', null],
    ['$HOME', 'variable'],
    ['-', 'operator'],
    ['rm', 'function'],
    ['-f out', null],
    [';', 'operator'],
    ['ls', 'function'],
    ['{{', 'punctuation.special'],
    ['dir', 'variable'],
    ['/', 'operator'],
    ['"x"', 'string'],
    ['}}', 'punctuation.special'],
    ['# top', 'comment'],
    // an unindented line ends the recipe
    ['b', 'variable'],
  ]);
  expect(
    tokenKinds('just', 'a:\n  #!/usr/bin/env bash\n  echo "x\\" y')
  ).toEqual([
    ['a', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['#!/usr/bin/env bash', 'comment'],
    ['echo', 'function'],
    ['"x', 'string'],
    ['\\"', 'string.escape'],
    ['y', 'string'],
  ]);
});

test('just: strings and brackets that span lines', () => {
  expect(
    tokenKinds('just', 'x := """\n  a\\n\n"""\ny := (\n  \'b\' +\n  c\n)')
  ).toEqual([
    ['x', 'variable'],
    [':=', 'operator'],
    ['"""', 'string'],
    ['a', 'string'],
    ['\\n', 'string.escape'],
    ['"""', 'string'],
    ['y', 'variable'],
    [':=', 'operator'],
    ['(', 'punctuation.bracket'],
    ["'b'", 'string'],
    ['+', 'operator'],
    ['c', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
  for (const code of [
    "x := '''\none\n'''\nbuild:\n  echo {{ x }}\n",
    'a b="multi\nline": c\n  echo\n',
    'r:\n  echo "{{ a }} b\n  c\n',
    'x := `ls\n-l`\r\ny := 1\r\n',
  ]) {
    assertLineFedParity('just', code);
  }
});
