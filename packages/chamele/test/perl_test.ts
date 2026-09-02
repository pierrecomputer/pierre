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
  lexer = loadLang('perl', '$hlPerl');
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

void t.test('perl: declarations, control flow, variables, and calls', () => {
  const html = checkInvariants(
    lexer.hl,
    "use strict;\npackage Demo::Box;\nour $VERSION = '1';\nsub new {\n    my ($class, %args) = @_;\n    my $self = bless { name => $args{name} // 'x' }, $class;\n    return $self unless defined $self->{name};\n}\nDemo::Box->new(1) or die \"no\";",
    { theme: distinct }
  );
  assert.equal(exact(html, 'use'), distinctColor('keyword.import'));
  assert.equal(exact(html, 'package'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'Demo'), distinctColor('namespace'));
  assert.equal(exact(html, '$VERSION'), distinctColor('variable'));
  assert.equal(exact(html, 'sub'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, 'new'), distinctColor('function.definition'));
  assert.equal(exact(html, 'my'), distinctColor('keyword.declaration'));
  assert.equal(exact(html, '%args'), distinctColor('variable'));
  assert.equal(exact(html, '@_'), distinctColor('variable'));
  assert.equal(exact(html, 'bless'), distinctColor('function'));
  assert.equal(exact(html, 'name'), distinctColor('string.special.symbol'));
  assert.equal(exact(html, '//'), distinctColor('operator'));
  assert.equal(exact(html, 'return'), distinctColor('keyword.control'));
  assert.equal(exact(html, 'unless'), distinctColor('keyword.control'));
  assert.equal(exact(html, 'defined'), distinctColor('function'));
  assert.equal(exact(html, 'die'), distinctColor('function'));
});

void t.test(
  'perl: strings, quote-like operators, regexes, heredocs, and POD',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '=head1 NAME\ndoc\n=cut\nmy @w = qw(a b);\nmy $t = <<"EOT";\nHello $name\nEOT\n$t =~ s/Hello/Bye/g if $t =~ m{Hi}i;\nprint "n=$self->{x}\\n";\n__END__\ndata',
      { theme: distinct }
    );
    assert.equal(within(html, 'doc'), distinctColor('comment.doc'));
    assert.equal(exact(html, 'qw(a b)'), distinctColor('string'));
    assert.equal(exact(html, '<<"EOT"'), distinctColor('string'));
    assert.equal(within(html, 'Hello $name'), distinctColor('string'));
    assert.equal(exact(html, 's/Hello/Bye/g'), distinctColor('string.regex'));
    assert.equal(exact(html, 'm{Hi}i'), distinctColor('string.regex'));
    assert.equal(within(html, 'n='), distinctColor('string'));
    assert.equal(exact(html, '$self'), distinctColor('variable'));
    assert.equal(within(html, '\\n'), distinctColor('string.escape'));
    assert.equal(within(html, 'data'), distinctColor('comment'));
  }
);

void t.test('perl: malformed constructs stay total and lossless', () => {
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
    'qw(',
    's/',
    'm{',
    '<<"',
    '=pod',
    '$#',
    '$$',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('perl: split ranges bound every lookahead', () => {
  const src = 'my $x = <<EOT;\na $b\nEOT\n$x =~ s/a/b/ if 1; # c';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('perl', '$hlPerl', split).hl, src);
  }
});

void t.test(
  'perl: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('perl: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('perl: multi-line constructs resume line-fed', () => {
  for (const code of [
    'my $s = <<"EOT";\nhello $x\nEOT\nprint 1;\n',
    '=head1 doc\ntext\n=cut\nprint 1;\n',
    'my $s = "a\nb";\n',
    'print 1;\n__END__\ndata\nmore\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('perl', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
