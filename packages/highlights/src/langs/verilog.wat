(module
  (import "../common.wat")

  ;; High byte: capture the next name as 1 a type, 2 a function or task.
  ;; `inout`, `endgenerate`, `coverpoint`, and `priority` collide and are
  ;; matched in $verilogWord.
  (keyword-table $verilogWords $mem.verilogWords $mem.vhdlWords
    (group $Token.keyword.control
      "if" "else" "case" "casez" "casex" "endcase" "for" "while" "repeat" "forever" "do"
      "foreach" "return" "break" "continue" "default" "wait" "fork" "join" "join_any"
      "join_none" "disable" "unique")
    (group $Token.keyword.declaration+256
      "module" "macromodule" "interface" "package" "program" "class" "extends"
      "implements")
    (group $Token.keyword.declaration+512 "function" "task")
    (group $Token.keyword.declaration
      "endmodule" "endinterface" "endpackage" "endprogram" "endclass" "endfunction" "endtask"
      "typedef" "enum" "struct" "union" "packed" "modport" "clocking"
      "endclocking" "property" "endproperty" "sequence" "endsequence" "covergroup" "endgroup"
      "bins" "constraint" "generate" "genvar" "parameter" "localparam" "defparam" "virtual"
      "automatic" "static" "const" "extern" "local" "protected" "pure" "rand" "randc" "input"
      "output" "ref")
    (group $Token.keyword.import "import" "export")
    (group $Token.keyword
      "begin" "end" "assign" "deassign" "force" "release" "always" "always_ff" "always_comb"
      "always_latch" "initial" "final" "posedge" "negedge" "edge" "iff" "inside" "dist" "with"
      "new" "assert" "assume" "cover" "type" "var" "let" "soft" "solve" "before" "tagged"
      "throughout" "within" "or" "and" "not")
    (group $Token.type.builtin
      "wire" "reg" "logic" "bit" "byte" "shortint" "int" "longint" "integer" "real" "realtime"
      "shortreal" "time" "string" "chandle" "event" "void" "tri" "wand" "wor" "supply0"
      "supply1" "signed" "unsigned" "uwire")
    (group $Token.constant.builtin "null")
    (group $Token.variable.special "this" "super"))

  (func $verilogWord (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.and
          (i32.eq (local.get $n) (i32.const 5))
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "inout")))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.and
          (i32.eq (local.get $n) (i32.const 11))
          (i32.and
            (i64.eq (i64.load (local.get $lhs)) (i64.const "endgener"))
            (i64.eq (i64.load (i32.sub (local.get $rhs) (i32.const 8))) (i64.const "generate"))))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.and
          (i32.eq (local.get $n) (i32.const 10))
          (i32.and
            (i64.eq (i64.load (local.get $lhs)) (i64.const "coverpoi"))
            (i64.eq (i64.load (i32.sub (local.get $rhs) (i32.const 8))) (i64.const "verpoint"))))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.and
          (i32.eq (local.get $n) (i32.const 8))
          (i64.eq (i64.load (local.get $lhs)) (i64.const "priority")))
      (then (return (enum.get $Token.keyword.control))))
    (keyword-table.value $verilogWords (local.get $lhs) (local.get $rhs)))

  ;; Whether a user type name follows at $p, as in `state_t next`.
  (func $verilogNameFollows (param $p i32) (result i32)
    (local $c i32)
    (local $save i32)
    (local $rhs i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (local.set $c (call $templateByte (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "#"))
      (then
        (return (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "(")))))
    (if (i32.or (i32.eqz (call $lexIsIdentStart (local.get $c))) (i32.eq (local.get $c) (i32.const "$")))
      (then (return (i32.const 0))))
    (local.set $save (global.get $ptr))
    (global.set $ptr (local.get $p))
    (call $lexScanIdent)
    (local.set $rhs (global.get $ptr))
    (global.set $ptr (local.get $save))
    (i32.lt_s (call $verilogWord (local.get $p) (local.get $rhs)) (i32.const 0)))

  ;; $expect: the pending capture. $strCont: the quote of a string open at an
  ;; escaped line break.
  (func $hlVerilog
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $expect i32)
    (local $strCont i32)
    (call $lexEmitLeadingContinuation)
    (local.set $strCont (call $lexCStringResume (local.get $strCont)))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $strCont (call $lexCString (enum.get $Token.string)))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const 92))
              (i32.and (i32.ne (local.get $c2) (i32.const 0)) (i32.eqz (call $lexIsSpace (local.get $c2)))))
          (then
            (block $escDone
              (loop $esc
                (br_if $escDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $escDone (call $lexIsSpace (i32.load8_u (global.get $ptr))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $esc)))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (local.set $v (call $verilogWord (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (if (i32.shr_u (local.get $v) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $v) (i32.const 8))))))
              (else
                (local.set $p (i32.const 0))
                (if (i32.gt_u (local.get $lhs) (global.get $srcBase))
                  (then (local.set $p (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
                (local.set $hl (enum.get $Token.function))
                (if (i32.ne (local.get $c2) (i32.const "("))
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.constant)
                        (enum.get $Token.variable)
                        (call $lexIsConstCase (local.get $lhs) (local.get $rhs))))
                    (if (call $verilogNameFollows (local.get $rhs))
                      (then (local.set $hl (enum.get $Token.type))))))
                (if (i32.and
                      (i32.eq (local.get $c2) (i32.const ":"))
                      (i32.eq (call $templateByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":")))
                  (then (local.set $hl (enum.get $Token.namespace))))
                ;; a method when a name or `)` precedes the dot
                (if (i32.eq (local.get $p) (i32.const "."))
                  (then
                    (local.set $p (call $lexLineByteBefore (i32.sub (local.get $lhs) (i32.const 1))))
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.and
                          (i32.eq (local.get $c2) (i32.const "("))
                          (i32.or
                            (call $lexIsIdentContinue (local.get $p))
                            (i32.eq (local.get $p) (i32.const ")"))))))))
                (if (i32.eq (local.get $expect) (i32.const 2))
                  (then
                    (local.set $p (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
                    (if (i32.or (i32.eq (local.get $p) (i32.const "(")) (i32.eq (local.get $p) (i32.const ";")))
                      (then
                        (local.set $hl (enum.get $Token.function.definition))
                        (local.set $expect (i32.const 0))))))
                (if (i32.eq (local.get $expect) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.type))
                    (local.set $expect (i32.const 0))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        ;; a tick that starts no number is a cast or pattern
        (if (i32.or (call $lexIsDigit (local.get $c)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $hl (enum.get $Token.number))
            ;; $p is just past the tick, or 0 without one
            (local.set $p (global.get $ptr))
            (if (i32.ne (local.get $c) (i32.const 39))
              (then
                (global.set $ptr (local.get $lhs))
                (call $lexScanNumber)
                (local.set $p
                  (select
                    (i32.add (global.get $ptr) (i32.const 1))
                    (i32.const 0)
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const 39))))))
            (if (local.get $p)
              (then
                (local.set $c2 (call $templateByte (local.get $p)))
                (if (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "s"))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (local.set $c2 (call $templateByte (local.get $p)))))
                (local.set $v (i32.or (local.get $c2) (i32.const 32)))
                (if (i32.or
                      (i32.or (i32.eq (local.get $v) (i32.const "b")) (i32.eq (local.get $v) (i32.const "o")))
                      (i32.or (i32.eq (local.get $v) (i32.const "d")) (i32.eq (local.get $v) (i32.const "h"))))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $scanIdentRun (i32.const "?")))
                  (else
                    (if (i32.eq (local.get $c) (i32.const 39))
                      (then
                        (local.set $hl (enum.get $Token.operator))
                        (if (i32.and
                              (i32.or
                                (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 1))
                                (i32.or (i32.eq (local.get $v) (i32.const "x")) (i32.eq (local.get $v) (i32.const "z"))))
                              (i32.eqz
                                (call $lexIsIdentContinue
                                  (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))))
                          (then
                            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                            (local.set $hl (enum.get $Token.number))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "\"'(),.:;[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $expect (i32.const 0))))))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then (local.set $expect (i32.const 0))))
        (if (i32.or
              (i32.ne (local.get $c) (i32.const ":"))
              (i32.or
                (i32.eq (local.get $c2) (i32.const ":"))
                (i32.or (i32.eq (local.get $c2) (i32.const "=")) (i32.eq (local.get $c2) (i32.const "/")))))
          (then
            (if (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c))
              (then
                (local.set $hl (enum.get $Token.operator))
                ;; the run ends before a comment opener
                (block $opDone
                  (loop $op
                    (local.set $v (call $templateByte (global.get $ptr)))
                    (br_if $opDone (i32.eqz (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $v))))
                    (local.set $p (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                    (br_if $opDone
                      (i32.and
                        (i32.eq (local.get $v) (i32.const "/"))
                        (i32.or (i32.eq (local.get $p) (i32.const "/")) (i32.eq (local.get $p) (i32.const "*")))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
