import assert from 'node:assert/strict';
import t from 'node:test';

import { assertLineFedParity, tokenKinds } from './_util';

/** Assert that each `[text, kind]` pair appears among the tokens of `code`. */
function expectKinds(code: string, pairs: [string, string | null][]): void {
  const kinds = tokenKinds('imba', code);
  for (const [text, kind] of pairs) {
    assert.ok(
      kinds.some(([t, k]) => t === text && k === kind),
      `${text} as ${kind} in ${JSON.stringify(code)}: ${JSON.stringify(kinds)}`
    );
  }
  assertLineFedParity('imba', code);
}

void t.test('imba: comments', () => {
  expectKinds('# line\nx = 1 # tail\n// slash\n/* block */', [
    ['# line', 'comment'],
    ['# tail', 'comment'],
    ['// slash', 'comment'],
    ['/* block */', 'comment'],
  ]);
  expectKinds('###\nblock <&>\n###\nx', [
    ['###', 'comment'],
    ['block <&>', 'comment'],
    ['x', 'variable'],
  ]);
  // `#name` is a private name, not a comment
  expectKinds('#secret = 1', [['#secret', 'variable.special']]);
});

void t.test('imba: declarations', () => {
  expectKinds(
    'class Store < Base\n\tprop count = 0\n\tattr title\n\tdef add item, priority = 1\n\t\titem\n\tget total\\number\n\t\t1\n\tstatic def create(opts)\n\t\topts',
    [
      ['class', 'keyword.declaration'],
      ['Store', 'type.class'],
      ['<', 'operator'],
      ['Base', 'type.class'],
      ['prop', 'keyword.declaration'],
      ['count', 'property'],
      ['title', 'property'],
      ['add', 'function.definition'],
      ['item', 'variable.parameter'],
      ['priority', 'variable.parameter'],
      ['total', 'function.definition'],
      ['\\number', 'type'],
      ['create', 'function.definition'],
      ['opts', 'variable.parameter'],
    ]
  );
  expectKinds('tag app-header < div\nextend class Array', [
    ['tag', 'keyword.declaration'],
    ['app-header', 'type.class'],
    ['div', 'type.class'],
    ['extend class', 'keyword.declaration'],
    ['Array', 'type.class'],
  ]);
  // a declaring word without a name after it is a plain name
  expectKinds('map.get(x)\nset = 1', [
    ['get', 'function.method'],
    ['set', 'variable'],
  ]);
});

void t.test('imba: keywords, literals, and names', () => {
  expectKinds(
    'if a isa String and not b then yes else no\nfor x in [0 .. 10] when x % 2\nreturn null ?? undefined',
    [
      ['if', 'keyword.control'],
      ['isa', 'keyword.operator'],
      ['String', 'type'],
      ['then', 'keyword.control'],
      ['yes', 'boolean'],
      ['no', 'boolean'],
      ['..', 'operator'],
      ['when', 'keyword.control'],
      ['null', 'constant.builtin'],
      ['??', 'operator'],
      ['undefined', 'constant.builtin'],
    ]
  );
  expectKinds('let n = [0xff, 1.5, 10px, 2s, 50%]\nMAX = 1', [
    ['0xff', 'number'],
    ['1.5', 'number'],
    ['10px', 'number'],
    ['2s', 'number'],
    ['50%', 'number'],
    ['MAX', 'constant'],
  ]);
  expectKinds(
    'self.items.push! @name, $global, :symbol, my-var\nfetch!\nx?.y =? 1',
    [
      ['self', 'variable.special'],
      ['items', 'property'],
      ['push!', 'function.method'],
      ['@name', 'variable.special'],
      ['$global', 'variable.special'],
      [':symbol', 'string.special.symbol'],
      ['my-var', 'variable'],
      ['fetch!', 'function'],
      ['=?', 'operator'],
    ]
  );
  expectKinds('obj = {title: 1}\nconsole.log(x)', [
    ['title', 'property'],
    ['log', 'function.method'],
  ]);
});

void t.test('imba: callbacks take parameters', () => {
  expectKinds('items.map do(x, i) x\nitems.each do |todo, j|\n\ttodo', [
    ['x', 'variable.parameter'],
    ['i', 'variable.parameter'],
    ['todo', 'variable.parameter'],
    ['j', 'variable.parameter'],
  ]);
});

void t.test('imba: strings, interpolation, and regexes', () => {
  expectKinds(
    'a = "hi {name}\\n" + \'no {x}\'\nb = `t {y}`\nre = /ab+c/gi\nd = x / 2 / y',
    [
      ['"hi', 'string'],
      ['{', 'punctuation.special'],
      ['name', 'variable'],
      ['\\n', 'string.escape'],
      ["'no {x}'", 'string'],
      ['/ab+c/gi', 'string.regex'],
      ['/', 'operator'],
    ]
  );
  // triple-quoted strings span lines
  expectKinds('s = """\none "{x}"\n"""\ny', [
    ['"""', 'string'],
    ['one "', 'string'],
    ['y', 'variable'],
  ]);
  expectKinds("t = 'one\ntwo'\nz", [
    ["'one", 'string'],
    ["two'", 'string'],
    ['z', 'variable'],
  ]);
});

void t.test('imba: tag literals', () => {
  expectKinds(
    '<div.card.large#main title="x" @click.prevent=add(1) [c:red p:2]> "Hi"\n\t<{name} data=items>\n\t<self>',
    [
      ['<', 'punctuation.bracket.html'],
      ['div', 'tag'],
      ['.card.large', 'selector.class'],
      ['#main', 'selector.id'],
      ['title', 'attribute'],
      ['@click.prevent', 'attribute'],
      ['add', 'function'],
      ['c', 'property'],
      ['red', 'constant.builtin'],
      ['2', 'number'],
      ['>', 'punctuation.bracket.html'],
      ['"Hi"', 'string'],
      ['name', 'variable'],
      ['data', 'attribute'],
      ['self', 'tag'],
    ]
  );
  // a spaced or operand-less `<` compares
  expectKinds('if a < b\nc = d<e', [
    ['<', 'operator'],
    ['b', 'variable'],
    ['e', 'variable'],
  ]);
  // an attribute list may continue on the next line
  expectKinds('<div title=a\n\thidden=b>', [
    ['hidden', 'attribute'],
    ['>', 'punctuation.bracket.html'],
  ]);
});

void t.test('imba: style blocks', () => {
  expectKinds(
    'tag x\n\tcss .title fs:lg @hover:blue5\n\t\tp:2 bg:#fff\n\t\t@hover bg:gray1\n\t\tw:calc(100% - 2px) $x:1\n\t<self> "x"\nglobal css html ff:sans',
    [
      ['css', 'keyword.declaration'],
      ['.title', 'selector.class'],
      ['fs', 'property'],
      ['lg', 'constant.builtin'],
      ['@hover', 'property'],
      ['p', 'property'],
      ['#fff', 'string.special'],
      ['@hover', 'selector.pseudo'],
      ['calc', 'function'],
      ['100%', 'number'],
      ['$x', 'property'],
      ['<', 'punctuation.bracket.html'],
      ['self', 'tag'],
      ['global', 'variable.special'],
      ['html', 'tag'],
      ['ff', 'property'],
    ]
  );
  // `css` as a plain name
  expectKinds('css = 1\nel.css', [['css', 'variable']]);
});
