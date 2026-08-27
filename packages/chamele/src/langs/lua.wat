(module
  (import "../common.wat")

  (func $luaLong (param $prefix i32) (param $hl i32) (result i32)
    (local $bracket i32)
    (local $c i32)
    (local $eq i32)
    (local $i i32)
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $bracket (i32.add (global.get $ptr) (local.get $prefix)))
    (if (i32.ge_u (local.get $bracket) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $bracket)) (i32.const "["))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $bracket) (i32.const 1)))
    (block $openDone
      (loop $open
        (br_if $openDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $openDone (i32.ne (local.get $c) (i32.const "=")))
        (local.set $eq (i32.add (local.get $eq) (i32.const 1)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $open)))
    (if (i32.or
          (i32.ge_u (local.get $p) (global.get $end))
          (i32.ne (i32.load8_u (local.get $p)) (i32.const "[")))
      (then (return (i32.const 0))))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $scan
        (global.set $ptr
          (call $lexFindEither (global.get $ptr) (i32.const "]") (i32.const "]")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $i (i32.const 0))
        (block $eqDone
          (loop $closeEq
            (br_if $eqDone (i32.ge_u (local.get $i) (local.get $eq)))
            (br_if $eqDone (i32.ge_u (local.get $p) (global.get $end)))
            (br_if $eqDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "=")))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $closeEq)))
        (if (i32.and
              (i32.eq (local.get $i) (local.get $eq))
              (i32.and (i32.lt_u (local.get $p) (global.get $end))
                       (i32.eq (i32.load8_u (local.get $p)) (i32.const "]"))))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  (func $luaWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 4))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "true")))
          (i32.and (i32.eq (local.get $n) (i32.const 5))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "false"))))
      (then (return (enum.get $Token.boolean))))
    (if (i32.and (i32.eq (local.get $n) (i32.const 3))
                 (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "nil")))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 3))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "and"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "not"))))
          (i32.and (i32.eq (local.get $n) (i32.const 2))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "in"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "or")))))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 2))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "do"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "if"))))
          (i32.and (i32.eq (local.get $n) (i32.const 3))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "end"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "for")))))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 4))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "else"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "then"))))
          (i32.or
            (i32.and (i32.eq (local.get $n) (i32.const 5))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "break"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "until"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "while")))))
          (i32.and (i32.eq (local.get $n) (i32.const 6))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "repeat"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "elseif"))))))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 5))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "local")))
          (i32.and (i32.eq (local.get $n) (i32.const 8))
            (i64.eq (local.get $w) (i64.const "function"))))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 4))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "goto")))
          (i32.and (i32.eq (local.get $n) (i32.const 6))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "return"))))
      (then (return (enum.get $Token.keyword))))
    (enum.get $Token.variable))

  (func $hlLua
    (local $c i32)
    (local $decl i32)
    (local $hl i32)
    (local $lhs i32)
    (local $member i32)
    (local $next i32)
    (local $p i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "-"))
                     (i32.eq (local.get $next) (i32.const "-")))
          (then
            (if (call $luaLong (i32.const 2) (enum.get $Token.comment))
              (then (br $token)))
            (call $lexLineComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "-")))))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (if (call $luaLong (i32.const 0) (enum.get $Token.string))
              (then
                (local.set $decl (i32.const 0))
                (local.set $member (i32.const 0))
                (br $token)))))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (call $lexIsDigit (local.get $next))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $hl (call $luaWordHl (local.get $lhs) (global.get $ptr)))
            (if (local.get $decl)
              (then
                (local.set $hl (enum.get $Token.function.definition))
                (local.set $decl (i32.const 0)))
              (else
                (if (local.get $member)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $hl (select
                      (enum.get $Token.function.method) (enum.get $Token.property)
                      (i32.and (i32.lt_u (local.get $p) (global.get $end))
                               (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))
                    (local.set $member (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                                     (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
              (then
                (if (i32.and
                      (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 8))
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "function")))
                  (then (local.set $decl (i32.const 1))))))
            (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
              (then
                (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (then (local.set $hl (enum.get $Token.constant))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "."))
                    (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                         (i32.eq (i32.load8_u (global.get $ptr)) (local.get $c)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const "."))
                      (i32.and
                        (i32.lt_u (global.get $ptr) (global.get $end))
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "."))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (select
                  (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
                  (i32.eq (local.get $c) (i32.const ".")))
                  (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (call $emitTok (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))))
            (local.set $decl (i32.const 0))
            (br $token)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "["))
                        (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ","))
                    (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
        (local.set $decl (i32.const 0))
        (local.set $member (i32.const 0))
        (br $token))))
)
