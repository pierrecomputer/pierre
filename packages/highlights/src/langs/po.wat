(module
  (import "../common.wat")

  ;; Whether $c is a set bit of $mask, counted from $base.
  (func $poInMask (param $c i32) (param $base i32) (param $mask i64) (result i32)
    (local.set $c (i32.sub (local.get $c) (local.get $base)))
    (i32.and
      (i32.lt_u (local.get $c) (i32.const 64))
      (i32.wrap_i64
        (i64.and (i64.shr_u (local.get $mask) (i64.extend_i32_u (local.get $c))) (i64.const 1)))))

  ;; printf, Python `%(name)s`, Qt `%1`, and brace `{name}` placeholders.
  (func $poPlaceholderEnd (param $p i32) (param $stop i32) (result i32)
    (local $c i32)
    (local $q i32)
    (local $digits i32)
    (local $flags i32)
    (local $limit i32)
    (local $other i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
      (then
        (block $nameDone
          (loop $name
            (br_if $nameDone (i32.ge_u (local.get $q) (local.get $stop)))
            (local.set $c (i32.load8_u (local.get $q)))
            (br_if $nameDone
              (i32.eqz
                (i32.or (call $lexIsIdentContinue (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $name)))
        (if
          (i32.and
            (i32.lt_u (local.get $q) (local.get $stop))
            (i32.eq (i32.load8_u (local.get $q)) (i32.const "}")))
          (then (return (i32.add (local.get $q) (i32.const 1)))))
        (return (local.get $p))))
    (if (i32.ge_u (local.get $q) (local.get $stop))
      (then (return (local.get $p))))
    (local.set $c (i32.load8_u (local.get $q)))
    (if (i32.eq (local.get $c) (i32.const "%"))
      (then (return (i32.add (local.get $q) (i32.const 1)))))
    (if (i32.eq (local.get $c) (i32.const "("))
      (then
        (local.set $q
          (call $scanFindSpecial (local.get $q) (local.get $stop) (i32.const ")") (i32.const 0) (i32.const 1)))
        (if
          (i32.or
            (i32.ge_u (local.get $q) (local.get $stop))
            (i32.ne (i32.load8_u (local.get $q)) (i32.const ")")))
          (then (return (local.get $p))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (local.set $other (i32.const 1))))
    (local.set $flags (local.get $q))
    (block $flagsDone
      (loop $flag
        (br_if $flagsDone (i32.ge_u (local.get $q) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $flagsDone (i32.eqz (call $poInMask (local.get $c) (i32.const 32) (i64.const 0x3ff6c98))))
        (local.set $other (i32.or (local.get $other) (i32.eqz (call $lexIsDigit (local.get $c)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $flag)))
    (local.set $limit (i32.add (local.get $q) (i32.const 2)))
    (local.set $digits (local.get $q))
    (block $lengthDone
      (loop $length
        (br_if $lengthDone (i32.ge_u (local.get $q) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (call $poInMask (local.get $c) (i32.const 64) (i64.const 0x129c2fa010000e2))
          (then (return (i32.add (local.get $q) (i32.const 1)))))
        (br_if $lengthDone (i32.eqz (call $poInMask (local.get $c) (i32.const 64) (i64.const 0x412150000001000))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br_if $length (i32.le_u (local.get $q) (local.get $limit)))))
    (select
      (local.get $digits)
      (local.get $p)
      (i32.and (i32.eqz (local.get $other)) (i32.gt_u (local.get $digits) (local.get $flags)))))

  ;; po strings never span lines.
  (func $poString
    (local $c i32)
    (local $e i32)
    (local $p i32)
    (local $q i32)
    (local $save i32)
    (local $seg i32)
    (local $stop i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $stop
          (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 1)))
        (local.set $save (global.get $end))
        (global.set $end (local.get $stop))
        (block $placeholdersDone
          (loop $placeholders
            (local.set $p (call $lexFindEither (global.get $ptr) (i32.const "%") (i32.const "{")))
            (br_if $placeholdersDone (i32.ge_u (local.get $p) (local.get $stop)))
            (local.set $q (call $poPlaceholderEnd (local.get $p) (local.get $stop)))
            (if (i32.gt_u (local.get $q) (local.get $p))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
                (call $emitTok (enum.get $Token.string.special) (local.get $p) (local.get $q))
                (local.set $seg (local.get $q)))
              (else
                (local.set $q
                  (i32.add
                    (i32.add (local.get $p) (i32.const 1))
                    (i32.eq (i32.load16_u (local.get $p)) (i32.const "{{"))))))
            (global.set $ptr (local.get $q))
            (br $placeholders)))
        (global.set $end (local.get $save))
        (global.set $ptr (local.get $stop))
        (br_if $done (i32.ge_u (local.get $stop) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $stop)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $stop) (i32.const 1)))
            (br $done)))
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (local.set $c (call $templateByte (i32.add (local.get $stop) (i32.const 1))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then
            (global.set $ptr (i32.add (local.get $stop) (i32.const 1)))
            (br $l)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (local.set $e (call $lexEscapeEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  (func $hlPo
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $w i64)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
            (if (i32.eq (local.get $c) (i32.const ","))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (call $scanToLineEnd)
                (local.set $n (global.get $ptr))
                (global.set $ptr (local.get $lhs))
                (block $flagsDone
                  (loop $flags
                    (br_if $flagsDone (i32.ge_u (global.get $ptr) (local.get $n)))
                    (local.set $p
                      (call $scanFindSpecial (global.get $ptr) (local.get $n) (i32.const ",") (i32.const 0) (i32.const 0)))
                    (call $emitTok (enum.get $Token.type) (global.get $ptr) (local.get $p))
                    (global.set $ptr (local.get $p))
                    (br_if $flagsDone (i32.ge_u (local.get $p) (local.get $n)))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                    (br $flags)))
                (br $next)))
            (call $lexLineComment
              (i32.const 1)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment) (i32.eq (local.get $c) (i32.const "."))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $poString)
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $scanIdentRun (i32.const 0))
            (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
            (local.set $w (i64.load (local.get $lhs)))
            (call $emitTok
              (select
                (enum.get $Token.keyword)
                (enum.get $Token.none)
                (i32.or
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 5))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "msgid")))
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 6))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "msgstr"))))
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 7))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "msgctxt")))
                    (i32.and
                      (i32.eq (local.get $n) (i32.const 12))
                      (i32.and
                        (i64.eq (local.get $w) (i64.const "msgid_pl"))
                        (i32.eq (i32.load offset=8 (local.get $lhs)) (i32.const "ural")))))))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (call $emitTok
          (select
            (enum.get $Token.punctuation.bracket)
            (enum.get $Token.none)
            (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]"))))
          (local.get $lhs)
          (global.get $ptr))
        (br $next))))
)
