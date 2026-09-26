import assert from 'node:assert';
import t from 'node:test';

import { codeToTokens, init } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  distinctTheme,
  loadLang,
  type TestLang,
  tokenKinds,
} from './_util';

let tsrx: TestLang;

t.before(() => {
  tsrx = loadLang('tsrx', '$hlTsrx');
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/** Assert that some token whose trimmed text is `text` has kind `kind`. */
function expectKind(
  kinds: [string, string | null][],
  text: string,
  kind: string | null
): void {
  assert.ok(
    kinds.some(([value, capture]) => value === text && capture === kind),
    `${JSON.stringify(text)} as ${kind}: ${JSON.stringify(kinds.filter(([value]) => value.includes(text)))}`
  );
}

/** Like `expectKind`, but `text` may be one word of a merged token. */
function expectWordKind(
  kinds: [string, string | null][],
  word: string,
  kind: string | null
): void {
  assert.ok(
    kinds.some(
      ([value, capture]) =>
        value.split(/\s+/).includes(word) && capture === kind
    ),
    `${word} as ${kind}`
  );
}

void t.test(
  'tsrx: statement containers and template directives are control keywords',
  () => {
    const code = [
      'const Status = ({ status }) => <>',
      "  @if (status === 'loading') {",
      '    <p>Loading...</p>',
      "  } @else if (status === 'success') {",
      '    <p>Done</p>',
      '  } @else {',
      '    <p>Unknown</p>',
      '  }',
      '  @switch (status) {',
      "    @case 'loading': {",
      "      <p>{'Loading...'}</p>",
      '    }',
      '    @default: {',
      '      <p>{"Unknown"}</p>',
      '    }',
      '  }',
      '  @try {',
      '    <AsyncComponent />',
      '  } @pending {',
      '    <p>Pending</p>',
      '  } @catch (e) {',
      "    <div>{'Error: '}{e.message}</div>",
      '  } finally {',
      '    <p>done</p>',
      '  }',
      '</>;',
      '',
      'function App({ visible }) @{',
      "  const title = 'Ready';",
      '  @if (visible) <div class="status">Visible: {String(visible)}</div>',
      '}',
      '',
      'const Boundary = () => @try {',
      '  <Component />',
      '} @pending {',
      '  <p>Loading</p>',
      '};',
    ].join('\n');
    const kinds = tokenKinds('tsrx', code);
    for (const word of [
      '@if',
      '@else',
      '@switch',
      '@case',
      '@default',
      '@try',
      '@pending',
      '@catch',
      'finally',
    ]) {
      expectWordKind(kinds, word, 'keyword.control');
    }
    // `@{` splits: the `@` is a directive, the `{` an ordinary bracket
    expectKind(kinds, '@', 'keyword.control');
    assert.ok(
      !kinds.some(([value]) => value.includes('@{')),
      'no token spans both bytes of `@{`'
    );
    // the `if` of `@else if` is a keyword too
    assert.ok(
      kinds.some(
        ([value, kind]) => value === '@else if' && kind === 'keyword.control'
      )
    );
    // the directive bodies are ordinary elements and text
    expectKind(kinds, 'Loading...', 'text.jsx');
    expectKind(kinds, 'Unknown', 'text.jsx');
    expectKind(kinds, 'AsyncComponent', 'tag.component.jsx');
    expectKind(kinds, 'e', 'variable.parameter');
    expectKind(kinds, 'message', 'property');
    // a bare element body after `@if (...)`, then the container closes
    expectKind(kinds, 'class', 'attribute.jsx');
    expectKind(kinds, 'Visible:', 'text.jsx');
    expectKind(kinds, 'String', 'function');
    expectKind(kinds, 'Component', 'tag.component.jsx');
    // the whole thing streams line by line
    assertLineFedParity('tsrx', code + '\n');
  }
);

void t.test(
  'tsrx: fragment and module declarations, for-head clauses, lazy patterns',
  () => {
    const code = [
      'fragment Card({ children }) {',
      '  <div class="card">{children}</div>',
      '}',
      'module server {',
      '  export const data = () => null;',
      '}',
      'import { data as serverData } from server;',
      'export function TodoList(&{ items, hidden }: Props) @{',
      '  const &[first, second] = items;',
      '  <ul>',
      '    @for (const item of items; index i; key item.id) {',
      '      <li>{i + 1}. {item.title}</li>',
      '    } @empty {',
      '      <li>No todos yet</li>',
      '    }',
      '  </ul>',
      '}',
      'const fragment = obj.module + fragment.x;',
    ].join('\n');
    const kinds = tokenKinds('tsrx', code);
    expectKind(kinds, 'fragment', 'keyword.declaration');
    expectKind(kinds, 'Card', 'function');
    expectKind(kinds, 'children', 'variable.parameter');
    expectKind(kinds, 'module', 'keyword');
    expectKind(kinds, 'server', 'namespace');
    expectWordKind(kinds, 'from', 'keyword.import');
    expectKind(kinds, '&', 'operator');
    expectKind(kinds, 'items', 'variable.parameter');
    expectKind(kinds, 'hidden', 'variable.parameter');
    expectWordKind(kinds, '@for', 'keyword.control');
    expectWordKind(kinds, '@empty', 'keyword.control');
    expectKind(kinds, 'index', 'keyword');
    expectKind(kinds, 'key', 'keyword');
    expectKind(kinds, 'of', 'keyword');
    expectKind(kinds, 'No todos yet', 'text.jsx');
    // the reserved words stay identifiers elsewhere
    expectKind(kinds, 'fragment', 'variable');
    expectKind(kinds, 'module', 'property');
    assertLineFedParity('tsrx', code + '\n');
  }
);

void t.test(
  'tsrx: sibling elements, raw style and script bodies, dynamic tags',
  () => {
    const code = [
      'function App() @{',
      '  <style apply={theme} data-scope="card">',
      '    .card { color: red; }',
      '    p {',
      '      margin: 0.5rem 0;',
      '    }',
      '  </style>',
      '  <div />',
      '  <style apply={[base, theme]} />',
      '  <head>',
      '    <script>const n = 1 < 2 ? 3 : 4; if (n < 2) { go(); }</script>',
      '    <script type="text/typescript">',
      '      const m: number = 1;',
      '    </script>',
      '    <script src={url} />',
      "    <scripts>{'x'}</scripts>",
      '  </head>',
      '  <{Tag} class="host">{"hello"}</{Tag}>',
      '  <{parts.section} class="host" />',
      '  <Namespace.Component />',
      '}',
      'const styles = <style>',
      '  .modular { color: green; }',
      '</style>;',
      'const Style = () => <Style>{"not css"}</Style>;',
    ].join('\n');
    const kinds = tokenKinds('tsrx', code);
    // css inside <style>
    expectKind(kinds, '.card', 'selector.class');
    expectKind(kinds, 'color', 'property');
    expectKind(kinds, 'red', 'constant.builtin');
    expectWordKind(kinds, '0.5rem', 'number');
    expectKind(kinds, '.modular', 'selector.class');
    expectKind(kinds, 'apply', 'attribute.jsx');
    expectKind(kinds, 'data-scope', 'attribute.jsx');
    // typescript inside <script>, ended by </script>
    expectWordKind(kinds, 'const', 'keyword.declaration');
    expectKind(kinds, 'go', 'function');
    expectKind(kinds, 'number', 'type.builtin');
    expectKind(kinds, 'script', 'tag.jsx');
    expectKind(kinds, 'scripts', 'tag.jsx');
    expectKind(kinds, "'x'", 'string');
    // a `<` after a completed element opens the next sibling
    expectKind(kinds, 'div', 'tag.jsx');
    expectKind(kinds, 'head', 'tag.jsx');
    expectKind(kinds, 'Namespace.Component', 'tag.component.jsx');
    // only the two comparisons inside the script body read `<` as an operator
    assert.equal(
      kinds.filter(([value, kind]) => value === '<' && kind === 'operator')
        .length,
      2
    );
    // dynamic tags hold expressions
    expectKind(kinds, 'Tag', 'type');
    expectKind(kinds, 'parts', 'variable');
    expectKind(kinds, 'section', 'property');
    expectKind(kinds, '"hello"', 'string');
    // only the lowercase name is raw text
    expectKind(kinds, 'Style', 'tag.component.jsx');
    expectKind(kinds, '"not css"', 'string');
    assertLineFedParity('tsrx', code + '\n');
  }
);

void t.test('tsrx: comments between template children', () => {
  const code = [
    'function Comments() @{',
    '  <>',
    '   {q} // trailing after expression',
    '   @{r}  // trailing after statement container',
    '   <b>z</b> // trailing after element',
    '   // line start',
    '   text with // literal slashes',
    '   visit https://x.com please',
    '   hello /* inline',
    '   block */ world',
    '   @{@{@{<>hello @{222}</>}}}',
    "   <p><code>if</code><code>{'@if'}</code> a@b.com &amp; more</p>",
    '  </>',
    '}',
  ].join('\n');
  const kinds = tokenKinds('tsrx', code);
  expectKind(kinds, '// trailing after expression', 'comment');
  expectKind(kinds, '// trailing after statement container', 'comment');
  expectKind(kinds, '// trailing after element', 'comment');
  expectKind(kinds, '// line start', 'comment');
  expectKind(kinds, 'text with // literal slashes', 'text.jsx');
  expectKind(kinds, 'visit https://x.com please', 'text.jsx');
  expectKind(kinds, '/* inline', 'comment');
  expectKind(kinds, 'block */', 'comment');
  expectKind(kinds, 'world', 'text.jsx');
  expectKind(kinds, '222', 'number');
  // six `@{` openers: the function body plus five nested containers
  assert.equal(
    kinds.filter(([value, kind]) => value === '@' && kind === 'keyword.control')
      .length,
    6
  );
  const braces = kinds.filter(([value]) => value === '{');
  assert.ok(braces.length >= 6);
  assert.ok(braces.every(([, kind]) => kind === 'punctuation.bracket'));
  expectKind(kinds, 'if', 'text.jsx');
  expectKind(kinds, "'@if'", 'string');
  expectKind(kinds, 'a@b.com', 'text.jsx');
  expectKind(kinds, '&amp;', 'string.special');
  assertLineFedParity('tsrx', code + '\n');
});

void t.test('tsrx: plain tsx highlights exactly as tsx', () => {
  for (const code of [
    samples.tsx.code,
    samples.jsx.code,
    '@Component({ a: 1 }) class C {}\nconst x = a < b && c > d;\n',
    'const f = <T,>(x: T) => x;\nconst y = f<number>(1) < 2;\n',
  ]) {
    assert.deepEqual(
      codeToTokens(code, { lang: 'tsrx', theme: distinctTheme }).tokens,
      codeToTokens(code, { lang: 'tsx', theme: distinctTheme }).tokens,
      code
    );
  }
});

void t.test('tsrx: multi-line constructs stream line by line', () => {
  for (const code of [
    'const s = <style>\n  a {\n    color: /* multi\n line */ red;\n  }\n</style>;\n',
    'const s = <style>\n  a { content: "x\n' + '</style>";\n  }\n</style>;\n',
    'const h = <head><script>\n  const a = `x\n  ${1}`;\n</script></head>;\n',
    'const v = <>\n  text /* a\n  b */ more\n  <b/>\n</>;\n',
    'const v = <>\n  @if (a) {\n    <p>x</p>\n  }\n  @else\n  {\n    <p>y</p>\n  }\n</>;\n',
    'const v = <>\n  @{\n    const a = 1;\n    <p>{a}</p>\n  }\n</>;\n',
    'const v = <>\n  <{\n    Tag\n  } a="1">\n  </{\n    Tag\n  }>\n</>;\n',
    'const v = <>\n  @try {\n    <a/>\n  }\n  finally {\n    <b/>\n  }\n</>;\n',
    'function A() @{\n  <a/>\n  <b/>\n  <style>\n  </style>\n  <c/>\n}\n',
  ]) {
    assertLineFedParity('tsrx', code);
  }
});

void t.test('tsrx: malformed input stays lossless and balanced', () => {
  for (const input of [
    '@',
    '@{',
    '@{@{',
    '@if',
    '@if (',
    '<>@',
    '<>@if',
    '<>@if (x',
    '<>@if (x) {',
    '<>@if (x) <a',
    '<>@else',
    '<a>@else</a>',
    '<>finally',
    '<>finally {',
    '<>\n  finally',
    '<>/*',
    '<>//',
    '<> //',
    '<>a\n/',
    '<style>',
    '<style>a{',
    '<style>a{}</style',
    '<style></style>',
    '<script>',
    '<script>if (a <',
    '<script></scrip',
    '<script></script',
    '<script/>',
    '<{',
    '<{Tag',
    '<{Tag}',
    '</{',
    '<a></{',
    '<a></{x}',
    '<a></{x}>',
    'fragment',
    'fragment ',
    'fragment (',
    'module',
    'module x',
    'from x',
    '@for (;index',
    '&{',
    '<a/> <',
    '<a/> < 3',
    '<a/> <b',
    '\0@{\0<>\0@if\0',
  ]) {
    checkInvariants(tsrx.hl, input);
    checkInvariants(tsrx.hl, input + '\n');
  }
});
