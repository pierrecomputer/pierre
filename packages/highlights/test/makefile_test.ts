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
  wordColor,
} from './util';

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('makefile', '$hlMakefile');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test('makefile: assignments, rules, and recipes', () => {
  assert.deepEqual(
    tokenKinds(
      'makefile',
      'CC := gcc\nCFLAGS ?= -O2 $(EXTRA)\n.PHONY: all\nall: app | dirs\n\t@echo "link $@" && $(CC) -o $@ $^\n'
    ),
    [
      ['CC', 'variable'],
      [':=', 'operator'],
      ['gcc', null],
      ['CFLAGS', 'variable'],
      ['?=', 'operator'],
      ['-O2', null],
      ['$(', 'punctuation.special'],
      ['EXTRA', 'variable'],
      [')', 'punctuation.special'],
      ['.PHONY', 'keyword'],
      [':', 'punctuation.delimiter'],
      ['all', null],
      ['all', 'function'],
      [':', 'punctuation.delimiter'],
      ['app', null],
      ['|', 'operator'],
      ['dirs', null],
      ['@', 'operator'],
      ['echo', 'function'],
      ['"link', 'string'],
      ['$@', 'variable.special'],
      ['"', 'string'],
      ['&&', 'operator'],
      ['$(', 'punctuation.special'],
      ['CC', 'variable'],
      [')', 'punctuation.special'],
      ['-o', null],
      ['$@ $^', 'variable.special'],
    ]
  );
});

void t.test(
  'makefile: directives, functions, continuations, and define bodies',
  () => {
    const html = distinctHl(
      '# note\nSRCS = a.c \\\n  b.c\nOBJS = $(patsubst %.c,%.o,$(SRCS))\nifeq ($(OS),Windows_NT)\n  RM = del\nelse\n  RM = rm -f\nendif\ndefine helper\n\t@echo $(1)\nendef\ninclude common.mk\nexport VERBOSE\n%.o: %.c\n\t$(CC) -c $< -o $@ ; cd $$HOME\n'
    );
    assert.equal(exactColor(html, '# note'), distinctColor('comment'));
    assert.equal(exactColor(html, 'SRCS'), distinctColor('variable'));
    assert.equal(exactColor(html, '\\'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, 'b.c'), undefined);
    assert.equal(exactColor(html, 'patsubst'), distinctColor('function'));
    assert.equal(exactColor(html, ','), distinctColor('punctuation.delimiter'));
    assert.equal(exactColor(html, 'ifeq'), distinctColor('keyword.control'));
    assert.equal(exactColor(html, 'else'), distinctColor('keyword.control'));
    assert.equal(exactColor(html, 'endif'), distinctColor('keyword.control'));
    assert.equal(exactColor(html, 'RM'), distinctColor('variable'));
    assert.equal(exactColor(html, 'define'), distinctColor('keyword'));
    assert.equal(exactColor(html, 'helper'), distinctColor('variable'));
    assert.equal(exactColor(html, 'endef'), distinctColor('keyword'));
    assert.equal(exactColor(html, 'include'), distinctColor('keyword.import'));
    assert.equal(exactColor(html, 'common.mk'), undefined);
    assert.equal(exactColor(html, 'export'), distinctColor('keyword'));
    assert.equal(exactColor(html, 'VERBOSE'), distinctColor('variable'));
    assert.equal(exactColor(html, '%.o'), distinctColor('function'));
    assert.equal(exactColor(html, '$<'), distinctColor('variable.special'));
    assert.equal(exactColor(html, ';'), distinctColor('operator'));
    assert.equal(exactColor(html, 'cd'), distinctColor('function'));
    assert.equal(exactColor(html, '$$HOME'), distinctColor('variable'));
    assert.equal(wordColor(html, '1'), distinctColor('variable'));
  }
);

void t.test('makefile: automatic variables and nested references', () => {
  assert.deepEqual(
    tokenKinds(
      'makefile',
      'out: in\n\tcp $(@D)/$(<F) $(shell echo $(addprefix x,$(V)))\n'
    ),
    [
      ['out', 'function'],
      [':', 'punctuation.delimiter'],
      ['in', null],
      ['cp', 'function'],
      ['$(', 'punctuation.special'],
      ['@D', 'variable.special'],
      [')', 'punctuation.special'],
      ['/', null],
      ['$(', 'punctuation.special'],
      ['<F', 'variable.special'],
      [') $(', 'punctuation.special'],
      ['shell', 'function'],
      ['echo', null],
      ['$(', 'punctuation.special'],
      ['addprefix', 'function'],
      ['x', null],
      [',', 'punctuation.delimiter'],
      ['$(', 'punctuation.special'],
      ['V', 'variable'],
      [')))', 'punctuation.special'],
    ]
  );
});

void t.test('makefile: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '$',
    '$(',
    '${',
    '$(x',
    '$$',
    '\\',
    '\\\n',
    ':',
    '=',
    ':=',
    '\t',
    '\t$(',
    'a:\n\t"',
    "a:\n\t'",
    'define',
    'define x',
    'endef',
    'ifeq',
    'é 日本語',
    '.',
    '%',
    'a: b ;',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('makefile: split ranges bound every lookahead', () => {
  const src =
    'V := $(subst a,b,$(X)) \\\n  c # z\nt: $(V) | d\n\t@$(CC) "$@" $$x ; ls\n';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('makefile', '$hlMakefile', split).hl, src);
  }
});

void t.test(
  'makefile: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x61,
      0x3a,
      0x0a,
      0x09,
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

void t.test('makefile: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x1b3d77;
  const alphabet = 'abcXYZ09_ /\\"\'\n\t{}[]().,:;+-*=!<>&|#$@%~?é';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('makefile: multi-line constructs stream line-fed', () => {
  for (const code of [
    'SRCS = a.c \\\n       b.c\nall: $(SRCS)\n\t$(CC) -o $@ \\\n\t  $^\n',
    'define M\n\techo $(1)\nendef\nx = 1\n',
    'a: b\n\techo "x\n\tls\n',
    'ifeq (a,b)\n  X = 1\nelse\n  X = 2\nendif\n',
  ]) {
    assertLineFedParity('makefile', code);
  }
});
