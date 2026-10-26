(module
  (import "../common.wat")

  ;; Lowercase words. Functions such as CALCULATE are names before `(`.
  (keyword-table $daxWords $mem.daxWords $mem.powerqueryWords
    (group $Token.keyword.declaration "var" "define" "measure" "column" "table" "function")
    (group $Token.keyword.control "return")
    (group $Token.keyword "evaluate" "order" "by" "asc" "desc" "start" "at")
    (group $Token.keyword.operator "in" "not")
    (group $Token.boolean "true" "false"))

  ;; Tables are `Sales` before `[` or quoted as `'Sales Data'`; `[Column]`
  ;; and `[Measure]` are properties. No state carries between lines.
  (func $hlDax
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $n i32)
    (local $v i32)
    (local $hl i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if
          (i32.or
            (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-"))))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        ;; a doubled quote closes and reopens, so `"a ""b"""` stays one span
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexRawString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexRawString (i32.const 39) (i32.const 0) (enum.get $Token.type))
            (br $next)))
        ;; `]]` escapes a bracket in a column name
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            (block $closed
              (loop $scan
                (local.set $p
                  (call $scanFindSpecial
                    (local.get $p)
                    (global.get $end)
                    (i32.const "]")
                    (i32.const 0)
                    (i32.const 1)))
                (br_if $closed (i32.ne (call $templateByte (local.get $p)) (i32.const "]")))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $closed (i32.ne (call $templateByte (local.get $p)) (i32.const "]")))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $scan)))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; a name starts with an identifier byte other than `$`; dotted names
        ;; such as `STDEV.S` are functions
        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            (call $scanIdentRun (i32.const "."))
            (local.set $rhs (global.get $ptr))
            (local.set $n
              (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
            (local.set $v
              (keyword-table.value $daxWords
                (i32.const $mem.lexLowerScratch)
                (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
            (local.set $hl (enum.get $Token.variable))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then (local.set $hl (local.get $v))))
            (if
              (i32.and
                (i32.lt_s (local.get $v) (i32.const 0))
                (i32.eq (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))) (i32.const "(")))
              (then (local.set $hl (enum.get $Token.function))))
            (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const "["))
              (then (local.set $hl (enum.get $Token.type))))
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
        ;; `&&`, `||`, `<>`, `==`, and `:=`; a run stops before a comment
        (if (byteset.get "!%&*+-/:<=>?^|~" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/:<=>?^|~" (local.get $c))))
                (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $opDone
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $c) (i32.const "/"))
                      (i32.or (i32.eq (local.get $c2) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*"))))
                    (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
