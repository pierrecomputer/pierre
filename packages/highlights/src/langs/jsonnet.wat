(module
  (import "../common.wat")

  ;; The high byte primes the next name: 1 a `local` binding, 2 a
  ;; parameter list after `function`.
  (keyword-table $jsonnetWords $mem.jsonnetWords $mem.mermaidWords
    (group $Token.keyword.declaration+256 "local")
    (group $Token.keyword.declaration+512 "function")
    (group $Token.keyword.control "if" "then" "else" "for" "in" "assert" "error")
    (group $Token.keyword.import "import" "importstr" "importbin")
    (group $Token.keyword "tailstrict")
    (group $Token.variable.special "self" "super")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))

  ;; Advance $ptr through a `|||` text block to just past the `|||` that
  ;; starts a line after blanks, or to $end. Return 1 while it stays open.
  (func $jsonnetBlock (result i32)
    (local $p i32)
    (local $first i32)
    (local $open i32)
    (local.set $first (i32.eqz (call $lexLineByteBefore (global.get $ptr))))
    (local.set $open (i32.const 1))
    (block $done
      (loop $line
        (if (local.get $first)
          (then
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (if
              (i32.and
                (i32.le_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
                (i32.and
                  (i32.eq (i32.load16_u (local.get $p)) (i32.const "||"))
                  (i32.eq (i32.load8_u offset=2 (local.get $p)) (i32.const "|"))))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 3)))
                (local.set $open (i32.const 0))
                (br $done)))))
        (call $scanToLineEnd)
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; one line break; CRLF counts once
        (local.set $p (i32.load8_u (global.get $ptr)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if
          (i32.and
            (i32.eq (local.get $p) (i32.const 13))
            (i32.eq (call $templateByte (global.get $ptr)) (i32.const 10)))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $first (i32.const 1))
        (br $line)))
    (local.get $open))

  ;; $stack holds two bits per open bracket: 1 an object, 2 a parameter
  ;; list, 0 anything else. $key is 1 where a field or parameter name may
  ;; follow, $expect the pending name primed by the keyword table or a
  ;; defined name, and $block 1 inside a text block. All are checkpointed.
  (func $hlJsonnet
    (local $c i32) (local $c2 i32) (local $lhs i32) (local $rhs i32) (local $gap i32)
    (local $kind i32) (local $hl i32)
    (local $stack i64) (local $key i32) (local $expect i32) (local $block i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $block)
          (then
            (local.set $lhs (global.get $ptr))
            (local.set $block (call $jsonnetBlock))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/"))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        ;; a string in a field-name position names the field
        (local.set $hl (select (enum.get $Token.property) (enum.get $Token.string) (local.get $key)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 1) (local.get $hl))
            (local.set $key (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        ;; verbatim `@"..."`, where a doubled quote escapes it
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "@"))
            (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (call $lexRawString (local.get $c2) (i32.const 1) (local.get $hl))
            (local.set $key (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        ;; `|||` or `|||-` opens a text block
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "|"))
            (i32.and
              (i32.eq (local.get $c2) (i32.const "|"))
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "|"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "-"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $block (i32.const 1))
            (local.set $key (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $key (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $kind (keyword-table.value $jsonnetWords (local.get $lhs) (local.get $rhs)))
            ;; the next byte on the line: `(` makes a call or a definition
            (local.set $c2 (i32.eq (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))) (i32.const "(")))
            (local.set $hl (enum.get $Token.variable))
            (block $classified
              (if (i32.ge_s (local.get $kind) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                  (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                  (local.set $key (i32.const 0))
                  (br $classified)))
              ;; `.name` and `.name(...)` members
              (if (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const "."))
                (then
                  (local.set $hl (select (enum.get $Token.function) (enum.get $Token.property) (local.get $c2)))
                  (br $classified)))
              (if (local.get $key)
                (then
                  (local.set $key (i32.const 0))
                  (if (i32.eq (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 3))) (i32.const 2))
                    (then
                      (local.set $hl (enum.get $Token.variable.parameter))
                      (br $classified)))
                  ;; `name(params):: body` defines a method field
                  (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.property) (local.get $c2)))
                  (local.set $expect (i32.shl (local.get $c2) (i32.const 1)))
                  (br $classified)))
              (if (i32.eq (local.get $expect) (i32.const 1))
                (then
                  (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.variable) (local.get $c2)))
                  (local.set $expect (i32.shl (local.get $c2) (i32.const 1)))
                  (br $classified)))
              (local.set $expect (i32.const 0))
              (if (local.get $c2)
                (then
                  (local.set $hl (enum.get $Token.function))
                  (br $classified)))
              ;; the `std` library object
              (if
                (i32.and
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                  (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "std")))
                (then (local.set $hl (enum.get $Token.namespace)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "!%&*+-/<=>^|~" (local.get $c))
          (then (local.set $hl (enum.get $Token.operator))))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then (local.set $hl (enum.get $Token.variable.special))))
        (if (byteset.get "([{" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $kind
              (select
                (i32.const 1)
                (i32.shl
                  (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $expect) (i32.const 2)))
                  (i32.const 1))
                (i32.eq (local.get $c) (i32.const "{"))))
            (local.set $stack
              (i64.or (i64.shl (local.get $stack) (i64.const 2)) (i64.extend_i32_u (local.get $kind))))
            (local.set $key (i32.ne (local.get $kind) (i32.const 0)))))
        (if (byteset.get ")]}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $stack (i64.shr_u (local.get $stack) (i64.const 2)))
            (local.set $key (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (local.set $key (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 3))))))
        ;; `.`, `;`, and the field visibility marks `:`, `::`, `:::`
        (if (byteset.get ".,:;" (local.get $c))
          (then
            (if (i32.ne (local.get $c) (i32.const ","))
              (then
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                (local.set $key (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (block $marks
                  (br_if $marks (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br_if $marks (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))))
        (if (i32.eq (local.get $hl) (enum.get $Token.none))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (local.set $expect (i32.const 0))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
