import {
  allocateMemory,
  buildHighlightsLexer,
  flattenWat,
  resolveConsts,
  splitTopLevelForms,
  transformWat,
  wat2wasm,
} from '@pierre/wat-tools';
import { beforeAll, describe, expect, test } from 'bun:test';

const wat = `
  ;; Explicit imports are deduplicated with the lexer driver.
  (module $numbers
    (import "@pierre/wat-tools/common.wat")
    (import "@pierre/wat-tools/sig.wat")
    (memory-region $mem.customState 32 256)
    (global (export "scratchPtr") i32 (i32.const $mem.customState))
    (func $highlight
      (local $start i32)
      (block $done
        (loop $next
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $start (global.get $ptr))
          (if (call $lexIsDigit (i32.load8_u (global.get $ptr)))
            (then
              (call $lexScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $start) (global.get $ptr)))
            (else
              (global.set $ptr (call $utf8SpanEnd
                (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
              (call $emitTok (enum.get $Token.none) (local.get $start) (global.get $ptr))))
          (br $next)))))
`;

interface LexerExports {
  memory: WebAssembly.Memory;
  inputPtr: WebAssembly.Global;
  scratchPtr: WebAssembly.Global;
  lex: () => void;
  lexStream: (reset: number) => void;
}

describe('buildHighlightsLexer', () => {
  let lexer: LexerExports;
  let compiledModule: WebAssembly.Module;
  let language: ReturnType<typeof buildHighlightsLexer>;

  beforeAll(() => {
    language = buildHighlightsLexer({
      name: 'numbers',
      alias: { nums: 0 },
      wat,
    });
    compiledModule = new WebAssembly.Module(
      Buffer.from(language.wasm, 'base64')
    );
    lexer = new WebAssembly.Instance(compiledModule)
      .exports as unknown as LexerExports;
  });

  test('creates a standalone descriptor with local aliases', () => {
    expect(language.name).toBe('numbers');
    expect(language.aliases).toEqual({ numbers: 0, nums: 0 });
    expect(WebAssembly.Module.imports(compiledModule)).toEqual([]);
    expect(
      WebAssembly.Module.exports(compiledModule)
        .map(({ name }) => name)
        .sort()
    ).toEqual(['inputPtr', 'lex', 'lexStream', 'memory', 'scratchPtr']);
    expect(Number(lexer.scratchPtr.value) % 256).toBe(0);
    expect(Number(lexer.inputPtr.value)).toBeGreaterThan(
      Number(lexer.scratchPtr.value) + 31
    );
  });

  test('writes UTF-8 byte offsets and token types without theme or HTML state', () => {
    const source = new TextEncoder().encode('x 42 café');
    const input = Number(lexer.inputPtr.value);
    new Uint8Array(lexer.memory.buffer).set(source, input);
    new DataView(lexer.memory.buffer).setUint32(2, source.length, true);
    lexer.lex();
    const view = new DataView(lexer.memory.buffer);
    const out = view.getUint32(6, true);
    const length = view.getUint32(10, true);
    expect([...new Uint32Array(lexer.memory.buffer, out, length / 4)]).toEqual([
      2, 0, 4, 24, 10, 0,
    ]);
    expect(Number(lexer.inputPtr.value)).toBeLessThan(65536);
  });

  test('resets output when the same instance is reused', () => {
    const input = Number(lexer.inputPtr.value);
    new Uint8Array(lexer.memory.buffer).set(
      new TextEncoder().encode('7'),
      input
    );
    new DataView(lexer.memory.buffer).setUint32(2, 1, true);
    lexer.lex();
    const view = new DataView(lexer.memory.buffer);
    expect(view.getUint32(10, true)).toBe(8);
    expect([
      ...new Uint32Array(lexer.memory.buffer, view.getUint32(6, true), 2),
    ]).toEqual([1, 24]);
  });

  test('accepts a function body without a module', () => {
    const plain = buildHighlightsLexer({
      name: 'plain-custom',
      wat: '(func $highlight)',
    });
    expect(WebAssembly.validate(Buffer.from(plain.wasm, 'base64'))).toBe(true);
  });

  test('preserves leading gaps for the parent lexer', () => {
    const language = buildHighlightsLexer({
      name: 'gaps',
      wat: `(func $highlight
        (call $emitGap (global.get $ptr) (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.keyword)
          (i32.add (global.get $ptr) (i32.const 1))
          (i32.sub (global.get $end) (i32.const 1))))`,
    });
    const lexer = new WebAssembly.Instance(
      new WebAssembly.Module(Buffer.from(language.wasm, 'base64'))
    ).exports as unknown as LexerExports;
    const input = Number(lexer.inputPtr.value);
    new Uint8Array(lexer.memory.buffer).set(
      new TextEncoder().encode(' key '),
      input
    );
    new DataView(lexer.memory.buffer).setUint32(2, 5, true);
    lexer.lex();
    const view = new DataView(lexer.memory.buffer);
    const out = view.getUint32(6, true);
    expect(view.getUint32(10, true)).toBe(16);
    expect([...new Uint32Array(lexer.memory.buffer, out, 4)]).toEqual([
      1, 255, 4, 17,
    ]);
  });

  test('rejects descriptors that cannot be selected safely', () => {
    expect(() => buildHighlightsLexer({ name: 'Bad Name', wat })).toThrow(
      'Invalid language name'
    );
    expect(() =>
      buildHighlightsLexer({ name: 'good', alias: { bad: 1 }, wat })
    ).toThrow('entry 0');
    expect(() =>
      buildHighlightsLexer({ name: 'good', wat: '(module)' })
    ).toThrow('$highlight');
  });
});

