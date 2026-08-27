(module
  (import "../common.wat")

  (func $asmIsRegister (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $w i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $c (i32.or (i32.load8_u (local.get $lhs)) (i32.const 32)))
    (if (i32.and
          (i32.gt_u (local.get $n) (i32.const 1))
          (i32.and
            (i32.or
              (i32.eq (local.get $c) (i32.const "r"))
              (i32.or (i32.eq (local.get $c) (i32.const "x"))
                      (i32.eq (local.get $c) (i32.const "w"))))
            (call $lexIsDigit (i32.load8_u offset=1 (local.get $lhs)))))
      (then (return (i32.const 1))))
    (local.set $w (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)))
    (i32.or
      (i32.and (i32.eq (local.get $n) (i32.const 2))
        (i32.or
          (i32.eq (i32.and (local.get $w) (i32.const 0xffff)) (i32.const "sp"))
          (i32.or
            (i32.eq (i32.and (local.get $w) (i32.const 0xffff)) (i32.const "fp"))
            (i32.or
              (i32.eq (i32.and (local.get $w) (i32.const 0xffff)) (i32.const "lr"))
              (i32.eq (i32.and (local.get $w) (i32.const 0xffff)) (i32.const "pc"))))))
      (i32.and (i32.eq (local.get $n) (i32.const 3))
        (i32.or
          (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "eax"))
          (i32.or
            (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "ebx"))
            (i32.or
              (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "ecx"))
              (i32.or
                (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "edx"))
                (i32.or
                  (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "rax"))
                  (i32.eq (i32.and (local.get $w) (i32.const 0xffffff)) (i32.const "rsp"))))))))))

  (func $hlAsm
    (local $c i32)
    (local $expectMnemonic i32)
    (local $hl i32)
    (local $lhs i32)
    (local $next i32)
    (local $next2 i32)
    (local $p i32)
    (local $prefixedNumber i32)
    (local.set $expectMnemonic (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (block $wsDone
          (loop $ws
            (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $wsDone (i32.eqz (call $lexIsSpace (local.get $c))))
            (if (i32.or (i32.eq (local.get $c) (i32.const 10))
                        (i32.eq (local.get $c) (i32.const 13)))
              (then (local.set $expectMnemonic (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $ws)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (local.set $next2 (select
          (i32.load8_u offset=2 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))))
        (local.set $prefixedNumber (i32.and
          (i32.or (i32.eq (local.get $c) (i32.const "#"))
                  (i32.eq (local.get $c) (i32.const "$")))
          (i32.or
            (call $lexIsDigit (local.get $next))
            (i32.and
              (i32.or (i32.eq (local.get $next) (i32.const "+"))
                      (i32.eq (local.get $next) (i32.const "-")))
              (call $lexIsDigit (local.get $next2))))))

        ;; GNU as accepts C block comments alongside `;`, `//` and `#`
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $next) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const ";"))
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const "/"))
                         (i32.eq (local.get $next) (i32.const "/")))
                (i32.and (i32.eq (local.get $c) (i32.const "#"))
                         (i32.eqz (local.get $prefixedNumber)))))
          (then
            (call $lexLineComment
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "/")))
              (enum.get $Token.comment))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $expectMnemonic (i32.const 0))
            (br $token)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (local.get $prefixedNumber))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and
                  (local.get $prefixedNumber)
                  (i32.or
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "+"))
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "-"))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $expectMnemonic (i32.const 0))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "%"))
                    (i32.eq (local.get $c) (i32.const "$")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $expectMnemonic (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $hl (select
              (enum.get $Token.label) (enum.get $Token.preproc)
              (i32.and (i32.lt_u (local.get $p) (global.get $end))
                       (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $hl) (enum.get $Token.label))
              (then (local.set $expectMnemonic (i32.const 1)))
              (else (local.set $expectMnemonic (i32.const 0))))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $hl (enum.get $Token.variable))
            (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                         (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))
              (then (local.set $hl (enum.get $Token.label)))
              (else
                (if (local.get $expectMnemonic)
                  (then (local.set $hl (enum.get $Token.keyword)))
                  (else
                    (if (call $asmIsRegister (local.get $lhs) (global.get $ptr))
                      (then (local.set $hl (enum.get $Token.variable.special))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $expectMnemonic (select
              (i32.const 1) (i32.const 0) (i32.eq (local.get $hl) (enum.get $Token.label))))
            (br $token)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.or (i32.eq (local.get $c) (i32.const "["))
                      (i32.eq (local.get $c) (i32.const "]"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ","))
                    (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
        (br $token))))
)
