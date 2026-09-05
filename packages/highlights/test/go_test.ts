import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  themeColor,
  tokenKinds,
  wordColor,
} from './util';

let go: TestLang;
t.before(() => {
  go = loadLang('go', '$hlGo');
  const url = new URL('../src/highlights.wat', import.meta.url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, transformWat(url).code)));
});

/**
 * Tokens from the full module for a whole-buffer run and for a stream fed
 * one line per chunk, the shape the live tokenizer uses; both must agree.
 */
function lineFed(code: string): {
  direct: ThemedToken[][];
  streamed: ThemedToken[][];
} {
  const options = { lang: 'go' as const, theme: pierreDark };
  const direct = codeToTokens(code, options).tokens;
  const stream = new StreamTokenizer(options);
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return { direct, streamed };
}

void t.test('go: declarations, control flow, types, and builtins', () => {
  const src = `package demo
import "fmt"
type Box struct { Value int }
func main() { var ok bool = true; if ok { defer fmt.Println(nil) } }`;
  const html = checkInvariants(go.hl, src);
  assert.equal(colorOf(html, 'package'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'demo'), themeColor('namespace'));
  assert.equal(colorOf(html, 'import'), themeColor('keyword.import'));
  assert.equal(colorOf(html, 'int'), themeColor('type.builtin'));
  assert.equal(colorOf(html, 'if'), themeColor('keyword.control'));
  assert.equal(colorOf(html, 'true'), themeColor('boolean'));
  assert.equal(colorOf(html, 'nil'), themeColor('constant.builtin'));
  assert.equal(colorOf(html, 'main'), themeColor('function.definition'));
});

void t.test('go: comments and documentation buckets', () => {
  const src = '// plain\n/// docs\n//! inner\n/* block */\n/** docs */';
  const theme = {
    name: 'go-comments',
    appearance: 'dark',
    style: {
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const html = checkInvariants(go.hl, src, { theme });
  assert.equal(colorOf(html, '// plain'), '#111111');
  assert.equal(colorOf(html, '/// docs'), '#222222');
  assert.equal(colorOf(html, '//! inner'), '#222222');
  assert.equal(colorOf(html, '/** docs */'), '#222222');
});

void t.test('go: strings, raw strings, runes, escapes, and numbers', () => {
  const src =
    String.raw`"a\n\x41" + ` +
    '`raw\\n`' +
    String.raw` + '\u263a' + 0xff + 0b101 + 1.2e-3i`;
  const html = checkInvariants(go.hl, src);
  assert.equal(colorOf(html, String.raw`\n`), themeColor('string.escape'));
  assert.equal(colorOf(html, '`raw\\n`'), themeColor('string'));
  for (const n of ['0xff', '0b101', '1.2e-3i'])
    assert.equal(colorOf(html, n), themeColor('number'));
});

void t.test(
  'go: functions, members, constants, operators, and punctuation',
  () => {
    const src =
      'func add(x int) int { obj.Field += obj.Method(x); return MAX_VALUE << 1 }';
    const html = checkInvariants(go.hl, src);
    assert.equal(colorOf(html, 'add'), themeColor('function.definition'));
    assert.equal(colorOf(html, 'Field'), themeColor('property'));
    assert.equal(colorOf(html, 'Method'), themeColor('function.method'));
    assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
    assert.equal(colorOf(html, '+='), themeColor('operator'));
    assert.equal(colorOf(html, '('), themeColor('punctuation.bracket'));
  }
);

void t.test('go: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '"unterminated',
    "'\\",
    '`raw',
    '0x_',
    'é 日本語',
  ]) {
    checkInvariants(go.hl, src);
  }
});

void t.test('go: split ranges bound every lookahead', () => {
  const src = 'x// tail\n`raw text` + "a\\n" + obj.Method(0xff)';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('go', '$hlGo', split).hl, src);
  }
});

