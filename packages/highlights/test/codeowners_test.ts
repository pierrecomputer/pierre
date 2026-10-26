import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('codeowners: paths, owners, emails, and comments', () => {
  expect(
    tokenKinds(
      'codeowners',
      '# owners\n*.js    @js-owner @org/team # inline\n/docs/ docs@example.com\n  apps/**  @λ\n'
    )
  ).toEqual([
    ['# owners', 'comment'],
    ['*.js', 'string.special'],
    ['@js-owner @org/team', 'attribute'],
    ['# inline', 'comment'],
    ['/docs/', 'string.special'],
    ['docs@example.com', 'attribute'],
    ['apps/**', 'string.special'],
    ['@λ', 'attribute'],
  ]);
});

test('codeowners: escaped `#` and blanks stay in the path', () => {
  expect(
    tokenKinds('codeowners', '\\#notes.md @a\nmy\\ dir/x\\\n@b\n')
  ).toEqual([
    ['\\#', 'string.escape'],
    ['notes.md', 'string.special'],
    ['@a', 'attribute'],
    ['my', 'string.special'],
    ['\\', 'string.escape'],
    ['dir/x\\', 'string.special'],
    // a backslash never joins lines: `@b` starts a new rule
    ['@b', 'string.special'],
  ]);
});

test('codeowners: GitLab sections, approvals, and exclusions', () => {
  const code =
    '[Docs] @docs\n^[Optional Section][2] @lead\n!/docs/internal/\n[open';
  expect(tokenKinds('codeowners', code)).toEqual([
    ['[', 'punctuation.bracket'],
    ['Docs', 'type'],
    [']', 'punctuation.bracket'],
    ['@docs', 'attribute'],
    ['^', 'operator'],
    ['[', 'punctuation.bracket'],
    ['Optional Section', 'type'],
    ['][', 'punctuation.bracket'],
    ['2', 'number'],
    [']', 'punctuation.bracket'],
    ['@lead', 'attribute'],
    ['!', 'operator'],
    ['/docs/internal/', 'string.special'],
    ['[', 'punctuation.bracket'],
    ['open', 'type'],
  ]);
  assertLineFedParity('codeowners', code);
});
