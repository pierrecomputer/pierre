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
  spansOf,
  type TestLang,
  textOf,
  themeColor,
  tokenKinds,
  wordColor,
} from './util';

let zig: TestLang;
t.before(() => (zig = loadLang('zig', '$hlZig')));

void t.test('zig: declarations, control flow, types, and values', () => {
  const src = `const std = @import("std");
const Point = struct { x: i32, y: i32 };
pub fn add(a: Point, b: Point) u32 {
  if (true) return a.x + b.y;
  return null;
}`;
  const html = checkInvariants(zig.hl, src);
  assert.equal(colorOf(html, 'const'), themeColor('keyword.declaration'));
  assert.equal(colorOf(html, 'add'), themeColor('function.definition'));
  assert.equal(colorOf(html, 'if'), themeColor('keyword.control'));
  assert.equal(colorOf(html, 'Point'), themeColor('type'));
  assert.equal(colorOf(html, 'u32'), themeColor('type.builtin'));
  assert.equal(colorOf(html, 'true'), themeColor('boolean'));
  assert.equal(colorOf(html, 'null'), themeColor('constant.builtin'));
});

void t.test(
  'zig: the keyword hash covers language words and primitive types',
  () => {
    const theme = {
      name: 'zig-keywords',
      appearance: 'dark',
      style: {
        syntax: {
          keyword: '#110001',
          'keyword.control': '#220002',
          'keyword.declaration': '#330003',
          'keyword.import': '#440004',
          'keyword.operator': '#550005',
          'type.builtin': '#660006',
          boolean: '#770007',
          'constant.builtin': '#880008',
          'variable.special': '#990009',
          variable: '#aa000a',
        },
      },
    };
    const groups = [
      [['fn', 'const', 'var', 'struct', 'enum', 'union', 'opaque'], '#330003'],
      [
        [
          'if',
          'else',
          'switch',
          'for',
          'while',
          'break',
          'continue',
          'return',
          'defer',
          'errdefer',
          'try',
          'catch',
          'suspend',
          'nosuspend',
          'resume',
        ],
        '#220002',
      ],
      [['export'], '#440004'],
      [['and', 'or', 'orelse'], '#550005'],
      [
        [
          'bool',
          'void',
          'noreturn',
          'type',
          'anyerror',
          'anyframe',
          'anytype',
          'comptime_int',
          'comptime_float',
          'anyopaque',
          'isize',
          'usize',
          'f16',
          'f32',
          'f64',
          'f80',
          'f128',
          'c_char',
          'c_short',
          'c_ushort',
          'c_int',
          'c_uint',
          'c_long',
          'c_ulong',
          'c_longlong',
          'c_ulonglong',
          'c_longdouble',
          'i37',
          'u1',
          'i65535',
          'u0',
        ],
        '#660006',
      ],
      [['true', 'false'], '#770007'],
      [['null', 'unreachable', 'undefined'], '#880008'],
      [['c', '_'], '#990009'],
      [
        [
          'asm',
          'test',
          'error',
          'pub',
          'inline',
          'noinline',
          'extern',
          'comptime',
          'packed',
          'threadlocal',
          'volatile',
          'allowzero',
          'noalias',
          'addrspace',
          'align',
          'callconv',
          'linksection',
        ],
        '#110001',
      ],
    ];
    for (const [words, color] of groups) {
      for (const word of words) {
        const html = checkInvariants(zig.hl, word, { theme });
        assert.equal(
          spansOf(html).find((span) => span.text === word)?.color,
          color,
          word
        );
      }
    }
    for (const word of [
      'async',
      'await',
      'usingnamespace',
      'usingnamespacf',
      'comptime_floau',
      'threadlocam',
      'i65536',
      'u999999',
    ]) {
      const html = checkInvariants(zig.hl, word, { theme });
      assert.equal(
        spansOf(html).find((span) => span.text === word)?.color,
        '#aa000a',
        word
      );
    }
  }
);

void t.test(
  'zig: calls, members, fields, constants, labels, and quoted identifiers',
  () => {
    const src = `const Thing = struct { field: u8 };
fn @"quoted name"() void {
  obj.field = obj.call(MAX_VALUE);
  helper();
  outer: while (true) break :outer;
}`;
    const html = checkInvariants(zig.hl, src);
    assert.equal(
      colorOf(html, '@"quoted name"'),
      themeColor('function.definition')
    );
    assert.equal(colorOf(html, 'field'), themeColor('property'));
    assert.equal(colorOf(html, 'call'), themeColor('function.method'));
    assert.equal(colorOf(html, 'helper'), themeColor('function'));
    assert.equal(colorOf(html, 'MAX_VALUE'), themeColor('constant'));
    assert.equal(colorOf(html, 'outer'), themeColor('label'));
  }
);

