import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
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
  lexer = loadLang('scala', '$hlScala');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/chamele.wat', import.meta.url);
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

void t.test(
  'scala: packages, declarations, types, members, and annotations',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'package demo\n\nimport scala.collection.mutable\n\n/** Doc */\nsealed trait Shape derives Show\nfinal case class Circle(radius: Double) extends Shape\n\nobject Geometry:\n  given Ordering[Circle] = Ordering.by(_.radius)\n\n  def area(s: Shape): Double = s match\n    case Circle(r) if r > 0 => math.Pi * r * r\n    case _ => 0.0\n\n  @main def run(): Unit =\n    val shapes = List(Circle(1.5))\n    val total = shapes.map(area).sum\n    println(total)\n    for i <- 1 to 3 do println(i)\n    lazy val n: Option[Int] = None // note\n    val MAX = 10; x :: xs; `type`; this; null; true',
      { theme: distinct }
    );
    assert.equal(exact(html, 'package'), distinctColor('keyword.import'));
    assert.equal(exact(html, 'demo'), distinctColor('namespace'));
    assert.equal(exact(html, 'scala'), distinctColor('namespace'));
    assert.equal(exact(html, 'mutable'), distinctColor('namespace'));
    assert.equal(within(html, '/** Doc */'), distinctColor('comment.doc'));
    assert.equal(exact(html, 'sealed'), distinctColor('keyword'));
    assert.equal(exact(html, 'trait'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Shape'), distinctColor('type'));
    assert.equal(exact(html, 'derives'), distinctColor('keyword'));
    assert.equal(exact(html, 'case'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'class'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Circle'), distinctColor('type'));
    assert.equal(exact(html, 'radius'), distinctColor('variable'));
    assert.equal(exact(html, ':'), distinctColor('punctuation.delimiter'));
    assert.equal(exact(html, 'extends'), distinctColor('keyword'));
    assert.equal(exact(html, 'object'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'given'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'by'), distinctColor('function.method'));
    assert.equal(exact(html, 'def'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'area'), distinctColor('function.definition'));
    assert.equal(within(html, 'match'), distinctColor('keyword.control'));
    assert.equal(exact(html, '=>'), distinctColor('operator'));
    assert.equal(exact(html, 'Pi'), distinctColor('type'));
    assert.equal(exact(html, '0.0'), distinctColor('number'));
    assert.equal(exact(html, '@main'), distinctColor('attribute'));
    assert.equal(exact(html, 'val'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'List'), distinctColor('type'));
    assert.equal(exact(html, 'map'), distinctColor('function.method'));
    assert.equal(exact(html, 'sum'), distinctColor('property'));
    assert.equal(exact(html, 'println'), distinctColor('function'));
    assert.equal(exact(html, 'for'), distinctColor('keyword.control'));
    assert.equal(exact(html, '<-'), distinctColor('operator'));
    assert.equal(exact(html, 'do'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'lazy val'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'Option'), distinctColor('type'));
    assert.equal(within(html, '// note'), distinctColor('comment'));
    assert.equal(exact(html, 'MAX'), distinctColor('constant'));
    assert.equal(exact(html, '::'), distinctColor('operator'));
    assert.equal(exact(html, '`type`'), distinctColor('variable'));
    assert.equal(exact(html, 'this'), distinctColor('variable.special'));
    assert.equal(exact(html, 'null'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'true'), distinctColor('boolean'));
  }
);

void t.test('scala: strings, interpolators, characters, and symbols', () => {
  const html = checkInvariants(
    lexer.hl,
    'val a = s"total = $total, ${shapes.size} shapes $$ \\n"\nval b = raw"a\\nb"\nval c = """multi\n  |line $x""".stripMargin\nval d = f"""$y%d"""\nval e = \'x\'; val g = \'\\n\'; val h = \'sym; val i = \'\u00e9\'',
    { theme: distinct }
  );
  assert.equal(exact(html, 's'), distinctColor('function'));
  assert.equal(within(html, 'total = '), distinctColor('string'));
  assert.equal(exact(html, '$total'), distinctColor('variable'));
  assert.equal(exact(html, '${'), distinctColor('punctuation.special'));
  assert.equal(exact(html, 'size'), distinctColor('property'));
  assert.equal(exact(html, '}'), distinctColor('punctuation.special'));
  assert.equal(exact(html, '$$'), distinctColor('string.escape'));
  assert.equal(exact(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exact(html, 'raw'), distinctColor('function'));
  assert.equal(within(html, 'multi\n  |line '), distinctColor('string'));
  assert.equal(within(html, ' $x'), distinctColor('string'));
  assert.equal(exact(html, 'stripMargin'), distinctColor('property'));
  assert.equal(exact(html, '$y'), distinctColor('variable'));
  assert.equal(exact(html, "'x'"), distinctColor('string'));
  assert.equal(exact(html, "'\\n'"), distinctColor('string'));
  assert.equal(exact(html, "'sym"), distinctColor('string.special.symbol'));
  assert.equal(exact(html, "'\u00e9'"), distinctColor('string'));
});

void t.test('scala: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '/* a /* b */',
    '// tail',
    '"unterminated',
    '"a\\',
    '"""',
    '"""x',
    's"',
    's"${',
    "'",
    "'\\",
    '`',
    '@',
    '$',
    ':',
    '::',
    '#',
    'é 日本語',
    'def',
    'class',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('scala: split ranges bound every lookahead', () => {
  const src =
    'def f(x: Int) = s"a ${x + 1} b" /* c */\nval y = \'z\'; @tailrec val w = """q"""';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('scala', '$hlScala', split).hl, src);
  }
});

void t.test(
  'scala: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('scala: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x5ca1a7;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('scala: multi-line constructs resume line-fed', () => {
  for (const code of [
    'val s = s"""one ${\n  x\n} two"""\nval y = 1\n',
    '/* a\n b */ val z = """x\ny"""\n',
    'import a.b\nobject O:\n  def f(\n    x: Int\n  ) = x\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('scala', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
