import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  distinctTheme,
  loadLang,
  makeRand,
  spanKinds,
  type TestLang,
  tokenKinds,
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('nim', '$hlNim');
});

/** Span kinds under the distinct theme after checking the lexer invariants. */
const kinds = (src: string) =>
  spanKinds(checkInvariants(lexer.hl, src, { theme: distinctTheme }));

/** Whether `code` has a token with exactly this text and kind. */
const hasToken = (code: string, text: string, kind: string | null) =>
  tokenKinds('nim', code).some(([s, k]) => s === text && k === kind);

void t.test('nim: imports, routines, parameters, and pragmas', () => {
  assert.deepEqual(
    tokenKinds(
      'nim',
      'import std/[os, strutils]\nfrom math import sqrt\n\nproc area*[T](r: T; scale = 1.0): float {.inline.} =\n  ## Circle area.\n  result = PI * r * r # squared\n'
    ),
    [
      ['import', 'keyword.import'],
      ['std', 'namespace'],
      ['/', 'operator'],
      ['[', 'punctuation.bracket'],
      ['os', 'namespace'],
      [',', 'punctuation.delimiter'],
      ['strutils', 'namespace'],
      [']', 'punctuation.bracket'],
      ['from', 'keyword.import'],
      ['math', 'namespace'],
      ['import', 'keyword.import'],
      ['sqrt', 'namespace'],
      ['proc', 'keyword.declaration'],
      ['area', 'function.definition'],
      ['*', 'punctuation.special'],
      ['[', 'punctuation.bracket'],
      ['T', 'type'],
      ['](', 'punctuation.bracket'],
      ['r', 'variable.parameter'],
      [':', 'punctuation.delimiter'],
      ['T', 'type'],
      [';', 'punctuation.delimiter'],
      ['scale', 'variable.parameter'],
      ['=', 'operator'],
      ['1.0', 'number'],
      [')', 'punctuation.bracket'],
      [':', 'punctuation.delimiter'],
      ['float', 'type.builtin'],
      ['{.', 'punctuation.bracket'],
      ['inline', 'attribute'],
      ['.}', 'punctuation.bracket'],
      ['=', 'operator'],
      ['## Circle area.', 'comment.doc'],
      ['result', 'variable.special'],
      ['=', 'operator'],
      ['PI', 'constant'],
      ['*', 'operator'],
      ['r', 'variable'],
      ['*', 'operator'],
      ['r', 'variable'],
      ['# squared', 'comment'],
    ]
  );
});

void t.test('nim: types, fields, methods, and member access', () => {
  assert.deepEqual(
    tokenKinds(
      'nim',
      'type Shape* = ref object of RootObj\n  name*: string\nmethod draw(s: Shape) {.base.} = echo s.name.len\n'
    ),
    [
      ['type', 'keyword.declaration'],
      ['Shape', 'type'],
      ['*', 'punctuation.special'],
      ['=', 'operator'],
      ['ref object', 'keyword'],
      ['of', 'keyword.operator'],
      ['RootObj', 'type'],
      ['name', 'variable'],
      ['*', 'punctuation.special'],
      [':', 'punctuation.delimiter'],
      ['string', 'type.builtin'],
      ['method', 'keyword.declaration'],
      ['draw', 'function.definition'],
      ['(', 'punctuation.bracket'],
      ['s', 'variable.parameter'],
      [':', 'punctuation.delimiter'],
      ['Shape', 'type'],
      [') {.', 'punctuation.bracket'],
      ['base', 'attribute'],
      ['.}', 'punctuation.bracket'],
      ['=', 'operator'],
      ['echo', 'function'],
      ['s', 'variable'],
      ['.', 'punctuation.delimiter'],
      ['name', 'property'],
      ['.', 'punctuation.delimiter'],
      ['len', 'property'],
    ]
  );
});

void t.test('nim: every keyword in its bucket', () => {
  const buckets: [string, string[]][] = [
    [
      'keyword.declaration',
      [
        'proc',
        'func',
        'method',
        'iterator',
        'converter',
        'macro',
        'template',
        'var',
        'let',
        'const',
        'type',
      ],
    ],
    ['keyword.import', ['import', 'include', 'from', 'export']],
    [
      'keyword.control',
      [
        'if',
        'when',
        'case',
        'elif',
        'else',
        'for',
        'while',
        'continue',
        'break',
        'return',
        'yield',
        'try',
        'except',
        'finally',
        'raise',
      ],
    ],
    [
      'keyword.operator',
      [
        'and',
        'or',
        'xor',
        'not',
        'div',
        'mod',
        'shl',
        'shr',
        'as',
        'of',
        'in',
        'notin',
        'is',
        'isnot',
        'cast',
      ],
    ],
    [
      'keyword',
      ['addr', 'asm', 'bind', 'block', 'concept', 'defer', 'discard'],
    ],
    ['boolean', ['true', 'false', 'on', 'off']],
    ['constant.builtin', ['nil']],
    ['variable.special', ['result']],
    ['type.builtin', ['int', 'uint8', 'float64', 'string', 'seq', 'openArray']],
  ];
  for (const [kind, words] of buckets) {
    for (const word of words) {
      // a fresh line each time: import words would make later names modules
      assert.deepEqual(kinds(`${word}\n`), [[word, kind]], word);
    }
  }
  // the routine keywords prime the next name as a definition
  for (const word of ['proc', 'func', 'iterator', 'template', 'macro']) {
    assert.ok(
      hasToken(`${word} run() = discard`, 'run', 'function.definition')
    );
  }
});