void t.test('go: malformed UTF-8 stays balanced and decodes losslessly', () => {
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
  const html = go.hl(bytes);
  assert.equal(textOf(html), new TextDecoder().decode(bytes));
  spansOf(html);
});

void t.test('go: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x51f15e;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(go.hl, src);
  }
});

void t.test(
  'go: only the name after a receiver is the method definition',
  () => {
    const theme = {
      name: 'go-names',
      appearance: 'dark',
      style: {
        syntax: {
          'function.definition': { color: '#110001' },
          function: { color: '#220002' },
          variable: { color: '#330003' },
          type: { color: '#440004' },
          'type.builtin': { color: '#550005' },
        },
      },
    };
    // equal styles merge across gaps, so key on the first word of a span
    const exact = (html: string, text: string) =>
      spansOf(html).find((span) => span.text.trim().split(/\s+/)[0] === text)
        ?.color;
    const html = checkInvariants(
      go.hl,
      `func (s *Server) Start(ctx context.Context) error {
	defer func() { recover() }()
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {})
	x := func(a int) MyType { return a }
	return nil
}
func Map[T any](xs []T) []T { return xs }
func plain() {}`,
      { theme }
    );
    assert.equal(exact(html, 's'), '#330003');
    assert.equal(exact(html, 'Server'), '#440004');
    assert.equal(exact(html, 'Start'), '#110001');
    assert.equal(exact(html, 'recover'), '#220002');
    assert.equal(exact(html, 'w'), '#330003');
    assert.equal(exact(html, 'MyType'), '#440004');
    assert.equal(exact(html, 'Map'), '#110001');
    assert.equal(exact(html, 'any'), '#550005');
    assert.equal(exact(html, 'T'), '#440004');
    assert.equal(exact(html, 'plain'), '#110001');
    // a function type's closing paren ends the statement at the line break,
    // so a call on the next line is not a definition
    for (const src of [
      'var h func(x int)\nfoo()',
      'var f func(a int) int\nfoo()',
      'type H func(int) error\nfoo()',
      'cb := func(a int) (T, error) { return a, nil }\nfoo()',
    ]) {
      assert.equal(
        exact(checkInvariants(go.hl, src, { theme }), 'foo'),
        '#220002',
        src
      );
    }
    assert.equal(
      colorOf(
        checkInvariants(go.hl, 'var c comparable', { theme }),
        'comparable'
      ),
      '#550005'
    );
    // a receiver split over lines keeps its state between line-fed chunks
    for (const code of [
      'func (s *Server)\nStart(ctx context.Context) error {\n',
      'func (\n  s *Server,\n) Start(\n  ctx context.Context,\n) error {\n',
      's := "abc\\\ndef"\nz := 1\n',
    ]) {
      const { direct, streamed } = lineFed(code);
      assert.deepEqual(streamed, direct, JSON.stringify(code));
    }
  }
);

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(go.hl, src, { theme: distinctTheme });

void t.test('go: package clause and grouped imports with aliases', () => {
  assert.deepEqual(
    tokenKinds('go', 'package main\nimport (\n\t"fmt"\n\tstr "strings"\n)'),
    [
      ['package', 'keyword.declaration'],
      ['main', 'namespace'],
      ['import', 'keyword.import'],
      ['(', 'punctuation.bracket'],
      ['"fmt"', 'string'],
      ['str', 'variable'],
      ['"strings"', 'string'],
      [')', 'punctuation.bracket'],
    ]
  );
});

