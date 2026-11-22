declare const FILE_TREE_ENGINE: unique symbol;

/**
 * Opaque handle for the store engine a tree builds its paths with. The default
 * engine is the JavaScript path store; `@pierre/trees/wasm` exports a
 * WebAssembly engine that ingests large path lists several times faster.
 */
export interface FileTreeEngine {
  readonly [FILE_TREE_ENGINE]: true;
}
