(module
  (import "../common.wat")

  (func $erlByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $erlWordHl below. Groups 1-5 are
  ;; reserved words and well-known atoms; groups 6-10 are module attribute
  ;; names, looked up only after the `-` that starts a form, where the
  ;; group also says what the name after it is.
  (keyword-table $erlangWords $mem.erlangWords $mem.erlangWords+512
    (group $Token.keyword.control ;; 1: control
      "after" "begin" "case" "catch" "cond" "end" "if" "of" "receive" "try"
      "maybe" "else")
    (group $Token.keyword "fun") ;; 2: anonymous function
    (group $Token.keyword.operator ;; 3: word operators
      "and" "andalso" "band" "bnot" "bor" "bsl" "bsr" "bxor" "div" "not"
      "or" "orelse" "rem" "xor" "when")
    (group $Token.boolean "true" "false")                    ;; 4: booleans
    (group $Token.constant.builtin "undefined")                       ;; 5: built-in constant
    (group -1 "include" "include_lib" "import")  ;; 6: import attributes
    (group -1 "module")                          ;; 7: next name is the module
    (group -1 "record" "type" "opaque")          ;; 8: next name is a type
    (group -1 "define")                          ;; 9: next name is a macro
    (group -1 "spec" "callback"))                ;; 10: next name is a function

  ;; The token for a bare atom that is a reserved word or a well-known
  ;; constant, or -1 for an ordinary atom.
  (func $erlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $erlangWords (local.get $lhs) (local.get $rhs)))

  ;; A numeric literal from $ptr: the shared scan, then a `base#digits`
  ;; radix body such as `16#FF` or `2#1010`.
  (func $erlScanNumber
    (call $lexScanNumber)
    (if (i32.and
          (i32.eq (call $erlByte (global.get $ptr)) (i32.const "#"))
          (call $lexIsIdentContinue (call $erlByte (i32.add (global.get $ptr) (i32.const 1)))))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $scanIdentRun (i32.const "_")))))

  (func $erlIsOp (param $c i32) (result i32)
    (byteset.get "!*+-/<=>|" (local.get $c)))

  ;; $col0 is 1 while the next token would start in column zero, where an
  ;; atom before `(` heads a function clause and a `-` opens a module
  ;; attribute. $attr names the capture of the next atom after such an
  ;; attribute or a `#` record prefix: 1 module, 2 type, 3 function,
  ;; 4 macro. Both are checkpointed.
  (func $hlErlang
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $g i32) (local $hl i32) (local $col0 i32) (local $atCol0 i32) (local $attr i32)
    (local.set $col0 (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a gap that ends with a line break puts the next token in column zero
        (if (i32.gt_u (global.get $ptr) (local.get $gap))
          (then
            (local.set $c (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
            (local.set $col0 (i32.or
              (i32.eq (local.get $c) (i32.const 10))
              (i32.eq (local.get $c) (i32.const 13))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $atCol0 (local.get $col0))
        (local.set $col0 (i32.const 0))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $erlByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $erlByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        ;; strings may span lines; quoted atoms may not
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $attr (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string.special.symbol))
            (local.set $attr (i32.const 0))
            (br $next)))
        ;; `$c` and `$\n` character literals
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.gt_u (local.get $c2) (i32.const 32)))
          (then
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then (global.set $ptr (call $lexEscapeEnd (i32.add (global.get $ptr) (i32.const 1)))))
              (else (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `?MACRO` and `??Stringify`
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.or
                (call $lexIsIdentStart (local.get $c2))
                (i32.and (i32.eq (local.get $c2) (i32.const "?")) (call $lexIsIdentStart (local.get $c3)))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const "?"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $scanIdentRun (i32.const "@"))
            (call $emitTok (enum.get $Token.constant) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `#name{}` records, `#{}` maps
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (if (call $lexIsIdentStart (local.get $c2))
              (then (local.set $attr (i32.const 2))))
            (br $next)))
        ;; `-module(...)` and other attributes open a form in column zero
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.and
                (local.get $atCol0)
                (i32.le_u (i32.sub (local.get $c2) (i32.const "a")) (i32.const 25))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (local.set $g (keyword-table.get $erlangWords (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr)))
            (call $emitTok
              (select (enum.get $Token.keyword.import) (enum.get $Token.keyword)
                (i32.eq (local.get $g) (i32.const 6)))
              (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 0))
            (if (i32.eq (local.get $g) (i32.const 7)) (then (local.set $attr (i32.const 1))))
            (if (i32.eq (local.get $g) (i32.const 8)) (then (local.set $attr (i32.const 2))))
            (if (i32.eq (local.get $g) (i32.const 9)) (then (local.set $attr (i32.const 4))))
            (if (i32.eq (local.get $g) (i32.const 10)) (then (local.set $attr (i32.const 3))))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "@"))
            (local.set $rhs (global.get $ptr))
            ;; variables start with an uppercase letter or an underscore
            (if (i32.or
                  (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                  (i32.eq (local.get $c) (i32.const "_")))
              (then
                (call $emitTok
                  (select (enum.get $Token.constant) (enum.get $Token.variable)
                    (i32.eq (local.get $attr) (i32.const 4)))
                  (local.get $lhs) (local.get $rhs))
                (local.set $attr (i32.const 0))
                (br $next)))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (if (local.get $attr)
              (then
                (local.set $hl (enum.get $Token.namespace))
                (if (i32.eq (local.get $attr) (i32.const 2))
                  (then (local.set $hl (enum.get $Token.type))))
                (if (i32.eq (local.get $attr) (i32.const 3))
                  (then (local.set $hl (enum.get $Token.function))))
                (if (i32.eq (local.get $attr) (i32.const 4))
                  (then (local.set $hl (enum.get $Token.constant))))
                (local.set $attr (i32.const 0)))
              (else
                (local.set $hl (call $erlWordHl (local.get $lhs) (local.get $rhs)))
                (if (i32.lt_s (local.get $hl) (i32.const 0))
                  (then
                    (local.set $hl (enum.get $Token.string.special.symbol))
                    ;; `name(` calls, `name/2` references, `mod:` qualifiers
                    (if (i32.eq (call $erlByte (local.get $p)) (i32.const "("))
                      (then (local.set $hl (select
                        (enum.get $Token.function.definition) (enum.get $Token.function)
                        (local.get $atCol0))))
                      (else
                        (if (i32.and
                              (i32.eq (call $erlByte (local.get $rhs)) (i32.const "/"))
                              (call $lexIsDigit (call $erlByte (i32.add (local.get $rhs) (i32.const 1)))))
                          (then (local.set $hl (enum.get $Token.function)))
                          (else
                            (if (i32.and
                                  (i32.eq (call $erlByte (local.get $rhs)) (i32.const ":"))
                                  (i32.or
                                    (i32.eq (call $erlByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const 39))
                                    (i32.and
                                      (call $lexIsIdentStart (call $erlByte (i32.add (local.get $rhs) (i32.const 1))))
                                      (i32.ne (call $erlByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const "$")))))
                              (then (local.set $hl (enum.get $Token.namespace))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (call $erlScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; `<<` and `>>` delimit binaries
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
              (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c2) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; the `(` of `-module(name)` keeps the pending name
            (if (i32.ne (local.get $c) (i32.const "("))
              (then (local.set $attr (i32.const 0))))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.ne (local.get $c2) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const ":"))) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (call $erlIsOp (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
          (then
            (block $opDone
              (loop $op
                ;; `:` joins a run such as `=:=`; a run never starts with it
                (br_if $opDone (i32.eqz (i32.or
                  (call $erlIsOp (call $erlByte (global.get $ptr)))
                  (i32.or
                    (i32.eq (call $erlByte (global.get $ptr)) (i32.const "."))
                    (i32.eq (call $erlByte (global.get $ptr)) (i32.const ":"))))))
                ;; a binary delimiter ends the run
                (br_if $opDone (i32.and
                  (i32.gt_u (global.get $ptr) (local.get $lhs))
                  (i32.or
                    (i32.eq (i32.and (i32.load16_u (global.get $ptr)) (i32.const 0xffff)) (i32.const "<<"))
                    (i32.eq (i32.and (i32.load16_u (global.get $ptr)) (i32.const 0xffff)) (i32.const ">>")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
