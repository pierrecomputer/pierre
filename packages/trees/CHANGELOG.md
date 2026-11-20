# Changelog

## Unreleased

- Add `@pierre/trees/wasm`: `wasmEngine` builds and mutates the tree inside
  WebAssembly memory for faster ingestion of large path lists, and
  `preparePresortedFileTreeBytes` ingests newline-delimited UTF-8 paths without
  a per-path string copy. Pass `engine: wasmEngine` to `FileTree`.

## 1.0.0

- Move `@pierre/trees` out of beta into its first stable release.
- Support React 18.3.1 and React 19, vanilla rendering, and SSR hydration
  through the four public entry points: `@pierre/trees`, `@pierre/trees/react`,
  `@pierre/trees/ssr`, and `@pierre/trees/web-components`.
- Remove the beta notice from the documentation overview.
