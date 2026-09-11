import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spanKinds,
  type TestLang,
  themeColor,
  tokenKinds,
} from './_util';

let asm: TestLang;
t.before(() => (asm = loadLang('asm', '$hlAsm')));

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(asm.hl, src, { theme: distinctTheme });

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

void t.test('asm: Intel and AT&T operand syntax token by token', () => {
  assert.deepEqual(spanKinds(hl('mov eax, DWORD PTR [rbx+4*rcx]')), [
    ['mov', 'keyword'],
    ['eax', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['DWORD PTR', 'variable'],
    ['[', 'punctuation.bracket'],
    ['rbx', 'variable.special'],
    ['+', 'operator'],
    ['4', 'number'],
    ['*', 'operator'],
    ['rcx', 'variable.special'],
    [']', 'punctuation.bracket'],
  ]);
  assert.deepEqual(spanKinds(hl('movq %rsp, %rbp')), [
    ['movq', 'keyword'],
    ['%rsp', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['%rbp', 'variable.special'],
  ]);
  assert.deepEqual(spanKinds(hl('lea rax, [rip + msg]')), [
    ['lea', 'keyword'],
    ['rax', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['rip', 'variable.special'],
    ['+', 'operator'],
    ['msg', 'variable'],
    [']', 'punctuation.bracket'],
  ]);
  // an ARM pre-indexed load: the `!` after the bracket is an operator
  assert.deepEqual(spanKinds(hl('ldr x0, [x1, #8]!')), [
    ['ldr', 'keyword'],
    ['x0', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['x1', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['#8', 'number'],
    [']', 'punctuation.bracket'],
    ['!', 'operator'],
  ]);
});

void t.test(
  'asm: every comment style, and # is a comment only without a number',
  () => {
    const src =
      '; semi\n# hash comment\n// slashes\n/* multi\nline */ nop\nadd r0, r1, #4 ; imm\nmov r2, #-4\nmov $8, %eax\nmov $var, %eax';
    assert.deepEqual(tokenKinds('asm', src).slice(0, 6), [
      ['; semi', 'comment'],
      ['# hash comment', 'comment'],
      ['// slashes', 'comment'],
      ['/* multi', 'comment'],
      ['line */', 'comment'],
      ['nop', 'keyword'],
    ]);
    const html = hl(src);
    assert.equal(exactColor(html, '#4'), distinctColor('number'));
    assert.equal(exactColor(html, '; imm'), distinctColor('comment'));
    assert.equal(exactColor(html, '#-4'), distinctColor('number'));
    assert.equal(exactColor(html, '$8'), distinctColor('number'));
    // an AT&T `$symbol` immediate reads as a register-like special name
    assert.equal(exactColor(html, '$var'), distinctColor('variable.special'));
  }
);

void t.test('asm: numeric literal forms', () => {
  const html = hl(
    'mov eax, 0x1F\nmov ebx, 0b101\nmov ecx, 1234\nmov esi, $0x10\nmov edi, #0xFF\nfld 1.5\nmov edx, -1'
  );
  for (const n of ['0x1F', '0b101', '1234', '$0x10', '#0xFF', '1.5', '1']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  // a bare minus before a digit is an operator, unlike the `#-4` immediate
  assert.equal(exactColor(html, '-'), distinctColor('operator'));
});

void t.test(
  'asm: directives, local labels, and labels with spaced colons',
  () => {
    assert.deepEqual(
      tokenKinds('asm', '.globl main\n.section .data\n.align 16'),
      [
        ['.globl', 'preproc'],
        ['main', 'variable'],
        ['.section .data', 'preproc'],
        ['.align', 'preproc'],
        ['16', 'number'],
      ]
    );
    const html = hl('.L1:\n.Lloop: jmp .Lloop\nlabel : nop\n.quad 0x10, -1');
    assert.equal(exactColor(html, '.L1'), distinctColor('label'));
    assert.equal(exactColor(html, '.Lloop'), distinctColor('label'));
    assert.equal(exactColor(html, 'jmp'), distinctColor('keyword'));
    assert.equal(exactColor(html, 'label'), distinctColor('label'));
    assert.equal(exactColor(html, 'nop'), distinctColor('keyword'));
    assert.equal(exactColor(html, '.quad'), distinctColor('preproc'));
    assert.equal(exactColor(html, '0x10'), distinctColor('number'));
  }
);

void t.test('asm: register families across x86, vector, and ARM names', () => {
  const html = hl(
    'mov rax, rbx\nmov r8, r15\nmov esi, edi\nmov ebp, esp\nmovaps xmm0, ymm1\nvaddps zmm31, zmm0\nmov w1, sp\nmov lr, pc\nadd fp, r0, r1\nmov foo, r\nmov x, xmm\nmov DWORD, msg'
  );
  for (const reg of [
    'rax',
    'rbx',
    'r8',
    'r15',
    'esi',
    'edi',
    'ebp',
    'esp',
    'xmm0',
    'ymm1',
    'zmm31',
    'zmm0',
    'w1',
    'sp',
    'lr',
    'pc',
    'fp',
    'r0',
    'r1',
  ]) {
    assert.equal(exactColor(html, reg), distinctColor('variable.special'), reg);
  }
  // register-like prefixes without a digit or a known suffix are symbols
  for (const sym of ['foo', 'r', 'x', 'xmm', 'DWORD', 'msg']) {
    assert.equal(exactColor(html, sym), distinctColor('variable'), sym);
  }
});

void t.test('asm: mnemonic position follows a label or a line start', () => {
  assert.deepEqual(
    tokenKinds(
      'asm',
      'loop: mov eax, 1\n  call puts\n  ret\nlabel : nop\n  jmp label'
    ),
    [
      ['loop', 'label'],
      [':', 'punctuation.delimiter'],
      ['mov', 'keyword'],
      ['eax', 'variable.special'],
      [',', 'punctuation.delimiter'],
      ['1', 'number'],
      ['call', 'keyword'],
      ['puts', 'variable'],
      ['ret', 'keyword'],
      ['label', 'label'],
      [':', 'punctuation.delimiter'],
      ['nop', 'keyword'],
      ['jmp', 'keyword'],
      ['label', 'variable'],
    ]
  );
  // a mnemonic after operands on the same line is an operand, not a keyword
  assert.deepEqual(spanKinds(hl('mov eax, mov')).at(-1), ['mov', 'variable']);
});

void t.test('asm: strings, characters, and escapes', () => {
  assert.deepEqual(
    tokenKinds('asm', '.asciz "a\\n"\n.byte \'c\'\n.ascii "unterminated'),
    [
      ['.asciz', 'preproc'],
      ['"a', 'string'],
      ['\\n', 'string.escape'],
      ['"', 'string'],
      ['.byte', 'preproc'],
      ["'c'", 'string'],
      ['.ascii', 'preproc'],
      ['"unterminated', 'string'],
    ]
  );
});

void t.test('asm: block comments and labels stream line-fed', () => {
  assertLineFedParity(
    'asm',
    'start:\n  /* open\n  still\n  */ mov eax, 1\n  ; done\n.data\nmsg: .asciz "x"\n'
  );
  assertLineFedParity('asm', 'mov eax, 1 /* cut\nhere */\nret\n');
});

void t.test('asm: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    '.',
    '%',
    '$',
    '#',
    '# comment',
    'label:',
    ':',
    'mov [rax',
    'é:\n  nop',
    "'unterminated",
    '/* unterminated',
    '#-',
    '$+',
  ]) {
    checkInvariants(asm.hl, src);
  }
  const split = loadLang('asm', '$hlAsm', 5);
  checkInvariants(split.hl, 'main:\n mov r0, r1\n');
});
