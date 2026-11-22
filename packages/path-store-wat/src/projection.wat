(module
  (import "./memory.wat")
  (import "./segments.wat")
  (import "./state.wat")
  (import "./ingest.wat")
  (import "./lookup.wat")

  ;; row record written to out: 6 i32s
  (const $ROW.size 24)

  ;; DFS frame on the stack array: 4 i32s
  (const $FR.size 4)

  ;; Child of directory record $d holding visible index $vis: writes the
  ;; child position to $R.value and the index inside that child's subtree
  ;; to $R.value2. Wide directories skip whole 32-child chunks first.
  (func $selectChild (param $d i32) (param $vis i32)
    (local $kids i32) (local $n i32) (local $i i32) (local $sums i32) (local $chunks i32) (local $c i32) (local $v i32)
    (local.set $kids (call $dChildren (local.get $d)))
    (local.set $n (call $dChildCount (local.get $d)))
    (if (i32.ne (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const -1))
      (then
        (local.set $sums (i32.add (call $base (i32.const $A.pool)) (i32.shl (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const 2))))
        (local.set $chunks (i32.shr_u (i32.add (local.get $n) (i32.const $CHUNK.size-1)) (i32.const $CHUNK.shift)))
        (block $found
          (loop $each
            (br_if $found (i32.ge_u (local.get $c) (local.get $chunks)))
            (local.set $v (i32.load (i32.add (local.get $sums) (i32.shl (local.get $c) (i32.const 2)))))
            (br_if $found (i32.lt_u (local.get $vis) (local.get $v)))
            (local.set $vis (i32.sub (local.get $vis) (local.get $v)))
            (local.set $c (i32.add (local.get $c) (i32.const 1)))
            (br $each)))
        (local.set $i (i32.shl (local.get $c) (i32.const $CHUNK.shift)))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $v (call $visibleOf (i32.load (i32.add (local.get $kids) (i32.shl (local.get $i) (i32.const 2))))))
        (if (i32.lt_u (local.get $vis) (local.get $v))
          (then
            (i32.store offset=$R.value (i32.const $mem.result) (local.get $i))
            (i32.store offset=$R.value2 (i32.const $mem.result) (local.get $vis))
            (return)))
        (local.set $vis (i32.sub (local.get $vis) (local.get $v)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))
    (unreachable))

  ;; visible rows contributed by the siblings before position $pos
  (func $visiblePrefixCount (param $d i32) (param $pos i32) (result i32)
    (local $kids i32) (local $i i32) (local $sums i32) (local $count i32) (local $chunk i32) (local $c i32)
    (if (i32.ne (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const -1))
      (then
        (local.set $sums (i32.add (call $base (i32.const $A.pool)) (i32.shl (call $get (i32.const $A.dChunk) (local.get $d)) (i32.const 2))))
        (local.set $chunk (i32.shr_u (local.get $pos) (i32.const $CHUNK.shift)))
        (block $done1
          (loop $each
            (br_if $done1 (i32.ge_u (local.get $c) (local.get $chunk)))
            (local.set $count (i32.add (local.get $count) (i32.load (i32.add (local.get $sums) (i32.shl (local.get $c) (i32.const 2))))))
            (local.set $c (i32.add (local.get $c) (i32.const 1)))
            (br $each)))
        (local.set $i (i32.shl (local.get $chunk) (i32.const $CHUNK.shift)))))
    (local.set $kids (call $dChildren (local.get $d)))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $i) (local.get $pos)))
        (local.set $count (i32.add (local.get $count) (call $visibleOf (i32.load (i32.add (local.get $kids) (i32.shl (local.get $i) (i32.const 2)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)))
    (local.get $count))

  ;; the row terminal for a child: directories flatten into their chain end
  (func $rowTerminal (param $id i32) (result i32)
    (select (call $flattenTerminal (local.get $id)) (local.get $id) (call $isDir (local.get $id))))

  (func $emitRow (param $head i32) (param $terminal i32) (param $depth i32) (param $pos i32) (param $setSize i32) (param $parentRow i32)
    (local $at i32)
    (local.set $at (call $outReserve (i32.const $ROW.size)))
    (i32.store offset=0 (local.get $at) (local.get $head))
    (i32.store offset=4 (local.get $at) (local.get $terminal))
    (i32.store offset=8 (local.get $at) (local.get $depth))
    (i32.store offset=12 (local.get $at) (local.get $pos))
    (i32.store offset=16 (local.get $at) (local.get $setSize))
    (i32.store offset=20 (local.get $at) (local.get $parentRow))
    (call $outAdvance (i32.const $ROW.size)))

  (func $frameAddr (param $i i32) (result i32)
    (i32.add (call $base (i32.const $A.stack)) (i32.shl (local.get $i) (i32.const 4))))

  ;; frame: directory record, next child position, visible depth, owner row
  (func $pushFrame (param $sp i32) (param $d i32) (param $pos i32) (param $depth i32) (param $ownerRow i32)
    (local $f i32)
    (call $arrReserve (i32.const $A.stack) (i32.shl (i32.add (local.get $sp) (i32.const 1)) (i32.const 2)))
    (local.set $f (call $frameAddr (local.get $sp)))
    (i32.store offset=0 (local.get $f) (local.get $d))
    (i32.store offset=4 (local.get $f) (local.get $pos))
    (i32.store offset=8 (local.get $f) (local.get $depth))
    (i32.store offset=12 (local.get $f) (local.get $ownerRow)))

  ;; Write up to $count visible rows starting at visible index $start to
  ;; out (see $emitRow). Descends to the first row by visible counts, then
  ;; continues the preorder walk through expanded directories. Row indexes
  ;; in the parentRow field are relative to $start; -1 marks a parent above
  ;; the window.
  (func $collectRows (param $start i32) (param $count i32)
    (local $sp i32) (local $d i32) (local $vis i32) (local $depth i32) (local $pos i32) (local $local i32)
    (local $child i32) (local $terminal i32) (local $emitted i32) (local $f i32) (local $ownerRow i32)
    (local $total i32)
    (call $outReset)
    (local.set $total (call $visibleOf (i32.const 0)))
    (if (i32.or (i32.eqz (local.get $count)) (i32.ge_u (local.get $start) (local.get $total))) (then (return)))
    ;; one reservation for the whole window instead of growing row by row
    (if (i32.gt_u (local.get $count) (i32.sub (local.get $total) (local.get $start)))
      (then (local.set $count (i32.sub (local.get $total) (local.get $start)))))
    (call $arrReserve (i32.const $A.out) (i32.add (i32.mul (local.get $count) (i32.const $ROW.size)) (i32.const 64)))
    ;; descent
    (local.set $d (call $dirOf (i32.const 0)))
    (local.set $vis (local.get $start))
    (local.set $depth (i32.const 0))
    (local.set $ownerRow (i32.const -1))
    (loop $descend
      (call $selectChild (local.get $d) (local.get $vis))
      (local.set $pos (i32.load offset=$R.value (i32.const $mem.result)))
      (local.set $local (i32.load offset=$R.value2 (i32.const $mem.result)))
      (local.set $child (call $childAt (local.get $d) (local.get $pos)))
      (local.set $terminal (call $rowTerminal (local.get $child)))
      ;; the frame resumes after this child once its subtree is done
      (call $pushFrame (local.get $sp) (local.get $d) (i32.add (local.get $pos) (i32.const 1)) (local.get $depth) (local.get $ownerRow))
      (local.set $sp (i32.add (local.get $sp) (i32.const 1)))
      (if (local.get $local)
        (then
          ;; the target row lies inside this (expanded) child's subtree
          (local.set $d (call $dirOf (local.get $terminal)))
          (local.set $vis (i32.sub (local.get $local) (i32.const 1)))
          (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
          (local.set $ownerRow (i32.const -1))
          (br $descend))))
    ;; first row
    (call $emitRow (local.get $child) (local.get $terminal) (local.get $depth) (local.get $pos) (call $dChildCount (local.get $d)) (local.get $ownerRow))
    (local.set $emitted (i32.const 1))
    (if (i32.and (call $isDir (local.get $terminal)) (call $isExpanded (local.get $terminal)))
      (then
        (call $pushFrame (local.get $sp) (call $dirOf (local.get $terminal)) (i32.const 0) (i32.add (local.get $depth) (i32.const 1)) (i32.const 0))
        (local.set $sp (i32.add (local.get $sp) (i32.const 1)))))
    ;; preorder continuation
    (block $done
      (loop $walk
        (br_if $done (i32.ge_u (local.get $emitted) (local.get $count)))
        (br_if $done (i32.eqz (local.get $sp)))
        (local.set $f (call $frameAddr (i32.sub (local.get $sp) (i32.const 1))))
        (local.set $d (i32.load offset=0 (local.get $f)))
        (local.set $pos (i32.load offset=4 (local.get $f)))
        (if (i32.ge_u (local.get $pos) (call $dChildCount (local.get $d)))
          (then (local.set $sp (i32.sub (local.get $sp) (i32.const 1))) (br $walk)))
        (i32.store offset=4 (local.get $f) (i32.add (local.get $pos) (i32.const 1)))
        (local.set $depth (i32.load offset=8 (local.get $f)))
        (local.set $ownerRow (i32.load offset=12 (local.get $f)))
        (local.set $child (call $childAt (local.get $d) (local.get $pos)))
        (local.set $terminal (call $rowTerminal (local.get $child)))
        (call $emitRow (local.get $child) (local.get $terminal) (local.get $depth) (local.get $pos) (call $dChildCount (local.get $d)) (local.get $ownerRow))
        (if (i32.and (call $isDir (local.get $terminal)) (call $isExpanded (local.get $terminal)))
          (then
            (call $pushFrame (local.get $sp) (call $dirOf (local.get $terminal)) (i32.const 0) (i32.add (local.get $depth) (i32.const 1)) (local.get $emitted))
            (local.set $sp (i32.add (local.get $sp) (i32.const 1)))))
        (local.set $emitted (i32.add (local.get $emitted) (i32.const 1)))
        (br $walk))))

  ;; Row at visible index $index plus its ancestor rows: out receives one
  ;; record per ancestor (outermost first) and then the row itself, each as
  ;; (head, terminal, visibleDepth, posInSet, setSize, rowIndex).
  (func $rowContext (param $index i32)
    (local $d i32) (local $vis i32) (local $depth i32) (local $pos i32) (local $local i32) (local $child i32)
    (local $terminal i32) (local $rowIndex i32)
    (call $outReset)
    (if (i32.ge_u (local.get $index) (call $visibleOf (i32.const 0))) (then (return)))
    (local.set $d (call $dirOf (i32.const 0)))
    (local.set $vis (local.get $index))
    (loop $descend
      (call $selectChild (local.get $d) (local.get $vis))
      (local.set $pos (i32.load offset=$R.value (i32.const $mem.result)))
      (local.set $local (i32.load offset=$R.value2 (i32.const $mem.result)))
      (local.set $child (call $childAt (local.get $d) (local.get $pos)))
      (local.set $terminal (call $rowTerminal (local.get $child)))
      (local.set $rowIndex (i32.add (local.get $rowIndex) (i32.sub (local.get $vis) (local.get $local))))
      (call $emitRow (local.get $child) (local.get $terminal) (local.get $depth) (local.get $pos) (call $dChildCount (local.get $d)) (local.get $rowIndex))
      (if (local.get $local)
        (then
          (local.set $d (call $dirOf (local.get $terminal)))
          (local.set $vis (i32.sub (local.get $local) (i32.const 1)))
          (local.set $rowIndex (i32.add (local.get $rowIndex) (i32.const 1)))
          (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
          (br $descend)))))

  ;; visible row index of node $id, or -1 when hidden or flattened away
  (func $visibleIndexOf (param $id i32) (result i32)
    (local $index i32) (local $parent i32)
    (if (i32.eqz (local.get $id)) (then (return (i32.const -1))))
    (if (call $isDir (local.get $id))
      (then (if (i32.ne (call $flattenTerminal (local.get $id)) (local.get $id)) (then (return (i32.const -1))))))
    (loop $up
      (local.set $parent (call $parentOf (local.get $id)))
      (local.set $index (i32.add (local.get $index)
        (call $visiblePrefixCount (call $dirOf (local.get $parent)) (call $get (i32.const $A.pos) (local.get $id)))))
      (if (i32.eqz (call $isRoot (local.get $parent)))
        (then
          (if (i32.and (i32.eqz (call $isExpanded (local.get $parent)))
                       (i32.ne (call $flattenedChild (local.get $parent)) (local.get $id)))
            (then (return (i32.const -1))))
          (if (i32.eq (call $flattenTerminal (local.get $parent)) (local.get $parent))
            (then (local.set $index (i32.add (local.get $index) (i32.const 1)))))
          (local.set $id (local.get $parent))
          (br $up))))
    (local.get $index))

  ;; append the flattened chain head..terminal of $id to out as i32 ids
  (func $flattenChain (param $id i32)
    (local $next i32)
    (call $outReset)
    (call $outI32 (local.get $id))
    (loop $walk
      (local.set $next (call $flattenedChild (local.get $id)))
      (if (i32.ne (local.get $next) (i32.const -1))
        (then
          (call $outI32 (local.get $next))
          (local.set $id (local.get $next))
          (br $walk)))))
)
