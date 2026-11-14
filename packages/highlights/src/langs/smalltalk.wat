(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")

  ;; The kind of a pseudo-variable [lhs,rhs), or 0 for another name.
  (func $stPseudo (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $n) (i32.const 11))
      (then
        (return
          (select (enum.get $Token.variable.special) (i32.const 0)
            (i32.and
              (i64.eq (i64.load (local.get $lhs)) (i64.const "thisCont"))
              (i32.eq (i32.and (i32.load offset=7 (local.get $lhs)) (i32.const 0xffffffff)) (i32.const "text")))))))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 3)) (i32.const 2))
      (then (return (i32.const 0))))
    (local.set $w
      (i64.and (i64.load (local.get $lhs))
        (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3)))) (i64.const 1))))
    (if (i32.or (i64.eq (local.get $w) (i64.const "self")) (i64.eq (local.get $w) (i64.const "super")))
      (then (return (enum.get $Token.variable.special))))
    (if (i32.or (i64.eq (local.get $w) (i64.const "true")) (i64.eq (local.get $w) (i64.const "false")))
      (then (return (enum.get $Token.boolean))))
    (select (enum.get $Token.constant.builtin) (i32.const 0) (i64.eq (local.get $w) (i64.const "nil"))))

  ;; $operand is 1 after a receiver or value, so a name after it is a unary
  ;; message. $bar is 1 inside `| temporaries |`, $param 1 after a block
  ;; parameter `:x`, $pragma 1 inside `<primitive: 1>`, $array the depth of
  ;; `#( ... )` literal arrays, whose names are symbols. $def is 1 after
  ;; `>>`. $nl is 1 when the next token starts a line.
  (func $hlSmalltalk
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $gap i32)
    (local $hl i32)
    (local $first i32)
    (local $nl i32)
    (local $operand i32)
    (local $bar i32)
    (local $param i32)
    (local $pragma i32)
    (local $array i32)
    (local $def i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $nl (i32.const 1))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexRawString (i32.const 34) (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (local.set $first (local.get $nl))
        (local.set $nl (i32.const 0))
        (local.set $hl (local.get $param))
        (local.set $param (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexRawString (i32.const 39) (i32.const 1) (enum.get $Token.string))
            (local.set $operand (i32.const 1))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
          (then
            (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $operand (i32.const 1))
            (if (i32.eq (local.get $c2) (i32.const 39))
              (then
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (call $lexRawString (i32.const 39) (i32.const 1) (enum.get $Token.string.special.symbol))
                (br $next)))
            (if (call $lexIsNameStart (local.get $c2))
              (then
                (block $symDone
                  (loop $sym
                    (call $scanIdentRun (i32.const "_"))
                    (br_if $symDone (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (local.set $c (call $templateByte (global.get $ptr)))
                    (br_if $sym (call $lexIsNameStart (local.get $c)))))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (byteset.get "%&*+,-/<=>?@\5c|~" (local.get $c2))
              (then
                (block $opDone
                  (loop $op
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (local.set $c (call $templateByte (global.get $ptr)))
                    (br_if $op (byteset.get "%&*+,-/<=>?@\5c|~" (local.get $c)))))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $operand (i32.const 0))
            (if (byteset.get "([{" (local.get $c2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $array (i32.add (local.get $array) (i32.eq (local.get $c2) (i32.const "("))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; numbers: `16r1F`, `1.5e-3`, `1.5s2`, and a negative literal
        (if (i32.or (call $lexIsDigit (local.get $c))
              (i32.and (i32.and (i32.eq (local.get $c) (i32.const "-"))
                  (i32.or (i32.eqz (local.get $operand)) (local.get $array)))
                (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "-"))))
            (loop $num
              (call $scanIdentRun (i32.const "_"))
              (local.set $c (call $templateByte (global.get $ptr)))
              (local.set $c2 (i32.or (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 32)))
              (if (i32.and (call $lexIsDigit (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                    (i32.or (i32.eq (local.get $c) (i32.const "."))
                      (i32.and (i32.eq (local.get $c) (i32.const "-"))
                        (i32.or (i32.eq (local.get $c2) (i32.const "e"))
                          (i32.or (i32.eq (local.get $c2) (i32.const "d")) (i32.eq (local.get $c2) (i32.const "q")))))))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br $num))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (br $next)))
        (if (call $lexIsNameStart (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (block $kind
              ;; `_` alone is the old assignment
              (if (i32.and (i32.eq (local.get $c) (i32.const "_"))
                    (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
                (then
                  (local.set $hl (enum.get $Token.operator))
                  (local.set $operand (i32.const 0))
                  (br $kind)))
              ;; a keyword message part `at:`
              (if (i32.and (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                    (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "=")))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $hl
                    (select (enum.get $Token.string.special.symbol)
                      (select (enum.get $Token.attribute) (enum.get $Token.function) (local.get $pragma))
                      (local.get $array)))
                  (if (local.get $def)
                    (then (local.set $hl (enum.get $Token.function.definition))))
                  (local.set $operand (i32.const 0))
                  (br $kind)))
              (local.set $c2 (local.get $operand))
              (local.set $operand (i32.eqz (local.get $bar)))
              (local.set $hl (call $stPseudo (local.get $lhs) (global.get $ptr)))
              (br_if $kind (local.get $hl))
              (if (local.get $array)
                (then
                  (local.set $hl (enum.get $Token.string.special.symbol))
                  (br $kind)))
              (if (local.get $bar)
                (then
                  (local.set $hl (enum.get $Token.variable))
                  (br $kind)))
              (local.set $hl (enum.get $Token.type))
              (br_if $kind (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (local.set $hl
                (select (enum.get $Token.function.definition)
                  (select (enum.get $Token.function) (enum.get $Token.variable) (local.get $c2))
                  (local.get $def))))
            (local.set $def (i32.const 0))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (block $kind
          (if (i32.eq (local.get $c) (i32.const ":"))
            (then
              (local.set $operand (i32.const 0))
              (if (i32.eq (local.get $c2) (i32.const "="))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                  (local.set $hl (enum.get $Token.operator))
                  (br $kind)))
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (if (call $lexIsNameStart (local.get $c2))
                (then
                  (call $scanIdentRun (i32.const "_"))
                  (local.set $param (i32.const 1))
                  (local.set $hl (enum.get $Token.variable.parameter))))
              (br $kind)))
          ;; `|` closes block parameters or temporaries, opens temporaries
          ;; where no value precedes it or at a line start, and is a binary
          ;; operator otherwise
          (if (i32.eq (local.get $c) (i32.const "|"))
            (then
              (if (i32.and (local.get $operand) (i32.eqz (i32.or (local.get $hl) (local.get $bar))))
                (then
                  ;; only a bar at a line start declares temporaries; elsewhere it is the binary or
                  (if (local.get $first)
                    (then
                      (local.set $gap (global.get $ptr))
                      (block $tempsDone
                        (loop $temps
                          (local.set $c (call $templateByte (local.get $gap)))
                          (br_if $tempsDone
                            (i32.eqz
                              (i32.or (call $lexIsIdentContinue (local.get $c))
                                (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9))))))
                          (local.set $gap (i32.add (local.get $gap) (i32.const 1)))
                          (br $temps)))
                      (local.set $first (i32.eq (local.get $c) (i32.const "|")))))
                  (if (i32.eqz (local.get $first))
                    (then
                      (local.set $operand (i32.const 0))
                      (local.set $hl (enum.get $Token.operator))
                      (br $kind)))))
              (local.set $bar (i32.and (i32.eqz (local.get $bar)) (i32.eqz (local.get $hl))))
              (local.set $operand (i32.const 0))
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (br $kind)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "<"))
                (i32.and (i32.or (i32.eqz (local.get $operand)) (local.get $first)) (call $lexIsNameStart (local.get $c2))))
            (then
              (local.set $pragma (i32.const 1))
              (local.set $hl (enum.get $Token.punctuation.bracket))
              (br $kind)))
          (if (i32.and (i32.eq (local.get $c) (i32.const ">")) (local.get $pragma))
            (then
              (local.set $pragma (i32.const 0))
              (local.set $operand (i32.const 0))
              (local.set $hl (enum.get $Token.punctuation.bracket))
              (br $kind)))
          (if (byteset.get "%&*+,-/<=>?@\5c|~" (local.get $c))
            (then
              (block $opDone
                (loop $op
                  (local.set $c (call $templateByte (global.get $ptr)))
                  (br_if $opDone (i32.eqz (byteset.get "%&*+,-/<=>?@\5c|~" (local.get $c))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br $op)))
              (local.set $operand (i32.const 0))
              (local.set $hl (enum.get $Token.operator))
              ;; `Foo >> bar` names a method
              (local.set $def
                (i32.and (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
                  (i32.eq (i32.load16_u (local.get $lhs)) (i32.const ">>"))))
              (br $kind)))
          (if (i32.eq (local.get $c) (i32.const "^"))
            (then
              (local.set $operand (i32.const 0))
              (local.set $hl (enum.get $Token.keyword.control))
              (br $kind)))
          (if (byteset.get "()[]{}" (local.get $c))
            (then
              (local.set $hl (enum.get $Token.punctuation.bracket))
              (local.set $operand (byteset.get ")]}" (local.get $c)))
              (if (local.get $array)
                (then
                  (if (i32.eq (local.get $c) (i32.const "("))
                    (then (local.set $array (i32.add (local.get $array) (i32.const 1)))))
                  (if (i32.eq (local.get $c) (i32.const ")"))
                    (then (local.set $array (i32.sub (local.get $array) (i32.const 1)))))))
              (br $kind)))
          (local.set $hl (enum.get $Token.none))
          (if (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ";")))
            (then
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              ;; a cascade `;` sends the next message to the same receiver
              (local.set $operand (i32.eq (local.get $c) (i32.const ";")))))
          (if (i32.eq (local.get $c) (i32.const "!"))
            (then
              (local.set $hl (enum.get $Token.punctuation.special))
              (local.set $operand (i32.const 0))
              (local.set $bar (i32.const 0))
              (local.set $pragma (i32.const 0)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
