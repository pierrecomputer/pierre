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
  themeColor,
  tokenKinds,
  wordColor as wordColorOf,
} from './util';

let haskell: TestLang;

t.before(() => {
  haskell = loadLang('haskell', '$hlHaskell');
});

/**
 * Compile the whole module once for the streaming checks: StreamTokenizer and
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
 * Tokens for `code` fed to StreamTokenizer one line per push - the shape the
 * live tokenizer uses - which must equal the whole-buffer tokens.
 */
function assertLineStreamParity(code: string, label: string): ThemedToken[][] {
  initFullModule();
  const stream = new StreamTokenizer({ lang: 'haskell', theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/))
    streamed.push(...stream.pushCode(line));
  streamed.push(...stream.end());
  const whole = codeToTokens(code, {
    lang: 'haskell',
    theme: pierreDark,
  }).tokens;
  assert.deepEqual(streamed, whole, label);
  return streamed;
}

/** The color of the first span whose trimmed text is exactly `text`. */
const wordColor = (html: string, text: string) =>
  spansOf(html).find((s) => s.text.trim() === text)?.color;

const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');
const STRING = themeColor('string');
const CHAR = themeColor('string.special');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const CONTROL = themeColor('keyword.control');
const DECLARATION = themeColor('keyword.declaration');
const IMPORT = themeColor('keyword.import');
const TYPE = themeColor('type');
const CONSTRUCTOR = themeColor('constructor');
const FUNCTION = themeColor('function');
const OPERATOR = themeColor('operator');
const BRACKET = themeColor('punctuation.bracket');

void t.test('haskell: line, nested block, and documentation comments', () => {
  const src =
    '-- plain\n-- | line docs\n{- outer {- nested -} tail -}\n{-| block docs -}';
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, '-- plain'), COMMENT);
  assert.equal(colorOf(html, '{- outer {- nested -} tail -}'), COMMENT);

  const bucketTheme = {
    name: 'haskell-comment-buckets',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const bucketed = checkInvariants(haskell.hl, src, { theme: bucketTheme });
  assert.equal(colorOf(bucketed, '-- | line docs'), '#222222');
  assert.equal(colorOf(bucketed, '{-| block docs -}'), '#222222');
});

void t.test('haskell: pragmas are preprocessor tokens', () => {
  const src =
    '{-# LANGUAGE OverloadedStrings #-}\n{-# OPTIONS_GHC -Wall #-}\nmodule Demo where';
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, '{-# LANGUAGE OverloadedStrings #-}'), PREPROC);
  assert.equal(colorOf(html, '{-# OPTIONS_GHC -Wall #-}'), PREPROC);
});

void t.test('haskell: strings, characters, and escapes', () => {
  const src = "message = \"line\\n\\x41\"\nletter = 'λ'\nquote = '\\''";
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, '"line'), STRING);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`\x`), ESCAPE);
  assert.equal(colorOf(html, "'λ'"), CHAR);
  assert.equal(colorOf(html, String.raw`\'`), ESCAPE);
});

void t.test('haskell: numeric literals', () => {
  const src = 'values = [42, 0xff, 0o755, 0b1010, 1_000, 3.14, .5, 1e-6]';
  const html = checkInvariants(haskell.hl, src);
  for (const n of [
    '42',
    '0xff',
    '0o755',
    '0b1010',
    '1_000',
    '3.14',
    '.5',
    '1e-6',
  ]) {
    assert.equal(colorOf(html, n), NUMBER, n);
  }
});

void t.test(
  'haskell: modules, imports, declarations, types, and constructors',
  () => {
    const src =
      'module Demo.Core where\nimport qualified Data.Text as T\ndata Maybe a = Nothing | Just a\nnewtype User = User String\nclass Render a where\ninstance Render User where';
    const html = checkInvariants(haskell.hl, src);
    assert.equal(colorOf(html, 'module'), IMPORT);
    assert.equal(colorOf(html, 'import'), IMPORT);
    assert.equal(colorOf(html, 'qualified'), IMPORT);
    assert.equal(colorOf(html, 'data'), DECLARATION);
    assert.equal(colorOf(html, 'newtype'), DECLARATION);
    assert.equal(colorOf(html, 'class'), DECLARATION);
    assert.equal(colorOf(html, 'instance'), DECLARATION);
    assert.equal(colorOf(html, 'Maybe'), TYPE);
    assert.equal(colorOf(html, 'Nothing'), CONSTRUCTOR);
    assert.equal(colorOf(html, 'Just'), CONSTRUCTOR);
  }
);

