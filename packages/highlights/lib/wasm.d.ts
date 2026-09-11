// Types for the generated wasm artifacts that scripts/build.ts writes next to
// the compiled glue in dist/: workerd imports the .wasm module directly, and
// browser imports the base64 .wasm.mjs module.
declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '*.wasm.mjs' {
  const wasmBytes: Uint8Array;
  export default wasmBytes;
}
