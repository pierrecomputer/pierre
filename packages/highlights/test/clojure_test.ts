import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
} from './util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('clojure', '$hlClojure');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test(
  'clojure: namespaces, definitions, keywords, literals, and interop',
  () => {
    assert.deepEqual(
      tokenKinds(
        'clojure',
        '(ns demo.core\n  (:require [clojure.string :as str]))\n(defn- greet [name & rest]\n  (println (str "Hi" name) #"\\d+" \\a :kw 0x1F nil true))\n(def ^:private x 10)\n(defrecord Circle [r])\n(if-let [y (first xs)] (Math/abs y) (.toUpperCase "s"))\n'
      ),
      [
        ['(', 'punctuation.bracket'],
        ['ns', 'keyword.declaration'],
        ['demo.core', 'namespace'],
        ['(', 'punctuation.bracket'],
        [':require', 'string.special.symbol'],
        ['[', 'punctuation.bracket'],
        ['clojure.string', 'namespace'],
        [':as', 'string.special.symbol'],
        ['str', 'variable'],
        [']))', 'punctuation.bracket'],
        ['(', 'punctuation.bracket'],
        ['defn-', 'keyword.declaration'],
        ['greet', 'function.definition'],
        ['[', 'punctuation.bracket'],
        ['name', 'variable'],
        ['&', 'keyword'],
        ['rest', 'variable'],
        [']', 'punctuation.bracket'],
        ['(', 'punctuation.bracket'],
        ['println', 'function'],
        ['(', 'punctuation.bracket'],
        ['str', 'function'],
        ['"Hi"', 'string'],
        ['name', 'variable'],
        [')', 'punctuation.bracket'],
        ['#"', 'string.regex'],
        ['\\d', 'string.escape'],
        ['+"', 'string.regex'],
        ['\\a', 'string.special'],
        [':kw', 'string.special.symbol'],
        ['0x1F', 'number'],
        ['nil', 'constant.builtin'],
        ['true', 'boolean'],
        ['))', 'punctuation.bracket'],
        ['(', 'punctuation.bracket'],
        ['def', 'keyword.declaration'],
        ['^', 'punctuation.special'],
        [':private', 'string.special.symbol'],
        ['x', 'variable'],
        ['10', 'number'],
        [')', 'punctuation.bracket'],
        ['(', 'punctuation.bracket'],
        ['defrecord', 'keyword.declaration'],
        ['Circle', 'type'],
        ['[', 'punctuation.bracket'],
        ['r', 'variable'],
        ['])', 'punctuation.bracket'],
        ['(', 'punctuation.bracket'],
        ['if-let', 'keyword.control'],
        ['[', 'punctuation.bracket'],
        ['y', 'variable'],
        ['(', 'punctuation.bracket'],
        ['first', 'function'],
        ['xs', 'variable'],
        [')] (', 'punctuation.bracket'],
        ['Math', 'type'],
        ['/', 'punctuation.delimiter'],
        ['abs', 'function'],
        ['y', 'variable'],
        [') (', 'punctuation.bracket'],
        ['.toUpperCase', 'function.method'],
        ['"s"', 'string'],
        ['))', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test('clojure: reader macros, numbers, and special symbols', () => {
  const html = distinctHl(
    ';; note\n(defonce state (atom {:count 0, :names #{}}))\n(defprotocol Shape (area [this]))\n(declare helper)\n(when-let [v @state] (swap! state assoc :k \'quoted))\n#(+ % %2 1/2 2.5e3 1N -7)\n`(unquote ~x ~@xs) #_(ignored) #inst "2024" ##Inf\n(Date.) (.-length arr) (println *out* & body) (str/join "," items)\n'
  );
  assert.equal(exactColor(html, ';; note'), distinctColor('comment'));
  assert.equal(
    exactColor(html, 'defonce'),
    distinctColor('keyword.declaration')
  );
  assert.equal(exactColor(html, 'state'), distinctColor('variable'));
  assert.equal(exactColor(html, 'atom'), distinctColor('function'));
  assert.equal(
    exactColor(html, ':count'),
    distinctColor('string.special.symbol')
  );
  assert.equal(exactColor(html, ','), distinctColor('punctuation.delimiter'));
  assert.equal(exactColor(html, '#'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, 'Shape'), distinctColor('type'));
  assert.equal(exactColor(html, 'area'), distinctColor('function'));
  assert.equal(
    exactColor(html, 'declare'),
    distinctColor('keyword.declaration')
  );
  assert.equal(
    exactColor(html, 'helper'),
    distinctColor('function.definition')
  );
  assert.equal(exactColor(html, 'when-let'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, '@'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, 'swap!'), distinctColor('function'));
  assert.equal(exactColor(html, "'"), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, 'quoted'), distinctColor('variable'));
  assert.equal(exactColor(html, '+'), distinctColor('function'));
  assert.equal(exactColor(html, '% %2'), distinctColor('variable.special'));
  assert.equal(exactColor(html, '1/2 2.5e3 1N -7'), distinctColor('number'));
  assert.equal(exactColor(html, '`'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, 'unquote'), distinctColor('function'));
  assert.equal(exactColor(html, '~'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '~@'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '#_'), distinctColor('punctuation.special'));
  assert.equal(exactColor(html, '#inst'), distinctColor('attribute'));
  assert.equal(exactColor(html, '##Inf'), distinctColor('constant.builtin'));
  assert.equal(exactColor(html, 'Date.'), distinctColor('type'));
  assert.equal(exactColor(html, '.-length'), distinctColor('property'));
  assert.equal(exactColor(html, '*out*'), distinctColor('variable.special'));
  assert.equal(exactColor(html, '&'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'str'), distinctColor('namespace'));
  assert.equal(exactColor(html, 'join'), distinctColor('function'));
});

void t.test('clojure: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    ';',
    '"',
    '#"',
    '#',
    '#_',
    '#?',
    '#?@',
    '##',
    '#:',
    '\\',
    '\\ ',
    ':',
    '::',
    '^',
    '~',
    '~@',
    '@',
    '`',
    "'",
    '%',
    '&',
    '/',
    'a/',
    '/a',
    '-',
    '+',
    '-1',
    'é 日本語',
    '(defn',
    '(ns',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('clojure: split ranges bound every lookahead', () => {
  const src =
    '(defn f [x & r] (if-let [y :k] (str/join "," #"\\d" \\a ##NaN) (Date.)))';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('clojure', '$hlClojure', split).hl, src);
  }
});

void t.test(
  'clojure: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x28,
      0x66,
      0x6f,
      0x6f,
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

void t.test('clojure: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x7a5c21;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?^é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('clojure: multi-line constructs stream line-fed', () => {
  for (const code of [
    '(defn f [x]\n  "multi\nline" #"re\ngex")\n',
    '(def m {:a 1\n        :b 2})\n',
    ';; c\n(ns a.b\n  (:require [c.d :as d]))\n',
  ]) {
    assertLineFedParity('clojure', code);
  }
});
