import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
} from './_util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('latex', '$hlLatex');
});

void t.test('latex: preamble, sections, and command arguments', () => {
  assert.deepEqual(
    tokenKinds(
      'latex',
      '\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n% note\n\\title{On \\LaTeX{} Lexing}\n\\section*{Intro} See \\emph{a \\textbf{b} c}, \\cite[p.~5]{knuth} and \\url{https://x.org}.\n\\item One & two \\\\ #1\n\\newcommand{\\foo}[1]{x}\n\\href{http://a.b}{text}\n'
    ),
    [
      ['\\documentclass', 'keyword.import'],
      ['[', 'punctuation.bracket'],
      ['11pt', null],
      [']{', 'punctuation.bracket'],
      ['article', 'string'],
      ['}', 'punctuation.bracket'],
      ['\\usepackage', 'keyword.import'],
      ['{', 'punctuation.bracket'],
      ['amsmath', 'string'],
      ['}', 'punctuation.bracket'],
      ['% note', 'comment'],
      ['\\title', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['On', 'title'],
      ['\\LaTeX', 'function'],
      ['{}', 'punctuation.bracket'],
      ['Lexing', 'title'],
      ['}', 'punctuation.bracket'],
      ['\\section*', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['Intro', 'title'],
      ['}', 'punctuation.bracket'],
      ['See', null],
      ['\\emph', 'function'],
      ['{', 'punctuation.bracket'],
      ['a', 'emphasis'],
      ['\\textbf', 'function'],
      ['{', 'punctuation.bracket'],
      ['b', 'emphasis.strong'],
      ['}', 'punctuation.bracket'],
      ['c', 'emphasis'],
      ['}', 'punctuation.bracket'],
      [',', null],
      ['\\cite', 'function'],
      ['[', 'punctuation.bracket'],
      ['p.~5', null],
      [']{', 'punctuation.bracket'],
      ['knuth', 'constant'],
      ['}', 'punctuation.bracket'],
      ['and', null],
      ['\\url', 'function'],
      ['{', 'punctuation.bracket'],
      ['https://x.org', 'link_uri'],
      ['}', 'punctuation.bracket'],
      ['.', null],
      ['\\item', 'punctuation.list_marker'],
      ['One', null],
      ['&', 'punctuation.delimiter'],
      ['two', null],
      ['\\\\', 'function'],
      ['#1', 'variable.parameter'],
      ['\\newcommand', 'function'],
      ['{', 'punctuation.bracket'],
      ['\\foo', 'function'],
      ['}[', 'punctuation.bracket'],
      ['1', null],
      [']{', 'punctuation.bracket'],
      ['x', null],
      ['}', 'punctuation.bracket'],
      ['\\href', 'function'],
      ['{', 'punctuation.bracket'],
      ['http://a.b', 'link_uri'],
      ['}{', 'punctuation.bracket'],
      ['text', null],
      ['}', 'punctuation.bracket'],
    ]
  );
});

void t.test('latex: inline, display, and environment math', () => {
  assert.deepEqual(
    tokenKinds(
      'latex',
      'a $x^2 + y_1 = \\alpha$ b $$z$$ \\(p\\) \\[q\\]\n\\begin{align*}\n  E &= mc^2 \\label{eq:e}\n\\end{align*}\nafter\n'
    ),
    [
      ['a', null],
      ['$', 'punctuation.bracket'],
      ['x', 'number'],
      ['^', 'operator'],
      ['2 + y', 'number'],
      ['_', 'operator'],
      ['1', 'number'],
      ['=', 'operator'],
      ['\\alpha', 'function'],
      ['$', 'punctuation.bracket'],
      ['b', null],
      ['$$', 'punctuation.bracket'],
      ['z', 'number'],
      // same-kind neighbors merge across the space between them
      ['$$ \\(', 'punctuation.bracket'],
      ['p', 'number'],
      ['\\) \\[', 'punctuation.bracket'],
      ['q', 'number'],
      ['\\]', 'punctuation.bracket'],
      ['\\begin', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['align*', 'type'],
      ['}', 'punctuation.bracket'],
      ['E', 'number'],
      ['&', 'punctuation.delimiter'],
      ['=', 'operator'],
      ['mc', 'number'],
      ['^', 'operator'],
      ['2', 'number'],
      // an argument opened inside math keeps its own token
      ['\\label', 'function'],
      ['{', 'punctuation.bracket'],
      ['eq:e', 'constant'],
      ['}', 'punctuation.bracket'],
      ['\\end', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['align*', 'type'],
      ['}', 'punctuation.bracket'],
      ['after', null],
    ]
  );
});

void t.test('latex: verbatim, listings, and comment environments', () => {
  assert.deepEqual(
    tokenKinds(
      'latex',
      '\\verb|a%b| \\verb*+x+\n\\begin{verbatim}\n% not \\section{x}\n\\end{verbatim}\n\\begin{lstlisting}[language=C]\nint x; % y\n\\end{lstlisting}\n\\begin{comment}\nhidden\n\\end{comment}\n'
    ),
    [
      ['\\verb', 'function'],
      ['|a%b|', 'text.literal'],
      ['\\verb*', 'function'],
      ['+x+', 'text.literal'],
      ['\\begin', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['verbatim', 'type'],
      ['}', 'punctuation.bracket'],
      ['% not \\section{x}', 'text.literal'],
      ['\\end', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['verbatim', 'type'],
      ['}', 'punctuation.bracket'],
      ['\\begin', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['lstlisting', 'type'],
      ['}[', 'punctuation.bracket'],
      ['language=C', null],
      [']', 'punctuation.bracket'],
      ['int x; % y', 'text.literal'],
      ['\\end', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['lstlisting', 'type'],
      ['}', 'punctuation.bracket'],
      ['\\begin', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['comment', 'type'],
      ['}', 'punctuation.bracket'],
      ['hidden', 'comment'],
      ['\\end', 'keyword'],
      ['{', 'punctuation.bracket'],
      ['comment', 'type'],
      ['}', 'punctuation.bracket'],
    ]
  );
});

void t.test('latex: a blank line ends math and arguments', () => {
  const kinds = tokenKinds('latex', '$x\n\ny\n\\textbf{a\n\nb}\n');
  assert.deepEqual(
    kinds.filter(([text]) => text === 'y' || text === 'b'),
    [
      ['y', null],
      ['b', null],
    ]
  );
});

void t.test('latex: commands in an optional argument keep it pending', () => {
  const kinds = tokenKinds(
    'latex',
    '\\includegraphics[width=0.5\\textwidth]{fig.png}\n'
  );
  assert.ok(
    kinds.some(([text, kind]) => text === 'fig.png' && kind === 'string')
  );
});

void t.test('latex: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '\\',
    '\\\n',
    '\\é',
    '$',
    '$$',
    '\\(',
    '\\[',
    '{',
    '}',
    '[',
    '#',
    '%',
    '\\verb',
    '\\verb|',
    '\\verb a',
    '\\begin',
    '\\begin{',
    '\\begin{verbatim',
    '\\begin{verbatim}',
    '\\begin{verbatim}\\end{',
    '\\begin{lstlisting}[',
    '\\begin{minted}{x',
    '\\end{equation}',
    '\\section',
    '\\section[',
    'é 日本語 \\emph{é}',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('latex: split ranges bound every lookahead', () => {
  const src =
    '\\begin{verbatim}x\\end{verbatim} \\verb|a| $a^b$ \\begin{lstlisting}[o]{l}z\\end{lstlisting} \\section[s]{t} é \\é #1 % c\n';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('latex', '$hlLatex', split).hl, src);
  }
});

void t.test(
  'latex: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x5c,
      0x61,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x5c,
      0xff,
      0x24,
      0xe2,
      0x24
    );
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('latex: deterministic fuzz preserves lexer invariants', () => {
  const rand = makeRand(0x1a7e5);
  const pieces = [
    '\\',
    '{',
    '}',
    '[',
    ']',
    '$',
    '%',
    '&',
    '#1',
    '^',
    '_',
    '=',
    ' ',
    '\n',
    'a',
    'é',
    '*',
    '|',
    '\\begin{',
    '\\end{',
    'verbatim}',
    'equation}',
    'comment}',
    '\\section',
    '\\verb',
    '\\(',
    '\\]',
  ];
  for (let n = 0; n < 200; n++) {
    let src = '';
    for (let i = 0, len = rand() % 32; i < len; i++) {
      src += pieces[rand() % pieces.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('latex: multi-line constructs stream line-fed', () => {
  for (const code of [
    'a $x\n+ y$ b\n',
    '$$\nx\n$$ y\n',
    '\\[\n a \\\\\n b\n\\] c\n',
    '\\begin{align}\n a &= b\n\\end{align}\ntext\n',
    '\\section{Long\ntitle} x\n',
    '\\section\n{T}\n',
    '\\usepackage[\n opt\n]{pkg}\n',
    '\\begin{verbatim}\na\n\n%b\n\\end{verbatim}\n\\x\n',
    '\\begin{comment}\na\n\\end{comment}\nb % c\n',
    '\\begin{minted}{python}\nx = 1\n\\end{minted}\n',
    '$x\n\ny\n',
  ]) {
    assertLineFedParity('latex', code);
  }
});
