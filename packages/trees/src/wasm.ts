// WebAssembly store engine. A separate entry so the default bundle never
// carries the wasm module; import it where large trees are built:
//
//   import { wasmEngine } from '@pierre/trees/wasm';
//   new FileTree({ engine: wasmEngine, preparedInput, ... });

import { PathStore as WasmPathStore } from '@pierre/path-store-wat';

import type { FileTreeEngine } from './engine';
import { createFileTreeEngine } from './model/engine';
import type { FileTreePreparedInput } from './preparedInput';

/** Store engine that builds and mutates the tree inside WebAssembly memory. */
export const wasmEngine: FileTreeEngine = createFileTreeEngine({
  createStore: (options) => new WasmPathStore(options),
});

/**
 * Prepared input from newline-delimited UTF-8 bytes already in tree order
 * (a trailing '/' marks an explicit directory). With `wasmEngine` the bytes
 * are ingested as-is, skipping both JSON parsing and the per-path string
 * copy; the default engine decodes them on demand.
 */
export function preparePresortedFileTreeBytes(
  bytes: Uint8Array
): FileTreePreparedInput {
  return WasmPathStore.preparePresortedBytes(bytes) as FileTreePreparedInput;
}
