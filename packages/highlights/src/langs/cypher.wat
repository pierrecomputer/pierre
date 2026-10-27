(module
  (import "../common.wat")

  ;; Matched without case. Words that also make common names, such as
  ;; `node`, `key`, and `type`, stay out.
  (keyword-table $cypherWords $mem.cypherWords $mem.codeqlWords
    (group $Token.keyword
      "match" "optional" "where" "return" "with" "create" "merge" "set" "delete" "detach"
      "remove" "unwind" "call" "yield" "order" "by" "skip" "limit" "asc" "desc" "ascending"
      "descending" "distinct" "union" "all" "as" "on" "foreach" "load" "csv" "from" "headers"
      "fieldterminator" "using" "periodic" "commit" "index" "constraint" "unique" "drop"
      "exists" "for" "require" "show" "transactions")
    (group $Token.keyword.operator "and" "or" "xor" "not" "in" "is" "starts" "ends" "contains")
    (group $Token.keyword.control "case" "when" "then" "else" "end")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))

  ;; $maps is a bit stack of open brackets, 1 for `{`: inside a map `key:`
  ;; names a property, elsewhere `:` starts a label or relationship type.
  ;; $label is 1 where a label may follow (after `:`, or `|`, `&`, `!`
  ;; between labels) and 2 right after one. Both are checkpointed.
  (func $hlCypher
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $was i32)
    (local $maps i32)
    (local $label i32)
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
        (local.set $was (local.get $label))
        (local.set $label (i32.const 0))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        ;; string literals may span lines
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 1) (enum.get $Token.string))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsIdentContinue (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; names: plain or in backquotes, which only a backquote closes
        (if
          (i32.or
            (i32.or
              (i32.ge_u (local.get $c) (i32.const 0x80))
              (i32.or
                (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (i32.eq (local.get $c) (i32.const "_"))))
            (i32.eq (local.get $c) (i32.const "`")))
          (then
            (if (i32.eq (local.get $c) (i32.const "`"))
              (then
                (global.set $ptr
                  (call $scanFindSpecial
                    (i32.add (local.get $lhs) (i32.const 1))
                    (global.get $end)
                    (i32.const "`")
                    (i32.const 0)
                    (i32.const 1)))
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`")))))
              (else (call $scanIdentRun (i32.const "_"))))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (block $classified
              (local.set $hl (enum.get $Token.type))
              (if (i32.eq (local.get $was) (i32.const 1))
                (then
                  (local.set $label (i32.const 2))
                  (br $classified)))
              ;; `n.name` and `apoc.coll.sum(...)`, but not the end of `1..n`
              (local.set $hl
                (select (enum.get $Token.function) (enum.get $Token.property) (i32.eq (local.get $p) (i32.const "("))))
              (br_if $classified
                (i32.and
                  (i32.gt_u (local.get $lhs) (global.get $srcBase))
                  (i32.and
                    (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "."))
                    (i32.or
                      (i32.le_u (i32.sub (local.get $lhs) (i32.const 1)) (global.get $srcBase))
                      (i32.ne (i32.load8_u (i32.sub (local.get $lhs) (i32.const 2))) (i32.const "."))))))
              (local.set $hl (enum.get $Token.property))
              (br_if $classified
                (i32.and (i32.and (local.get $maps) (i32.const 1)) (i32.eq (local.get $p) (i32.const ":"))))
              (if (i32.ne (local.get $c) (i32.const "`"))
                (then
                  (local.set $g
                    (keyword-table.value $cypherWords
                      (i32.const $mem.lexLowerScratch)
                      (i32.add
                        (i32.const $mem.lexLowerScratch)
                        (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))))
                  (local.set $hl (local.get $g))
                  (br_if $classified (i32.ge_s (local.get $g) (i32.const 0)))))
              (local.set $hl
                (select (enum.get $Token.function) (enum.get $Token.variable) (i32.eq (local.get $p) (i32.const "(")))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (byteset.get "([{" (local.get $c))
              (then
                (local.set $maps
                  (i32.or
                    (i32.shl (local.get $maps) (i32.const 1))
                    (i32.eq (local.get $c) (i32.const "{")))))
              (else (local.set $maps (i32.shr_u (local.get $maps) (i32.const 1)))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ".,;:" (local.get $c))
          (then
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then (local.set $label (i32.eqz (i32.and (local.get $maps) (i32.const 1))))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; arrows and comparisons stay whole: `-->`, `<-`, `<>`, `=~`, `+=`
        (if (byteset.get "!%&*+-/<=>^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $g (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eq (local.get $g) (i32.const "/")))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>^|~" (local.get $g))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (if
              (i32.and
                (i32.eq (local.get $was) (i32.const 2))
                (i32.or
                  (i32.eq (local.get $c) (i32.const "!"))
                  (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "&")))))
              (then (local.set $label (i32.const 1))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
