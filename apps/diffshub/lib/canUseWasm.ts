let canUseWasmResult: boolean | undefined;

// Whether WebAssembly can be compiled and instantiated synchronously, which
// @pierre/highlights requires at import.
export function canUseWasm(): boolean {
  return (canUseWasmResult ??= probeWasm());
}

function probeWasm(): boolean {
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
