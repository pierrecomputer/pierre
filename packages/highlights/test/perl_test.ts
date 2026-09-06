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
} from './_util';

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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('perl: pragmas, imports, packages, and special blocks', () => {
  const html = distinctHl(
    "use strict;\nuse warnings;\nuse List::Util qw(sum max);\nno strict 'refs';\npackage Shop::Cart 1.02;\nour @ISA = ('Base');\nrequire Exporter;\nBEGIN { }\nEND { }"
  );
  for (const word of ['use', 'no', 'require']) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.import'),
      word
    );
  }
  for (const ns of ['List', 'Util', 'Shop', 'Cart']) {
    assert.equal(exactColor(html, ns), distinctColorOf('namespace'), ns);
  }
  assert.equal(
    exactColor(html, '::'),
    distinctColorOf('punctuation.delimiter')
  );
  assert.equal(exactColor(html, 'qw(sum max)'), distinctColorOf('string'));
  assert.equal(exactColor(html, "'refs'"), distinctColorOf('string'));
  for (const word of ['package', 'our']) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.declaration'),
      word
    );
  }
  assert.equal(exactColor(html, '1.02'), distinctColorOf('number'));
  assert.equal(exactColor(html, '@ISA'), distinctColorOf('variable'));
  assert.equal(exactColor(html, 'Exporter'), distinctColorOf('type'));
  for (const word of ['BEGIN', 'END']) {
    assert.equal(exactColor(html, word), distinctColorOf('keyword'), word);
  }
});

void t.test('perl: numeric literal forms', () => {
  const html = distinctHl(
    'my $x = 0x1F + 0b101 + 0o17 + 017 + 1_000 + 1e3 + 2.5;'
  );
  for (const n of ['0x1F', '0b101', '0o17', '017', '1_000', '1e3', '2.5']) {
    assert.equal(exactColor(html, n), distinctColorOf('number'), n);
  }
});

void t.test(
  'perl: subs, declarators, loops, conditionals, and word operators',
  () => {
    const html = distinctHl(
      "sub total { my ($self, @list) = @_; my %h = (a => 1); foreach my $n (@list) { next if !$n; last unless $n > 0; redo; } for (my $i = 0; $i < 3; $i++) {} while (1) { last } until ($x) {} do {} while 0; if ($a && $b || !$c and $d or $e xor $f) {} elsif ($g) {} else {} unless ($u) {} return wantarray; goto &f; local $_ = 1; state $s = 0; eval { die 'x' }; warn 'w'; die 'd' if $@; }"
    );
    assert.equal(
      exactColor(html, 'sub'),
      distinctColorOf('keyword.declaration')
    );
    assert.equal(
      exactColor(html, 'total'),
      distinctColorOf('function.definition')
    );
    for (const word of ['my', 'local', 'state']) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.declaration'),
        word
      );
    }
    for (const v of ['$self', '@list', '@_', '%h', '$n', '$i', '$_', '$s']) {
      assert.equal(wordColor(html, v), distinctColorOf('variable'), v);
    }
    assert.equal(
      exactColor(html, 'a'),
      distinctColorOf('string.special.symbol')
    );
    for (const word of [
      'foreach',
      'next',
      'if',
      'last',
      'unless',
      'redo',
      'for',
      'while',
      'until',
      'do',
      'elsif',
      'else',
      'return',
      'goto',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.control'),
        word
      );
    }
    for (const word of ['and', 'or', 'xor']) {
      assert.equal(
        wordColor(html, word),
        distinctColorOf('keyword.operator'),
        word
      );
    }
    for (const fn of ['wantarray', 'eval', 'die', 'warn']) {
      assert.equal(wordColor(html, fn), distinctColorOf('function'), fn);
    }
    assert.equal(exactColor(html, '&f'), distinctColorOf('function'));
    assert.equal(exactColor(html, '$@'), distinctColorOf('variable.special'));
    for (const op of ['&&', '||', '!', '++', '<', '>', '=>']) {
      assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
    }
  }
);

