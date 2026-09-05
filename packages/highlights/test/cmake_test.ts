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
  lexer = loadLang('cmake', '$hlCmake');
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinctTheme });

void t.test('cmake: commands, variables, conditions, and flow control', () => {
  assert.deepEqual(
    tokenKinds(
      'cmake',
      'set(CMAKE_CXX_STANDARD 17)\noption(DEMO_TESTS "Build tests" ON)\nif(DEMO_TESTS AND NOT WIN32 OR "${CMAKE_BUILD_TYPE}" STREQUAL "Debug")\n  add_subdirectory(tests)\nendif()\n'
    ),
    [
      ['set', 'function'],
      ['(', 'punctuation.bracket'],
      ['CMAKE_CXX_STANDARD', 'variable'],
      ['17', 'number'],
      [')', 'punctuation.bracket'],
      ['option', 'function'],
      ['(', 'punctuation.bracket'],
      ['DEMO_TESTS', 'variable'],
      ['"Build tests"', 'string'],
      ['ON', 'boolean'],
      [')', 'punctuation.bracket'],
      ['if', 'keyword.control'],
      ['(', 'punctuation.bracket'],
      ['DEMO_TESTS', 'constant'],
      ['AND NOT', 'keyword.operator'],
      ['WIN32', 'constant'],
      ['OR', 'keyword.operator'],
      ['"', 'string'],
      ['${CMAKE_BUILD_TYPE}', 'variable'],
      ['"', 'string'],
      ['STREQUAL', 'keyword.operator'],
      ['"Debug"', 'string'],
      [')', 'punctuation.bracket'],
      ['add_subdirectory', 'keyword.import'],
      ['(', 'punctuation.bracket'],
      ['tests', null],
      [')', 'punctuation.bracket'],
      ['endif', 'keyword.control'],
      ['()', 'punctuation.bracket'],
    ]
  );
});

void t.test('cmake: command names are case-insensitive', () => {
  assert.deepEqual(tokenKinds('cmake', 'IF(TRUE)\nENDIF()\nSET(x 1)\n'), [
    ['IF', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['TRUE', 'boolean'],
    [')', 'punctuation.bracket'],
    ['ENDIF', 'keyword.control'],
    ['()', 'punctuation.bracket'],
    ['SET', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
  ]);
});

void t.test(
  'cmake: strings, references, generator expressions, and brackets',
  () => {
    const html = distinctHl(
      '#[[ a bracket\n comment ]]\nmessage(STATUS "Hi ${X} \\"q\\" $ENV{HOME}")\ntarget_link_libraries(demo PRIVATE Qt5::Core $<$<CONFIG:Debug>:dbg>)\nset(DOC [=[raw ]] text]=])\nproject(Demo VERSION 1.2.3)\nlist(APPEND ALL "${f};x") # tail\n'
    );
    assert.equal(
      exactColor(html, '#[[ a bracket\n comment ]]'),
      distinctColor('comment')
    );
    assert.equal(exactColor(html, 'message'), distinctColor('function'));
    assert.equal(exactColor(html, 'STATUS'), distinctColor('constant'));
    assert.equal(exactColor(html, '"Hi'), distinctColor('string'));
    assert.equal(exactColor(html, '${X}'), distinctColor('variable'));
    assert.equal(exactColor(html, '\\"'), distinctColor('string.escape'));
    assert.equal(exactColor(html, '$ENV{HOME}'), distinctColor('variable'));
    assert.equal(exactColor(html, 'demo'), undefined);
    assert.equal(exactColor(html, 'PRIVATE'), distinctColor('constant'));
    assert.equal(exactColor(html, 'Qt5::Core'), undefined);
    assert.equal(
      exactColor(html, '$<$<CONFIG:Debug>:dbg>'),
      distinctColor('string.special')
    );
    assert.equal(
      exactColor(html, '[=[raw ]] text]=]'),
      distinctColor('string')
    );
    assert.equal(exactColor(html, 'VERSION'), distinctColor('constant'));
    assert.equal(exactColor(html, '1.2.3'), distinctColor('number'));
    assert.equal(exactColor(html, '${f}'), distinctColor('variable'));
    assert.equal(exactColor(html, ';x"'), distinctColor('string'));
    assert.equal(exactColor(html, '# tail'), distinctColor('comment'));
    assert.equal(wordColor(html, 'APPEND'), distinctColor('constant'));
  }
);

void t.test('cmake: operators apply only inside conditions', () => {
  const html = distinctHl(
    'add_custom_command(TARGET app COMMAND echo NOT)\nwhile(NOT DONE)\nendwhile()\n'
  );
  assert.equal(exactColor(html, 'TARGET'), distinctColor('constant'));
  assert.equal(wordColor(html, 'COMMAND'), distinctColor('constant'));
  assert.equal(
    spansOf(html).filter((s) => s.text.trim() === 'NOT')[1]?.color,
    distinctColor('keyword.operator')
  );
});

void t.test('cmake: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '#',
    '#[[',
    '#[==[ open',
    '[[',
    '[=[',
    '[=[x]]',
    '"',
    '"${',
    '${',
    '$ENV{',
    '$<',
    '$',
    '(',
    ')',
    ';',
    'if(',
    'set(',
    'NOT',
    'é 日本語',
    '3.',
    '1.2.3.4',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('cmake: split ranges bound every lookahead', () => {
  const src =
    'if(A AND "${B}" STREQUAL [[c]]) # x\n  set(V $<TARGET_FILE:app> 1.2)\nendif()';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('cmake', '$hlCmake', split).hl, src);
  }
});

void t.test(
  'cmake: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x73,
      0x65,
      0x74,
      0x28,
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

void t.test('cmake: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x3c7a11;
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

void t.test('cmake: multi-line constructs stream line-fed', () => {
  for (const code of [
    'set(X "multi\n${Y} line")\nmessage(${X})\n',
    '#[[ block\ncomment ]]\nset(A 1)\n',
    'set(DOC [==[raw\n]] text]==])\nset(B 2)\n',
    'if(A\n  AND B)\nendif()\n',
  ]) {
    assertLineFedParity('cmake', code);
  }
});
