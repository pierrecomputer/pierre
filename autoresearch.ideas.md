## Active Ideas

- **Numeric-ID internal representation**: Use integer node IDs for all internal
  Map/Set operations during buildPathGraph (folderChildren keyed by number,
  parentChildren as Set<number>). Convert to path-based string keys only when
  emitting final tree nodes. Would eliminate string hashing overhead for ~200K+
  Map/Set operations. Major refactor; needs path→numericId Map plus idToPath
  array. Estimated savings: ~5-8ms from faster Map/Set ops.

- **Incremental FNV-1a during buildPathGraph with Symbol storage**: Compute hash
  values incrementally during segment scanning (extending from prefix hash via
  hashStack). Store the raw hash number on each node via a Symbol property.
  hashTreeKeys would then only need toString(36) + template literal per key,
  avoiding the full FNV-1a loop. Estimated savings: ~4ms from fewer character
  hash ops. Complex interaction with prefix reuse.

## Evaluated / Exhausted Approaches

- ❌ Precomputed hashes via Map (Map.get offsets savings)
- ❌ Monotonic IDs (breaks expanded state stability)
- ❌ Native hash functions / Bun.hash (JS-native call overhead)
- ❌ FNV-1a loop unrolling (JSC already optimizes)
- ❌ Intl.Collator for sorting (slower per-comparison)
- ❌ sortChildren fast paths for small arrays (negligible)
- ❌ Two-pass hashTreeKeys (extra Map.get per key)
- ❌ Pre-sorting input paths (sort cost > sharing gains)
- ❌ Cached/reused sorted children arrays (5 attempts, always regressed)
- ❌ Segment-level trie (too complex for uncertain gain)
- ❌ TextEncoder+Uint8Array hashing (encodeInto overhead)
- ❌ sortChildrenSet accepting Sets directly (spread is fast)
- ❌ Parallel-array sort (no benefit vs decorated objects in JSC)
- ❌ Object.fromEntries batch output (tuple alloc offsets benefit)
- ❌ Separated file/folder loops in hashTreeKeys (breaks JIT monomorphism)
