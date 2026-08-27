(module
  (import "../common.wat")

  (func $watWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $p i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 3))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "i32"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "i64"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "f32"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "f64"))))))
          (i32.and (i32.eq (local.get $n) (i32.const 4))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "v128"))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 2))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "if"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffff)) (i64.const "br"))))
          (i32.or
            (i32.and (i32.eq (local.get $n) (i32.const 4))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "else"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "loop"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "then")))))
            (i32.and (i32.eq (local.get $n) (i32.const 5))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "block")))))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 3))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "mut"))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffff)) (i64.const "nop"))))
          (i32.or
            (i32.and (i32.eq (local.get $n) (i32.const 4))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "data"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "elem"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "func"))
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffff)) (i64.const "type"))))))
            (i32.and (i32.eq (local.get $n) (i32.const 5))
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "start")))))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.and (i32.eq (local.get $n) (i32.const 5))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "local"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "param"))
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "table")))))
          (i32.and (i32.eq (local.get $n) (i32.const 6))
            (i32.or
              (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "global"))
              (i32.or
                (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "memory"))
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "export"))
                  (i32.or
                    (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "import"))
                    (i32.or
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "module"))
                      (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "result")))))))))
      (then (return (enum.get $Token.keyword))))
    (local.set $p (local.get $lhs))
    (block $plain
      (loop $dot
        (br_if $plain (i32.ge_u (local.get $p) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (return (enum.get $Token.function))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $dot)))
    (enum.get $Token.keyword))

  (func $watBlockComment
    (local $c i32)
    (local $depth i32)
    (local $lhs i32)
    (local $next i32)
    (local.set $lhs (global.get $ptr))
    (local.set $depth (i32.const 1))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (block $done
      (loop $scan
        (global.set $ptr
          (call $lexFindEither (global.get $ptr) (i32.const "(") (i32.const ";")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "("))
                     (i32.eq (local.get $next) (i32.const ";")))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br $scan)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ";"))
                     (i32.eq (local.get $next) (i32.const ")")))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br_if $done (i32.eqz (local.get $depth)))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr)))

  (func $hlWat
    (local $c i32)
    (local $lhs i32)
    (local $next i32)
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
        (if (i32.and (i32.eq (local.get $c) (i32.const ";"))
                     (i32.eq (local.get $next) (i32.const ";")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "("))
                     (i32.eq (local.get $next) (i32.const ";")))
          (then
            (call $watBlockComment)
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $nameDone
              (loop $name
                (br_if $nameDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $nameDone (i32.or
                  (call $lexIsSpace (local.get $c))
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "("))
                            (i32.eq (local.get $c) (i32.const ")")))
                    (i32.or (i32.eq (local.get $c) (i32.const ";"))
                            (i32.eq (local.get $c) (i32.const 34))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $name)))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+"))
                        (i32.eq (local.get $c) (i32.const "-")))
                (call $lexIsDigit (local.get $next))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "("))
                    (i32.eq (local.get $c) (i32.const ")")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (block $wordDone
          (loop $word
            (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $wordDone (i32.or
              (call $lexIsSpace (local.get $c))
              (i32.or
                (i32.eq (local.get $c) (i32.const 34))
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "("))
                          (i32.eq (local.get $c) (i32.const ")")))
                  (i32.eq (local.get $c) (i32.const ";"))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $word)))
        (if (i32.eq (global.get $ptr) (local.get $lhs))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (call $watWordHl (local.get $lhs) (global.get $ptr))
          (local.get $lhs) (global.get $ptr))
        (br $token))))
)
