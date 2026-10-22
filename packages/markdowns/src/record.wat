(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")

  ;; The current leaf content is either an immutable input span or a rebuilt
  ;; scratch span. $rebase refreshes this absolute base when scratch moves.
  (global $contentLen (mut i32) (i32.const 0))
  (global $contentBase (mut i32) (i32.const 0))
  (global $contentInputEnd (mut i32) (i32.const 0)) ;; source end, including rebuilt content

  (func $contentAt (param $off i32) (result i32)
    (i32.add (global.get $contentBase) (local.get $off)))

  (func $recNew (param $type i32) (result i32)
    (local $r i32)
    (call $ensureRec (i32.const $R.header))
    (local.set $r (global.get $rec))
    (i64.store (local.get $r) (i64.or
      (i64.extend_i32_u (local.get $type))
      ;; default line offset (u16 at byte 2), then initial record size
      (i64.const 0x1800180000)))
    (i64.store offset=8 (local.get $r) (i64.const 0))
    (i64.store offset=16 (local.get $r) (i64.const 0))
    (global.set $rec (i32.add (local.get $r) (i32.const $R.header)))
    (local.get $r))

  (func $recFlag (param $r i32) (param $f i32)
    (i32.store8 offset=1 (local.get $r)
      (i32.or (i32.load8_u offset=1 (local.get $r)) (local.get $f))))

  (func $recGrow (param $r i32) (param $n i32)
    (i32.store offset=4 (local.get $r) (i32.add (i32.load offset=4 (local.get $r)) (local.get $n))))

  ;; where a record's line array starts: after its type-specific bytes
  (func $recLines (param $r i32) (result i32)
    (i32.add (local.get $r) (i32.load16_u offset=2 (local.get $r))))

  (func $lineAt (param $r i32) (param $i i32) (result i32)
    (i32.add (call $recLines (local.get $r)) (i32.mul (local.get $i) (i32.const $R.line))))

  (func $lineBeg (param $line i32) (result i32)
    (i32.load (local.get $line)))

  (func $lineEndOf (param $line i32) (result i32)
    (i32.and (i32.load offset=4 (local.get $line)) (i32.const $R.endMask)))

  (func $linePad (param $line i32) (result i32)
    (i32.shr_u (i32.load offset=4 (local.get $line)) (i32.const 30)))

  ;; Alias an exact LF-separated input span when possible. Otherwise rebuild
  ;; the content in scratch with virtual tab padding and normalized newlines.
  (func $blockContent (param $r i32) (result i32)
    (local $n i32)
    (local $i i32)
    (local $lines i32)
    (local $line i32)
    (local $beg i32)
    (local $end i32)
    (local $total i32)
    (local $dst i32)
    (local $pad i32)
    (local $first i32)
    (local $prevEnd i32)
    (local $alias i32)
    (global.set $scratchUsed (i32.const 0))
    (global.set $scratchTailUsed (i32.const 0))
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (local.set $lines (call $recLines (local.get $r)))
    (local.set $alias (i32.ne (local.get $n) (i32.const 0)))
    (block $sized
      (loop $l
        (br_if $sized (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $line (i32.add (local.get $lines)
          (i32.mul (local.get $i) (i32.const $R.line))))
        (local.set $beg (call $lineBeg (local.get $line)))
        (local.set $end (call $lineEndOf (local.get $line)))
        (local.set $pad (call $linePad (local.get $line)))
        (local.set $total (i32.add (local.get $total) (i32.add
          (i32.add (local.get $pad) (i32.sub (local.get $end) (local.get $beg)))
          (i32.const 1))))
        (if (local.get $alias)
          (then
            (if (local.get $pad)
              (then (local.set $alias (i32.const 0)))
              (else
                (if (i32.eqz (local.get $i))
                  (then (local.set $first (local.get $beg)))
                  (else
                    (if (i32.eqz (i32.and
                          (i32.eq (local.get $beg)
                            (i32.add (local.get $prevEnd) (i32.const 1)))
                          (i32.eq (i32.load8_u (local.get $prevEnd)) (i32.const 10))))
                      (then (local.set $alias (i32.const 0))))))))))
        (local.set $prevEnd (local.get $end))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (global.set $contentInputEnd (local.get $prevEnd))
    (if (local.get $alias)
      (then
        (global.set $contentBase (local.get $first))
        (global.set $contentLen (i32.sub (local.get $prevEnd) (local.get $first)))
        (return (global.get $contentLen))))
    (call $ensureScratch (i32.add (local.get $total) (i32.const 64)))
    (local.set $dst (global.get $scratchBase))
    (global.set $contentBase (local.get $dst))
    (local.set $i (i32.const 0))
    (local.set $total (i32.const 0))
    (block $copied
      (loop $l
        (br_if $copied (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $line (i32.add (local.get $lines)
          (i32.mul (local.get $i) (i32.const $R.line))))
        (local.set $pad (call $linePad (local.get $line)))
        (if (local.get $pad)
          (then
            (memory.fill (i32.add (local.get $dst) (local.get $total)) (i32.const 32) (local.get $pad))
            (local.set $total (i32.add (local.get $total) (local.get $pad)))))
        (local.set $beg (call $lineBeg (local.get $line)))
        (local.set $end (call $lineEndOf (local.get $line)))
        (memory.copy (i32.add (local.get $dst) (local.get $total)) (local.get $beg)
          (i32.sub (local.get $end) (local.get $beg)))
        (local.set $total (i32.add (local.get $total)
          (i32.sub (local.get $end) (local.get $beg))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (if (i32.lt_u (local.get $i) (local.get $n))
          (then
            (i32.store8 (i32.add (local.get $dst) (local.get $total)) (i32.const 10))
            (local.set $total (i32.add (local.get $total) (i32.const 1)))))
        (br $l)))
    ;; a NUL sentinel keeps bounded lookahead safe; the reserved slack keeps
    ;; the 16-byte SIMD loads inside memory
    (memory.fill (i32.add (local.get $dst) (local.get $total)) (i32.const 0) (i32.const 32))
    (global.set $contentLen (local.get $total))
    (global.set $scratchUsed (i32.add (local.get $total) (i32.const 32)))
    (local.get $total))
)
