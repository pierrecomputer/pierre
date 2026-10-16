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

  ;; jsdiff Myers over interned ids. Last link of the finished path (0 = empty),
  ;; or 0 with $err. bestPath: 8-byte (oldPos, lastComponent); oldPos
  ;; 0x80808080 = undefined, matching jsdiff's sparse array. Entries are set
  ;; undefined lazily, two per edit length, so setup is O(D) like jsdiff, not O(M+N).
  ;; Paths share immutable nodes, as jsdiff's component objects. A link is a node
  ;; address | its kind: 0 common (prev link, count), 1 removed or 2 added (prev
  ;; link; one token). Link 0 is the empty path. The diagonal loop makes no calls
  ;; (V8 spills every live value around one): nodes bump from $top, with room
  ;; reserved once per row.
  (func $myers (result i32)
    (local $M i32) (local $N i32) (local $maxEdit i32) (local $size i32)
    (local $bpZero i32) (local $d i32) (local $k i32) (local $kEnd i32)
    (local $minDiag i32) (local $maxDiag i32)
    (local $remOldPos i32) (local $addOldPos i32) (local $canAdd i32) (local $canRemove i32)
    (local $useAdd i32) (local $oldPos i32) (local $comp i32) (local $cf i32)
    (local $t i32) (local $ea i32) (local $nEnd i32)
    (local $top i32) (local $lim i32) (local $oi i32) (local $ni i32)
    (local $po i32) (local $pn i32) (local $eo i32) (local $v v128)
    (local.set $M (global.get $oldN))
    (local.set $N (global.get $newN))
    (local.set $maxEdit (i32.add (local.get $M) (local.get $N)))
    ;; Warning: ($maxEdit+3)<<4 (bestPath + seed room) wraps i32 past this (under the
    ;; byte cap, e.g. two 128 MiB diffChars inputs); such a bestPath needs >= 4 GiB,
    ;; so it is OOM anyway
    (if (i32.gt_u (local.get $maxEdit) (i32.const 0x0FFFFFFC))
      (then
        (call $oom)
        (return (i32.const 0))))
    ;; bestPath, then 16 bytes of node room for the seed row
    (local.set $size (i32.shl (i32.add (local.get $maxEdit) (i32.const 2)) (i32.const 4)))
    (local.set $top (call $alloc (i32.add (local.get $size) (i32.const 16))))
    (if (i32.eqz (local.get $top)) (then (return (i32.const 0))))
    ;; $bpZero = bestPath[-1], so $ea = bestPath[k-1]; neighbour accesses are static offsets
    (local.set $bpZero (i32.add (local.get $top) (i32.shl (local.get $maxEdit) (i32.const 3))))
    (local.set $ea (local.get $bpZero))
    (local.set $top (i32.add (local.get $top) (local.get $size)))
    (local.set $lim (global.get $memEnd))
    ;; bestPath[-1] and [1] undefined; row d adds [-(d+1)] and [d+1], its only new reads
    (i32.store (local.get $bpZero) (i32.const 0x80808080))
    (i32.store offset=16 (local.get $bpZero) (i32.const 0x80808080))
    ;; $oi + 4*oldPos = &oldIds[oldPos+1], $ni likewise for new
    (local.set $oi (i32.add (global.get $oldIdsB) (i32.const 4)))
    (local.set $ni (i32.add (global.get $newIdsB) (i32.const 4)))
    (local.set $minDiag (i32.const -0x40000000))
    (local.set $maxDiag (i32.const 0x40000000))
    ;; the seed: diagonal 0 at oldPos -1 with an empty path ($d, $k, $kEnd, $comp are 0)
    (local.set $oldPos (i32.const -1))
    (loop $visit
      ;; jsdiff extractCommon. Most steps have no common run, so one id compare
      ;; skips the scan. Reads may pass an id array end (the next allocation follows);
      ;; the run is clamped to min(M-oldPos-1, N-newPos-1) with newPos = oldPos-k.
      (local.set $po (i32.add (local.get $oi) (i32.shl (local.get $oldPos) (i32.const 2))))
      (local.set $pn (i32.add
        (local.get $ni)
        (i32.shl (i32.sub (local.get $oldPos) (local.get $k)) (i32.const 2))))
      (if (i32.eq (i32.load (local.get $po)) (i32.load (local.get $pn)))
        (then
          (local.set $t (i32.sub (i32.sub (local.get $M) (local.get $oldPos)) (i32.const 1)))
          (local.set $eo (i32.sub
            (i32.add (i32.sub (local.get $N) (local.get $oldPos)) (local.get $k))
            (i32.const 1)))
          (if (i32.lt_s (local.get $eo) (local.get $t)) (then (local.set $t (local.get $eo))))
          (local.set $eo (i32.add (local.get $po) (i32.shl (local.get $t) (i32.const 2))))
          (local.set $t (local.get $po))
          ;; 4 ids per step; $po stops at the first unequal id
          (block $run (loop $wide
            (br_if $run (i32.ge_u (local.get $po) (local.get $eo)))
            (local.set $v (i32x4.eq (v128.load (local.get $po)) (v128.load (local.get $pn))))
            (if (i32.eqz (i32x4.all_true (local.get $v)))
              (then
                ;; + 4 * index of the lowest 0 bit, via clz (V8 arm64 calls out for ctz)
                (local.set $cf (i32x4.bitmask (local.get $v)))
                (local.set $po (i32.sub
                  (i32.add (local.get $po) (i32.const 124))
                  (i32.shl
                    (i32.clz (i32.and
                      (i32.add (local.get $cf) (i32.const 1))
                      (i32.xor (local.get $cf) (i32.const -1))))
                    (i32.const 2))))
                (br $run)))
            (local.set $po (i32.add (local.get $po) (i32.const 16)))
            (local.set $pn (i32.add (local.get $pn) (i32.const 16)))
            (br $wide)))
          (local.set $t (i32.shr_u
            (i32.sub
              (select (local.get $eo) (local.get $po) (i32.gt_u (local.get $po) (local.get $eo)))
              (local.get $t))
            (i32.const 2)))
          (if (local.get $t)
            (then
              (local.set $oldPos (i32.add (local.get $oldPos) (local.get $t)))
              (i32.store (local.get $top) (local.get $comp))
              (i32.store offset=4 (local.get $top) (local.get $t))
              (local.set $comp (local.get $top))
              (local.set $top (i32.add (local.get $top) (i32.const 8)))))))

      (local.set $nEnd (i32.ge_s
        (i32.add (i32.sub (local.get $oldPos) (local.get $k)) (i32.const 1))
        (local.get $N)))
      (if (i32.ge_s (i32.add (local.get $oldPos) (i32.const 1)) (local.get $M))
        (then
          ;; reached the end of both
          (if (local.get $nEnd)
            (then
              (global.set $heap (local.get $top))
              (return (local.get $comp))))
          ;; hit the bottom edge: higher diagonals can no longer win (jsdiff skips the seed)
          (local.set $t (i32.sub (local.get $k) (i32.const 1)))
          ;; kEnd = min(maxDiag, d) drops to it too ($t < k <= kEnd)
          (if (i32.and (i32.lt_s (local.get $t) (local.get $maxDiag)) (i32.ne (local.get $d) (i32.const 0)))
            (then
              (local.set $maxDiag (local.get $t))
              (local.set $kEnd (local.get $t))))))
      (i32.store offset=8 (local.get $ea) (local.get $oldPos))
      (i32.store offset=12 (local.get $ea) (local.get $comp))
      (if (local.get $nEnd)
        (then ;; hit the right edge: lower diagonals can no longer win
          (local.set $t (i32.add (local.get $k) (i32.const 1)))
          (if (i32.and (i32.gt_s (local.get $t) (local.get $minDiag)) (i32.ne (local.get $d) (i32.const 0)))
            (then (local.set $minDiag (local.get $t))))))
      (local.set $k (i32.add (local.get $k) (i32.const 2)))
      (loop $next
        (if (i32.gt_s (local.get $k) (local.get $kEnd))
          (then ;; next edit length
            (local.set $d (i32.add (local.get $d) (i32.const 1)))
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
            ;; kEnd = min(maxDiag, d): jsdiff re-evaluates it per diagonal, and the
            ;; maxDiag update below keeps it in step
            (local.set $kEnd (local.get $d))
            (if (i32.lt_s (local.get $maxDiag) (local.get $kEnd))
              (then (local.set $kEnd (local.get $maxDiag))))
            ;; node room for the row: <= d+1 steps of <= 12 node bytes. $alloc grows
            ;; memory or fails at the 4 GiB end; $lim 0 there makes $lim-$top the room left.
            (local.set $t (i32.shl (i32.add (local.get $d) (i32.const 1)) (i32.const 4)))
            (if (i32.gt_u (local.get $t) (i32.sub (local.get $lim) (local.get $top)))
              (then
                (global.set $heap (local.get $top))
                (if (i32.eqz (call $alloc (local.get $t))) (then (return (i32.const 0))))
                (local.set $lim (global.get $memEnd))))
            (br $next)))
        (local.set $ea (i32.add (local.get $bpZero) (i32.shl (local.get $k) (i32.const 3))))
        ;; load both neighbours always: undef oldPos 0x80808080 fails the unsigned
        ;; pos tests (M,N < 2^28, so real negatives are out of range too). Restoring
        ;; undef over undefined bestPath[k-1] is a no-op.
        (local.set $remOldPos (i32.load (local.get $ea)))
        (i32.store (local.get $ea) (i32.const 0x80808080))
        (local.set $addOldPos (i32.load offset=16 (local.get $ea)))
        ;; canAdd: 0 <= addOldPos - k (the newPos after an insertion) < N
        (local.set $canAdd
          (i32.lt_u (i32.sub (local.get $addOldPos) (local.get $k)) (local.get $N)))
        (local.set $canRemove
          (i32.lt_u (i32.add (local.get $remOldPos) (i32.const 1)) (local.get $M)))
        (if (i32.eqz (i32.or (local.get $canAdd) (local.get $canRemove)))
          (then ;; terminal path: prune
            (i32.store offset=8 (local.get $ea) (i32.const 0x80808080))
            (local.set $k (i32.add (local.get $k) (i32.const 2)))
            (br $next))))
      ;; branch from the prior path whose oldPos is farthest from the origin
      (local.set $useAdd (i32.or
        (i32.eqz (local.get $canRemove))
        (i32.and
          (local.get $canAdd)
          (i32.lt_s (local.get $remOldPos) (local.get $addOldPos)))))
      (local.set $oldPos (select
        (local.get $addOldPos)
        (i32.add (local.get $remOldPos) (i32.const 1))
        (local.get $useAdd)))
      ;; jsdiff addToPath: a one-token node on the chosen path; $buildComps merges
      ;; runs of a flavor, as addToPath does
      (i32.store (local.get $top)
        (i32.load offset=4 (i32.add (local.get $ea) (i32.shl (local.get $useAdd) (i32.const 4)))))
      (local.set $comp (i32.add (local.get $top) (i32.add (local.get $useAdd) (i32.const 1))))
      (local.set $top (i32.add (local.get $top) (i32.const 4)))
      (br $visit))
    (unreachable)
  )

  ;; flatten the reversed node list into $compArr (u32 count | added << 31 |
  ;; removed << 30, forward order). Adjacent added (or removed) nodes join, as
  ;; jsdiff addToPath merges a token into the last component of its flavor;
  ;; common runs never touch.
  (func $buildComps (param $last i32)
    (local $n i32) (local $c i32) (local $end i32) (local $p i32) (local $cf i32)
    (local.set $c (local.get $last))
    (block $counted (loop $count
      (br_if $counted (i32.eqz (local.get $c)))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (local.set $c (i32.load (i32.and (local.get $c) (i32.const -4))))
      (br $count)))
    ;; one slot past the end holds flags 11, which no node has, so nothing merges into it
    (local.set $p (call $alloc (i32.shl (i32.add (local.get $n) (i32.const 1)) (i32.const 2))))
    ;; 0 only on oom ($err set, the driver aborts)
    (if (i32.eqz (local.get $p)) (then (return)))
    (local.set $end (i32.add (local.get $p) (i32.shl (local.get $n) (i32.const 2))))
    (local.set $p (local.get $end))
    (i32.store (local.get $p) (i32.const -1))
    (local.set $c (local.get $last))
    (block $filled (loop $fill
      (br_if $filled (i32.eqz (local.get $c)))
      ;; kind 1/2 is flags bit 30/31
      (local.set $cf (i32.shl (local.get $c) (i32.const 30)))
      (local.set $c (i32.and (local.get $c) (i32.const -4)))
      (if (i32.shr_u (i32.xor (i32.load (local.get $p)) (local.get $cf)) (i32.const 30))
        (then
          (local.set $p (i32.sub (local.get $p) (i32.const 4)))
          (i32.store (local.get $p) (select
            (i32.or (local.get $cf) (i32.const 1))
            (i32.load offset=4 (local.get $c))
            (local.get $cf))))
        (else ;; same flavor: one more token
          (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.const 1)))))
      (local.set $c (i32.load (local.get $c)))
      (br $fill)))
    (global.set $compArr (local.get $p))
    (global.set $compN (i32.shr_u (i32.sub (local.get $end) (local.get $p)) (i32.const 2)))
  )

  ;; jsdiff buildValues: 16-byte record per change — (flags 1 removed / 2 added /
  ;; 0 common, token count, start, end). start/end are UTF-16 units into old for
  ;; removals, new otherwise; host slices original JS strings, never decodes.
  ;; Removed/common tile old and added/common tile new, so per-side unit cursors
  ;; advance record-by-record. [3] bit 0/1 = old/new pure ASCII (units = bytes).
  ;; A common run is byte-equal on both sides (equal ids) unless ignoreWhitespace
  ;; ([3] bit 2): then it is ASCII if either side is, and the new side reuses the count.
  (func $emitRecords
    (local $i i32) (local $cf i32) (local $cnt i32) (local $base i32) (local $p i32)
    (local $flags i32) (local $ascii i32) (local $same i32)
    (local $oldTok i32) (local $newTok i32) (local $oldU i32) (local $newU i32)
    (local $oldEnd i32) (local $newEnd i32)
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
      (local.set $same (i32.eqz (i32.or (local.get $flags) (i32.and (local.get $ascii) (i32.const 4)))))
      (local.set $oldEnd (local.get $oldU))
      (local.set $newEnd (local.get $newU))
      (if (i32.ne (local.get $flags) (i32.const 2))
        (then ;; removed or common: old tokens
          (local.set $oldEnd (i32.add (local.get $oldU) (call $utf16Units
            (global.get $oldSrc) (global.get $oldOffsB) (local.get $oldTok) (local.get $cnt)
            (i32.and (local.get $ascii) (select (i32.const 3) (i32.const 1) (local.get $same))))))
          (local.set $oldTok (i32.add (local.get $oldTok) (local.get $cnt)))))
      (if (i32.ne (local.get $flags) (i32.const 1))
        (then ;; added or common: new tokens
          (local.set $newEnd (i32.add (local.get $newU) (select
            (i32.sub (local.get $oldEnd) (local.get $oldU))
            (call $utf16Units
              (global.get $newSrc) (global.get $newOffsB) (local.get $newTok) (local.get $cnt)
              (i32.or (local.get $same) (i32.and (local.get $ascii) (i32.const 2))))
            (local.get $same))))
          (local.set $newTok (i32.add (local.get $newTok) (local.get $cnt)))))
      (i32.store (local.get $p) (local.get $flags))
      (i32.store offset=4 (local.get $p) (local.get $cnt))
      (i32.store offset=8 (local.get $p)
        (select (local.get $oldU) (local.get $newU) (i32.eq (local.get $flags) (i32.const 1))))
      (i32.store offset=12 (local.get $p)
        (select (local.get $oldEnd) (local.get $newEnd) (i32.eq (local.get $flags) (i32.const 1))))
      (local.set $oldU (local.get $oldEnd))
      (local.set $newU (local.get $newEnd))
      (local.set $p (i32.add (local.get $p) (i32.const 16)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const 12) (global.get $compN))
    (i32.store (i32.const 16) (local.get $base))
  )
)
