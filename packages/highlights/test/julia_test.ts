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
  lexer = loadLang('julia', '$hlJulia');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'julia: modules, imports, types, definitions, macros, and symbols',
  () => {
    assert.deepEqual(
      tokenKinds(
        'julia',
        'module Stats\nusing LinearAlgebra: norm\nconst MAX_ITER = 1_000\nstruct Point{T<:Real} <: Shape\n    x::T\nend\nfunction mean(xs::Vector{Float64}; skip=false)::Float64\n    isempty(xs) && return NaN\nend\nsq(x) = x^2\n@assert length(v) == 3 "bad"\npush!(v, 0x1F + 2im)\nsym = :foo\nend\n'
      ),
      [
        ['module', 'keyword.declaration'],
        ['Stats', 'namespace'],
        ['using', 'keyword.import'],
        ['LinearAlgebra', 'namespace'],
        [':', 'operator'],
        ['norm', 'namespace'],
        ['const', 'keyword.declaration'],
        ['MAX_ITER', 'constant'],
        ['=', 'operator'],
        ['1_000', 'number'],
        ['struct', 'keyword.declaration'],
        ['Point', 'type'],
        ['{', 'punctuation.bracket'],
        ['T', 'type'],
        ['<:', 'operator'],
        ['Real', 'type'],
        ['}', 'punctuation.bracket'],
        ['<:', 'operator'],
        ['Shape', 'type'],
        ['x', 'variable'],
        ['::', 'operator'],
        ['T', 'type'],
        ['end', 'keyword.control'],
        ['function', 'keyword.declaration'],
        ['mean', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['xs', 'variable'],
        ['::', 'operator'],
        ['Vector', 'type'],
        ['{', 'punctuation.bracket'],
        ['Float64', 'type'],
        ['}', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['skip', 'variable'],
        ['=', 'operator'],
        ['false', 'boolean'],
        [')', 'punctuation.bracket'],
        ['::', 'operator'],
        ['Float64', 'type'],
        ['isempty', 'function'],
        ['(', 'punctuation.bracket'],
        ['xs', 'variable'],
        [')', 'punctuation.bracket'],
        ['&&', 'operator'],
        ['return', 'keyword.control'],
        ['NaN', 'constant.builtin'],
        ['end', 'keyword.control'],
        ['sq', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['x', 'variable'],
        [')', 'punctuation.bracket'],
        ['=', 'operator'],
        ['x', 'variable'],
        ['^', 'operator'],
        ['2', 'number'],
        ['@assert length', 'function'],
        ['(', 'punctuation.bracket'],
        ['v', 'variable'],
        [')', 'punctuation.bracket'],
        ['==', 'operator'],
        ['3', 'number'],
        ['"bad"', 'string'],
        ['push!', 'function'],
        ['(', 'punctuation.bracket'],
        ['v', 'variable'],
        [',', 'punctuation.delimiter'],
        ['0x1F', 'number'],
        ['+', 'operator'],
        ['2im', 'number'],
        [')', 'punctuation.bracket'],
        ['sym', 'variable'],
        ['=', 'operator'],
        [':foo', 'string.special.symbol'],
        ['end', 'keyword.control'],
      ]
    );
  }
);

void t.test(
  'julia: strings, interpolation, prefixes, chars, adjoints, and comments',
  () => {
    const html = distinctHl(
      's = "a $x $(f(1)) \\n"\nre = r"\\d+"\nw = raw"a\\b"\nc = \'x\'\nd = \'\\n\'\nA = [1 2]\'\nB = A\' * A\nprintln(`ls $(homedir())`)\n#= block\n comment =#\nfor i in 1:10 # tail\nend\nfunction Base.show(io::IO, p)\nend\n'
    );
    assert.equal(exactColor(html, '"a'), distinctColor('string'));
    assert.equal(exactColor(html, '$x'), distinctColor('variable'));
    assert.equal(exactColor(html, '$('), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, 'f'), distinctColor('function'));
    assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
    assert.equal(exactColor(html, 'r'), distinctColor('function'));
    assert.equal(exactColor(html, '+"'), distinctColor('string.regex'));
    assert.equal(exactColor(html, '\\d'), distinctColor('string.escape'));
    assert.equal(exactColor(html, 'raw'), distinctColor('function'));
    assert.equal(exactColor(html, '"a\\b"'), undefined);
    assert.equal(exactColor(html, "'x'"), distinctColor('string'));
    assert.equal(exactColor(html, "'\\n'"), distinctColor('string'));
    assert.equal(exactColor(html, "'"), distinctColor('operator'));
    assert.equal(exactColor(html, "' *"), distinctColor('operator'));
    assert.equal(exactColor(html, '`ls'), distinctColor('string.special'));
    assert.equal(exactColor(html, 'homedir'), distinctColor('function'));
    assert.equal(
      exactColor(html, '#= block\n comment =#'),
      distinctColor('comment')
    );
    assert.equal(exactColor(html, 'in'), distinctColor('keyword.operator'));
    assert.equal(exactColor(html, ':'), distinctColor('operator'));
    assert.equal(exactColor(html, '# tail'), distinctColor('comment'));
    assert.equal(exactColor(html, 'Base'), distinctColor('namespace'));
    assert.equal(
      exactColor(html, 'show'),
      distinctColor('function.definition')
    );
    assert.equal(exactColor(html, 'IO'), distinctColor('type'));
  }
);

void t.test('julia: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '#=',
    '#= =',
    '"',
    '"""',
    '"$(',
    '"$(x',
    '"$',
    '`',
    '`$(',
    "'",
    "'x",
    "'\\",
    'r"',
    ':',
    '::',
    ':a',
    '@',
    '@x',
    '$',
    '!',
    'x!',
    'x!=',
    '...',
    '.+',
    'é 日本語',
    'function',
    'f(',
    'f() =',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('julia: split ranges bound every lookahead', () => {
  const src =
    'f(x::T) = "v $(g(x)) $y" * r"a" # c\n@m A\' :s 1:2 #= b =# push!(v, 1e3)';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('julia', '$hlJulia', split).hl, src);
  }
});

void t.test(
  'julia: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x78,
      0x20,
      0x3d,
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

void t.test('julia: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x44e2a9;
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

void t.test('julia: multi-line constructs stream line-fed', () => {
  for (const code of [
    's = """one $(\n  x\n) two"""\ny = 1\n',
    '#= open\nstill =#\ny = "a\nb"\n',
    'function f(\n    a,\n    b)\n  a + b\nend\n',
    'c = `ls $(\n  x\n)`\n',
  ]) {
    assertLineFedParity('julia', code);
  }
});