void t.test(
  'go: interfaces, structs, receivers, generics, and struct tags',
  () => {
    const html = distinctHl(
      'type Shape interface { Area() float64 }\ntype Rect struct { W, H float64 `json:"w"` }\nfunc (r *Rect) Area() float64 { return r.W * r.H }\nfunc New[T any](v T) *T { return &v }'
    );
    assert.equal(
      exactColor(html, 'type'),
      distinctColor('keyword.declaration')
    );
    for (const word of ['interface', 'struct', 'func']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const type of ['Shape', 'Rect', 'T']) {
      assert.equal(exactColor(html, type), distinctColor('type'), type);
    }
    assert.equal(exactColor(html, 'float64'), distinctColor('type.builtin'));
    assert.equal(exactColor(html, 'any'), distinctColor('type.builtin'));
    assert.equal(exactColor(html, '`json:"w"`'), distinctColor('string'));
    assert.equal(exactColor(html, 'New'), distinctColor('function.definition'));
    assert.equal(exactColor(html, 'W'), distinctColor('type'));
    assert.equal(exactColor(html, 'r'), distinctColor('variable'));
    assert.equal(exactColor(html, 'return'), distinctColor('keyword.control'));
  }
);

void t.test('go: numeric, rune, and string literal forms', () => {
  const html = distinctHl(
    "x := 0x1F + 0b101 + 0o17 + 1_000 + 1e3 + 2.5i + 'a' + '\\n'; s := \"esc\\t\" + `raw\nstring`"
  );
  for (const n of ['0x1F', '0b101', '0o17', '1_000', '1e3', '2.5i']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  assert.equal(exactColor(html, "'a'"), distinctColor('string'));
  assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '"esc'), distinctColor('string'));
  assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '`raw\nstring`'), distinctColor('string'));
});

void t.test(
  'go: control flow, goroutines, type switches, select, and defer',
  () => {
    const html = distinctHl(
      'if a && b || !c { break } else if d { continue }; for i := range xs { go f(i) }; switch t := v.(type) { case int: fallthrough; default: goto end }; select { case <-ch: }; defer close(ch)'
    );
    for (const word of [
      'if',
      'break',
      'else',
      'continue',
      'for',
      'range',
      'go',
      'switch',
      'case',
      'fallthrough',
      'default',
      'goto',
      'select',
      'defer',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(
      exactColor(html, 'type'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exactColor(html, '<-'), distinctColor('operator'));
    for (const fn of ['f', 'close']) {
      assert.equal(exactColor(html, fn), distinctColor('function'), fn);
    }
  }
);

void t.test('go: builtins, channels, maps, and constants', () => {
  const html = distinctHl(
    'var m map[string][]int = make(map[string][]int); ch := make(chan int, 1); ch <- 1; v, ok := <-ch; a = nil; b = true; c = false; d = iota; len(m); append(xs, 1); panic("x"); recover(); new(T); cap(xs); copy(a, b); delete(m, k)'
  );
  for (const fn of [
    'make',
    'len',
    'append',
    'panic',
    'recover',
    'new',
    'cap',
    'copy',
    'delete',
  ]) {
    assert.equal(exactColor(html, fn), distinctColor('function'), fn);
  }
  for (const word of ['var', 'map', 'chan']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.declaration'),
      word
    );
  }
  for (const c of ['nil', 'iota']) {
    assert.equal(exactColor(html, c), distinctColor('constant.builtin'), c);
  }
  assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'false'), distinctColor('boolean'));
  assert.equal(exactColor(html, 'string'), distinctColor('type.builtin'));
});

void t.test('go: comment forms and grouped declarations', () => {
  assert.deepEqual(
    tokenKinds('go', '// line\n/* block\n */\nfunc main() {} // tail'),
    [
      ['// line', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['func', 'keyword.declaration'],
      ['main', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
  const html = distinctHl('var ( x int; y = 2 ); type ( I int )');
  assert.equal(exactColor(html, 'var'), distinctColor('keyword.declaration'));
  assert.equal(exactColor(html, 'x'), distinctColor('variable'));
  assert.equal(exactColor(html, 'int'), distinctColor('type.builtin'));
  assert.equal(exactColor(html, 'I'), distinctColor('type'));
});

void t.test(
  'go: raw strings, block comments, and grouped imports stream line-fed',
  () => {
    assertLineFedParity(
      'go',
      'import (\n\t"a"\n)\nvar s = `x\ny`\n/* c\n d */\nfunc f() {}\n'
    );
  }
);
