(module
  (import "../common.wat")

  (func $swiftByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; group order is the dispatch order in $swiftWordHl below
  (keyword-table $swiftWords $mem.swiftWords $mem.swiftWords+768 16 64
    (group ;; 1: control
      "if" "for" "try" "case" "else" "guard" "while" "break" "catch" "throw"
      "async" "await" "repeat" "return" "switch" "continue")
    (group "func") ;; 2: declaration, next name is a function
    (group ;; 3: declaration, next name is a type
      "enum" "class" "actor" "struct" "protocol" "typealias" "extension")
    (group "let" "var") ;; 4: declaration
    (group "import")    ;; 5: import
    (group "in" "is" "as") ;; 6: operator keywords
    (group ;; 7: built-in types
      "Int" "Bool" "Void" "Float" "Double" "String")
    (group "true" "false") ;; 8: booleans
    (group "nil")          ;; 9: built-in constant
    (group "self" "super")) ;; 10: special variables

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type.
  (func $swiftWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g
      (keyword-table.get $swiftWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g)) (then (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 1)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 9))
      (then (return (enum.get $Token.constant.builtin))))
    (enum.get $Token.variable.special))

  (func $swiftRawStart (result i32)
    (local $p i32)
    (local.set $p (global.get $ptr))
    (block $done
      (loop $hash
        (br_if $done (i32.ne (call $swiftByte (local.get $p)) (i32.const "#")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (i32.eq (call $swiftByte (local.get $p)) (i32.const 34)))

  ;; A hash-delimited string, or a triple-quoted string when hashes is zero.
  (func $swiftHashString
    (local $lhs i32) (local $p i32) (local $q i32)
    (local $hashes i32) (local $seen i32) (local $triple i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $hashDone
      (loop $hash
        (br_if $hashDone (i32.ne (call $swiftByte (local.get $p)) (i32.const "#")))
        (local.set $hashes (i32.add (local.get $hashes) (i32.const 1)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (local.set $triple (i32.and
      (i32.eq (call $swiftByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
      (i32.eq (call $swiftByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34))))
    (global.set $ptr (i32.add (local.get $p) (select (i32.const 3) (i32.const 1) (local.get $triple))))
    (if (i32.gt_u (global.get $ptr) (global.get $end)) (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.and
              (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
              (i32.or (i32.eqz (local.get $triple))
                (i32.and
                  (i32.eq (call $swiftByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                  (i32.eq (call $swiftByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))))
          (then
            (local.set $q (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
            (local.set $seen (i32.const 0))
            (block $matchDone
              (loop $match
                (br_if $matchDone (i32.ge_u (local.get $seen) (local.get $hashes)))
                (br_if $matchDone (i32.ne (call $swiftByte (local.get $q)) (i32.const "#")))
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
        (memory.fill
          (i32.const $mem.streamDelimiter) (i32.const 34)
          (select (i32.const 3) (i32.const 1) (local.get $triple)))
        (memory.fill
          (i32.add
            (i32.const $mem.streamDelimiter)
            (select (i32.const 3) (i32.const 1) (local.get $triple)))
          (i32.const "#") (local.get $hashes))
        (call $streamSetFixed
          (i32.const $mem.streamDelimiter)
          (i32.add
            (local.get $hashes)
            (select (i32.const 3) (i32.const 1) (local.get $triple)))
          (enum.get $Token.string)))))

  (func $swiftIsOp (param $c i32) (result i32)
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
                (i32.or (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c) (i32.const "~"))))))))))

  (func $hlSwift
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $e i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $seg i32) (local $interp i32) (local $stringMode i32)
    (local $openedInterp i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $stringMode)
          (then
            (local.set $stringMode (i32.const 0))
            (local.set $openedInterp (i32.const 0))
            (block $stringDone
              (loop $stringScan
                (global.set $ptr (call $scanFindSpecial
                  (global.get $ptr) (global.get $end)
                  (i32.const 34) (i32.const 1) (i32.const 1)))
                (br_if $stringDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (if (i32.eq (local.get $c) (i32.const 34))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $stringDone)))
                (br_if $stringDone
                  (i32.or (i32.eq (local.get $c) (i32.const 10))
                          (i32.eq (local.get $c) (i32.const 13))))
                (if (i32.eq (local.get $c) (i32.const 92))
                  (then
                    (if (i32.and (i32.eqz (local.get $interp))
                          (i32.eq (call $swiftByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "(")))
                      (then
                        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                        ;; the `(` was read below $end, so `\(` cannot pass it
                        (local.set $e (i32.add (global.get $ptr) (i32.const 2)))
                        (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $e))
                        (global.set $ptr (local.get $e))
                        (local.set $interp (i32.const 1))
                        (local.set $openedInterp (i32.const 1))
                        (br $stringDone)))
                    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                    (local.set $e (call $utf8SpanEnd
                      (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
                    (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
                    (global.set $ptr (local.get $e))
                    (local.set $seg (global.get $ptr))
                    (br $stringScan)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $stringScan)))
            (if (i32.eqz (local.get $openedInterp))
              (then (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $swiftByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $swiftByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "*"))))
            (br $next)))

        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (call $swiftRawStart))
          (then (call $swiftHashString) (local.set $member (i32.const 0)) (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 34))
              (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34))))
          (then (call $swiftHashString) (local.set $member (i32.const 0)) (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $seg (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $stringMode (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $swiftWordHl (local.get $lhs) (local.get $rhs)))
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
                    (if (i32.eq (call $swiftByte (local.get $p)) (i32.const "("))
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
            (if (i32.and (i32.eq (local.get $c) (i32.const ")"))
                  (i32.eq (local.get $interp) (i32.const 1)))
              (then
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $interp (i32.const 0))
                (local.set $seg (global.get $ptr))
                (local.set $stringMode (i32.const 1))
                (local.set $member (i32.const 0))
                (br $next)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "("))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))))))
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
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (call $swiftByte (global.get $ptr)) (i32.const "."))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (br $next)))

        (if (call $swiftIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $swiftIsOp (call $swiftByte (global.get $ptr)))))
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
