import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('verilog: sized, based, and unbased literals versus casts', () => {
  expect(
    tokenKinds(
      'verilog',
      "x = 8'hFF + 4'b10x1 + '0 + 1'bz + 32'sd10 + 'hDEAD_beef + 1.5e3 + 10ns;"
    )
  ).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ["8'hFF", 'number'],
    ['+', 'operator'],
    ["4'b10x1", 'number'],
    ['+', 'operator'],
    ["'0", 'number'],
    ['+', 'operator'],
    ["1'bz", 'number'],
    ['+', 'operator'],
    ["32'sd10", 'number'],
    ['+', 'operator'],
    ["'hDEAD_beef", 'number'],
    ['+', 'operator'],
    ['1.5e3', 'number'],
    ['+', 'operator'],
    ['10ns', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  // a tick before anything else is a cast or an assignment pattern
  expect(tokenKinds('verilog', "y = int'(z) + '{1};")).toEqual([
    ['y', 'variable'],
    ['=', 'operator'],
    ['int', 'type.builtin'],
    ["'", 'operator'],
    ['(', 'punctuation.bracket'],
    ['z', 'variable'],
    [')', 'punctuation.bracket'],
    ["+ '", 'operator'],
    ['{', 'punctuation.bracket'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('verilog: directives, macros, system tasks, and delays', () => {
  expect(
    tokenKinds(
      'verilog',
      '`define WIDTH 8\n`ifdef SIM\ninitial #10 $display("w=%0d\\n", `WIDTH);\n`endif'
    )
  ).toEqual([
    ['`define', 'preproc'],
    ['WIDTH', 'constant'],
    ['8', 'number'],
    ['`ifdef', 'preproc'],
    ['SIM', 'constant'],
    ['initial', 'keyword'],
    ['#', 'operator'],
    ['10', 'number'],
    ['$display', 'function'],
    ['(', 'punctuation.bracket'],
    ['"w=%0d', 'string'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    [',', 'punctuation.delimiter'],
    ['`WIDTH', 'preproc'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['`endif', 'preproc'],
  ]);
});

test('verilog: declarations, user types, and instance ports', () => {
  const tokens = tokenKinds(
    'verilog',
    [
      'module top #(parameter WIDTH = 8) (input logic clk, inout wire d);',
      '  pkg::cfg_t cfg;',
      '  counter #(.W(4)) u0 (.clk(clk));',
      '  always_ff @(posedge clk or negedge rst) q <= obj.get() + obj.len;',
      '  function automatic logic [7:0] add(input int a);',
      '  endfunction',
      'endmodule',
      'class Packet extends Base;',
      'endclass',
    ].join('\n')
  );
  for (const [text, kind] of [
    ['module', 'keyword.declaration'],
    ['top', 'type'],
    ['parameter', 'keyword.declaration'],
    ['WIDTH', 'constant'],
    ['input', 'keyword.declaration'],
    ['logic', 'type.builtin'],
    ['inout', 'keyword.declaration'],
    ['pkg', 'namespace'],
    ['cfg_t', 'type'],
    ['cfg', 'variable'],
    ['counter', 'type'],
    ['u0', 'variable'],
    ['clk', 'property'],
    ['always_ff', 'keyword'],
    ['or negedge', 'keyword'],
    ['rst', 'variable'],
    ['get', 'function.method'],
    ['len', 'property'],
    ['add', 'function.definition'],
    ['endfunction', 'keyword.declaration'],
    ['Packet', 'type'],
    ['extends', 'keyword.declaration'],
    ['Base', 'type'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('verilog: block comments and continued strings stream by line', () => {
  const code = '/* a\n   b */ wire w;\nassign s = "one \\\ntwo";\n';
  expect(tokenKinds('verilog', code)).toEqual([
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['wire', 'type.builtin'],
    ['w', 'variable'],
    [';', 'punctuation.delimiter'],
    ['assign', 'keyword'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"one', 'string'],
    ['\\', 'string.escape'],
    ['two"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('verilog', code);
});
