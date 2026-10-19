let canUseWASMResult: boolean | undefined;

/**
 * Whether WebAssembly, including SIMD, can be compiled and instantiated
 * synchronously. The `highlights` and `shiki-wasm` highlighters need
 * WebAssembly, so use this to fall back to `shiki-js` in environments that lack
 * it or block it (for example, a CSP without `wasm-unsafe-eval`). SIMD is
 * required because `highlights` uses it; engines without it (such as Safari
 * before 16.4) report false. The result is cached after the first call.
 */
export function canUseWASM(): boolean {
  return (canUseWASMResult ??= probeWASM());
}

function probeWASM(): boolean {
  try {
    if (typeof WebAssembly !== 'object') {
      return false;
    }
    // A module with one function, `(func (result v128) i32.const 0
    // i8x16.splat i8x16.popcnt)`. Compiling it fails without SIMD support, and
    // compiling or instantiating fails when a CSP blocks WebAssembly.
    const wasmModule = new WebAssembly.Module(
      new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60,
        0x00, 0x01, 0x7b, 0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00,
        0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
      ])
    );
    new WebAssembly.Instance(wasmModule);
    return true;
  } catch {
    return false;
  }
}
