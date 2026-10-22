(module
  (import "./memory.wat")

  ;; Nibble classification for the bytes $outText has to escape: NUL, `"`, `&`,
  ;; `<` and `>`. Two i8x16.swizzle lookups classify sixteen bytes at once, which
  ;; is both exact and cheaper than five comparisons.
  ;; Four regions live above the input, in the order they stop growing:
  ;;
  ;;   [$metaBase   .. $recBase)   frontmatter JSON, written before block analysis
  ;;   [$recBase    .. $rec)       block records, appended during block analysis
  ;;   [$outBase    .. $out)       rendered output, appended during rendering
  ;;   [$scratchBase.. memory end) rebuilt content and marks grow up, tags grow down
  ;;
  ;; The scratch is the only region that has to coexist with a growing
  ;; neighbour, so it sits at the very top and moves up whenever the output
  ;; would reach it. Growth is geometric, so the moves are amortized O(1).
  ;; Everything inside the scratch is addressed by offset, never by pointer.
  (global $rec (mut i32) (i32.const 0)) ;; block-record write cursor
  (global $recBase (mut i32) (i32.const 0))
  (global $recEnd (mut i32) (i32.const 0))
  (global $out (mut i32) (i32.const 0)) ;; output write cursor
  (global $outBase (mut i32) (i32.const 0))
  (global $outCap (mut i32) (i32.const 0)) ;; highest safe write position (16 bytes of slack)
  (global $scratchBase (mut i32) (i32.const 0))
  (global $scratchTop (mut i32) (i32.const 0))
  (global $scratchCap (mut i32) (i32.const 0))  ;; bytes reserved
  (global $scratchUsed (mut i32) (i32.const 0)) ;; prefix bytes in use
  (global $scratchTailUsed (mut i32) (i32.const 0)) ;; suffix bytes in use

  ;; grow linear memory to at least $min bytes, doubling so the number of
  ;; grows stays logarithmic in the output size
  (func $growPages (param $min i32)
    (local $pages i32)
    (local $want i32)
    (local.set $pages (memory.size))
    (if (i32.le_u (local.get $min) (i32.mul (local.get $pages) (i32.const 65536)))
      (then (return)))
    (local.set $want (i32.shr_u (i32.add (local.get $min) (i32.const 65535)) (i32.const 16)))
    (if (i32.lt_u (local.get $want) (i32.shl (local.get $pages) (i32.const 1)))
      (then (local.set $want (i32.shl (local.get $pages) (i32.const 1)))))
    ;; a failed grow (past the wasm32 4 GB ceiling) traps on purpose: the host
    ;; sees a RuntimeError and the instance stays reusable
    (if (i32.eq (memory.grow (i32.sub (local.get $want) (local.get $pages))) (i32.const -1))
      (then (unreachable))))

  ;; move the scratch back to the top of memory and recompute the ceiling
  (func $rebase (param $old i32)
    (local $oldTop i32)
    (local $top i32)
    (local.set $oldTop (global.get $scratchTop))
    (local.set $top (i32.mul (memory.size) (i32.const 65536)))
    (global.set $scratchBase (i32.sub
      (local.get $top) (global.get $scratchCap)))
    (global.set $outCap (i32.sub (global.get $scratchBase) (i32.const 16)))
    (if (local.get $old)
      (then
        ;; Copy the suffix first: moving the prefix may overwrite its old source.
        (if (i32.and
              (i32.ne (global.get $scratchTailUsed) (i32.const 0))
              (i32.ne (local.get $oldTop) (local.get $top)))
          (then (memory.copy
            (i32.sub (local.get $top) (global.get $scratchTailUsed))
            (i32.sub (local.get $oldTop) (global.get $scratchTailUsed))
            (global.get $scratchTailUsed))))
        (if (i32.ne (local.get $old) (global.get $scratchBase))
          (then (memory.copy (global.get $scratchBase) (local.get $old)
            (global.get $scratchUsed))))))
    (if (i32.eq (global.get $contentBase) (local.get $old))
      (then (global.set $contentBase (global.get $scratchBase))))
    (global.set $scratchTop (local.get $top)))

  (func $setOutCap
    (call $rebase (i32.const 0)))

  ;; make room for $n more bytes past $cur of a growing region below the scratch
  (func $ensureGrow (param $cur i32) (param $n i32)
    (if (i32.le_u (i32.add (local.get $cur) (local.get $n)) (global.get $outCap))
      (then (return)))
    (call $growPages (i32.add
      (i32.add (i32.add (local.get $cur) (local.get $n)) (i32.const 64))
      (global.get $scratchCap)))
    (call $rebase (global.get $scratchBase)))

  ;; make room for $n more block-record bytes
  (func $ensureRec (param $n i32)
    (call $ensureGrow (global.get $rec) (local.get $n)))

  ;; make room for $n more output bytes
  (func $ensureOut (param $n i32)
    (call $ensureGrow (global.get $out) (local.get $n)))

  ;; make room for $n prefix bytes plus the live suffix
  (func $ensureScratch (param $n i32)
    (local $old i32)
    (local $want i32)
    (local $floor i32)
    (local.set $n (i32.add (local.get $n) (global.get $scratchTailUsed)))
    (if (i32.le_u (local.get $n) (global.get $scratchCap)) (then (return)))
    (local.set $want (i32.shl (global.get $scratchCap) (i32.const 1)))
    (if (i32.lt_u (local.get $want) (i32.add (local.get $n) (i32.const 4096)))
      (then (local.set $want (i32.add (local.get $n) (i32.const 4096)))))
    (local.set $old (global.get $scratchBase))
    ;; the scratch must clear whichever of the two lower regions is still growing
    (local.set $floor (select (global.get $rec) (global.get $out)
      (i32.gt_u (global.get $rec) (global.get $out))))
    (call $growPages (i32.add (i32.add (local.get $floor) (i32.const 64)) (local.get $want)))
    (global.set $scratchCap (local.get $want))
    (call $rebase (local.get $old)))

  ;; write up to eight literal bytes held in an immediate (see (out.str "...")).
  ;; The store always writes eight bytes; the slack below $outCap absorbs the
  ;; tail and later writes overwrite it.
  (func $outSmall (param $v i64) (param $n i32)
    (call $ensureOut (local.get $n))
    (i64.store (global.get $out) (local.get $v))
    (global.set $out (i32.add (global.get $out) (local.get $n))))

  ;; write $n literal bytes from the string pool
  (func $outRaw (param $ptr i32) (param $n i32)
    (call $ensureOut (local.get $n))
    (memory.copy (global.get $out) (local.get $ptr) (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n))))

  (func $outByte (param $c i32)
    (call $ensureOut (i32.const 1))
    (i32.store8 (global.get $out) (local.get $c))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  ;; copy [$lhs,$rhs) verbatim
  (func $outCopy (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs)) (then (return)))
    (call $ensureOut (i32.sub (local.get $rhs) (local.get $lhs)))
    (memory.copy (global.get $out) (local.get $lhs) (i32.sub (local.get $rhs) (local.get $lhs)))
    (global.set $out (i32.add (global.get $out) (i32.sub (local.get $rhs) (local.get $lhs)))))

  ;; write $v in decimal
  (func $outNum (param $v i32)
    (local $p i32)
    (call $ensureOut (i32.const 10))
    (local.set $p (i32.const $mem.numbufEnd))
    (loop $digit
      (local.set $p (i32.sub (local.get $p) (i32.const 1)))
      (i32.store8 (local.get $p)
        (i32.add (i32.const "0") (i32.rem_u (local.get $v) (i32.const 10))))
      (local.set $v (i32.div_u (local.get $v) (i32.const 10)))
      (br_if $digit (local.get $v)))
    (memory.copy (global.get $out) (local.get $p)
      (i32.sub (i32.const $mem.numbufEnd) (local.get $p)))
    (global.set $out (i32.add (global.get $out)
      (i32.sub (i32.const $mem.numbufEnd) (local.get $p)))))

  ;; Reserve, then copy [$lhs,$rhs) as escaped text.
  (func $outText (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs)) (then (return)))
    (call $ensureOut
      (i32.mul (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 6)))
    (call $outTextReserved (local.get $lhs) (local.get $rhs)))

  ;; Copy escaped text after the caller has reserved the worst-case output.
  ;; This entry point is what lets scratch-backed callers reserve before they
  ;; turn their offsets into pointers, without paying for a second check.
  ;; Processes 16 bytes per step.
  ;; Wide loads may read up to 15 bytes past $rhs: always inside a buffer with
  ;; slack. Wide stores may write up to 15 bytes of garbage past the advanced
  ;; cursor; later writes overwrite it.
  (func $outTextReserved (param $lhs i32) (param $rhs i32)
    (local $c i32)
    (local $mask i32)
    (local $k i32)
    (local $rem i32)
    (local $w v128)
    (local $lo v128)
    (local $hi v128)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs)) (then (return)))
    (local.set $lo (v128.const i8x16
      0x01 0 0x02 0 0 0 0x02 0 0 0 0 0 0x04 0 0x04 0))
    (local.set $hi (v128.const i8x16
      0x01 0 0x02 0x04 0 0 0 0 0 0 0 0 0 0 0 0))
    (block $done
      (loop $outer
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (block $special
          (loop $wide
            (local.set $w (v128.load (local.get $lhs)))
            (local.set $mask (i8x16.bitmask (i8x16.ne
              (v128.and
                (i8x16.swizzle (local.get $lo) (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
                (i8x16.swizzle (local.get $hi) (i8x16.shr_u (local.get $w) (i32.const 4))))
              (i8x16.splat (i32.const 0)))))
            (local.set $rem (i32.sub (local.get $rhs) (local.get $lhs)))
            (if (local.get $mask)
              (then
                (local.set $k (i32.ctz (local.get $mask)))
                ;; A candidate in the wide-load slack is not part of the range.
                (if (i32.lt_u (local.get $k) (local.get $rem))
                  (then
                    (v128.store (global.get $out) (local.get $w))
                    (global.set $out (i32.add (global.get $out) (local.get $k)))
                    (local.set $lhs (i32.add (local.get $lhs) (local.get $k)))
                    (br $special)))))
            (v128.store (global.get $out) (local.get $w))
            (if (i32.le_u (local.get $rem) (i32.const 16))
              (then
                (global.set $out (i32.add (global.get $out) (local.get $rem)))
                (br $done)))
            (global.set $out (i32.add (global.get $out) (i32.const 16)))
            (local.set $lhs (i32.add (local.get $lhs) (i32.const 16)))
            (br $wide)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eqz (local.get $c))
          (then
            ;; the specification replaces NUL with the replacement character
            (i32.store (global.get $out) (i32.const "\ef\bf\bd"))
            (global.set $out (i32.add (global.get $out) (i32.const 3))))
          (else (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (i64.store (global.get $out) (i64.const "&amp;"))
            (global.set $out (i32.add (global.get $out) (i32.const 5))))
          (else (if (i32.eq (local.get $c) (i32.const "<"))
            (then
              (i32.store (global.get $out) (i32.const "&lt;"))
              (global.set $out (i32.add (global.get $out) (i32.const 4))))
            (else (if (i32.eq (local.get $c) (i32.const ">"))
              (then
                (i32.store (global.get $out) (i32.const "&gt;"))
                (global.set $out (i32.add (global.get $out) (i32.const 4))))
              (else
                (i64.store (global.get $out) (i64.const "&quot;"))
                (global.set $out (i32.add (global.get $out) (i32.const 6)))))))))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $outer))))
)
