import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('cadence: declarations, access modifiers, and resources', () => {
  expect(
    tokenKinds('cadence', 'access(all) resource Vault: FungibleToken.Vault {')
  ).toEqual([
    ['access', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['all', 'keyword'],
    [')', 'punctuation.bracket'],
    ['resource', 'keyword.declaration'],
    ['Vault', 'type'],
    [':', 'punctuation.delimiter'],
    ['FungibleToken', 'type'],
    ['.', 'punctuation.delimiter'],
    ['Vault', 'type'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'cadence',
      'access(all) event Deposit(amount: UFix64, to: Address?)'
    )
  ).toEqual([
    ['access', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['all', 'keyword'],
    [')', 'punctuation.bracket'],
    ['event', 'keyword.declaration'],
    ['Deposit', 'type'],
    ['(', 'punctuation.bracket'],
    ['amount', 'variable'],
    [':', 'punctuation.delimiter'],
    ['UFix64', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['to', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Address', 'type.builtin'],
    ['?', 'operator'],
    [')', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'cadence',
      'access(all) fun deposit(from: @{FungibleToken.Vault}) {'
    )
  ).toEqual([
    ['access', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['all', 'keyword'],
    [')', 'punctuation.bracket'],
    ['fun', 'keyword.declaration'],
    ['deposit', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['from', 'variable'],
    [':', 'punctuation.delimiter'],
    ['@', 'operator'],
    ['{', 'punctuation.bracket'],
    ['FungibleToken', 'type'],
    ['.', 'punctuation.delimiter'],
    ['Vault', 'type'],
    ['}) {', 'punctuation.bracket'],
  ]);
});

test('cadence: imports and soft keywords used as labels', () => {
  expect(
    tokenKinds('cadence', 'import FungibleToken from 0xf233dcee88fe0abe')
  ).toEqual([
    ['import', 'keyword.import'],
    ['FungibleToken', 'type'],
    ['from', 'keyword.import'],
    ['0xf233dcee88fe0abe', 'number'],
  ]);
  expect(
    tokenKinds(
      'cadence',
      'let v <- vault.withdraw(amount: 1.0) as! @Vault\nfrom.balance'
    )
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['v', 'variable'],
    ['<-', 'operator'],
    ['vault', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['withdraw', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['amount', 'variable'],
    [':', 'punctuation.delimiter'],
    ['1.0', 'number'],
    [')', 'punctuation.bracket'],
    ['as', 'keyword.operator'],
    ['! @', 'operator'],
    ['Vault', 'type'],
    ['from', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['balance', 'property'],
  ]);
  assertLineFedParity(
    'cadence',
    'let v <- vault.withdraw(amount: 1.0) as! @Vault\nfrom.balance'
  );
  expect(
    tokenKinds('cadence', 'acct.storage.borrow<&Vault>(from: /storage/vault)')
  ).toEqual([
    ['acct', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['storage', 'property'],
    ['.', 'punctuation.delimiter'],
    ['borrow', 'function.method'],
    ['<&', 'operator'],
    ['Vault', 'type'],
    ['>', 'operator'],
    ['(', 'punctuation.bracket'],
    ['from', 'variable'],
    [':', 'punctuation.delimiter'],
    ['/storage/vault', 'string.special'],
    [')', 'punctuation.bracket'],
  ]);
});

test('cadence: string templates and escapes', () => {
  expect(tokenKinds('cadence', 'log("sum \\(a + f(b)) done\\n")')).toEqual([
    ['log', 'function'],
    ['(', 'punctuation.bracket'],
    ['"sum', 'string'],
    ['\\(', 'punctuation.special'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['b', 'variable'],
    [')', 'punctuation.bracket'],
    [')', 'punctuation.special'],
    ['done', 'string'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('cadence', 'let s = "inner \\(g("x \\(y)")) end"')).toEqual(
    [
      ['let', 'keyword.declaration'],
      ['s', 'variable'],
      ['=', 'operator'],
      ['"inner', 'string'],
      ['\\(', 'punctuation.special'],
      ['g', 'function'],
      ['(', 'punctuation.bracket'],
      ['"x', 'string'],
      ['\\(', 'string.escape'],
      ['y)"', 'string'],
      [')', 'punctuation.bracket'],
      [')', 'punctuation.special'],
      ['end"', 'string'],
    ]
  );
});

test('cadence: transactions, conditions, and comments', () => {
  expect(
    tokenKinds(
      'cadence',
      'transaction(amount: UFix64) {\n  prepare(signer: auth(Storage) &Account) {}\n  pre { amount > 0.0: "positive" }\n  execute { emit Done() }\n}'
    )
  ).toEqual([
    ['transaction', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['amount', 'variable'],
    [':', 'punctuation.delimiter'],
    ['UFix64', 'type.builtin'],
    [') {', 'punctuation.bracket'],
    ['prepare', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['signer', 'variable'],
    [':', 'punctuation.delimiter'],
    ['auth', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['Storage', 'type'],
    [')', 'punctuation.bracket'],
    ['&', 'operator'],
    ['Account', 'type'],
    [') {}', 'punctuation.bracket'],
    ['pre', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['amount', 'variable'],
    ['>', 'operator'],
    ['0.0', 'number'],
    [':', 'punctuation.delimiter'],
    ['"positive"', 'string'],
    ['}', 'punctuation.bracket'],
    ['execute', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['emit', 'keyword.control'],
    ['Done', 'function'],
    ['() }', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity(
    'cadence',
    'transaction(amount: UFix64) {\n  prepare(signer: auth(Storage) &Account) {}\n  pre { amount > 0.0: "positive" }\n  execute { emit Done() }\n}'
  );
  expect(
    tokenKinds(
      'cadence',
      '/* a /* nested */\n still */ let x = nil // end\n/// doc\n#allowAccountLinking'
    )
  ).toEqual([
    ['/* a /* nested */', 'comment'],
    ['still */', 'comment'],
    ['let', 'keyword.declaration'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['nil', 'constant.builtin'],
    ['// end', 'comment'],
    ['/// doc', 'comment.doc'],
    ['#allowAccountLinking', 'preproc'],
  ]);
  assertLineFedParity(
    'cadence',
    '/* a /* nested */\n still */ let x = nil // end\n/// doc\n#allowAccountLinking'
  );
  expect(
    tokenKinds(
      'cadence',
      'let p = /public/receiver; let q = a / b; let r = self.x'
    )
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['p', 'variable'],
    ['=', 'operator'],
    ['/public/receiver', 'string.special'],
    [';', 'punctuation.delimiter'],
    ['let', 'keyword.declaration'],
    ['q', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['/', 'operator'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['let', 'keyword.declaration'],
    ['r', 'variable'],
    ['=', 'operator'],
    ['self', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
  ]);
});

test('cadence: from is a keyword only before an import source', () => {
  const code = 'import A from 0x1\nlet v <- from as! @Vault\n';
  expect(tokenKinds('cadence', code)).toEqual([
    ['import', 'keyword.import'],
    ['A', 'type'],
    ['from', 'keyword.import'],
    ['0x1', 'number'],
    ['let', 'keyword.declaration'],
    ['v', 'variable'],
    ['<-', 'operator'],
    ['from', 'variable'],
    ['as', 'keyword.operator'],
    ['! @', 'operator'],
    ['Vault', 'type'],
  ]);
});

test('cadence: braced unicode escapes', () => {
  const code = 'let s = "\\u{1F600}"';
  expect(tokenKinds('cadence', code)).toEqual([
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"', 'string'],
    ['\\u{1F600}', 'string.escape'],
    ['"', 'string'],
  ]);
});
