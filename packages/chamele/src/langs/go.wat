(module
  (import "../common.wat")

  (func $goByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $goWordEq (param $lhs i32) (param $rhs i32) (param $n i32)
      (param $a i64) (param $b i64) (result i32)
    (local $rem i32)
    (local $mask i64)
    (if (i32.ne (i32.sub (local.get $rhs) (local.get $lhs)) (local.get $n))
      (then (return (i32.const 0))))
    (if (i32.le_u (local.get $n) (i32.const 8))
      (then
        (if (i32.eq (local.get $n) (i32.const 8))
          (then (return (i64.eq (i64.load (local.get $lhs)) (local.get $a)))))
        (local.set $mask (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
          (i64.const 1)))
        (return (i64.eq (i64.and (i64.load (local.get $lhs)) (local.get $mask)) (local.get $a)))))
    (if (i64.ne (i64.load (local.get $lhs)) (local.get $a))
      (then (return (i32.const 0))))
    (local.set $rem (i32.sub (local.get $n) (i32.const 8)))
    (local.set $mask (i64.sub
      (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3))))
      (i64.const 1)))
    (i64.eq (i64.and (i64.load offset=8 (local.get $lhs)) (local.get $mask)) (local.get $b)))

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type, 3=namespace.
  (func $goWordHl (param $lhs i32) (param $rhs i32) (result i32)
    ;; control
    (if (i32.or
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "go") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "if") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "for") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "case") (i64.const 0))))
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "else") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "goto") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "break") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "defer") (i64.const 0)))))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "range") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "return") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "select") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "switch") (i64.const 0))))
          (i32.or
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "default") (i64.const 0))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "continue") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 11)
                (i64.const "fallthro") (i64.const "ugh")))))
      (then (return (enum.get $Token.keyword.control))))

    ;; declarations and imports
    (if (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "func") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "type") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "package") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 768)))))
    (if (i32.or
          (i32.or
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "var") (i64.const 0))
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "const") (i64.const 0)))
          (i32.or
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "map") (i64.const 0))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "chan") (i64.const 0))
              (i32.or
                (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "struct") (i64.const 0))
                (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 9)
                  (i64.const "interfac") (i64.const "e"))))))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "import") (i64.const 0))
      (then (return (enum.get $Token.keyword.import))))

    ;; built-in types
    (if (i32.or
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "int") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "bool") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "byte") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "rune") (i64.const 0))))
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "uint") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "error") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "string") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "uintptr") (i64.const 0)))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "int8") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "int16") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "int32") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "int64") (i64.const 0))))
          (i32.or
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "uint8") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "uint16") (i64.const 0)))
            (i32.or
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "uint32") (i64.const 0))
              (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "uint64") (i64.const 0)))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "float32") (i64.const 0))
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "float64") (i64.const 0)))
          (i32.or
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 9)
              (i64.const "complex6") (i64.const "4"))
            (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 10)
              (i64.const "complex1") (i64.const "28"))))
      (then (return (enum.get $Token.type.builtin))))

    (if (i32.or
          (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "true") (i64.const 0))
          (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "false") (i64.const 0)))
      (then (return (enum.get $Token.boolean))))
    (if (i32.or
          (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "nil") (i64.const 0))
          (call $goWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "iota") (i64.const 0)))
      (then (return (enum.get $Token.constant.builtin))))
    (i32.const -1))

  (func $goIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^"))))))))

  (func $hlGo
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $goByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $goByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/"))
                      (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "*"))
                      (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexRawString (i32.const "`") (i32.const 1) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $goWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expect)
                  (then
                    (local.set $hl
                      (select (enum.get $Token.function.definition)
                        (select (enum.get $Token.namespace) (enum.get $Token.type)
                          (i32.eq (local.get $expect) (i32.const 3)))
                        (i32.eq (local.get $expect) (i32.const 1))))
                    (local.set $expect (i32.const 0)))
                  (else
                    (if (i32.eq (call $goByte (local.get $p)) (i32.const "("))
                      (then (local.set $hl (select
                        (enum.get $Token.function.method) (enum.get $Token.function) (local.get $member))))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (if (i32.le_u
                                      (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else (local.set $hl (enum.get $Token.variable))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))

        (if (call $goIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "+"))
                                    (i32.eq (local.get $c) (i32.const "-")))
                            (i32.or
                              (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                      (i32.eq (local.get $c) (i32.const ">")))
                              (i32.or (i32.eq (local.get $c) (i32.const "&"))
                                      (i32.eq (local.get $c) (i32.const "|")))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const "<"))
                              (i32.eq (local.get $c) (i32.const ">")))
                      (i32.eq (call $goByte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