void t.test('zig: contextual state follows labels and function types', () => {
  const theme = {
    name: 'zig-context',
    appearance: 'dark',
    style: {
      syntax: {
        variable: '#110001',
        property: '#220002',
        label: '#330003',
        type: '#440004',
        'function.definition': '#550005',
      },
    },
  };
  const src = `const S = struct {
  format: u8,
  switcheroo: u8,
};
fn run(value: u8) void {
  loop: inline while (true) { break value; }
  const Callback = fn (u8) void;
  const x: SomeType = undefined;
  const y: @TypeOf(foo) = foo;
  const z: @"quoted type" = undefined;
}`;
  const html = checkInvariants(zig.hl, src, { theme });
  assert.equal(colorOf(html, 'format'), '#220002');
  assert.equal(colorOf(html, 'switcheroo'), '#220002');
  assert.equal(colorOf(html, 'loop'), '#330003');
  assert.equal(colorOf(html, 'SomeType'), '#440004');
  assert.equal(colorOf(html, 'x'), '#110001');
  assert.equal(colorOf(html, 'foo'), '#110001');
  assert.equal(colorOf(html, '@"quoted type"'), '#440004');
});

void t.test(
  'zig: comments, builtins, strings, chars, and multiline strings',
  () => {
    const src = String.raw`// plain
/// declaration docs
//! container docs
//// plain four-slash comment
const a = @import("a\n");
const b = @cImport({});
const c = @as(u8, '\x41');
const d = "\u{1f600}\t";
const raw = \\first line
  \\second line
`;
    const theme = {
      name: 'zig-comments',
      appearance: 'dark',
      style: {
        syntax: {
          comment: '#110001',
          'comment.doc': '#220002',
          'keyword.import': '#330003',
          function: '#440004',
          string: '#550005',
          'string.escape': '#660006',
        },
      },
    };
    const html = checkInvariants(zig.hl, src, { theme });
    assert.equal(colorOf(html, '// plain'), '#110001');
    assert.equal(colorOf(html, '/// declaration docs'), '#220002');
    assert.equal(colorOf(html, '//! container docs'), '#220002');
    assert.equal(colorOf(html, '//// plain four-slash comment'), '#110001');
    assert.equal(colorOf(html, '@import'), '#330003');
    assert.equal(colorOf(html, '@cImport'), '#330003');
    assert.equal(colorOf(html, '@as'), '#440004');
    assert.equal(colorOf(html, String.raw`\n`), '#660006');
    assert.equal(colorOf(html, String.raw`\x41`), '#660006');
    assert.equal(colorOf(html, String.raw`\u{1f600}`), '#660006');
    assert.equal(colorOf(html, String.raw`\t`), '#660006');
    assert.equal(colorOf(html, String.raw`\\first line`), '#550005');
  }
);

void t.test('zig: identifiers follow the ASCII grammar', () => {
  const theme = {
    name: 'zig-identifiers',
    appearance: 'dark',
    style: {
      syntax: {
        variable: '#110001',
        function: '#220002',
        property: '#330003',
      },
    },
  };
  const html = checkInvariants(
    zig.hl,
    'alpha a1 _x $dollar café obj.member @builtin1 @$ @"quoted 日本語"',
    { theme }
  );
  const spans = spansOf(html);
  assert.equal(colorOf(html, 'alpha'), '#110001');
  assert.equal(colorOf(html, '@builtin1'), '#220002');
  assert.equal(colorOf(html, 'member'), '#330003');
  assert.equal(colorOf(html, 'dollar'), '#110001');
  assert.ok(
    !spans.some((span) => span.text === '$dollar' && span.color === '#110001')
  );
  assert.ok(
    !spans.some((span) => span.text === 'café' && span.color === '#110001')
  );
  assert.ok(
    !spans.some((span) => span.text === '@$' && span.color === '#220002')
  );
});

