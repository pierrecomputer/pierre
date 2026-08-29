import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let asm;
t.before(() => (asm = loadLang('asm', '$hlAsm')));

const LABEL = themeColor('label');
const KEYWORD = themeColor('keyword');
const REGISTER = themeColor('variable.special');
const NUMBER = themeColor('number');
const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');

void t.test(
  'asm: labels, instructions, registers, immediates, and comments',
  () => {
    const src =
      '.text\nmain:\n  mov %rax, %rbx\n  add r0, r1, #4\n  sub r0, r1, #-4\n  mov $-8, %rax ; tail\n';
    const html = checkInvariants(asm.hl, src);
    assert.equal(colorOf(html, '.text'), PREPROC);
    assert.equal(colorOf(html, 'main'), LABEL);
    assert.equal(colorOf(html, 'mov'), KEYWORD);
    assert.equal(colorOf(html, '%rax'), REGISTER);
    assert.equal(colorOf(html, 'r0'), REGISTER);
    assert.equal(colorOf(html, '#4'), NUMBER);
    assert.equal(colorOf(html, '#-4'), NUMBER);
    assert.equal(colorOf(html, '$-8'), NUMBER);
    assert.equal(colorOf(html, '; tail'), COMMENT);
  }
);

void t.test('asm: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    '.',
    '%',
    '# comment',
    'label:',
    'mov [rax',
    'é:\n  nop',
    "'unterminated",
  ]) {
    checkInvariants(asm.hl, src);
  }
  const split = loadLang('asm', '$hlAsm', 5);
  checkInvariants(split.hl, 'main:\n mov r0, r1\n');
});
