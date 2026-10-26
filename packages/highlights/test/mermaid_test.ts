import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('mermaid: flowchart nodes, shapes, links, and labels', () => {
  const code =
    'graph TD;\n  %% note\n  A[Start] -->|yes| B{Ask?}\n  B -- no --> C((Done)):::ok\n' +
    '  C -.-> D>Flag] & E[/Slant\\]';
  expect(tokenKinds('mermaid', code)).toEqual([
    ['graph', 'keyword.declaration'],
    ['TD', 'constant'],
    [';', 'punctuation.delimiter'],
    ['%% note', 'comment'],
    ['A', 'variable'],
    ['[', 'punctuation.bracket'],
    ['Start', 'string'],
    [']', 'punctuation.bracket'],
    ['-->', 'operator'],
    ['|', 'punctuation.bracket'],
    ['yes', 'string'],
    ['|', 'punctuation.bracket'],
    ['B', 'variable'],
    ['{', 'punctuation.bracket'],
    ['Ask?', 'string'],
    ['}', 'punctuation.bracket'],
    ['B', 'variable'],
    ['--', 'operator'],
    ['no', 'string'],
    ['-->', 'operator'],
    ['C', 'variable'],
    ['((', 'punctuation.bracket'],
    ['Done', 'string'],
    ['))', 'punctuation.bracket'],
    [':::', 'operator'],
    ['ok', 'type'],
    ['C', 'variable'],
    ['-.->', 'operator'],
    ['D', 'variable'],
    ['>', 'punctuation.bracket'],
    ['Flag', 'string'],
    [']', 'punctuation.bracket'],
    ['&', 'operator'],
    ['E', 'variable'],
    ['[/', 'punctuation.bracket'],
    ['Slant', 'string'],
    ['\\]', 'punctuation.bracket'],
  ]);
});

