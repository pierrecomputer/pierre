(module
  (import "./memory.wat")
  (import "./segments.wat")
  (import "./state.wat")
  (import "./ingest.wat")
  (import "./lookup.wat")
  (import "./projection.wat")
  (import "./compare.wat")

  ;; Host comparators: segment sort keys for non-ASCII names (JS lower-casing
  ;; and natural tokens), and whole-node compare for a custom sort option.
  (import "env" "compareSegments" (func $hostCompareSegments (param i32 i32) (result i32)))
  (import "env" "compareNodes" (func $hostCompareNodes (param i32 i32) (result i32)))

  (global $hostSort (mut i32) (i32.const 0))


  ;; sort-key compare of two segments, deferring non-ASCII names to the host
  (func $compareSegments (param $sa i32) (param $sb i32) (result i32)
    (if (i32.eq (local.get $sa) (local.get $sb)) (then (return (i32.const 0))))
    (if (i32.or (call $segNonAscii (local.get $sa)) (call $segNonAscii (local.get $sb)))
      (then (return (call $hostCompareSegments (local.get $sa) (local.get $sb)))))
    (call $natCompare (call $segPtr (local.get $sa)) (call $segLength (local.get $sa))
                      (call $segPtr (local.get $sb)) (call $segLength (local.get $sb))))

  ;; compareSiblingNodes: directories first, natural order, raw bytes, id
  (func $compareSiblings (param $a i32) (param $b i32) (result i32)
    (local $r i32) (local $sa i32) (local $sb i32)
    (if (global.get $hostSort) (then (return (call $hostCompareNodes (local.get $a) (local.get $b)))))
    (if (i32.ne (call $isDir (local.get $a)) (call $isDir (local.get $b)))
      (then (return (select (i32.const -1) (i32.const 1) (call $isDir (local.get $a))))))
    (local.set $sa (call $nameOf (local.get $a)))
    (local.set $sb (call $nameOf (local.get $b)))
    (local.set $r (call $compareSegments (local.get $sa) (local.get $sb)))
    (if (local.get $r) (then (return (local.get $r))))
    (if (i32.ne (local.get $sa) (local.get $sb))
      (then
        (local.set $r (call $memcmp (call $segPtr (local.get $sa)) (call $segLength (local.get $sa))
                                    (call $segPtr (local.get $sb)) (call $segLength (local.get $sb))))
        (if (local.get $r) (then (return (local.get $r))))))
    (select (i32.const -1) (i32.const 1) (i32.lt_u (local.get $a) (local.get $b))))

  ;; --- child list edits -------------------------------------------------------

  (func $findInsertIndex (param $d i32) (param $child i32) (result i32)
    (local $low i32) (local $high i32) (local $mid i32)
    (local.set $high (call $dChildCount (local.get $d)))
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $low) (local.get $high)))
        (local.set $mid (i32.shr_u (i32.add (local.get $low) (local.get $high)) (i32.const 1)))
        (if (i32.lt_s (call $compareSiblings (local.get $child) (call $childAt (local.get $d) (local.get $mid))) (i32.const 0))
          (then (local.set $high (local.get $mid)))
          (else (local.set $low (i32.add (local.get $mid) (i32.const 1)))))
        (br $search)))
    (local.get $low))

  ;; move directory $d's child list into a bigger pool block
  (func $childListGrow (param $d i32) (param $min i32)
    (local $cap i32) (local $next i32) (local $at i32) (local $n i32)
    (local.set $cap (call $get (i32.const $A.dChildCap) (local.get $d)))
    (if (i32.ge_u (local.get $cap) (local.get $min)) (then (return)))
    (local.set $next (i32.shl (local.get $cap) (i32.const 1)))
    (if (i32.lt_u (local.get $next) (local.get $min)) (then (local.set $next (local.get $min))))
    (if (i32.lt_u (local.get $next) (i32.const 4)) (then (local.set $next (i32.const 4))))
    (local.set $n (call $dChildCount (local.get $d)))
    (local.set $at (call $poolAlloc (local.get $next)))
    (if (local.get $n)
      (then (memory.copy
        (i32.add (call $base (i32.const $A.pool)) (i32.shl (local.get $at) (i32.const 2)))
        (call $dChildren (local.get $d))
        (i32.shl (local.get $n) (i32.const 2)))))
    (call $set (i32.const $A.dChildBase) (local.get $d) (local.get $at))
    (call $set (i32.const $A.dChildCap) (local.get $d) (local.get $next))
    ;; chunk sums are sized from the capacity; reallocate on the next rebuild
    (call $set (i32.const $A.dChunk) (local.get $d) (i32.const -1)))

  (func $updatePositionsFrom (param $d i32) (param $from i32)
    (local $kids i32) (local $n i32)
    (local.set $kids (call $dChildren (local.get $d)))
    (local.set $n (call $dChildCount (local.get $d)))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $from) (local.get $n)))
        (call $set (i32.const $A.pos) (i32.load (i32.add (local.get $kids) (i32.shl (local.get $from) (i32.const 2)))) (local.get $from))
        (local.set $from (i32.add (local.get $from) (i32.const 1)))
        (br $each))))

  (func $insertChildRef (param $parent i32) (param $child i32)
    (local $d i32) (local $idx i32) (local $n i32) (local $kids i32)
    (local.set $d (call $dirOf (local.get $parent)))
    (call $chInsert (local.get $child))
    (call $applyAggregateDelta (local.get $d) (local.get $child) (call $subtreeOf (local.get $child)) (call $visibleOf (local.get $child)) (i32.const 0))
    (local.set $idx (call $findInsertIndex (local.get $d) (local.get $child)))
    (local.set $n (call $dChildCount (local.get $d)))
    (call $childListGrow (local.get $d) (i32.add (local.get $n) (i32.const 1)))
    (local.set $kids (call $dChildren (local.get $d)))
    (memory.copy
      (i32.add (local.get $kids) (i32.shl (i32.add (local.get $idx) (i32.const 1)) (i32.const 2)))
      (i32.add (local.get $kids) (i32.shl (local.get $idx) (i32.const 2)))
      (i32.shl (i32.sub (local.get $n) (local.get $idx)) (i32.const 2)))
    (i32.store (i32.add (local.get $kids) (i32.shl (local.get $idx) (i32.const 2))) (local.get $child))
    (call $set (i32.const $A.dChildCount) (local.get $d) (i32.add (local.get $n) (i32.const 1)))
    (call $updatePositionsFrom (local.get $d) (local.get $idx))
    (call $rebuildChunks (local.get $d)))

  ;; unlink $child from $parent's list; the child's parent/name are still current
  (func $removeChildRef (param $parent i32) (param $child i32)
    (local $d i32) (local $idx i32) (local $n i32) (local $kids i32)
    (local.set $d (call $dirOf (local.get $parent)))
    (local.set $idx (call $get (i32.const $A.pos) (local.get $child)))
    (call $chRemove (local.get $child))
    (call $applyAggregateDelta (local.get $d) (local.get $child)
      (i32.sub (i32.const 0) (call $subtreeOf (local.get $child)))
      (i32.sub (i32.const 0) (call $visibleOf (local.get $child)))
      (i32.const 0))
    (local.set $n (call $dChildCount (local.get $d)))
    (local.set $kids (call $dChildren (local.get $d)))
    (memory.copy
      (i32.add (local.get $kids) (i32.shl (local.get $idx) (i32.const 2)))
      (i32.add (local.get $kids) (i32.shl (i32.add (local.get $idx) (i32.const 1)) (i32.const 2)))
      (i32.shl (i32.sub (i32.sub (local.get $n) (local.get $idx)) (i32.const 1)) (i32.const 2)))
    (call $set (i32.const $A.dChildCount) (local.get $d) (i32.sub (local.get $n) (i32.const 1)))
    (call $updatePositionsFrom (local.get $d) (local.get $idx))
    (call $rebuildChunks (local.get $d)))

  ;; --- node creation ------------------------------------------------------------

  (func $createNode (param $parent i32) (param $name i32) (param $dir i32) (result i32)
    (local $id i32)
    (local.set $id (call $pushNode (local.get $parent) (local.get $name)
      (i32.or (i32.shl (i32.add (call $depth (local.get $parent)) (i32.const 1)) (i32.const $F.depthShift))
              (select (i32.const $F.dir) (i32.const 0) (local.get $dir)))))
    (if (local.get $dir) (then (drop (call $pushDir (local.get $id)))))
    (call $insertChildRef (local.get $parent) (local.get $id))
    (if (i32.and (local.get $dir) (global.get $collapseNewDirs))
      (then (call $setExpanded (local.get $id) (i32.const 0))))
    (local.get $id))

  ;; Resolve or create the directory chain for the '/'-separated segments in
  ;; [$ptr, $ptr+$len) (no trailing slash). Created ids are appended to out.
  ;; Returns the directory id, or -1 when a segment collides with a file
  ;; ($R.errAt gets that file's id).
  (func $ensureDirChain (param $ptr i32) (param $len i32) (result i32)
    (local $end i32) (local $segStart i32) (local $p i32) (local $segId i32) (local $cur i32) (local $child i32)
    (call $outReset)
    (if (i32.eqz (local.get $len)) (then (return (i32.const 0))))
    (local.set $end (i32.add (local.get $ptr) (local.get $len)))
    (local.set $segStart (local.get $ptr))
    (local.set $p (local.get $ptr))
    (loop $scan
      (if (i32.or (i32.ge_u (local.get $p) (local.get $end)) (i32.eq (i32.load8_u (local.get $p)) (i32.const 47)))
        (then
          (local.set $segId (call $internBytes (local.get $segStart) (i32.sub (local.get $p) (local.get $segStart))))
          (local.set $child (call $chFind (local.get $cur) (local.get $segId)))
          (if (i32.eq (local.get $child) (i32.const -1))
            (then
              (local.set $child (call $createNode (local.get $cur) (local.get $segId) (i32.const 1)))
              (call $outI32 (local.get $child)))
            (else
              (if (i32.eqz (call $isDir (local.get $child)))
                (then
                  (i32.store offset=$R.errAt (i32.const $mem.result) (local.get $child))
                  (return (i32.const -1))))))
          (local.set $cur (local.get $child))
          (local.set $segStart (i32.add (local.get $p) (i32.const 1)))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $scan (i32.le_u (local.get $p) (local.get $end))))
    (local.get $cur))

  ;; deepest existing directory along the segments in [$ptr, $ptr+$len)
  (func $deepestExistingDir (param $ptr i32) (param $len i32) (result i32)
    (local $end i32) (local $segStart i32) (local $p i32) (local $segId i32) (local $cur i32) (local $child i32)
    (if (i32.eqz (local.get $len)) (then (return (i32.const 0))))
    (local.set $end (i32.add (local.get $ptr) (local.get $len)))
    (local.set $segStart (local.get $ptr))
    (local.set $p (local.get $ptr))
    (loop $scan
      (if (i32.or (i32.ge_u (local.get $p) (local.get $end)) (i32.eq (i32.load8_u (local.get $p)) (i32.const 47)))
        (then
          (local.set $segId (call $findSegment (local.get $segStart) (i32.sub (local.get $p) (local.get $segStart))))
          (if (i32.eq (local.get $segId) (i32.const -1)) (then (return (local.get $cur))))
          (local.set $child (call $chFind (local.get $cur) (local.get $segId)))
          (if (i32.eq (local.get $child) (i32.const -1)) (then (return (local.get $cur))))
          (if (i32.eqz (call $isDir (local.get $child))) (then (return (local.get $cur))))
          (local.set $cur (local.get $child))
          (local.set $segStart (i32.add (local.get $p) (i32.const 1)))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $scan (i32.le_u (local.get $p) (local.get $end))))
    (local.get $cur))

  ;; create a file named by [$ptr, $ptr+$len) under $parent; -1 when the name exists
  (func $createFile (param $parent i32) (param $ptr i32) (param $len i32) (result i32)
    (local $segId i32) (local $existing i32)
    (local.set $segId (call $internBytes (local.get $ptr) (local.get $len)))
    (local.set $existing (call $chFind (local.get $parent) (local.get $segId)))
    (if (i32.ne (local.get $existing) (i32.const -1))
      (then
        (i32.store offset=$R.errAt (i32.const $mem.result) (local.get $existing))
        (return (i32.const -1))))
    (call $createNode (local.get $parent) (local.get $segId) (i32.const 0)))

  ;; --- removal ----------------------------------------------------------------------

  ;; mark $id and its descendants removed (ids appended to out, postorder)
  (func $removeSubtree (param $id i32)
    (local $sp i32) (local $f i32) (local $d i32) (local $pos i32) (local $c i32) (local $m i32)
    (call $outReset)
    (if (i32.eqz (call $isDir (local.get $id)))
      (then (call $removeOne (local.get $id)) (return)))
    (call $pushFrame (i32.const 0) (call $dirOf (local.get $id)) (i32.const 0) (local.get $id) (i32.const 0))
    (local.set $sp (i32.const 1))
    (block $done
      (loop $walk
        (br_if $done (i32.eqz (local.get $sp)))
        (local.set $f (call $frameAddr (i32.sub (local.get $sp) (i32.const 1))))
        (local.set $d (i32.load offset=0 (local.get $f)))
        (local.set $pos (i32.load offset=4 (local.get $f)))
        (if (i32.ge_u (local.get $pos) (call $dChildCount (local.get $d)))
          (then
            (call $removeOne (i32.load offset=8 (local.get $f)))
            (local.set $sp (i32.sub (local.get $sp) (i32.const 1)))
            (br $walk)))
        (i32.store offset=4 (local.get $f) (i32.add (local.get $pos) (i32.const 1)))
        (local.set $c (call $childAt (local.get $d) (local.get $pos)))
        (if (call $isDir (local.get $c))
          (then
            (call $pushFrame (local.get $sp) (call $dirOf (local.get $c)) (i32.const 0) (local.get $c) (i32.const 0))
            (local.set $sp (i32.add (local.get $sp) (i32.const 1))))
          (else (call $removeOne (local.get $c))))
        (br $walk))))

  (func $removeOne (param $id i32)
    (local $m i32)
    (local.set $m (call $meta (local.get $id)))
    (if (i32.and (i32.and (local.get $m) (i32.const $F.override)) (i32.eqz (i32.and (local.get $m) (i32.const $F.expanded))))
      (then (global.set $collapsedOverrides (i32.sub (global.get $collapsedOverrides) (i32.const 1)))))
    (call $set (i32.const $A.meta) (local.get $id)
      (i32.or (i32.and (local.get $m) (i32.xor (i32.const $F.override+32) (i32.const -1))) (i32.const $F.removed)))
    (global.set $activeNodeCount (i32.sub (global.get $activeNodeCount) (i32.const 1)))
    (call $outI32 (local.get $id)))

  (func $promoteEmptyAncestors (param $id i32)
    (loop $up
      (if (i32.or (i32.eqz (call $isDir (local.get $id))) (call $isRoot (local.get $id))) (then (return)))
      (if (call $dChildCount (call $dirOf (local.get $id))) (then (return)))
      (call $addFlag (local.get $id) (i32.const $F.explicit))
      (local.set $id (call $parentOf (local.get $id)))
      (br $up)))

  ;; remove node $id (whose subtree may be non-empty) from its parent and
  ;; repair counts; removed ids are left in out
  (func $removeNode (param $id i32)
    (local $parent i32)
    (local.set $parent (call $parentOf (local.get $id)))
    (call $removeChildRef (local.get $parent) (local.get $id))
    (call $removeSubtree (local.get $id))
    (call $promoteEmptyAncestors (local.get $parent))
    (call $recomputeUpward (local.get $parent)))

  ;; --- move -------------------------------------------------------------------------

  (func $isAncestor (param $ancestor i32) (param $id i32) (result i32)
    (loop $up
      (if (i32.eq (local.get $id) (local.get $ancestor)) (then (return (i32.const 1))))
      (if (call $isRoot (local.get $id)) (then (return (i32.const 0))))
      (local.set $id (call $parentOf (local.get $id)))
      (br $up))
    (unreachable))

  ;; reassign depths below $id after a re-parent
  (func $recomputeDepths (param $id i32)
    (local $sp i32) (local $f i32) (local $d i32) (local $pos i32) (local $c i32)
    (call $setDepth (local.get $id) (i32.add (call $depth (call $parentOf (local.get $id))) (i32.const 1)))
    (if (i32.eqz (call $isDir (local.get $id))) (then (return)))
    (call $pushFrame (i32.const 0) (call $dirOf (local.get $id)) (i32.const 0) (local.get $id) (i32.const 0))
    (local.set $sp (i32.const 1))
    (block $done
      (loop $walk
        (br_if $done (i32.eqz (local.get $sp)))
        (local.set $f (call $frameAddr (i32.sub (local.get $sp) (i32.const 1))))
        (local.set $d (i32.load offset=0 (local.get $f)))
        (local.set $pos (i32.load offset=4 (local.get $f)))
        (if (i32.ge_u (local.get $pos) (call $dChildCount (local.get $d)))
          (then (local.set $sp (i32.sub (local.get $sp) (i32.const 1))) (br $walk)))
        (i32.store offset=4 (local.get $f) (i32.add (local.get $pos) (i32.const 1)))
        (local.set $c (call $childAt (local.get $d) (local.get $pos)))
        (call $setDepth (local.get $c) (i32.add (call $depth (i32.load offset=8 (local.get $f))) (i32.const 1)))
        (if (call $isDir (local.get $c))
          (then
            (call $pushFrame (local.get $sp) (call $dirOf (local.get $c)) (i32.const 0) (local.get $c) (i32.const 0))
            (local.set $sp (i32.add (local.get $sp) (i32.const 1)))))
        (br $walk))))

  ;; re-parent and rename $source; returns its previous parent
  (func $moveNode (param $source i32) (param $targetParent i32) (param $targetName i32) (result i32)
    (local $prevParent i32)
    (local.set $prevParent (call $parentOf (local.get $source)))
    (call $removeChildRef (local.get $prevParent) (local.get $source))
    (call $set (i32.const $A.parent) (local.get $source) (local.get $targetParent))
    (call $set (i32.const $A.name) (local.get $source) (local.get $targetName))
    (call $recomputeDepths (local.get $source))
    (call $insertChildRef (local.get $targetParent) (local.get $source))
    (call $promoteEmptyAncestors (local.get $prevParent))
    (call $recomputeUpward (local.get $prevParent))
    (if (i32.ne (local.get $targetParent) (local.get $prevParent))
      (then (call $recomputeUpward (local.get $targetParent))))
    (local.get $prevParent))

  ;; --- projection signature ------------------------------------------------------------
  ;;
  ;; What getCollapsedProjectionSignature captures, as integers in result
  ;; slots: nearest collapsed ancestor (-1 when none), its flatten terminal,
  ;; whether the terminal has children, and a hash over the chain's ids and
  ;; names (the terminal's path and labels).
  (func $signature (param $id i32)
    (local $collapsed i32) (local $terminal i32) (local $h i32) (local $cur i32) (local $next i32)
    (local.set $collapsed (i32.const -1))
    (local.set $cur (local.get $id))
    (block $found
      (loop $up
        (br_if $found (i32.or (i32.eqz (call $isDir (local.get $cur))) (call $isRoot (local.get $cur))))
        (if (i32.eqz (call $isExpanded (local.get $cur)))
          (then (local.set $collapsed (local.get $cur)) (br $found)))
        (local.set $cur (call $parentOf (local.get $cur)))
        (br $up)))
    (i32.store offset=$R.value (i32.const $mem.result) (local.get $collapsed))
    (if (i32.eq (local.get $collapsed) (i32.const -1)) (then (return)))
    (local.set $cur (local.get $collapsed))
    (loop $chain
      (local.set $h (i32.add (i32.mul (local.get $h) (i32.const 31)) (local.get $cur)))
      (local.set $h (i32.add (i32.mul (local.get $h) (i32.const 31)) (call $nameOf (local.get $cur))))
      (local.set $next (call $flattenedChild (local.get $cur)))
      (if (i32.ne (local.get $next) (i32.const -1))
        (then (local.set $cur (local.get $next)) (br $chain))))
    (i32.store offset=$R.value2 (i32.const $mem.result) (local.get $cur))
    (i32.store offset=$R.value3 (i32.const $mem.result)
      (i32.or (i32.ne (call $dChildCount (call $dirOf (local.get $cur))) (i32.const 0)) (i32.shl (local.get $h) (i32.const 1)))))

  ;; --- cleanup -------------------------------------------------------------------------

  ;; Postorder recount of the whole tree. Unlike $initCounts this does not
  ;; rely on id order, so it is valid after moves re-parented nodes.
  (func $recomputeAllCounts
    (local $sp i32) (local $f i32) (local $d i32) (local $pos i32) (local $c i32) (local $id i32)
    (call $pushFrame (i32.const 0) (call $dirOf (i32.const 0)) (i32.const 0) (i32.const 0) (i32.const 0))
    (local.set $sp (i32.const 1))
    (block $done
      (loop $walk
        (br_if $done (i32.eqz (local.get $sp)))
        (local.set $f (call $frameAddr (i32.sub (local.get $sp) (i32.const 1))))
        (local.set $d (i32.load offset=0 (local.get $f)))
        (local.set $pos (i32.load offset=4 (local.get $f)))
        (if (i32.ge_u (local.get $pos) (call $dChildCount (local.get $d)))
          (then
            (local.set $id (i32.load offset=8 (local.get $f)))
            (call $rebuildAggregates (local.get $d))
            (call $recomputeNodeCounts (local.get $id))
            (local.set $sp (i32.sub (local.get $sp) (i32.const 1)))
            (br $walk)))
        (i32.store offset=4 (local.get $f) (i32.add (local.get $pos) (i32.const 1)))
        (local.set $c (call $childAt (local.get $d) (local.get $pos)))
        (if (call $isDir (local.get $c))
          (then
            (call $pushFrame (local.get $sp) (call $dirOf (local.get $c)) (i32.const 0) (local.get $c) (i32.const 0))
            (local.set $sp (i32.add (local.get $sp) (i32.const 1))))
          (else (call $recomputeNodeCounts (local.get $c))))
        (br $walk))))

  ;; drop removed node slots (and their directory records) from the tail
  (func $trimTrailingRemoved
    (local $n i32) (local $dn i32) (local $a i32)
    (local.set $n (call $nodeCount))
    (block $done
      (loop $scan
        (br_if $done (i32.le_u (local.get $n) (i32.const 1)))
        (br_if $done (i32.eqz (call $hasFlag (i32.sub (local.get $n) (i32.const 1)) (i32.const $F.removed))))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $scan)))
    (call $nodeSetCount (local.get $n))
    (local.set $dn (call $len (i32.const $A.dNode)))
    (block $done2
      (loop $scan2
        (br_if $done2 (i32.le_u (local.get $dn) (i32.const 1)))
        (br_if $done2 (i32.lt_u (call $get (i32.const $A.dNode) (i32.sub (local.get $dn) (i32.const 1))) (local.get $n)))
        (local.set $dn (i32.sub (local.get $dn) (i32.const 1)))
        (br $scan2)))
    (local.set $a (i32.const $A.dNode))
    (loop $each
      (call $setLen (local.get $a) (local.get $dn))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $a) (i32.const $A.dChunk)))))

  ;; rebuild the segment table from live names, keeping node ids
  (func $compactSegments
    (local $oldBytes i32) (local $oldOff i32) (local $oldLen i32) (local $i i32) (local $n i32) (local $name i32) (local $d i32)
    (local.set $oldBytes (call $base (i32.const $A.segBytes)))
    (local.set $oldOff (call $base (i32.const $A.segOff)))
    (local.set $oldLen (call $base (i32.const $A.segLen)))
    (call $segInit (global.get $activeNodeCount))
    (local.set $n (call $nodeCount))
    (local.set $i (i32.const 1))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.eqz (call $hasFlag (local.get $i) (i32.const $F.removed)))
          (then
            (local.set $name (call $nameOf (local.get $i)))
            (call $set (i32.const $A.name) (local.get $i)
              (call $internBytes
                (i32.add (local.get $oldBytes) (i32.load (i32.add (local.get $oldOff) (i32.shl (local.get $name) (i32.const 2)))))
                (i32.and (i32.load (i32.add (local.get $oldLen) (i32.shl (local.get $name) (i32.const 2)))) (i32.const $SEG.lenMask))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    ;; the child hash keys on name ids
    (local.set $d (call $descAddr (i32.const $A.chHash)))
    (i32.store offset=$D.base (local.get $d) (i32.const 0))
    (i32.store offset=$D.len (local.get $d) (i32.const 0))
    (i32.store offset=$D.cap (local.get $d) (i32.const 0)))
)
