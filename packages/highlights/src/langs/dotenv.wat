(module
  (import "./ini.wat")

  ;; Shared with nginx.
  (func $envDollar (param $stop i32) (param $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
    (if
      (i32.and
        (i32.lt_u (global.get $ptr) (local.get $stop))
        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "{")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (local.set $p
          (call $scanFindSpecial (global.get $ptr) (local.get $stop) (i32.const "}") (i32.const 0) (i32.const 1)))
        (if
          (i32.and
            (i32.lt_u (local.get $p) (local.get $stop))
            (i32.eq (i32.load8_u (local.get $p)) (i32.const "}")))
          (then
            (call $emitTok (enum.get $Token.variable) (global.get $ptr) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))))
        (return)))
    (if (i32.lt_u (global.get $ptr) (local.get $stop))
      (then (call $scanIdentRun (i32.const 0))))
    (if (i32.gt_u (global.get $ptr) (local.get $stop))
      (then (global.set $ptr (local.get $stop))))
    (call $emitTok
      (select
        (enum.get $Token.variable)
        (local.get $hl)
        (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
      (local.get $lhs)
      (global.get $ptr)))

  ;; Returns 1 after the closing quote, 0 at $end. Shared with nginx.
  (func $envQuoted (param $quote i32) (param $vars i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $stop i32)
    (block $done
      (loop $l
        ;; Reuse the found stop until $ptr passes it, so many `$` do not rescan.
        (if (i32.le_u (local.get $stop) (global.get $ptr))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (local.get $quote)
                (local.get $vars)
                (i32.const 0)))))
        (global.set $ptr
          (if (result i32) (local.get $vars)
            (then
              (call $scanFindSpecial (global.get $ptr) (local.get $stop) (i32.const "$") (i32.const 0) (i32.const 0)))
            (else (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e)))
          (else (call $envDollar (local.get $stop) (enum.get $Token.string))))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; $line: 0 at a line start, 1 after `=`, 2 after a value. $open: the quote of
  ;; a value still open at the chunk end.
  (func $hlDotenv
    (local $c i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $rhs i32)
    (local $line i32)
    (local $open i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $open)
      (then
        (if (call $envQuoted (local.get $open) (i32.eq (local.get $open) (i32.const 34)) (global.get $ptr))
          (then (local.set $open (i32.const 0))))))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $line (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        ;; a blank before `#` starts a comment
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.or (i32.ne (local.get $line) (i32.const 1)) (i32.lt_u (local.get $gap) (local.get $lhs))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eqz (local.get $line))
          (then
            (local.set $line (i32.const 2))
            (if
              (i32.and
                (i32.le_u (i32.add (local.get $lhs) (i32.const 7)) (global.get $end))
                (i32.and
                  (i64.eq
                    (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff))
                    (i64.const "export"))
                  (i32.or
                    (i32.eq (i32.load8_u offset=6 (local.get $lhs)) (i32.const 32))
                    (i32.eq (i32.load8_u offset=6 (local.get $lhs)) (i32.const 9)))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 6)))
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (local.set $line (i32.const 0))
                (br $next)))
            (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (block $keyDone
                  (loop $key
                    (call $scanIdentRun (i32.const "."))
                    (br_if $keyDone (i32.ne (call $templateByte (global.get $ptr)) (i32.const "-")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $key)))
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                (if (i32.eq (call $templateByte (local.get $p)) (i32.const "="))
                  (then
                    (call $emitGap (global.get $ptr) (local.get $p))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.operator) (local.get $p) (global.get $ptr))
                    (local.set $line (i32.const 1))))
                (br $next)))))
        (if (i32.and (i32.eq (local.get $line) (i32.const 1)) (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const 96)))))
          (then
            (local.set $line (i32.const 2))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $open
              (select
                (i32.const 0)
                (local.get $c)
                (call $envQuoted (local.get $c) (i32.eq (local.get $c) (i32.const 34)) (local.get $lhs))))
            (br $next)))
        (local.set $p (local.get $lhs))
        (block $found
          (loop $find
            (local.set $p
              (call $scanFindSpecial (local.get $p) (global.get $end) (i32.const "#") (i32.const 0) (i32.const 1)))
            (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
            (br_if $found (i32.ne (i32.load8_u (local.get $p)) (i32.const "#")))
            (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
            (br_if $found
              (i32.and (i32.gt_u (local.get $p) (local.get $lhs)) (byteset.get " \t" (local.get $c))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $find)))
        (local.set $rhs (call $iniTrim (local.get $lhs) (local.get $p)))
        (local.set $p
          (call $scanFindSpecial (local.get $lhs) (local.get $rhs) (i32.const "$") (i32.const 0) (i32.const 0)))
        (if (i32.and (i32.eq (local.get $line) (i32.const 1)) (i32.eq (local.get $p) (local.get $rhs)))
          (then
            (if (call $iniIsNumber (local.get $lhs) (local.get $rhs))
              (then
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (local.get $rhs))))
            (if (call $iniIsBoolean (local.get $lhs) (local.get $rhs))
              (then
                (global.set $ptr (local.get $rhs))
                (call $emitTok (enum.get $Token.boolean) (local.get $lhs) (local.get $rhs))))))
        (local.set $line (i32.const 2))
        (block $plainDone
          (loop $plain
            (br_if $plainDone (i32.ge_u (global.get $ptr) (local.get $rhs)))
            (local.set $p
              (call $scanFindSpecial (global.get $ptr) (local.get $rhs) (i32.const "$") (i32.const 0) (i32.const 0)))
            (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $p))
            (global.set $ptr (local.get $p))
            (br_if $plainDone (i32.ge_u (local.get $p) (local.get $rhs)))
            (call $envDollar (local.get $rhs) (enum.get $Token.none))
            (br $plain)))
        (br $next))))
)
