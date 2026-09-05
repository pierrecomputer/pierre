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
  lexer = loadLang('lisp', '$hlLisp');
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
  'lisp: definitions, special forms, keywords, and reader syntax',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '(in-package :demo)\n(defpackage :demo (:use :cl))\n(defvar *count* 0 "doc")\n(defconstant +max+ 10)\n(defstruct point x y)\n(defun greet (name &optional (loud nil))\n  (let* ((msg (format nil "hi ~a" name)))\n    (if loud (princ msg) (values msg t))\n    (mapcar #\'1+ \'(1 2))\n    `(a ,b ,@c)\n    #+sbcl (quit)))',
      { theme: distinct }
    );
    assert.equal(exact(html, 'in-package'), distinctColor('keyword'));
    assert.equal(exact(html, ':demo'), distinctColor('string.special.symbol'));
    assert.equal(exact(html, 'defvar'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, '*count*'), distinctColor('variable'));
    assert.equal(
      exact(html, 'defconstant'),
      distinctColor('keyword.declaration')
    );
    assert.equal(
      exact(html, 'defstruct'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exact(html, 'point'), distinctColor('type'));
    assert.equal(exact(html, 'defun'), distinctColor('keyword.declaration'));
    assert.equal(exact(html, 'greet'), distinctColor('function.definition'));
    assert.equal(exact(html, '&optional'), distinctColor('keyword'));
    assert.equal(exact(html, 'nil'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'let*'), distinctColor('keyword'));
    assert.equal(exact(html, 'format'), distinctColor('function'));
    assert.equal(exact(html, '"hi ~a"'), distinctColor('string'));
    assert.equal(exact(html, 'if'), distinctColor('keyword'));
    assert.equal(exact(html, 'princ'), distinctColor('function'));
    assert.equal(exact(html, "#'"), distinctColor('punctuation.special'));
    assert.equal(exact(html, '1+'), distinctColor('operator'));
    assert.equal(exact(html, ',@'), distinctColor('punctuation.special'));
    assert.equal(exact(html, '#+sbcl'), distinctColor('preproc'));
  }
);

void t.test('lisp: comments, characters, numbers, and strings', () => {
  const html = checkInvariants(
    lexer.hl,
    ';;; title\n#| block\ncomment |#\n(list #\\a #\\Space #x1F 1.5e3 -3/4 "multi\nline")',
    { theme: distinct }
  );
  assert.equal(within(html, ';;; title'), distinctColor('comment'));
  assert.equal(within(html, 'block'), distinctColor('comment'));
  assert.equal(within(html, '#\\a'), distinctColor('string.special'));
  assert.equal(within(html, '#x1F'), distinctColor('number'));
  assert.equal(within(html, '1.5e3'), distinctColor('number'));
  assert.equal(within(html, 'multi'), distinctColor('string'));
});

void t.test('lisp: malformed constructs stay total and lossless', () => {
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
    '#|',
    '#\\',
    '#',
    "'",
    '`',
    ',@',
    '(',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('lisp: split ranges bound every lookahead', () => {
  const src = 'x ; c\n(f #| a\nb |# "s\nt" #\\( \'x)';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('lisp', '$hlLisp', split).hl, src);
  }
});

