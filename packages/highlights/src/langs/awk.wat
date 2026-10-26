(module
  (import "../common.wat")

  ;; Bit 8: an operand follows, so `/` opens a regex. Bit 9: `function`.
  (keyword-table $awkWords $mem.awkWords $mem.gherkinWords
    (group $Token.keyword.control+256
      "if" "else" "while" "for" "do" "return" "exit" "switch" "case" "default")
    (group $Token.keyword.control "break" "continue" "next" "nextfile")
    (group $Token.keyword.declaration+512 "function" "func")
    (group $Token.keyword "BEGIN" "END" "BEGINFILE" "ENDFILE")
    (group $Token.keyword+256 "getline" "print" "printf" "delete")
    (group $Token.keyword.operator+256 "in")
    (group $Token.variable.special
      "NR" "NF" "FS" "OFS" "RS" "ORS" "FNR" "FILENAME" "SUBSEP" "RSTART" "RLENGTH" "ENVIRON"
      "ARGV" "ARGC" "CONVFMT" "OFMT" "RT" "IGNORECASE" "PROCINFO")
    (group $Token.function "length"))

  ;; A `[...]` bracket expression may hold a slash.
  (func $awkRegex
    (local $lhs i32)
    (local $c i32)
    (local $class i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (byteset.get "\n\r" (local.get $c)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $c (call $templateByte (global.get $ptr)))
            (if (i32.eqz (byteset.get "\n\r" (local.get $c)))
              (then
                (global.set $ptr
                  (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then (local.set $class (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "]"))
          (then (local.set $class (i32.const 0))))
        (br_if $done (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eqz (local.get $class))))
        (br $l)))
    (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr)))

  ;; $div: 1 where `/` divides, 0 where it opens a regex. $fn: 1 after
  ;; `function`, 2 after its name, 3 in its parameters.
  (func $hlAwk
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $v i32)
    (local $hl i32)
    (local $div i32)
    (local $fn i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break ends the statement, so a pattern or regex may follow
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $div (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (local.set $div (i32.const 1))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eqz (local.get $div)))
          (then
            (call $awkRegex)
            (local.set $div (i32.const 1))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $div (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
            (call $emitTok
              (select (enum.get $Token.variable.special) (enum.get $Token.operator) (local.get $div))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "@"))
              (call $lexIsIdentStart (call $templateByte (global.get $ptr))))
          (then
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $v (keyword-table.value $awkWords (local.get $lhs) (global.get $ptr)))
            (local.set $div (i32.const 1))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (local.set $div (i32.eqz (i32.and (local.get $v) (i32.const 256))))
                (if (i32.and (local.get $v) (i32.const 512))
                  (then (local.set $fn (i32.const 1)))))
              (else
                (local.set $hl
                  (select
                    (enum.get $Token.function)
                    (enum.get $Token.variable)
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "("))))
                (if (i32.eq (local.get $fn) (i32.const 3))
                  (then (local.set $hl (enum.get $Token.variable.parameter))))
                (if (i32.eq (local.get $fn) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (local.set $fn (i32.const 2))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (call $lexIsDigit (call $templateByte (global.get $ptr)))))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $div (i32.const 1))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $div (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "]"))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $fn) (i32.const 2)))
              (then (local.set $fn (i32.const 3))))
            (if (i32.or
                  (i32.eq (local.get $c) (i32.const "{"))
                  (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $fn) (i32.const 3))))
              (then (local.set $fn (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $div (i32.const 0))
            (br $next)))
        (if (byteset.get "!%&*+-/:<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eq (local.get $v) (i32.const "/")))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/:<=>?^|~" (local.get $v))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            ;; `++` and `--` follow their operand
            (local.set $div
              (i32.and
                (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
                (i32.and
                  (i32.eq (i32.load8_u offset=1 (local.get $lhs)) (local.get $c))
                  (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-"))))))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