void t.test('zig: numbers, operators, delimiters, and punctuation', () => {
  const src =
    '0xff 0b10_10 0o7_5 1_000 1.25e-3 0x1.fp+3 0x1p-2; a +%= b; x.?; p.*; 0..9; f(...) => T; A -> B; q +-> R; z !==> Q';
  const html = checkInvariants(zig.hl, src);
  for (const number of [
    '0xff',
    '0b10_10',
    '0o7_5',
    '1_000',
    '1.25e-3',
    '0x1.fp+3',
    '0x1p-2',
  ]) {
    assert.equal(colorOf(html, number), themeColor('number'), number);
  }
  for (const op of [
    '&',
    '&=',
    '*',
    '**',
    '*=',
    '*%',
    '*%=',
    '*|',
    '*|=',
    '^',
    '^=',
    '=',
    '==',
    '!',
    '!=',
    '<',
    '<<',
    '<<=',
    '<<|',
    '<<|=',
    '<=',
    '-',
    '-=',
    '-%',
    '-%=',
    '-|',
    '-|=',
    '%',
    '%=',
    '|',
    '||',
    '|=',
    '+',
    '++',
    '+=',
    '+%',
    '+%=',
    '+|',
    '+|=',
    '?',
    '>',
    '>>',
    '>>=',
    '>=',
    '/',
    '/=',
    '~',
    '.?',
    '.*',
    '..',
  ]) {
    assert.equal(
      colorOf(checkInvariants(zig.hl, op), op),
      themeColor('operator'),
      op
    );
  }
  assert.equal(colorOf(html, '...'), themeColor('variable.special'));
  assert.equal(colorOf(html, '=>'), themeColor('punctuation.delimiter'));
  assert.equal(colorOf(html, '->'), themeColor('punctuation.delimiter'));
  assert.equal(colorOf(html, '('), themeColor('punctuation.bracket'));
  assert.equal(
    colorOf(checkInvariants(zig.hl, '+->'), '->'),
    themeColor('punctuation.delimiter')
  );
  assert.equal(
    colorOf(checkInvariants(zig.hl, '!==>'), '=>'),
    themeColor('punctuation.delimiter')
  );
  assert.equal(
    colorOf(checkInvariants(zig.hl, '++=>'), '=>'),
    themeColor('punctuation.delimiter')
  );
  assert.equal(
    colorOf(checkInvariants(zig.hl, '?=>'), '=>'),
    themeColor('punctuation.delimiter')
  );
  assert.equal(
    colorOf(checkInvariants(zig.hl, '!=>'), '!=>'),
    themeColor('operator')
  );
  assert.equal(
    colorOf(checkInvariants(zig.hl, '+%=>'), '+%=>'),
    themeColor('operator')
  );
  assert.equal(
    colorOf(checkInvariants(zig.hl, '+// comment'), '// comment'),
    themeColor('comment')
  );
});

void t.test(
  'zig: payload bars are brackets and arrow lookahead is bounded',
  () => {
    const theme = {
      name: 'zig-payloads',
      appearance: 'dark',
      style: {
        syntax: {
          operator: '#110001',
          'punctuation.bracket': '#220002',
          'punctuation.delimiter': '#330003',
        },
      },
    };
    const src =
      'if (opt) |value| value else |err| err; for (items) |*item, index| item.*; value catch |e| e; errdefer |deferred| {}; switch (tag) { 1 => |v| v }; if (if (inner) |x| x else null) |outer| outer; const bits = (a) | b;';
    const bars = spansOf(checkInvariants(zig.hl, src, { theme }));
    const countBars = (color: string | null) =>
      bars
        .filter((span) => span.color === color)
        .reduce((n, span) => n + (span.text.match(/\|/g)?.length ?? 0), 0);
    assert.equal(countBars('#220002'), 16);
    assert.equal(countBars('#110001'), 1);

    const split = checkInvariants(loadLang('zig', '$hlZig', 1).hl, '=>', {
      theme,
    });
    assert.equal(colorOf(split, '='), '#110001');
  }
);

void t.test('zig: numeric tokens stop at grammar boundaries', () => {
  const theme = {
    name: 'zig-number-boundaries',
    appearance: 'dark',
    style: {
      syntax: {
        number: '#110001',
        variable: '#220002',
        constant: '#220002',
        type: '#220002',
        property: '#330003',
        operator: '#440004',
        'punctuation.delimiter': '#550005',
        'punctuation.bracket': '#660006',
      },
    },
  };
  for (const [src, number, tail, tailColor] of [
    ['0b2', '0', 'b2', '#220002'],
    ['0XFF', '0', 'XFF', '#220002'],
    ['0x_1', '0', 'x_1', '#220002'],
    ['1__2', '1', '__2', '#220002'],
    ['1.foo', '1', 'foo', '#330003'],
    ['1.e2', '1', 'e2', '#330003'],
    ['0x1.p2', '0x1', 'p2', '#330003'],
  ]) {
    const html = checkInvariants(zig.hl, src, { theme });
    assert.equal(colorOf(html, number), '#110001', src);
    assert.equal(colorOf(html, tail), tailColor, src);
  }
  const range = checkInvariants(zig.hl, '1..2', { theme });
  assert.equal(colorOf(range, '..'), '#440004');
  const slash = spansOf(checkInvariants(zig.hl, '\\', { theme }));
  assert.ok(!slash.some((span) => span.color === '#660006'));
});

