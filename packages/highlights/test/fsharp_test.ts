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
} from './util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('fsharp', '$hlFsharp');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'fsharp: modules, unions, bindings, matches, members, and pipelines',
  () => {
    assert.deepEqual(
      tokenKinds(
        'fsharp',
        'module Demo.Shapes\nopen System\ntype Shape =\n    | Circle of radius: float\nlet area (s: Shape) : float =\n    match s with\n    | Circle r when r > 0.0 -> Math.PI * r * r\n    | _ -> 0.0\nlet mutable count = 0\nlet rec fact n = if n <= 1 then 1 else n * fact (n - 1)\ntype Counter() =\n    member this.Count = count\n    member _.Bump(n: int) = count <- count + n\nlet names = [ "a"; "b" ] |> List.map (fun s -> s.ToUpper())\n'
      ),
      [
        ['module', 'keyword.declaration'],
        ['Demo', 'namespace'],
        ['.', 'punctuation.delimiter'],
        ['Shapes', 'namespace'],
        ['open', 'keyword.declaration'],
        ['System', 'namespace'],
        ['type', 'keyword.declaration'],
        ['Shape', 'type'],
        ['=', 'operator'],
        ['|', 'operator'],
        ['Circle', 'constructor'],
        ['of', 'keyword.declaration'],
        ['radius', 'type'],
        [':', 'operator'],
        ['float', 'type.builtin'],
        ['let', 'keyword.declaration'],
        ['area', 'function.definition'],
        ['(', 'punctuation.bracket'],
        ['s', 'variable'],
        [':', 'operator'],
        ['Shape', 'type'],
        [')', 'punctuation.bracket'],
        [':', 'operator'],
        ['float', 'type.builtin'],
        ['=', 'operator'],
        ['match', 'keyword.control'],
        ['s', 'variable'],
        ['with', 'keyword.control'],
        ['|', 'operator'],
        ['Circle', 'constructor'],
        ['r', 'variable'],
        ['when', 'keyword.control'],
        ['r', 'variable'],
        ['>', 'operator'],
        ['0.0', 'number'],
        ['->', 'operator'],
        ['Math', 'namespace'],
        ['.', 'punctuation.delimiter'],
        ['PI', 'property'],
        ['*', 'operator'],
        ['r', 'variable'],
        ['*', 'operator'],
        ['r', 'variable'],
        ['|', 'operator'],
        ['_', 'variable'],
        ['->', 'operator'],
        ['0.0', 'number'],
        ['let mutable', 'keyword.declaration'],
        ['count', 'variable'],
        ['=', 'operator'],
        ['0', 'number'],
        ['let rec', 'keyword.declaration'],
        ['fact', 'function.definition'],
        ['n', 'variable'],
        ['=', 'operator'],
        ['if', 'keyword.control'],
        ['n', 'variable'],
        ['<=', 'operator'],
        ['1', 'number'],
        ['then', 'keyword.control'],
        ['1', 'number'],
        ['else', 'keyword.control'],
        ['n', 'variable'],
        ['*', 'operator'],
        ['fact', 'function'],
        ['(', 'punctuation.bracket'],
        ['n', 'variable'],
        ['-', 'operator'],
        ['1', 'number'],
        [')', 'punctuation.bracket'],
        ['type', 'keyword.declaration'],
        ['Counter', 'type'],
        ['()', 'punctuation.bracket'],
        ['=', 'operator'],
        ['member', 'keyword.declaration'],
        ['this', 'variable.special'],
        ['.', 'punctuation.delimiter'],
        ['Count', 'property'],
        ['=', 'operator'],
        ['count', 'variable'],
        ['member', 'keyword.declaration'],
        ['_', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['Bump', 'function.method'],
        ['(', 'punctuation.bracket'],
        ['n', 'variable'],
        [':', 'operator'],
        ['int', 'type.builtin'],
        [')', 'punctuation.bracket'],
        ['=', 'operator'],
        ['count', 'variable'],
        ['<-', 'operator'],
        ['count', 'variable'],
        ['+', 'operator'],
        ['n', 'variable'],
        ['let', 'keyword.declaration'],
        ['names', 'variable'],
        ['=', 'operator'],
        ['[', 'punctuation.bracket'],
        ['"a"', 'string'],
        [';', 'punctuation.delimiter'],
        ['"b"', 'string'],
        [']', 'punctuation.bracket'],
        ['|>', 'operator'],
        ['List', 'namespace'],
        ['.', 'punctuation.delimiter'],
        ['map', 'function.method'],
        ['(', 'punctuation.bracket'],
        ['fun', 'keyword.control'],
        ['s', 'variable'],
        ['->', 'operator'],
        ['s', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['ToUpper', 'function.method'],
        ['())', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test(
  'fsharp: string forms, attributes, type parameters, and directives',
  () => {
    const html = distinctHl(
      '/// doc\n(* nested (* comment *) *)\nlet msg = $"total {count} of {{x}}"\nlet raw = @"C:\\path\\""q"""\nlet tri = """multi\nline"""\nlet c = \'x\'\nlet g: \'T list = []\n[<Struct>]\ntype P = { X: int }\n#if DEBUG\nlet d = 0x1F + 1_000L\n#endif\nlet v = Some 42\nprintfn "%s" msg\n'
    );
    assert.equal(exactColor(html, '/// doc'), distinctColor('comment.doc'));
    assert.equal(
      exactColor(html, '(* nested (* comment *) *)'),
      distinctColor('comment')
    );
    assert.equal(exactColor(html, '$"total'), distinctColor('string'));
    assert.equal(exactColor(html, '{'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, 'count'), distinctColor('variable'));
    assert.equal(exactColor(html, '}'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, '{{'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '}}'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '@"C:\\path\\'), distinctColor('string'));
    assert.equal(exactColor(html, '""'), distinctColor('string.escape'));
    assert.equal(
      exactColor(html, '"""multi\nline"""'),
      distinctColor('string')
    );
    assert.equal(exactColor(html, "'x'"), distinctColor('string'));
    assert.equal(exactColor(html, "'T"), distinctColor('type'));
    assert.equal(exactColor(html, 'list'), distinctColor('type.builtin'));
    assert.equal(exactColor(html, '[<'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, 'Struct'), distinctColor('attribute'));
    assert.equal(exactColor(html, '>]'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, '#if'), distinctColor('preproc'));
    assert.equal(exactColor(html, '#endif'), distinctColor('preproc'));
    assert.equal(exactColor(html, '0x1F'), distinctColor('number'));
    assert.equal(exactColor(html, '1_000L'), distinctColor('number'));
    assert.equal(exactColor(html, 'Some'), distinctColor('constructor'));
    assert.equal(exactColor(html, 'printfn'), distinctColor('function'));
  }
);

void t.test('fsharp: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '//',
    '///',
    '(*',
    '(*)',
    '(* (*',
    '"',
    '"""',
    '@"',
    '$"',
    '$"{',
    '$"{x',
    '$@"',
    "'",
    "'a",
    "'\\",
    '[<',
    '>]',
    '#',
    '#if',
    'let',
    'let rec',
    'type',
    'member',
    'member x.',
    'é 日本語',
    '|>',
    '::',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('fsharp: split ranges bound every lookahead', () => {
  const src =
    'let f (x: int) = $"v {g x} {{q}}" + @"a""b" (* c *) // d\n[<A>] type T = Some 1 |> h';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('fsharp', '$hlFsharp', split).hl, src);
  }
});

void t.test(
  'fsharp: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x6c,
      0x65,
      0x74,
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

void t.test('fsharp: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x3f8b15;
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

void t.test('fsharp: multi-line constructs stream line-fed', () => {
  for (const code of [
    'let s = """one\ntwo"""\nlet y = 1\n',
    'let t = $"a {\n  x\n} b"\nlet y = 1\n',
    '(* open\nstill *)\nlet y = 1\n',
    'let raw = @"a\nb"\nlet z = 2\n',
    'let f x =\n    match x with\n    | Some v -> v\n    | None -> 0\n',
  ]) {
    assertLineFedParity('fsharp', code);
  }
});
