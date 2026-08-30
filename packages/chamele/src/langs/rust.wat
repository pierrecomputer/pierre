(module
  (import "../common.wat")

  (func $rustByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $rustWordEq (param $lhs i32) (param $rhs i32) (param $n i32) (param $word i64) (result i32)
    (local $mask i64)
    (if (i32.ne (i32.sub (local.get $rhs) (local.get $lhs)) (local.get $n))
      (then (return (i32.const 0))))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then (return (i64.eq (i64.load (local.get $lhs)) (local.get $word)))))
    (local.set $mask (i64.sub
      (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
      (i64.const 1)))
    (i64.eq (i64.and (i64.load (local.get $lhs)) (local.get $mask)) (local.get $word)))

  ;; Token in the low byte; bit 8 expects a function name and bit 9 a type.
  (func $rustWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (if (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "fn"))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "struct"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "enum")))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "trait"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "type")))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "union"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "mod")))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "use"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "extern")))
      (then (return (enum.get $Token.keyword.import))))
    (if (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "crate"))
      (then (return (enum.get $Token.keyword.import))))

    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "if"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "else")))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "match"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "loop")))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "while"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "for")))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "return"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "break")))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "continue"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "await")))
      (then (return (enum.get $Token.keyword.control))))

    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "let"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "const")))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "static"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "impl")))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "pub"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "mut")))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "async"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "unsafe")))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "where"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "dyn")))
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "as"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "in")))
      (then (return (enum.get $Token.keyword.operator))))

    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "bool"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "char")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "str"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "usize")))
      (then (return (enum.get $Token.type.builtin))))
    (if (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "isize"))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.and
          (i32.and (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                   (i32.eq (i32.load8_u offset=1 (local.get $lhs)) (i32.const "8")))
          (i32.or (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "i"))
                  (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "u"))))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "i16"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "u16")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "i32"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "u32")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "i64"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "u64")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "f32"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "f64")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "true"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "false")))
      (then (return (enum.get $Token.boolean))))
    (if (i32.or
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "self"))
          (call $rustWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "Self")))
      (then (return (enum.get $Token.variable.special))))
    (i32.const -1))

  (func $rustBlockComment (param $hl i32)
    (local $lhs i32) (local $c i32) (local $c2 i32) (local $depth i32)
    (local.set $lhs (global.get $ptr))
    (local.set $depth (i32.const 1))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $rustByte (i32.add (global.get $ptr) (i32.const 1))))
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
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (call $streamSetNested
      (local.get $depth) (i32.const "/*") (i32.const "*/") (local.get $hl)))

  (func $rustRawStart (param $prefix i32) (result i32)
    (local $p i32)
    (local.set $p (i32.add (global.get $ptr) (local.get $prefix)))
    (block $done
      (loop $hash
        (br_if $done (i32.ne (call $rustByte (local.get $p)) (i32.const "#")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (i32.eq (call $rustByte (local.get $p)) (i32.const 34)))

  (func $rustRawString (param $prefix i32)
    (local $lhs i32) (local $p i32) (local $q i32) (local $hashes i32) (local $seen i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (i32.add (global.get $ptr) (local.get $prefix)))
    (block $hashDone
      (loop $hash
        (br_if $hashDone (i32.ne (call $rustByte (local.get $p)) (i32.const "#")))
        (local.set $hashes (i32.add (local.get $hashes) (i32.const 1)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
          (then
            (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $seen (i32.const 0))
            (block $matchDone
              (loop $match
                (br_if $matchDone (i32.ge_u (local.get $seen) (local.get $hashes)))
                (br_if $matchDone (i32.ne (call $rustByte (local.get $q)) (i32.const "#")))
                (local.set $seen (i32.add (local.get $seen) (i32.const 1)))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $match)))
            (if (i32.eq (local.get $seen) (local.get $hashes))
              (then (global.set $ptr (local.get $q)) (br $done)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (if (i32.eq (global.get $ptr) (global.get $end))
      (then
        (i32.store8 (i32.const $mem.streamDelimiter) (i32.const 34))
        (memory.fill
          (i32.const $mem.streamDelimiter+1) (i32.const "#") (local.get $hashes))
        (call $streamSetFixed
          (i32.const $mem.streamDelimiter)
          (i32.add (local.get $hashes) (i32.const 1))
          (enum.get $Token.string)))))

  (func $rustIsOp (param $c i32) (result i32)
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
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))))))))

  (func $hlRust
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32) (local $attr i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $rustByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $rustByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $rustBlockComment (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "*")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "c")))
              (i32.and (i32.eq (local.get $c2) (i32.const "r")) (call $rustRawStart (i32.const 2))))
          (then (call $rustRawString (i32.const 2)) (local.set $member (i32.const 0)) (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "r")) (call $rustRawStart (i32.const 1)))
          (then (call $rustRawString (i32.const 1)) (local.set $member (i32.const 0)) (br $next)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "c")))
              (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (call $lexString (local.get $c2) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string)) (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (block $lifeDone
              (loop $life
                (br_if $lifeDone (i32.eqz (call $lexIsIdentContinue (call $rustByte (local.get $p)))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $life)))
            (if (i32.and (i32.gt_u (local.get $p) (i32.add (global.get $ptr) (i32.const 1)))
                          (i32.ne (call $rustByte (local.get $p)) (i32.const 39)))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr)))
              (else (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "#"))
              (i32.or (i32.eq (local.get $c2) (i32.const "["))
                      (i32.and (i32.eq (local.get $c2) (i32.const "!")) (i32.eq (local.get $c3) (i32.const "[")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const "!")))))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 1))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (if (local.get $attr)
              (then (local.set $hl (enum.get $Token.attribute)) (local.set $attr (i32.const 0)))
              (else
                (local.set $kind (call $rustWordHl (local.get $lhs) (local.get $rhs)))
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
                        (if (i32.eq (call $rustByte (local.get $p)) (i32.const "!"))
                          (then (local.set $hl (enum.get $Token.function)))
                          (else
                            (if (i32.eq (call $rustByte (local.get $p)) (i32.const "("))
                              (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.function) (local.get $member))))
                              (else
                                (if (local.get $member)
                                  (then (local.set $hl (enum.get $Token.property)))
                                  (else
                                    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                      (then (local.set $hl (enum.get $Token.constant)))
                                      (else
                                        (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                                          (then (local.set $hl (enum.get $Token.type)))
                                          (else (local.set $hl (enum.get $Token.variable))))))))))))))))))
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
            (if (i32.eqz (local.get $attr)) (then (local.set $member (i32.const 0))))
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
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.eq (local.get $c2) (i32.const ":")))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ".")))))
            (if (i32.and (i32.eq (local.get $c2) (i32.const "."))
                         (i32.eq (call $rustByte (global.get $ptr)) (i32.const "=")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (br $next)))

        (if (call $rustIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (i32.or (i32.eq (local.get $c) (i32.const "&"))
                                  (i32.or (i32.eq (local.get $c) (i32.const "|"))
                                          (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                                  (i32.eq (local.get $c) (i32.const ">")))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                             (i32.eq (call $rustByte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
