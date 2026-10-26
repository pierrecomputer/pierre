(module
  (import "../common.wat")

  ;; Lowercase words. High byte: capture the next name as 1 a type or unit, 2 a
  ;; subprogram, 3 library names up to `;`. Plain `keyword` words keep a pending
  ;; capture; others drop it.
  (keyword-table $vhdlWords $mem.vhdlWords $mem.tclWords
    (group $Token.keyword.control
      "if" "then" "elsif" "else" "case" "when" "others" "for" "while" "loop" "exit" "next"
      "return" "wait" "until" "after" "assert" "report" "severity" "generate" "select")
    (group $Token.keyword.declaration+256
      "entity" "architecture" "component" "package" "configuration" "type" "subtype")
    (group $Token.keyword.declaration+512 "function" "procedure")
    (group $Token.keyword.declaration
      "signal" "variable" "constant" "port" "generic" "map" "process" "block" "attribute" "alias"
      "file" "shared" "impure" "pure" "record" "array" "range" "access" "units")
    (group $Token.keyword
      "is" "begin" "end" "in" "out" "inout" "buffer" "body" "to" "downto" "with" "all" "open"
      "new" "transport" "inertial" "postponed")
    (group $Token.keyword+256 "of")
    (group $Token.keyword.import+768 "library" "use" "context")
    (group $Token.keyword.operator
      "and" "or" "xor" "not" "nand" "nor" "xnor" "mod" "rem" "sll" "srl" "sla" "sra" "rol" "ror"
      "abs")
    (group $Token.type.builtin
      "std_logic" "std_logic_vector" "std_ulogic" "std_ulogic_vector" "integer" "natural"
      "positive" "boolean" "bit" "bit_vector" "unsigned" "signed" "real" "time" "character"
      "string" "line" "text")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.function
      "rising_edge" "falling_edge" "to_integer" "to_unsigned" "to_signed" "resize" "shift_left"
      "shift_right"))

  ;; A doubled quote escapes itself. Shared with viml.
  (func $vhdlQuoted (param $q i32) (param $hl i32)
    (local $seg i32)
    (local $p i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p
          (call $scanFindSpecial (global.get $ptr) (global.get $end) (local.get $q) (i32.const 0) (i32.const 1)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (local.get $q)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br_if $done (i32.ne (call $templateByte (global.get $ptr)) (local.get $q)))
        (call $emitTok (local.get $hl) (local.get $seg) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr)))

  ;; $expect: the pending capture; a `:` also expects a type (1).
  (func $hlVhdl
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $expect i32)
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
        (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $vhdlQuoted (i32.const 34) (enum.get $Token.string))
            (local.set $expect (i32.const 0))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        ;; after a name or `)` a tick is an attribute or qualifier, not a character
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $v (i32.const 0))
            (if (i32.gt_u (local.get $lhs) (global.get $srcBase))
              (then (local.set $v (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
            (local.set $hl (enum.get $Token.operator))
            (if (i32.or (call $lexIsIdentContinue (local.get $v)) (i32.eq (local.get $v) (i32.const ")")))
              (then
                (if (call $lexIsIdentStart (local.get $c2))
                  (then
                    (call $scanIdentRun (i32.const "_"))
                    (local.set $hl (enum.get $Token.attribute)))))
              (else
                (local.set $p (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))
                (if (i32.and
                      (i32.eq (call $templateByte (local.get $p)) (i32.const 39))
                      (i32.eqz (byteset.get "\n\r" (local.get $c2))))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (local.set $hl (enum.get $Token.string))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (if (i32.and
                  (i32.eq (local.get $c2) (i32.const 34))
                  (i32.le_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2)))
              (then
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (local.get $rhs))
                (call $vhdlQuoted (i32.const 34) (enum.get $Token.number))
                (br $next)))
            (local.set $p
              (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
            (local.set $v
              (keyword-table.value $vhdlWords
                (i32.const $mem.lexLowerScratch)
                (i32.add (i32.const $mem.lexLowerScratch) (local.get $p))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (if (i32.ne (local.get $hl) (enum.get $Token.keyword))
                  (then (local.set $expect (i32.const 0))))
                (if (i32.shr_u (local.get $v) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $v) (i32.const 8))))))
              (else
                (local.set $hl (enum.get $Token.variable))
                (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                  (then (local.set $hl (enum.get $Token.constant))))
                (if (local.get $expect)
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.function.definition)
                        (enum.get $Token.type)
                        (i32.eq (local.get $expect) (i32.const 2))))
                    (if (i32.or
                          (i32.eq (local.get $expect) (i32.const 3))
                          (i32.eq (local.get $c2) (i32.const ".")))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else (local.set $expect (i32.const 0))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "#"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $scanIdentRun (i32.const "."))
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "#"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.eq (i32.or (call $templateByte (global.get $ptr)) (i32.const 32)) (i32.const "e"))
                      (then (call $lexScanNumberBody (i32.const 0))))))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const 34))
              (then (call $vhdlQuoted (i32.const 34) (enum.get $Token.number))))
            (local.set $expect (i32.const 0))
            (br $next)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "\"'(),.:;[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const "=")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (local.set $hl (enum.get $Token.operator))))
        ;; operators end before a comment opener: `a<=--`
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            (block $opDone
              (loop $op
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $v))))
                (local.set $p (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $opDone
                  (i32.or
                    (i32.and (i32.eq (local.get $v) (i32.const "-")) (i32.eq (local.get $p) (i32.const "-")))
                    (i32.and (i32.eq (local.get $v) (i32.const "/")) (i32.eq (local.get $p) (i32.const "*")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (if (i32.and
              (i32.ne (local.get $c) (i32.const "."))
              (i32.eqz (i32.and (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $expect) (i32.const 3)))))
          (then (local.set $expect (i32.const 0))))
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $hl) (enum.get $Token.punctuation.delimiter)))
          (then (local.set $expect (i32.const 1))))
        (br $next))))
)
