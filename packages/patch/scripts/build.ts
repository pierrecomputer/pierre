import binaryen from 'binaryen';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'url';
import wabt from 'wabt';

const { parseWat } = await wabt();

/**
 * Transform WAT source:
 * - inline local `(import "./x.wat")` modules, each file once
 * - convert string operands of `i32.const` and `i64.const` to little-endian
 *   integer literals
 *
 * `content` is the wat text; it is read from `url` when omitted.
 */
export function transformWat(url: string | URL, content?: string): string {
  if (!(url instanceof URL)) url = pathToFileURL(url);
  content ??= readFileSync(url, 'utf-8');
  const imports: string[] = [];
  const seen = new Set([url.href]);
  const flatten = (moduleUrl: URL, source: string): string =>
    source.replace(/\(\s*import\s+"(\.+\/.+\.wat)"\s*\)/g, (_, path) => {
      const importUrl = new URL(path, moduleUrl);
      if (seen.has(importUrl.href)) return '';
      seen.add(importUrl.href);
      return flatten(importUrl, readFileSync(importUrl, 'utf-8')).replace(
        /^\s*\(\s*module\s+([\s\S]+)\s*\)\s*$/,
        '$1'
      );
    });
  let code = flatten(url, content)
    .replace(/(;;.+\s+)*\(\s*import +".+" +\( *func.+\)/g, (i) => {
      imports.push(i);
      return '';
    })
    .replace(/i(32|64).const\s+(".+?")/g, (_, bits, str) => {
      const chars = JSON.parse(str) as string;
      if (chars.length > 8) {
        throw new Error(`Cannot convert '${chars}' to an integer`);
      }
      const hex = chars
        .split('')
        .map((c) => c.charCodeAt(0).toString(16))
        .reverse()
        .join('');
      return `i${bits}.const 0x${hex}`;
    });
  if (imports.length > 0) {
    code = code.replace(
      /^\s*\(\s*module(\s+)/,
      `(module\n${imports.map((i) => '  ' + i).join('\n')}$1`
    );
  }
  return code;
}

/** Compile WAT text to a wasm binary with bulk memory and SIMD. */
export function wat2wasm(filename: string, text: string): Uint8Array {
  return parseWat(filename, text, { bulk_memory: true, simd: true }).toBinary(
    {}
  ).buffer;
}

/**
 * Optimize a wasm binary with binaryen (`wasm-opt -O3 --shrink-level=1
 * --one-caller-inline-max-size=250`) and the optimized Stack IR writer. The
 * pipeline runs three times: reading an optimized binary again lets the next
 * pass fold patterns that the previous one exposed.
 */
export function optimizeWasm(wasmBytes: Uint8Array): Uint8Array {
  binaryen.setOptimizeLevel(3);
  binaryen.setShrinkLevel(1);
  // keeps the two largest single-caller functions ($myers, $emitPatch) out of
  // the entry function: there, V8's register allocator slows the Myers loop
  // by up to 7% whenever unrelated code changes
  binaryen.setOneCallerInlineMaxSize(250);
  binaryen.setGenerateStackIR(true);
  binaryen.setOptimizeStackIR(true);
  for (let pass = 0; pass < 3; pass++) {
    const wasmModule = binaryen.readBinary(wasmBytes);
    try {
      // must match the features `wat2wasm` compiles with, so binaryen never
      // emits an instruction the target runtimes cannot execute
      wasmModule.setFeatures(
        binaryen.Features.BulkMemory |
          binaryen.Features.BulkMemoryOpt |
          binaryen.Features.SIMD128
      );
      if (wasmModule.validate() === 0) {
        throw new Error('binaryen rejected the module');
      }
      wasmModule.optimize();
      wasmBytes = wasmModule.emitBinary();
    } finally {
      wasmModule.dispose();
    }
  }
  return wasmBytes;
}

// Write dist/patch.{wat,wasm,wasm.mjs} and the wasm sizes in package.json `meta`.
if (import.meta.main) {
  const start = performance.now();
  const code = transformWat(new URL('../src/patch.wat', import.meta.url));
  const dist = new URL('../dist/', import.meta.url);
  mkdirSync(dist, { recursive: true });
  writeFileSync(new URL('patch.wat', dist), code);
  const wasmBytes = optimizeWasm(wat2wasm('patch.wat', code));
  writeFileSync(new URL('patch.wasm', dist), wasmBytes);
  writeFileSync(
    new URL('patch.wasm.mjs', dist),
    `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
      `const b = new Uint8Array(s.length);\n` +
      `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
      `export default b;\n`
  );
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8')) as {
    meta?: Record<string, number>;
  };
  pkg.meta = {
    'patch.wasm': wasmBytes.length,
    'patch.wasm.gz': gzipSync(wasmBytes, { level: 9 }).length,
  };
  writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n');
  console.log(
    `✨ Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${pkg.meta['patch.wasm']} bytes, gzipped: ${pkg.meta['patch.wasm.gz']} bytes)`
  );
}
