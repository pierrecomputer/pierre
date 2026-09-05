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
  distinctColor as distinctColorOf,
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
  lexer = loadLang('ruby', '$hlRuby');
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

void t.test('ruby: declarations, control flow, symbols, and members', () => {
  const html = checkInvariants(
    lexer.hl,
    "require 'json'\nmodule Demo::Util\n  class Box < Base\n    MAX = 10\n    attr_reader :name\n    def initialize(name:, size: 1)\n      @name = name; @@count ||= 0; $stdout.puts name.upcase\n    end\n    def self.build = new\n    def empty? = size.zero?\n  end\nend",
    { theme: distinct }
  );
  assert.equal(exact(html, 'require'), distinctColor('function'));
  assert.equal(exact(html, 'module'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'Demo'), distinctColor('type'));
  assert.equal(exact(html, 'Box'), distinctColor('type'));
  assert.equal(exact(html, 'MAX'), distinctColor('constant'));
  assert.equal(exact(html, 'attr_reader'), distinctColor('function'));
  assert.equal(exact(html, ':name'), distinctColor('string.special.symbol'));
  assert.equal(exact(html, 'def'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'initialize'), distinctColor('function.definition'));
  assert.equal(exact(html, 'name:'), distinctColor('string.special.symbol'));
  assert.equal(exact(html, '@name'), distinctColor('variable.special'));
  assert.equal(exact(html, '@@count'), distinctColor('variable.special'));
  assert.equal(exact(html, '$stdout'), distinctColor('variable.special'));
  assert.equal(exact(html, 'upcase'), distinctColor('function.method'));
  assert.equal(exact(html, 'build'), distinctColor('function.definition'));
  assert.equal(exact(html, 'empty?'), distinctColor('function.definition'));
  assert.equal(exact(html, 'end'), distinctColor('keyword.control'));
});

void t.test(
  'ruby: strings, interpolation, regexes, percent literals, heredocs, and numbers',
  () => {
    const html = checkInvariants(
      lexer.hl,
      's = "hi #{name.upcase} \\n"; re = /ab+c/i; w = %w[a b]; i = %i(x y); q = %Q{b #{x}}; n = 1_000 + 0xff; t = <<~EOS\n  hello #{y}\nEOS\nputs t # note',
      { theme: distinct }
    );
    assert.equal(within(html, 'hi '), distinctColor('string'));
    assert.equal(exact(html, '#{'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'upcase'), distinctColor('function.method'));
    assert.equal(within(html, '\\n'), distinctColor('string.escape'));
    assert.equal(exact(html, '/ab+c/i'), distinctColor('string.regex'));
    assert.equal(exact(html, '%w[a b]'), distinctColor('string'));
    assert.equal(
      exact(html, '%i(x y)'),
      distinctColor('string.special.symbol')
    );
    assert.equal(exact(html, '1_000'), distinctColor('number'));
    assert.equal(within(html, 'hello #{y}'), distinctColor('string'));
    assert.equal(within(html, '# note'), distinctColor('comment'));
  }
);

void t.test('ruby: =begin blocks, __END__ data, and operator symbols', () => {
  const html = checkInvariants(
    lexer.hl,
    '=begin\nblock\n=end\nx = a / b ? :+ : :done\n__END__\ndata',
    { theme: distinct }
  );
  assert.equal(within(html, 'block'), distinctColor('comment'));
  assert.equal(exact(html, '/'), distinctColor('operator'));
  assert.equal(exact(html, ':+'), distinctColor('string.special.symbol'));
  assert.equal(exact(html, ':done'), distinctColor('string.special.symbol'));
  assert.equal(within(html, 'data'), distinctColor('comment'));
});

void t.test('ruby: malformed constructs stay total and lossless', () => {
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
    '%w[',
    '<<~',
    '=begin',
    ':"',
    '/re',
    '%Q{#{',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('ruby: split ranges bound every lookahead', () => {
  const src = 'x = <<~EOS\n  a #{b}\nEOS\nre = /a/ if y # c\n%w[a b]';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('ruby', '$hlRuby', split).hl, src);
  }
});

