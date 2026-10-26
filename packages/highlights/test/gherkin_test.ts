import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('gherkin: tags, sections with titles, and steps', () => {
  expect(
    tokenKinds(
      'gherkin',
      "@wip @issue-12\nFeature: Login\n  Background:\n    Given I am on \"/login\"\n  Scenario Template: Sign in as <role>\n    * I type 'secret'\n    And I wait 2.5 seconds\n    Then I don't see errors"
    )
  ).toEqual([
    ['@wip @issue-12', 'attribute'],
    ['Feature:', 'keyword.declaration'],
    ['Login', 'title'],
    ['Background:', 'keyword.declaration'],
    ['Given', 'keyword'],
    ['I am on', null],
    ['"/login"', 'string'],
    ['Scenario Template:', 'keyword.declaration'],
    ['Sign in as <role>', 'title'],
    ['*', 'keyword'],
    ['I type', null],
    ["'secret'", 'string'],
    ['And', 'keyword'],
    ['I wait', null],
    ['2.5', 'number'],
    ['seconds', null],
    ['Then', 'keyword'],
    ["I don't see errors", null],
  ]);
  // keywords count only at the start of a line, before `:` or a blank
  expect(tokenKinds('gherkin', 'Feature\nGivenAway it\nI said Given')).toEqual([
    ['Feature', null],
    ['GivenAway it', null],
    ['I said Given', null],
  ]);
  expect(tokenKinds('gherkin', 'Scenario Outline: x')).toEqual([
    ['Scenario Outline:', 'keyword.declaration'],
    ['x', 'title'],
  ]);
});

test('gherkin: placeholders, escapes in strings, and table cells', () => {
  expect(tokenKinds('gherkin', 'When I pay <amount> to "a \\"b\\""')).toEqual([
    ['When', 'keyword'],
    ['I pay', null],
    ['<amount>', 'variable'],
    ['to', null],
    ['"a', 'string'],
    ['\\"', 'string.escape'],
    ['b', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
  ]);
  expect(tokenKinds('gherkin', 'Examples:\n  | a \\| b | 3 |\n# done')).toEqual(
    [
      ['Examples:', 'keyword.declaration'],
      ['|', 'punctuation.delimiter'],
      ['a', null],
      ['\\|', 'string.escape'],
      ['b', null],
      ['|', 'punctuation.delimiter'],
      ['3', 'number'],
      ['|', 'punctuation.delimiter'],
      ['# done', 'comment'],
    ]
  );
});

test('gherkin: doc strings run to their closing line', () => {
  const code =
    'Given text\n    """markdown\n    Given not a step\n    ```\n    """\n  Then ok\n  ```\n  "quoted"\n  ```\n';
  expect(tokenKinds('gherkin', code)).toEqual([
    ['Given', 'keyword'],
    ['text', null],
    ['"""markdown', 'string'],
    ['Given not a step', 'string'],
    ['```', 'string'],
    ['"""', 'string'],
    ['Then', 'keyword'],
    ['ok', null],
    ['```', 'string'],
    ['"quoted"', 'string'],
    ['```', 'string'],
  ]);
  assertLineFedParity('gherkin', code);
  assertLineFedParity('gherkin', 'Given x\n  """\n  open\n  Then not a step\n');
});