test('memory regions reserve their own aligned storage and leave input last', () => {
  const { constMap, code } = resolveConsts(
    allocateMemory(`
    (memory-region $mem.input 0 16)
    (memory-region $mem.keywordPool 16384)
    (memory-region $mem.customStack 65536 256)
    (memory-region $mem.themeTable 512)
    (memory (memory-pages))
  `),
    'memory test'
  );
  expect(constMap.get('$mem.themeTable')).toBe(64);
  expect(constMap.get('$mem.customStack')).toBe(768);
  expect(constMap.get('$mem.keywordPool')).toBe(66304);
  expect(constMap.get('$mem.input')).toBe(82688);
  expect(code).toContain('(memory 2)');
  expect(() => allocateMemory('(memory-region $mem.bad 32 3)')).toThrow(
    'alignment'
  );
  expect(() =>
    allocateMemory('(memory-region $mem.a 4) (memory-region $mem.a 4)')
  ).toThrow('Duplicate');
});

test('parses adjacent and multiline imports without consuming module boundaries', () => {
  const { code, imports } = flattenWat(
    new URL('inline.wat', import.meta.url),
    `(module
    (import "env" "one" (func $one)) (import "env" "two"
      (func $two (param i32))))`
  );
  expect(imports.length).toBe(2);
  expect(
    WebAssembly.validate(
      wat2wasm(
        'inline.wat',
        code.replace('(module', `(module ${imports.join(' ')}`)
      )
    )
  ).toBe(true);
  expect(() => splitTopLevelForms('(module))')).toThrow(
    'unexpected closing parenthesis'
  );
});

test('func-variant copies a function, fixes globals, and renames calls', () => {
  const { code } = transformWat(
    new URL('variant.wat', import.meta.url),
    `(module
      (global $flag i32 (i32.const 0))
      (func $helper (result i32) (i32.const 1))
      (func $base (result i32) (i32.add (global.get $flag) (call $helper)))
      (func-variant $helperCopy $helper)
      (func-variant $copy $base (global $flag 1) (call $helper $helperCopy)))`
  );
  expect(code).toContain(
    '(func $copy (result i32) (i32.add (i32.const 1) (call $helperCopy)))'
  );
  // An exact copy ends with a nop, or Binaryen merges it with its base.
  expect(code).toMatch(
    /\(func \$helperCopy \(result i32\) \(i32\.const 1\)\s+\(nop\)\)/
  );
  expect(code).toContain(
    '(func $base (result i32) (i32.add (global.get $flag) (call $helper)))'
  );
});
