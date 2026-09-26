import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
  wordColor,
} from './_util';

void t.test('csharp: nested query expressions preserve clause keywords', () => {
  for (const projection of [
    'new {x}',
    'new {nested = new {x}}',
    'xs.Select(v => { return v; })',
  ]) {
    const code = `var q = from x in xs\nselect ${projection}\ninto y\nselect y;\nvar select = 1;\n`;
    assertLineFedParity('csharp', code);
    assert.deepEqual(
      tokenKinds('csharp', code).filter(
        ([text]) => text === 'select' || text === 'into'
      ),
      [
        ['select', 'keyword.declaration'],
        ['into', 'keyword.declaration'],
        ['select', 'keyword.declaration'],
        ['select', 'variable'],
      ]
    );
  }
});

// one unique color per token type so equal styles cannot merge neighboring
// spans and hide a classification behind a same-colored token
const distinct = {
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
} as unknown as Theme;

/** The distinct theme's color for a token type name. */
function distinctColor(name: string): string {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  return distinct.style.syntax?.[name] as string;
}

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('csharp', '$hlCsharp');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/**
 * Tokens for `code` from the whole buffer and from a StreamTokenizer fed one
 * line per push - the chunk shape the LiveTokenizer uses - so a test can
 * assert that a construct crossing line boundaries resumes correctly.
 */
function wholeAndLineFed(
  lang: Lang,
  code: string
): [ThemedToken[][], ThemedToken[][]] {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return [whole, streamed];
}

/** The color of the first span whose trimmed text is exactly `word`. */
function exact(html: string, word: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === word)?.color;
}

/** The color of the first span containing `text`. */
function within(html: string, text: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.includes(text))?.color;
}

void t.test('csharp: declarations, control flow, types, and members', () => {
  const html = checkInvariants(
    lexer.hl,
    'using System.Text;\nnamespace Demo.App;\n[Obsolete]\npublic sealed record Box<T>(T Value) where T : notnull\n{\n  private const int MAX = 1;\n  public static async Task<int> RunAsync(string? name) { if (name is null) return MAX; Console.WriteLine(name); return await Task.FromResult(1); }\n}',
    { theme: distinct }
  );
  assert.equal(exact(html, 'using'), distinctColor('keyword.import'));
  assert.equal(exact(html, 'System'), distinctColor('namespace'));
  assert.equal(exact(html, 'namespace'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'Demo'), distinctColor('namespace'));
  assert.equal(exact(html, 'Obsolete'), distinctColor('attribute'));
  assert.equal(exact(html, 'Box'), distinctColor('type'));
  assert.equal(exact(html, 'where'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'MAX'), distinctColor('constant'));
  assert.equal(exact(html, 'RunAsync'), distinctColor('function.definition'));
  assert.equal(exact(html, 'string'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
  assert.equal(exact(html, 'is'), distinctColor('keyword.operator'));
  assert.equal(exact(html, 'WriteLine'), distinctColor('function.method'));
  assert.equal(exact(html, 'Console'), distinctColor('type'));
});

void t.test(
  'csharp: interpolated, verbatim, and raw strings, chars, numbers, and preprocessor lines',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '#region x\nvar a = $"hi {name} {{lit}}"; var b = @"C:\\p ""q""\nsecond"; var c = """\n raw "t"\n """; var d = \'x\'; var n = 1_000UL + 0b11;\n/// doc\n// plain',
      { theme: distinct }
    );
    assert.equal(within(html, '#region'), distinctColor('preproc'));
    assert.equal(within(html, 'hi '), distinctColor('string'));
    assert.equal(exact(html, '{'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'name'), distinctColor('variable'));
    assert.equal(within(html, '{{lit}}'), distinctColor('string'));
    assert.equal(within(html, 'C:\\p'), distinctColor('string'));
    assert.equal(within(html, 'raw "t"'), distinctColor('string'));
    assert.equal(exact(html, '1_000UL'), distinctColor('number'));
    assert.equal(within(html, '/// doc'), distinctColor('comment.doc'));
    assert.equal(within(html, '// plain'), distinctColor('comment'));
  }
);

void t.test('csharp: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '"unterminated',
    "'\\",
    '0x_',
    '\u00e9 \u65e5\u672c\u8a9e',
    '#',
    '@',
    '${',
    '#{',
    '<<',
    '%',
    '$"',
    '@"',
    '"""',
    '$"{',
    '[Attr',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('csharp: split ranges bound every lookahead', () => {
  const src = 'x// tail\nvar s = $"a {b} c"; obj.M(0xff);';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('csharp', '$hlCsharp', split).hl, src);
  }
});

