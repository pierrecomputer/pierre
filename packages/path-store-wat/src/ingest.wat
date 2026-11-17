(module
  (import "./memory.wat")
  (import "./segments.wat")
  (import "./state.wat")
  (import "./compare.wat")

  ;; result slots (byte offsets in $mem.result)
  (const $R.err 0)
  (const $R.errAt 4)
  (const $R.value 8)
  (const $R.value2 12)
  (const $R.value3 16)

  ;; ingest error codes
  (const $E.duplicate 1)
  (const $E.notDirectory 2)
  (const $E.exists 3)
  (const $E.missing 4)
  (const $E.collision 5)
  (const $E.unsorted 6)

  ;; --- node arrays ---------------------------------------------------------

  ;; Node array bases and bounds mirrored in globals so the ingest loop
  ;; appends with plain stores; $nodeSync refreshes them after any relocation.
  (global $gParent (mut i32) (i32.const 0))
  (global $gName (mut i32) (i32.const 0))
  (global $gMeta (mut i32) (i32.const 0))
  (global $gSubtree (mut i32) (i32.const 0))
  (global $gVisible (mut i32) (i32.const 0))
  (global $gDir (mut i32) (i32.const 0))
  (global $gPos (mut i32) (i32.const 0))
  (global $gNodeCount (mut i32) (i32.const 0))
  (global $gNodeCap (mut i32) (i32.const 0))

  (func $nodeSync
    (global.set $gParent (call $base (i32.const $A.parent)))
    (global.set $gName (call $base (i32.const $A.name)))
    (global.set $gMeta (call $base (i32.const $A.meta)))
    (global.set $gSubtree (call $base (i32.const $A.subtree)))
    (global.set $gVisible (call $base (i32.const $A.visible)))
    (global.set $gDir (call $base (i32.const $A.dir)))
    (global.set $gPos (call $base (i32.const $A.pos)))
    (global.set $gNodeCount (call $len (i32.const $A.parent)))
    (global.set $gNodeCap (call $cap (i32.const $A.parent))))

  (func $nodeInit (param $cap i32)
    (local $a i32)
    (local.set $a (i32.const $A.parent))
    (loop $each
      (call $arrInit (local.get $a) (i32.const 2) (local.get $cap))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $a) (i32.const $A.pos))))
    (call $nodeSync))

  (func $nodeReserve (param $min i32)
    (local $a i32)
    (local.set $a (i32.const $A.parent))
    (loop $each
      (call $arrReserve (local.get $a) (local.get $min))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $a) (i32.const $A.pos))))
    (call $nodeSync))

  (func $nodeSetCount (param $n i32)
    (local $a i32)
    (local.set $a (i32.const $A.parent))
    (loop $each
      (call $setLen (local.get $a) (local.get $n))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $a) (i32.const $A.pos))))
    (global.set $gNodeCount (local.get $n)))

  (func $nodeCount (result i32)
    (global.get $gNodeCount))

  ;; append a node with the given parent, name, and meta; counts start at 1
  (func $pushNode (param $parent i32) (param $name i32) (param $m i32) (result i32)
    (local $id i32) (local $o i32)
    (local.set $id (global.get $gNodeCount))
    (if (i32.ge_u (local.get $id) (global.get $gNodeCap))
      (then (call $nodeReserve (i32.add (local.get $id) (i32.const 1)))))
    (local.set $o (i32.shl (local.get $id) (i32.const 2)))
    (i32.store (i32.add (global.get $gParent) (local.get $o)) (local.get $parent))
    (i32.store (i32.add (global.get $gName) (local.get $o)) (local.get $name))
    (i32.store (i32.add (global.get $gMeta) (local.get $o)) (local.get $m))
    (i32.store (i32.add (global.get $gSubtree) (local.get $o)) (i32.const 1))
    (i32.store (i32.add (global.get $gVisible) (local.get $o)) (i32.const 1))
    (i32.store (i32.add (global.get $gDir) (local.get $o)) (i32.const -1))
    (i32.store (i32.add (global.get $gPos) (local.get $o)) (i32.const 0))
    (call $nodeSetCount (i32.add (local.get $id) (i32.const 1)))
    (global.set $activeNodeCount (i32.add (global.get $activeNodeCount) (i32.const 1)))
    (local.get $id))
  (func $dirInit (param $cap i32)
    (local $a i32)
    (local.set $a (i32.const $A.dNode))
    (loop $each
      (call $arrInit (local.get $a) (i32.const 2) (local.get $cap))
      (local.set $a (i32.add (local.get $a) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $a) (i32.const $A.dChunk)))))

  ;; create an empty directory record for node $id
  (func $pushDir (param $id i32) (result i32)
    (local $d i32)
    (local.set $d (call $arrPush (i32.const $A.dNode) (local.get $id)))
    (drop (call $arrPush (i32.const $A.dChildBase) (i32.const 0)))
    (drop (call $arrPush (i32.const $A.dChildCount) (i32.const 0)))
    (drop (call $arrPush (i32.const $A.dChildCap) (i32.const 0)))
    (drop (call $arrPush (i32.const $A.dTotalSubtree) (i32.const 0)))
    (drop (call $arrPush (i32.const $A.dTotalVisible) (i32.const 0)))
    (drop (call $arrPush (i32.const $A.dChunk) (i32.const -1)))
    (call $set (i32.const $A.dir) (local.get $id) (local.get $d))
    (local.get $d))

  ;; --- fresh store ---------------------------------------------------------

  ;; count '\n' bytes with 8-byte SWAR steps
  (func $countLines (param $ptr i32) (param $len i32) (result i32)
    (local $end i32) (local $n i32) (local $w i64)
    (local.set $end (i32.add (local.get $ptr) (i32.and (local.get $len) (i32.const -8))))
    (block $done
      (loop $words
        (br_if $done (i32.ge_u (local.get $ptr) (local.get $end)))
        (local.set $w (i64.xor (i64.load (local.get $ptr)) (i64.const 0x0a0a0a0a0a0a0a0a)))
        (local.set $n (i32.add (local.get $n) (i32.wrap_i64 (i64.popcnt
          (i64.and (i64.and (i64.sub (local.get $w) (i64.const 0x0101010101010101))
                            (i64.xor (local.get $w) (i64.const -1)))
                   (i64.const 0x8080808080808080))))))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 8)))
        (br $words)))
    (local.set $end (i32.add (local.get $end) (i32.and (local.get $len) (i32.const 7))))
    (block $done2
      (loop $bytes
        (br_if $done2 (i32.ge_u (local.get $ptr) (local.get $end)))
        (local.set $n (i32.add (local.get $n) (i32.eq (i32.load8_u (local.get $ptr)) (i32.const 10))))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 1)))
        (br $bytes)))
    (local.get $n))

  ;; size the tables for roughly $lines paths; the heap was reset by the
  ;; host before it wrote any input block
  (func $storeInit (param $lines i32)
    (global.set $activeNodeCount (i32.const 0))
    (global.set $collapsedOverrides (i32.const 0))
    (global.set $collapseNewDirs (i32.const 0))
    (call $nodeInit (i32.add (i32.add (local.get $lines) (i32.shr_u (local.get $lines) (i32.const 2))) (i32.const 64)))
    (call $dirInit (i32.add (i32.shr_u (local.get $lines) (i32.const 2)) (i32.const 64)))
    (call $segInit (local.get $lines))
    (call $arrInit (i32.const $A.pool) (i32.const 2) (i32.const 64))
    (call $arrInit (i32.const $A.out) (i32.const 0) (i32.const 4096))
    (call $arrInit (i32.const $A.stack) (i32.const 2) (i32.const 1024))
    ;; root: explicit directory at depth 0
    (drop (call $pushNode (i32.const 0) (i32.const 0) (i32.const $F.dir+3)))
    (global.set $activeNodeCount (i32.const 0))
    (drop (call $pushDir (i32.const 0))))

  ;; reserve $len bytes of input (plus overread slack) and return the address
  (func $inputBegin (param $len i32) (result i32)
    (call $arrInit (i32.const $A.input) (i32.const 0) (i32.add (local.get $len) (i32.const 64)))
    (call $setLen (i32.const $A.input) (local.get $len))
    (memory.fill (i32.add (call $base (i32.const $A.input)) (local.get $len)) (i32.const 0) (i32.const 64))
    (call $base (i32.const $A.input)))

  (func $inputDrop
    (local $d i32)
    (local.set $d (call $descAddr (i32.const $A.input)))
    (i32.store offset=$D.base (local.get $d) (i32.const 0))
    (i32.store offset=$D.len (local.get $d) (i32.const 0))
    (i32.store offset=$D.cap (local.get $d) (i32.const 0)))

  (func $fail (param $code i32) (param $at i32) (result i32)
    (i32.store offset=$R.err (i32.const $mem.result) (local.get $code))
    (i32.store offset=$R.errAt (i32.const $mem.result) (local.get $at))
    (local.get $code))

  ;; --- presorted ingest ------------------------------------------------------
  ;;
  ;; Newline-delimited canonical paths in [$ptr, $end) in store order; a
  ;; trailing '/' marks an explicit directory. Mirrors
  ;; PathStoreBuilder.appendPresortedPaths: the shared directory prefix with
  ;; the previous line is matched in one block compare, only the unshared
  ;; tail is scanned, and adjacent equal lines are duplicates. Child counts
  ;; accumulate in the parent's subtree slot until $buildChildren.
  (func $ingest (param $ptr i32) (param $end i32) (param $validate i32) (result i32)
    (local $p i32) (local $lineStart i32) (local $lineEnd i32) (local $contentEnd i32)
    (local $isDir i32) (local $prevStart i32) (local $prevEnd i32) (local $prevDirLen i32) (local $prevDirDepth i32)
    (local $depth i32) (local $segStart i32) (local $c i32) (local $segId i32) (local $nodeId i32) (local $parentId i32)
    (local $cmpLen i32) (local $i i32) (local $m i32) (local $stack i32) (local $cnt i32)
    (local.set $p (local.get $ptr))
    (local.set $prevStart (i32.const -1))
    (local.set $stack (call $base (i32.const $A.stack)))
    (i32.store (local.get $stack) (i32.const 0))
    (block $eof
      (loop $line
        (br_if $eof (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $lineStart (local.get $p))
        (local.set $depth (i32.const 0))
        (local.set $segStart (local.get $lineStart))
        (if (i32.ne (local.get $prevStart) (i32.const -1))
          (then
            ;; fast path: the line starts with the previous line's directory prefix
            (if (i32.and
                  (i32.ne (local.get $prevDirLen) (i32.const 0))
                  (i32.le_u (i32.add (local.get $lineStart) (local.get $prevDirLen)) (local.get $end)))
              (then
                (if (call $memeq (local.get $lineStart) (local.get $prevStart) (local.get $prevDirLen))
                  (then
                    (local.set $depth (local.get $prevDirDepth))
                    (local.set $segStart (i32.add (local.get $lineStart) (local.get $prevDirLen)))))))
            (if (i32.eqz (local.get $depth))
              (then
                ;; slow path: byte compare against the previous line, counting '/'
                (local.set $i (i32.const 0))
                (local.set $cmpLen (i32.sub (local.get $prevEnd) (local.get $prevStart)))
                (block $stop
                  (loop $cmp
                    (br_if $stop (i32.ge_u (local.get $i) (local.get $cmpLen)))
                    (local.set $c (i32.load8_u (i32.add (local.get $lineStart) (local.get $i))))
                    (br_if $stop (i32.ne (local.get $c) (i32.load8_u (i32.add (local.get $prevStart) (local.get $i)))))
                    (br_if $stop (i32.eq (local.get $c) (i32.const 10)))
                    (if (i32.eq (local.get $c) (i32.const 47))
                      (then
                        (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                        (local.set $segStart (i32.add (i32.add (local.get $lineStart) (local.get $i)) (i32.const 1)))))
                    (local.set $i (i32.add (local.get $i) (i32.const 1)))
                    (br $cmp)))))))
        ;; scan the unshared tail: segments split on '/', the line ends at '\n' or $end
        (local.set $p (local.get $segStart))
        (block $eol
          (loop $scan
            (br_if $eol (i32.ge_u (local.get $p) (local.get $end)))
            (local.set $c (i32.load8_u (local.get $p)))
            (br_if $eol (i32.eq (local.get $c) (i32.const 10)))
            (if (i32.eq (local.get $c) (i32.const 47))
              (then
                (local.set $m (i32.add (local.get $p) (i32.const 1)))
                ;; a '/' right before the newline/end marks an explicit directory line
                (if (i32.or (i32.ge_u (local.get $m) (local.get $end))
                            (i32.eq (i32.load8_u (local.get $m)) (i32.const 10)))
                  (then
                    (local.set $isDir (i32.const 1))
                    (local.set $contentEnd (local.get $p))
                    (local.set $lineEnd (local.get $m))
                    (br $eol)))
                ;; intermediate directory segment [segStart, p)
                (local.set $segId (call $internBytes (local.get $segStart) (i32.sub (local.get $p) (local.get $segStart))))
                (local.set $parentId (i32.load (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2)))))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (local.set $nodeId (call $pushNode (local.get $parentId) (local.get $segId)
                  (i32.or (i32.shl (local.get $depth) (i32.const $F.depthShift)) (i32.const $F.dir))))
                (local.set $cnt (i32.add (global.get $gSubtree) (i32.shl (local.get $parentId) (i32.const 2))))
                (i32.store (local.get $cnt) (i32.add (i32.load (local.get $cnt)) (i32.const 1)))
                (call $arrReserve (i32.const $A.stack) (i32.add (local.get $depth) (i32.const 2)))
                (local.set $stack (call $base (i32.const $A.stack)))
                (i32.store (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2))) (local.get $nodeId))
                (local.set $segStart (local.get $m))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (if (i32.eqz (local.get $isDir))
          (then
            (local.set $contentEnd (local.get $p))
            (local.set $lineEnd (local.get $p))
            ;; an empty tail after a '/'-terminated prefix is a directory line equal to that prefix
            (if (i32.and (i32.eq (local.get $p) (local.get $segStart)) (i32.gt_u (local.get $segStart) (local.get $lineStart)))
              (then (local.set $isDir (i32.const 1))))))
        ;; adjacent duplicate lines (sorted input keeps duplicates together)
        (if (i32.ne (local.get $prevStart) (i32.const -1))
          (then
            (if (i32.eq (i32.sub (local.get $lineEnd) (local.get $lineStart)) (i32.sub (local.get $prevEnd) (local.get $prevStart)))
              (then
                (if (call $memeq (local.get $lineStart) (local.get $prevStart) (i32.sub (local.get $lineEnd) (local.get $lineStart)))
                  (then (return (call $fail (i32.const $E.duplicate) (i32.sub (local.get $lineStart) (local.get $ptr))))))))))
        (if (local.get $isDir)
          (then
            (local.set $isDir (i32.const 0))
            (if (i32.lt_u (local.get $segStart) (local.get $contentEnd))
              (then
                (local.set $segId (call $internBytes (local.get $segStart) (i32.sub (local.get $contentEnd) (local.get $segStart))))
                (local.set $parentId (i32.load (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2)))))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (local.set $nodeId (call $pushNode (local.get $parentId) (local.get $segId)
                  (i32.or (i32.shl (local.get $depth) (i32.const $F.depthShift)) (i32.const $F.dir))))
                (local.set $cnt (i32.add (global.get $gSubtree) (i32.shl (local.get $parentId) (i32.const 2))))
                (i32.store (local.get $cnt) (i32.add (i32.load (local.get $cnt)) (i32.const 1)))
                (call $arrReserve (i32.const $A.stack) (i32.add (local.get $depth) (i32.const 2)))
                (local.set $stack (call $base (i32.const $A.stack)))
                (i32.store (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2))) (local.get $nodeId))))
            ;; promote to explicit; a second explicit marking is a duplicate
            (local.set $nodeId (i32.load (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2)))))
            (if (call $hasFlag (local.get $nodeId) (i32.const $F.explicit))
              (then (return (call $fail (i32.const $E.duplicate) (i32.sub (local.get $lineStart) (local.get $ptr))))))
            (call $addFlag (local.get $nodeId) (i32.const $F.explicit))
            (local.set $prevDirLen (i32.sub (local.get $lineEnd) (local.get $lineStart)))
            (local.set $prevDirDepth (local.get $depth)))
          (else
            ;; file segment [segStart, contentEnd)
            (local.set $segId (call $internBytes (local.get $segStart) (i32.sub (local.get $contentEnd) (local.get $segStart))))
            (local.set $parentId (i32.load (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2)))))
            (drop (call $pushNode (local.get $parentId) (local.get $segId)
              (i32.shl (i32.add (local.get $depth) (i32.const 1)) (i32.const $F.depthShift))))
            (local.set $cnt (i32.add (global.get $gSubtree) (i32.shl (local.get $parentId) (i32.const 2))))
                (i32.store (local.get $cnt) (i32.add (i32.load (local.get $cnt)) (i32.const 1)))
            (local.set $prevDirLen (i32.sub (local.get $segStart) (local.get $lineStart)))
            (local.set $prevDirDepth (local.get $depth))))
        ;; presorted: true input is checked, prepared input is trusted
        (if (i32.and (local.get $validate) (i32.ne (local.get $prevStart) (i32.const -1)))
          (then
            (if (i32.gt_s (call $comparePaths (local.get $prevStart) (local.get $prevEnd) (local.get $lineStart) (local.get $lineEnd)) (i32.const 0))
              (then (return (call $fail (i32.const $E.unsorted) (i32.sub (local.get $lineStart) (local.get $ptr))))))))
        (local.set $prevStart (local.get $lineStart))
        (local.set $prevEnd (local.get $lineEnd))
        (local.set $p (i32.add (local.get $lineEnd) (i32.const 1)))
        (br $line)))
    (i32.const 0))

  ;; Build directory records, CSR child lists, and child positions from the
  ;; flat node list. Ids were assigned in store order, so iterating by id
  ;; yields each directory's children already sorted. Child counts arrive in
  ;; each directory node's subtree slot (see $ingest / $pushNode callers).
  (func $buildChildren
    (local $n i32) (local $i i32) (local $d i32) (local $sum i32) (local $c i32) (local $p i32) (local $cursor i32)
    (local $metaBase i32) (local $parentBase i32) (local $dirBase i32) (local $posBase i32) (local $subBase i32)
    (local $poolBase i32) (local $baseArr i32) (local $capArr i32) (local $countArr i32) (local $o i32) (local $slot i32)
    (local.set $n (call $nodeCount))
    ;; directory records in id order (root already exists as record 0)
    (local.set $metaBase (call $base (i32.const $A.meta)))
    (local.set $i (i32.const 1))
    (block $done1
      (loop $l1
        (br_if $done1 (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.and (i32.load (i32.add (local.get $metaBase) (i32.shl (local.get $i) (i32.const 2)))) (i32.const $F.dir))
          (then (drop (call $pushDir (local.get $i)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l1)))
    ;; child counts and prefix sums
    (local.set $d (call $len (i32.const $A.dNode)))
    (local.set $subBase (call $base (i32.const $A.subtree)))
    (local.set $baseArr (call $base (i32.const $A.dChildBase)))
    (local.set $capArr (call $base (i32.const $A.dChildCap)))
    (local.set $countArr (call $base (i32.const $A.dChildCount)))
    (local.set $i (i32.const 0))
    (block $done2
      (loop $l2
        (br_if $done2 (i32.ge_u (local.get $i) (local.get $d)))
        (local.set $o (i32.shl (local.get $i) (i32.const 2)))
        (local.set $c (i32.sub (i32.load (i32.add (local.get $subBase)
          (i32.shl (call $get (i32.const $A.dNode) (local.get $i)) (i32.const 2)))) (i32.const 1)))
        (i32.store (i32.add (local.get $countArr) (local.get $o)) (local.get $c))
        (i32.store (i32.add (local.get $capArr) (local.get $o)) (local.get $c))
        (i32.store (i32.add (local.get $baseArr) (local.get $o)) (local.get $sum))
        (local.set $sum (i32.add (local.get $sum) (local.get $c)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l2)))
    (call $arrInit (i32.const $A.pool) (i32.const 2) (i32.add (local.get $sum) (i32.const 64)))
    (call $setLen (i32.const $A.pool) (local.get $sum))
    ;; fill: dChildCap doubles as the fill cursor, then is restored
    (memory.fill (local.get $capArr) (i32.const 0) (i32.shl (local.get $d) (i32.const 2)))
    (local.set $poolBase (call $base (i32.const $A.pool)))
    (local.set $parentBase (call $base (i32.const $A.parent)))
    (local.set $dirBase (call $base (i32.const $A.dir)))
    (local.set $posBase (call $base (i32.const $A.pos)))
    (local.set $i (i32.const 1))
    (block $done3
      (loop $l3
        (br_if $done3 (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $o (i32.shl (local.get $i) (i32.const 2)))
        (local.set $p (i32.shl (i32.load (i32.add (local.get $dirBase)
          (i32.shl (i32.load (i32.add (local.get $parentBase) (local.get $o))) (i32.const 2)))) (i32.const 2)))
        (local.set $slot (i32.add (local.get $capArr) (local.get $p)))
        (local.set $cursor (i32.load (local.get $slot)))
        (i32.store (i32.add (local.get $poolBase)
          (i32.shl (i32.add (i32.load (i32.add (local.get $baseArr) (local.get $p))) (local.get $cursor)) (i32.const 2)))
          (local.get $i))
        (i32.store (i32.add (local.get $posBase) (local.get $o)) (local.get $cursor))
        (i32.store (local.get $slot) (i32.add (local.get $cursor) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l3)))
    (memory.copy (local.get $capArr) (local.get $countArr) (i32.shl (local.get $d) (i32.const 2))))
)
