(module
  (import "./memory.wat")
  (import "./segments.wat")
  (import "./state.wat")
  (import "./ingest.wat")

  ;; --- output buffer -------------------------------------------------------

  ;; make the scratch byte array at least $n bytes and return its address
  (func $scratchReserve (param $n i32) (result i32)
    (if (i32.eqz (call $cap (i32.const $A.scratch)))
      (then (call $arrInit (i32.const $A.scratch) (i32.const 0) (i32.add (local.get $n) (i32.const 4096))))
      (else (call $arrReserve (i32.const $A.scratch) (i32.add (local.get $n) (i32.const 16)))))
    (call $base (i32.const $A.scratch)))

  (func $outReset
    (call $setLen (i32.const $A.out) (i32.const 0)))

  ;; make room for $n more bytes and return the write address
  (func $outReserve (param $n i32) (result i32)
    (local $at i32)
    (local.set $at (call $len (i32.const $A.out)))
    (call $arrReserve (i32.const $A.out) (i32.add (i32.add (local.get $at) (local.get $n)) (i32.const 16)))
    (i32.add (call $base (i32.const $A.out)) (local.get $at)))

  (func $outAdvance (param $n i32)
    (call $setLen (i32.const $A.out) (i32.add (call $len (i32.const $A.out)) (local.get $n))))

  (func $outByte (param $b i32)
    (i32.store8 (call $outReserve (i32.const 1)) (local.get $b))
    (call $outAdvance (i32.const 1)))

  (func $outI32 (param $v i32)
    (i32.store (call $outReserve (i32.const 4)) (local.get $v))
    (call $outAdvance (i32.const 4)))

  (func $outBytes (param $ptr i32) (param $len i32)
    (memory.copy (call $outReserve (local.get $len)) (local.get $ptr) (local.get $len))
    (call $outAdvance (local.get $len)))

  (func $outSegment (param $segId i32)
    (call $outBytes (call $segPtr (local.get $segId)) (call $segLength (local.get $segId))))

  ;; --- (parent, name) -> child hash ------------------------------------------

  (func $chSlotHash (param $parent i32) (param $name i32) (result i32)
    (local $h i32)
    (local.set $h (i32.mul (i32.xor (local.get $parent) (i32.mul (local.get $name) (i32.const 0x9e3779b1))) (i32.const 0x85ebca6b)))
    (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 15))))

  (func $chBuilt (result i32)
    (i32.ne (call $cap (i32.const $A.chHash)) (i32.const 0)))

  ;; insert without duplicate checks (table is known to have room)
  (func $chInsertRaw (param $table i32) (param $mask i32) (param $id i32)
    (local $slot i32) (local $v i32)
    (local.set $slot (i32.and (call $chSlotHash (call $parentOf (local.get $id)) (call $nameOf (local.get $id))) (local.get $mask)))
    (loop $probe
      (local.set $v (i32.load (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2)))))
      (if (i32.gt_s (local.get $v) (i32.const 0))
        (then
          (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
          (br $probe))))
    (i32.store (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2))) (i32.add (local.get $id) (i32.const 1))))

  ;; (re)build the table from every live node
  (func $chRebuild
    (local $size i32) (local $d i32) (local $i i32) (local $n i32) (local $table i32) (local $mask i32) (local $used i32)
    (local.set $n (call $nodeCount))
    (local.set $size (i32.const 256))
    (loop $grow
      (if (i32.lt_u (local.get $size) (i32.shl (i32.add (global.get $activeNodeCount) (i32.const 64)) (i32.const 1)))
        (then (local.set $size (i32.shl (local.get $size) (i32.const 1))) (br $grow))))
    (local.set $d (call $descAddr (i32.const $A.chHash)))
    (i32.store offset=$D.shift (local.get $d) (i32.const 2))
    (i32.store offset=$D.cap (local.get $d) (local.get $size))
    (i32.store offset=$D.base (local.get $d) (call $allocZeroed (i32.shl (local.get $size) (i32.const 2))))
    (local.set $table (call $base (i32.const $A.chHash)))
    (local.set $mask (i32.sub (local.get $size) (i32.const 1)))
    (local.set $i (i32.const 1))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.eqz (call $hasFlag (local.get $i) (i32.const $F.removed)))
          (then
            (call $chInsertRaw (local.get $table) (local.get $mask) (local.get $i))
            (local.set $used (i32.add (local.get $used) (i32.const 1)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (i32.store offset=$D.len (local.get $d) (local.get $used)))

  (func $chEnsure
    (if (i32.eqz (call $chBuilt)) (then (call $chRebuild))))

  ;; child of $parent named $name, or -1
  (func $chFind (param $parent i32) (param $name i32) (result i32)
    (local $slot i32) (local $v i32) (local $table i32) (local $mask i32) (local $id i32)
    (call $chEnsure)
    (local.set $table (call $base (i32.const $A.chHash)))
    (local.set $mask (i32.sub (call $cap (i32.const $A.chHash)) (i32.const 1)))
    (local.set $slot (i32.and (call $chSlotHash (local.get $parent) (local.get $name)) (local.get $mask)))
    (loop $probe
      (local.set $v (i32.load (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2)))))
      (if (i32.eqz (local.get $v)) (then (return (i32.const -1))))
      (if (i32.gt_s (local.get $v) (i32.const 0))
        (then
          (local.set $id (i32.sub (local.get $v) (i32.const 1)))
          (if (i32.and (i32.eq (call $parentOf (local.get $id)) (local.get $parent))
                       (i32.eq (call $nameOf (local.get $id)) (local.get $name)))
            (then
              (if (i32.eqz (call $hasFlag (local.get $id) (i32.const $F.removed)))
                (then (return (local.get $id))))))))
      (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
      (br $probe))
    (unreachable))

  ;; register node $id under its current parent and name
  (func $chInsert (param $id i32)
    (local $d i32)
    (if (i32.eqz (call $chBuilt)) (then (return)))
    (local.set $d (call $descAddr (i32.const $A.chHash)))
    (if (i32.ge_u (i32.shl (i32.add (i32.load offset=$D.len (local.get $d)) (i32.const 1)) (i32.const 1))
                  (i32.load offset=$D.cap (local.get $d)))
      (then (call $chRebuild) (local.set $d (call $descAddr (i32.const $A.chHash)))))
    (call $chInsertRaw (i32.load offset=$D.base (local.get $d))
      (i32.sub (i32.load offset=$D.cap (local.get $d)) (i32.const 1)) (local.get $id))
    (i32.store offset=$D.len (local.get $d) (i32.add (i32.load offset=$D.len (local.get $d)) (i32.const 1))))

  ;; tombstone node $id's slot (its parent and name must still be current)
  (func $chRemove (param $id i32)
    (local $slot i32) (local $v i32) (local $table i32) (local $mask i32)
    (if (i32.eqz (call $chBuilt)) (then (return)))
    (local.set $table (call $base (i32.const $A.chHash)))
    (local.set $mask (i32.sub (call $cap (i32.const $A.chHash)) (i32.const 1)))
    (local.set $slot (i32.and (call $chSlotHash (call $parentOf (local.get $id)) (call $nameOf (local.get $id))) (local.get $mask)))
    (loop $probe
      (local.set $v (i32.load (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2)))))
      (if (i32.eqz (local.get $v)) (then (return)))
      (if (i32.eq (local.get $v) (i32.add (local.get $id) (i32.const 1)))
        (then
          (i32.store (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2))) (i32.const -1))
          (return)))
      (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
      (br $probe)))

  ;; --- path lookup -----------------------------------------------------------

  ;; node for the canonical path bytes [$ptr, $ptr+$len), or -1. A trailing
  ;; '/' (or $requireDir) demands a directory. "" is the root.
  (func $lookupPath (param $ptr i32) (param $len i32) (param $requireDir i32) (result i32)
    (local $end i32) (local $segStart i32) (local $p i32) (local $segId i32) (local $cur i32)
    (if (i32.eqz (local.get $len)) (then (return (i32.const 0))))
    (local.set $end (i32.add (local.get $ptr) (local.get $len)))
    (if (i32.eq (i32.load8_u (i32.sub (local.get $end) (i32.const 1))) (i32.const 47))
      (then
        (local.set $requireDir (i32.const 1))
        (local.set $end (i32.sub (local.get $end) (i32.const 1)))))
    (local.set $segStart (local.get $ptr))
    (local.set $p (local.get $ptr))
    (loop $scan
      (if (i32.or (i32.ge_u (local.get $p) (local.get $end)) (i32.eq (i32.load8_u (local.get $p)) (i32.const 47)))
        (then
          (local.set $segId (call $findSegment (local.get $segStart) (i32.sub (local.get $p) (local.get $segStart))))
          (if (i32.eq (local.get $segId) (i32.const -1)) (then (return (i32.const -1))))
          (local.set $cur (call $chFind (local.get $cur) (local.get $segId)))
          (if (i32.eq (local.get $cur) (i32.const -1)) (then (return (i32.const -1))))
          (local.set $segStart (i32.add (local.get $p) (i32.const 1)))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $scan (i32.le_u (local.get $p) (local.get $end))))
    (if (i32.and (local.get $requireDir) (i32.eqz (call $isDir (local.get $cur)))) (then (return (i32.const -1))))
    (local.get $cur))

  ;; append the canonical path of $id to out ("" for the root, trailing '/' for directories)
  (func $writeNodePath (param $id i32)
    (local $stack i32) (local $n i32) (local $cur i32) (local $isDirNode i32)
    (local.set $isDirNode (call $isDir (local.get $id)))
    (local.set $cur (local.get $id))
    (local.set $n (i32.const 0))
    (block $top
      (loop $up
        (br_if $top (call $isRoot (local.get $cur)))
        (call $arrReserve (i32.const $A.stack) (i32.add (local.get $n) (i32.const 1)))
        (i32.store (i32.add (call $base (i32.const $A.stack)) (i32.shl (local.get $n) (i32.const 2))) (local.get $cur))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (local.set $cur (call $parentOf (local.get $cur)))
        (br $up)))
    (block $done
      (loop $down
        (br_if $done (i32.eqz (local.get $n)))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (local.set $cur (i32.load (i32.add (call $base (i32.const $A.stack)) (i32.shl (local.get $n) (i32.const 2)))))
        (call $outSegment (call $nameOf (local.get $cur)))
        (if (i32.or (local.get $n) (local.get $isDirNode)) (then (call $outByte (i32.const 47))))
        (br $down))))

  ;; Expand every directory named by the newline-delimited paths in
  ;; [$ptr, $ptr+$len) (a trailing '/' is optional). Consecutive paths share
  ;; a prefix, so each path only resolves its unshared tail, as
  ;; PathStore.initializeExpandedPaths does. Returns the number of
  ;; directories that were newly expanded.
  (func $resolveExpandedPaths (param $ptr i32) (param $len i32) (result i32)
    (local $end i32) (local $p i32) (local $lineStart i32) (local $lineEnd i32) (local $prevStart i32) (local $prevEnd i32)
    (local $depth i32) (local $segStart i32) (local $c i32) (local $i i32) (local $cmpLen i32) (local $cur i32)
    (local $segId i32) (local $count i32) (local $stack i32) (local $ok i32) (local $prevDepth i32)
    (local.set $end (i32.add (local.get $ptr) (local.get $len)))
    (local.set $p (local.get $ptr))
    (local.set $prevStart (i32.const -1))
    (call $arrReserve (i32.const $A.stack) (i32.const 1024))
    (local.set $stack (call $base (i32.const $A.stack)))
    (i32.store (local.get $stack) (i32.const 0))
    (block $eof
      (loop $line
        (br_if $eof (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $lineStart (local.get $p))
        ;; find the line end, dropping one trailing '/'
        (block $found
          (loop $scanEnd
            (br_if $found (i32.ge_u (local.get $p) (local.get $end)))
            (br_if $found (i32.eq (i32.load8_u (local.get $p)) (i32.const 10)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scanEnd)))
        (local.set $lineEnd (local.get $p))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (i32.and (i32.gt_u (local.get $lineEnd) (local.get $lineStart))
                     (i32.eq (i32.load8_u (i32.sub (local.get $lineEnd) (i32.const 1))) (i32.const 47)))
          (then (local.set $lineEnd (i32.sub (local.get $lineEnd) (i32.const 1)))))
        (if (i32.eq (local.get $lineEnd) (local.get $lineStart))
          (then (local.set $prevStart (i32.const -1)) (br $line)))
        ;; shared prefix with the previous resolved line, whole segments only
        (local.set $depth (i32.const 0))
        (local.set $segStart (local.get $lineStart))
        (if (i32.ne (local.get $prevStart) (i32.const -1))
          (then
            (local.set $cmpLen (i32.sub (local.get $prevEnd) (local.get $prevStart)))
            (if (i32.lt_u (i32.sub (local.get $lineEnd) (local.get $lineStart)) (local.get $cmpLen))
              (then (local.set $cmpLen (i32.sub (local.get $lineEnd) (local.get $lineStart)))))
            (local.set $i (i32.const 0))
            (block $stop
              (loop $cmp
                (br_if $stop (i32.ge_u (local.get $i) (local.get $cmpLen)))
                (local.set $c (i32.load8_u (i32.add (local.get $lineStart) (local.get $i))))
                (br_if $stop (i32.ne (local.get $c) (i32.load8_u (i32.add (local.get $prevStart) (local.get $i)))))
                (if (i32.eq (local.get $c) (i32.const 47))
                  (then
                    (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                    (local.set $segStart (i32.add (i32.add (local.get $lineStart) (local.get $i)) (i32.const 1)))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $cmp)))
            ;; the whole previous line as a prefix followed by '/' shares its last segment too
            (if (i32.and (i32.eq (local.get $i) (local.get $cmpLen))
                  (i32.and (i32.eq (local.get $cmpLen) (i32.sub (local.get $prevEnd) (local.get $prevStart)))
                    (i32.and (i32.gt_u (local.get $lineEnd) (i32.add (local.get $lineStart) (local.get $cmpLen)))
                             (i32.eq (i32.load8_u (i32.add (local.get $lineStart) (local.get $cmpLen))) (i32.const 47)))))
              (then
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (local.set $segStart (i32.add (i32.add (local.get $lineStart) (local.get $cmpLen)) (i32.const 1)))))
            (if (i32.gt_u (local.get $depth) (local.get $prevDepth)) (then
              (local.set $depth (local.get $prevDepth))))))
        ;; the shared prefix may end exactly at this line's end (line is an ancestor of the previous)
        (local.set $cur (i32.load (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2)))))
        (local.set $ok (i32.const 1))
        (if (i32.lt_u (local.get $segStart) (local.get $lineEnd))
          (then
            (local.set $p (local.get $segStart))
            (block $eol
              (loop $scan
                (if (i32.or (i32.ge_u (local.get $p) (local.get $lineEnd)) (i32.eq (i32.load8_u (local.get $p)) (i32.const 47)))
                  (then
                    (local.set $segId (call $findSegment (local.get $segStart) (i32.sub (local.get $p) (local.get $segStart))))
                    (local.set $cur (select (i32.const -1) (call $chFind (local.get $cur) (local.get $segId)) (i32.eq (local.get $segId) (i32.const -1))))
                    (if (i32.or (i32.eq (local.get $cur) (i32.const -1)) (i32.eqz (call $isDir (local.get $cur))))
                      (then (local.set $ok (i32.const 0)) (br $eol)))
                    (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                    (call $arrReserve (i32.const $A.stack) (i32.add (local.get $depth) (i32.const 2)))
                    (local.set $stack (call $base (i32.const $A.stack)))
                    (i32.store (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 2))) (local.get $cur))
                    (if (i32.eqz (call $isExpanded (local.get $cur)))
                      (then
                        (call $setExpanded (local.get $cur) (i32.const 1))
                        (local.set $count (i32.add (local.get $count) (i32.const 1)))))
                    (local.set $segStart (i32.add (local.get $p) (i32.const 1)))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $scan (i32.le_u (local.get $p) (local.get $lineEnd)))))))
        (if (local.get $ok)
          (then
            (local.set $prevStart (local.get $lineStart))
            (local.set $prevEnd (local.get $lineEnd))
            (local.set $prevDepth (local.get $depth)))
          (else (local.set $prevStart (i32.const -1))))
        (local.set $p (i32.add (local.get $lineEnd) (i32.const 1)))
        ;; skip the dropped trailing '/' when present
        (if (i32.and (i32.lt_u (local.get $p) (local.get $end)) (i32.eq (i32.load8_u (local.get $p)) (i32.const 10)))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (br $line)))
    (local.get $count))

  ;; Append the canonical entries under $id (files and explicit empty
  ;; directories, preorder) to out, newline-delimited, like listPaths.
  (func $listPaths (param $id i32)
    (local $prefixLen i32) (local $sp i32) (local $frames i32) (local $d i32) (local $i i32) (local $c i32)
    (local $scratch i32) (local $segLen i32)
    (if (i32.eqz (call $isLive (local.get $id))) (then (return)))
    (if (i32.eqz (call $isDir (local.get $id)))
      (then (call $writeNodePath (local.get $id)) (call $outByte (i32.const 10)) (return)))
    (if (i32.eqz (call $dChildCount (call $dirOf (local.get $id))))
      (then
        (if (i32.and (call $hasFlag (local.get $id) (i32.const $F.explicit)) (i32.eqz (call $isRoot (local.get $id))))
          (then (call $writeNodePath (local.get $id)) (call $outByte (i32.const 10))))
        (return)))
    ;; prefix bytes of the current directory live in scratch
    (drop (call $scratchReserve (i32.const 4096)))
    (call $writeNodePath (local.get $id))
    (local.set $prefixLen (call $len (i32.const $A.out)))
    (call $arrReserve (i32.const $A.scratch) (i32.add (local.get $prefixLen) (i32.const 1)))
    (memory.copy (call $base (i32.const $A.scratch)) (call $base (i32.const $A.out)) (local.get $prefixLen))
    (call $outReset)
    ;; frames: dirIdx, childPos, prefixLen
    (call $arrReserve (i32.const $A.stack) (i32.const 3072))
    (local.set $frames (call $base (i32.const $A.stack)))
    (i32.store (local.get $frames) (call $dirOf (local.get $id)))
    (i32.store offset=4 (local.get $frames) (i32.const 0))
    (i32.store offset=8 (local.get $frames) (local.get $prefixLen))
    (local.set $sp (i32.const 1))
    (block $done
      (loop $walk
        (br_if $done (i32.eqz (local.get $sp)))
        (local.set $frames (i32.add (call $base (i32.const $A.stack)) (i32.mul (i32.sub (local.get $sp) (i32.const 1)) (i32.const 12))))
        (local.set $d (i32.load (local.get $frames)))
        (local.set $i (i32.load offset=4 (local.get $frames)))
        (local.set $prefixLen (i32.load offset=8 (local.get $frames)))
        (if (i32.ge_u (local.get $i) (call $dChildCount (local.get $d)))
          (then (local.set $sp (i32.sub (local.get $sp) (i32.const 1))) (br $walk)))
        (i32.store offset=4 (local.get $frames) (i32.add (local.get $i) (i32.const 1)))
        (local.set $c (call $childAt (local.get $d) (local.get $i)))
        (if (i32.eqz (call $isLive (local.get $c))) (then (br $walk)))
        (local.set $segLen (call $segLength (call $nameOf (local.get $c))))
        (if (i32.eqz (call $isDir (local.get $c)))
          (then
            (call $outBytes (call $base (i32.const $A.scratch)) (local.get $prefixLen))
            (call $outSegment (call $nameOf (local.get $c)))
            (call $outByte (i32.const 10))
            (br $walk)))
        (if (i32.eqz (call $dChildCount (call $dirOf (local.get $c))))
          (then
            (if (call $hasFlag (local.get $c) (i32.const $F.explicit))
              (then
                (call $outBytes (call $base (i32.const $A.scratch)) (local.get $prefixLen))
                (call $outSegment (call $nameOf (local.get $c)))
                (call $outByte (i32.const 47))
                (call $outByte (i32.const 10))))
            (br $walk)))
        ;; descend: extend the prefix with "name/"
        (call $arrReserve (i32.const $A.scratch) (i32.add (i32.add (local.get $prefixLen) (local.get $segLen)) (i32.const 2)))
        (local.set $scratch (i32.add (call $base (i32.const $A.scratch)) (local.get $prefixLen)))
        (memory.copy (local.get $scratch) (call $segPtr (call $nameOf (local.get $c))) (local.get $segLen))
        (i32.store8 (i32.add (local.get $scratch) (local.get $segLen)) (i32.const 47))
        (call $arrReserve (i32.const $A.stack) (i32.mul (i32.add (local.get $sp) (i32.const 1)) (i32.const 3)))
        (local.set $frames (i32.add (call $base (i32.const $A.stack)) (i32.mul (local.get $sp) (i32.const 12))))
        (i32.store (local.get $frames) (call $dirOf (local.get $c)))
        (i32.store offset=4 (local.get $frames) (i32.const 0))
        (i32.store offset=8 (local.get $frames) (i32.add (i32.add (local.get $prefixLen) (local.get $segLen)) (i32.const 1)))
        (local.set $sp (i32.add (local.get $sp) (i32.const 1)))
        (br $walk))))
)
