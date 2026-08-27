import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let lua;
t.before(() => (lua = loadLang('lua', '$hlLua')));

const DECL = themeColor('keyword.declaration');
const FUNCTION = themeColor('function.definition');
const CONTROL = themeColor('keyword.control');
const STRING = themeColor('string');
const COMMENT = themeColor('comment');
const NUMBER = themeColor('number');
const VARIABLE = themeColor('variable');

t.test('lua: functions, control flow, calls, strings, and numbers', () => {
  const src =
    'local function greet(name)\n  if name then print("hi", 42) elseif false then return end\nend';
  const html = checkInvariants(lua.hl, src);
  assert.equal(colorOf(html, 'function'), DECL);
  assert.equal(colorOf(html, 'greet'), FUNCTION);
  assert.equal(colorOf(html, 'if'), CONTROL);
  assert.equal(colorOf(html, 'elseif'), CONTROL);
  assert.equal(colorOf(html, '"hi"'), STRING);
  assert.equal(colorOf(html, '42'), NUMBER);
});

t.test('lua: line comments and long bracket strings/comments', () => {
  const src = '-- line\n--[=[ long\ncomment ]=]\nlocal s = [==[text\nbody]==]';
  const html = checkInvariants(lua.hl, src);
  assert.equal(colorOf(html, '-- line'), COMMENT);
  assert.equal(colorOf(html, '--[=[ long'), COMMENT);
  assert.equal(colorOf(html, '[==[text'), STRING);
});

t.test(
  'lua: concatenation, varargs, and anonymous functions reset context',
  () => {
    const src =
      'local joined = left .. right\nlocal f = function(argument) return ... end\nlocal fraction = .5';
    const html = checkInvariants(lua.hl, src);
    assert.equal(colorOf(html, 'right'), VARIABLE);
    assert.equal(colorOf(html, 'argument'), VARIABLE);
    assert.equal(colorOf(html, '.5'), NUMBER);
  }
);

t.test('lua: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    '--[[',
    '[=[',
    "'",
    'function',
    'é_日本語',
    '0x',
    '::label::',
  ])
    checkInvariants(lua.hl, src);
  const split = loadLang('lua', '$hlLua', 6);
  checkInvariants(split.hl, 'local x = [=[a]=]\n');
});