void t.test(
  'csharp: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x66,
      0x6f,
      0x6f,
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

void t.test('csharp: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x51f15e;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?\u00e9';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('csharp: multi-line constructs resume line-fed', () => {
  for (const code of [
    'var s = @"one\ntwo";\nvar t = 1;\n',
    'var r = """\n  raw\n  """;\nint x;\n',
    'var s = $"a {\n  x\n} b";\n',
    'int a; /* open\nstill */\nint b;\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('csharp', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'csharp: using directives, namespaces, and preprocessor lines',
  () => {
    const html = distinctHl(
      'using System;\nusing System.Collections.Generic;\nusing static System.Math;\nusing Alias = System.Text.StringBuilder;\nglobal using G;\nnamespace Demo;\n#nullable enable\n#region R\n#endregion\n#if DEBUG\n#else\n#endif\n#pragma warning disable\n#define X'
    );
    assert.equal(wordColor(html, 'using'), distinctColor('keyword.import'));
    for (const ns of [
      'System',
      'Collections',
      'Generic',
      'Alias',
      'G',
      'Demo',
    ]) {
      assert.equal(wordColor(html, ns), distinctColor('namespace'), ns);
    }
    for (const word of ['static', 'global', 'namespace']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const type of ['Math', 'Text', 'StringBuilder']) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const pre of [
      '#nullable',
      '#region',
      '#endregion',
      '#if',
      '#else',
      '#endif',
      '#pragma',
      '#define',
    ]) {
      assert.equal(wordColor(html, pre), distinctColor('preproc'), pre);
    }
  }
);

void t.test(
  'csharp: type declarations of every kind, members, and modifiers',
  () => {
    const html = distinctHl(
      'public sealed partial class Counter<T> : ICounter where T : struct, new() { private readonly List<T> _items = new(); public static Counter<T> Empty { get; init; } = new(); protected internal event EventHandler? Changed; [Obsolete("use Add")] public async Task<bool> AddAsync(T item, CancellationToken ct = default, params int[] xs) { return true; } public Counter() { } ~Counter() { } public static implicit operator int(Counter<T> c) => 0; public T this[int i] { get => _items[i]; set => _items[i] = value; } }\npublic interface I { void F(); }\npublic struct S { }\npublic record P(int X, int Y);\npublic enum E : byte { A, B }\npublic delegate void D(int x);\nabstract class A { abstract void F(); virtual void G() {} override void H() {} }\nunsafe static extern void U(int* p);\nref struct RS2 {}\nreadonly struct RO {}'
    );
    for (const word of [
      'public',
      'sealed',
      'partial',
      'class',
      'where',
      'struct',
      'private',
      'readonly',
      'static',
      'get',
      'init',
      'protected',
      'internal',
      'event',
      'async',
      'params',
      'implicit',
      'operator',
      'set',
      'interface',
      'record',
      'enum',
      'delegate',
      'abstract',
      'virtual',
      'override',
      'unsafe',
      'extern',
      'ref',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    assert.equal(wordColor(html, 'new'), distinctColor('keyword.operator'));
    for (const type of [
      'Counter',
      'ICounter',
      'T',
      'List',
      'EventHandler',
      'Task',
      'CancellationToken',
      'I',
      'S',
      'P',
      'E',
      'A',
      'RS2',
      'RO',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const type of ['bool', 'int', 'void', 'byte']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const fn of ['AddAsync', 'F', 'D', 'G', 'H', 'U']) {
      assert.equal(
        wordColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    assert.equal(exactColor(html, '"use Add"'), distinctColor('string'));
    for (const word of ['default', 'return']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
    assert.equal(exactColor(html, 'this'), distinctColor('variable.special'));
    for (const op of ['~', '=>', '?', '*']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    for (const v of [
      '_items',
      'item',
      'ct',
      'xs',
      'c',
      'i',
      'value',
      'x',
      'p',
    ]) {
      assert.equal(wordColor(html, v), distinctColor('variable'), v);
    }
  }
);

void t.test(
  'csharp: numeric suffixes, char escapes, interpolated, verbatim, and raw strings',
  () => {
    const html = distinctHl(
      'int x = 0x1F + 0b101 + 1_000 + 1e3f + 2.5d + 3m + 4L + 5u + \'a\' + \'\\n\'; string s = "esc\\t" + $"i {x} {y:N2} {{lit}}" + @"verbatim ""q"" \\n" + """\n  raw\n  """; bool b = true; object o = null; var v = default; dynamic d = 1; nint n = 1; var l = new List<int> { 1 };'
    );
    for (const n of [
      '0x1F',
      '0b101',
      '1_000',
      '1e3f',
      '2.5d',
      '3m',
      '4L',
      '5u',
    ]) {
      assert.equal(exactColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, "'a'"), distinctColor('string'));
    for (const esc of ['\\n', '\\t']) {
      assert.equal(exactColor(html, esc), distinctColor('string.escape'), esc);
    }
    assert.equal(exactColor(html, '$"i'), distinctColor('string'));
    assert.equal(exactColor(html, '{'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, 'N2'), distinctColor('constant'));
    assert.equal(
      exactColor(html, '@"verbatim ""q"" \\n"'),
      distinctColor('string')
    );
    assert.equal(colorOf(html, '  raw'), distinctColor('string'));
    for (const type of ['int', 'string', 'bool', 'object', 'dynamic', 'nint']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
    assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
    assert.equal(exactColor(html, 'default'), distinctColor('keyword.control'));
    assert.equal(wordColor(html, 'var'), distinctColor('keyword.declaration'));
    assert.equal(exactColor(html, 'new'), distinctColor('keyword.operator'));
    assert.equal(exactColor(html, 'List'), distinctColor('type'));
  }
);

void t.test(
  'csharp: statements, patterns, expressions, and contextual keywords',
  () => {
    const html = distinctHl(
      'for (int i = 0; i < n; i++) { if (a && b || !c) break; else continue; } foreach (var x in xs) {} while (x) {} do {} while (false); switch (k) { case 1: goto case 2; case 2: break; default: return; } var r = k switch { 1 => "a", _ => "b" }; try { throw new E(); } catch (E e) when (e.Ok) {} finally {} using (var d = new D()) {} lock (o) {} checked { } unchecked { } fixed (int* p = arr) {} yield return 1; yield break; var o2 = x is int i2 && i2 > 0; var o4 = x as string; typeof(int); sizeof(int); nameof(x); stackalloc int[3]; this.x; base.F(); x ??= y; x ?? y; x?.Y; a => a; ref int r2 = ref x; in x; out x; init; required; file class F {}'
    );
    for (const word of [
      'for',
      'if',
      'break',
      'else',
      'continue',
      'foreach',
      'while',
      'do',
      'switch',
      'case',
      'goto',
      'default',
      'return',
      'try',
      'throw',
      'catch',
      'when',
      'finally',
      'lock',
      'checked',
      'unchecked',
      'yield',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of [
      'var',
      'fixed',
      'ref',
      'in',
      'out',
      'init',
      'required',
      'file',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    assert.equal(wordColor(html, 'using'), distinctColor('keyword.import'));
    for (const word of [
      'new',
      'is',
      'as',
      'typeof',
      'sizeof',
      'nameof',
      'stackalloc',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.operator'),
        word
      );
    }
    for (const op of [
      '&&',
      '||',
      '!',
      '++',
      '=>',
      '??=',
      '??',
      '?.',
      '>',
      '<',
    ]) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    for (const v of ['this', 'base']) {
      assert.equal(exactColor(html, v), distinctColor('variable.special'), v);
    }
    assert.equal(exactColor(html, 'F'), distinctColor('function.method'));
    // `new E()` and `new D()` are constructor calls; the catch clause names the type
    for (const c of ['E', 'D']) {
      assert.equal(wordColor(html, c), distinctColor('function'), c);
    }
    for (const type of ['Ok', 'Y']) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    assert.equal(exactColor(html, 'false'), distinctColor('boolean'));
    for (const type of ['int', 'string']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
  }
);

void t.test('csharp: comment forms including XML doc comments', () => {
  assert.deepEqual(
    tokenKinds(
      'csharp',
      '// line\n/* block\n */\n/// <summary>doc</summary>\n/** block doc */\nvoid F() {} // tail'
    ),
    [
      ['// line', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['/// <summary>doc</summary>', 'comment.doc'],
      ['/** block doc */', 'comment.doc'],
      ['void', 'type.builtin'],
      ['F', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test(
  'csharp: raw strings, verbatim strings, and block comments stream line-fed',
  () => {
    assertLineFedParity(
      'csharp',
      'var s = """\n  a\n  """;\nvar v = @"x\ny";\n/* c\n */\n/// <summary>\n/// d\n/// </summary>\nvoid F() {}\n'
    );
  }
);

void t.test('csharp: an LF or CRLF gap starts a line head', () => {
  // the head of a line is where `#` directives and `[attribute]` lists start
  const code = '#if DEBUG\r\n[Obsolete] int X;\nint y;';
  assertLineFedParity('csharp', code);
  assert.deepEqual(tokenKinds('csharp', code), [
    ['#if DEBUG', 'preproc'],
    ['[', 'punctuation.bracket'],
    ['Obsolete', 'attribute'],
    [']', 'punctuation.bracket'],
    ['int', 'type.builtin'],
    ['X', 'type'],
    [';', 'punctuation.delimiter'],
    ['int', 'type.builtin'],
    ['y', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
});

void t.test(
  'csharp: interpolated literals end their brace search at the quote',
  () => {
    // the brace search once ran to the next brace in the file for every
    // literal; the bounded scan must keep holes, doubled braces, escapes,
    // and raw literals exactly as before
    const code =
      'var a = $"x {y} {{z}} \\"q\\" {w}";\nvar b = $"""say "hi" {name}\n{{raw}} {n}""";\nvar c = 1;';
    assertLineFedParity('csharp', code);
    assert.deepEqual(tokenKinds('csharp', code), [
      ['var', 'keyword.declaration'],
      ['a', 'variable'],
      ['=', 'operator'],
      ['$"x', 'string'],
      ['{', 'punctuation.special'],
      ['y', 'variable'],
      ['}', 'punctuation.special'],
      ['{{z}}', 'string'],
      ['\\"', 'string.escape'],
      ['q', 'string'],
      ['\\"', 'string.escape'],
      ['{', 'punctuation.special'],
      ['w', 'variable'],
      ['}', 'punctuation.special'],
      ['"', 'string'],
      [';', 'punctuation.delimiter'],
      ['var', 'keyword.declaration'],
      ['b', 'variable'],
      ['=', 'operator'],
      ['$"""say "hi"', 'string'],
      ['{', 'punctuation.special'],
      ['name', 'variable'],
      ['}', 'punctuation.special'],
      ['{{raw}}', 'string'],
      ['{', 'punctuation.special'],
      ['n', 'variable'],
      ['}', 'punctuation.special'],
      ['"""', 'string'],
      [';', 'punctuation.delimiter'],
      ['var', 'keyword.declaration'],
      ['c', 'variable'],
      ['=', 'operator'],
      ['1', 'number'],
      [';', 'punctuation.delimiter'],
    ]);
  }
);

void t.test(
  'csharp: contextual keywords are names outside their syntax',
  () => {
    const kinds = (code: string) => {
      assertLineFedParity('csharp', code);
      return tokenKinds('csharp', code);
    };
    // `record` and `file` head declarations only before a name or keyword
    assert.deepEqual(
      kinds('foreach (var record in records) { Save(record.Id); }'),
      [
        ['foreach', 'keyword.control'],
        ['(', 'punctuation.bracket'],
        ['var', 'keyword.declaration'],
        ['record', 'variable'],
        ['in', 'keyword.declaration'],
        ['records', 'variable'],
        [') {', 'punctuation.bracket'],
        ['Save', 'function'],
        ['(', 'punctuation.bracket'],
        ['record', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['Id', 'type'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['}', 'punctuation.bracket'],
      ]
    );
    assert.deepEqual(
      kinds('foreach (var file in files) { var group = file.Group; }'),
      [
        ['foreach', 'keyword.control'],
        ['(', 'punctuation.bracket'],
        ['var', 'keyword.declaration'],
        ['file', 'variable'],
        ['in', 'keyword.declaration'],
        ['files', 'variable'],
        [') {', 'punctuation.bracket'],
        ['var', 'keyword.declaration'],
        ['group', 'variable'],
        ['=', 'operator'],
        ['file', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['Group', 'type'],
        [';', 'punctuation.delimiter'],
        ['}', 'punctuation.bracket'],
      ]
    );
    assert.deepEqual(
      kinds(
        'public record Point(int X);\nrecord struct P(int X);\nfile sealed class Hidden { }'
      ),
      [
        ['public record', 'keyword.declaration'],
        ['Point', 'type'],
        ['(', 'punctuation.bracket'],
        ['int', 'type.builtin'],
        ['X', 'type'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['record struct', 'keyword.declaration'],
        ['P', 'type'],
        ['(', 'punctuation.bracket'],
        ['int', 'type.builtin'],
        ['X', 'type'],
        [')', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['file sealed class', 'keyword.declaration'],
        ['Hidden', 'type'],
        ['{ }', 'punctuation.bracket'],
      ]
    );
    // query clauses are keywords only inside a query opened by `from`
    assert.deepEqual(
      kinds(
        'var q = from x in xs\n    orderby x descending\n    select x;\nvar select = 1;'
      ),
      [
        ['var', 'keyword.declaration'],
        ['q', 'variable'],
        ['=', 'operator'],
        ['from', 'keyword.declaration'],
        ['x', 'variable'],
        ['in', 'keyword.declaration'],
        ['xs', 'variable'],
        ['orderby', 'keyword.declaration'],
        ['x', 'variable'],
        ['descending', 'keyword.declaration'],
        ['select', 'keyword.declaration'],
        ['x', 'variable'],
        [';', 'punctuation.delimiter'],
        ['var', 'keyword.declaration'],
        ['select', 'variable'],
        ['=', 'operator'],
        ['1', 'number'],
        [';', 'punctuation.delimiter'],
      ]
    );
    // accessors are keywords in a member position before a body, `;`, `=>`,
    // or the line end (Allman braces)
    assert.deepEqual(
      kinds(
        'int X { get; private set; }\nint Y\n{\n    get\n    {\n        return y;\n    }\n}\nvar set = new HashSet<int>(); return set;'
      ),
      [
        ['int', 'type.builtin'],
        ['X', 'type'],
        ['{', 'punctuation.bracket'],
        ['get', 'keyword.declaration'],
        [';', 'punctuation.delimiter'],
        ['private set', 'keyword.declaration'],
        [';', 'punctuation.delimiter'],
        ['}', 'punctuation.bracket'],
        ['int', 'type.builtin'],
        ['Y', 'type'],
        ['{', 'punctuation.bracket'],
        ['get', 'keyword.declaration'],
        ['{', 'punctuation.bracket'],
        ['return', 'keyword.control'],
        ['y', 'variable'],
        [';', 'punctuation.delimiter'],
        ['}', 'punctuation.bracket'],
        ['}', 'punctuation.bracket'],
        ['var', 'keyword.declaration'],
        ['set', 'variable'],
        ['=', 'operator'],
        ['new', 'keyword.operator'],
        ['HashSet', 'type'],
        ['<', 'operator'],
        ['int', 'type.builtin'],
        ['>', 'operator'],
        ['()', 'punctuation.bracket'],
        [';', 'punctuation.delimiter'],
        ['return', 'keyword.control'],
        ['set', 'variable'],
        [';', 'punctuation.delimiter'],
      ]
    );
  }
);

void t.test(
  'csharp: spaced ?, ??, <, and > end a pending type; using static',
  () => {
    const code =
      'return IsValid ? Save() : Fail();\nif (Count > GetLimit()) Reset();\nstring Name => First ?? Compute();\nint? Find() { }\nusing static System.Math;\nusing var x = Open();';
    assertLineFedParity('csharp', code);
    assert.deepEqual(tokenKinds('csharp', code), [
      ['return', 'keyword.control'],
      ['IsValid', 'type'],
      ['?', 'operator'],
      ['Save', 'function'],
      ['()', 'punctuation.bracket'],
      [':', 'punctuation.delimiter'],
      ['Fail', 'function'],
      ['()', 'punctuation.bracket'],
      [';', 'punctuation.delimiter'],
      ['if', 'keyword.control'],
      ['(', 'punctuation.bracket'],
      ['Count', 'type'],
      ['>', 'operator'],
      ['GetLimit', 'function'],
      ['())', 'punctuation.bracket'],
      ['Reset', 'function'],
      ['()', 'punctuation.bracket'],
      [';', 'punctuation.delimiter'],
      ['string', 'type.builtin'],
      ['Name', 'type'],
      ['=>', 'operator'],
      ['First', 'type'],
      ['??', 'operator'],
      ['Compute', 'function'],
      ['()', 'punctuation.bracket'],
      [';', 'punctuation.delimiter'],
      ['int', 'type.builtin'],
      ['?', 'operator'],
      ['Find', 'function.definition'],
      ['() { }', 'punctuation.bracket'],
      ['using', 'keyword.import'],
      ['static', 'keyword.declaration'],
      ['System', 'namespace'],
      ['.', 'punctuation.delimiter'],
      ['Math', 'type'],
      [';', 'punctuation.delimiter'],
      ['using', 'keyword.import'],
      ['var', 'keyword.declaration'],
      ['x', 'variable'],
      ['=', 'operator'],
      ['Open', 'function'],
      ['()', 'punctuation.bracket'],
      [';', 'punctuation.delimiter'],
    ]);
  }
);
