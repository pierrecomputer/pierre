(module
  (import "../common.wat")

  (func $kotlinByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $kotlinWordHl below. "Short" is
  ;; missing on purpose: it and "Byte" land in the same bucket and the same
  ;; slot for every table size that fits in this range, which no displacement
  ;; can undo, so $kotlinWordHl matches "Short" directly.
  (keyword-table $kotlinWords $mem.kotlinWords $mem.kotlinWords+1024 16 128
    (group ;; 1: control
      "do" "if" "for" "try" "else" "when" "break" "catch" "throw" "while"
      "return" "finally" "continue")
    (group "fun") ;; 2: declaration, next name is a function
    (group ;; 3: declaration, next name is a type
      "class" "object" "interface" "typealias")
    (group ;; 4: declaration
      "val" "var" "enum" "constructor")
    (group "package" "import") ;; 5: import
    (group "in" "is" "as")     ;; 6: operator keywords
    (group ;; 7: modifiers
      "open" "data" "final" "inline" "public" "sealed" "private" "suspend"
      "abstract" "internal" "override" "protected")
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
        ;; the one word the table cannot hold - the wide load is safe because
        ;; the input buffer keeps slack past $end, as the table probe assumes
        (if (i32.and
              (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                (i64.const "Short")))
          (then (return (enum.get $Token.type.builtin))))
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

  ;; A `"` or `"""` literal. Plain body bytes are skipped with two SIMD hops
  ;; per step: one for the closing quote - plus backslash and CR/LF in a
  ;; single-line string - and one for the `$` that opens a template. The `$`
  ;; position is cached because it is often far away or absent: rescanning only
  ;; when $ptr passes it keeps the whole scan linear even for escape-heavy
  ;; strings.
  (func $kotlinString (param $triple i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $seg i32) (local $template i32)
    (local $stop i32) (local $dollar i32)
    (local.set $seg (global.get $ptr))
    ;; the caller matched every byte of the opener below $end, so no clamp
    (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
    (local.set $dollar (call $lexFindByte (global.get $ptr) (i32.const "$")))
    (block $done
      (loop $scan
        (local.set $stop (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (i32.const 34)
          (i32.eqz (local.get $triple)) (i32.eqz (local.get $triple))))
        (if (i32.gt_u (global.get $ptr) (local.get $dollar))
          (then (local.set $dollar (call $lexFindByte (global.get $ptr) (i32.const "$")))))
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
                (br $done)))))
        (br_if $done (i32.and (i32.eqz (local.get $triple))
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))))
        (if (i32.and (i32.eqz (local.get $triple)) (i32.eq (local.get $c) (i32.const 92)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $utf8SpanEnd
              (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (local.set $c2 (call $kotlinByte (i32.add (global.get $ptr) (i32.const 1))))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "{")) (call $lexIsIdentStart (local.get $c2)))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (local.set $template (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (local.get $c2) (i32.const "{"))
                  (then
                    ;; the `{` was read below $end, so this cannot overshoot
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $template) (global.get $ptr)))
                  (else
                    (call $lexScanIdent)
                    (call $emitTok (enum.get $Token.variable) (local.get $template) (global.get $ptr))))
                (local.set $seg (global.get $ptr))
                (br $scan)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (if (i32.and
          (local.get $triple)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then (call $streamSetFixed32
        (i32.const 0x222222) (i32.const 3) (enum.get $Token.string)))))

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
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (select
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
