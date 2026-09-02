import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, TokenizeStream } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
} from './util';

let python: TestLang;

t.before(() => {
  python = loadLang('python', '$hlPython');
});

/**
 * Compile the whole module once for the streaming checks: TokenizeStream and
 * codeToTokens run on the shared highlighter rather than the single-lexer
 * harness. Lazy, so the lexer-only tests still run while another language
 * file is mid-edit.
 */
let fullModuleReady = false;
function initFullModule(): void {
  if (fullModuleReady) return;
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
  fullModuleReady = true;
}

/**
 * Tokens for `code` fed to TokenizeStream one line per push - the shape the
 * live tokenizer uses - which must equal the whole-buffer tokens.
 */
function assertLineStreamParity(code: string, label: string): ThemedToken[][] {
  initFullModule();
  const stream = new TokenizeStream({ lang: 'python', theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/))
    streamed.push(...stream.pushCode(line));
  streamed.push(...stream.end());
  const whole = codeToTokens(code, {
    lang: 'python',
    theme: pierreDark,
  }).tokens;
  assert.deepEqual(streamed, whole, label);
  return streamed;
}

/** The color of the first span whose trimmed text is exactly `text`. */
const wordColor = (html: string, text: string) =>
  spansOf(html).find((s) => s.text.trim() === text)?.color;

const COMMENT = themeColor('comment');
const ATTRIBUTE = themeColor('attribute');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const CONTROL = themeColor('keyword.control');
const DECLARATION = themeColor('keyword.declaration');
const IMPORT = themeColor('keyword.import');
const TYPE = themeColor('type');
const TYPE_BUILTIN = themeColor('type.builtin');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const OPERATOR = themeColor('operator');
const BRACKET = themeColor('punctuation.bracket');

void t.test('python: comments and decorators', () => {
  const src =
    '@cache.memoize\n@pkg.decorator(arg)\ndef work():\n    # implementation note\n    pass';
  const html = checkInvariants(python.hl, src);
  assert.equal(colorOf(html, '@cache.memoize'), ATTRIBUTE);
  assert.equal(colorOf(html, '@pkg.decorator'), ATTRIBUTE);
  assert.equal(colorOf(html, '# implementation note'), COMMENT);
});

void t.test('python: prefixed, triple, raw, byte, and f-strings', () => {
  const src =
    "a = \"line\\n\"\nb = r'raw\\n'\nc = br\"bytes\\x41\"\nd = f\"hello {name!r}\"\ne = '''multi\nline'''";
  const html = checkInvariants(python.hl, src);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`r'raw\n'`), STRING);
  assert.equal(colorOf(html, String.raw`br"bytes\x41"`), STRING);
  assert.equal(colorOf(html, 'f"hello '), STRING);
  assert.equal(colorOf(html, '{'), themeColor('punctuation.special'));
  assert.equal(colorOf(html, "'''multi\nline'''"), STRING);
});

void t.test(
  'python: integers, floats, exponents, bases, and imaginaries',
  () => {
    const src = 'values = (42, 0xff, 0b1010, 1_000, 3.14, .5, 1e-9, 2j)';
    const html = checkInvariants(python.hl, src);
    for (const n of [
      '42',
      '0xff',
      '0b1010',
      '1_000',
      '3.14',
      '.5',
      '1e-9',
      '2j',
    ]) {
      assert.equal(colorOf(html, n), NUMBER, n);
    }
  }
);

void t.test('python: keywords, imports, literals, and builtins', () => {
  const src =
    'from pathlib import Path\nif value is not None and True:\n    return print(len(list(value)))';
  const html = checkInvariants(python.hl, src);
  assert.equal(colorOf(html, 'from'), IMPORT);
  assert.equal(colorOf(html, 'import'), IMPORT);
  assert.equal(colorOf(html, 'if'), CONTROL);
  assert.equal(colorOf(html, 'return'), CONTROL);
  assert.equal(colorOf(html, 'None'), themeColor('constant.builtin'));
  assert.equal(colorOf(html, 'True'), themeColor('boolean'));
  assert.equal(colorOf(html, 'print'), FUNCTION);
  assert.equal(colorOf(html, 'len'), FUNCTION);
  assert.equal(colorOf(html, 'list'), TYPE_BUILTIN);
});