void t.test(
  'zig: malformed constructs and every byte split stay lossless',
  () => {
    for (const src of [
      '',
      '/',
      '//',
      '"unterminated',
      "'\\x",
      '@"unterminated',
      '@',
      '\\',
      '\\\\unterminated',
      '0x_',
      'é = 日本語',
    ])
      checkInvariants(zig.hl, src);

    const src = String.raw`fn @"name"(x: u37) void { // docs
    const s = "a\n😀"; obj.call(...); \\raw
  }`;
    const size = new TextEncoder().encode(src).length;
    for (let split = 0; split <= size; split++) {
      checkInvariants(loadLang('zig', '$hlZig', split).hl, src);
    }
  }
);

void t.test(
  'zig: malformed UTF-8 and deterministic fuzz preserve invariants',
  () => {
    const bytes = Uint8Array.of(0x40, 0x22, 0xf0, 0x28, 0x8c, 0x28, 0x22, 0xff);
    const html = zig.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);

    let state = 0x7a_69_67;
    const alphabet = 'abcXYZ09_@ /\\"\'\n\t{}[]().,:;+-*=!<>&|?é';
    for (let sample = 0; sample < 160; sample++) {
      let src = '';
      for (let n = state & 63; n-- !== 0; ) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        src += alphabet[state % alphabet.length];
      }
      checkInvariants(zig.hl, src);
    }
  }
);

