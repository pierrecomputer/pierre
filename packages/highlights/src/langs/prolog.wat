(module
  (import "../common.wat")

  ;; A clause head is a definition even when it reuses one of these names.
  (keyword-table $prologWords $mem.prologWords $mem.laterWordsEnd
    (group $Token.keyword.operator "is" "mod" "rem" "xor" "div")
    (group $Token.keyword.control "true" "fail" "false" "call" "catch" "throw" "halt")
    (group $Token.keyword.import "module" "use_module" "ensure_loaded" "include")
    (group $Token.keyword "dynamic" "discontiguous" "multifile" "initialization" "table")
    (group $Token.function
      "findall" "bagof" "setof" "forall" "assert" "asserta" "assertz" "retract" "atom" "number"
      "integer" "var" "nonvar" "atomic" "compound" "is_list" "functor" "arg" "copy_term"
      "atom_codes" "atom_length" "atom_concat" "number_codes" "format" "write"
      "writeln" "nl" "read" "length" "append" "member" "reverse" "nth0" "nth1" "maplist"
      "between" "sort" "msort"))

  (func $plIsSymbol (param $c i32) (result i32)
    (byteset.get "#$&*+-./:<=>?@\\^~" (local.get $c)))

  ;; A clause ends with `.` before layout, `%`, or the input end. $head: 1 while
  ;; the next token starts a clause.
  (func $hlProlog
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $hl i32)
    (local $head i32)
    (local $atHead i32)
    (local.set $head (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        ;; comments keep the clause start
        (local.set $atHead (local.get $head))
        (local.set $head (i32.const 0))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const "`")))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string.special.symbol))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "0")) (i32.eq (local.get $c2) (i32.const 39)))
          (then
            (local.set $rhs (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
            (if (i32.ge_u (local.get $rhs) (i32.const 32))
              (then
                (if (i32.eq (local.get $rhs) (i32.const 92))
                  (then
                    (global.set $ptr (call $lexEscapeEnd (i32.add (local.get $lhs) (i32.const 2)))))
                  (else
                    (global.set $ptr
                      (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 3)) (global.get $end)))
                    (if
                      (i32.and
                        (i32.eq (local.get $rhs) (i32.const 39))
                        (i32.eq (call $templateByte (global.get $ptr)) (i32.const 39)))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (if
              (i32.or
                (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                (i32.eq (local.get $c) (i32.const "_")))
              (then
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (local.get $rhs))
                (br $next)))
            (local.set $hl (enum.get $Token.function.definition))
            (if (i32.eqz (local.get $atHead))
              (then
                (local.set $hl (keyword-table.value $prologWords (local.get $lhs) (local.get $rhs)))
                (if (i32.lt_s (local.get $hl) (i32.const 0))
                  (then
                    ;; a functor needs its `(` right after the name
                    (local.set $c (call $templateByte (local.get $rhs)))
                    (local.set $hl
                      (select
                        (enum.get $Token.function)
                        (enum.get $Token.string.special.symbol)
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "("))
                          (i32.and
                            (i32.eq (local.get $c) (i32.const "/"))
                            (call $lexIsDigit
                              (call $templateByte (i32.add (local.get $rhs) (i32.const 1))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "!"))
          (then
            (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "."))
            (i32.or (i32.le_u (local.get $c2) (i32.const 32)) (i32.eq (local.get $c2) (i32.const "%"))))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.const 1))
            (br $next)))
        (if (call $plIsSymbol (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $plIsSymbol (call $templateByte (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const "|")))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
