// Run a wasm32-wasip1 binary (such as a test binary) under Node's WASI, so
// `cargo test --target wasm32-wasip1` runs the wasm SIMD backend's tests.
// Cargo uses this as the target's runner (.cargo/config.toml).
import { readFile } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';
import { WASI } from 'node:wasi';

const wasi = new WASI({ version: 'preview1', args: argv.slice(2), env });
const module = await WebAssembly.compile(await readFile(argv[2]));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
exit(wasi.start(instance) ?? 0);
