// Types for the generated wasm artifacts that scripts/build.ts writes next to
// the compiled glue in dist/: workerd imports the .wasm module directly, and
// index imports the wasm as a base64 string from the .wasm.mjs module.
declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module '*.wasm.mjs' {
  const wasmBase64: string;
  export default wasmBase64;
}
