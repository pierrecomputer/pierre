(module
  (import "../common.wat")

  ;; Bits 8 and up: the block a declaration opens, 1 fields, 2 enum values, 3
  ;; settings.
  (keyword-table $prismaWords $mem.prismaWords $mem.bicepWords
    (group $Token.keyword.declaration+256 "model" "type" "view")
    (group $Token.keyword.declaration+512 "enum")
    (group $Token.keyword.declaration+768 "datasource" "generator")
    (group $Token.type.builtin
      "String" "Int" "BigInt" "Float" "Decimal" "Boolean" "DateTime" "Json" "Bytes" "Unsupported")
    (group $Token.boolean "true" "false"))

  ;; $pending: the block kind a declaration opens at `{`; $block: the open one.
  ;; $col counts names on a line: name, type, then attributes. $paren: open
  ;; attribute parens.
  (func $hlPrisma
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $pc i32)
    (local $g i32)
    (local $hl i32)
    (local $pending i32)
    (local $block i32)
    (local $col i32)
    (local $paren i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $col (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr
              (i32.add (local.get $lhs) (i32.add (i32.const 1) (i32.eq (local.get $c2) (i32.const "@")))))
            (call $scanIdentRun (i32.const "."))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $pc (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (local.set $g (keyword-table.value $prismaWords (local.get $lhs) (local.get $rhs)))
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $paren)
              (then
                (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                  (then (local.set $hl (enum.get $Token.constant)))
                  (else (local.set $hl (enum.get $Token.property))))
                (if (i32.eq (local.get $pc) (i32.const ":"))
                  (then (local.set $hl (enum.get $Token.variable.parameter)))))
              (else
                (if (i32.eqz (local.get $block))
                  (then
                    (if (i32.ge_s (local.get $g) (i32.const 256))
                      (then
                        (local.set $pending (i32.shr_u (local.get $g) (i32.const 8)))
                        (local.set $hl (enum.get $Token.keyword.declaration)))
                      (else
                        (if (local.get $pending)
                          (then (local.set $hl (enum.get $Token.type)))))))
                  (else
                    (if (i32.eq (local.get $block) (i32.const 3))
                      (then
                        (if (i32.eq (local.get $pc) (i32.const "="))
                          (then (local.set $hl (enum.get $Token.property)))))
                      (else
                        (if (i32.eqz (local.get $col))
                          (then
                            (local.set $hl
                              (select
                                (enum.get $Token.property)
                                (enum.get $Token.constant)
                                (i32.eq (local.get $block) (i32.const 1)))))
                          (else
                            (if (i32.eq (local.get $col) (i32.const 1))
                              (then
                                (local.set $hl
                                  (select
                                    (enum.get $Token.type.builtin)
                                    (enum.get $Token.type)
                                    (i32.eq (local.get $g) (enum.get $Token.type.builtin))))))))))))
                (local.set $col (i32.add (local.get $col) (i32.const 1)))))
            (if (i32.eq (local.get $g) (enum.get $Token.boolean))
              (then (local.set $hl (local.get $g))))
            ;; `Unsupported("circle")` stays a type
            (if
              (i32.and
                (i32.eq (local.get $pc) (i32.const "("))
                (i32.ne (local.get $hl) (enum.get $Token.type.builtin)))
              (then (local.set $hl (enum.get $Token.function))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "-"))))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $paren (i32.add (local.get $paren) (i32.const 1)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.ne (local.get $paren) (i32.const 0)))
              (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (local.set $block (local.get $pending))
                (local.set $pending (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (local.set $block (i32.const 0))
                (local.set $paren (i32.const 0))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ".,;:" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "?")))
          (then
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
