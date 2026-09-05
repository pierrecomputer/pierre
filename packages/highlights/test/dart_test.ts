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
} from './util';

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
  lexer = loadLang('dart', '$hlDart');
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

void t.test('dart: declarations, control flow, types, and members', () => {
  const html = checkInvariants(
    lexer.hl,
    "import 'dart:math';\n@override\nabstract class Box<T extends num> extends Base with Mixin {\n  final int count;\n  static const MAX = 1;\n  String? name;\n  int get length => count;\n  Future<void> run(List<String> args) async { if (args.isEmpty) return; print(args.length); }\n}",
    { theme: distinct }
  );
  assert.equal(exact(html, 'import'), distinctColor('keyword.import'));
  assert.equal(exact(html, '@override'), distinctColor('attribute'));
  assert.equal(
    exact(html, 'abstract class'),
    distinctColor('keyword.declaration')
  );
  assert.equal(exact(html, 'Box'), distinctColor('type'));
  assert.equal(exact(html, 'num'), distinctColor('type.builtin'));
  assert.equal(exact(html, 'MAX'), distinctColor('constant'));
  assert.equal(exact(html, 'get'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'length'), distinctColor('function.definition'));
  assert.equal(exact(html, 'run'), distinctColor('function.definition'));
  assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
  assert.equal(exact(html, 'isEmpty'), distinctColor('property'));
  assert.equal(exact(html, 'print'), distinctColor('function'));
  assert.equal(exact(html, 'async'), distinctColor('keyword.declaration'));
});

void t.test(
  'dart: strings, interpolation, raw strings, numbers, and comments',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'var s = \'hi $name and ${a.b} \\n\'; var r = r\'raw $x\'; var m = """multi\nline"""; var n = 0x1F + 1.5e3; // note\n/// doc\n/* a /* nested */ b */',
      { theme: distinct }
    );
    assert.equal(within(html, 'hi '), distinctColor('string'));
    assert.equal(exact(html, '$name'), distinctColor('variable'));
    assert.equal(exact(html, '${'), distinctColor('punctuation.special'));
    assert.equal(within(html, '\\n'), distinctColor('string.escape'));
    assert.equal(within(html, 'raw $x'), distinctColor('string'));
    assert.equal(within(html, 'multi'), distinctColor('string'));
    assert.equal(exact(html, '0x1F'), distinctColor('number'));
    assert.equal(exact(html, '1.5e3'), distinctColor('number'));
    assert.equal(within(html, '// note'), distinctColor('comment'));
    assert.equal(within(html, '/// doc'), distinctColor('comment.doc'));
    assert.equal(
      within(html, '/* a /* nested */ b */'),
      distinctColor('comment')
    );
  }
);

void t.test('dart: malformed constructs stay total and lossless', () => {
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
    "'''",
    "r'",
    "'${",
    '"""open\nstill',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('dart: split ranges bound every lookahead', () => {
  const src = "x// tail\nvar s = 'a ${b} c'; obj.m(0xff);";
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('dart', '$hlDart', split).hl, src);
  }
});

