---
name: performance
description:
  Use when changing loops, collection processing, invalidation logic, tree/diff
  traversal, path scanning, virtualized rendering calculations, or any code
  where repeated scans or boolean control flow affect performance or
  correctness.
---

# Performance

Avoid nested loops and O(n^2) operations unless there is a clear reason.

- Calculate expensive values once before a loop, not inside it.
- Prefer precomputed maps, sets, indexes, or a single backward scan over nested
  repeated scans.
- If you need to know whether meaningful elements remain, compute that boundary
  once before the main loop.

Example of the preferred pattern:

```typescript
let lastMeaningfulIndex = items.length - 1;
for (let i = items.length - 1; i >= 0; i--) {
  if (items[i].someCondition) {
    lastMeaningfulIndex = i;
    break;
  }
}

for (let i = 0; i <= lastMeaningfulIndex; i++) {
  const isLast = i === lastMeaningfulIndex;
  // ...
}
```

After changing boolean logic or invalidation paths, simplify the final control
flow before calling the work done. If code is already inside `if (foo)`, do not
keep `|| foo` in assignments inside that block.
