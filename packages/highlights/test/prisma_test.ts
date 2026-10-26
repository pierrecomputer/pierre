import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('prisma: model fields read name, type, modifiers, then attributes', () => {
  expect(
    tokenKinds(
      'prisma',
      'model Post {\n  id Int @id\n  tags String[] @db.Text\n  author User? @relation(fields: [authorId], references: [id])\n}'
    )
  ).toEqual([
    ['model', 'keyword.declaration'],
    ['Post', 'type'],
    ['{', 'punctuation.bracket'],
    ['id', 'property'],
    ['Int', 'type.builtin'],
    ['@id', 'attribute'],
    ['tags', 'property'],
    ['String', 'type.builtin'],
    ['[]', 'punctuation.bracket'],
    ['@db.Text', 'attribute'],
    ['author', 'property'],
    ['User', 'type'],
    ['?', 'operator'],
    ['@relation', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['fields', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['authorId', 'property'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['references', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['id', 'property'],
    ['])', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
  // a field may be named like a block keyword
  expect(tokenKinds('prisma', 'type Address {\n  type String\n}')).toEqual([
    ['type', 'keyword.declaration'],
    ['Address', 'type'],
    ['{', 'punctuation.bracket'],
    ['type', 'property'],
    ['String', 'type.builtin'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('prisma: defaults, functions, enums, block attributes, and settings', () => {
  const tokens = tokenKinds(
    'prisma',
    'model A {\n  n Float @default(-1.5)\n  on Boolean @default(true)\n  at DateTime @default(now())\n  r Role @default(USER)\n  @@index([n, on])\n}'
  );
  for (const [text, kind] of [
    ['-1.5', 'number'],
    ['true', 'boolean'],
    ['now', 'function'],
    ['USER', 'constant'],
    ['@@index', 'attribute'],
    ['on', 'property'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(
    tokenKinds(
      'prisma',
      'enum Role {\n  USER @map("u")\n}\ndatasource db {\n  url = env("URL\\n")\n}'
    )
  ).toEqual([
    ['enum', 'keyword.declaration'],
    ['Role', 'type'],
    ['{', 'punctuation.bracket'],
    ['USER', 'constant'],
    ['@map', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['"u"', 'string'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['datasource', 'keyword.declaration'],
    ['db', 'type'],
    ['{', 'punctuation.bracket'],
    ['url', 'property'],
    ['=', 'operator'],
    ['env', 'function'],
    ['(', 'punctuation.bracket'],
    ['"URL', 'string'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('prisma: doc comments, line comments, and block comments', () => {
  const code = '/// doc\n// note\n/* a\nb */ model A {}';
  expect(tokenKinds('prisma', code)).toEqual([
    ['/// doc', 'comment.doc'],
    ['// note', 'comment'],
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['model', 'keyword.declaration'],
    ['A', 'type'],
    ['{}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('prisma', code);
  assertLineFedParity(
    'prisma',
    'model A {\n  id Int\n  @@id([\n    id\n  ])\n}\n'
  );
});
