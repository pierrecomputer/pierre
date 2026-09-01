(module
  ;; input base: 65536 for whole-buffer runs, the live scratch base otherwise.
  ;; token-record offsets and start-of-input checks are relative to it.
  (global $srcBase (mut i32) (i32.const 65536))
  (global $eof (mut i32) (i32.const 0)) ;; input end (the NUL sentinel sits there)
  (global $end (mut i32) (i32.const 0)) ;; scan end: $eof, or a sub-range end for embedded scans
  (global $ptr (mut i32) (i32.const 0)) ;; read cursor

  ;; advance $ptr to the next CR/LF, or to $end - 16 bytes per step
  (func $scanToLineEnd
    (local $mask i32)
    (local $w v128)
    (block $found
      (loop $wide
        (br_if $found (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i8x16.bitmask (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 13))))))
        (if (local.get $mask)
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
            (br $found)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end)))))

  ;; advance $ptr just past the closing `*/`, or to $end - $ptr starts after
  ;; the opening `/*`. 16 bytes per step, hopping star to star inside a chunk.
  (func $scanBlockCommentEnd
    (local $mask i32)
    (local $k i32)
    (local $w v128)
    (block $done
      (loop $wide
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i8x16.bitmask (i8x16.eq (local.get $w) (i8x16.splat (i32.const "*")))))
        (block $advance
          (loop $star
            (br_if $advance (i32.eqz (local.get $mask)))
            (local.set $k (i32.ctz (local.get $mask)))
            (if (i32.and
                  (i32.eq (i32.load8_u offset=1 (i32.add (global.get $ptr) (local.get $k))) (i32.const "/"))
                  (i32.le_u (i32.add (i32.add (global.get $ptr) (local.get $k)) (i32.const 2)) (global.get $end)))
              (then
                (global.set $ptr (i32.add (i32.add (global.get $ptr) (local.get $k)) (i32.const 2)))
                (br $done)))
            (local.set $mask (i32.and (local.get $mask) (i32.sub (local.get $mask) (i32.const 1))))
            (br $star)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide))))

  ;; the next occurrence in [$p,$stop) of $q, backslash (when $esc), or CR/LF
  ;; (when $nl), or $stop when there is none - 16 bytes per step. Wide loads
  ;; may pass $stop into the buffer slack; matches at or past $stop are
  ;; discarded. Disabled classes compare against $q again, so the loop body
  ;; stays branch-free.
  (func $scanFindSpecial (param $p i32) (param $stop i32) (param $q i32) (param $esc i32) (param $nl i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (local $qv v128)
    (local $ev v128)
    (local $nv v128)
    (local $rv v128)
    ;; a cursor already at or past $stop is returned untouched: a lexer may
    ;; overshoot a clamped $end on purpose, and regressing it would re-emit
    (if (i32.ge_u (local.get $p) (local.get $stop))
      (then (return (local.get $p))))
    (local.set $qv (i8x16.splat (local.get $q)))
    (local.set $ev (i8x16.splat (select (i32.const 92) (local.get $q) (local.get $esc))))
    (local.set $nv (i8x16.splat (select (i32.const 10) (local.get $q) (local.get $nl))))
    (local.set $rv (i8x16.splat (select (i32.const 13) (local.get $q) (local.get $nl))))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (v128.or
            (i8x16.eq (local.get $w) (local.get $qv))
            (i8x16.eq (local.get $w) (local.get $ev)))
          (v128.or
            (i8x16.eq (local.get $w) (local.get $nv))
            (i8x16.eq (local.get $w) (local.get $rv))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (local.get $stop))
      (then (local.set $p (local.get $stop))))
    (local.get $p))

  ;; advance $ptr over ASCII whitespace (space, TAB..CR), 16 bytes per step,
  ;; clamped to $end. Empty and single-byte gaps - the common case between
  ;; tokens - take a scalar fast path and never pay the SIMD setup.
  (func $scanWhitespace
    (local $c i32)
    (local $mask i32)
    (local $w v128)
    ;; leave a cursor already at or past $end untouched (see $scanFindSpecial)
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then (return)))
    (local.set $c (i32.load8_u (global.get $ptr)))
    (if (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))
      (then (return)))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then (return)))
    (local.set $c (i32.load8_u (global.get $ptr)))
    (if (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))
      (then (return)))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i32.xor
          (i8x16.bitmask (v128.or
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 32)))
            (i8x16.le_u
              (i8x16.sub (local.get $w) (i8x16.splat (i32.const 9)))
              (i8x16.splat (i32.const 4)))))
          (i32.const 65535)))
        (if (local.get $mask)
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end)))))

  ;; advance $ptr over [A-Za-z0-9_] bytes, any byte >= 0x80 (UTF-8 tails stay
  ;; inside one token), and the extra byte $x - 16 bytes per step, clamped to
  ;; $end
  (func $scanIdentRun (param $x i32)
    (local $mask i32)
    (local $w v128)
    ;; leave a cursor already at or past $end untouched (see $scanFindSpecial)
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then (return)))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i32.xor
          (i8x16.bitmask (v128.or
            (v128.or
              (i8x16.le_u
                (i8x16.sub
                  (v128.or (local.get $w) (i8x16.splat (i32.const 32)))
                  (i8x16.splat (i32.const "a")))
                (i8x16.splat (i32.const 25)))
              (i8x16.lt_s (local.get $w) (i8x16.splat (i32.const 0))))
            (v128.or
              (i8x16.le_u
                (i8x16.sub (local.get $w) (i8x16.splat (i32.const "0")))
                (i8x16.splat (i32.const 9)))
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_")))
                (i8x16.eq (local.get $w) (i8x16.splat (local.get $x)))))))
          (i32.const 65535)))
        (if (local.get $mask)
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end)))))

  ;; the next occurrence in [$p,$end) of $a, $b, or $c, or $end when there is
  ;; none - 16 bytes per step, and the tail never reads past $end
  (func $scanFind3
    (param $p i32) (param $a i32) (param $b i32) (param $c i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (block $scalar
      (loop $simd
        (br_if $scalar
          (i32.lt_u (i32.sub (global.get $end) (local.get $p)) (i32.const 16)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (v128.or
            (i8x16.eq (local.get $w) (i8x16.splat (local.get $a)))
            (i8x16.eq (local.get $w) (i8x16.splat (local.get $b))))
          (i8x16.eq (local.get $w) (i8x16.splat (local.get $c))))))
        (if (local.get $mask)
          (then (return (i32.add (local.get $p) (i32.ctz (local.get $mask))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $simd)))
    (block $done
      (loop $tail
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.or
              (i32.or
                (i32.eq (i32.load8_u (local.get $p)) (local.get $a))
                (i32.eq (i32.load8_u (local.get $p)) (local.get $b)))
              (i32.eq (i32.load8_u (local.get $p)) (local.get $c)))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $tail)))
    (global.get $end))

  ;; clamp $e to $stop, then extend it over UTF-8 continuation bytes: an
  ;; escape span must never split a code point
  (func $utf8SpanEnd (param $e i32) (param $stop i32) (result i32)
    (if (i32.gt_u (local.get $e) (local.get $stop))
      (then (local.set $e (local.get $stop))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $e) (local.get $stop)))
        (br_if $done (i32.ne
          (i32.and (i32.load8_u (local.get $e)) (i32.const 0xc0))
          (i32.const 0x80)))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (local.get $e))

  ;; end of the run of ASCII hex digits starting at $p: at most $max long,
  ;; clamped to $end. Escape spans (`\uXXXX`, `\xNN`, css `\HHHHHH`) cover
  ;; only digits actually present, so a short escape never swallows the byte
  ;; that ends its string.
  (func $scanHexRun (param $p i32) (param $max i32) (result i32)
    (local $c i32)
    (local $stop i32)
    (local.set $stop (i32.add (local.get $p) (local.get $max)))
    (if (i32.gt_u (local.get $stop) (global.get $end))
      (then (local.set $stop (global.get $end))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (i32.and
          (i32.gt_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
          (i32.gt_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 5))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))
)
