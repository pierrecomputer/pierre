## Active Ideas

(No remaining ideas with clear estimated benefit. The function is near its
theoretical performance floor for a JS implementation with content-based hashing
and locale-aware sorting.)

## Evaluated / Exhausted Approaches

- ❌ Numeric-ID internal representation (number-keyed Map.get is not faster than
  string-keyed in JSC; pathToId overhead exceeds numeric Set savings)
- ❌ Precomputed hashes via Map (Map.get offsets FNV-1a savings)
- ❌ Monotonic IDs (breaks expanded state stability)
- ❌ Native hash functions / Bun.hash (JS-native call overhead)
- ❌ FNV-1a loop unrolling (JSC already optimizes)
- ❌ Intl.Collator for sorting (slower per-comparison)
- ❌ sortChildren fast paths for small arrays (negligible)
- ❌ Two-pass hashTreeKeys (extra Map.get per key)
- ❌ Pre-sorting input paths (sort cost > sharing gains; already 64% locality)
- ❌ Cached/reused sorted children arrays (5+ attempts, always regressed)
- ❌ Segment-level trie (too complex for uncertain gain)
- ❌ TextEncoder+Uint8Array hashing (encodeInto overhead)
- ❌ sortChildrenSet accepting Sets directly (spread is fast)
- ❌ Parallel-array sort (no benefit vs decorated objects in JSC)
- ❌ Object.fromEntries batch output (tuple alloc offsets benefit)
- ❌ Separated file/folder loops in hashTreeKeys (breaks JIT monomorphism)
- ❌ indexOf-based slash counting (call overhead = charCodeAt loop)
- ❌ Deferred toString(36) via NODE_HASH symbol (work just shifts stages)
- ❌ Pre-compute folder IDs in buildFolderNodes (net regression, work shifts)
- ❌ Single-file-segment fast path (no net improvement)
