- Revisit “hash IDs from the start” but only with a **single global path→id
  map** populated during graph build (no extra per-stage remap work in
  folder/flatten builders). Previous variants that pre-hashed references during
  folder/flatten construction and two-pass remap both regressed.
- Prototype a compact path-graph representation that tracks parent pointers +
  segment names during ingestion, then materializes full path strings once when
  emitting final nodes. Goal: reduce repeated `${currentPath}/${part}` string
  concatenation in `buildPathGraph` without changing output semantics.
