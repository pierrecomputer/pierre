(module
  (import "../common.wat")

  (func $elmByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  (keyword-table $elmWords $mem.elmWords $mem.erlangWords
    (group $Token.keyword.control "if" "then" "else" "case" "of" "let" "in")
    (group $Token.keyword.import+256 "module" "import")
    (group $Token.keyword.import "exposing" "as")
    (group $Token.keyword.declaration+512 "type")
    (group $Token.keyword.declaration "alias" "port" "infix" "left" "right" "non")
    (group $Token.boolean "True" "False")
    (group $Token.type.builtin "Int" "Float" "Bool" "Char" "String" "List" "Maybe" "Result" "Never"))

  ;; Strings carry their quote and mode in the lexer checkpoint; nested comments
  ;; use the shared delimiter stack. Both stop at the enclosing scan boundary.
  (func $hlElm
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $hl i32)
    (local $kind i32)
    (local $expect i32)
    (local $import i32)
    (local $member i32)
    (local $midLine i32)
    (local $quote i32)
    (local $triple i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $quote)
          (then
            (local.set $lhs (global.get $ptr))
            (block $stringDone
              (loop $string
                (global.set $ptr (call $scanFindSpecial (global.get $ptr) (global.get $end)
                  (local.get $quote) (i32.const 1) (i32.eqz (local.get $triple))))
                (br_if $stringDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (if (i32.and (i32.eqz (local.get $triple))
                      (byteset.get "\0a\0d" (local.get $c)))
                  (then
                    (local.set $quote (i32.const 0))
                    (br $stringDone)))
                (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 92))
                  (then
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    (local.set $lhs (global.get $ptr))
                    (global.set $ptr (call $lexEscapeEnd (global.get $ptr)))
                    ;; Elm Unicode escapes include the braced hex code point.
                    (if (i32.and
                          (i32.eq (call $elmByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "u"))
                          (i32.eq (call $elmByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "{")))
                      (then
                        (local.set $rhs (call $scanHexRun (i32.add (local.get $lhs) (i32.const 3)) (i32.const 6)))
                        (if (i32.and
                              (i32.gt_u (local.get $rhs) (i32.add (local.get $lhs) (i32.const 3)))
                              (i32.eq (call $elmByte (local.get $rhs)) (i32.const "}")))
                          (then (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))))))
                    (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
                    (local.set $lhs (global.get $ptr)))
                  (else
                    (if (i32.or (i32.eqz (local.get $triple))
                          (i32.and
                            (i32.eq (call $elmByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                            (i32.eq (call $elmByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr)
                          (select (i32.const 3) (i32.const 1) (local.get $triple))))
                        (local.set $quote (i32.const 0))
                        (local.set $triple (i32.const 0))
                        (br $stringDone)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (br $string)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.lt_u (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                    (i32.const 10) (i32.const 0) (i32.const 1)) (global.get $ptr))
          (then
            (local.set $midLine (i32.const 0))
            (local.set $member (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $elmByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-")))
          (then (call $lexLineComment (i32.const 2) (enum.get $Token.comment)) (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const "-")))
          (then
            (call $lexNestedBlockComment (i32.const "{-") (i32.const "-}")
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.eq (call $elmByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "|"))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $midLine (i32.const 1))
            (local.set $quote (local.get $c))
            (if (i32.and (i32.eq (local.get $c) (i32.const 34))
                  (i32.and (i32.eq (local.get $c2) (i32.const 34))
                    (i32.eq (call $elmByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const 34))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $triple (i32.const 1)))
              (else
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $kind (keyword-table.value $elmWords (local.get $lhs) (local.get $rhs)))
            ;; Module and declared type names can also name builtin types.
            (if (i32.and (local.get $expect)
                  (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (then (local.set $kind (i32.const -1))))
            (if (i32.eq (local.get $kind) (i32.add (enum.get $Token.keyword.import) (i32.const 256)))
              (then (local.set $import (i32.const 1)))
              (else
                (if (i32.and (local.get $import)
                      (i32.and (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                        (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "as"))))
                  (then (local.set $expect (i32.const 1)))
                  (else
                    (if (i32.or (i32.ge_s (local.get $kind) (i32.const 0))
                          (i32.gt_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
                      (then (local.set $import (i32.const 0))))))))
            (local.set $hl (enum.get $Token.variable))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (if (local.get $expect)
                  (then
                    (local.set $hl (select (enum.get $Token.namespace) (enum.get $Token.type)
                      (i32.eq (local.get $expect) (i32.const 1))))
                    (if (i32.ne (call $elmByte (local.get $rhs)) (i32.const "."))
                      (then (local.set $expect (i32.const 0)))))
                  (else
                    (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                      (then
                        (local.set $hl (select (enum.get $Token.namespace) (enum.get $Token.type)
                          (i32.eq (call $elmByte (local.get $rhs)) (i32.const ".")))))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (i32.eqz (local.get $midLine))
                              (then (local.set $hl (enum.get $Token.function.definition))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (local.set $midLine (i32.const 1))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $midLine (i32.const 1))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (byteset.get ".,:" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "+-*/=<>|&^!%#?~\5c" (local.get $c))
          (then (local.set $hl (enum.get $Token.operator))))
        (local.set $member (i32.eq (local.get $c) (i32.const ".")))
        (local.set $midLine (i32.const 1))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
