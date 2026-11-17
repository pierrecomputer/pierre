(module
  (;;
    memory structure
    [0:64)        scalar results of the last call (i32 slots, see $R.*)
    [64:1088)     array descriptors, 16 bytes each (see $A.* and $D.*)
    [1088:4096)   reserved
    [4096:…)      heap: every array below lives in a bump-allocated block and
                  relocates when it grows; $compact repacks the live blocks

    Arrays indexed by node id (i32 unless noted):
      parent, name (segment id), meta (see state.wat), subtree, visible,
      dir (directory record index or -1), pos (index inside the parent's
      child list)
    Arrays indexed by directory record:
      dNode, dChildBase (offset into pool), dChildCount, dChildCap,
      dTotalSubtree, dTotalVisible, dChunk (offset into pool of the 32-child
      visible chunk sums, or -1)
    Segments: segOff/segLen index segBytes (len | nonAscii << 31); segHash is
      an open addressing table of id + 1.
    pool: child id lists (CSR after ingest, bump-allocated blocks after
      mutations) and chunk sum arrays.
    chHash: (parent, name) -> child id + 1 lookup table, 0 empty, -1 tombstone.
    out: byte/i32 output area read by the host after each call.
    stack: scratch i32 stack for walks.
    input: host-written path bytes during ingest.
  ;;)
  (memory (export "memory") 4)

  (const $mem.result 0)
  (const $mem.desc 64)
  (const $mem.heap 4096)

  ;; descriptor fields
  (const $D.base 0)
  (const $D.len 4)
  (const $D.cap 8)
  (const $D.shift 12)

  ;; array ids
  (const $A.parent 0)
  (const $A.name 1)
  (const $A.meta 2)
  (const $A.subtree 3)
  (const $A.visible 4)
  (const $A.dir 5)
  (const $A.pos 6)
  (const $A.dNode 7)
  (const $A.dChildBase 8)
  (const $A.dChildCount 9)
  (const $A.dChildCap 10)
  (const $A.dTotalSubtree 11)
  (const $A.dTotalVisible 12)
  (const $A.dChunk 13)
  (const $A.segOff 14)
  (const $A.segLen 15)
  (const $A.segBytes 16)
  (const $A.segHash 17)
  (const $A.pool 18)
  (const $A.chHash 19)
  (const $A.out 20)
  (const $A.stack 21)
  (const $A.input 22)
  (const $A.scratch 23)
  (const $A.count 24)

  ;; bumped whenever a block moves, so the host knows to rebuild its views
  (const $mem.generation 60)

  (global $heapTop (mut i32) (i32.const 4096))

  (func $descAddr (param $a i32) (result i32)
    (i32.add (i32.const $mem.desc) (i32.shl (local.get $a) (i32.const 4))))

  (func $base (param $a i32) (result i32)
    (i32.load offset=$mem.desc (i32.shl (local.get $a) (i32.const 4))))

  (func $len (param $a i32) (result i32)
    (i32.load offset=$mem.desc+4 (i32.shl (local.get $a) (i32.const 4))))

  (func $cap (param $a i32) (result i32)
    (i32.load offset=$mem.desc+8 (i32.shl (local.get $a) (i32.const 4))))

  (func $shift (param $a i32) (result i32)
    (i32.load offset=$mem.desc+12 (i32.shl (local.get $a) (i32.const 4))))

  (func $setLen (param $a i32) (param $n i32)
    (i32.store offset=$mem.desc+4 (i32.shl (local.get $a) (i32.const 4)) (local.get $n)))

  ;; grow linear memory so that [0, $end) is addressable, with 25% slack so
  ;; the number of grows stays logarithmic; a failed grow traps on purpose
  (func $ensureMemory (param $end i32)
    (local $pages i32) (local $need i32) (local $want i32)
    (local.set $pages (memory.size))
    (local.set $need (i32.add (i32.shr_u (local.get $end) (i32.const 16))
      (i32.ne (i32.and (local.get $end) (i32.const 0xffff)) (i32.const 0))))
    (if (i32.le_u (local.get $need) (local.get $pages)) (then (return)))
    (local.set $want (i32.add (local.get $need) (i32.shr_u (local.get $need) (i32.const 2))))
    (if (i32.gt_u (local.get $want) (i32.const 65536)) (then (local.set $want (i32.const 65536))))
    (if (i32.eq (memory.grow (i32.sub (local.get $want) (local.get $pages))) (i32.const -1))
      (then
        (if (i32.eq (memory.grow (i32.sub (local.get $need) (local.get $pages))) (i32.const -1))
          (then (unreachable))))))

  ;; bump-allocate $bytes (16-byte aligned, contents unspecified)
  (func $alloc (param $bytes i32) (result i32)
    (local $at i32) (local $end i32)
    (local.set $at (i32.and (i32.add (global.get $heapTop) (i32.const 15)) (i32.const -16)))
    (local.set $end (i32.add (local.get $at) (local.get $bytes)))
    (call $ensureMemory (local.get $end))
    (global.set $heapTop (local.get $end))
    (i32.store (i32.const $mem.generation) (i32.add (i32.load (i32.const $mem.generation)) (i32.const 1)))
    (local.get $at))

  ;; bump-allocate and zero-fill (hash tables)
  (func $allocZeroed (param $bytes i32) (result i32)
    (local $at i32)
    (local.set $at (call $alloc (local.get $bytes)))
    (memory.fill (local.get $at) (i32.const 0) (local.get $bytes))
    (local.get $at))

  ;; (re)create array $a with element size 1 << $shift and room for $cap elements
  (func $arrInit (param $a i32) (param $shift i32) (param $cap i32)
    (local $d i32)
    (local.set $d (call $descAddr (local.get $a)))
    (i32.store offset=$D.shift (local.get $d) (local.get $shift))
    (i32.store offset=$D.len (local.get $d) (i32.const 0))
    (i32.store offset=$D.cap (local.get $d) (local.get $cap))
    (i32.store offset=$D.base (local.get $d)
      (call $alloc (i32.shl (local.get $cap) (local.get $shift)))))

  ;; make room for at least $min elements; relocates the block when it grows,
  ;; so callers reload cached bases afterwards
  (func $arrReserve (param $a i32) (param $min i32)
    (local $d i32) (local $cap i32) (local $next i32) (local $new i32) (local $sh i32)
    (local.set $d (call $descAddr (local.get $a)))
    (local.set $cap (i32.load offset=$D.cap (local.get $d)))
    (if (i32.le_u (local.get $min) (local.get $cap)) (then (return)))
    (local.set $next (i32.add (local.get $cap) (i32.shr_u (local.get $cap) (i32.const 1))))
    (if (i32.lt_u (local.get $next) (local.get $min)) (then (local.set $next (local.get $min))))
    (if (i32.lt_u (local.get $next) (i32.const 64)) (then (local.set $next (i32.const 64))))
    (local.set $sh (i32.load offset=$D.shift (local.get $d)))
    (local.set $new (call $alloc (i32.shl (local.get $next) (local.get $sh))))
    ;; whole block: scratch arrays address their capacity without tracking len
    (memory.copy (local.get $new)
      (i32.load offset=$D.base (local.get $d))
      (i32.shl (local.get $cap) (local.get $sh)))
    (i32.store offset=$D.base (local.get $d) (local.get $new))
    (i32.store offset=$D.cap (local.get $d) (local.get $next)))

  ;; append one i32 element to array $a (shift 2) and return its index
  (func $arrPush (param $a i32) (param $v i32) (result i32)
    (local $d i32) (local $n i32)
    (local.set $d (call $descAddr (local.get $a)))
    (local.set $n (i32.load offset=$D.len (local.get $d)))
    (call $arrReserve (local.get $a) (i32.add (local.get $n) (i32.const 1)))
    (i32.store
      (i32.add (i32.load offset=$D.base (local.get $d)) (i32.shl (local.get $n) (i32.const 2)))
      (local.get $v))
    (i32.store offset=$D.len (local.get $d) (i32.add (local.get $n) (i32.const 1)))
    (local.get $n))

  ;; i32 element read/write helpers for shift-2 arrays
  (func $get (param $a i32) (param $i i32) (result i32)
    (i32.load (i32.add (call $base (local.get $a)) (i32.shl (local.get $i) (i32.const 2)))))

  (func $set (param $a i32) (param $i i32) (param $v i32)
    (i32.store (i32.add (call $base (local.get $a)) (i32.shl (local.get $i) (i32.const 2))) (local.get $v)))

  ;; drop every array and start the heap over
  (func $resetHeap
    (memory.fill (i32.const $mem.desc) (i32.const 0) (i32.const 1024))
    (i32.store (i32.const $mem.generation) (i32.add (i32.load (i32.const $mem.generation)) (i32.const 1)))
    (global.set $heapTop (i32.const $mem.heap)))

  ;; Repack the live arrays at the bottom of the heap in address order, so
  ;; garbage left by relocating grows and by the ingest input becomes free.
  ;; Copying in ascending source order never overwrites an unmoved source:
  ;; the destination of each block is at or below its source.
  (func $compact
    (local $dst i32) (local $a i32) (local $best i32) (local $bestBase i32) (local $b i32)
    (local $d i32) (local $used i32) (local $keep i32)
    (local.set $dst (i32.const $mem.heap))
    (loop $pick
      ;; smallest base among arrays not yet moved (moved arrays sit below $dst)
      (local.set $best (i32.const -1))
      (local.set $bestBase (i32.const -1))
      (local.set $a (i32.const 0))
      (loop $scan
        (local.set $b (call $base (local.get $a)))
        (if (i32.and (i32.ge_u (local.get $b) (local.get $dst))
                     (i32.lt_u (local.get $b) (local.get $bestBase)))
          (then (local.set $best (local.get $a)) (local.set $bestBase (local.get $b))))
        (local.set $a (i32.add (local.get $a) (i32.const 1)))
        (br_if $scan (i32.lt_u (local.get $a) (i32.const $A.count))))
      (if (i32.eq (local.get $best) (i32.const -1))
        (then
          (global.set $heapTop (local.get $dst))
          (i32.store (i32.const $mem.generation) (i32.add (i32.load (i32.const $mem.generation)) (i32.const 1)))
          (return)))
      (local.set $d (call $descAddr (local.get $best)))
      ;; hash tables and the pool keep their full capacity (slots are
      ;; addressed beyond len); other arrays shrink to their length plus
      ;; slack, never copying more than the old block held
      (local.set $used (i32.shl (i32.load offset=$D.cap (local.get $d)) (i32.load offset=$D.shift (local.get $d))))
      (local.set $keep (local.get $used))
      (if (i32.and
          (i32.and (i32.ne (local.get $best) (i32.const $A.segHash)) (i32.ne (local.get $best) (i32.const $A.chHash)))
          (i32.ne (local.get $best) (i32.const $A.pool)))
      (then
        (local.set $keep (i32.add
          (i32.shl (i32.load offset=$D.len (local.get $d)) (i32.load offset=$D.shift (local.get $d)))
          (i32.const 64)))
        (if (i32.lt_u (local.get $keep) (local.get $used)) (then (local.set $used (local.get $keep))))
        (i32.store offset=$D.cap (local.get $d)
          (i32.shr_u (local.get $keep) (i32.load offset=$D.shift (local.get $d))))))
      (if (local.get $used)
        (then (memory.copy (local.get $dst) (local.get $bestBase) (local.get $used))))
      (i32.store offset=$D.base (local.get $d) (local.get $dst))
      (local.set $dst (i32.and (i32.add (i32.add (local.get $dst) (local.get $keep)) (i32.const 15)) (i32.const -16)))
      (br $pick)))
)
