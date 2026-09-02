(module
  (import "../common.wat")

  (func $kotlinByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $kotlinWordHl below. "Short" is
  ;; missing on purpose: it and "Byte" land in the same bucket and the same
  ;; slot for every table size that fits in this range, which no displacement
  ;; can undo, so $kotlinWordHl matches "Short" directly. "where" is missing
  ;; for the same reason: the hash sees only the first two bytes, the last
  ;; byte, and the length, which "while" shares.
  (keyword-table $kotlinWords $mem.kotlinWords $mem.kotlinWords+1024 16 128
    (group ;; 1: control
      "do" "if" "for" "try" "else" "when" "break" "catch" "throw" "while"
      "return" "finally" "continue")
    (group "fun") ;; 2: declaration, next name is a function
    (group ;; 3: declaration, next name is a type
      "class" "object" "interface" "typealias")
    (group ;; 4: declaration
      "val" "var" "enum" "init" "constructor")
    (group "package" "import") ;; 5: import
    (group "in" "is" "as")     ;; 6: operator keywords
    (group ;; 7: modifiers
      "by" "out" "open" "data" "const" "final" "infix" "inner" "inline"
      "public" "sealed" "vararg" "private" "reified" "suspend" "abstract"
      "internal" "lateinit" "operator" "override" "companion" "protected")
    (group ;; 8: built-in types
      "Int" "Any" "Long" "Byte" "Char" "Unit" "Float" "Double"
      "String" "Boolean" "Nothing")
    (group "true" "false") ;; 9: booleans
    (group "null")         ;; 10: built-in constant
    (group "this" "super")) ;; 11: special variables

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type.
  (func $kotlinWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g
      (keyword-table.get $kotlinWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        ;; the two words the table cannot hold - the wide load is safe because
        ;; the input buffer keeps slack past $end, as the table probe assumes
        (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
          (then
            (if (i64.eq
                  (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                  (i64.const "Short"))
              (then (return (enum.get $Token.type.builtin))))
            (if (i64.eq
                  (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                  (i64.const "where"))
              (then (return (enum.get $Token.keyword))))))
        (return (i32.const -1))))
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
      (then (return (enum.get $Token.keyword))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 9))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 10))
      (then (return (enum.get $Token.constant.builtin))))
    (enum.get $Token.variable.special))

  ;; Scan a `"` or `"""` body from $ptr, with the string's bytes since $seg
  ;; still unemitted, emitting plain runs, escapes, and `$name` templates as
  ;; it goes. Returns 1 past the closing quote, 2 past a `${` that opens an
  ;; interpolation - emitted as punctuation.special, the caller lexes the
  ;; expression - 3 when an escaped line break ends exactly at $end, so a
  ;; streaming caller keeps the string open, and 0 when the body stops at
  ;; $end or at a raw line break of a single-line string. $interp is nonzero
  ;; inside an interpolation, where a nested string keeps `${` as plain text
  ;; so one brace depth suffices. The next stop byte - the quote, plus
  ;; backslash and CR/LF in a single-line string - and the next `$` before it
  ;; are each found with one SIMD hop and rescanned only once $ptr passes
  ;; them, so the scan stays linear whether `$` is dense, sparse, or absent.
  (func $kotlinStringBody
    (param $triple i32) (param $interp i32) (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $template i32)
    (local $stop i32) (local $dollar i32) (local $status i32)
    (local.set $stop (global.get $ptr))
    (local.set $dollar (global.get $ptr))
    (block $done
      (loop $scan
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (i32.const 34)
              (i32.eqz (local.get $triple)) (i32.eqz (local.get $triple))))
            (local.set $dollar (call $scanFindSpecial
              (global.get $ptr) (local.get $stop) (i32.const "$")
              (i32.const 0) (i32.const 0))))
          (else
            (if (i32.gt_u (global.get $ptr) (local.get $dollar))
              (then (local.set $dollar (call $scanFindSpecial
                (global.get $ptr) (local.get $stop) (i32.const "$")
                (i32.const 0) (i32.const 0)))))))
        (global.set $ptr (select (local.get $dollar) (local.get $stop)
          (i32.lt_u (local.get $dollar) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.or (i32.eqz (local.get $triple))
                  (i32.and
                    (i32.eq (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                    (i32.eq (call $kotlinByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34))))
              (then
                ;; both trailing quotes read below $end, so this cannot overshoot
                (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
                (local.set $status (i32.const 1))
                (br $done)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        ;; a raw line break ends a single-line string, unconsumed
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (if (i32.and
                  (i32.eq (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13))))
              (then (local.set $status (i32.const 3))))
            (br $scan)))
        ;; `$`: a template opener when a brace or a name follows
        (local.set $c2 (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.eqz (local.get $interp)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            ;; the `{` was read below $end, so this cannot overshoot
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.const 2))))
        (if (call $lexIsIdentStart (local.get $c2))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $template (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable) (local.get $template) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

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

  ;; $strKind is 1 inside a `"` body and 2 inside `"""`, with $seg the start
  ;; of its bytes not yet emitted; $interp counts braces inside a `${`
  ;; interpolation and $interpKind remembers which body to return to. A
  ;; pending declaration head - $expect 1 for `fun`, 2 for a type keyword -
  ;; rides its `<...>` type parameters through $fnAngle. All of these are
  ;; checkpointed between stream chunks.
  (func $hlKotlin
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $fnAngle i32) (local $strKind i32) (local $seg i32)
    (local $interp i32) (local $interpKind i32) (local $status i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $strKind)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $kotlinStringBody
              (i32.eq (local.get $strKind) (i32.const 2))
              (local.get $interp)
              (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                ;; `${` opened an interpolation: code until the matching `}`
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0)))
              (else
                ;; closed, or a single-line body cut by a raw line break; a
                ;; triple body, or a single-line one continued by an escaped
                ;; line break at $end, stays open for the next chunk
                (if (i32.or
                      (i32.eq (local.get $status) (i32.const 1))
                      (i32.and
                        (i32.eq (local.get $strKind) (i32.const 1))
                        (i32.eqz (local.get $status))))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
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
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "*"))))
            (br $next)))

        ;; a string opener is emitted at once; its body is scanned at the top
        ;; of the loop, where it can also resume after a chunk boundary
        (if (i32.and (i32.eq (local.get $c) (i32.const 34))
              (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strKind (i32.const 2))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strKind (i32.const 1))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
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
                  (then
                    (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                    (local.set $fnAngle (i32.const 0)))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expect)
                  (then
                    (if (local.get $fnAngle)
                      (then
                        ;; a type parameter of the pending head, or one of
                        ;; its bounds; the head still expects its name
                        (local.set $hl (enum.get $Token.type)))
                      (else
                        (if (i32.and
                              (i32.eq (local.get $expect) (i32.const 1))
                              (i32.or
                                (i32.eq (call $kotlinByte (local.get $p)) (i32.const "."))
                                (i32.or
                                  (i32.eq (call $kotlinByte (local.get $p)) (i32.const "<"))
                                  (i32.eq (call $kotlinByte (local.get $p)) (i32.const "?")))))
                          (then
                            ;; `fun Receiver.name` or `fun List<T>.name`: the
                            ;; receiver type; the head still expects its name
                            (local.set $hl (enum.get $Token.type)))
                          (else
                            (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                              (i32.eq (local.get $expect) (i32.const 1))))
                            (local.set $expect (i32.const 0)))))))
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
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the brace matching `${` returns to the string body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (local.set $expect (i32.const 0))
                        (local.set $fnAngle (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; a bracket ends any pending declaration head
            (local.set $expect (i32.const 0))
            (local.set $fnAngle (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; a comma separates type parameters of a pending head; anywhere
            ;; else it and `;` end the head
            (if (i32.or (i32.eqz (local.get $fnAngle)) (i32.eq (local.get $c) (i32.const ";")))
              (then
                (local.set $expect (i32.const 0))
                (local.set $fnAngle (i32.const 0))))
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
                ;; a comment opener ends the run
                (br_if $opDone (i32.and
                  (i32.eq (call $kotlinByte (global.get $ptr)) (i32.const "/"))
                  (i32.or
                    (i32.eq (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "/"))
                    (i32.eq (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "*")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; a pending declaration head rides its `<`/`>` type parameters
            (if (local.get $expect)
              (then
                (local.set $p (local.get $lhs))
                (block $angleDone
                  (loop $angle
                    (br_if $angleDone (i32.ge_u (local.get $p) (global.get $ptr)))
                    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
                      (then (local.set $fnAngle (i32.add (local.get $fnAngle) (i32.const 1)))))
                    (if (i32.and
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const ">"))
                          (i32.gt_u (local.get $fnAngle) (i32.const 0)))
                      (then (local.set $fnAngle (i32.sub (local.get $fnAngle) (i32.const 1)))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $angle)))))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $expect (i32.const 0))
        (local.set $fnAngle (i32.const 0))
        (br $next))))
)
