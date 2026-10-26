(module
  (import "./ini.wat")

  ;; A one-digit back reference cannot run into another digit, so `%20` stays text.
  (func $apacheText (param $rhs i32)
    (local $c i32)
    (local $p i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $rhs)))
        (local.set $p (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $p)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br_if $l (i32.and (i32.ne (local.get $c) (i32.const "%")) (i32.ne (local.get $c) (i32.const "$"))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.and (i32.lt_u (global.get $ptr) (local.get $rhs)) (i32.eq (local.get $c) (i32.const "{")))
          (then
            (global.set $ptr
              (call $scanFindSpecial (global.get $ptr) (local.get $rhs) (i32.const "}") (i32.const 0) (i32.const 0)))
            (br_if $l (i32.ge_u (global.get $ptr) (local.get $rhs)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
          (else
            (br_if $l
              (i32.or
                (i32.ge_u (global.get $ptr) (local.get $rhs))
                (i32.eqz (call $lexIsDigit (local.get $c)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br_if $l
              (i32.and
                (i32.lt_u (global.get $ptr) (local.get $rhs))
                (call $lexIsDigit (i32.load8_u (global.get $ptr)))))))
        (call $emitTok (enum.get $Token.none) (local.get $seg) (local.get $p))
        (call $emitTok (enum.get $Token.variable) (local.get $p) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (enum.get $Token.none) (local.get $seg) (global.get $ptr)))

  ;; $line: 0 at a line start, 1 in arguments, 2 in a section tag.
  (func $hlApache
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $line i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a `\` before a break joins lines; a blank line ends the join
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $p (local.get $gap))
            (if
              (i32.and
                (i32.gt_u (local.get $gap) (global.get $srcBase))
                (i32.eq (i32.load8_u (i32.sub (local.get $gap) (i32.const 1))) (i32.const 92)))
              (then
                (local.set $c (i32.load8_u (local.get $gap)))
                (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
                  (then
                    (local.set $p (i32.add (local.get $gap) (i32.const 1)))
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const 13))
                        (i32.eq (call $templateByte (local.get $p)) (i32.const 10)))
                      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))))
            (if (call $lexGapHasBreak (local.get $p) (global.get $ptr))
              (then (local.set $line (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eqz (local.get $line))
          (then
            (local.set $line (i32.const 1))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (global.set $ptr (local.get $lhs))
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "/"))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (call $scanIdentRun (i32.const 0))
                (call $emitTok (enum.get $Token.tag) (local.get $lhs) (global.get $ptr))
                (local.set $line (i32.const 2))
                (br $next)))
            (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (then
                (call $scanIdentRun (i32.const 0))
                (call $emitTok
                  (select
                    (enum.get $Token.keyword.import)
                    (enum.get $Token.keyword)
                    (i32.and
                      (i32.ge_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 7))
                      (i64.eq
                        (i64.and
                          (i64.or (i64.load (local.get $lhs)) (i64.const 0x20202020202020))
                          (i64.const 0xffffffffffffff))
                        (i64.const "include"))))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))))
        (if (i32.and (i32.eq (local.get $line) (i32.const 2)) (i32.eq (local.get $c) (i32.const ">")))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (local.set $line (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (local.set $p (call $templateByte (global.get $ptr)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 92))
            (i32.or
              (i32.ge_u (global.get $ptr) (global.get $end))
              (i32.or (i32.eq (local.get $p) (i32.const 10)) (i32.eq (local.get $p) (i32.const 13)))))
          (then
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (block $flagsDone
              (loop $flags
                (local.set $lhs (global.get $ptr))
                (local.set $c (call $templateByte (local.get $lhs)))
                (br_if $flagsDone (i32.le_u (local.get $c) (i32.const 32)))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (if (i32.eq (local.get $c) (i32.const "]"))
                  (then
                    (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                    (br $flagsDone)))
                (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const "=")))
                  (then
                    (call $emitTok
                      (select
                        (enum.get $Token.punctuation.delimiter)
                        (enum.get $Token.operator)
                        (i32.eq (local.get $c) (i32.const ",")))
                      (local.get $lhs)
                      (global.get $ptr))
                    (br $flags)))
                (block $runDone
                  (loop $run
                    (local.set $p (call $templateByte (global.get $ptr)))
                    (br_if $runDone (i32.le_u (local.get $p) (i32.const 32)))
                    (br_if $runDone (byteset.get ",=]" (local.get $p)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $run)))
                (call $emitTok
                  (select
                    (enum.get $Token.number)
                    (select
                      (enum.get $Token.none)
                      (enum.get $Token.constant)
                      (i32.eq (call $templateByte (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "=")))
                    (call $iniIsNumber (local.get $lhs) (global.get $ptr)))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $flags)))
            (br $next)))
        (block $wordDone
          (loop $word
            (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $p (i32.load8_u (global.get $ptr)))
            (br_if $wordDone (i32.le_u (local.get $p) (i32.const 32)))
            (br_if $wordDone (i32.and (i32.eq (local.get $line) (i32.const 2)) (i32.eq (local.get $p) (i32.const ">"))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $word)))
        ;; a `\` at the line end joins lines; it is not part of the argument
        (local.set $p (call $templateByte (global.get $ptr)))
        (if
          (i32.and
            (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 92))
            (i32.or
              (i32.ge_u (global.get $ptr) (global.get $end))
              (i32.or (i32.eq (local.get $p) (i32.const 10)) (i32.eq (local.get $p) (i32.const 13)))))
          (then (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "!"))
            (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
          (then
            (if (i32.eq (i32.load8_u (i32.add (local.get $lhs) (i32.const 1))) (i32.const "^"))
              (then
                (call $emitTok
                  (enum.get $Token.operator)
                  (local.get $lhs)
                  (i32.add (local.get $lhs) (i32.const 1)))
                (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
                (local.set $c (i32.const "^"))))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "^"))
            (i32.and
              (i32.gt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1))
              (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "$"))))
          (then
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $iniIsNumber (local.get $lhs) (global.get $ptr))
          (then
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $iniIsBoolean (local.get $lhs) (global.get $ptr))
          (then
            (call $emitTok (enum.get $Token.boolean) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $p (global.get $ptr))
        (global.set $ptr (local.get $lhs))
        (call $apacheText (local.get $p))
        (br $next))))
)
