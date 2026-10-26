(module
  (import "../common.wat")

  ;; The next `{`, `}`, `"`, or backslash at or after $p, or $end - one SIMD
  ;; step per 16 bytes, so long abstracts cost no per-byte branches.
  (func $bibFind (param $p i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "{")))
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "}"))))
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const 34)))
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const 92)))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Scan a braced or quoted field value from $ptr as one string, with LaTeX
  ;; commands (`\"o`, `\LaTeX`) as escapes. Bytes from $seg are not yet
  ;; emitted. $open is the brace depth times two, plus one inside quotes.
  ;; Returns the state still open at $end, or 0 once the value closed.
  ;; WARNING: braces count even after a backslash, as BibTeX counts them,
  ;; and `\"` is an escape only inside braces, where a quote cannot close.
  (func $bibValue (param $seg i32) (param $open i32) (result i32)
    (local $c i32)
    (local $p i32)
    (block $done
      (loop $scan
        (local.set $p (call $bibFind (global.get $ptr)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (local.set $c (call $templateByte (global.get $ptr)))
            (if (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (then
                (loop $name
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br_if $name
                    (i32.le_u
                      (i32.sub (i32.or (call $templateByte (global.get $ptr)) (i32.const 32)) (i32.const "a"))
                      (i32.const 25)))))
              (else
                (if
                  (i32.and
                    (i32.gt_u (local.get $c) (i32.const 32))
                    (i32.and
                      (i32.or (i32.ne (local.get $c) (i32.const 34)) (i32.ne (local.get $open) (i32.const 1)))
                      (i32.and (i32.ne (local.get $c) (i32.const "{")) (i32.ne (local.get $c) (i32.const "}")))))
                  (then
                    (global.set $ptr
                      (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))))))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $open (i32.add (local.get $open) (i32.const 2)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            ;; a stray closer inside quotes is text
            (br_if $scan (i32.lt_u (local.get $open) (i32.const 2)))
            (local.set $open (i32.sub (local.get $open) (i32.const 2)))
            (br_if $done (i32.eqz (local.get $open)))
            (br $scan)))
        ;; a quote closes only a quoted value outside braces
        (br_if $scan (i32.ne (local.get $open) (i32.const 1)))
        (local.set $open (i32.const 0))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $open))

  ;; $state: 0 outside entries, where text is a comment; 1 after `@type`;
  ;; 2 before the citation key; 3 before a field name; 4 in a field value.
  ;; $kind: 1 in `@string`, 2 in `@preamble`. $close: the entry's closing
  ;; byte. $open: a field value left open at the chunk end (see $bibValue).
  (func $hlBibtex
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $len i32)
    (local $w i64)
    (local $state i32)
    (local $kind i32)
    (local $close i32)
    (local $open i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $open)
      (then (local.set $open (call $bibValue (global.get $ptr) (local.get $open)))))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eqz (local.get $state))
          (then
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "@"))
                (i32.le_u
                  (i32.sub (i32.or (call $templateByte (global.get $ptr)) (i32.const 32)) (i32.const "a"))
                  (i32.const 25)))
              (then
                (call $scanIdentRun (i32.const "-"))
                ;; entry types ignore case; `@comment` stays comment text
                (local.set $len (i32.sub (global.get $ptr) (local.get $lhs)))
                (local.set $w (i64.or (i64.load offset=1 (local.get $lhs)) (i64.const 0x2020202020202020)))
                (local.set $kind
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $len) (i32.const 7))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "string")))
                    (i32.shl
                      (i32.and (i32.eq (local.get $len) (i32.const 9)) (i64.eq (local.get $w) (i64.const "preamble")))
                      (i32.const 1))))
                (if
                  (i32.and
                    (i32.eq (local.get $len) (i32.const 8))
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "comment")))
                  (then
                    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                    (br $next)))
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (local.set $state (i32.const 1))
                (br $next)))
            (global.set $ptr (call $scanFind3 (global.get $ptr) (i32.const "@") (i32.const 10) (i32.const 13)))
            (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $state) (i32.const 1))
          (then
            (local.set $state (i32.const 0))
            (global.set $ptr (local.get $lhs))
            (br_if $next (i32.and (i32.ne (local.get $c) (i32.const "{")) (i32.ne (local.get $c) (i32.const "("))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $close (select (i32.const "}") (i32.const ")") (i32.eq (local.get $c) (i32.const "{"))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $state
              (select
                (i32.const 4)
                (select (i32.const 3) (i32.const 2) (local.get $kind))
                (i32.eq (local.get $kind) (i32.const 2))))
            (br $next)))
        ;; an `@` between fields starts the next entry of a truncated one
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (local.set $state (i32.const 0))
            (global.set $ptr (local.get $lhs))
            (br $next)))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $state (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $state (select (i32.const 4) (i32.const 3) (i32.eq (local.get $kind) (i32.const 2))))
            (br $next)))
        ;; biber reads `%` line comments between fields
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $state) (i32.const 2))
          (then
            (block $keyDone
              (loop $key
                (br_if $keyDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $keyDone
                  (i32.or
                    (i32.le_u (local.get $c) (i32.const 32))
                    (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (local.get $close)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $key)))
            (call $emitTok (enum.get $Token.constant) (local.get $lhs) (global.get $ptr))
            (local.set $state (i32.const 3))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "#")))
          (then
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $state (i32.const 4))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const 34)))
          (then
            (local.set $open
              (call $bibValue (local.get $lhs) (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "{")))))
            (br $next)))
        (if (call $lexIsIdentContinue (local.get $c))
          (then
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok
              (select
                (select (enum.get $Token.number) (enum.get $Token.variable) (call $lexIsDigit (local.get $c)))
                (select (enum.get $Token.variable) (enum.get $Token.property) (local.get $kind))
                (i32.eq (local.get $state) (i32.const 4)))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
