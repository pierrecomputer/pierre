(module
  (import "../common.wat")

  ;; Common built-ins only: other capitalized symbols are classified by
  ;; shape (a call or a `...Q` predicate is a function, the rest constants).
  (keyword-table $wolframWords $mem.wolframWords $mem.jsonnetWords
    (group $Token.keyword.control
      "If" "Which" "Switch" "Do" "For" "While" "Return" "Break" "Continue" "Throw" "Catch")
    (group $Token.keyword "Module" "Block" "With" "Function")
    (group $Token.keyword.import "BeginPackage" "EndPackage" "Begin" "End" "Needs" "Get")
    (group $Token.function
      "Table" "Map" "Apply" "Plot" "Solve" "Print" "Length" "Plus" "Times" "Select" "Range" "Join"
      "Total" "Sort" "Reverse" "Flatten" "First" "Last" "Max" "Min" "Simplify" "Sqrt" "Abs" "Sin"
      "Cos" "Exp" "Log")
    (group $Token.type.builtin "Integer" "Real" "String" "List" "Symbol" "Rational" "Complex" "Association")
    (group $Token.constant.builtin "Null" "None" "All" "Automatic" "Infinity" "Pi")
    (group $Token.boolean "True" "False"))

  ;; Advance $ptr over a symbol name: letters, digits, `$`, and UTF-8. A
  ;; `_` starts a pattern blank, so the name ends before it.
  (func $wlName
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (call $scanIdentRun (i32.const "$"))
    (global.set $ptr
      (call $scanFindSpecial (local.get $lhs) (global.get $ptr) (i32.const "_") (i32.const 0) (i32.const 0))))

  ;; Advance $ptr over digits with at most one point; `..` stays an operator.
  (func $wlDigits
    (local $c i32)
    (local $dot i32)
    (block $done
      (loop $l
        (local.set $c (call $templateByte (global.get $ptr)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eqz (local.get $dot)))
          (then
            (br_if $done (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ".")))
            (local.set $dot (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br_if $done (i32.eqz (call $lexIsDigit (local.get $c))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; Whether the bracket groups from `[` at $p close on this line before
  ;; `:=`, `=`, `^:=`, `^=`, or a `/;` condition: `f[x_] := ...` defines f.
  ;; A statement `;` inside the groups rules a definition out. Stopping
  ;; there keeps nested `f[0; f[0; ...]]` scans from repeating each other.
  (func $wlIsDefinition (param $p i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (loop $group
      (loop $scan
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (byteset.get "\n\r" (local.get $c))
          (then (return (i32.const 0))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ";"))
            (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 2))) (i32.const "/")))
          (then (return (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const "]"))
          (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
        (br_if $scan (local.get $depth)))
      ;; curried definitions: `f[x_][y_] := ...`
      (br_if $group (i32.eq (call $templateByte (local.get $p)) (i32.const "["))))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (local.set $c (call $templateByte (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "^"))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $c (call $templateByte (local.get $p)))))
    (local.set $depth (call $templateByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.eq (local.get $c) (i32.const ":"))
      (then (return (i32.eq (local.get $depth) (i32.const "=")))))
    ;; not `==`, `=!=`, or `=.`
    (if (i32.eq (local.get $c) (i32.const "="))
      (then
        (return
          (i32.and
            (i32.ne (local.get $depth) (i32.const "="))
            (i32.and (i32.ne (local.get $depth) (i32.const "!")) (i32.ne (local.get $depth) (i32.const ".")))))))
    (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $depth) (i32.const ";"))))

  (func $hlWolfram
    (local $c i32) (local $c2 i32) (local $lhs i32) (local $rhs i32) (local $gap i32) (local $p i32)
    (local $q i32) (local $kind i32) (local $hl i32) (local $call i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; a branch to $emit emits [$lhs,$ptr) as $hl
        (block $emit
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        ;; a `#!` script line at the document start
        (if
          (i32.and
            (i32.eq (local.get $lhs) (global.get $docStart))
            (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "!"))))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        ;; `(* ... *)` nests
        (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "(*") (i32.const "*)") (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (br $next)))
        ;; `2^^101`, `1.5*^10`, and precision marks `` 1.5`20 ``, ``` 3``10 ```
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $wlDigits)
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "^"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "^")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $scanIdentRun (i32.const "."))))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $wlDigits)))
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "*"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "^")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (local.set $c (call $templateByte (global.get $ptr)))
                (if (byteset.get "+-" (local.get $c))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $wlDigits)))
            (local.set $hl (enum.get $Token.number))
            (br $emit)))
        ;; `\[Alpha]` named characters
        (if (i32.and (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $c2) (i32.const "[")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $scanIdentRun (i32.const "$"))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "]"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $hl (enum.get $Token.string.special))
            (br $emit)))
        ;; pure-function slots `#`, `#2`, `##`, `#name`, and outputs `%`, `%%`, `%3`
        (if (i32.or (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c) (i32.const "%")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (local.get $c2) (local.get $c))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (call $scanIdentRun (local.get $c))
            (local.set $hl
              (select (enum.get $Token.variable.parameter) (enum.get $Token.variable.special) (i32.eq (local.get $c) (i32.const "#"))))
            (br $emit)))
        ;; pattern blanks `_`, `__`, `___`, `_.`, with an optional head: `_Integer`
        (if (i32.eq (local.get $c) (i32.const "_"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const "_"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "_"))
                  (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))))))
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                (i32.eqz (call $lexIsDigit (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.variable.parameter) (local.get $lhs) (global.get $ptr))
            (local.set $c (call $templateByte (global.get $ptr)))
            ;; a head starts with a letter, `$`, or a UTF-8 byte
            (if
              (i32.or
                (i32.ge_u (local.get $c) (i32.const 0x80))
                (i32.or
                  (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                  (i32.eq (local.get $c) (i32.const "$"))))
              (then
                (local.set $lhs (global.get $ptr))
                (call $wlName)
                (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        ;; symbols, with optional contexts: `` System`Plot ``, `` `Private`x ``;
        ;; after a leading backtick the next byte must start the name
        (if
          (call $lexIsIdentStart
            (select (local.get $c2) (local.get $c) (i32.eq (local.get $c) (i32.const "`"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "`"))))
            (local.set $p (local.get $lhs))
            (loop $context
              (call $wlName)
              (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))
                (then
                  (if (call $lexIsIdentStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                    (then
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (local.set $p (global.get $ptr))
                      (br $context))))))
            (if (i32.gt_u (local.get $p) (local.get $lhs))
              (then
                (call $emitTok (enum.get $Token.namespace) (local.get $lhs) (local.get $p))
                (local.set $lhs (local.get $p))))
            (local.set $rhs (global.get $ptr))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (local.set $hl (enum.get $Token.variable))
            (block $classified
              ;; a pattern name: `x_`, `x:{__}`
              (local.set $p (call $templateByte (i32.add (local.get $rhs) (i32.const 1))))
              (if
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "_"))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const ":"))
                    (i32.eqz (byteset.get ":=>" (local.get $p)))))
                (then
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (br $classified)))
              (if (i32.eq (local.get $c) (i32.const "$"))
                (then
                  (local.set $hl (enum.get $Token.variable.special))
                  (br $classified)))
              (local.set $kind (keyword-table.value $wolframWords (local.get $lhs) (local.get $rhs)))
              ;; `f[`, `f @ x`, `f /@ xs`, `f //@ x`; `xs[[1]]` is a part, not a call
              (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
              (local.set $c2 (call $templateByte (local.get $p)))
              (local.set $q (call $templateByte (i32.add (local.get $p) (i32.const 1))))
              (local.set $call
                (i32.or
                  (i32.or
                    (i32.and (i32.eq (local.get $c2) (i32.const "[")) (i32.ne (local.get $q) (i32.const "[")))
                    (i32.eq (local.get $c2) (i32.const "@")))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "/"))
                    (i32.or
                      (i32.eq (local.get $q) (i32.const "@"))
                      (i32.and
                        (i32.eq (local.get $q) (i32.const "/"))
                        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "@")))))))
              (if (i32.ge_s (local.get $kind) (i32.const 0))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function)
                      (local.get $kind)
                      (i32.and (local.get $call) (i32.eq (local.get $kind) (enum.get $Token.type.builtin)))))
                  (br $classified)))
              ;; $q: just past the last byte before the name and its blanks
              (local.set $q (local.get $lhs))
              (block $back
                (loop $blank
                  (br_if $back (i32.le_u (local.get $q) (global.get $srcBase)))
                  (local.set $kind (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))
                  (br_if $back (i32.eqz (byteset.get " \t" (local.get $kind))))
                  (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                  (br $blank)))
              ;; postfix application: `x // f`
              (if (i32.eqz (local.get $call))
                (then
                  (local.set $call
                    (i32.and
                      (i32.ge_u (local.get $q) (i32.add (global.get $srcBase) (i32.const 2)))
                      (i32.eq (i32.load16_u (i32.sub (local.get $q) (i32.const 2))) (i32.const "//"))))))
              (if (local.get $call)
                (then
                  (local.set $hl (enum.get $Token.function))
                  ;; a definition starts a line or follows a statement `;`,
                  ;; not the `/;` of a condition
                  (if (i32.eq (local.get $c2) (i32.const "["))
                    (then
                      (local.set $kind (i32.const 10))
                      (if (i32.gt_u (local.get $q) (global.get $srcBase))
                        (then (local.set $kind (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))))
                      (if
                        (i32.or
                          (byteset.get "\n\r" (local.get $kind))
                          (i32.and
                            (i32.eq (local.get $kind) (i32.const ";"))
                            (i32.or
                              (i32.lt_u (local.get $q) (i32.add (global.get $srcBase) (i32.const 2)))
                              (i32.ne (i32.load8_u (i32.sub (local.get $q) (i32.const 2))) (i32.const "/")))))
                        (then
                          (if (call $wlIsDefinition (local.get $p))
                            (then (local.set $hl (enum.get $Token.function.definition))))))))
                  (br $classified)))
              (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function)
                      (enum.get $Token.constant)
                      (i32.and
                        (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                        (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "Q"))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        ;; `;` separates; `;;` is a span
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.eq (local.get $c2) (i32.const ";"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.operator))))))
        (if (byteset.get "!&'*+-./:<=>?@^|~" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            ;; `<|` and `|>` delimit associations
            (if
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "|")))
                (i32.and (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c2) (i32.const ">"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.punctuation.bracket)))
              (else
                (block $opDone
                  (loop $op
                    (br_if $opDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (local.set $c2 (i32.load8_u (global.get $ptr)))
                    (br_if $opDone (i32.eqz (byteset.get "!&'*+-./:<=>?@^|~" (local.get $c2))))
                    (br_if $opDone
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const "|"))
                        (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">"))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))
                ;; `/;` attaches a condition
                (if
                  (i32.and
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "/"))
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const ";")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                ;; message names: `f::usage`
                (if
                  (i32.and
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
                    (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "::")))
                  (then
                    (if (call $lexIsIdentStart (call $templateByte (global.get $ptr)))
                      (then
                        (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                        (local.set $lhs (global.get $ptr))
                        (call $wlName)
                        (local.set $hl (enum.get $Token.property))))))))))
        (if (i32.eq (local.get $hl) (enum.get $Token.none))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (br $emit))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