test('mermaid: sequence messages, blocks, and notes', () => {
  const code =
    'sequenceDiagram\n  participant A as Alice\n  A->>B: Hi, how are you?\n' +
    '  loop Every minute\n    B-xA: Fail\n  end\n  Note right of B: Thinks';
  expect(tokenKinds('mermaid', code)).toEqual([
    ['sequenceDiagram', 'keyword.declaration'],
    ['participant', 'keyword'],
    ['A', 'variable'],
    ['as', 'keyword'],
    ['Alice', 'variable'],
    ['A', 'variable'],
    ['->>', 'operator'],
    ['B', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Hi, how are you?', 'string'],
    ['loop', 'keyword.control'],
    ['Every minute', 'string'],
    // sequence names have no `-`, so `B-xA` is a link
    ['B', 'variable'],
    ['-x', 'operator'],
    ['A', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Fail', 'string'],
    ['end', 'keyword'],
    ['Note right of', 'keyword'],
    ['B', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Thinks', 'string'],
  ]);
});

test('mermaid: class and entity diagrams use wide link ends', () => {
  expect(
    tokenKinds(
      'mermaid',
      'classDiagram\n  Animal <|-- Duck : extends\n  class Duck{\n    <<interface>>\n    +swim(int speed) bool\n  }'
    )
  ).toEqual([
    ['classDiagram', 'keyword.declaration'],
    ['Animal', 'variable'],
    ['<|--', 'operator'],
    ['Duck', 'variable'],
    [':', 'punctuation.delimiter'],
    ['extends', 'string'],
    ['class', 'keyword'],
    ['Duck', 'variable'],
    ['{', 'punctuation.bracket'],
    ['<<interface>>', 'attribute'],
    ['+', 'operator'],
    ['swim', 'function'],
    ['(', 'punctuation.bracket'],
    ['int speed', 'variable'],
    [')', 'punctuation.bracket'],
    ['bool', 'variable'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'mermaid',
      'erDiagram\n  CUSTOMER ||--o{ LINE-ITEM : places\n  ORDER {\n    string id PK\n  }'
    )
  ).toEqual([
    ['erDiagram', 'keyword.declaration'],
    ['CUSTOMER', 'variable'],
    ['||--o{', 'operator'],
    ['LINE-ITEM', 'variable'],
    [':', 'punctuation.delimiter'],
    ['places', 'string'],
    ['ORDER', 'variable'],
    ['{', 'punctuation.bracket'],
    ['string id', 'variable'],
    ['PK', 'keyword'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('mermaid: front matter, directives, styles, and multi-line strings', () => {
  const code =
    '---\ntitle: Demo\n---\n%%{init: {"theme": "dark"}}%%\nflowchart LR\n' +
    '  A["one #quot;two#quot;\n  three"] --> B@{ shape: rect }\n' +
    '  classDef hot fill:#f96,stroke-width:2px;\n  linkStyle 0 stroke:red\n';
  expect(tokenKinds('mermaid', code)).toEqual([
    ['---', 'punctuation.special'],
    ['title', 'property'],
    [':', 'punctuation.delimiter'],
    ['Demo', 'string'],
    ['---', 'punctuation.special'],
    ['%%{', 'punctuation.special'],
    ['init', 'property'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['"theme"', 'string'],
    [':', 'punctuation.delimiter'],
    ['"dark"', 'string'],
    ['}', 'punctuation.bracket'],
    ['}%%', 'punctuation.special'],
    ['flowchart', 'keyword.declaration'],
    ['LR', 'constant'],
    ['A', 'variable'],
    ['[', 'punctuation.bracket'],
    ['"one', 'string'],
    ['#quot;', 'string.escape'],
    ['two', 'string'],
    ['#quot;', 'string.escape'],
    ['three"', 'string'],
    [']', 'punctuation.bracket'],
    ['-->', 'operator'],
    ['B', 'variable'],
    ['@{', 'punctuation.special'],
    ['shape', 'property'],
    [':', 'punctuation.delimiter'],
    ['rect', 'variable'],
    ['}', 'punctuation.special'],
    ['classDef', 'keyword'],
    ['hot', 'variable'],
    ['fill', 'property'],
    [':', 'punctuation.delimiter'],
    ['#f96', 'string.special'],
    [',', 'punctuation.delimiter'],
    ['stroke-width', 'property'],
    [':', 'punctuation.delimiter'],
    ['2px', 'number'],
    [';', 'punctuation.delimiter'],
    ['linkStyle', 'keyword'],
    ['0', 'number'],
    ['stroke', 'property'],
    [':', 'punctuation.delimiter'],
    ['red', 'variable'],
  ]);
  assertLineFedParity('mermaid', code);
  // an unclosed front matter or directive stays open across lines
  assertLineFedParity('mermaid', '---\ntitle: x\nflowchart LR\n');
  assertLineFedParity(
    'mermaid',
    '%%{init: {\n  "theme": "dark"\n}}%%\ngraph TD\n'
  );
});

test('mermaid: title lines, values, and state markers', () => {
  expect(tokenKinds('mermaid', 'pie title Pets\n  "Dogs" : 386\n')).toEqual([
    ['pie', 'keyword.declaration'],
    ['title', 'keyword'],
    ['Pets', 'string'],
    ['"Dogs"', 'string'],
    [':', 'punctuation.delimiter'],
    ['386', 'number'],
  ]);
  expect(
    tokenKinds(
      'mermaid',
      'stateDiagram-v2\n  [*] --> Still\n  state Fork <<fork>>\n  Still --> [*]'
    )
  ).toEqual([
    ['stateDiagram-v2', 'keyword.declaration'],
    ['[*]', 'constant.builtin'],
    ['-->', 'operator'],
    ['Still', 'variable'],
    ['state', 'keyword'],
    ['Fork', 'variable'],
    ['<<fork>>', 'attribute'],
    ['Still', 'variable'],
    ['-->', 'operator'],
    ['[*]', 'constant.builtin'],
  ]);
  expect(
    tokenKinds(
      'mermaid',
      'gitGraph\n  commit id: "A" tag: "v1"\n  cherry-pick id: "A"'
    )
  ).toEqual([
    ['gitGraph', 'keyword.declaration'],
    ['commit', 'keyword'],
    ['id', 'property'],
    [':', 'punctuation.delimiter'],
    ['"A"', 'string'],
    ['tag', 'property'],
    [':', 'punctuation.delimiter'],
    ['"v1"', 'string'],
    ['cherry-pick', 'keyword'],
    ['id', 'property'],
    [':', 'punctuation.delimiter'],
    ['"A"', 'string'],
  ]);
});
