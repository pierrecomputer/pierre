(module
  (import "./memory.wat")

  ;; meta = depth << 8 | flags
  (const $F.explicit 1)
  (const $F.root 2)
  (const $F.removed 4)
  (const $F.dir 8)
  (const $F.override 16)   ;; expansion differs from the default
  (const $F.expanded 32)   ;; the override value
  (const $F.depthShift 8)
  (const $F.dirRootRemoved 14)

  ;; chunked visible sums for wide directories, same shape as child-index.ts
  (const $CHUNK.shift 5)
  (const $CHUNK.size 32)
  (const $CHUNK.threshold 128)

  (global $flatten (mut i32) (i32.const 0))
  ;; 0 closed, 1 open, n + 2 = open up to depth n
  (global $defaultExpansion (mut i32) (i32.const 0))
  (global $collapsedOverrides (mut i32) (i32.const 0))
  (global $collapseNewDirs (mut i32) (i32.const 0))
  (global $activeNodeCount (mut i32) (i32.const 0))

  ;; --- node field access -------------------------------------------------

  (func $meta (param $id i32) (result i32)
    (call $get (i32.const $A.meta) (local.get $id)))

  (func $hasFlag (param $id i32) (param $f i32) (result i32)
    (i32.ne (i32.and (call $meta (local.get $id)) (local.get $f)) (i32.const 0)))

  (func $addFlag (param $id i32) (param $f i32)
    (call $set (i32.const $A.meta) (local.get $id) (i32.or (call $meta (local.get $id)) (local.get $f))))

  (func $clearFlag (param $id i32) (param $f i32)
    (call $set (i32.const $A.meta) (local.get $id) (i32.and (call $meta (local.get $id)) (i32.xor (local.get $f) (i32.const -1)))))

  (func $isDir (param $id i32) (result i32)
    (call $hasFlag (local.get $id) (i32.const $F.dir)))

  (func $isRoot (param $id i32) (result i32)
    (call $hasFlag (local.get $id) (i32.const $F.root)))

  (func $isLive (param $id i32) (result i32)
    (i32.and (i32.lt_u (local.get $id) (call $len (i32.const $A.parent)))
      (i32.eqz (call $hasFlag (local.get $id) (i32.const $F.removed)))))

  (func $depth (param $id i32) (result i32)
    (i32.shr_u (call $meta (local.get $id)) (i32.const $F.depthShift)))

  (func $setDepth (param $id i32) (param $d i32)
    (call $set (i32.const $A.meta) (local.get $id)
      (i32.or (i32.shl (local.get $d) (i32.const $F.depthShift))
        (i32.and (call $meta (local.get $id)) (i32.const 255)))))

  (func $parentOf (param $id i32) (result i32)
    (call $get (i32.const $A.parent) (local.get $id)))

  (func $nameOf (param $id i32) (result i32)
    (call $get (i32.const $A.name) (local.get $id)))

  (func $subtreeOf (param $id i32) (result i32)
    (call $get (i32.const $A.subtree) (local.get $id)))

  (func $visibleOf (param $id i32) (result i32)
    (call $get (i32.const $A.visible) (local.get $id)))

  ;; directory record index of a directory node
  (func $dirOf (param $id i32) (result i32)
    (call $get (i32.const $A.dir) (local.get $id)))

  (func $dChildCount (param $d i32) (result i32)
    (call $get (i32.const $A.dChildCount) (local.get $d)))

  ;; address of the first child id of directory record $d
  (func $dChildren (param $d i32) (result i32)
    (i32.add (call $base (i32.const $A.pool))
      (i32.shl (call $get (i32.const $A.dChildBase) (local.get $d)) (i32.const 2))))

  (func $childAt (param $d i32) (param $i i32) (result i32)
    (i32.load (i32.add (call $dChildren (local.get $d)) (i32.shl (local.get $i) (i32.const 2)))))

  ;; --- expansion ---------------------------------------------------------

  (func $expandedByDefault (param $id i32) (result i32)
    (if (call $isRoot (local.get $id)) (then (return (i32.const 1))))
    (if (i32.eq (global.get $defaultExpansion) (i32.const 1)) (then (return (i32.const 1))))
    (if (i32.eqz (global.get $defaultExpansion)) (then (return (i32.const 0))))
    (i32.le_u (call $depth (local.get $id)) (i32.sub (global.get $defaultExpansion) (i32.const 2))))

  (func $isExpanded (param $id i32) (result i32)
    (local $m i32)
    (local.set $m (call $meta (local.get $id)))
    (if (i32.eqz (i32.and (local.get $m) (i32.const $F.dir))) (then (return (i32.const 0))))
    (if (i32.and (i32.eq (global.get $defaultExpansion) (i32.const 1)) (i32.eqz (global.get $collapsedOverrides)))
      (then (return (i32.const 1))))
    (if (i32.and (local.get $m) (i32.const $F.override))
      (then (return (i32.ne (i32.and (local.get $m) (i32.const $F.expanded)) (i32.const 0)))))
    (call $expandedByDefault (local.get $id)))

  ;; store an expansion override only where it differs from the default
  (func $setExpanded (param $id i32) (param $v i32)
    (local $m i32) (local $def i32) (local $old i32)
    (local.set $m (call $meta (local.get $id)))
    (if (i32.eqz (i32.and (local.get $m) (i32.const $F.dir))) (then (return)))
    (local.set $def (call $expandedByDefault (local.get $id)))
    (local.set $v (i32.ne (local.get $v) (i32.const 0)))
    (if (i32.and (local.get $m) (i32.const $F.override))
      (then
        (local.set $old (i32.ne (i32.and (local.get $m) (i32.const $F.expanded)) (i32.const 0)))
        (if (i32.eqz (local.get $old)) (then (global.set $collapsedOverrides (i32.sub (global.get $collapsedOverrides) (i32.const 1)))))
        (local.set $m (i32.and (local.get $m) (i32.xor (i32.const $F.override+32) (i32.const -1))))))
    (if (i32.ne (local.get $v) (local.get $def))
      (then
        (local.set $m (i32.or (local.get $m) (i32.const $F.override)))
        (if (local.get $v)
          (then (local.set $m (i32.or (local.get $m) (i32.const $F.expanded))))
          (else (global.set $collapsedOverrides (i32.add (global.get $collapsedOverrides) (i32.const 1)))))))
    (call $set (i32.const $A.meta) (local.get $id) (local.get $m)))

  ;; --- flattening --------------------------------------------------------

  ;; the sole child directory a non-root directory flattens into, or -1
  (func $flattenedChild (param $id i32) (result i32)
    (local $m i32) (local $d i32) (local $c i32)
    (if (i32.eqz (global.get $flatten)) (then (return (i32.const -1))))
    (local.set $m (call $meta (local.get $id)))
    (if (i32.ne (i32.and (local.get $m) (i32.const $F.dirRootRemoved)) (i32.const $F.dir)) (then (return (i32.const -1))))
    (local.set $d (call $dirOf (local.get $id)))
    (if (i32.ne (call $dChildCount (local.get $d)) (i32.const 1)) (then (return (i32.const -1))))
    (local.set $c (call $childAt (local.get $d) (i32.const 0)))
    (select (local.get $c) (i32.const -1) (call $isDir (local.get $c))))

  (func $flattenTerminal (param $id i32) (result i32)
    (local $next i32)
    (loop $walk
      (local.set $next (call $flattenedChild (local.get $id)))
      (if (i32.ne (local.get $next) (i32.const -1))
        (then (local.set $id (local.get $next)) (br $walk))))
    (local.get $id))

  ;; --- counts ------------------------------------------------------------

  ;; chunk sums live in the pool next to the child list; their capacity
  ;; follows the child capacity so a rebuild never allocates
  (func $chunkCapOf (param $d i32) (result i32)
    (i32.shr_u (i32.add (call $get (i32.const $A.dChildCap) (local.get $d)) (i32.const $CHUNK.size-1)) (i32.const $CHUNK.shift)))

  ;; recompute the 32-child visible sums of directory record $d
  (func $rebuildChunks (param $d i32)
    (local $n i32) (local $chunks i32) (local $i i32) (local $kids i32) (local $sums i32) (local $poolBase i32)
    (local $visibleBase i32)
    (local.set $n (call $dChildCount (local.get $d)))
    (if (i32.lt_u (local.get $n) (i32.const $CHUNK.threshold))
      (then (call $set (i32.const $A.dChunk) (local.get $d) (i32.const -1)) (return)))
    (local.set $chunks (i32.shr_u (i32.add (local.get $n) (i32.const $CHUNK.size-1)) (i32.const $CHUNK.shift)))
    (if (i32.eq (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const -1))
      (then
        (call $set (i32.const $A.dChunk) (local.get $d) (call $poolAlloc (call $chunkCapOf (local.get $d))))))
    (local.set $poolBase (call $base (i32.const $A.pool)))
    (local.set $sums (i32.add (local.get $poolBase) (i32.shl (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const 2))))
    (memory.fill (local.get $sums) (i32.const 0) (i32.shl (local.get $chunks) (i32.const 2)))
    (local.set $kids (i32.add (local.get $poolBase) (i32.shl (call $get (i32.const $A.dChildBase) (local.get $d)) (i32.const 2))))
    (local.set $visibleBase (call $base (i32.const $A.visible)))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (i32.store
          (i32.add (local.get $sums) (i32.shl (i32.shr_u (local.get $i) (i32.const $CHUNK.shift)) (i32.const 2)))
          (i32.add
            (i32.load (i32.add (local.get $sums) (i32.shl (i32.shr_u (local.get $i) (i32.const $CHUNK.shift)) (i32.const 2))))
            (i32.load (i32.add (local.get $visibleBase)
              (i32.shl (i32.load (i32.add (local.get $kids) (i32.shl (local.get $i) (i32.const 2)))) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each))))

  ;; reserve $n i32 slots at the end of the pool and return their offset
  (func $poolAlloc (param $n i32) (result i32)
    (local $at i32)
    (local.set $at (call $len (i32.const $A.pool)))
    (call $arrReserve (i32.const $A.pool) (i32.add (local.get $at) (local.get $n)))
    (call $setLen (i32.const $A.pool) (i32.add (local.get $at) (local.get $n)))
    (local.get $at))

  ;; recompute the child totals of directory record $d from its children
  (func $rebuildAggregates (param $d i32)
    (local $n i32) (local $i i32) (local $kids i32) (local $c i32) (local $sub i32) (local $vis i32)
    (local.set $n (call $dChildCount (local.get $d)))
    (local.set $kids (call $dChildren (local.get $d)))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $c (i32.load (i32.add (local.get $kids) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $sub (i32.add (local.get $sub) (call $subtreeOf (local.get $c))))
        (local.set $vis (i32.add (local.get $vis) (call $visibleOf (local.get $c))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (call $set (i32.const $A.dTotalSubtree) (local.get $d) (local.get $sub))
    (call $set (i32.const $A.dTotalVisible) (local.get $d) (local.get $vis))
    (call $rebuildChunks (local.get $d)))

  ;; add a child's count deltas to its directory's totals; when the child
  ;; sits in the list ($inList) its chunk sum absorbs the visible delta,
  ;; otherwise the caller rebuilds the chunks after editing the list
  (func $applyAggregateDelta (param $d i32) (param $child i32) (param $dSub i32) (param $dVis i32) (param $inList i32)
    (local $sums i32)
    (call $set (i32.const $A.dTotalSubtree) (local.get $d)
      (i32.add (call $get (i32.const $A.dTotalSubtree) (local.get $d)) (local.get $dSub)))
    (call $set (i32.const $A.dTotalVisible) (local.get $d)
      (i32.add (call $get (i32.const $A.dTotalVisible) (local.get $d)) (local.get $dVis)))
    (if (i32.and (i32.and (local.get $inList) (i32.ne (local.get $dVis) (i32.const 0)))
                 (i32.ne (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const -1)))
      (then
        (local.set $sums (i32.add
          (i32.add (call $base (i32.const $A.pool)) (i32.shl (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const 2)))
          (i32.shl (i32.shr_u (call $get (i32.const $A.pos) (local.get $child)) (i32.const $CHUNK.shift)) (i32.const 2))))
        (i32.store (local.get $sums) (i32.add (i32.load (local.get $sums)) (local.get $dVis))))))

  ;; the visible rows a directory contributes given its child total
  (func $dirVisibleCount (param $id i32) (param $totalVisible i32) (result i32)
    (if (call $isRoot (local.get $id)) (then (return (local.get $totalVisible))))
    (if (i32.ne (call $flattenedChild (local.get $id)) (i32.const -1)) (then (return (local.get $totalVisible))))
    (select (i32.add (local.get $totalVisible) (i32.const 1)) (i32.const 1) (call $isExpanded (local.get $id))))

  ;; recompute one node's counts from its directory aggregates
  (func $recomputeNodeCounts (param $id i32)
    (local $d i32)
    (if (i32.eqz (call $isDir (local.get $id)))
      (then
        (call $set (i32.const $A.subtree) (local.get $id) (i32.const 1))
        (call $set (i32.const $A.visible) (local.get $id) (i32.const 1))
        (return)))
    (local.set $d (call $dirOf (local.get $id)))
    (call $set (i32.const $A.subtree) (local.get $id)
      (i32.add (call $get (i32.const $A.dTotalSubtree) (local.get $d)) (i32.const 1)))
    (call $set (i32.const $A.visible) (local.get $id)
      (call $dirVisibleCount (local.get $id) (call $get (i32.const $A.dTotalVisible) (local.get $d)))))

  ;; propagate count changes from $id up to the root
  (func $recomputeUpward (param $id i32)
    (local $prevSub i32) (local $prevVis i32) (local $dSub i32) (local $dVis i32) (local $parent i32)
    (loop $up
      (local.set $prevSub (call $subtreeOf (local.get $id)))
      (local.set $prevVis (call $visibleOf (local.get $id)))
      (call $recomputeNodeCounts (local.get $id))
      (if (call $isRoot (local.get $id)) (then (return)))
      (local.set $dSub (i32.sub (call $subtreeOf (local.get $id)) (local.get $prevSub)))
      (local.set $dVis (i32.sub (call $visibleOf (local.get $id)) (local.get $prevVis)))
      (local.set $parent (call $parentOf (local.get $id)))
      (if (i32.or (local.get $dSub) (local.get $dVis))
        (then (call $applyAggregateDelta (call $dirOf (local.get $parent)) (local.get $id) (local.get $dSub) (local.get $dVis) (i32.const 1))))
      (local.set $id (local.get $parent))
      (br $up)))

  ;; Full count sweep for a freshly ingested tree (ids are in preorder, so a
  ;; reverse pass finalizes children before parents). Directory aggregates
  ;; double as accumulators. Chunk sums are built for wide directories and
  ;; for the root, as initializeOpenVisibleCounts does.
  (func $initCounts
    (local $n i32) (local $i i32) (local $d i32) (local $parent i32) (local $vis i32) (local $sub i32)
    (local $metaBase i32) (local $parentBase i32) (local $dirBase i32) (local $subBase i32) (local $visBase i32)
    (local $totSubBase i32) (local $totVisBase i32) (local $m i32) (local $o i32) (local $pd i32)
    (local.set $n (call $len (i32.const $A.parent)))
    (local.set $d (call $len (i32.const $A.dNode)))
    (memory.fill (call $base (i32.const $A.dTotalSubtree)) (i32.const 0) (i32.shl (local.get $d) (i32.const 2)))
    (memory.fill (call $base (i32.const $A.dTotalVisible)) (i32.const 0) (i32.shl (local.get $d) (i32.const 2)))
    (local.set $metaBase (call $base (i32.const $A.meta)))
    (local.set $parentBase (call $base (i32.const $A.parent)))
    (local.set $dirBase (call $base (i32.const $A.dir)))
    (local.set $subBase (call $base (i32.const $A.subtree)))
    (local.set $visBase (call $base (i32.const $A.visible)))
    (local.set $totSubBase (call $base (i32.const $A.dTotalSubtree)))
    (local.set $totVisBase (call $base (i32.const $A.dTotalVisible)))
    (local.set $i (i32.sub (local.get $n) (i32.const 1)))
    (block $done
      (loop $each
        (br_if $done (i32.eqz (local.get $i)))
        (local.set $o (i32.shl (local.get $i) (i32.const 2)))
        (local.set $m (i32.load (i32.add (local.get $metaBase) (local.get $o))))
        (if (i32.and (local.get $m) (i32.const $F.removed))
          (then
            (local.set $i (i32.sub (local.get $i) (i32.const 1)))
            (br $each)))
        (if (i32.and (local.get $m) (i32.const $F.dir))
          (then
            (local.set $d (i32.shl (i32.load (i32.add (local.get $dirBase) (local.get $o))) (i32.const 2)))
            (local.set $sub (i32.add (i32.load (i32.add (local.get $totSubBase) (local.get $d))) (i32.const 1)))
            (local.set $vis (call $dirVisibleCount (local.get $i) (i32.load (i32.add (local.get $totVisBase) (local.get $d)))))
            ;; chunk sums read child visible counts, which are final here
            (if (i32.ge_u (call $dChildCount (i32.shr_u (local.get $d) (i32.const 2))) (i32.const $CHUNK.threshold))
              (then (call $rebuildChunks (i32.shr_u (local.get $d) (i32.const 2))))))
          (else
            (local.set $sub (i32.const 1))
            (local.set $vis (i32.const 1))))
        (i32.store (i32.add (local.get $subBase) (local.get $o)) (local.get $sub))
        (i32.store (i32.add (local.get $visBase) (local.get $o)) (local.get $vis))
        (local.set $pd (i32.shl
          (i32.load (i32.add (local.get $dirBase) (i32.shl (i32.load (i32.add (local.get $parentBase) (local.get $o))) (i32.const 2))))
          (i32.const 2)))
        (i32.store (i32.add (local.get $totSubBase) (local.get $pd))
          (i32.add (i32.load (i32.add (local.get $totSubBase) (local.get $pd))) (local.get $sub)))
        (i32.store (i32.add (local.get $totVisBase) (local.get $pd))
          (i32.add (i32.load (i32.add (local.get $totVisBase) (local.get $pd))) (local.get $vis)))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (br $each)))
    ;; root
    (local.set $d (call $dirOf (i32.const 0)))
    (call $set (i32.const $A.subtree) (i32.const 0) (i32.add (call $get (i32.const $A.dTotalSubtree) (local.get $d)) (i32.const 1)))
    (call $set (i32.const $A.visible) (i32.const 0) (call $get (i32.const $A.dTotalVisible) (local.get $d)))
    (call $rebuildChunks (local.get $d)))
)
