import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('solidity: contracts, declarations, and sized types', () => {
  const kinds = tokenKinds(
    'solidity',
    'contract Counter { uint256 count; bytes32 key; int8 delta; function increment() external { emit Changed(count); } }'
  );
  for (const expected of [
    ['Counter', 'type'],
    ['uint256', 'type.builtin'],
    ['bytes32', 'type.builtin'],
    ['int8', 'type.builtin'],
    ['increment', 'function.definition'],
    ['emit', 'keyword.control'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('solidity: built-ins, units, and prefixed strings', () => {
  const kinds = tokenKinds(
    'solidity',
    'require(msg.sender != address(0));\nuint value = 1 ether;\nstring text = unicode"héllo";\nbytes data = hex"00ff";'
  );
  for (const expected of [
    ['require', 'function'],
    ['msg', 'variable.special'],
    ['sender', 'property'],
    ['address', 'type.builtin'],
    ['ether', 'constant.builtin'],
    ['unicode"héllo"', 'string'],
    ['hex"00ff"', 'string'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('solidity: NatSpec comments and assembly', () => {
  const kinds = tokenKinds(
    'solidity',
    '/// @notice Read storage\n/** @dev Documentation */\nfunction load() pure { assembly { let value := sload(0) } }'
  );
  for (const expected of [
    ['/// @notice Read storage', 'comment.doc'],
    ['/** @dev Documentation */', 'comment.doc'],
    ['assembly', 'keyword'],
    ['let', 'keyword.declaration'],
    ['sload', 'function'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('solidity: multiline constructs match line-fed streaming', () => {
  for (const code of [
    '/** docs\nmore */\ncontract C {\nfunction\nf() external {}\n}\n',
    'string s = "one\\\ntwo";\nuint256 value = 0;\n',
  ]) {
    assertLineFedParity('solidity', code);
  }
});

test('solidity: every integer and fixed-byte width is recognized', () => {
  for (let width = 8; width <= 256; width += 8) {
    for (const prefix of ['int', 'uint']) {
      const word = `${prefix}${width}`;
      expect(tokenKinds('solidity', word)).toEqual([[word, 'type.builtin']]);
    }
  }
  for (let width = 1; width <= 32; width++) {
    const word = `bytes${width}`;
    expect(tokenKinds('solidity', word)).toEqual([[word, 'type.builtin']]);
  }
});

test('solidity: keyword and sized-type prefixes do not capture identifiers', () => {
  for (const word of [
    'constantValue',
    'requirement',
    'contractual',
    'uint256Balance',
    'bytes32Hash',
  ]) {
    expect(tokenKinds('solidity', word)).toEqual([[word, 'variable']]);
  }
  expect(tokenKinds('solidity', 'constant')).toEqual([['constant', 'keyword']]);
  expect(tokenKinds('solidity', 'require')).toEqual([['require', 'function']]);
});

test('solidity: invalid type widths remain ordinary identifiers', () => {
  for (const word of [
    'uint0',
    'uint1',
    'uint7',
    'uint9',
    'uint264',
    'uint2560',
    'uint08',
    'int0',
    'int7',
    'int257',
    'int999',
    'int0008',
    'bytes0',
    'bytes33',
    'bytes256',
    'bytes01',
    'bytes99999999999999999999',
  ]) {
    expect(tokenKinds('solidity', word)).toEqual([[word, 'variable']]);
  }
});

test('solidity: declaration names survive comments and line breaks', () => {
  for (const declaration of ['function', 'modifier', 'event', 'error']) {
    expect(tokenKinds('solidity', `${declaration} /* why */\n Named`)).toEqual([
      [declaration, 'keyword.declaration'],
      ['/* why */', 'comment'],
      ['Named', 'function.definition'],
    ]);
  }
});

test('solidity: member keywords are properties or methods', () => {
  expect(tokenKinds('solidity', 'obj.constant; obj.require();')).toEqual([
    ['obj', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['constant', 'property'],
    [';', 'punctuation.delimiter'],
    ['obj', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['require', 'function.method'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('solidity: string prefixes and comment markers stay in their literals', () => {
  for (const literal of [
    'hex"00_ff"',
    "hex'CAFE'",
    'unicode"λ😀 // /*"',
    '"/* contract */"',
  ]) {
    expect(tokenKinds('solidity', literal)).toEqual([[literal, 'string']]);
  }
  expect(tokenKinds('solidity', '/// @notice f\n/* plain */')).toEqual([
    ['/// @notice f', 'comment.doc'],
    ['/* plain */', 'comment'],
  ]);
});
