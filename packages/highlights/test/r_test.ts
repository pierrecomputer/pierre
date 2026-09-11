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
  lexer = loadLang('r', '$hlR');
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

void t.test(
  'r: definitions, formals, calls, arguments, pipes, and constants',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '#\' Roxygen comment\nlibrary(dplyr)\n\nfib <- function(n = 10, ...) {\n  if (n <= 1L) return(n)\n  fib(n - 1) + fib(n - 2)\n}\n\ndf <- data.frame(x = 1:10, y = rnorm(10))\nresult <- df %>%\n  filter(x > 5) |>\n  mutate(z = x * 2, `odd name` = TRUE)\nprint(sprintf("%.2f", result$y[[1]]))\nv <- c(a = 1e-3, b = 0x1F, c = NA_integer_, d = NULL, e = Inf)\nfor (i in seq_len(3)) next\nsq = \\(w) w^2\npkg::fun(.hidden, obj@slot) # note',
      { theme: distinct }
    );
    assert.equal(within(html, "#' Roxygen"), distinctColor('comment.doc'));
    assert.equal(exact(html, 'library'), distinctColor('function'));
    assert.equal(exact(html, 'dplyr'), distinctColor('variable'));
    assert.equal(exact(html, 'fib'), distinctColor('function.definition'));
    assert.equal(exact(html, '<-'), distinctColor('operator'));
    assert.equal(exact(html, 'function'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'n'), distinctColor('variable.parameter'));
    assert.equal(exact(html, '10'), distinctColor('number'));
    assert.equal(exact(html, '...'), distinctColor('variable.special'));
    assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
    assert.equal(exact(html, '1L'), distinctColor('number'));
    assert.equal(exact(html, 'return'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'data.frame'), distinctColor('function'));
    assert.equal(exact(html, 'x'), distinctColor('variable.parameter'));
    assert.equal(exact(html, ':'), distinctColor('operator'));
    assert.equal(exact(html, '%>%'), distinctColor('operator'));
    assert.equal(exact(html, '|>'), distinctColor('operator'));
    assert.equal(exact(html, '`odd name`'), distinctColor('variable'));
    assert.equal(exact(html, 'TRUE'), distinctColor('boolean'));
    assert.equal(exact(html, '"%.2f"'), distinctColor('string'));
    assert.equal(exact(html, '$'), distinctColor('operator'));
    assert.equal(exact(html, '[['), distinctColor('punctuation.bracket'));
    assert.equal(exact(html, '1e-3'), distinctColor('number'));
    assert.equal(exact(html, '0x1F'), distinctColor('number'));
    assert.equal(exact(html, 'NA_integer_'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'NULL'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'Inf'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'in'), distinctColor('keyword.operator'));
    assert.equal(exact(html, 'next'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'sq'), distinctColor('function.definition'));
    assert.equal(exact(html, '\\'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'w'), distinctColor('variable.parameter'));
    assert.equal(exact(html, '^'), distinctColor('operator'));
    assert.equal(exact(html, 'pkg'), distinctColor('namespace'));
    assert.equal(exact(html, '::'), distinctColor('operator'));
    assert.equal(exact(html, '.hidden'), distinctColor('variable'));
    assert.equal(exact(html, '@'), distinctColor('operator'));
    assert.equal(exact(html, 'slot'), distinctColor('property'));
    assert.equal(within(html, '# note'), distinctColor('comment'));
  }
);

void t.test('r: strings and raw strings', () => {
  const html = checkInvariants(
    lexer.hl,
    'a <- "esc \\" x"\nb <- \'multi\nline\'\nc <- r"(C:\\path)"\nd <- R\'--[x]--\'\ne <- r"(open',
    { theme: distinct }
  );
  assert.equal(within(html, 'esc '), distinctColor('string'));
  assert.equal(exact(html, '\\"'), distinctColor('string.escape'));
  assert.equal(within(html, 'multi\nline'), distinctColor('string'));
  assert.equal(exact(html, 'r"(C:\\path)"'), distinctColor('string'));
  assert.equal(exact(html, "R'--[x]--'"), distinctColor('string'));
  assert.equal(exact(html, 'r"(open'), distinctColor('string'));
});

void t.test('r: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '"unterminated',
    "'",
    '`',
    '%',
    '%in',
    '\\',
    '\\(',
    '.',
    '..',
    '...',
    'r"',
    'r"(',
    'R"-',
    'r"---',
    '$',
    '@',
    '::',
    ':::',
    'é 日本語',
    'function',
    'x <-',
    'x <- function',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('r: split ranges bound every lookahead', () => {
  const src = 'f <- function(a, b = 2) a %in% b # c\ng(x = r"(y)", `z`, 1e3)';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('r', '$hlR', split).hl, src);
  }
});

void t.test('r: malformed UTF-8 stays balanced and decodes losslessly', () => {
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
});

