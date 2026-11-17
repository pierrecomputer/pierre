declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '*.wasm.mjs' {
  const wasmBytes: Uint8Array<ArrayBuffer>;
  export default wasmBytes;
}
