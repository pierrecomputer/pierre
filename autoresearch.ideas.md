## Active Ideas

- **Numeric-ID internal representation**: Use integer node IDs for all internal
  Map/Set operations during buildPathGraph (folderChildren keyed by number,
  parentChildren as Set<number>). Convert to path-based string keys only when
  emitting final tree nodes. Would eliminate string hashing overhead for ~200K+
  Map/Set operations. Major refactor; needs path→numericId Map plus
  idToPath array.

- **Segment-level trie for folder children**: Instead of Map<string, Set<string>>
  for folderChildren, use a trie where each node stores just its segment name.
  Full paths are reconstructed on demand. Avoids full-path string keys in all
  internal lookups. Very complex but could reduce string operation overhead
  significantly.

## Evaluated / Exhausted Approaches

- ❌ **Precomputed hashes during buildPathGraph**: Map.get overhead for storing/
  retrieving precomputed hashes offset the FNV-1a savings. The internal string
  hash for Map lookup costs comparable time to the FNV-1a loop itself.

- ❌ **Monotonic IDs**: 16ms faster hashTreeKeys but breaks setFiles expanded
  state tracking (tests rely on content-based ID stability across file changes).

- ❌ **Native hash functions (Bun.hash.xxHash32)**: JS-to-native call overhead
  for 99K small strings exceeds per-byte speedup. FNV-1a in JIT-compiled JS is
  faster for many small-string calls.

- ❌ **Loop unrolling in hashId**: JSC already optimizes the simple loop. 4×
  unrolling showed no measurable improvement.

- ❌ **Intl.Collator for sorting**: Slower per-comparison than pre-lowered
  localeCompare. The O(n) toLowerCase savings don't offset O(n log n) slower
  comparisons.

- ❌ **sortChildren fast paths (small arrays)**: Negligible savings. Decorated
  sort is efficient even for 1-2 element arrays.

- ❌ **Two-pass hashTreeKeys**: Pre-computing all IDs then remapping adds an
  extra Map.get per key without saving work. Run 42 regressed ~7ms.

- ❌ **Pre-sorting input paths**: Sort cost (~23ms) exceeds prefix-sharing gains.
  Linux kernel fixture already has 64.4% natural locality.

- ❌ **Cached/reused sorted children arrays**: Tried 5 times (runs 5, 30, 36,
  43, and others). Cache management overhead consistently outweighs savings.