void t.test('r: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x2a7f13;
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

void t.test('r: multi-line constructs resume line-fed', () => {
  for (const code of [
    'x <- "one\ntwo"\ny <- r"(a\nb)"\n',
    'f <- function(a,\n  b) a + b\n',
    "s <- 'q\nr' # c\nz <- 1\n",
  ]) {
    const [whole, streamed] = wholeAndLineFed('r', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'r: library calls, function definitions, lambdas, and assignment arrows',
  () => {
    const html = distinctHl(
      '#\' Roxygen\nlibrary(dplyr); require(x); source("a.R")\nfib <- function(n = 10, ...) { if (n <= 1L) return(n) else fib(n - 1) + fib(n - 2) }\nsq = \\(w) w^2\nf <<- function() NULL\nx -> y; x ->> z; `%+%` <- function(a, b) a + b'
    );
    for (const fn of ['library', 'require', 'source']) {
      assert.equal(exactColor(html, fn), distinctColor('function'), fn);
    }
    for (const fn of ['fib', 'sq', 'f']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const op of ['<-', '=', '<<-', '->', '->>', '^', '+']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    for (const word of ['function', '\\']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const p of ['n', 'w', 'a', 'b']) {
      assert.equal(exactColor(html, p), distinctColor('variable.parameter'), p);
    }
    assert.equal(exactColor(html, '...'), distinctColor('variable.special'));
    for (const word of ['if', 'return', 'else']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(exactColor(html, '1L'), distinctColor('number'));
    assert.equal(exactColor(html, 'NULL'), distinctColor('constant.builtin'));
    assert.equal(exactColor(html, '`%+%`'), distinctColor('variable'));
    assert.equal(exactColor(html, "#' Roxygen"), distinctColor('comment.doc'));
  }
);

void t.test('r: literal forms, missing values, and accessors', () => {
  const html = distinctHl(
    'x <- 0x1F + 1e-3 + 1L + 2.5 + 1i + .5; s <- "esc\\t" + \'single\' + r"(raw)" + R"[raw]"; b <- TRUE && FALSE; n <- NULL; m <- NA + NA_integer_ + NA_real_ + NA_character_ + Inf + NaN; l <- list(a = 1); v <- c(1, 2)[1]; ll <- l[["a"]]; d <- df$col; e <- obj@slot; ns <- pkg::fun(); ns2 <- pkg:::hidden'
  );
  for (const n of ['0x1F', '1e-3', '1L', '2.5', '1i', '.5']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  assert.equal(exactColor(html, '"esc'), distinctColor('string'));
  assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
  for (const s of ["'single'", 'r"(raw)"', 'R"[raw]"']) {
    assert.equal(exactColor(html, s), distinctColor('string'), s);
  }
  for (const b of ['TRUE', 'FALSE']) {
    assert.equal(exactColor(html, b), distinctColor('boolean'), b);
  }
  for (const c of [
    'NULL',
    'NA',
    'NA_integer_',
    'NA_real_',
    'NA_character_',
    'Inf',
    'NaN',
  ]) {
    assert.equal(exactColor(html, c), distinctColor('constant.builtin'), c);
  }
  for (const fn of ['list', 'c', 'fun']) {
    assert.equal(exactColor(html, fn), distinctColor('function'), fn);
  }
  assert.equal(exactColor(html, 'a'), distinctColor('variable.parameter'));
  for (const b of ['[[', ']]', ']']) {
    assert.equal(exactColor(html, b), distinctColor('punctuation.bracket'), b);
  }
  for (const op of ['$', '@', '::', ':::', '&&']) {
    assert.equal(exactColor(html, op), distinctColor('operator'), op);
  }
  for (const p of ['col', 'slot']) {
    assert.equal(exactColor(html, p), distinctColor('property'), p);
  }
  assert.equal(exactColor(html, 'pkg'), distinctColor('namespace'));
  assert.equal(exactColor(html, 'hidden'), distinctColor('variable'));
});

void t.test(
  'r: loops, conditionals, pipes, formulas, and named arguments',
  () => {
    const html = distinctHl(
      'for (i in seq_len(3)) { if (i %% 2 == 0) next else break }; while (TRUE) break; repeat { break }; tryCatch({ stop("e") }, error = function(e) e); if (a) b else c; x %>% f() |> g(); x %in% y; a == b; a != b; a >= b; a <= b; a ^ b; a ** b; -a; !a; a:b; a ~ b; ?help; a & b; a | b; a && b; a || b; x[1, 2]; g(...); ..1; print(x); paste0("a", "b"); is.null(x); lapply(l, f); do.call(f, l); stopifnot(TRUE)'
    );
    for (const word of [
      'for',
      'if',
      'next',
      'else',
      'break',
      'while',
      'repeat',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(wordColor(html, 'in'), distinctColor('keyword.operator'));
    for (const fn of [
      'seq_len',
      'tryCatch',
      'stop',
      'f',
      'g',
      'print',
      'paste0',
      'is.null',
      'lapply',
      'do.call',
      'stopifnot',
    ]) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    for (const op of [
      '%%',
      '==',
      '%>%',
      '|>',
      '%in%',
      '!=',
      '>=',
      '<=',
      '^',
      '**',
      '-',
      '!',
      ':',
      '~',
      '?',
      '&',
      '|',
      '&&',
      '||',
    ]) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    for (const v of ['...', '..1']) {
      assert.equal(exactColor(html, v), distinctColor('variable.special'), v);
    }
    assert.equal(exactColor(html, 'e'), distinctColor('variable.parameter'));
    assert.equal(
      exactColor(html, 'error'),
      distinctColor('function.definition')
    );
  }
);

void t.test('r: comment and roxygen forms', () => {
  assert.deepEqual(
    tokenKinds(
      'r',
      "# comment\n#' @param x\n#' @export\nf <- function(x) x # tail"
    ),
    [
      ['# comment', 'comment'],
      ["#' @param x", 'comment.doc'],
      ["#' @export", 'comment.doc'],
      ['f', 'function.definition'],
      ['<-', 'operator'],
      ['function', 'keyword.declaration'],
      ['(', 'punctuation.bracket'],
      ['x', 'variable.parameter'],
      [')', 'punctuation.bracket'],
      ['x', 'variable'],
      ['# tail', 'comment'],
    ]
  );
});

void t.test('r: raw strings and multi-line calls stream line-fed', () => {
  assertLineFedParity(
    'r',
    'x <- r"(a\nb)"\ny <- f(\n  1,\n  2\n)\n#\' doc\nz <- "multi\nline"\n'
  );
});