void t.test(
  'perl: builtin functions, dereferences, and special variables',
  () => {
    const html = distinctHl(
      "print \"x\"; printf('%s', $x); say 'y'; push @a, 1; pop @a; shift @a; join ',', @a; split /,/, $s; map { $_ * 2 } @a; grep { $_ } @a; sort { $a <=> $b } @a; keys %h; exists $h{k}; delete $h{k}; defined $x; scalar @a; open my $fh, '<', $f or die; close $fh; bless {}, $c; $obj->{key}; $obj->[0]; $Class::var; ${$r}; $#a; $0; $1; $!; $/; __PACKAGE__"
    );
    for (const fn of [
      'print',
      'printf',
      'say',
      'push',
      'pop',
      'shift',
      'join',
      'split',
      'map',
      'grep',
      'sort',
      'keys',
      'exists',
      'delete',
      'defined',
      'scalar',
      'open',
      'close',
      'bless',
    ]) {
      assert.equal(wordColor(html, fn), distinctColorOf('function'), fn);
    }
    assert.equal(exactColor(html, '/,/'), distinctColorOf('string.regex'));
    for (const sym of ['k', 'key']) {
      assert.equal(
        exactColor(html, sym),
        distinctColorOf('string.special.symbol'),
        sym
      );
    }
    assert.equal(exactColor(html, '$Class::var'), distinctColorOf('variable'));
    assert.equal(exactColor(html, '$#a'), distinctColorOf('variable'));
    for (const v of ['${$r}', '$0', '$1', '$!', '$/', '__PACKAGE__']) {
      assert.equal(exactColor(html, v), distinctColorOf('variable.special'), v);
    }
    assert.equal(exactColor(html, '<=>'), distinctColorOf('operator'));
    assert.equal(exactColor(html, 'or'), distinctColorOf('keyword.operator'));
  }
);

void t.test('perl: regex operators and comparison words', () => {
  const html = distinctHl(
    '$s =~ /^a(b+)c$/i; $s =~ s/a/b/g; $s =~ tr/a-z/A-Z/; $s !~ m{x}x; $s =~ y/a/b/; qr/re/; $a cmp $b; $a eq $b; $a ne $b; $a lt $b; $a gt $b; $a le $b; $a ge $b; $a x 3; $a .. $b; $a ... $b; $a ** 2; $a // $b; $a <<= 1; ++$a; $a--; \\$a'
  );
  for (const re of [
    '/^a(b+)c$/i',
    's/a/b/g',
    'tr/a-z/A-Z/',
    'm{x}x',
    'y/a/b/',
    'qr/re/',
  ]) {
    assert.equal(exactColor(html, re), distinctColorOf('string.regex'), re);
  }
  for (const word of ['cmp', 'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'x']) {
    assert.equal(
      wordColor(html, word),
      distinctColorOf('keyword.operator'),
      word
    );
  }
  for (const op of ['=~', '!~', '..', '...', '**', '//', '<<=', '++', '--']) {
    assert.equal(wordColor(html, op), distinctColorOf('operator'), op);
  }
});

void t.test('perl: comments, POD, and the __END__ marker', () => {
  assert.deepEqual(
    tokenKinds(
      'perl',
      '# comment\n=pod\n\nDoc.\n\n=cut\nmy $x = 1; # tail\n=head1 NAME\n\nText\n\n=cut\n__END__\nignored'
    ),
    [
      ['# comment', 'comment'],
      ['=pod', 'comment.doc'],
      ['Doc.', 'comment.doc'],
      ['=cut', 'comment.doc'],
      ['my', 'keyword.declaration'],
      ['$x', 'variable'],
      ['=', 'operator'],
      ['1', 'number'],
      [';', 'punctuation.delimiter'],
      ['# tail', 'comment'],
      ['=head1 NAME', 'comment.doc'],
      ['Text', 'comment.doc'],
      ['=cut', 'comment.doc'],
      ['__END__', 'comment'],
      ['ignored', 'comment'],
    ]
  );
});

void t.test(
  'perl: POD, heredocs, and multi-line strings stream line-fed',
  () => {
    assertLineFedParity(
      'perl',
      "=head1 X\n\ntext\n\n=cut\nmy $s = <<END;\na $b\nEND\nmy $t = 'multi\nline';\n__END__\nx\n"
    );
  }
);
