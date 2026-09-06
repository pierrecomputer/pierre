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
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('pascal', '$hlPascal');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'pascal: units, uses, classes, routines, properties, and statements',
  () => {
    assert.deepEqual(
      tokenKinds(
        'pascal',
        'unit Shapes;\nuses SysUtils, System.Classes;\ntype\n  TShape = class(TObject)\n  private\n    FName: string;\n  public\n    constructor Create(const AName: string); overload;\n    property Name: string read FName write FName;\n  end;\nconst MAX = $FF;\nprocedure TShape.Run;\nbegin\n  Result := Pi * Sqr(FRadius);\n  if (i mod 2 = 0) and not Done then Exit;\nend;\n'
      ),
      [
        ['unit', 'keyword.declaration'],
        ['Shapes', 'namespace'],
        [';', 'punctuation.delimiter'],
        ['uses', 'keyword.import'],
        ['SysUtils', 'namespace'],
        [',', 'punctuation.delimiter'],
        ['System', 'namespace'],
        ['.', 'punctuation.delimiter'],
        ['Classes', 'namespace'],
        [';', 'punctuation.delimiter'],
        ['type', 'keyword.declaration'],
        ['TShape', 'type'],
        ['=', 'operator'],
        ['class', 'keyword.declaration'],
        ['(', 'punctuation.bracket'],
        ['TObject', 'type.builtin'],
        [')', 'punctuation.bracket'],
        ['private', 'keyword.declaration'],
        ['FName', 'variable'],
        [':', 'punctuation.delimiter'],
        ['string', 'type.builtin'],
        [';', 'punctuation.delimiter'],
        ['public', 'keyword.declaration'],
        ['constructor', 'keyword.declaration'],
        ['Create', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['const', 'keyword.declaration'],
        ['AName', 'variable.parameter'],
        [':', 'punctuation.delimiter'],
        ['string', 'type.builtin'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['overload', 'keyword.declaration'],
        [';', 'punctuation.delimiter'],
        ['property', 'keyword.declaration'],
        ['Name', 'property'],
        [':', 'punctuation.delimiter'],
        ['string', 'type.builtin'],
        ['read', 'keyword'],
        ['FName', 'variable'],
        ['write', 'keyword'],
        ['FName', 'variable'],
        [';', 'punctuation.delimiter'],
        ['end', 'keyword'],
        [';', 'punctuation.delimiter'],
        ['const', 'keyword.declaration'],
        ['MAX', 'constant'],
        ['=', 'operator'],
        ['$FF', 'number'],
        [';', 'punctuation.delimiter'],
        ['procedure', 'keyword.declaration'],
        ['TShape', 'type'],
        ['.', 'punctuation.delimiter'],
        ['Run', 'function.definition'],
        [';', 'punctuation.delimiter'],
        ['begin', 'keyword'],
        ['Result', 'variable.special'],
        [':=', 'operator'],
        ['Pi', 'variable'],
        ['*', 'operator'],
        ['Sqr', 'function'],
        ['(', 'punctuation.bracket'],
        ['FRadius', 'variable'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['if', 'keyword.control'],
        ['(', 'punctuation.bracket'],
        ['i', 'variable'],
        ['mod', 'keyword.operator'],
        ['2', 'number'],
        ['=', 'operator'],
        ['0', 'number'],
        [')', 'punctuation.bracket'],
        ['and not', 'keyword.operator'],
        ['Done', 'variable'],
        ['then Exit', 'keyword.control'],
        [';', 'punctuation.delimiter'],
        ['end', 'keyword'],
        [';', 'punctuation.delimiter'],
      ]
    );
  }
);

void t.test('pascal: keywords are case-insensitive', () => {
  assert.deepEqual(
    tokenKinds('pascal', 'BEGIN\n  IF X THEN WRITELN(TRUE);\nEND.\n'),
    [
      ['BEGIN', 'keyword'],
      ['IF', 'keyword.control'],
      ['X', 'variable'],
      ['THEN', 'keyword.control'],
      ['WRITELN', 'function'],
      ['(', 'punctuation.bracket'],
      ['TRUE', 'boolean'],
      [')', 'punctuation.bracket'],
      [';', 'punctuation.delimiter'],
      ['END', 'keyword'],
      ['.', 'punctuation.delimiter'],
    ]
  );
});

void t.test(
  'pascal: comments, directives, strings, char codes, and radix numbers',
  () => {
    const html = distinctHl(
      "{$mode objfpc}\nA := 1;\n{ note }\nB := 2;\n(* block\n comment *)\nC := 3;\n// line\nS := 'it''s' + #13#10;\nX := %1010 + &17 + 1.5e2;\nfor i := 0 to 10 do WriteLn(i);\ncase i of 2..5: Self.F := nil; end;\nP := ^TShape;\nread := 1;\n"
    );
    assert.equal(exactColor(html, '{$mode objfpc}'), distinctColor('preproc'));
    assert.equal(exactColor(html, '{ note }'), distinctColor('comment'));
    assert.equal(
      exactColor(html, '(* block\n comment *)'),
      distinctColor('comment')
    );
    assert.equal(exactColor(html, '// line'), distinctColor('comment'));
    assert.equal(exactColor(html, "'it"), distinctColor('string'));
    assert.equal(exactColor(html, "''"), distinctColor('string.escape'));
    assert.equal(exactColor(html, '#13#10'), distinctColor('string.special'));
    assert.equal(exactColor(html, '%1010'), distinctColor('number'));
    assert.equal(exactColor(html, '&17'), distinctColor('number'));
    assert.equal(exactColor(html, '1.5e2'), distinctColor('number'));
    assert.equal(wordColor(html, 'to'), distinctColor('keyword.control'));
    assert.equal(wordColor(html, 'do'), distinctColor('keyword.control'));
    assert.equal(exactColor(html, 'WriteLn'), distinctColor('function'));
    assert.equal(exactColor(html, '..'), distinctColor('operator'));
    assert.equal(exactColor(html, 'Self'), distinctColor('variable.special'));
    assert.equal(exactColor(html, 'F'), distinctColor('property'));
    assert.equal(exactColor(html, 'nil'), distinctColor('constant.builtin'));
    assert.equal(wordColor(html, '^'), distinctColor('operator'));
    assert.equal(exactColor(html, 'TShape'), distinctColor('type'));
    assert.equal(exactColor(html, 'read'), distinctColor('variable'));
  }
);

void t.test('pascal: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '//',
    '{',
    '{$',
    '(*',
    '(*$',
    '(* *',
    "'",
    "'a''",
    '#',
    '#$',
    '#13',
    '$',
    '$F',
    '%',
    '%1',
    '&',
    '&7',
    ':',
    ':=',
    '..',
    '.',
    '^',
    '@',
    'procedure',
    'procedure T.',
    'uses',
    'property',
    'é 日本語',
    'result',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('pascal: split ranges bound every lookahead', () => {
  const src =
    "procedure T.F(const a: Integer; var b: string); { c }\nbegin b := 'x''y' + #10; (* d *) end;";
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('pascal', '$hlPascal', split).hl, src);
  }
});

void t.test(
  'pascal: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x76,
      0x61,
      0x72,
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

void t.test('pascal: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x19c4e3;
  const alphabet = 'abcXYZ09_ /\\"\'\n\t{}[]().,:;+-*=!<>&|#@$%~?^é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('pascal: multi-line constructs stream line-fed', () => {
  for (const code of [
    '{ open\nstill }\nx := 1;\n',
    '(* also\nopen *)\nx := 1;\n',
    '{$IFDEF A\n}\ny := 2;\n',
    'procedure P(\n  a: Integer;\n  b: string);\nbegin\nend;\n',
    'uses\n  A,\n  B.C;\n',
  ]) {
    assertLineFedParity('pascal', code);
  }
});
