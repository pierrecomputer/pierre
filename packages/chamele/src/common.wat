(module
  (import "./token.wat")
  (import "./scan.wat")
  (import "./emit.wat")

  ;; Shared ASCII predicates. Bytes >= 0x80 stay identifier bytes so a lexer
  ;; never puts a span boundary inside a UTF-8 code point.
  (func $lexIsSpace (param $c i32) (result i32)
    (i32.or
      (i32.eq (local.get $c) (i32.const 32))
      (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))

  (func $lexIsDigit (param $c i32) (result i32)
    (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))

  (func $lexIsHex (param $c i32) (result i32)
    (i32.or
      (call $lexIsDigit (local.get $c))
      (i32.le_u
        (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
        (i32.const 5))))

  (func $lexIsIdentStart (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25))
        (i32.or
          (i32.eq (local.get $c) (i32.const "_"))
          (i32.eq (local.get $c) (i32.const "$"))))))

  (func $lexIsIdentContinue (param $c i32) (result i32)
    (i32.or (call $lexIsIdentStart (local.get $c)) (call $lexIsDigit (local.get $c))))

  (func $lexScanWhitespace
    (call $scanWhitespace))

  (func $lexScanIdent
    (call $scanIdentRun (i32.const "$")))

  ;; A language-neutral numeric run. It keeps radix digits, separators,
  ;; exponents, and type suffixes together, but leaves `.` for member access
  ;; unless a digit follows it.
  (func $lexScanNumber
    (local $c i32)
    (local $next i32)
    (local $prev i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (call $lexIsIdentContinue (local.get $c))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (local.set $next (select
              (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (br_if $done (i32.eqz (call $lexIsDigit (local.get $next))))
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "+"))
                      (i32.eq (local.get $c) (i32.const "-")))
              (i32.or
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e"))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "p"))))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br $done))))

  ;; Quoted literal beginning at $ptr. Escapes are emitted separately, and a
  ;; malformed escape cannot split a multibyte UTF-8 character.
  (func $lexString (param $quote i32) (param $multiline i32) (param $hl i32)
    (local $c i32)
    (local $e i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $quote) (i32.const 1)
          (i32.eqz (local.get $multiline))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        ;; a raw line break: unterminated, left unconsumed
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (call $utf8SpanEnd
          (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr)))

  (func $lexRawString (param $quote i32) (param $multiline i32) (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (call $scanFindSpecial
      (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)
      (local.get $quote) (i32.const 0) (i32.eqz (local.get $multiline))))
    ;; the closing quote is consumed; a raw line break is left unconsumed
    (if (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (i32.eq (i32.load8_u (global.get $ptr)) (local.get $quote)))
      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))

  (func $lexLineComment (param $skip i32) (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (call $scanToLineEnd)
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))

  (func $lexBlockComment (param $skip i32) (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (call $scanBlockCommentEnd)
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))

  (func $lexSkipSpaceAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Split a C-family `#include` directive already bounded by [lhs,rhs).
  ;; Return one after emitting a quoted or angle-bracket header, zero when the
  ;; directive uses a macro or has another name.
  (func $lexEmitIncludeDirective (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $word i32)
    (local $header i32)
    (local $close i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $name
      (loop $space
        (br_if $name (i32.ge_u (local.get $p) (local.get $rhs)))
        (br_if $name (i32.and
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (local.set $word (local.get $p))
    (if (i32.gt_u (i32.add (local.get $word) (i32.const 7)) (local.get $rhs))
      (then (return (i32.const 0))))
    (if (i64.ne
          (i64.and (i64.load (local.get $word)) (i64.const 0x00ffffffffffffff))
          (i64.const "include"))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $word) (i32.const 7)))
    (if (i32.and (i32.lt_u (local.get $p) (local.get $rhs))
          (call $lexIsIdentContinue (i32.load8_u (local.get $p))))
      (then (return (i32.const 0))))
    (block $headerStart
      (loop $space
        (br_if $headerStart (i32.ge_u (local.get $p) (local.get $rhs)))
        (br_if $headerStart (i32.and
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (if (i32.ge_u (local.get $p) (local.get $rhs)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
      (then (local.set $close (i32.const ">")))
      (else
        (if (i32.ne (i32.load8_u (local.get $p)) (i32.const 34))
          (then (return (i32.const 0))))
        (local.set $close (i32.const 34))))
    (local.set $header (local.get $p))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $headerDone
      (loop $headerByte
        (br_if $headerDone (i32.ge_u (local.get $p) (local.get $rhs)))
        (if (i32.eq (i32.load8_u (local.get $p)) (local.get $close))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $headerDone)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $headerByte)))
    (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (local.get $header))
    (call $emitTok (enum.get $Token.string) (local.get $header) (local.get $p))
    (call $emitTok (enum.get $Token.preproc) (local.get $p) (local.get $rhs))
    (i32.const 1))

  ;; Return the next occurrence of either byte, or $end. Long clean runs use
  ;; one SIMD comparison pair per 16 bytes; the tail never reads past $end.
  (func $lexFindEither (param $p i32) (param $a i32) (param $b i32) (result i32)
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
          (i8x16.eq (local.get $w) (i8x16.splat (local.get $a)))
          (i8x16.eq (local.get $w) (i8x16.splat (local.get $b))))))
        (if (local.get $mask)
          (then (return (i32.add (local.get $p) (i32.ctz (local.get $mask))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $simd)))
    (block $done
      (loop $tail
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.or
              (i32.eq (i32.load8_u (local.get $p)) (local.get $a))
              (i32.eq (i32.load8_u (local.get $p)) (local.get $b)))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $tail)))
    (global.get $end))

  (func $lexIsConstCase (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $upper i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
          (then (local.set $upper (i32.const 1)))
          (else
            (if (i32.eqz (i32.or
                  (call $lexIsDigit (local.get $c))
                  (i32.eq (local.get $c) (i32.const "_"))))
              (then (return (i32.const 0))))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (local.get $upper))
)