void t.test(
  'ruby: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('ruby: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('ruby: multi-line constructs resume line-fed', () => {
  for (const code of [
    'x = <<~EOS\n  hi #{y}\nEOS\nz = 1\n',
    '=begin\nblock\n=end\nz = 1\n',
    'z = %w[a\nb]\nq = 1\n',
    's = "a #{\n  x\n} b"\n',
    'y = 1\n__END__\ndata\nmore\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('ruby', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'ruby: requires, modules, mixins, attribute macros, and method forms',
  () => {
    const html = distinctHl(
      "require 'json'\nrequire_relative 'x'\nmodule M\n  class C < B\n    include Enumerable\n    extend Forwardable\n    attr_accessor :a, :b\n    CONST = 1\n    def initialize(x, y = 2, *rest, k:, **opts, &blk); end\n    def self.build; end\n    def to_s = 'x'\n    private\n  end\nend"
    );
    for (const fn of [
      'require',
      'require_relative',
      'include',
      'extend',
      'attr_accessor',
      'private',
    ]) {
      assert.equal(exactColor(html, fn), distinctColorOf('function'), fn);
    }
    for (const word of ['module', 'class', 'def']) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.declaration'),
        word
      );
    }
    for (const type of ['M', 'C', 'B', 'Enumerable', 'Forwardable']) {
      assert.equal(exactColor(html, type), distinctColorOf('type'), type);
    }
    assert.equal(exactColor(html, '<'), distinctColorOf('operator'));
    for (const sym of [':a', ':b', 'k:']) {
      assert.equal(
        exactColor(html, sym),
        distinctColorOf('string.special.symbol'),
        sym
      );
    }
    assert.equal(exactColor(html, 'CONST'), distinctColorOf('constant'));
    for (const fn of ['initialize', 'build', 'to_s']) {
      assert.equal(
        exactColor(html, fn),
        distinctColorOf('function.definition'),
        fn
      );
    }
    assert.equal(exactColor(html, 'self'), distinctColorOf('variable.special'));
    for (const p of ['x', 'rest', 'opts', 'blk']) {
      assert.equal(exactColor(html, p), distinctColorOf('variable'), p);
    }
    for (const op of ['*', '**', '&']) {
      assert.equal(exactColor(html, op), distinctColorOf('operator'), op);
    }
    assert.equal(wordColor(html, 'end'), distinctColorOf('keyword.control'));
  }
);

void t.test('ruby: numeric literal forms', () => {
  const html = distinctHl(
    'x = 0x1F + 0b101 + 0o17 + 017 + 1_000 + 1e3 + 2.5 + 3r + 4i'
  );
  for (const n of [
    '0x1F',
    '0b101',
    '0o17',
    '017',
    '1_000',
    '1e3',
    '2.5',
    '3r',
    '4i',
  ]) {
    assert.equal(exactColor(html, n), distinctColorOf('number'), n);
  }
});

void t.test('ruby: control flow words and word operators', () => {
  const html = distinctHl(
    'if a && b || !c then 1 elsif d then 2 end; unless u; end; while w do break end; until t; next; end; for i in 1..3 do redo end; x = 1 when 2 then 3; begin; raise E; rescue E => e; retry; ensure; end; return; yield; not a; a and b; a or b'
  );
  for (const word of [
    'if',
    'then',
    'elsif',
    'end',
    'unless',
    'while',
    'do',
    'break',
    'until',
    'next',
    'for',
    'in',
    'redo',
    'when',
    'begin',
    'raise',
    'rescue',
    'retry',
    'ensure',
    'return',
    'yield',
  ]) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.control'),
      word
    );
  }
  for (const word of ['not', 'and', 'or']) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.operator'),
      word
    );
  }
  for (const op of ['&&', '||', '!', '..', '=>']) {
    assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
  }
  assert.equal(exactColor(html, 'E'), distinctColorOf('type'));
});

void t.test(
  'ruby: calls, blocks, members, special variables, and constants',
  () => {
    const html = distinctHl(
      "puts 'x'; p x; lambda { |x| x }; ->(x) { x }; puts(obj.method(arg)); obj[0]; Obj::CONST; obj&.m; nil; true; false; @ivar; @@cvar; $gvar; $1; $stdout; __FILE__; ENV['X']; a <=> b; a =~ /x/; a ** 2; a ||= 1; loop { break }; x.times { |i| i }"
    );
    for (const fn of ['puts', 'p', 'lambda', 'loop']) {
      assert.equal(wordColor(html, fn), distinctColorOf('function'), fn);
    }
    for (const m of ['method', 'm', 'times']) {
      assert.equal(exactColor(html, m), distinctColorOf('function.method'), m);
    }
    assert.equal(exactColor(html, 'Obj'), distinctColorOf('type'));
    assert.equal(
      exactColor(html, '::'),
      distinctColorOf('punctuation.delimiter')
    );
    assert.equal(
      exactColor(html, '&.'),
      distinctColorOf('punctuation.delimiter')
    );
    for (const c of ['CONST', 'ENV']) {
      assert.equal(exactColor(html, c), distinctColorOf('constant'), c);
    }
    assert.equal(exactColor(html, 'nil'), distinctColorOf('constant.builtin'));
    assert.equal(exactColor(html, 'true'), distinctColorOf('boolean'));
    assert.equal(exactColor(html, 'false'), distinctColorOf('boolean'));
    for (const v of ['@ivar', '@@cvar', '$gvar', '$1', '$stdout', '__FILE__']) {
      assert.equal(exactColor(html, v), distinctColorOf('variable.special'), v);
    }
    for (const op of ['->', '<=>', '=~', '**', '||=', '|']) {
      assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
    }
    assert.equal(exactColor(html, '/x/'), distinctColorOf('string.regex'));
  }
);

void t.test('ruby: comment forms including =begin blocks', () => {
  assert.deepEqual(
    tokenKinds('ruby', '# comment\n=begin\nblock\n=end\ndef f; end # tail'),
    [
      ['# comment', 'comment'],
      ['=begin', 'comment'],
      ['block', 'comment'],
      ['=end', 'comment'],
      ['def', 'keyword.declaration'],
      ['f', 'function.definition'],
      [';', 'punctuation.delimiter'],
      ['end', 'keyword.control'],
      ['# tail', 'comment'],
    ]
  );
});

void t.test(
  'ruby: heredocs, block comments, and percent literals stream line-fed',
  () => {
    assertLineFedParity(
      'ruby',
      'x = <<~EOS\n  a #{b}\n  c\nEOS\n=begin\nd\n=end\ny = %w[\n  e\n  f\n]\nz = "multi\nline"\n'
    );
  }
);
