let canUseWASMResult: boolean | undefined;

/**
 * Whether WebAssembly can be compiled and instantiated synchronously. The
 * `highlights` and `shiki-wasm` highlighters need WebAssembly, so use this to
 * fall back to `shiki-js` in environments that lack it or block it (for
 * example, a CSP without `wasm-unsafe-eval`). The result is cached after the
 * first call.
 */
export function canUseWASM(): boolean {
  return (canUseWASMResult ??= probeWASM());
}

function probeWASM(): boolean {
  try {
    if (typeof WebAssembly !== 'object') {
      return false;
    }
    // The smallest valid module: the `\0asm` magic plus version 1.
    const wasmModule = new WebAssembly.Module(
      new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
    );
    new WebAssembly.Instance(wasmModule);
    return true;
  } catch {
    return false;
  }
}