void t.test('nim: string, raw, triple, generalized, and char literals', () => {
  const code =
    'let a = "tab\\t hex\\x41 uni\\u{1F600} dec\\65"\nlet b = r"C:\\new ""q"""\nlet c = """multi "quoted" """\nlet d = sql"select \\x"\nlet e = fmt"""{x}"""\nlet f = \'\\n\'\nlet g = \'z\'\n';
  assertLineFedParity('nim', code);
  for (const [text, kind] of [
    ['"tab', 'string'],
    ['\\t', 'string.escape'],
    ['\\x41', 'string.escape'],
    ['\\u{1F600}', 'string.escape'],
    ['\\65', 'string.escape'],
    ['r"C:\\new ""q"""', 'string'],
    ['"""multi "quoted" """', 'string'],
    ['sql', 'function'],
    ['"select \\x"', 'string'],
    ['fmt', 'function'],
    ['"""{x}"""', 'string'],
    ["'", 'string'],
    ['\\n', 'string.escape'],
    ["'z'", 'string'],
  ] as const) {
    assert.ok(hasToken(code, text, kind), `${text} -> ${kind}`);
  }
  // a quote run closes a triple string on its last three quotes
  assert.ok(hasToken('let s = """a""""\nx\n', '"""a""""', 'string'));
});

void t.test('nim: numbers with bases, separators, and type suffixes', () => {
  const code =
    "echo 42, 1_000, 0xFF'u8, 0b1010, 0o17, 3.14'f32, 2.5e-3, 10i32, 1..10\n";
  for (const n of [
    '42',
    '1_000',
    "0xFF'u8",
    '0b1010',
    '0o17',
    "3.14'f32",
    '2.5e-3',
    '10i32',
  ]) {
    assert.ok(hasToken(code, n, 'number'), n);
  }
  assert.ok(hasToken(code, '..', 'operator'));
});

void t.test('nim: calls, operators, backtick names, and constants', () => {
  const code =
    'proc `+`*(a, b: Vec): Vec = discard\nlet v = newVec(1) +% obj.size(2) @ MAX_LEN\nlet f = proc (x: int): int = x\n';
  for (const [text, kind] of [
    ['`', 'punctuation.special'],
    ['+', 'function.definition'],
    ['a', 'variable.parameter'],
    ['b', 'variable.parameter'],
    ['newVec', 'function'],
    ['+%', 'operator'],
    ['size', 'function.method'],
    ['@', 'operator'],
    ['MAX_LEN', 'constant'],
    ['x', 'variable.parameter'],
  ] as const) {
    assert.ok(hasToken(code, text, kind), `${text} -> ${kind}`);
  }
});

void t.test('nim: line, doc, nested block, and doc block comments', () => {
  assert.deepEqual(kinds('# note\n## doc\n'), [
    ['# note', 'comment'],
    ['## doc', 'comment.doc'],
  ]);
  assert.deepEqual(kinds('#[ a #[ b ]# c ]# x'), [
    ['#[ a #[ b ]# c ]#', 'comment'],
    ['x', 'variable'],
  ]);
  // a doc block takes the `#` after its last `]#`
  assert.ok(hasToken('##[ doc ##[ in ]## out ]## x\n', 'x', 'variable'));
  // a plain block ends at `]#`: the next `#` starts a line comment
  assert.ok(hasToken('#[ a ]## b\nx\n', 'x', 'variable'));
});

void t.test('nim: multi-line constructs stream line-fed', () => {
  for (const code of [
    '#[ a\n  #[ nested\n  ]# still\n]# let x = 1\n',
    '##[ doc\n  more ]## proc f() = discard\n',
    '##[ outer ##[ inner\n ]## tail\n]## echo 1\n',
    'let s = """\nline "q" ""\n"""" & x\nlet t = 2\n',
    'let q = sql"""select\n  *""" & y\n',
    'import a,\n  b, c\nlet d = e\n',
    'import std/[\n  os,\n  strutils]\nlet d = e\n',
    'proc f(a: int,\n       b: string): int {.\n  inline.} =\n  a\n',
    'let y = x.\n  foo(1)\n',
    '"unterminated\nlet z = 1\n',
    "let c = '\\\nx'\n",
    '#[ open to the end\nstill',
  ]) {
    assertLineFedParity('nim', code);
  }
  // an import statement ends with its line unless a comma continues it
  assert.ok(hasToken('import a\nlet d = e\n', 'e', 'variable'));
  assert.ok(hasToken('import a,\n  b\n', 'b', 'namespace'));
});

void t.test('nim: malformed and UTF-8 input remains lossless', () => {
  for (const src of [
    '"unterminated λ',
    'r"raw ""',
    '"""triple 雪',
    "'",
    "''",
    "'\\",
    '#[ open',
    '##[ open',
    '`unclosed',
    '{.',
    '0x + 1e+',
    "1'",
    'café = naïve(🚀)',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('nim: lookahead is bounded by split ranges', () => {
  for (const [prefix, tail] of [
    ['r', '"raw"'],
    ['"', '""doc\ntext"""'],
    ['#', '[ a ]#'],
    ['##', '[ a ]##'],
    ['{', '.inline.}'],
    ['1', "'i32"],
    ["'", "a'"],
    ['`', '+`'],
    ['proc a', '*(x: int)'],
  ]) {
    const ranged = loadLang('nim', '$hlNim', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

void t.test('nim: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ r\'"`\\#[]{}().,:;*+-=<>@$\nλ雪';
  const rand = makeRand(0x5eed1e);
  for (let sample = 0; sample < 200; sample++) {
    let src = '';
    const n = rand() & 31;
    for (let i = 0; i < n; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});
