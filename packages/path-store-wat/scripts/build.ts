import {
  checkDataSegments,
  expandEnumGetsAndStrings,
  expandEnums,
  flattenWat,
  optimizeWasm as optimize,
  resolveConsts,
  wat2wasm,
  wrapCompoundNegations,
} from '@pierre/wat-tools';
import type { EnumMap } from '@pierre/wat-tools';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

export { wasmToText, wat2wasm } from '@pierre/wat-tools';

/** Binaryen -O3 with the shrink level the other WAT packages use. */
export function optimizeWasm(wasmBytes: Uint8Array): Uint8Array {
  return optimize(wasmBytes, {
    filename: 'path-store.wat',
    shrinkLevel: 1,
  });
}

/** The expanded module text and resolved enums. */
export interface TransformedWat {
  code: string;
  enumMap: EnumMap;
  imports: string[];
}

/**
 * Transform WAT source: inline local imports, expand enums, resolve named
 * constants (`const`; see `src/memory.wat`), convert string operands of
 * `i32.const`/`i64.const`, and re-insert the lifted host imports.
 * `content` is the wat text; it is read from `url` when omitted.
 */
export function transformWat(
  url: string | URL,
  content?: string
): TransformedWat {
  if (!(url instanceof URL)) url = pathToFileURL(url);
  content ??= readFileSync(url, 'utf-8');
  const enumMap: EnumMap = new Map();
  const flattened = flattenWat(url, content);
  let code = expandEnums(flattened.code, enumMap);
  code = resolveConsts(code, url.pathname).code;
  code = expandEnumGetsAndStrings(code, enumMap, url.pathname);
  code = wrapCompoundNegations(code);
  // The control block is the only static region; data segments must stay
  // below the heap.
  checkDataSegments(code, url.pathname, 4096);
  if (flattened.imports.length > 0) {
    code = code.replace(
      /^\(module/,
      `(module\n${flattened.imports.join('\n')}`
    );
  }
  return { code, enumMap, imports: flattened.imports };
}

if (import.meta.main) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  const sourceUrl = new URL('../src/path-store.wat', moduleUrl);
  const { code } = transformWat(sourceUrl);
  const wasmBytes = optimizeWasm(wat2wasm(sourceUrl.pathname, code));
  mkdirSync(new URL('../dist/', moduleUrl), { recursive: true });
  writeFileSync(new URL('../dist/path-store.wasm', moduleUrl), wasmBytes);
  writeFileSync(
    new URL('../dist/path-store.wasm.mjs', moduleUrl),
    `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
      `const b = new Uint8Array(s.length);\n` +
      `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
      `export default b;\n`,
    'utf-8'
  );
  console.log(
    `Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${wasmBytes.length} bytes, gzipped: ${gzipSync(wasmBytes, { level: 9 }).length} bytes)`
  );
}
