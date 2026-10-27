(module
  (import "../common.wat")

  ;; Library names such as `Table.AddColumn` are dotted names, not keywords.
  (keyword-table $pqWords $mem.powerqueryWords $mem.dWords
    (group $Token.keyword "let" "in" "each" "type" "meta" "nullable" "optional")
    (group $Token.keyword.control "if" "then" "else" "try" "otherwise" "error" "catch")
    (group $Token.keyword.operator "and" "or" "not" "as" "is")
    (group $Token.keyword.declaration "section" "shared")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.type.builtin
      "any" "anynonnull" "binary" "date" "datetime" "datetimezone" "duration" "function" "list"
      "logical" "none" "number" "record" "table" "text" "time" "action"))

  ;; The body of a text literal from $ptr, whose bytes from $seg are not yet
  ;; emitted. `""` and `#(cr,lf)` escapes split it. Returns 1 after the
  ;; closing quote, or 0 at $end.
  (func $pqText (param $seg i32) (result i32)
    (local $p i32)
    (local $q i32)
    (local $c i32)
    (loop $scan
      (local.set $p (call $lexFindEither (global.get $ptr) (i32.const 34) (i32.const "#")))
      (if (i32.ge_u (local.get $p) (global.get $end))
        (then
          (global.set $ptr (global.get $end))
          (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
          (return (i32.const 0))))
      (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
      (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 34))
        (then
          (if (i32.ne (call $templateByte (global.get $ptr)) (i32.const 34))
            (then
              (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
              (return (i32.const 1))))
          (local.set $q (i32.add (local.get $p) (i32.const 2))))
        (else
          ;; names, hex digits, `#`, and commas up to `)`
          (local.set $q (global.get $ptr))
          (if (i32.eq (call $templateByte (local.get $q)) (i32.const "("))
            (then
              (loop $name
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (local.set $c (call $templateByte (local.get $q)))
                (br_if $name
                  (i32.or
                    (i32.and (call $lexIsIdentContinue (local.get $c)) (i32.lt_u (local.get $c) (i32.const 0x80)))
                    (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const "#"))))))
              (local.set $q
                (select
                  (i32.add (local.get $q) (i32.const 1))
                  (global.get $ptr)
                  (i32.eq (local.get $c) (i32.const ")"))))))))
      (if (i32.gt_u (local.get $q) (global.get $ptr))
        (then
          (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
          (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $q))
          (global.set $ptr (local.get $q))
          (local.set $seg (local.get $q))))
      (br $scan))
    (unreachable))

  ;; $text is 1 while a text literal continues past the chunk. $nest holds
  ;; one bit per open bracket, 1 for `[`, so a name before `=` inside a
  ;; record is a field. Both are checkpointed.
  (func $hlPowerquery
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $dotted i32)
    (local $text i32)
    (local $nest i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $text)
      (then
        (local.set $text
          (i32.and
            (i32.eqz (call $pqText (global.get $ptr)))
            (i32.eq (global.get $ptr) (global.get $eof))))))
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "/"))
              (then
                (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "*"))
              (then
                (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $text
              (i32.and
                (i32.eqz (call $pqText (local.get $lhs)))
                (i32.eq (global.get $ptr) (global.get $eof))))
            (br $next)))
        ;; `#date(...)` and `#table(...)` build values; `#infinity`, `#nan`,
        ;; and `#shared` are constants
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (if (call $lexIsNameStart (local.get $c2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $scanIdentRun (i32.const "_"))
                (call $emitTok
                  (select
                    (enum.get $Token.function)
                    (enum.get $Token.constant.builtin)
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "(")))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))))

        (if
          (i32.or
            (call $lexIsNameStart (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const 34))))
          (then
            (local.set $v (i32.const -1))
            (local.set $dotted (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                ;; `#"quoted name"`, where `""` escapes a quote
                (local.set $p (i32.add (local.get $lhs) (i32.const 2)))
                (block $closed
                  (loop $quote
                    (local.set $p
                      (call $scanFindSpecial
                        (local.get $p)
                        (global.get $end)
                        (i32.const 34)
                        (i32.const 0)
                        (i32.const 1)))
                    (br_if $closed (i32.ne (call $templateByte (local.get $p)) (i32.const 34)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $closed (i32.ne (call $templateByte (local.get $p)) (i32.const 34)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $quote)))
                (global.set $ptr (local.get $p)))
              (else
                ;; a dot joins name parts only before another name
                (loop $part
                  (call $scanIdentRun (i32.const "_"))
                  (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                  (if
                    (i32.and
                      (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                      (call $lexIsNameStart (local.get $c2)))
                    (then
                      (local.set $dotted (i32.const 1))
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (br $part))))
                (if (i32.eqz (local.get $dotted))
                  (then (local.set $v (keyword-table.value $pqWords (local.get $lhs) (global.get $ptr)))))))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $c2 (call $templateByte (local.get $p)))
            (local.set $hl (local.get $v))
            (if (i32.lt_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (enum.get $Token.variable))
                ;; `[Name]` reads a field; `[a = 1]` defines one
                (if
                  (i32.or
                    (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const "["))
                    (i32.and
                      (i32.and (local.get $nest) (i32.const 1))
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const "="))
                        (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">")))))
                  (then (local.set $hl (enum.get $Token.property)))
                  (else
                    (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const "("))
                      (then (local.set $hl (enum.get $Token.function)))
                      (else
                        ;; `Int64.Type` is a type; `JoinKind.Inner` a library constant
                        (if (local.get $dotted)
                          (then
                            (local.set $hl (enum.get $Token.constant))
                            (if
                              (i32.and
                                (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
                                (i32.and
                                  (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 5))) (i32.const "."))
                                  (i32.eq (i32.load (i32.sub (local.get $rhs) (i32.const 4))) (i32.const "Type"))))
                              (then (local.set $hl (enum.get $Token.type.builtin)))))
                          (else
                            (if (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1)))
                              (then
                                (if (i32.eq (local.get $c) (i32.const "_"))
                                  (then (local.set $hl (enum.get $Token.variable.special))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `=>`, `<>`, `??`, `..`, and `...`; a run stops before a comment
        (if (i32.or (byteset.get "!&*+-/:<=>?@|" (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $opDone
              (loop $op
                (local.set $c2 (call $templateByte (global.get $ptr)))
                (br_if $opDone
                  (i32.eqz
                    (select
                      (i32.eq (local.get $c2) (i32.const "."))
                      (byteset.get "!&*+-/:<=>?@|" (local.get $c2))
                      (i32.eq (local.get $c) (i32.const ".")))))
                (local.set $p (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "/"))
                    (i32.or (i32.eq (local.get $p) (i32.const "*")) (i32.eq (local.get $p) (i32.const "/")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "([{" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $nest
              (i32.or
                (i32.shl (local.get $nest) (i32.const 1))
                (i32.eq (local.get $c) (i32.const "["))))))
        (if (byteset.get ")]}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $nest (i32.shr_u (local.get $nest) (i32.const 1)))))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