void t.test(
  'python: definitions, classes, calls, members, and type-ish names',
  () => {
    const src =
      'class Widget(Base):\n    LIMIT = 3\n    async def fetch(self, item: str) -> Response:\n        return client.retrieve(item).value';
    const html = checkInvariants(python.hl, src);
    assert.equal(colorOf(html, 'class'), DECLARATION);
    assert.equal(colorOf(html, 'Widget'), themeColor('type.class'));
    assert.equal(colorOf(html, 'Base'), TYPE);
    assert.equal(colorOf(html, 'fetch'), themeColor('function.definition'));
    assert.equal(colorOf(html, 'str'), TYPE_BUILTIN);
    assert.equal(colorOf(html, 'Response'), TYPE);
    assert.equal(colorOf(html, 'client'), VARIABLE);
    assert.equal(colorOf(html, 'retrieve'), themeColor('function.method'));
    assert.equal(colorOf(html, 'value'), themeColor('property'));
    assert.equal(colorOf(html, 'LIMIT'), themeColor('constant'));
  }
);

void t.test('python: operators and punctuation', () => {
  const src = 'if (n := value // 2) >= 1 and n ** 2 != 3:\n    result: int = n';
  const html = checkInvariants(python.hl, src);
  for (const op of [':=', '//', '>=', '**', '!=']) {
    assert.equal(colorOf(html, op), OPERATOR, op);
  }
  assert.equal(colorOf(html, 'and'), themeColor('keyword.operator'));
  assert.equal(colorOf(html, '('), BRACKET);
});

void t.test('python: malformed and UTF-8 input remains lossless', () => {
  for (const src of [
    "'unterminated λ",
    '"trailing escape \\',
    "r'raw trailing \\",
    "f'{未关闭'",
    "'''triple 雪",
    '0x + 1e+',
    '@',
    'café = naïve(🚀)',
  ])
    checkInvariants(python.hl, src);
});