void t.test(
  'lisp: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('lisp: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('lisp: multi-line constructs resume line-fed', () => {
  for (const code of ['#| open\nstill |#\n(f)\n', '(f "multi\nline")\n(g)\n']) {
    const [whole, streamed] = wholeAndLineFed('lisp', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test('lisp: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'lisp',
      ';;; header\n;; double\n; single\n#| block\nnested |#\n(defun f () "doc" 1) ; tail'
    ),
    [
      [';;; header', 'comment'],
      [';; double', 'comment'],
      ['; single', 'comment'],
      ['#| block', 'comment'],
      ['nested |#', 'comment'],
      ['(', 'punctuation.bracket'],
      ['defun', 'keyword.declaration'],
      ['f', 'function.definition'],
      ['()', 'punctuation.bracket'],
      ['"doc"', 'string'],
      ['1', 'number'],
      [')', 'punctuation.bracket'],
      ['; tail', 'comment'],
    ]
  );
});

void t.test(
  'lisp: definers, lambda lists, backquotes, and binding forms',
  () => {
    const html = distinctHl(
      '(defpackage :shop (:use :cl)) (in-package :shop) (defconstant +max+ 100) (defvar *items* nil) (defparameter *p* 1) (defun add-item (name &key (price 0.0) &optional o &rest r) (list :name name)) (defmacro with-timing ((&rest args) &body body) `(let ((start 1)) ,@body ,args)) (defstruct point x y) (defclass c () ((slot :initarg :slot))) (defmethod m ((x c)) x) (defgeneric g (x)) (lambda (x) x) (let ((a 1)) a) (let* ((a 1)) a) (flet ((f (x) x)) (f 1))'
    );
    for (const word of [
      'defpackage',
      'defconstant',
      'defvar',
      'defparameter',
      'defun',
      'defmacro',
      'defstruct',
      'defclass',
      'defmethod',
      'defgeneric',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const word of [
      'in-package',
      'lambda',
      'let',
      'let*',
      'flet',
      '&key',
      '&optional',
      '&rest',
      '&body',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const sym of [':shop', ':use', ':cl', ':name', ':initarg', ':slot']) {
      assert.equal(
        wordColor(html, sym),
        distinctColor('string.special.symbol'),
        sym
      );
    }
    for (const v of ['+max+', '*items*', '*p*', 'args', 'body', 'o', 'r']) {
      assert.equal(wordColor(html, v), distinctColor('variable'), v);
    }
    assert.equal(exactColor(html, 'nil'), distinctColor('constant.builtin'));
    for (const fn of ['add-item', 'with-timing', 'm', 'g']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const type of ['point', 'c']) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const sp of ['`', ',@', ',']) {
      assert.equal(
        exactColor(html, sp),
        distinctColor('punctuation.special'),
        sp
      );
    }
    assert.equal(exactColor(html, 'list'), distinctColor('function'));
    assert.equal(exactColor(html, '100'), distinctColor('number'));
  }
);

void t.test('lisp: control forms, setters, and list primitives', () => {
  const html = distinctHl(
    '(if (> 1 0) \'yes :no) (when t 1) (unless nil 2) (cond ((= 1 1) 1) (t 2)) (case x (1 :a)) (loop for i from 1 to 10 collect i) (do ((i 0 (1+ i))) ((= i 3))) (dolist (x l) x) (dotimes (i 3) i) (progn 1 2) (block b (return-from b 1)) (return 1) (setq x 1) (setf (car l) 2) (push 1 l) (pop l) (incf x) (mapcar #\'car l) (funcall f 1) (apply f l) (format t "~a~%" x) (print x) (cons 1 2) (length l) (append a b) (eq a b) (null x) (not x) (and a b) (or a b) (error "e") (handler-case (f) (error (e) e)) (assert t) (throw \'tag 1) (catch \'tag 2) (unwind-protect 1 2)'
  );
  for (const word of [
    'if',
    'when',
    'unless',
    'cond',
    'case',
    'loop',
    'do',
    'dolist',
    'dotimes',
    'progn',
    'block',
    'return-from',
    'return',
    'setq',
    'setf',
    'and',
    'or',
    'error',
    'handler-case',
    'assert',
    'throw',
    'catch',
    'unwind-protect',
  ]) {
    assert.equal(wordColor(html, word), distinctColor('keyword'), word);
  }
  for (const fn of [
    '>',
    '=',
    '1+',
    'car',
    'push',
    'pop',
    'incf',
    'mapcar',
    'funcall',
    'apply',
    'format',
    'print',
    'cons',
    'length',
    'append',
    'eq',
    'null',
    'not',
  ]) {
    assert.equal(wordColor(html, fn), distinctColor('function'), fn);
  }
  for (const sp of ["'", "#'"]) {
    assert.equal(
      exactColor(html, sp),
      distinctColor('punctuation.special'),
      sp
    );
  }
  for (const c of ['t', 'nil']) {
    assert.equal(wordColor(html, c), distinctColor('constant.builtin'), c);
  }
  for (const sym of [':no', ':a']) {
    assert.equal(
      exactColor(html, sym),
      distinctColor('string.special.symbol'),
      sym
    );
  }
  assert.equal(exactColor(html, '"~a~%"'), distinctColor('string'));
});

void t.test('lisp: literal forms', () => {
  const html = distinctHl(
    '(list 42 -1 1.5 1e3 #x1F #b101 #o17 1/2 "str\\"esc" #\\a #\\Space \'sym :key #(1 2) #+sbcl 1 #-sbcl 2 pi *standard-output*)'
  );
  for (const n of ['42', '-1', '1.5', '1e3', '#x1F', '#b101', '#o17', '1/2']) {
    assert.equal(wordColor(html, n), distinctColor('number'), n);
  }
  assert.equal(exactColor(html, '"str'), distinctColor('string'));
  assert.equal(exactColor(html, '\\"'), distinctColor('string.escape'));
  for (const ch of ['#\\a', '#\\Space']) {
    assert.equal(wordColor(html, ch), distinctColor('string.special'), ch);
  }
  assert.equal(
    exactColor(html, ':key'),
    distinctColor('string.special.symbol')
  );
  assert.equal(exactColor(html, '#'), distinctColor('punctuation.special'));
  for (const pre of ['#+sbcl', '#-sbcl']) {
    assert.equal(exactColor(html, pre), distinctColor('preproc'), pre);
  }
  assert.equal(
    exactColor(html, '*standard-output*'),
    distinctColor('variable.special')
  );
  assert.equal(exactColor(html, 'pi'), distinctColor('variable'));
});

void t.test('lisp: block comments and multi-line forms stream line-fed', () => {
  assertLineFedParity(
    'lisp',
    '#| a\n b |#\n(defun f (x)\n  "doc\n string"\n  (+ x 1))\n'
  );
});