void t.test('zig: fn parameters match Zed variable.parameter', () => {
  const PARAM = themeColor('variable.parameter');
  const word = (html: string, text: string) =>
    spansOf(html).find((s) => s.text.trim() === text)?.color;
  const html = checkInvariants(
    zig.hl,
    'pub fn add(first: u8, second: u64) u8 { return first; }\n' +
      'fn init(allocator: std.mem.Allocator, comptime T: type, items: []const u8) !T {}\n' +
      'const v = compute(alpha, beta);\n' +
      'const S = struct { field: u32 };'
  );
  for (const name of ['first', 'second', 'allocator', 'T', 'items']) {
    assert.equal(word(html, name), PARAM, name);
  }
  // call arguments and container fields stay plain
  assert.notEqual(word(html, 'alpha'), PARAM);
  assert.notEqual(word(html, 'beta'), PARAM);
  assert.notEqual(word(html, 'field'), PARAM);
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(zig.hl, src, { theme: distinctTheme });

void t.test('zig: imports, declarations, and literal forms', () => {
  const html = distinctHl(
    "const std = @import(\"std\");\npub fn main() !void { var x: u8 = 0x1F; const y = 0b101 + 0o17 + 1_000 + 1.5e3 + 'a' + '\\n'; _ = x; }"
  );
  for (const word of ['const', 'fn', 'var']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.declaration'),
      word
    );
  }
  assert.equal(exactColor(html, '@import'), distinctColor('keyword.import'));
  assert.equal(exactColor(html, '"std"'), distinctColor('string'));
  assert.equal(exactColor(html, 'pub'), distinctColor('keyword'));
  assert.equal(exactColor(html, 'main'), distinctColor('function.definition'));
  assert.equal(exactColor(html, '!'), distinctColor('operator'));
  for (const type of ['void', 'u8']) {
    assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
  }
  for (const n of ['0x1F', '0b101', '0o17', '1_000', '1.5e3']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  assert.equal(exactColor(html, "'a'"), distinctColor('string'));
  assert.equal(exactColor(html, '\\n'), distinctColor('string.escape'));
  assert.equal(exactColor(html, '_'), distinctColor('variable.special'));
});

void t.test('zig: container declarations, fields, and methods', () => {
  const html = distinctHl(
    'const S = struct { a: i32, b: []const u8 = "x", pub fn init(self: *S) void { self.a = 1; } };\nconst E = enum(u8) { a, b }; const U = union(enum) { x: i32 }; const T = opaque {}; const err = error{ Oops };'
  );
  for (const word of ['struct', 'enum', 'union', 'opaque']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.declaration'),
      word
    );
  }
  for (const type of ['S', 'E', 'U', 'T', 'Oops']) {
    assert.equal(exactColor(html, type), distinctColor('type'), type);
  }
  assert.equal(exactColor(html, 'a'), distinctColor('property'));
  assert.equal(exactColor(html, 'b'), distinctColor('property'));
  assert.equal(exactColor(html, 'init'), distinctColor('function.definition'));
  assert.equal(exactColor(html, 'self'), distinctColor('variable.parameter'));
  assert.equal(exactColor(html, 'error'), distinctColor('keyword'));
  assert.equal(exactColor(html, '[]'), distinctColor('punctuation.bracket'));
});

void t.test(
  'zig: comptime parameters, calling conventions, and function qualifiers',
  () => {
    const html = distinctHl(
      'fn f(comptime T: type, x: anytype) !T { return if (x) |v| v else error.Oops; } fn g() callconv(.C) void {} extern "c" fn h() void; export fn i() void {} inline fn j() void {} noinline fn k() void {}'
    );
    assert.equal(exactColor(html, 'comptime'), distinctColor('keyword'));
    for (const p of ['T', 'x']) {
      assert.equal(exactColor(html, p), distinctColor('variable.parameter'), p);
    }
    for (const type of ['type', 'anytype']) {
      assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const word of ['return', 'if', 'else']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(exactColor(html, 'Oops'), distinctColor('property'));
    for (const word of ['callconv', 'extern', 'inline', 'noinline']) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    assert.equal(exactColor(html, '"c"'), distinctColor('string'));
    assert.equal(exactColor(html, 'export'), distinctColor('keyword.import'));
    for (const fn of ['g', 'h', 'i', 'j', 'k']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
  }
);

void t.test('zig: control flow, error handling, and modifiers', () => {
  const html = distinctHl(
    'try f(); defer d(); errdefer e(); while (i < 10) { if (a and b or c) break else continue; } for (xs, 0..) |x, i| {} switch (v) { .a => 1, else => 3 } orelse 0; x = unreachable; test "name" {} threadlocal; volatile; align(4); packed;'
  );
  for (const word of [
    'try',
    'defer',
    'errdefer',
    'while',
    'if',
    'break',
    'else',
    'continue',
    'for',
    'switch',
  ]) {
    assert.equal(wordColor(html, word), distinctColor('keyword.control'), word);
  }
  for (const word of ['and', 'or', 'orelse']) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.operator'),
      word
    );
  }
  assert.equal(
    exactColor(html, 'unreachable'),
    distinctColor('constant.builtin')
  );
  for (const word of ['test', 'threadlocal', 'volatile', 'align', 'packed']) {
    assert.equal(wordColor(html, word), distinctColor('keyword'), word);
  }
  assert.equal(exactColor(html, '"name"'), distinctColor('string'));
  assert.equal(exactColor(html, '..'), distinctColor('operator'));
  assert.equal(exactColor(html, '=>'), distinctColor('punctuation.delimiter'));
});

void t.test(
  'zig: comments, multi-line strings, builtins, and anonymous literals',
  () => {
    assert.deepEqual(
      tokenKinds(
        'zig',
        '// line\n/// doc\n//! top doc\nconst m =\n    \\\\multi\n    \\\\line\n;\n@intCast(x); s.field; s.method(); a = null; b = undefined;'
      ).slice(0, 12),
      [
        ['// line', 'comment'],
        ['/// doc', 'comment.doc'],
        ['//! top doc', 'comment.doc'],
        ['const', 'keyword.declaration'],
        ['m', 'variable'],
        ['=', 'operator'],
        ['\\\\multi', 'string'],
        ['\\\\line', 'string'],
        [';', 'punctuation.delimiter'],
        ['@intCast', 'function'],
        ['(', 'punctuation.bracket'],
        ['x', 'variable'],
      ]
    );
    const html = distinctHl(
      '.{ .a = 1 }; s.field; s.method(); @This(); @as(u8, 1); a = null; b = undefined; c = true;'
    );
    assert.equal(exactColor(html, 'a'), distinctColor('property'));
    assert.equal(exactColor(html, 'field'), distinctColor('property'));
    assert.equal(exactColor(html, 'method'), distinctColor('function.method'));
    for (const b of ['@This', '@as']) {
      assert.equal(exactColor(html, b), distinctColor('function'), b);
    }
    for (const c of ['null', 'undefined']) {
      assert.equal(exactColor(html, c), distinctColor('constant.builtin'), c);
    }
    assert.equal(exactColor(html, 'true'), distinctColor('boolean'));
  }
);

void t.test('zig: multi-line strings and comments stream line-fed', () => {
  assertLineFedParity(
    'zig',
    'const s =\n    \\\\a\n    \\\\b\n;\n/// doc\n// c\nconst t = struct {\n    x: u8,\n};\n'
  );
});
