(module
  (;;
    Native incremental tokenizer core.

    A live instance owns the whole text-page range and keeps the document,
    line table, per-line token blocks, and interned per-line lexer states in
    linear memory:

      page 1                    control, static data, live free-list heads
      [65536:81920)             line-change list: count, then 16-byte entries
      [86016:$lvHeapCeil)       size-class heap: staged text, line text
                                blocks, token blocks, state blobs, line table
      [$lvHeapCeil:mem end)     transient per-line scratch: the line's bytes,
                                terminator, NUL sentinel, then the standard
                                aligned record output written by the emitter

    Per line the driver restores the incoming interned state, copies the
    line into scratch, runs the ordinary streaming chunk pipeline in
    line-record mode, captures and interns the outgoing state, and stores the
    packed token records. Re-tokenization after an edit stops once a line's
    new outgoing state id equals its old one.
  ;;)

  (import "./memory.wat")
  (import "./token.wat")
  (import "./scan.wat")
  (import "./emit.wat")

  ;; allocator
  (global $lvInited (mut i32) (i32.const 0))
  (global $lvHeapEnd (mut i32) (i32.const 0))   ;; bump cursor
  (global $lvHeapCeil (mut i32) (i32.const 0))  ;; heap top, scratch base
  (global $lvHeapLive (mut i32) (i32.const 0))  ;; allocated bytes incl headers
  (global $lvHeapFreed (mut i32) (i32.const 0)) ;; bytes parked in free lists

  ;; transient window above the heap that must survive heap extension
  (global $lvTransLo (mut i32) (i32.const 0))
  (global $lvTransHi (mut i32) (i32.const 0))

  ;; grow linear memory so [0, addr+16) is addressable
  (func $lvGrowTo (param $addr i32)
    (local $need i32)
    (local.set $need (i32.add (local.get $addr) (i32.const 16)))
    (if (i32.gt_u (local.get $need) (i32.mul (memory.size) (i32.const 65536)))
      (then
        (if (i32.eq
              (memory.grow (i32.add
                (i32.shr_u
                  (i32.sub (local.get $need)
                    (i32.mul (memory.size) (i32.const 65536)))
                  (i32.const 16))
                (i32.const 1)))
              (i32.const -1))
          (then (unreachable))))))

  ;; size class of a total block size (8-aligned, >= 16). Classes are 8-byte
  ;; steps up to 64 and quarter-power-of-two steps above, list 31 collects
  ;; blocks above 64 KiB.
  (func $lvClassOf (param $size i32) (result i32)
    (local $p i32)
    (local $quarter i32)
    (if (i32.le_u (local.get $size) (i32.const 64))
      (then (return (i32.shr_u (i32.add (local.get $size) (i32.const 7)) (i32.const 3)))))
    (local.set $p (i32.sub (i32.const 32)
      (i32.clz (i32.sub (local.get $size) (i32.const 1)))))
    (if (i32.ge_u (local.get $p) (i32.const 17))
      (then (return (i32.const 31))))
    (local.set $quarter (i32.shl (i32.const 1) (i32.sub (local.get $p) (i32.const 2))))
    ;; round up to a quarter step, then map the step to one of two subclasses
    ;; above the 8-byte classes: sizes 3<<(p-2) and 4<<(p-2) take 9+(p-7)*2
    ;; and 10+(p-7)*2, so every class holds exactly one block size
    (i32.add
      (i32.add (i32.const 8)
        (i32.shl (i32.sub (local.get $p) (i32.const 7)) (i32.const 1)))
      (i32.sub
        (i32.shr_u
          (i32.and
            (i32.add (local.get $size) (i32.sub (local.get $quarter) (i32.const 1)))
            (i32.sub (i32.const 0) (local.get $quarter)))
          (i32.sub (local.get $p) (i32.const 2)))
        (i32.const 2))))

  ;; round a total block size up to its class size
  (func $lvRoundSize (param $size i32) (result i32)
    (local $p i32)
    (local $quarter i32)
    (if (i32.lt_u (local.get $size) (i32.const 16))
      (then (local.set $size (i32.const 16))))
    (if (i32.le_u (local.get $size) (i32.const 64))
      (then (return (i32.and (i32.add (local.get $size) (i32.const 7)) (i32.const -8)))))
    (local.set $p (i32.sub (i32.const 32)
      (i32.clz (i32.sub (local.get $size) (i32.const 1)))))
    (if (i32.ge_u (local.get $p) (i32.const 17))
      (then (return (i32.and (i32.add (local.get $size) (i32.const 7)) (i32.const -8)))))
    (local.set $quarter (i32.shl (i32.const 1) (i32.sub (local.get $p) (i32.const 2))))
    (i32.and
      (i32.add (local.get $size) (i32.sub (local.get $quarter) (i32.const 1)))
      (i32.sub (i32.const 0) (local.get $quarter))))

  ;; extend the heap area upward, sliding the transient scratch window with it
  (func $lvExtendHeap (param $min i32)
    (local $delta i32)
    (local.set $delta (i32.and
      (i32.add (local.get $min) (i32.const 327679)) (i32.const -65536)))
    (call $lvGrowTo (i32.add
      (i32.add (global.get $lvHeapCeil) (local.get $delta))
      (i32.add (i32.sub (global.get $lvTransHi) (global.get $lvTransLo)) (i32.const 64))))
    (if (i32.gt_u (global.get $lvTransHi) (global.get $lvTransLo))
      (then
        (memory.copy
          (i32.add (global.get $lvTransLo) (local.get $delta))
          (global.get $lvTransLo)
          (i32.sub (global.get $lvTransHi) (global.get $lvTransLo)))
        (global.set $lvTransLo (i32.add (global.get $lvTransLo) (local.get $delta)))
        (global.set $lvTransHi (i32.add (global.get $lvTransHi) (local.get $delta)))))
    (global.set $lvHeapCeil (i32.add (global.get $lvHeapCeil) (local.get $delta))))

  ;; allocate a block for $len body bytes; returns the body pointer
  (func $lvAlloc (param $len i32) (result i32)
    (local $total i32)
    (local $idx i32)
    (local $head i32)
    (local $prev i32)
    (local.set $total (call $lvRoundSize (i32.add (local.get $len) (i32.const 8))))
    (local.set $idx (call $lvClassOf (local.get $total)))
    (local.set $head (i32.load (i32.add (i32.const $mem.liveFree)
      (i32.shl (local.get $idx) (i32.const 2)))))
    (if (i32.ne (local.get $idx) (i32.const 31))
      (then
        (if (local.get $head)
          (then
            (i32.store (i32.add (i32.const $mem.liveFree)
              (i32.shl (local.get $idx) (i32.const 2)))
              (i32.load offset=4 (local.get $head)))
            (i32.store (local.get $head) (local.get $total))
            (global.set $lvHeapFreed (i32.sub (global.get $lvHeapFreed) (local.get $total)))
            (global.set $lvHeapLive (i32.add (global.get $lvHeapLive) (local.get $total)))
            (return (i32.add (local.get $head) (i32.const 8))))))
      (else
        ;; huge blocks: exact-size first fit
        (block $miss
          (loop $walk
            (br_if $miss (i32.eqz (local.get $head)))
            (if (i32.eq (i32.and (i32.load (local.get $head)) (i32.const -2))
                        (local.get $total))
              (then
                (if (local.get $prev)
                  (then (i32.store offset=4 (local.get $prev)
                    (i32.load offset=4 (local.get $head))))
                  (else (i32.store (i32.const $mem.liveFree+124)
                    (i32.load offset=4 (local.get $head)))))
                (i32.store (local.get $head) (local.get $total))
                (global.set $lvHeapFreed (i32.sub (global.get $lvHeapFreed) (local.get $total)))
                (global.set $lvHeapLive (i32.add (global.get $lvHeapLive) (local.get $total)))
                (return (i32.add (local.get $head) (i32.const 8)))))
            (local.set $prev (local.get $head))
            (local.set $head (i32.load offset=4 (local.get $head)))
            (br $walk)))))
    (if (i32.gt_u (i32.add (global.get $lvHeapEnd) (local.get $total))
                  (global.get $lvHeapCeil))
      (then (call $lvExtendHeap (local.get $total))))
    (local.set $head (global.get $lvHeapEnd))
    (global.set $lvHeapEnd (i32.add (local.get $head) (local.get $total)))
    (i32.store (local.get $head) (local.get $total))
    (i32.store offset=4 (local.get $head) (i32.const 0))
    (global.set $lvHeapLive (i32.add (global.get $lvHeapLive) (local.get $total)))
    (i32.add (local.get $head) (i32.const 8)))

  ;; return a block to its class free list
  (func $lvFree (param $body i32)
    (local $hdr i32)
    (local $total i32)
    (local $idx i32)
    (if (i32.eqz (local.get $body)) (then (return)))
    (local.set $hdr (i32.sub (local.get $body) (i32.const 8)))
    (local.set $total (i32.and (i32.load (local.get $hdr)) (i32.const -2)))
    (local.set $idx (call $lvClassOf (local.get $total)))
    (i32.store (local.get $hdr) (i32.or (local.get $total) (i32.const 1)))
    (i32.store offset=4 (local.get $hdr)
      (i32.load (i32.add (i32.const $mem.liveFree) (i32.shl (local.get $idx) (i32.const 2)))))
    (i32.store (i32.add (i32.const $mem.liveFree) (i32.shl (local.get $idx) (i32.const 2)))
      (local.get $hdr))
    (global.set $lvHeapLive (i32.sub (global.get $lvHeapLive) (local.get $total)))
    (global.set $lvHeapFreed (i32.add (global.get $lvHeapFreed) (local.get $total))))

  ;; shrink an allocated block to $len body bytes, freeing the tail as its
  ;; own block when it is big enough to stand alone
  (func $lvShrink (param $body i32) (param $len i32)
    (local $hdr i32)
    (local $total i32)
    (local $keep i32)
    (local $rest i32)
    (local.set $hdr (i32.sub (local.get $body) (i32.const 8)))
    (local.set $total (i32.and (i32.load (local.get $hdr)) (i32.const -2)))
    (local.set $keep (call $lvRoundSize (i32.add (local.get $len) (i32.const 8))))
    (local.set $rest (i32.sub (local.get $total) (local.get $keep)))
    (if (i32.lt_u (local.get $rest) (i32.const 16)) (then (return)))
    (i32.store (local.get $hdr) (local.get $keep))
    (i32.store (i32.add (local.get $hdr) (local.get $keep)) (local.get $rest))
    (call $lvFree (i32.add (i32.add (local.get $hdr) (local.get $keep)) (i32.const 8))))

  ;; lazy first-use setup: heap cursors and free-list heads
  (func $lvHeapInit
    (if (global.get $lvInited) (then (return)))
    (global.set $lvInited (i32.const 1))
    (global.set $lvHeapEnd (i32.const $mem.liveHeapBase))
    (global.set $lvHeapCeil (i32.const $mem.liveHeapBase))
    (global.set $lvHeapLive (i32.const 0))
    (global.set $lvHeapFreed (i32.const 0))
    (memory.fill (i32.const $mem.liveFree) (i32.const 0) (i32.const 128)))

  ;; A state blob is the byte image of everything the streaming pipeline
  ;; carries across chunk boundaries. Blob blocks hold
  ;; [next, refcount, len, hashLo, hashHi, id] then the bytes. The id table
  ;; maps stable ids to blob pointers; id 0 is the reset state and
  ;; 0xffffffff marks a line whose old state is gone.

  (global $lvIdTab (mut i32) (i32.const 0))     ;; id -> blob body pointer
  (global $lvIdCap (mut i32) (i32.const 0))
  (global $lvIdNext (mut i32) (i32.const 0))
  (global $lvIdFree (mut i32) (i32.const 0))    ;; free id list head, 0 none
  (global $lvBuckets (mut i32) (i32.const 0))
  (global $lvBucketMask (mut i32) (i32.const 0))
  (global $lvStateCount (mut i32) (i32.const 0))
  (global $lvStateBytes (mut i32) (i32.const 0))

  ;; FNV-1a 64 over 8-byte lanes with a byte-assembled tail
  (func $lvHash (param $ptr i32) (param $len i32) (result i64)
    (local $h i64)
    (local $p i32)
    (local $stop i32)
    (local $tail i64)
    (local $k i32)
    (local.set $h (i64.const 0xcbf29ce484222325))
    (local.set $p (local.get $ptr))
    (local.set $stop (i32.add (local.get $ptr) (i32.and (local.get $len) (i32.const -8))))
    (block $done
      (loop $lane
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $h (i64.mul
          (i64.xor (local.get $h) (i64.load (local.get $p)))
          (i64.const 0x100000001b3)))
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (br $lane)))
    (local.set $k (i32.and (local.get $len) (i32.const 7)))
    (if (local.get $k)
      (then
        (block $tdone
          (loop $tl
            (br_if $tdone (i32.eqz (local.get $k)))
            (local.set $k (i32.sub (local.get $k) (i32.const 1)))
            (local.set $tail (i64.or
              (i64.shl (local.get $tail) (i64.const 8))
              (i64.load8_u (i32.add (local.get $p) (local.get $k)))))
            (br $tl)))
        (local.set $h (i64.mul
          (i64.xor (local.get $h) (local.get $tail))
          (i64.const 0x100000001b3)))))
    (local.get $h))

  (func $lvBytesEq (param $a i32) (param $b i32) (param $len i32) (result i32)
    (local $stop i32)
    (local.set $stop (i32.add (local.get $a) (i32.and (local.get $len) (i32.const -8))))
    (block $tail
      (loop $wide
        (br_if $tail (i32.ge_u (local.get $a) (local.get $stop)))
        (if (i64.ne (i64.load (local.get $a)) (i64.load (local.get $b)))
          (then (return (i32.const 0))))
        (local.set $a (i32.add (local.get $a) (i32.const 8)))
        (local.set $b (i32.add (local.get $b) (i32.const 8)))
        (br $wide)))
    (local.set $stop (i32.add (local.get $a) (i32.and (local.get $len) (i32.const 7))))
    (block $done
      (loop $one
        (br_if $done (i32.ge_u (local.get $a) (local.get $stop)))
        (if (i32.ne (i32.load8_u (local.get $a)) (i32.load8_u (local.get $b)))
          (then (return (i32.const 0))))
        (local.set $a (i32.add (local.get $a) (i32.const 1)))
        (local.set $b (i32.add (local.get $b) (i32.const 1)))
        (br $one)))
    (i32.const 1))

  ;; set up the id table and buckets; called from the document initializer
  (func $lvStateInit
    (global.set $lvIdCap (i32.const 256))
    (global.set $lvIdTab (call $lvAlloc (i32.const 1024)))
    (memory.fill (global.get $lvIdTab) (i32.const 0) (i32.const 1024))
    (global.set $lvIdNext (i32.const 1))
    (global.set $lvIdFree (i32.const 0))
    (global.set $lvBucketMask (i32.const 255))
    (global.set $lvBuckets (call $lvAlloc (i32.const 1024)))
    (memory.fill (global.get $lvBuckets) (i32.const 0) (i32.const 1024))
    (global.set $lvStateCount (i32.const 0))
    (global.set $lvStateBytes (i32.const 0)))

  ;; take a stable id for a new blob
  (func $lvAllocId (param $blob i32) (result i32)
    (local $id i32)
    (local $nt i32)
    (if (global.get $lvIdFree)
      (then
        (local.set $id (global.get $lvIdFree))
        (global.set $lvIdFree (i32.shr_u
          (i32.load (i32.add (global.get $lvIdTab) (i32.shl (local.get $id) (i32.const 2))))
          (i32.const 1))))
      (else
        (if (i32.ge_u (global.get $lvIdNext) (global.get $lvIdCap))
          (then
            (local.set $nt (call $lvAlloc (i32.shl (global.get $lvIdCap) (i32.const 3))))
            (memory.copy (local.get $nt) (global.get $lvIdTab)
              (i32.shl (global.get $lvIdCap) (i32.const 2)))
            (memory.fill (i32.add (local.get $nt) (i32.shl (global.get $lvIdCap) (i32.const 2)))
              (i32.const 0) (i32.shl (global.get $lvIdCap) (i32.const 2)))
            (call $lvFree (global.get $lvIdTab))
            (global.set $lvIdTab (local.get $nt))
            (global.set $lvIdCap (i32.shl (global.get $lvIdCap) (i32.const 1)))))
        (local.set $id (global.get $lvIdNext))
        (global.set $lvIdNext (i32.add (local.get $id) (i32.const 1)))))
    (i32.store (i32.add (global.get $lvIdTab) (i32.shl (local.get $id) (i32.const 2)))
      (local.get $blob))
    (local.get $id))

  ;; double the bucket table and rehash every interned blob
  (func $lvGrowBuckets
    (local $newMask i32)
    (local $nb i32)
    (local $i i32)
    (local $node i32)
    (local $next i32)
    (local $slot i32)
    (local.set $newMask (i32.add
      (i32.shl (global.get $lvBucketMask) (i32.const 1)) (i32.const 1)))
    (local.set $nb (call $lvAlloc (i32.shl (i32.add (local.get $newMask) (i32.const 1)) (i32.const 2))))
    (memory.fill (local.get $nb) (i32.const 0)
      (i32.shl (i32.add (local.get $newMask) (i32.const 1)) (i32.const 2)))
    (block $done
      (loop $bucket
        (br_if $done (i32.gt_u (local.get $i) (global.get $lvBucketMask)))
        (local.set $node (i32.load (i32.add (global.get $lvBuckets)
          (i32.shl (local.get $i) (i32.const 2)))))
        (block $chainDone
          (loop $chain
            (br_if $chainDone (i32.eqz (local.get $node)))
            (local.set $next (i32.load (local.get $node)))
            (local.set $slot (i32.add (local.get $nb) (i32.shl
              (i32.and (i32.load offset=12 (local.get $node)) (local.get $newMask))
              (i32.const 2))))
            (i32.store (local.get $node) (i32.load (local.get $slot)))
            (i32.store (local.get $slot) (local.get $node))
            (local.set $node (local.get $next))
            (br $chain)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $bucket)))
    (call $lvFree (global.get $lvBuckets))
    (global.set $lvBuckets (local.get $nb))
    (global.set $lvBucketMask (local.get $newMask)))

  ;; intern the blob at $ptr (inside the transient window): returns the id of
  ;; an existing identical blob with its refcount bumped, or copies the bytes
  ;; into a new blob block. Allocation may slide the transient window; the
  ;; source pointer is re-derived from the window base.
  (func $lvIntern (param $ptr i32) (param $len i32) (result i32)
    (local $h i64)
    (local $lo i32)
    (local $hi i32)
    (local $node i32)
    (local $body i32)
    (local $id i32)
    (local $before i32)
    (local $slot i32)
    (local.set $h (call $lvHash (local.get $ptr) (local.get $len)))
    (local.set $lo (i32.wrap_i64 (local.get $h)))
    (local.set $hi (i32.wrap_i64 (i64.shr_u (local.get $h) (i64.const 32))))
    (local.set $node (i32.load (i32.add (global.get $lvBuckets)
      (i32.shl (i32.and (local.get $lo) (global.get $lvBucketMask)) (i32.const 2)))))
    (block $miss
      (loop $walk
        (br_if $miss (i32.eqz (local.get $node)))
        (if (i32.and
              (i32.eq (i32.load offset=8 (local.get $node)) (local.get $len))
              (i32.and
                (i32.eq (i32.load offset=12 (local.get $node)) (local.get $lo))
                (i32.eq (i32.load offset=16 (local.get $node)) (local.get $hi))))
          (then
            (if (call $lvBytesEq
                  (i32.add (local.get $node) (i32.const 24))
                  (local.get $ptr) (local.get $len))
              (then
                (i32.store offset=4 (local.get $node)
                  (i32.add (i32.load offset=4 (local.get $node)) (i32.const 1)))
                (return (i32.load offset=20 (local.get $node)))))))
        (local.set $node (i32.load (local.get $node)))
        (br $walk)))
    (local.set $before (global.get $lvTransLo))
    (local.set $body (call $lvAlloc (i32.add (local.get $len) (i32.const 24))))
    (local.set $ptr (i32.add (local.get $ptr)
      (i32.sub (global.get $lvTransLo) (local.get $before))))
    (memory.copy (i32.add (local.get $body) (i32.const 24))
      (local.get $ptr) (local.get $len))
    (local.set $id (call $lvAllocId (local.get $body)))
    (local.set $slot (i32.add (global.get $lvBuckets)
      (i32.shl (i32.and (local.get $lo) (global.get $lvBucketMask)) (i32.const 2))))
    (i32.store (local.get $body) (i32.load (local.get $slot)))
    (i32.store offset=4 (local.get $body) (i32.const 1))
    (i32.store offset=8 (local.get $body) (local.get $len))
    (i32.store offset=12 (local.get $body) (local.get $lo))
    (i32.store offset=16 (local.get $body) (local.get $hi))
    (i32.store offset=20 (local.get $body) (local.get $id))
    (i32.store (local.get $slot) (local.get $body))
    (global.set $lvStateCount (i32.add (global.get $lvStateCount) (i32.const 1)))
    (global.set $lvStateBytes (i32.add (global.get $lvStateBytes) (local.get $len)))
    (if (i32.gt_u (global.get $lvStateCount)
          (i32.sub (i32.add (global.get $lvBucketMask) (i32.const 1))
            (i32.shr_u (i32.add (global.get $lvBucketMask) (i32.const 1)) (i32.const 2))))
      (then (call $lvGrowBuckets)))
    (local.get $id))

  ;; drop one reference; a dead blob leaves the bucket chain, frees its
  ;; block, and recycles its id
  (func $lvRelease (param $id i32)
    (local $slotAddr i32)
    (local $node i32)
    (local $prev i32)
    (if (i32.or
          (i32.eqz (local.get $id))
          (i32.eq (local.get $id) (i32.const -1)))
      (then (return)))
    (local.set $slotAddr (i32.add (global.get $lvIdTab) (i32.shl (local.get $id) (i32.const 2))))
    (local.set $node (i32.load (local.get $slotAddr)))
    (i32.store offset=4 (local.get $node)
      (i32.sub (i32.load offset=4 (local.get $node)) (i32.const 1)))
    (if (i32.load offset=4 (local.get $node)) (then (return)))
    ;; unlink from the bucket chain
    (local.set $prev (i32.add (global.get $lvBuckets)
      (i32.shl (i32.and (i32.load offset=12 (local.get $node)) (global.get $lvBucketMask))
        (i32.const 2))))
    (block $unlinked
      (loop $walk
        (if (i32.eq (i32.load (local.get $prev)) (local.get $node))
          (then
            (i32.store (local.get $prev) (i32.load (local.get $node)))
            (br $unlinked)))
        (local.set $prev (i32.load (local.get $prev)))
        (br $walk)))
    (global.set $lvStateCount (i32.sub (global.get $lvStateCount) (i32.const 1)))
    (global.set $lvStateBytes (i32.sub (global.get $lvStateBytes)
      (i32.load offset=8 (local.get $node))))
    (call $lvFree (local.get $node))
    (i32.store (local.get $slotAddr)
      (i32.or (i32.shl (global.get $lvIdFree) (i32.const 1)) (i32.const 1)))
    (global.set $lvIdFree (local.get $id)))

  ;; Blob image: [sharedLen, brkLen, jsxLen] u32 head, 30 cross-chunk globals,
  ;; the 32-byte stream delimiter, the whole used lexer checkpoint region,
  ;; then the live prefixes of the shared, bracket, and jsx stacks. The image
  ;; is a pure function of the incoming state and the line bytes, so exact
  ;; byte identity is a sound convergence test.

  (global $lvLang (mut i32) (i32.const 0))
  (global $lvMachineId (mut i32) (i32.const -1)) ;; state the machine holds now

  ;; blob bytes for the current shared-stack prefix: json and toml publish
  ;; their depth through a global, the ecma machine derives it from tmplSp
  (func $lvSharedPrefix (result i32)
    (local $n i32)
    (if (i32.or
          (i32.eq (global.get $lvLang) (enum.get $Language.json))
          (i32.eq (global.get $lvLang) (enum.get $Language.toml)))
      (then (local.set $n (global.get $liveSharedBytes)))
      (else (local.set $n (i32.shl (global.get $tmplSp) (i32.const 2)))))
    (if (i32.gt_u (local.get $n) (i32.const 1024))
      (then (local.set $n (i32.const 1024))))
    (local.get $n))

  (func $lvCaptureBlob (param $dst i32) (result i32)
    (local $p i32)
    (local $sharedLen i32)
    (local $brkLen i32)
    (local $jsxLen i32)
    (local.set $sharedLen (call $lvSharedPrefix))
    (local.set $brkLen (global.get $brkSp))
    (if (i32.gt_u (local.get $brkLen) (i32.const 1024))
      (then (local.set $brkLen (i32.const 1024))))
    (local.set $jsxLen (i32.shl (global.get $jsxSp) (i32.const 3)))
    (if (i32.gt_u (local.get $jsxLen) (i32.const 4096))
      (then (local.set $jsxLen (i32.const 4096))))
    (i32.store (local.get $dst) (local.get $sharedLen))
    (i32.store offset=4 (local.get $dst) (local.get $brkLen))
    (i32.store offset=8 (local.get $dst) (local.get $jsxLen))
    (i32.store offset=12 (local.get $dst) (global.get $streamMode))
    (i32.store offset=16 (local.get $dst) (global.get $streamA))
    (i32.store offset=20 (local.get $dst) (global.get $streamB))
    (i32.store offset=24 (local.get $dst) (global.get $streamC))
    (i32.store offset=28 (local.get $dst) (global.get $streamHl))
    (i32.store offset=32 (local.get $dst) (global.get $streamRegionKind))
    (i32.store offset=36 (local.get $dst) (global.get $streamRegionStarted))
    (i32.store offset=40 (local.get $dst) (global.get $recCarryHl))
    (i32.store offset=44 (local.get $dst) (global.get $markdownDepth))
    (i32.store offset=48 (local.get $dst) (global.get $markdownStreamFence))
    (i32.store offset=52 (local.get $dst) (global.get $markdownStreamFenceLen))
    (i32.store offset=56 (local.get $dst) (global.get $markdownStreamLang))
    (i32.store offset=60 (local.get $dst) (global.get $phpStreamingCode))
    (i32.store offset=64 (local.get $dst) (global.get $phpStreamDecl))
    (i32.store offset=68 (local.get $dst) (global.get $phpStreamMember))
    (i32.store offset=72 (local.get $dst) (global.get $bashArith))
    (i32.store offset=76 (local.get $dst) (global.get $lto))
    (i32.store offset=80 (local.get $dst) (global.get $prevLto))
    (i32.store offset=84 (local.get $dst) (global.get $prevTok))
    (i32.store offset=88 (local.get $dst) (global.get $nlBefore))
    (i32.store offset=92 (local.get $dst) (global.get $braceDepth))
    (i32.store offset=96 (local.get $dst) (global.get $rxCloser))
    (i32.store offset=100 (local.get $dst) (global.get $tmplSp))
    (i32.store offset=104 (local.get $dst) (global.get $brkSp))
    (i32.store offset=108 (local.get $dst) (global.get $jsxSp))
    (i32.store offset=112 (local.get $dst) (global.get $tsxStreamMode))
    (i32.store offset=116 (local.get $dst) (global.get $tsxStreamNl))
    (i32.store offset=120 (local.get $dst) (global.get $tsxStreamExpressionClose))
    (i32.store offset=124 (local.get $dst) (global.get $tsxStreamExpressionClosed))
    (i32.store offset=128 (local.get $dst) (global.get $tsxStreamExpressionDepth))
    (memory.copy (i32.add (local.get $dst) (i32.const 132))
      (i32.const $mem.streamDelimiter) (i32.const 32))
    (memory.copy (i32.add (local.get $dst) (i32.const 164))
      (i32.const $mem.streamState) (i32.const $mem.streamStateUsed))
    (local.set $p (i32.add (local.get $dst) (i32.const $mem.streamStateUsed+164)))
    (memory.copy (local.get $p) (i32.const $mem.sharedStack) (local.get $sharedLen))
    (local.set $p (i32.add (local.get $p) (local.get $sharedLen)))
    (memory.copy (local.get $p) (i32.const $mem.tsxBracketStack) (local.get $brkLen))
    (local.set $p (i32.add (local.get $p) (local.get $brkLen)))
    (memory.copy (local.get $p) (i32.const $mem.tsxJsxStack) (local.get $jsxLen))
    (i32.sub (i32.add (local.get $p) (local.get $jsxLen)) (local.get $dst)))

  (func $lvRestoreBlob (param $src i32)
    (local $p i32)
    (local $sharedLen i32)
    (local $brkLen i32)
    (local $jsxLen i32)
    (local.set $sharedLen (i32.load (local.get $src)))
    (local.set $brkLen (i32.load offset=4 (local.get $src)))
    (local.set $jsxLen (i32.load offset=8 (local.get $src)))
    (global.set $streamMode (i32.load offset=12 (local.get $src)))
    (global.set $streamA (i32.load offset=16 (local.get $src)))
    (global.set $streamB (i32.load offset=20 (local.get $src)))
    (global.set $streamC (i32.load offset=24 (local.get $src)))
    (global.set $streamHl (i32.load offset=28 (local.get $src)))
    (global.set $streamRegionKind (i32.load offset=32 (local.get $src)))
    (global.set $streamRegionStarted (i32.load offset=36 (local.get $src)))
    (global.set $recCarryHl (i32.load offset=40 (local.get $src)))
    (global.set $markdownDepth (i32.load offset=44 (local.get $src)))
    (global.set $markdownStreamFence (i32.load offset=48 (local.get $src)))
    (global.set $markdownStreamFenceLen (i32.load offset=52 (local.get $src)))
    (global.set $markdownStreamLang (i32.load offset=56 (local.get $src)))
    (global.set $phpStreamingCode (i32.load offset=60 (local.get $src)))
    (global.set $phpStreamDecl (i32.load offset=64 (local.get $src)))
    (global.set $phpStreamMember (i32.load offset=68 (local.get $src)))
    (global.set $bashArith (i32.load offset=72 (local.get $src)))
    (global.set $lto (i32.load offset=76 (local.get $src)))
    (global.set $prevLto (i32.load offset=80 (local.get $src)))
    (global.set $prevTok (i32.load offset=84 (local.get $src)))
    (global.set $nlBefore (i32.load offset=88 (local.get $src)))
    (global.set $braceDepth (i32.load offset=92 (local.get $src)))
    (global.set $rxCloser (i32.load offset=96 (local.get $src)))
    (global.set $tmplSp (i32.load offset=100 (local.get $src)))
    (global.set $brkSp (i32.load offset=104 (local.get $src)))
    (global.set $jsxSp (i32.load offset=108 (local.get $src)))
    (global.set $tsxStreamMode (i32.load offset=112 (local.get $src)))
    (global.set $tsxStreamNl (i32.load offset=116 (local.get $src)))
    (global.set $tsxStreamExpressionClose (i32.load offset=120 (local.get $src)))
    (global.set $tsxStreamExpressionClosed (i32.load offset=124 (local.get $src)))
    (global.set $tsxStreamExpressionDepth (i32.load offset=128 (local.get $src)))
    (global.set $liveSharedBytes (local.get $sharedLen))
    (memory.copy (i32.const $mem.streamDelimiter)
      (i32.add (local.get $src) (i32.const 132)) (i32.const 32))
    (memory.copy (i32.const $mem.streamState)
      (i32.add (local.get $src) (i32.const 164)) (i32.const $mem.streamStateUsed))
    (local.set $p (i32.add (local.get $src) (i32.const $mem.streamStateUsed+164)))
    (memory.copy (i32.const $mem.sharedStack) (local.get $p) (local.get $sharedLen))
    (local.set $p (i32.add (local.get $p) (local.get $sharedLen)))
    (memory.copy (i32.const $mem.tsxBracketStack) (local.get $p) (local.get $brkLen))
    (local.set $p (i32.add (local.get $p) (local.get $brkLen)))
    (memory.copy (i32.const $mem.tsxJsxStack) (local.get $p) (local.get $jsxLen)))

  ;; canonicalize every captured location before the first line so stale
  ;; values from earlier batches can never leak into a blob
  (func $lvResetCaptured
    (call $streamResetGlobals)
    (global.set $recCarryHl (i32.const -1))
    (global.set $markdownDepth (i32.const 0))
    (global.set $bashArith (i32.const 0))
    (global.set $lto (i32.const 0))
    (global.set $prevLto (i32.const 0))
    (global.set $prevTok (i32.const 0))
    (global.set $nlBefore (i32.const 0))
    (global.set $braceDepth (i32.const 0))
    (global.set $rxCloser (i32.const 0))
    (global.set $tmplSp (i32.const 0))
    (global.set $brkSp (i32.const 0))
    (global.set $jsxSp (i32.const 0))
    (global.set $tsxStreamMode (i32.const 0))
    (global.set $tsxStreamNl (i32.const 0))
    (global.set $tsxStreamExpressionClose (i32.const 0))
    (global.set $tsxStreamExpressionClosed (i32.const 0))
    (global.set $tsxStreamExpressionDepth (i32.const 0))
    (global.set $liveSharedBytes (i32.const 0))
    (memory.fill (i32.const $mem.streamDelimiter) (i32.const 0) (i32.const 32))
    (memory.fill (i32.const $mem.streamState) (i32.const 0)
      (i32.const $mem.streamStateUsed)))

  ;; A gap buffer of 32-byte descriptors:
  ;;   +0 textPtr  +4 byteLen (content, no terminator)  +8 utf16Len
  ;;   +12 tokPtr  +16 tokCount  +20 outgoing stateId  +24 flags  +28 spare
  ;; flags: bits 0-1 terminator (0 none, 1 LF, 2 CRLF), bit 2 wide records,
  ;; bit 3 text points into the initial contiguous document block.

  (global $lvLineTab (mut i32) (i32.const 0))
  (global $lvLineCap (mut i32) (i32.const 0))
  (global $lvLineCount (mut i32) (i32.const 0))
  (global $lvGapAt (mut i32) (i32.const 0))
  (global $lvInitialBlock (mut i32) (i32.const 0))
  (global $lvInitialEnd (mut i32) (i32.const 0))
  (global $lvInitialLive (mut i32) (i32.const 0))
  (global $lvInitialDead (mut i32) (i32.const 0))

  (func $lvSlot (param $i i32) (result i32)
    (if (i32.ge_u (local.get $i) (global.get $lvGapAt))
      (then (local.set $i (i32.add (local.get $i)
        (i32.sub (global.get $lvLineCap) (global.get $lvLineCount))))))
    (i32.add (global.get $lvLineTab) (i32.shl (local.get $i) (i32.const 5))))

  (func $lvMoveGap (param $to i32)
    (local $gapLen i32)
    (if (i32.eq (local.get $to) (global.get $lvGapAt)) (then (return)))
    (local.set $gapLen (i32.sub (global.get $lvLineCap) (global.get $lvLineCount)))
    (if (i32.lt_u (local.get $to) (global.get $lvGapAt))
      (then
        (memory.copy
          (i32.add (global.get $lvLineTab)
            (i32.shl (i32.add (local.get $to) (local.get $gapLen)) (i32.const 5)))
          (i32.add (global.get $lvLineTab) (i32.shl (local.get $to) (i32.const 5)))
          (i32.shl (i32.sub (global.get $lvGapAt) (local.get $to)) (i32.const 5))))
      (else
        (memory.copy
          (i32.add (global.get $lvLineTab) (i32.shl (global.get $lvGapAt) (i32.const 5)))
          (i32.add (global.get $lvLineTab)
            (i32.shl (i32.add (global.get $lvGapAt) (local.get $gapLen)) (i32.const 5)))
          (i32.shl (i32.sub (local.get $to) (global.get $lvGapAt)) (i32.const 5)))))
    (global.set $lvGapAt (local.get $to)))

  ;; make room for $extra more descriptors, preserving the gap position
  (func $lvEnsureLines (param $extra i32)
    (local $newCap i32)
    (local $nt i32)
    (local $tail i32)
    (if (i32.le_u (i32.add (global.get $lvLineCount) (local.get $extra))
                  (global.get $lvLineCap))
      (then (return)))
    (local.set $newCap (i32.shl (global.get $lvLineCap) (i32.const 1)))
    (if (i32.lt_u (local.get $newCap)
          (i32.add (i32.add (global.get $lvLineCount) (local.get $extra)) (i32.const 64)))
      (then (local.set $newCap
        (i32.add (i32.add (global.get $lvLineCount) (local.get $extra)) (i32.const 64)))))
    (local.set $nt (call $lvAlloc (i32.shl (local.get $newCap) (i32.const 5))))
    (local.set $tail (i32.sub (global.get $lvLineCount) (global.get $lvGapAt)))
    (memory.copy (local.get $nt) (global.get $lvLineTab)
      (i32.shl (global.get $lvGapAt) (i32.const 5)))
    (memory.copy
      (i32.add (local.get $nt)
        (i32.shl (i32.sub (local.get $newCap) (local.get $tail)) (i32.const 5)))
      (i32.add (global.get $lvLineTab)
        (i32.shl (i32.sub (global.get $lvLineCap) (local.get $tail)) (i32.const 5)))
      (i32.shl (local.get $tail) (i32.const 5)))
    (call $lvFree (global.get $lvLineTab))
    (global.set $lvLineTab (local.get $nt))
    (global.set $lvLineCap (local.get $newCap)))

  ;; free one line's text (initial-block aware), token block, and state
  (func $lvFreeLineRes (param $slot i32)
    (call $lvFreeLineText
      (i32.load (local.get $slot))
      (i32.load offset=4 (local.get $slot))
      (i32.load offset=24 (local.get $slot)))
    (call $lvFree (i32.load offset=12 (local.get $slot)))
    (call $lvRelease (i32.load offset=20 (local.get $slot))))

  (func $lvFreeLineText (param $textPtr i32) (param $byteLen i32) (param $flags i32)
    (if (i32.and (local.get $flags) (i32.const 8))
      (then
        (global.set $lvInitialLive (i32.sub (global.get $lvInitialLive) (i32.const 1)))
        (global.set $lvInitialDead (i32.add (global.get $lvInitialDead) (local.get $byteLen)))
        (if (i32.eqz (global.get $lvInitialLive))
          (then
            (call $lvFree (global.get $lvInitialBlock))
            (global.set $lvInitialBlock (i32.const 0))
            (global.set $lvInitialDead (i32.const 0)))))
      (else (call $lvFree (local.get $textPtr)))))

  (global $lvIncoming (mut i32) (i32.const 0)) ;; state id before the cursor line

  ;; Tokenize line $i against the incoming state and return the interned
  ;; outgoing state id. Rewrites the descriptor's token block, utf16 length,
  ;; and wide flag; the caller owns the stateId field.
  (func $lvRunLine (param $i i32) (param $reset i32) (result i32)
    (local $slot i32)
    (local $flags i32)
    (local $termBytes i32)
    (local $byteLen i32)
    (local $total i32)
    (local $inBase i32)
    (local $recStart i32)
    (local $recLen i32)
    (local $blobBase i32)
    (local $blobLen i32)
    (local $newId i32)
    (local $recs i32)
    (local $nRecs i32)
    (local $r i32)
    (local $end i32)
    (local $hl i32)
    (local $n i32)
    (local $lastEnd i32)
    (local $utf16 i32)
    (local $wide i32)
    (local $tokPtr i32)
    (local $before i32)
    (local $w i32)
    (local.set $slot (call $lvSlot (local.get $i)))
    (local.set $flags (i32.load offset=24 (local.get $slot)))
    (local.set $byteLen (i32.load offset=4 (local.get $slot)))
    (local.set $termBytes (i32.and (local.get $flags) (i32.const 3)))
    (local.set $total (i32.add (local.get $byteLen) (local.get $termBytes)))
    (local.set $inBase (i32.add (global.get $lvHeapCeil) (i32.const 16)))
    (call $lvGrowTo (i32.add (i32.add (local.get $inBase) (local.get $total)) (i32.const 64)))
    (memory.copy (local.get $inBase) (i32.load (local.get $slot)) (local.get $byteLen))
    (if (i32.eq (local.get $termBytes) (i32.const 2))
      (then (i32.store16 (i32.add (local.get $inBase) (local.get $byteLen))
        (i32.const 0x0a0d)))
      (else
        (if (local.get $termBytes)
          (then (i32.store8 (i32.add (local.get $inBase) (local.get $byteLen))
            (i32.const 10))))))
    (i32.store8 (i32.add (local.get $inBase) (local.get $total)) (i32.const 0))
    (i32.store8 (i32.const 1) (i32.const 3))
    (i32.store (i32.const 2) (local.get $total))
    (global.set $srcBase (local.get $inBase))
    (global.set $streaming (i32.const 1))
    (global.set $streamReset (local.get $reset))
    (global.set $streamDepth (i32.const 0))
    (if (local.get $reset)
      (then (call $lvResetCaptured))
      (else
        (if (i32.ne (global.get $lvMachineId) (global.get $lvIncoming))
          (then (call $lvRestoreBlob (i32.add
            (i32.load (i32.add (global.get $lvIdTab)
              (i32.shl (global.get $lvIncoming) (i32.const 2))))
            (i32.const 24)))))))
    (global.set $lvMachineId (i32.const -1))
    (call $hlBegin)
    (call $recStreamBegin (local.get $reset))
    (call $streamChunk (global.get $lvLang) (local.get $reset))
    (call $recStreamEnd)
    (call $hlEnd)
    (global.set $streaming (i32.const 0))
    (global.set $streamDepth (i32.const 0))
    (local.set $recStart (i32.load (i32.const 6)))
    (local.set $recLen (i32.load (i32.const 10)))
    ;; capture the outgoing state right after the records
    (local.set $blobBase (i32.and
      (i32.add (i32.add (local.get $recStart) (local.get $recLen)) (i32.const 7))
      (i32.const -8)))
    (call $lvGrowTo (i32.add (local.get $blobBase)
      (i32.const $mem.streamStateUsed+6372)))
    (local.set $blobLen (call $lvCaptureBlob (local.get $blobBase)))
    (global.set $lvTransLo (local.get $recStart))
    (global.set $lvTransHi (i32.add (local.get $blobBase) (local.get $blobLen)))
    (local.set $before (global.get $lvTransLo))
    (local.set $newId (call $lvIntern (local.get $blobBase) (local.get $blobLen)))
    (local.set $recStart (i32.add (local.get $recStart)
      (i32.sub (global.get $lvTransLo) (local.get $before))))
    (global.set $lvMachineId (local.get $newId))
    ;; parse the line records: count content records, find the utf16 length
    (local.set $recs (local.get $recStart))
    (local.set $nRecs (i32.shr_u (local.get $recLen) (i32.const 3)))
    (block $parsed
      (loop $parse
        (br_if $parsed (i32.ge_u (local.get $r) (local.get $nRecs)))
        (local.set $end (i32.load (i32.add (local.get $recs)
          (i32.shl (local.get $r) (i32.const 3)))))
        (local.set $hl (i32.load offset=4 (i32.add (local.get $recs)
          (i32.shl (local.get $r) (i32.const 3)))))
        (if (i32.eq (local.get $hl) (i32.const -1))
          (then
            (local.set $lastEnd (i32.sub (local.get $end)
              (select (i32.const 2) (i32.const 1)
                (i32.eq (local.get $termBytes) (i32.const 2)))))
            (br $parsed)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (local.set $lastEnd (local.get $end))
        (local.set $r (i32.add (local.get $r) (i32.const 1)))
        (br $parse)))
    (local.set $utf16 (local.get $lastEnd))
    (local.set $wide (i32.ge_u (local.get $utf16) (i32.const 0x1000000)))
    ;; pack into a fresh token block: 4-byte packed records, or the raw
    ;; 8-byte pairs for lines past the 24-bit end range
    (local.set $tokPtr (i32.const 0))
    (if (local.get $n)
      (then
        (local.set $before (global.get $lvTransLo))
        (local.set $tokPtr (call $lvAlloc
          (i32.shl (local.get $n) (select (i32.const 3) (i32.const 2) (local.get $wide)))))
        (local.set $recs (i32.add (local.get $recs)
          (i32.sub (global.get $lvTransLo) (local.get $before))))
        (if (local.get $wide)
          (then (memory.copy (local.get $tokPtr) (local.get $recs)
            (i32.shl (local.get $n) (i32.const 3))))
          (else
            (local.set $r (i32.const 0))
            (block $packed
              (loop $pack
                (br_if $packed (i32.ge_u (local.get $r) (local.get $n)))
                (local.set $w (i32.add (local.get $recs) (i32.shl (local.get $r) (i32.const 3))))
                (i32.store
                  (i32.add (local.get $tokPtr) (i32.shl (local.get $r) (i32.const 2)))
                  (i32.or
                    (i32.load (local.get $w))
                    (i32.shl (i32.load offset=4 (local.get $w)) (i32.const 24))))
                (local.set $r (i32.add (local.get $r) (i32.const 1)))
                (br $pack)))))))
    (global.set $lvTransLo (i32.const 0))
    (global.set $lvTransHi (i32.const 0))
    (call $lvFree (i32.load offset=12 (local.get $slot)))
    (i32.store offset=8 (local.get $slot) (local.get $utf16))
    (i32.store offset=12 (local.get $slot) (local.get $tokPtr))
    (i32.store offset=16 (local.get $slot) (local.get $n))
    (i32.store offset=24 (local.get $slot)
      (i32.or (i32.and (local.get $flags) (i32.const -5))
        (i32.shl (local.get $wide) (i32.const 2))))
    (global.set $lvIncoming (local.get $newId))
    (local.get $newId))

  (global $lvRangePtr (mut i32) (i32.const 0))
  (global $lvRangeCount (mut i32) (i32.const 0))
  (global $lvRangeIdx (mut i32) (i32.const 0))
  (global $lvChangeIdx (mut i32) (i32.const 0))
  (global $lvDirtyTo (mut i32) (i32.const 0))
  (global $lvCursor (mut i32) (i32.const 0))
  (global $lvPhase (mut i32) (i32.const 0))
  (global $lvRetok (mut i32) (i32.const 0))

  (func $lvAppendLine (param $textPtr i32) (param $byteLen i32) (param $flags i32)
    (local $slot i32)
    (call $lvEnsureLines (i32.const 1))
    (local.set $slot (i32.add (global.get $lvLineTab)
      (i32.shl (global.get $lvLineCount) (i32.const 5))))
    (i32.store (local.get $slot) (local.get $textPtr))
    (i32.store offset=4 (local.get $slot) (local.get $byteLen))
    (i32.store offset=8 (local.get $slot) (i32.const 0))
    (i32.store offset=12 (local.get $slot) (i32.const 0))
    (i32.store offset=16 (local.get $slot) (i32.const 0))
    (i32.store offset=20 (local.get $slot) (i32.const -1))
    (i32.store offset=24 (local.get $slot) (local.get $flags))
    (i32.store offset=28 (local.get $slot) (i32.const 0))
    (global.set $lvLineCount (i32.add (global.get $lvLineCount) (i32.const 1)))
    (global.set $lvGapAt (global.get $lvLineCount)))

  ;; reserve a heap block for staged text; JavaScript encodes into it
  (func (export "liveStage") (param $len i32) (result i32)
    (call $lvHeapInit)
    (call $lvAlloc (local.get $len)))

  ;; adopt the staged document at $ptr: split it into line descriptors and
  ;; mark the whole document dirty for the driver
  (func (export "liveInitDoc") (param $ptr i32) (param $len i32) (param $lang i32)
    (local $p i32)
    (local $stop i32)
    (local $lineStart i32)
    (local $b i32)
    (call $lvHeapInit)
    (global.set $lvLang (local.get $lang))
    (i32.store8 (i32.const 1) (i32.const 3))
    (call $lvShrink (local.get $ptr) (local.get $len))
    (call $lvStateInit)
    (global.set $lvLineCap (i32.const 0))
    (global.set $lvLineCount (i32.const 0))
    (global.set $lvGapAt (i32.const 0))
    (global.set $lvLineTab (call $lvAlloc (i32.const 8192)))
    (global.set $lvLineCap (i32.const 256))
    (local.set $p (local.get $ptr))
    (local.set $lineStart (local.get $ptr))
    (local.set $stop (i32.add (local.get $ptr) (local.get $len)))
    ;; every CR or LF terminates a line: CRLF as one 2-byte terminator, a
    ;; lone CR (flag bit 16) and a lone LF as 1-byte terminators
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $b (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $b) (i32.const 13))
          (then
            (call $lvAppendLine (local.get $lineStart)
              (i32.sub (local.get $p) (local.get $lineStart))
              (select (i32.const 10) (i32.const 25)
                (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $stop))
                  (i32.eq (i32.load8_u (i32.add (local.get $p) (i32.const 1)))
                          (i32.const 10)))))
            (local.set $p (i32.add (local.get $p)
              (select (i32.const 2) (i32.const 1)
                (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $stop))
                  (i32.eq (i32.load8_u (i32.add (local.get $p) (i32.const 1)))
                          (i32.const 10))))))
            (local.set $lineStart (local.get $p)))
          (else
            (if (i32.eq (local.get $b) (i32.const 10))
              (then
                (call $lvAppendLine (local.get $lineStart)
                  (i32.sub (local.get $p) (local.get $lineStart))
                  (i32.const 9))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $lineStart (local.get $p)))
              (else
                (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
        (br $scan)))
    (call $lvAppendLine (local.get $lineStart)
      (i32.sub (local.get $stop) (local.get $lineStart)) (i32.const 8))
    (global.set $lvInitialBlock (local.get $ptr))
    (global.set $lvInitialEnd (local.get $stop))
    (global.set $lvInitialLive (global.get $lvLineCount))
    (global.set $lvInitialDead (i32.const 0))
    ;; whole-document dirty range plus one change entry for the driver's
    ;; extension bookkeeping
    (i32.store (i32.const $mem.liveChanges) (i32.const 1))
    (i32.store (i32.const $mem.liveChanges+4) (i32.const 0))
    (i32.store (i32.const $mem.liveChanges+8) (i32.const 0))
    (i32.store (i32.const $mem.liveChanges+12) (i32.const 0))
    (i32.store (i32.const $mem.liveChanges+16) (global.get $lvLineCount))
    (global.set $lvRangePtr (call $lvAlloc (i32.const 8)))
    (i32.store (global.get $lvRangePtr) (i32.const 0))
    (i32.store offset=4 (global.get $lvRangePtr) (global.get $lvLineCount))
    (global.set $lvRangeCount (i32.const 1))
    (global.set $lvRangeIdx (i32.const 0))
    (global.set $lvChangeIdx (i32.const 0))
    (global.set $lvDirtyTo (global.get $lvLineCount))
    (global.set $lvCursor (i32.const 0))
    (global.set $lvIncoming (i32.const 0))
    (global.set $lvMachineId (i32.const -1))
    (global.set $lvRetok (i32.const 0))
    (global.set $lvPhase (i32.const 1)))

  ;; byte offset of UTF-16 position $target inside a line; the top bit marks
  ;; a position between the halves of an astral pair
  (func $lvCharToByte (param $text i32) (param $len i32) (param $target i32) (result i32)
    (local $p i32)
    (local $c i32)
    (local $b i32)
    (block $done
      (loop $walk
        (br_if $done (i32.or
          (i32.ge_u (local.get $c) (local.get $target))
          (i32.ge_u (local.get $p) (local.get $len))))
        (local.set $b (i32.load8_u (i32.add (local.get $text) (local.get $p))))
        (if (i32.lt_u (local.get $b) (i32.const 0x80))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $c (i32.add (local.get $c) (i32.const 1))))
          (else
            (if (i32.lt_u (local.get $b) (i32.const 0xe0))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 2)))
                (local.set $c (i32.add (local.get $c) (i32.const 1))))
              (else
                (if (i32.lt_u (local.get $b) (i32.const 0xf0))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 3)))
                    (local.set $c (i32.add (local.get $c) (i32.const 1))))
                  (else
                    ;; astral: two UTF-16 units for four bytes
                    (if (i32.gt_u (i32.add (local.get $c) (i32.const 2)) (local.get $target))
                      (then (return (i32.or (local.get $p) (i32.const 0x80000000))))
                      (else
                        (local.set $p (i32.add (local.get $p) (i32.const 4)))
                        (local.set $c (i32.add (local.get $c) (i32.const 2)))))))))))
        (br $walk)))
    (local.get $p))

  (func $lvReadAstral (param $p i32) (result i32)
    (i32.or
      (i32.or
        (i32.shl (i32.and (i32.load8_u (local.get $p)) (i32.const 7)) (i32.const 18))
        (i32.shl (i32.and (i32.load8_u offset=1 (local.get $p)) (i32.const 63)) (i32.const 12)))
      (i32.or
        (i32.shl (i32.and (i32.load8_u offset=2 (local.get $p)) (i32.const 63)) (i32.const 6))
        (i32.and (i32.load8_u offset=3 (local.get $p)) (i32.const 63)))))

  ;; write one UTF-16 surrogate as its 3-byte WTF-8 form
  (func $lvWriteSurrogate (param $dst i32) (param $s i32)
    (i32.store8 (local.get $dst)
      (i32.or (i32.const 0xe0) (i32.shr_u (local.get $s) (i32.const 12))))
    (i32.store8 offset=1 (local.get $dst)
      (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $s) (i32.const 6)) (i32.const 63))))
    (i32.store8 offset=2 (local.get $dst)
      (i32.or (i32.const 0x80) (i32.and (local.get $s) (i32.const 63)))))

  ;; Write replacement line $line (an absolute pre-gap slot index) with its
  ;; content copied out of the splice scratch region.
  (func $lvEmitSpliceLine (param $line i32) (param $src i32) (param $len i32)
      (param $flags i32) (param $state i32)
    (local $tp i32)
    (local $slot i32)
    (if (local.get $len)
      (then
        (local.set $tp (call $lvAlloc (local.get $len)))
        (memory.copy (local.get $tp) (local.get $src) (local.get $len))))
    (local.set $slot (i32.add (global.get $lvLineTab)
      (i32.shl (local.get $line) (i32.const 5))))
    (i32.store (local.get $slot) (local.get $tp))
    (i32.store offset=4 (local.get $slot) (local.get $len))
    (i32.store offset=8 (local.get $slot) (i32.const 0))
    (i32.store offset=12 (local.get $slot) (i32.const 0))
    (i32.store offset=16 (local.get $slot) (i32.const 0))
    (i32.store offset=20 (local.get $slot) (local.get $state))
    (i32.store offset=24 (local.get $slot) (local.get $flags))
    (i32.store offset=28 (local.get $slot) (i32.const 0)))

  ;; Replace lines [sLine, eLine] with the staged text spliced between the
  ;; retained prefix of sLine and suffix of eLine. Returns the produced line
  ;; count shifted left once, with bit 0 set when a CRLF boundary merge
  ;; extended the splice to also replace line sLine-1. Coordinates were
  ;; validated by the caller against the pre-edit revision; edits are applied
  ;; in descending order so earlier coordinates stay valid.
  (func $lvSpliceEdit
    (param $sLine i32) (param $sChar i32) (param $eLine i32) (param $eChar i32)
    (param $textPtr i32) (param $textLen i32) (result i32)
    (local $sSlot i32)
    (local $eSlot i32)
    (local $sText i32)
    (local $sByteLen i32)
    (local $sFlags i32)
    (local $eText i32)
    (local $eByteLen i32)
    (local $eFlags i32)
    (local $same i32)
    (local $sPos i32)
    (local $sSplit i32)
    (local $ePos i32)
    (local $eSplit i32)
    (local $n i32)
    (local $n0 i32)
    (local $p i32)
    (local $j i32)
    (local $segStart i32)
    (local $term i32)
    (local $pre i32)
    (local $suf i32)
    (local $w i32)
    (local $cp i32)
    (local $eState i32)
    (local $scratch i32)
    (local $L i32)
    (local $b i32)
    (local $crlf i32)
    (local $finalTerm i32)
    (local $pSlot i32)
    (local $pText i32)
    (local $pLen i32)
    (local $pFlags i32)
    (local $ext i32)
    (local.set $sSlot (call $lvSlot (local.get $sLine)))
    (local.set $eSlot (call $lvSlot (local.get $eLine)))
    (local.set $same (i32.eq (local.get $sLine) (local.get $eLine)))
    (local.set $sText (i32.load (local.get $sSlot)))
    (local.set $sByteLen (i32.load offset=4 (local.get $sSlot)))
    (local.set $sFlags (i32.load offset=24 (local.get $sSlot)))
    (local.set $eText (i32.load (local.get $eSlot)))
    (local.set $eByteLen (i32.load offset=4 (local.get $eSlot)))
    (local.set $eFlags (i32.load offset=24 (local.get $eSlot)))
    (local.set $sPos (call $lvCharToByte
      (local.get $sText) (local.get $sByteLen) (local.get $sChar)))
    (local.set $sSplit (i32.shr_u (local.get $sPos) (i32.const 31)))
    (local.set $sPos (i32.and (local.get $sPos) (i32.const 0x7fffffff)))
    (local.set $ePos (call $lvCharToByte
      (local.get $eText) (local.get $eByteLen) (local.get $eChar)))
    (local.set $eSplit (i32.shr_u (local.get $ePos) (i32.const 31)))
    (local.set $ePos (i32.and (local.get $ePos) (i32.const 0x7fffffff)))
    ;; Assemble the whole replacement region (prefix + staged text + suffix)
    ;; into one scratch block first, so terminator scanning sees every CR/LF
    ;; pairing — including ones straddling the old segment boundaries — with
    ;; one set of rules: CRLF, lone CR, and lone LF all terminate a line.
    (local.set $pre (i32.add (local.get $sPos)
      (i32.mul (local.get $sSplit) (i32.const 3))))
    (local.set $suf (i32.add
      (i32.mul (local.get $eSplit) (i32.const 3))
      (i32.sub (i32.sub (local.get $eByteLen) (local.get $ePos))
        (i32.mul (local.get $eSplit) (i32.const 4)))))
    (local.set $L (i32.add (i32.add (local.get $pre) (local.get $textLen))
      (local.get $suf)))
    (if (local.get $L)
      (then
        (local.set $scratch (call $lvAlloc (local.get $L)))
        (local.set $w (local.get $scratch))
        (memory.copy (local.get $w) (local.get $sText) (local.get $sPos))
        (local.set $w (i32.add (local.get $w) (local.get $sPos)))
        (if (local.get $sSplit)
          (then
            (local.set $cp (i32.sub
              (call $lvReadAstral (i32.add (local.get $sText) (local.get $sPos)))
              (i32.const 0x10000)))
            (call $lvWriteSurrogate (local.get $w)
              (i32.add (i32.const 0xd800)
                (i32.shr_u (local.get $cp) (i32.const 10))))
            (local.set $w (i32.add (local.get $w) (i32.const 3)))))
        (memory.copy (local.get $w) (local.get $textPtr) (local.get $textLen))
        (local.set $w (i32.add (local.get $w) (local.get $textLen)))
        (if (local.get $eSplit)
          (then
            (local.set $cp (i32.sub
              (call $lvReadAstral (i32.add (local.get $eText) (local.get $ePos)))
              (i32.const 0x10000)))
            (call $lvWriteSurrogate (local.get $w)
              (i32.add (i32.const 0xdc00)
                (i32.and (local.get $cp) (i32.const 0x3ff))))
            (local.set $w (i32.add (local.get $w) (i32.const 3)))))
        (memory.copy (local.get $w)
          (i32.add (i32.add (local.get $eText) (local.get $ePos))
            (i32.mul (local.get $eSplit) (i32.const 4)))
          (i32.sub (i32.sub (local.get $eByteLen) (local.get $ePos))
            (i32.mul (local.get $eSplit) (i32.const 4))))))
    ;; the final segment inherits the end line's terminator (with its CR kind)
    (local.set $finalTerm (i32.and (local.get $eFlags) (i32.const 19)))
    ;; When the line above the splice ends in a lone CR and the byte that now
    ;; follows it is an LF — the region's first byte, or an inherited bare-LF
    ;; terminator when the region is empty — the two are byte-wise one CRLF.
    ;; Extend the splice down to that line (its content plus its CR join the
    ;; scratch region) so the scan below reads the pairing like a byte stream.
    (if (i32.gt_u (local.get $sLine) (i32.const 0))
      (then
        (local.set $pSlot (call $lvSlot (i32.sub (local.get $sLine) (i32.const 1))))
        (local.set $pFlags (i32.load offset=24 (local.get $pSlot)))
        (if (i32.and
              (i32.eq (i32.and (local.get $pFlags) (i32.const 19)) (i32.const 17))
              (select
                (i32.eq (i32.load8_u (local.get $scratch)) (i32.const 10))
                (i32.eq (local.get $finalTerm) (i32.const 1))
                (local.get $L)))
          (then
            (local.set $pText (i32.load (local.get $pSlot)))
            (local.set $pLen (i32.load offset=4 (local.get $pSlot)))
            (local.set $w (call $lvAlloc
              (i32.add (i32.add (local.get $pLen) (i32.const 1)) (local.get $L))))
            (memory.copy (local.get $w) (local.get $pText) (local.get $pLen))
            (i32.store8 (i32.add (local.get $w) (local.get $pLen)) (i32.const 13))
            (if (local.get $L)
              (then (memory.copy
                (i32.add (i32.add (local.get $w) (local.get $pLen)) (i32.const 1))
                (local.get $scratch) (local.get $L))))
            (if (local.get $scratch)
              (then (call $lvFree (local.get $scratch))))
            (local.set $scratch (local.get $w))
            (local.set $L (i32.add (i32.add (local.get $pLen) (i32.const 1))
              (local.get $L)))
            (local.set $sLine (i32.sub (local.get $sLine) (i32.const 1)))
            (local.set $sText (local.get $pText))
            (local.set $sByteLen (local.get $pLen))
            (local.set $sFlags (local.get $pFlags))
            ;; the absorbed line's own text is released like any replaced
            ;; interior/end line below, never through the `same` shortcut
            (local.set $same (i32.const 0))
            (local.set $ext (i32.const 1))))))
    ;; a trailing bare CR merges with an inherited bare-LF terminator into
    ;; one CRLF, exactly like the byte stream would read
    (if (local.get $L)
      (then
        (if (i32.and
              (i32.eq (i32.load8_u (i32.add (local.get $scratch)
                (i32.sub (local.get $L) (i32.const 1)))) (i32.const 13))
              (i32.eq (local.get $finalTerm) (i32.const 1)))
          (then
            (local.set $L (i32.sub (local.get $L) (i32.const 1)))
            (local.set $finalTerm (i32.const 2))))))
    ;; count the replacement lines
    (local.set $n (i32.const 1))
    (local.set $p (i32.const 0))
    (block $counted
      (loop $count
        (br_if $counted (i32.ge_u (local.get $p) (local.get $L)))
        (local.set $b (i32.load8_u (i32.add (local.get $scratch) (local.get $p))))
        (if (i32.eq (local.get $b) (i32.const 13))
          (then
            (local.set $n (i32.add (local.get $n) (i32.const 1)))
            (local.set $p (i32.add (local.get $p)
              (select (i32.const 2) (i32.const 1)
                (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $L))
                  (i32.eq (i32.load8_u (i32.add (i32.add (local.get $scratch)
                    (local.get $p)) (i32.const 1))) (i32.const 10)))))))
          (else
            (if (i32.eq (local.get $b) (i32.const 10))
              (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (br $count)))
    (local.set $n0 (i32.add (i32.sub (local.get $eLine) (local.get $sLine)) (i32.const 1)))
    (call $lvEnsureLines (local.get $n))
    ;; The last replacement line corresponds to the old end line, so it
    ;; inherits that line's outgoing state id: a state-neutral edit then
    ;; converges on the edited line itself with no extra re-tokenization.
    (local.set $eState (i32.load offset=20 (call $lvSlot (local.get $eLine))))
    ;; release replaced lines: middles fully, boundary text after assembly,
    ;; the end line's state through the transfer above
    (local.set $j (local.get $sLine))
    (block $freed
      (loop $free
        (br_if $freed (i32.gt_u (local.get $j) (local.get $eLine)))
        (local.set $b (call $lvSlot (local.get $j)))
        (if (i32.and
              (i32.gt_u (local.get $j) (local.get $sLine))
              (i32.lt_u (local.get $j) (local.get $eLine)))
          (then (call $lvFreeLineRes (local.get $b)))
          (else
            (call $lvFree (i32.load offset=12 (local.get $b)))
            (if (i32.lt_u (local.get $j) (local.get $eLine))
              (then (call $lvRelease (i32.load offset=20 (local.get $b)))))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $free)))
    (call $lvMoveGap (local.get $sLine))
    (global.set $lvLineCount (i32.sub (global.get $lvLineCount) (local.get $n0)))
    ;; emit the replacement lines straight from the scratch region
    (local.set $j (i32.const 0))
    (local.set $segStart (i32.const 0))
    (local.set $p (i32.const 0))
    (block $built
      (loop $build
        (br_if $built (i32.ge_u (local.get $p) (local.get $L)))
        (local.set $b (i32.load8_u (i32.add (local.get $scratch) (local.get $p))))
        (if (i32.eq (local.get $b) (i32.const 13))
          (then
            (local.set $crlf (i32.and
              (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $L))
              (i32.eq (i32.load8_u (i32.add (i32.add (local.get $scratch)
                (local.get $p)) (i32.const 1))) (i32.const 10))))
            (local.set $term (select (i32.const 2) (i32.const 17) (local.get $crlf)))
            (call $lvEmitSpliceLine (i32.add (local.get $sLine) (local.get $j))
              (i32.add (local.get $scratch) (local.get $segStart))
              (i32.sub (local.get $p) (local.get $segStart))
              (local.get $term) (i32.const -1))
            (local.set $p (i32.add (local.get $p)
              (select (i32.const 2) (i32.const 1) (local.get $crlf))))
            (local.set $segStart (local.get $p))
            (local.set $j (i32.add (local.get $j) (i32.const 1))))
          (else
            (if (i32.eq (local.get $b) (i32.const 10))
              (then
                (call $lvEmitSpliceLine (i32.add (local.get $sLine) (local.get $j))
                  (i32.add (local.get $scratch) (local.get $segStart))
                  (i32.sub (local.get $p) (local.get $segStart))
                  (i32.const 1) (i32.const -1))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $segStart (local.get $p))
                (local.set $j (i32.add (local.get $j) (i32.const 1))))
              (else
                (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
        (br $build)))
    (call $lvEmitSpliceLine (i32.add (local.get $sLine) (local.get $j))
      (i32.add (local.get $scratch) (local.get $segStart))
      (i32.sub (local.get $L) (local.get $segStart))
      (local.get $finalTerm) (local.get $eState))
    (if (local.get $scratch)
      (then (call $lvFree (local.get $scratch))))
    (global.set $lvGapAt (i32.add (local.get $sLine) (local.get $n)))
    (global.set $lvLineCount (i32.add (global.get $lvLineCount) (local.get $n)))
    (call $lvFreeLineText (local.get $sText) (local.get $sByteLen) (local.get $sFlags))
    (if (i32.eqz (local.get $same))
      (then (call $lvFreeLineText
        (local.get $eText) (local.get $eByteLen) (local.get $eFlags))))
    (i32.or (i32.shl (local.get $n) (i32.const 1)) (local.get $ext)))

  ;; append or merge a change entry; returns 1 when a new entry was appended
  (func $lvAddChange
    (param $os i32) (param $oe i32) (param $ns i32) (param $ne i32) (result i32)
    (local $count i32)
    (local $last i32)
    (local.set $count (i32.load (i32.const $mem.liveChanges)))
    (if (local.get $count)
      (then
        (local.set $last (i32.add (i32.const $mem.liveChanges+4)
          (i32.shl (i32.sub (local.get $count) (i32.const 1)) (i32.const 4))))
        (if (i32.le_u (local.get $os) (i32.load offset=4 (local.get $last)))
          (then
            (if (i32.gt_u (local.get $oe) (i32.load offset=4 (local.get $last)))
              (then (i32.store offset=4 (local.get $last) (local.get $oe))))
            (if (i32.gt_u (local.get $ne) (i32.load offset=12 (local.get $last)))
              (then (i32.store offset=12 (local.get $last) (local.get $ne))))
            (return (i32.const 0))))
        (if (i32.ge_u (local.get $count) (i32.const 1000))
          (then
            (i32.store offset=4 (local.get $last) (local.get $oe))
            (i32.store offset=12 (local.get $last) (local.get $ne))
            (return (i32.const 0))))))
    (local.set $last (i32.add (i32.const $mem.liveChanges+4)
      (i32.shl (local.get $count) (i32.const 4))))
    (i32.store (local.get $last) (local.get $os))
    (i32.store offset=4 (local.get $last) (local.get $oe))
    (i32.store offset=8 (local.get $last) (local.get $ns))
    (i32.store offset=12 (local.get $last) (local.get $ne))
    (i32.store (i32.const $mem.liveChanges) (i32.add (local.get $count) (i32.const 1)))
    (i32.const 1))

  ;; merge change entry $idx+1 into $idx once the driver runs across it
  (func $lvAbsorbChange (param $idx i32)
    (local $count i32)
    (local $e i32)
    (local.set $count (i32.load (i32.const $mem.liveChanges)))
    (local.set $e (i32.add (i32.const $mem.liveChanges+4)
      (i32.shl (local.get $idx) (i32.const 4))))
    (i32.store offset=4 (local.get $e) (i32.load offset=20 (local.get $e)))
    (i32.store offset=12 (local.get $e) (i32.load offset=28 (local.get $e)))
    (if (i32.gt_u (local.get $count) (i32.add (local.get $idx) (i32.const 2)))
      (then (memory.copy
        (i32.add (local.get $e) (i32.const 16))
        (i32.add (local.get $e) (i32.const 32))
        (i32.shl (i32.sub (local.get $count) (i32.add (local.get $idx) (i32.const 2)))
          (i32.const 4)))))
    (i32.store (i32.const $mem.liveChanges) (i32.sub (local.get $count) (i32.const 1))))

  ;; record lines the driver retokenized past the structural range end
  (func $lvCloseRange (param $through i32)
    (local $e i32)
    (if (i32.le_u (local.get $through) (global.get $lvDirtyTo)) (then (return)))
    (local.set $e (i32.add (i32.const $mem.liveChanges+4)
      (i32.shl (global.get $lvChangeIdx) (i32.const 4))))
    (i32.store offset=4 (local.get $e)
      (i32.add (i32.load offset=4 (local.get $e))
        (i32.sub (local.get $through) (global.get $lvDirtyTo))))
    (i32.store offset=12 (local.get $e) (local.get $through)))

  (func $lvFinish
    (call $lvFree (global.get $lvRangePtr))
    (global.set $lvRangePtr (i32.const 0))
    (global.set $lvPhase (i32.const 0))
    ;; slide the heap once parked free space outweighs live data and at
    ;; least a mebibyte would come back
    (if (i32.and
          (i32.gt_u (global.get $lvHeapFreed) (global.get $lvHeapLive))
          (i32.ge_u (global.get $lvHeapFreed) (i32.const 1048576)))
      (then (call $lvCompact))))

  ;; new body address of an old block body after compaction pass one
  (func $lvNewAddr (param $body i32) (result i32)
    (if (i32.eqz (local.get $body)) (then (return (i32.const 0))))
    (i32.add
      (i32.load offset=4 (i32.sub (local.get $body) (i32.const 8)))
      (i32.const 8)))

  ;; Sliding compaction: assign packed addresses into each live header's aux
  ;; word, rewrite every reference (line descriptors, state id table, bucket
  ;; chains, singleton table pointers), then move the blocks downward in
  ;; address order. Free space coalesces into the bump region.
  (func $lvCompact
    (local $hdr i32)
    (local $size i32)
    (local $to i32)
    (local $i i32)
    (local $stop i32)
    (local $slot i32)
    (local $flags i32)
    (local $node i32)
    (local $next i32)
    (local $v i32)
    (local $newInitial i32)
    (local $newEnd i32)
    ;; pass one: assign new addresses
    (local.set $hdr (i32.const $mem.liveHeapBase))
    (local.set $to (i32.const $mem.liveHeapBase))
    (block $assigned
      (loop $assign
        (br_if $assigned (i32.ge_u (local.get $hdr) (global.get $lvHeapEnd)))
        (local.set $size (i32.and (i32.load (local.get $hdr)) (i32.const -2)))
        (if (i32.eqz (i32.and (i32.load (local.get $hdr)) (i32.const 1)))
          (then
            (i32.store offset=4 (local.get $hdr) (local.get $to))
            (local.set $to (i32.add (local.get $to) (local.get $size)))))
        (local.set $hdr (i32.add (local.get $hdr) (local.get $size)))
        (br $assign)))
    (local.set $newEnd (local.get $to))
    (local.set $newInitial (call $lvNewAddr (global.get $lvInitialBlock)))
    ;; pass two: rewrite line descriptors across both gap-buffer runs
    (local.set $i (i32.const 0))
    (local.set $stop (global.get $lvGapAt))
    (block $descsDone
      (loop $descs
        (if (i32.ge_u (local.get $i) (local.get $stop))
          (then
            (br_if $descsDone (i32.eq (local.get $stop) (global.get $lvLineCap)))
            (local.set $i (i32.add (global.get $lvGapAt)
              (i32.sub (global.get $lvLineCap) (global.get $lvLineCount))))
            (local.set $stop (global.get $lvLineCap))
            (br_if $descsDone (i32.ge_u (local.get $i) (local.get $stop)))))
        (local.set $slot (i32.add (global.get $lvLineTab)
          (i32.shl (local.get $i) (i32.const 5))))
        (local.set $flags (i32.load offset=24 (local.get $slot)))
        (if (i32.and (local.get $flags) (i32.const 8))
          (then (i32.store (local.get $slot)
            (i32.add (local.get $newInitial)
              (i32.sub (i32.load (local.get $slot)) (global.get $lvInitialBlock)))))
          (else (i32.store (local.get $slot)
            (call $lvNewAddr (i32.load (local.get $slot))))))
        (i32.store offset=12 (local.get $slot)
          (call $lvNewAddr (i32.load offset=12 (local.get $slot))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $descs)))
    ;; pass two: rewrite the id table and the bucket chains
    (local.set $i (i32.const 1))
    (block $idsDone
      (loop $ids
        (br_if $idsDone (i32.ge_u (local.get $i) (global.get $lvIdNext)))
        (local.set $slot (i32.add (global.get $lvIdTab) (i32.shl (local.get $i) (i32.const 2))))
        (local.set $v (i32.load (local.get $slot)))
        (if (i32.and
              (i32.ne (local.get $v) (i32.const 0))
              (i32.eqz (i32.and (local.get $v) (i32.const 1))))
          (then (i32.store (local.get $slot) (call $lvNewAddr (local.get $v)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $ids)))
    (local.set $i (i32.const 0))
    (block $bucketsDone
      (loop $buckets
        (br_if $bucketsDone (i32.gt_u (local.get $i) (global.get $lvBucketMask)))
        (local.set $slot (i32.add (global.get $lvBuckets) (i32.shl (local.get $i) (i32.const 2))))
        (local.set $node (i32.load (local.get $slot)))
        (i32.store (local.get $slot) (call $lvNewAddr (local.get $node)))
        (block $chainDone
          (loop $chain
            (br_if $chainDone (i32.eqz (local.get $node)))
            (local.set $next (i32.load (local.get $node)))
            (i32.store (local.get $node) (call $lvNewAddr (local.get $next)))
            (local.set $node (local.get $next))
            (br $chain)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $buckets)))
    ;; pass two: singleton table pointers
    (if (global.get $lvInitialBlock)
      (then
        (global.set $lvInitialEnd (i32.add (local.get $newInitial)
          (i32.sub (global.get $lvInitialEnd) (global.get $lvInitialBlock))))
        (global.set $lvInitialBlock (local.get $newInitial))))
    (global.set $lvLineTab (call $lvNewAddr (global.get $lvLineTab)))
    (global.set $lvIdTab (call $lvNewAddr (global.get $lvIdTab)))
    (global.set $lvBuckets (call $lvNewAddr (global.get $lvBuckets)))
    ;; pass three: move live blocks downward and reset the free lists
    (local.set $hdr (i32.const $mem.liveHeapBase))
    (block $moved
      (loop $move
        (br_if $moved (i32.ge_u (local.get $hdr) (global.get $lvHeapEnd)))
        (local.set $size (i32.and (i32.load (local.get $hdr)) (i32.const -2)))
        (if (i32.eqz (i32.and (i32.load (local.get $hdr)) (i32.const 1)))
          (then
            (local.set $to (i32.load offset=4 (local.get $hdr)))
            (if (i32.ne (local.get $to) (local.get $hdr))
              (then (memory.copy (local.get $to) (local.get $hdr) (local.get $size))))
            (i32.store offset=4 (local.get $to) (i32.const 0))))
        (local.set $hdr (i32.add (local.get $hdr) (local.get $size)))
        (br $move)))
    (global.set $lvHeapEnd (local.get $newEnd))
    (memory.fill (i32.const $mem.liveFree) (i32.const 0) (i32.const 128))
    (global.set $lvHeapFreed (i32.const 0)))

  ;; apply a validated staged edit batch: [count][24-byte records][text bytes]
  ;; where each record is sLine, sChar, eLine, eChar, textOff, textLen
  (func (export "liveApplyEdits") (param $staged i32)
    (local $count i32)
    (local $k i32)
    (local $e i32)
    (local $n i32)
    (local $n0 i32)
    (local $shift i32)
    (local $newFrom i32)
    (local $newTo i32)
    (local $ranges i32)
    (local $rangeCount i32)
    (local $slot i32)
    (local $ext i32)
    (local.set $count (i32.load (local.get $staged)))
    ;; descending structural pass; each record's textLen slot is reused to
    ;; hold the line count its splice produced
    (local.set $k (local.get $count))
    (block $spliced
      (loop $desc
        (br_if $spliced (i32.eqz (local.get $k)))
        (local.set $k (i32.sub (local.get $k) (i32.const 1)))
        (local.set $e (i32.add (i32.add (local.get $staged) (i32.const 4))
          (i32.mul (local.get $k) (i32.const 24))))
        (local.set $n (call $lvSpliceEdit
          (i32.load (local.get $e))
          (i32.load offset=4 (local.get $e))
          (i32.load offset=8 (local.get $e))
          (i32.load offset=12 (local.get $e))
          (i32.add (local.get $staged) (i32.load offset=16 (local.get $e)))
          (i32.load offset=20 (local.get $e))))
        (i32.store offset=20 (local.get $e) (local.get $n))
        (br $desc)))
    ;; ascending pass: dirty ranges in new coordinates plus change entries
    (i32.store (i32.const $mem.liveChanges) (i32.const 0))
    (local.set $ranges (call $lvAlloc
      (i32.shl (i32.add (local.get $count) (i32.const 1)) (i32.const 3))))
    (local.set $k (i32.const 0))
    (block $ranged
      (loop $asc
        (br_if $ranged (i32.ge_u (local.get $k) (local.get $count)))
        (local.set $e (i32.add (i32.add (local.get $staged) (i32.const 4))
          (i32.mul (local.get $k) (i32.const 24))))
        (local.set $n (i32.load offset=20 (local.get $e)))
        (local.set $ext (i32.and (local.get $n) (i32.const 1)))
        (local.set $n (i32.shr_u (local.get $n) (i32.const 1)))
        (local.set $n0 (i32.add
          (i32.add
            (i32.sub (i32.load offset=8 (local.get $e)) (i32.load (local.get $e)))
            (i32.const 1))
          (local.get $ext)))
        (local.set $newFrom (i32.add
          (i32.sub (i32.load (local.get $e)) (local.get $ext))
          (local.get $shift)))
        (local.set $newTo (i32.add (local.get $newFrom) (local.get $n)))
        (if (call $lvAddChange
              (i32.sub (i32.load (local.get $e)) (local.get $ext))
              (i32.add (i32.load offset=8 (local.get $e)) (i32.const 1))
              (local.get $newFrom) (local.get $newTo))
          (then
            (i32.store (i32.add (local.get $ranges)
              (i32.shl (local.get $rangeCount) (i32.const 3)))
              (local.get $newFrom))
            (i32.store offset=4 (i32.add (local.get $ranges)
              (i32.shl (local.get $rangeCount) (i32.const 3)))
              (local.get $newTo))
            (local.set $rangeCount (i32.add (local.get $rangeCount) (i32.const 1))))
          (else
            (local.set $slot (i32.add (local.get $ranges)
              (i32.shl (i32.sub (local.get $rangeCount) (i32.const 1)) (i32.const 3))))
            (if (i32.gt_u (local.get $newTo) (i32.load offset=4 (local.get $slot)))
              (then (i32.store offset=4 (local.get $slot) (local.get $newTo))))))
        (local.set $shift (i32.add (local.get $shift)
          (i32.sub (local.get $n) (local.get $n0))))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br $asc)))
    (call $lvFree (local.get $staged))
    (global.set $lvRangePtr (local.get $ranges))
    (global.set $lvRangeCount (local.get $rangeCount))
    (global.set $lvRangeIdx (i32.const 0))
    (global.set $lvChangeIdx (i32.const 0))
    (global.set $lvRetok (i32.const 0))
    (global.set $lvMachineId (i32.const -1))
    (if (local.get $rangeCount)
      (then
        (global.set $lvCursor (i32.load (local.get $ranges)))
        (global.set $lvDirtyTo (i32.load offset=4 (local.get $ranges)))
        (if (global.get $lvCursor)
          (then (global.set $lvIncoming (i32.load offset=20
            (call $lvSlot (i32.sub (global.get $lvCursor) (i32.const 1))))))
          (else (global.set $lvIncoming (i32.const 0))))
        (global.set $lvPhase (i32.const 1)))
      (else (call $lvFinish))))

  ;; Retokenize up to $budget lines. Returns 1 while more lines are pending.
  ;; All driver state lives in globals, so time-sliced callers just call
  ;; again; a huge budget runs synchronously to completion.
  (func (export "liveRun") (param $budget i32) (result i32)
    (local $i i32)
    (local $slot i32)
    (local $oldId i32)
    (local $newId i32)
    (local $next i32)
    (if (i32.eqz (global.get $lvPhase)) (then (return (i32.const 0))))
    (block $out
      (loop $step
        (if (i32.eqz (local.get $budget)) (then (return (i32.const 1))))
        (local.set $budget (i32.sub (local.get $budget) (i32.const 1)))
        (local.set $i (global.get $lvCursor))
        (local.set $slot (call $lvSlot (local.get $i)))
        (local.set $oldId (i32.load offset=20 (local.get $slot)))
        (local.set $newId (call $lvRunLine (local.get $i) (i32.eqz (local.get $i))))
        (i32.store offset=20 (local.get $slot) (local.get $newId))
        (call $lvRelease (local.get $oldId))
        (global.set $lvRetok (i32.add (global.get $lvRetok) (i32.const 1)))
        (global.set $lvCursor (i32.add (local.get $i) (i32.const 1)))
        ;; absorb pending ranges the cursor has reached
        (block $merged
          (loop $merge
            (br_if $merged (i32.ge_u
              (i32.add (global.get $lvRangeIdx) (i32.const 1))
              (global.get $lvRangeCount)))
            (local.set $next (i32.add (global.get $lvRangePtr)
              (i32.shl (i32.add (global.get $lvRangeIdx) (i32.const 1)) (i32.const 3))))
            (br_if $merged (i32.lt_u (global.get $lvCursor) (i32.load (local.get $next))))
            (if (i32.gt_u (i32.load offset=4 (local.get $next)) (global.get $lvDirtyTo))
              (then (global.set $lvDirtyTo (i32.load offset=4 (local.get $next)))))
            (global.set $lvRangeIdx (i32.add (global.get $lvRangeIdx) (i32.const 1)))
            (call $lvAbsorbChange (global.get $lvChangeIdx))
            (br $merge)))
        (if (i32.ge_u (global.get $lvCursor) (global.get $lvLineCount))
          (then
            (call $lvCloseRange (global.get $lvCursor))
            (call $lvFinish)
            (return (i32.const 0))))
        (if (i32.and
              (i32.eq (local.get $newId) (local.get $oldId))
              (i32.ge_u (global.get $lvCursor) (global.get $lvDirtyTo)))
          (then
            (call $lvCloseRange (global.get $lvCursor))
            (if (i32.lt_u
                  (i32.add (global.get $lvRangeIdx) (i32.const 1))
                  (global.get $lvRangeCount))
              (then
                (global.set $lvRangeIdx (i32.add (global.get $lvRangeIdx) (i32.const 1)))
                (global.set $lvChangeIdx (i32.add (global.get $lvChangeIdx) (i32.const 1)))
                (local.set $next (i32.add (global.get $lvRangePtr)
                  (i32.shl (global.get $lvRangeIdx) (i32.const 3))))
                (global.set $lvCursor (i32.load (local.get $next)))
                (global.set $lvDirtyTo (i32.load offset=4 (local.get $next)))
                (global.set $lvIncoming (i32.load offset=20
                  (call $lvSlot (i32.sub (global.get $lvCursor) (i32.const 1))))))
              (else
                (call $lvFinish)
                (return (i32.const 0))))))
        (br $step)))
    (i32.const 0))

  (func (export "liveLineCount") (result i32) (global.get $lvLineCount))
  (func (export "liveLineLen") (param $i i32) (result i32)
    (i32.load offset=8 (call $lvSlot (local.get $i))))
  (func (export "liveLineByteLen") (param $i i32) (result i32)
    (i32.load offset=4 (call $lvSlot (local.get $i))))
  (func (export "liveLineTextPtr") (param $i i32) (result i32)
    (i32.load (call $lvSlot (local.get $i))))
  (func (export "liveLineFlags") (param $i i32) (result i32)
    (i32.load offset=24 (call $lvSlot (local.get $i))))
  (func (export "liveLineTokPtr") (param $i i32) (result i32)
    (i32.load offset=12 (call $lvSlot (local.get $i))))
  (func (export "liveLineTokCount") (param $i i32) (result i32)
    (i32.load offset=16 (call $lvSlot (local.get $i))))
  (func (export "liveChangesPtr") (result i32) (i32.const $mem.liveChanges))

  (func (export "liveStats") (param $k i32) (result i32)
    (if (i32.eqz (local.get $k)) (then (return (global.get $lvRetok))))
    (if (i32.eq (local.get $k) (i32.const 1))
      (then (return (global.get $lvStateCount))))
    (if (i32.eq (local.get $k) (i32.const 2))
      (then (return (global.get $lvStateBytes))))
    (if (i32.eq (local.get $k) (i32.const 3))
      (then (return (global.get $lvHeapLive))))
    (if (i32.eq (local.get $k) (i32.const 4))
      (then (return (global.get $lvHeapFreed))))
    (if (i32.eq (local.get $k) (i32.const 5))
      (then (return (global.get $lvInitialDead))))
    (if (i32.eq (local.get $k) (i32.const 6))
      (then (return (i32.const $mem.streamStateUsed))))
    (if (i32.eq (local.get $k) (i32.const 7))
      (then (return (global.get $lvHeapEnd))))
    (if (i32.eq (local.get $k) (i32.const 8))
      (then (return (global.get $lvHeapCeil))))
    (if (i32.eq (local.get $k) (i32.const 9))
      (then (return (global.get $lvPhase))))
    (if (i32.eq (local.get $k) (i32.const 10))
      (then (return (global.get $lvCursor))))
    (if (i32.eq (local.get $k) (i32.const 11))
      (then (return (global.get $lvChangeIdx))))
    (i32.const 0))
)