void t.test('haskell: control flow, definitions, calls, and operators', () => {
  const src =
    'render :: Show a => a -> IO ()\nrender value = do\n  let text = show value\n  if null text then pure () else print text\ncontains = value `elem` values';
  const html = checkInvariants(haskell.hl, src);
  assert.equal(colorOf(html, 'render'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'do'), CONTROL);
  assert.equal(colorOf(html, 'let'), CONTROL);
  assert.equal(colorOf(html, 'if'), CONTROL);
  assert.equal(colorOf(html, 'then'), CONTROL);
  assert.equal(colorOf(html, 'else'), CONTROL);
  assert.equal(colorOf(html, 'show'), FUNCTION);
  assert.equal(colorOf(html, 'print'), FUNCTION);
  assert.equal(colorOf(html, 'elem'), FUNCTION);
  for (const op of ['::', '=>', '->', '='])
    assert.equal(colorOf(html, op), OPERATOR, op);
  assert.equal(colorOf(html, '('), BRACKET);
});

void t.test('haskell: malformed and UTF-8 input remains lossless', () => {
  for (const src of [
    '{- unterminated {- nested -}',
    '{-# LANGUAGE λ',
    '-- | docs 雪',
    '"unterminated \\',
    "'λ",
    "value' = café 🚀",
    '0x + 1e+',
    '-}',
  ])
    checkInvariants(haskell.hl, src);
});