void t.test('python: lookahead is bounded by split ranges', () => {
  for (const [prefix, tail] of [
    ['r', "'raw\\n'"],
    ['fr', '"value {x}"'],
    ["'", "''doc\ntext'''"],
    ['#', ' comment\nx = 1'],
    ['-', '> Result'],
    [':', '= value'],
  ]) {
    const ranged = loadLang('python', '$hlPython', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

void t.test('python: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ rfb\'\\"{}()[]@#.:,+-*/|&=<>\nλ雪';
  let state = 0xc0ffee42;
  for (let sample = 0; sample < 180; sample++) {
    let src = '';
    const n = state >>> 27;
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(python.hl, src);
  }
});

void t.test('python: def parameters match Zed variable.parameter', () => {
  const PARAM = themeColor('variable.parameter');
  const VSPEC = themeColor('variable.special');
  // exact-word colors; substring search would match inside longer names
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    python.hl,
    'def greet(name, greeting="hi", *args, **kwargs):\n    return name\n' +
      'class C:\n' +
      '    def m(self, count: int, data: dict[str, int] = {}) -> None:\n' +
      '        pass\n' +
      'def gen[T](item: T) -> T:\n    return item\n' +
      'f = lambda alpha, beta: alpha\nprint(xs, ys); foo(k=1)'
  );
  for (const name of [
    'name',
    'greeting',
    'args',
    'kwargs',
    'count',
    'data',
    'item',
  ]) {
    assert.equal(word(html, name), PARAM, name);
  }
  // self stays special, and lambdas plus call arguments stay plain, like Zed
  assert.equal(word(html, 'self'), VSPEC);
  for (const name of ['alpha', 'beta', 'xs', 'ys', 'k']) {
    assert.equal(word(html, name), VARIABLE, name);
  }
});

void t.test('python: multi-line docstrings survive line-fed streaming', () => {
  // the resume check once and-ed the 4-valued triple flag with a boolean, so
  // a triple-quoted string open at a chunk end lapsed into code on line 3
  const doc =
    'def f():\n    """Doc line 1\n    line 2\n    line 3\n    """\n    return 1\n';
  const streamed = assertLineStreamParity(doc, 'three-line docstring');
  assert.equal(
    streamed[3].find((tk) => tk.content.trim() === 'line 3')?.color,
    STRING
  );
  assert.equal(
    streamed[5].find((tk) => tk.content.trim() === 'return')?.color,
    CONTROL
  );
  assertLineStreamParity(
    'x = """a\nb\nc\nd\n"""\ny = f"""{\nx\n}"""\nz = 1\n',
    'four-line and f-string bodies'
  );
});

void t.test(
  'python: a backslash before CRLF continues a string like LF',
  () => {
    const html = checkInvariants(
      python.hl,
      's = "abc\\\r\ndef"\nt = r"x\\\r\ny"\n'
    );
    assert.equal(colorOf(html, '\\\r\n'), ESCAPE);
    assert.equal(colorOf(html, 'def"'), STRING);
    assert.equal(colorOf(html, 'y"'), STRING);
    for (const nl of ['\n', '\r\n']) {
      assertLineStreamParity(
        `s = "abc\\${nl}def"${nl}t = r"x\\${nl}y"${nl}z = 1${nl}`,
        JSON.stringify(nl)
      );
    }
  }
);

void t.test(
  'python: colons arm annotations only in annotation position',
  () => {
    const html = checkInvariants(
      python.hl,
      "d = {'a': dval}\nv = a[i:jbound]\nf = lambda larg: lbody + 1\n" +
        'x: mytype = 1\nself.y: attrtype = 2\nif cond:\n    after = 1\n' +
        'm = {\n    key: mval,\n}\n' +
        'def g(pa: ptype, cb=lambda la: lb, pb: qtype = 1) -> rtype:\n' +
        '    pass\nif a and \\\n   contd:\n    contcall()\n'
    );
    // dict values, slice bounds, lambda bodies, and statement bodies stay plain
    for (const name of [
      'dval',
      'jbound',
      'lbody',
      'after',
      'key',
      'mval',
      'lb',
    ])
      assert.equal(wordColor(html, name), VARIABLE, name);
    // variable, attribute, parameter, and return annotations read as types
    for (const name of ['mytype', 'attrtype', 'ptype', 'qtype', 'rtype'])
      assert.equal(wordColor(html, name), TYPE, name);
    assert.equal(wordColor(html, 'contcall'), FUNCTION);
    assertLineStreamParity(
      'if a and \\\n   contd:\n    contcall()\nx = f(lambda x,\n  y: x)\n' +
        'def g() -> \\\n    Foo:\n    pass\n',
      'continuation lines'
    );
  }
);

void t.test('python: match and case are soft keywords', () => {
  // one snippet per shape: equal colors merge across lines in one document
  const word = (src: string, text: string) =>
    wordColor(checkInvariants(python.hl, src), text);
  assert.equal(
    word('m = re.match(p, s)', 'match'),
    themeColor('function.method')
  );
  assert.equal(word('match = 3', 'match'), VARIABLE);
  assert.equal(word('print(match)', 'match'), VARIABLE);
  assert.equal(word('obj.match', 'match'), themeColor('property'));
  // bodies are plain statements: a keyword body such as `pass` would merge
  // with the next `case` span
  const html = checkInvariants(
    python.hl,
    'match point:\n    case Point(x=0):\n        n = 1\n' +
      '    case [first, *rest]:\n        n = 2\n    case _:\n        n = 3'
  );
  assert.equal(wordColor(html, 'match'), CONTROL);
  assert.deepEqual(
    spansOf(html)
      .filter((s) => s.text.trim() === 'case')
      .map((s) => s.color),
    [CONTROL, CONTROL, CONTROL]
  );
  // a member name is never a builtin or keyword
  assert.equal(word('obj.print', 'print'), themeColor('property'));
  assert.equal(word('obj.type', 'type'), themeColor('property'));
  assert.equal(word('obj.if()', 'if'), themeColor('function.method'));
});

void t.test('python: f-string replacement fields track brace depth', () => {
  const SPECIAL = themeColor('punctuation.special');
  const html = checkInvariants(python.hl, 'f"{x!r:>{w}} {{lit}} {y}"');
  assert.deepEqual(
    spansOf(html).map((s) => [s.text, s.color]),
    [
      ['f"', STRING],
      ['{', SPECIAL],
      ['x!r:>', STRING],
      ['{', SPECIAL],
      ['w', STRING],
      ['}}', SPECIAL],
      [' {{lit}} ', STRING],
      ['{', SPECIAL],
      ['y', STRING],
      ['}', SPECIAL],
      ['"', STRING],
    ]
  );
  const streamed = assertLineStreamParity(
    's = f"""{a:{\nw}} {{x}}\n"""\ny = 1\n',
    'field open across lines'
  );
  assert.equal(
    streamed[3].find((tk) => tk.content.trim() === 'y')?.color,
    VARIABLE
  );
});
