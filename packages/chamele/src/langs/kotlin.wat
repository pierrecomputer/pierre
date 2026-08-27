(module
  (import "../common.wat")

  (func $kotlinByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $kotlinWordEq (param $lhs i32) (param $rhs i32) (param $n i32)
      (param $a i64) (param $b i64) (result i32)
    (local $rem i32) (local $mask i64)
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
    (if (i64.ne (i64.load (local.get $lhs)) (local.get $a)) (then (return (i32.const 0))))
    (local.set $rem (i32.sub (local.get $n) (i32.const 8)))
    (local.set $mask (i64.sub
      (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3))))
      (i64.const 1)))
    (i64.eq (i64.and (i64.load offset=8 (local.get $lhs)) (local.get $mask)) (local.get $b)))

  ;; Token in the low byte; bit 8 expects a function name and bit 9 a type.
  (func $kotlinWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (if (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "fun") (i64.const 0))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "class") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "interfac") (i64.const "e")))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "object") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "typealia") (i64.const "s")))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "val") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "var") (i64.const 0)))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "enum") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 11) (i64.const "construc") (i64.const "tor")))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "package") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "import") (i64.const 0)))
      (then (return (enum.get $Token.keyword.import))))

    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "if") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "else") (i64.const 0)))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "when") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "for") (i64.const 0)))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "while") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "do") (i64.const 0)))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "return") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "break") (i64.const 0)))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "continue") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "throw") (i64.const 0)))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "try") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "catch") (i64.const 0)))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "finally") (i64.const 0))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "in") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "is") (i64.const 0)))
      (then (return (enum.get $Token.keyword.operator))))
    (if (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "as") (i64.const 0))
      (then (return (enum.get $Token.keyword.operator))))

    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "public") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "private") (i64.const 0)))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 9) (i64.const "protecte") (i64.const "d"))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "internal") (i64.const 0)))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "open") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "final") (i64.const 0)))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "abstract") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "override") (i64.const 0)))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "data") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "sealed") (i64.const 0)))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "suspend") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "inline") (i64.const 0)))
      (then (return (enum.get $Token.keyword))))

    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "Int") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "Long") (i64.const 0)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "Short") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "Byte") (i64.const 0)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "Float") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "Double") (i64.const 0)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "Boolean") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "Char") (i64.const 0)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "String") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "Unit") (i64.const 0)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "Any") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "Nothing") (i64.const 0)))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "true") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "false") (i64.const 0)))
      (then (return (enum.get $Token.boolean))))
    (if (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "null") (i64.const 0))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.or
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "this") (i64.const 0))
          (call $kotlinWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "super") (i64.const 0)))
      (then (return (enum.get $Token.variable.special))))
    (i32.const -1))

  (func $kotlinBlockComment (param $hl i32)
    (local $lhs i32) (local $c i32) (local $c2 i32) (local $depth i32)
    (local.set $lhs (global.get $ptr))
    (local.set $depth (i32.const 1))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
            (br $loop)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
            (br_if $done (i32.eqz (local.get $depth)))
            (br $loop)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $loop)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))

  (func $kotlinString (param $triple i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $seg i32) (local $template i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
    (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c) (i32.const 34))
              (i32.or (i32.eqz (local.get $triple))
                (i32.and (i32.eq (local.get $c2) (i32.const 34))
                  (i32.eq (call $kotlinByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
            (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
            (br $done)))
        (br_if $done (i32.and (i32.eqz (local.get $triple))
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))))
        (if (i32.and (i32.eqz (local.get $triple)) (i32.eq (local.get $c) (i32.const 92)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (i32.add (global.get $ptr) (i32.const 2)))
            (if (i32.gt_u (local.get $e) (global.get $end)) (then (local.set $e (global.get $end))))
            (block $utf8Done
              (loop $utf8
                (br_if $utf8Done (i32.ge_u (local.get $e) (global.get $end)))
                (br_if $utf8Done (i32.ne (i32.and (i32.load8_u (local.get $e)) (i32.const 0xc0)) (i32.const 0x80)))
                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                (br $utf8)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$"))
              (i32.or (i32.eq (local.get $c2) (i32.const "{")) (call $lexIsIdentStart (local.get $c2))))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $template (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $template) (global.get $ptr)))
              (else
                (call $lexScanIdent)
                (call $emitTok (enum.get $Token.variable) (local.get $template) (global.get $ptr))))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  (func $kotlinIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
                (i32.eq (local.get $c) (i32.const "?")))))))))

  (func $hlKotlin
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
        (local.set $c2 (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $kotlinByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $kotlinBlockComment (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "*"))))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const 34))
              (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34))))
          (then (call $kotlinString (i32.const 1)) (local.set $member (i32.const 0)) (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then (call $kotlinString (i32.const 0)) (local.set $member (i32.const 0)) (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string)) (br $next)))

        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $kotlinWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expect)
                  (then
                    (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                      (i32.eq (local.get $expect) (i32.const 1))))
                    (local.set $expect (i32.const 0)))
                  (else
                    (if (i32.eq (call $kotlinByte (local.get $p)) (i32.const "("))
                      (then (local.set $hl (select
                        (enum.get $Token.function.method) (enum.get $Token.function) (local.get $member))))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
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
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const ":"))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.eq (local.get $c2) (i32.const ":")))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ".")))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))

        (if (call $kotlinIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $kotlinIsOp (call $kotlinByte (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