void t.test('haskell: lookahead is bounded by split ranges', () => {
  for (const [prefix, tail] of [
    ['{', '- block -}'],
    ['{-', '# LANGUAGE GADTs #-}'],
    ['-', '- comment\nx = 1'],
    ['"a\\', 'n" tail'],
    [':', ': Int'],
    ['`', 'elem` xs'],
  ]) {
    const ranged = loadLang('haskell', '$hlHaskell', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

void t.test('haskell: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ \'\\"{}()[]`#.:,+-*/|&=<>\nλ雪';
  let state = 0x13579bdf;
  for (let sample = 0; sample < 180; sample++) {
    let src = '';
    const n = state >>> 27;
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(haskell.hl, src);
  }
});

void t.test(
  'haskell: a pragma spanning lines streams like a block comment',
  () => {
    const src = '{-# LANGUAGE\n  GADTs,\n  DataKinds #-}\nmain = 1\n';
    const html = checkInvariants(haskell.hl, src);
    assert.equal(colorOf(html, 'DataKinds #-}'), PREPROC);
    const streamed = assertLineStreamParity(src, 'pragma');
    assert.equal(
      streamed[1].find((tk) => tk.content.trim() === 'GADTs,')?.color,
      PREPROC
    );
    assert.equal(
      streamed[3].find((tk) => tk.content.trim() === 'main')?.color,
      themeColor('function.definition')
    );
    assertLineStreamParity(
      '{- a\n{- b -}\nc -}\nx = 2\nfoo\n(1)\n',
      'nested comment'
    );
  }
);

void t.test('haskell: primes, dollar, and name-quoting ticks', () => {
  const SPECIAL = themeColor('punctuation.special');
  const html = checkInvariants(
    haskell.hl,
    "go' = foldl' step z xs\nh = f $ g x\nc = ['a', '\\n', 'λ', '\\'']\n"
  );
  assert.equal(wordColor(html, "go'"), themeColor('function.definition'));
  // the prime stays inside the name: no tick punctuation on the first line
  assert.ok(
    spansOf(checkInvariants(haskell.hl, "go' = foldl' step z xs")).every(
      (s) => s.color !== SPECIAL
    )
  );
  assert.equal(wordColor(html, '$'), OPERATOR);
  assert.equal(wordColor(html, "'a'"), CHAR);
  assert.equal(wordColor(html, "'λ'"), CHAR);
  assert.equal(colorOf(html, '\\n'), ESCAPE);
  assert.equal(colorOf(html, "\\'"), ESCAPE);

  // a tick without a closing tick quotes a name: promoted constructors and
  // Template Haskell names lex as the tick plus the name
  const quoted = "t :: Proxy 'True\nu :: Proxy '[Int]\nv = ''Int\nw = 'λ";
  const qhtml = checkInvariants(haskell.hl, quoted);
  assert.deepEqual(
    spansOf(qhtml)
      .filter((s) => s.text === "'" || s.text === "''")
      .map((s) => s.color),
    [SPECIAL, SPECIAL, SPECIAL, SPECIAL]
  );
  assert.equal(wordColor(qhtml, 'True'), themeColor('boolean'));
  assert.equal(wordColor(qhtml, 'Int'), TYPE);
  assertLineStreamParity(quoted + '\n', 'ticks');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(haskell.hl, src, { theme: distinctTheme });

void t.test('haskell: module heads and every import form', () => {
  const html = distinctHl(
    "{-# LANGUAGE OverloadedStrings #-}\nmodule Shop (total, Item(..), module X) where\nimport qualified Data.Map as M\nimport Data.List (foldl', sortBy)\nimport Data.Maybe hiding (fromJust)"
  );
  assert.equal(
    exactColor(html, '{-# LANGUAGE OverloadedStrings #-}'),
    distinctColor('preproc')
  );
  for (const word of ['module', 'import', 'import qualified', 'hiding']) {
    assert.equal(exactColor(html, word), distinctColor('keyword.import'), word);
  }
  assert.equal(exactColor(html, 'where'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, 'as'), distinctColor('keyword'));
  for (const type of [
    'Shop',
    'Item',
    'X',
    'Data',
    'Map',
    'M',
    'List',
    'Maybe',
  ]) {
    assert.equal(wordColorOf(html, type), distinctColor('type'), type);
  }
  for (const v of ['total', "foldl'", 'sortBy', 'fromJust']) {
    assert.equal(exactColor(html, v), distinctColor('variable'), v);
  }
  assert.equal(exactColor(html, '..'), distinctColor('operator'));
});

void t.test(
  'haskell: data, newtype, class, instance, and fixity declarations',
  () => {
    const html = distinctHl(
      'data Item = Item { name :: String } | Empty deriving (Show, Eq)\nnewtype Wrap a = Wrap { unwrap :: a }\nclass Priced a where\n  cost :: a -> Double\ninstance Priced Item where\n  cost = price\ninfixl 6 <+>\n(<+>) :: Int -> Int -> Int\nx <+> y = x + y'
    );
    for (const word of ['data', 'newtype', 'class', 'instance']) {
      assert.equal(
        wordColorOf(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    assert.equal(exactColor(html, 'Item'), distinctColor('type'));
    assert.deepEqual(
      tokenKinds('haskell', 'newtype Wrap a = Wrap { unwrap :: a }').slice(
        0,
        6
      ),
      [
        ['newtype', 'keyword.declaration'],
        ['Wrap', 'type'],
        ['a', 'variable'],
        ['=', 'operator'],
        ['Wrap', 'constructor'],
        ['{', 'punctuation.bracket'],
      ]
    );
    for (const type of ['String', 'Double', 'Show', 'Eq', 'Int']) {
      assert.equal(wordColorOf(html, type), distinctColor('type'), type);
    }
    for (const v of ['name', 'unwrap', 'price']) {
      assert.equal(exactColor(html, v), distinctColor('variable'), v);
    }
    assert.equal(
      exactColor(html, 'deriving'),
      distinctColor('keyword.control')
    );
    assert.equal(
      exactColor(html, 'cost'),
      distinctColor('function.definition')
    );
    assert.equal(exactColor(html, 'infixl'), distinctColor('keyword'));
    assert.equal(exactColor(html, '6'), distinctColor('number'));
    for (const op of ['<+>', '::', '->', '=', '|', '+']) {
      assert.equal(wordColorOf(html, op), distinctColor('operator'), op);
    }
    assert.equal(exactColor(html, 'x'), distinctColor('function.definition'));
  }
);

void t.test(
  'haskell: numeric, character, string, and constructor literals',
  () => {
    const html = distinctHl(
      "x = 0x1F + 0b101 + 0o17 + 1_000 + 1e3 + 2.5 + 3e-2; c = 'a'; c2 = '\\n'; s = \"esc\\t\"; b = True && False; u = (); l = [1, 2 .. 10]; n = Nothing; j = Just 1; r = Right 1; z = 1 :| [2]"
    );
    for (const n of ['0x1F', '0b101', '0o17', '1_000', '1e3', '2.5', '3e-2']) {
      assert.equal(exactColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, "'a'"), distinctColor('string.special'));
    assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '"esc'), distinctColor('string'));
    assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
    for (const b of ['True', 'False']) {
      assert.equal(exactColor(html, b), distinctColor('boolean'), b);
    }
    assert.equal(exactColor(html, '()'), distinctColor('punctuation.bracket'));
    for (const c of ['Nothing', 'Just', 'Right']) {
      assert.equal(exactColor(html, c), distinctColor('constructor'), c);
    }
    for (const op of ['&&', '..', ':|']) {
      assert.equal(exactColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test(
  'haskell: do blocks, guards, lambdas, sections, and operator names',
  () => {
    const html = distinctHl(
      'main :: IO ()\nmain = do\n  let items = [Item "tea" 2.5]\n      n = length items `div` 2\n  x <- getLine\n  case items of\n    (y:_) | price y > 1 -> putStrLn $ "first"\n    [] -> return ()\n  if n > 0 then pure () else pure ()\n  where\n    helper z = z * 2\ng = \\case { Just v -> v; Nothing -> 0 }\nh = let a = 1 in a\nfmap (+1) [1]; (<$>); (<*>); (>>=); (.); ($); (<>); (++); (!!)'
    );
    for (const fn of ['main', 'items', 'helper', 'g', 'h']) {
      assert.equal(
        wordColorOf(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    assert.equal(exactColor(html, 'IO'), distinctColor('type'));
    for (const word of [
      'do',
      'let',
      'case',
      'of',
      'if',
      'then',
      'else',
      'where',
      'in',
    ]) {
      assert.equal(
        wordColorOf(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const fn of ['length', 'div', 'return', 'pure', 'fmap']) {
      assert.equal(wordColorOf(html, fn), distinctColor('function'), fn);
    }
    assert.equal(exactColor(html, '`'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, 'Item'), distinctColor('constructor'));
    for (const op of [
      '<-',
      '->',
      '$',
      '\\',
      '<$>',
      '<*>',
      '>>=',
      '.',
      '<>',
      '++',
      '!!',
      '|',
      ':',
      '*',
      '>',
    ]) {
      assert.equal(wordColorOf(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test(
  'haskell: comment forms including nested blocks and doc markers',
  () => {
    assert.deepEqual(
      tokenKinds(
        'haskell',
        '-- comment\n{- block\n {- nested -} -}\n-- | doc\n-- ^ post doc\nf = 1 -- tail'
      ),
      [
        ['-- comment', 'comment'],
        ['{- block', 'comment'],
        ['{- nested -} -}', 'comment'],
        ['-- | doc', 'comment.doc'],
        ['-- ^ post doc', 'comment.doc'],
        ['f', 'function.definition'],
        ['=', 'operator'],
        ['1', 'number'],
        ['-- tail', 'comment'],
      ]
    );
  }
);

void t.test(
  'haskell: nested comments, string gaps, and where blocks stream line-fed',
  () => {
    assertLineFedParity(
      'haskell',
      '{- a\n {- b -}\n -}\ns = "x\\\n  \\y"\nf = g\n  where\n    g = 1\n'
    );
  }
);
