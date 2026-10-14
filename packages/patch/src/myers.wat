(module
  (import "./mem.wat")

  ;; inputs (set by the driver in patch.wat; the old text base is fixed)
  (global $oldSrc   i32       (i32.const 65536))
  (global $newSrc   (mut i32) (i32.const 0))
  (global $oldOffsB (mut i32) (i32.const 0))
  (global $newOffsB (mut i32) (i32.const 0))
  (global $oldIdsB  (mut i32) (i32.const 0))
  (global $newIdsB  (mut i32) (i32.const 0))
  (global $oldN     (mut i32) (i32.const 0))
  (global $newN     (mut i32) (i32.const 0))

  ;; outputs of $buildComps
  (global $compArr  (mut i32) (i32.const 0))
  (global $compN    (mut i32) (i32.const 0))

  ;; 8-byte node: prev (u32), count|flags (u32): bit 31 added, bit 30 removed. 0 = empty.
  (func $newNode (param $prev i32) (param $cf i32) (result i32)
    (local $p i32)
    (local.set $p (call $alloc (i32.const 8)))
    ;; oom: $p=0, stores hit [0:8) (host-rewritten inputs, unread this call; the driver
    ;; writes the [1] flag last); $err set; return 0
    (i32.store (local.get $p) (local.get $prev))
    (i32.store offset=4 (local.get $p) (local.get $cf))
    (local.get $p)
  )

  ;; jsdiff addToPath: append one added/removed token, merging same-flavor last
  ;; component persistently (old node is not mutated)
  (func $appendComp (param $prev i32) (param $flags i32) (result i32)
    (local $cf i32)
    (if (local.get $prev)
      (then
        (local.set $cf (i32.load offset=4 (local.get $prev)))
        ;; same flavor iff the top two bits match ($flags has no low bits);
        ;; the count is the low bits, so +1 bumps it
        (if (i32.eqz (i32.shr_u (i32.xor (local.get $cf) (local.get $flags)) (i32.const 30)))
          (then
            (return (call $newNode
              (i32.load (local.get $prev))
              (i32.add (local.get $cf) (i32.const 1))))))))
    (call $newNode (local.get $prev) (i32.or (i32.const 1) (local.get $flags)))
  )

  ;; equal ids while oldPos+1 < oldN and newPos+1 < newN.
  ;; 4 ids (16 bytes) per SIMD step; result clamped to $limit.
  (func $scanCommon (param $oldPos i32) (param $newPos i32) (result i32)
    (local $po i32) (local $pn i32) (local $limit i32) (local $t i32)
    (local $start i32) (local $eo i32) (local $m i32)
    (local.set $po (i32.add
      (global.get $oldIdsB)
      (i32.shl (i32.add (local.get $oldPos) (i32.const 1)) (i32.const 2))))
    (local.set $pn (i32.add
      (global.get $newIdsB)
      (i32.shl (i32.add (local.get $newPos) (i32.const 1)) (i32.const 2))))
    (local.set $limit (i32.sub (i32.sub (global.get $oldN) (local.get $oldPos)) (i32.const 1)))
    (local.set $t (i32.sub (i32.sub (global.get $newN) (local.get $newPos)) (i32.const 1)))
    (if (i32.lt_s (local.get $t) (local.get $limit)) (then (local.set $limit (local.get $t))))
    ;; $limit >= 0 (positions < oldN/newN). Most diagonal visits have no common
    ;; run, so one scalar compare skips the SIMD setup
    (if (i32.or
          (i32.eqz (local.get $limit))
          (i32.ne (i32.load (local.get $po)) (i32.load (local.get $pn))))
      (then (return (i32.const 0))))
    (local.set $start (local.get $po))
    (local.set $eo (i32.add (local.get $po) (i32.shl (local.get $limit) (i32.const 2))))
    ;; 4 ids/step; i32x4 lane equal iff all 4 bytes equal. Last chunk may overread
    ;; <=12 past an id array (bestPath is allocated behind); extras past $limit clamped below.
    (loop $wide
      (if (i32.ge_u (local.get $po) (local.get $eo)) (then (return (local.get $limit))))
      (local.set $m (i8x16.bitmask
        (i8x16.eq (v128.load (local.get $po)) (v128.load (local.get $pn)))))
      (if (i32.ne (local.get $m) (i32.const 0xFFFF))
        (then
          ;; first mismatching byte / 4 = ids equal up to here
          (local.set $t (i32.add
            (i32.shr_u (i32.sub (local.get $po) (local.get $start)) (i32.const 2))
            (i32.shr_u (i32.ctz (i32.xor (local.get $m) (i32.const 0xFFFF))) (i32.const 2))))
          (return (select
            (local.get $limit)
            (local.get $t)
            (i32.gt_s (local.get $t) (local.get $limit))))))
      (local.set $po (i32.add (local.get $po) (i32.const 16)))
      (local.set $pn (i32.add (local.get $pn) (i32.const 16)))
      (br $wide))
    (unreachable)
  )

  ;; jsdiff Myers over interned ids. Last component of the finished path (0 =
  ;; empty), or 0 with $err. bestPath: 8-byte (oldPos, lastComponent); oldPos
  ;; 0x80808080 = undefined, matching jsdiff's sparse array. Entries are set
  ;; undefined lazily, two per edit length, so setup is O(D) like jsdiff, not O(M+N).
  (func $myers (result i32)
    (local $M i32) (local $N i32) (local $maxEdit i32) (local $size i32)
    (local $bp i32) (local $bpZero i32) (local $d i32) (local $k i32) (local $kEnd i32)
    (local $minDiag i32) (local $maxDiag i32)
    (local $remOldPos i32) (local $remComp i32)
    (local $addOldPos i32) (local $addComp i32) (local $canAdd i32) (local $canRemove i32)
    (local $oldPos i32) (local $newPos i32) (local $comp i32) (local $t i32) (local $ea i32)
    (local $nEnd i32)
    (local.set $M (global.get $oldN))
    (local.set $N (global.get $newN))
    (local.set $maxEdit (i32.add (local.get $M) (local.get $N)))
    ;; Warning: ($maxEdit+2)<<4 wraps i32 past this (under the byte cap, e.g. two
    ;; 128 MiB diffChars inputs); such a bestPath needs >= 4 GiB, so it is OOM anyway
    (if (i32.gt_u (local.get $maxEdit) (i32.const 0x0FFFFFFD))
      (then
        (call $oom)
        (return (i32.const 0))))
    (local.set $size (i32.shl (i32.add (local.get $maxEdit) (i32.const 2)) (i32.const 4)))
    (local.set $bp (call $alloc (local.get $size)))
    (if (i32.eqz (local.get $bp)) (then (return (i32.const 0))))
    ;; $bpZero = bestPath[-1], so $ea = bestPath[k-1]; neighbour accesses are static offsets
    (local.set $bpZero (i32.add (local.get $bp) (i32.shl (local.get $maxEdit) (i32.const 3))))

    ;; seed diagonal 0 at oldPos -1, then the leading common run. Failed $newNode
    ;; sets $err; driver aborts after $myers returns. Positions ignore component
    ;; ptrs, so the loop still terminates; no err check here or after other $newNode/$appendComp.
    (local.set $oldPos (i32.const -1))
    (local.set $comp (i32.const 0))
    (local.set $t (call $scanCommon (i32.const -1) (i32.const -1)))
    (if (local.get $t)
      (then
        (local.set $oldPos (i32.add (local.get $oldPos) (local.get $t)))
        (local.set $comp (call $newNode (i32.const 0) (local.get $t)))))
    (local.set $newPos (local.get $oldPos))
    (if (i32.and
          (i32.ge_s (i32.add (local.get $oldPos) (i32.const 1)) (local.get $M))
          (i32.ge_s (i32.add (local.get $newPos) (i32.const 1)) (local.get $N)))
      (then (return (local.get $comp)))) ;; identical (or both empty)
    (i32.store offset=8 (local.get $bpZero) (local.get $oldPos))
    (i32.store offset=12 (local.get $bpZero) (local.get $comp))
    ;; bestPath[-1] and [1] undefined; row d adds [-(d+1)] and [d+1], its only new reads
    (i32.store (local.get $bpZero) (i32.const 0x80808080))
    (i32.store offset=16 (local.get $bpZero) (i32.const 0x80808080))

    (local.set $minDiag (i32.const -0x40000000))
    (local.set $maxDiag (i32.const 0x40000000))
    (local.set $d (i32.const 1))
    (loop $editLength
      ;; impossible for a correct implementation
      (if (i32.gt_s (local.get $d) (local.get $maxEdit)) (then (unreachable)))
      (i32.store
        (i32.sub (local.get $bpZero) (i32.shl (local.get $d) (i32.const 3)))
        (i32.const 0x80808080))
      (i32.store offset=16
        (i32.add (local.get $bpZero) (i32.shl (local.get $d) (i32.const 3)))
        (i32.const 0x80808080))
      ;; k = max(minDiag, -d), evaluated once per edit length (as in jsdiff)
      (local.set $k (i32.sub (i32.const 0) (local.get $d)))
      (if (i32.gt_s (local.get $minDiag) (local.get $k))
        (then (local.set $k (local.get $minDiag))))
      (block $rowDone (loop $diagonal
        ;; kEnd = min(maxDiag, d), re-evaluated every iteration (as in jsdiff)
        (local.set $kEnd (local.get $d))
        (if (i32.lt_s (local.get $maxDiag) (local.get $kEnd))
          (then (local.set $kEnd (local.get $maxDiag))))
        (br_if $rowDone (i32.gt_s (local.get $k) (local.get $kEnd)))
        (local.set $ea (i32.add (local.get $bpZero) (i32.shl (local.get $k) (i32.const 3))))

        ;; load both neighbours always: undef oldPos 0x80808080 fails the unsigned
        ;; pos tests (M,N < 2^28, so real negatives are out of range too). Restoring
        ;; undef over undefined bestPath[k-1] is a no-op.
        (local.set $remOldPos (i32.load (local.get $ea)))
        (local.set $remComp (i32.load offset=4 (local.get $ea)))
        (i32.store (local.get $ea) (i32.const 0x80808080))
        (local.set $addOldPos (i32.load offset=16 (local.get $ea)))
        (local.set $addComp (i32.load offset=20 (local.get $ea)))
        ;; canAdd: 0 <= addOldPos - k (the newPos after an insertion) < N
        (local.set $canAdd
          (i32.lt_u (i32.sub (local.get $addOldPos) (local.get $k)) (local.get $N)))
        (local.set $canRemove
          (i32.lt_u (i32.add (local.get $remOldPos) (i32.const 1)) (local.get $M)))
        (if (i32.eqz (i32.or (local.get $canAdd) (local.get $canRemove)))
          (then ;; terminal path: prune
            (i32.store offset=8 (local.get $ea) (i32.const 0x80808080))
            (local.set $k (i32.add (local.get $k) (i32.const 2)))
            (br $diagonal)))

        ;; branch from the prior path whose oldPos is farthest from the origin
        (if (i32.or
              (i32.eqz (local.get $canRemove))
              (i32.and
                (local.get $canAdd)
                (i32.lt_s (local.get $remOldPos) (local.get $addOldPos))))
          (then
            (local.set $oldPos (local.get $addOldPos))
            (local.set $comp (call $appendComp (local.get $addComp) (i32.const 0x80000000))))
          (else
            (local.set $oldPos (i32.add (local.get $remOldPos) (i32.const 1)))
            (local.set $comp (call $appendComp (local.get $remComp) (i32.const 0x40000000)))))
        (local.set $newPos (i32.sub (local.get $oldPos) (local.get $k)))

        (local.set $t (call $scanCommon (local.get $oldPos) (local.get $newPos)))
        (if (local.get $t)
          (then
            (local.set $oldPos (i32.add (local.get $oldPos) (local.get $t)))
            (local.set $newPos (i32.add (local.get $newPos) (local.get $t)))
            (local.set $comp (call $newNode (local.get $comp) (local.get $t)))))

        (local.set $nEnd (i32.ge_s (i32.add (local.get $newPos) (i32.const 1)) (local.get $N)))
        (if (i32.ge_s (i32.add (local.get $oldPos) (i32.const 1)) (local.get $M))
          (then
            ;; reached the end of both
            (if (local.get $nEnd) (then (return (local.get $comp))))
            ;; hit the bottom edge: higher diagonals can no longer win
            (local.set $t (i32.sub (local.get $k) (i32.const 1)))
            (if (i32.lt_s (local.get $t) (local.get $maxDiag))
              (then (local.set $maxDiag (local.get $t))))))
        (i32.store offset=8 (local.get $ea) (local.get $oldPos))
        (i32.store offset=12 (local.get $ea) (local.get $comp))
        (if (local.get $nEnd)
          (then ;; hit the right edge: lower diagonals can no longer win
            (local.set $t (i32.add (local.get $k) (i32.const 1)))
            (if (i32.gt_s (local.get $t) (local.get $minDiag))
              (then (local.set $minDiag (local.get $t))))))
        (local.set $k (i32.add (local.get $k) (i32.const 2)))
        (br $diagonal)))
      (local.set $d (i32.add (local.get $d) (i32.const 1)))
      (br $editLength))
    (unreachable)
  )

  ;; flatten reversed component list into $compArr (u32 count|flags, forward order)
  (func $buildComps (param $last i32)
    (local $n i32) (local $c i32) (local $arr i32) (local $p i32)
    (local.set $c (local.get $last))
    (block $counted (loop $count
      (br_if $counted (i32.eqz (local.get $c)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (local.set $c (i32.load (local.get $c)))
      (br $count)))
    (local.set $arr (call $alloc (i32.shl (local.get $n) (i32.const 2))))
    ;; 0 only on oom ($err set, the driver aborts), so no $n qualifier needed
    (if (i32.eqz (local.get $arr)) (then (return)))
    (local.set $c (local.get $last))
    (local.set $p (i32.add (local.get $arr) (i32.shl (local.get $n) (i32.const 2))))
    (block $filled (loop $fill
      (br_if $filled (i32.eqz (local.get $c)))
      (local.set $p (i32.sub (local.get $p) (i32.const 4)))
      (i32.store (local.get $p) (i32.load offset=4 (local.get $c)))
      (local.set $c (i32.load (local.get $c)))
      (br $fill)))
    (global.set $compArr (local.get $arr))
    (global.set $compN (local.get $n))
  )

  ;; jsdiff buildValues: 16-byte record per change — (flags 1 removed / 2 added /
  ;; 0 common, token count, start, end). start/end are UTF-16 units into old for
  ;; removals, new otherwise; host slices original JS strings, never decodes.
  ;; Byte->unit in one pass: removed/common tile old, added/common tile new, so
  ;; per-side unit cursors advance record-by-record. A common run is byte-equal
  ;; on both sides (equal interned ids), so one count advances both, except under
  ;; ignoreWhitespace ([3] bit 2). [3] bit0/1 = old/new pure ASCII (unit==byte,
  ;; skip scan); a byte-equal common run is ASCII if either side is.
  (func $emitRecords
    (local $i i32) (local $cf i32) (local $cnt i32) (local $base i32) (local $p i32)
    (local $oldTok i32) (local $newTok i32) (local $b i32) (local $tk i32) (local $flags i32)
    (local $ascii i32) (local $src i32) (local $bs i32) (local $be i32)
    (local $units i32) (local $oldU i32) (local $newU i32) (local $start i32)
    (local.set $base (call $alloc (i32.shl (global.get $compN) (i32.const 4))))
    ;; 0 only on oom ($err set, the driver aborts)
    (if (i32.eqz (local.get $base)) (then (return)))
    (local.set $ascii (i32.load8_u (i32.const 3)))
    (local.set $p (local.get $base))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (global.get $compN)))
      (local.set $cf
        (i32.load (i32.add (global.get $compArr) (i32.shl (local.get $i) (i32.const 2)))))
      (local.set $cnt (i32.and (local.get $cf) (i32.const 0x3FFFFFFF)))
      ;; the component flag bits are the record encoding: 1 removed, 2 added
      (local.set $flags (i32.shr_u (local.get $cf) (i32.const 30)))
      (if (i32.eq (local.get $flags) (i32.const 1))
        (then ;; removed: bytes come from the old text
          (local.set $b (global.get $oldOffsB))
          (local.set $tk (local.get $oldTok))
          (local.set $src (global.get $oldSrc))
          (local.set $start (local.get $oldU))
          (local.set $units (i32.and (local.get $ascii) (i32.const 1))))
        (else ;; added or common: bytes come from the new text
          (local.set $b (global.get $newOffsB))
          (local.set $tk (local.get $newTok))
          (local.set $src (global.get $newSrc))
          (local.set $start (local.get $newU))
          ;; $units also skip-scan: added needs new ASCII; common ($flags=0) either
          ;; side, unless ignoreWhitespace ([3] bit 2) lets its bytes differ
          (local.set $units (select
            (i32.and (local.get $ascii) (i32.const 2))
            (i32.and (local.get $ascii) (i32.const 3))
            (i32.or (local.get $flags) (i32.and (local.get $ascii) (i32.const 4)))))))
      (local.set $bs (i32.load (i32.add (local.get $b) (i32.shl (local.get $tk) (i32.const 2)))))
      (local.set $be (i32.load (i32.add
        (local.get $b)
        (i32.shl (i32.add (local.get $tk) (local.get $cnt)) (i32.const 2)))))
      (if (local.get $units)
        (then (local.set $units (i32.sub (local.get $be) (local.get $bs))))
        (else
          (local.set $units (call $utf16Units
            (i32.add (local.get $src) (local.get $bs))
            (i32.add (local.get $src) (local.get $be))))))
      (i32.store (local.get $p) (local.get $flags))
      (i32.store offset=4 (local.get $p) (local.get $cnt))
      (i32.store offset=8 (local.get $p) (local.get $start))
      (i32.store offset=12 (local.get $p) (i32.add (local.get $start) (local.get $units)))
      ;; added/common consume new tokens
      (if (i32.ne (local.get $flags) (i32.const 1))
        (then
          (local.set $newTok (i32.add (local.get $newTok) (local.get $cnt)))
          (local.set $newU (i32.add (local.get $newU) (local.get $units)))))
      ;; removed/common consume old tokens
      (if (i32.ne (local.get $flags) (i32.const 2))
        (then
          ;; ignoreWhitespace: a common run may differ in bytes, so the old side
          ;; counts its own units
          (if (i32.and (i32.eqz (local.get $flags)) (i32.ge_u (local.get $ascii) (i32.const 4)))
            (then
              (local.set $bs (i32.load (i32.add
                (global.get $oldOffsB)
                (i32.shl (local.get $oldTok) (i32.const 2)))))
              (local.set $be (i32.load (i32.add
                (global.get $oldOffsB)
                (i32.shl (i32.add (local.get $oldTok) (local.get $cnt)) (i32.const 2)))))
              (local.set $units (i32.sub (local.get $be) (local.get $bs)))
              (if (i32.eqz (i32.and (local.get $ascii) (i32.const 1)))
                (then
                  (local.set $units (call $utf16Units
                    (i32.add (global.get $oldSrc) (local.get $bs))
                    (i32.add (global.get $oldSrc) (local.get $be))))))))
          (local.set $oldTok (i32.add (local.get $oldTok) (local.get $cnt)))
          (local.set $oldU (i32.add (local.get $oldU) (local.get $units)))))
      (local.set $p (i32.add (local.get $p) (i32.const 16)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const 12) (global.get $compN))
    (i32.store (i32.const 16) (local.get $base))
  )
)