void t.test(
  'dart: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('dart: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('dart: multi-line constructs resume line-fed', () => {
  for (const code of [
    "var s = '''one\n$x two''';\nvar y = 1;\n",
    'var s = "a ${\n  x\n} b";\n',
    'int a; /* open\nstill */\nint b;\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('dart', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('dart: import, export, part, and library directives', () => {
  const html = distinctHl(
    "import 'dart:async';\nimport 'package:flutter/material.dart' as m show X hide Y;\nexport 'x.dart';\npart 'y.dart';\nlibrary l;"
  );
  for (const word of ['import', 'export', 'part', 'library', 'show', 'hide']) {
    assert.equal(wordColor(html, word), distinctColor('keyword.import'), word);
  }
  assert.equal(exactColor(html, 'as'), distinctColor('keyword.operator'));
  for (const s of [
    "'dart:async'",
    "'package:flutter/material.dart'",
    "'x.dart'",
    "'y.dart'",
  ]) {
    assert.equal(exactColor(html, s), distinctColor('string'), s);
  }
  for (const type of ['X', 'Y']) {
    assert.equal(exactColor(html, type), distinctColor('type'), type);
  }
});

void t.test(
  'dart: class heads, members, constructors, mixins, enums, typedefs, and extensions',
  () => {
    const html = distinctHl(
      'abstract class Counter<T extends num> extends StatefulWidget with M implements I { final int initial; static const int max = 10; late int _count; Counter({super.key, this.initial = 0, required this.x}) : assert(initial >= 0); factory Counter.named() => Counter(); @override State<Counter> createState() => _CounterState(); external void ext(); operator +(Counter o) => this; get value => _count; set value(int v) => _count = v; }\nmixin M on Base { }\nenum Color { red, green }\ntypedef Callback = void Function(int);\nextension E on int { int get doubled => this * 2; }\nsealed class S {} base class B {} interface class I2 {} final class F {}'
    );
    for (const word of [
      'abstract',
      'class',
      'extends',
      'with',
      'implements',
      'final',
      'static',
      'const',
      'late',
      'required',
      'factory',
      'external',
      'operator',
      'get',
      'set',
      'mixin',
      'enum',
      'typedef',
      'extension',
      'sealed',
      'base',
      'interface',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const type of [
      'Counter',
      'StatefulWidget',
      'M',
      'I',
      'State',
      'Base',
      'Color',
      'Callback',
      'E',
      'S',
      'B',
      'I2',
      'F',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const type of ['num', 'int', 'void']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const v of ['initial', 'max', '_count', 'o', 'v']) {
      assert.equal(wordColor(html, v), distinctColor('variable'), v);
    }
    for (const v of ['super', 'this']) {
      assert.equal(wordColor(html, v), distinctColor('variable.special'), v);
    }
    for (const p of ['key', 'x']) {
      assert.equal(exactColor(html, p), distinctColor('property'), p);
    }
    assert.equal(exactColor(html, 'assert'), distinctColor('keyword.control'));
    assert.equal(exactColor(html, 'named'), distinctColor('function.method'));
    for (const fn of ['createState', 'ext', 'doubled']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    assert.equal(exactColor(html, '@override'), distinctColor('attribute'));
    assert.equal(wordColor(html, 'on'), distinctColor('keyword.control'));
    assert.equal(wordColor(html, '=>'), distinctColor('operator'));
  }
);

void t.test(
  'dart: literals, interpolation, raw and multi-line strings, and collection literals',
  () => {
    const html = distinctHl(
      "var x = 0x1F + 1_000 + 1e3 + 2.5; var s = 'esc\\t $x ${x + 1}' + \"dq\" + r'raw $x' + '''multi\n$x''' + \"\"\"dq\nmulti\"\"\"; bool b = true; Object? n = null; const c = [1, 2]; final l = <int>[1]; var m = <String, int>{'a': 1};"
    );
    for (const n of ['0x1F', '1_000', '1e3', '2.5']) {
      assert.equal(exactColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, "'esc"), distinctColor('string'));
    assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '$x'), distinctColor('variable'));
    assert.equal(exactColor(html, '${'), distinctColor('punctuation.special'));
    for (const s of ['"dq"', "r'raw $x'"]) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    assert.equal(colorOf(html, "'''multi"), distinctColor('string'));
    assert.equal(colorOf(html, '"""dq'), distinctColor('string'));
    for (const type of ['bool', 'Object', 'int', 'String']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
    assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
    for (const word of ['var', 'const', 'final']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    assert.equal(wordColor(html, '?'), distinctColor('operator'));
  }
);

void t.test(
  'dart: async forms, control flow, exceptions, type tests, and null-aware operators',
  () => {
    const html = distinctHl(
      'Future<void> f() async { await g(); await for (var x in s) {} yield 1; yield* h(); } void main() { for (var i = 0; i < 3; i++) { if (a && b || !c) break; else continue; } while (x) {} do {} while (y); switch (v) { case 1: break; default: } try { throw E(); } on E catch (e, st) { rethrow; } finally {} return; assert(x); var q = x is int ? 1 : 2; q = x as int; var w = a ?? b; a?.b; a!; a..b(); print(x); new Foo(); dynamic d; covariant int e; }'
    );
    assert.equal(exactColor(html, 'Future'), distinctColor('type.builtin'));
    for (const fn of ['f', 'main']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    assert.equal(
      wordColor(html, 'async'),
      distinctColor('keyword.declaration')
    );
    for (const word of [
      'await',
      'for',
      'yield',
      'if',
      'break',
      'else',
      'continue',
      'while',
      'do',
      'switch',
      'case',
      'default',
      'try',
      'throw',
      'on',
      'catch',
      'rethrow',
      'finally',
      'return',
      'assert',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of ['in', 'is', 'as', 'new']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.operator'),
        word
      );
    }
    for (const fn of ['g', 'h', 'print']) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    for (const type of ['E', 'Foo']) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const op of ['&&', '||', '!', '++', '?', '??', '?.', '..', '*']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(exactColor(html, 'dynamic'), distinctColor('type.builtin'));
    assert.equal(
      exactColor(html, 'covariant'),
      distinctColor('keyword.declaration')
    );
  }
);

void t.test('dart: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'dart',
      '// line\n/// doc\n/* block\n */\n/** block doc */\nvoid f() {} // tail'
    ),
    [
      ['// line', 'comment'],
      ['/// doc', 'comment.doc'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['/** block doc */', 'comment.doc'],
      ['void', 'type.builtin'],
      ['f', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test('dart: multi-line strings and doc comments stream line-fed', () => {
  assertLineFedParity(
    'dart',
    "var s = '''a\n$b\n''';\n/// doc\n/* c\n */\nvoid f() {}\n"
  );
});
