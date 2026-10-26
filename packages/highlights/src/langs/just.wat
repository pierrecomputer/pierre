(module
  (import "../common.wat")

  ;; Values above 255 mark the keywords that start a line; their high byte
  ;; names what the next name is (see $justExpectHl).
  (keyword-table $justWords $mem.justWords $mem.puppetWords
    (group $Token.keyword+768 "set")
    (group $Token.keyword.declaration+256 "export" "unexport")
    (group $Token.keyword.declaration+512 "alias")
    (group $Token.keyword.import+1024 "mod")
    (group $Token.keyword.import+256 "import")
    (group $Token.keyword.control "if" "else")
    (group $Token.boolean "true" "false"))

  ;; The token of the name a line-start keyword awaits: 1 a variable, 2 an
  ;; alias, 3 a setting, 4 a module, 5 the recipe an alias names.
  (func $justExpectHl (param $e i32) (result i32)
    (if (i32.eq (local.get $e) (i32.const 2))
      (then (return (enum.get $Token.function.definition))))
    (if (i32.eq (local.get $e) (i32.const 3))
      (then (return (enum.get $Token.property))))
    (if (i32.eq (local.get $e) (i32.const 4))
      (then (return (enum.get $Token.namespace))))
    (select (enum.get $Token.function) (enum.get $Token.variable) (i32.eq (local.get $e) (i32.const 5))))

  ;; Scan an expression string from $ptr to its closing delimiter or $end.
  ;; $kind is the quote byte, plus 256 for `'''`, `"""`, or ``` strings.
  ;; Double quotes take escapes such as `\n` and `\u{1F600}`; backticks run
  ;; a command. Returns 1 after the closing delimiter.
  (func $justStringBody (param $kind i32) (result i32)
    (local $q i32)
    (local $hl i32)
    (local $seg i32)
    (local $e i32)
    (local.set $q (i32.and (local.get $kind) (i32.const 255)))
    (local.set $hl
      (select (enum.get $Token.string.special) (enum.get $Token.string) (i32.eq (local.get $q) (i32.const "`"))))
    (local.set $seg (global.get $ptr))
    (block $done
      (loop $l
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $q)
            (i32.eq (local.get $q) (i32.const 34))
            (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 92))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (if
              (i32.and
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "u"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "{")))
              (then
                (local.set $e (call $scanHexRun (i32.add (global.get $ptr) (i32.const 3)) (i32.const 6)))
                (if (i32.eq (call $templateByte (local.get $e)) (i32.const "}"))
                  (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $l)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.ge_u (local.get $kind) (i32.const 256))
          (then
            (br_if $l (i32.ne (call $templateByte (global.get $ptr)) (local.get $q)))
            (br_if $l
              (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $q)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (return (i32.const 1))))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; Scan a quoted shell word of a recipe line from $ptr; $seg is the first
  ;; byte not yet emitted. It ends at its quote or the line break. Returns 1
  ;; after emitting a `{{` that opens an interpolation inside it, 0 otherwise.
  ;; The quote/break search is kept until $ptr passes it, so `{` hops do
  ;; not rescan the line.
  (func $justBodyString (param $q i32) (param $seg i32) (result i32)
    (local $stop i32)
    (local $p i32)
    (local.set $stop (global.get $ptr))
    (block $done
      (loop $l
        (if (i32.le_u (local.get $stop) (global.get $ptr))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (local.get $q)
                (i32.eq (local.get $q) (i32.const 34))
                (i32.const 1)))))
        (local.set $p
          (call $scanFindSpecial (global.get $ptr) (local.get $stop) (i32.const "{") (i32.const 0) (i32.const 0)))
        (if (i32.lt_u (local.get $p) (local.get $stop))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (br_if $l (i32.ne (call $templateByte (global.get $ptr)) (i32.const "{")))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (local.set $seg (global.get $ptr))
            ;; `{{{{` writes a literal `{{`
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "{"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{")))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 4)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (br $l)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (return (i32.const 1))))
        (global.set $ptr (local.get $stop))
        (br_if $done (i32.ge_u (local.get $stop) (global.get $end)))
        (local.set $p (i32.load8_u (local.get $stop)))
        (if (i32.eq (local.get $p) (local.get $q))
          (then
            (global.set $ptr (i32.add (local.get $stop) (i32.const 1)))
            (br $done)))
        (br_if $done (i32.ne (local.get $p) (i32.const 92)))
        ;; a backslash escapes the next byte, but never the line break
        (global.set $ptr (i32.add (local.get $stop) (i32.const 1)))
        (local.set $p (call $templateByte (global.get $ptr)))
        (br_if $l (byteset.get "\n\r" (local.get $p)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $stop))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $stop) (i32.const 2)) (global.get $end)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $stop) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; A justfile is line-oriented. The first token of an unindented line
  ;; ($lineHead) classifies it: a recipe header (mode 2, then 3 for its
  ;; dependencies after `:`), an assignment or setting (mode 0, an
  ;; expression), or an attribute (mode 4). Indented lines under a recipe
  ;; are its body (mode 1): shell text with `{{ }}` interpolations, where
  ;; $interp is 1, or the quote of the body string the `{{` opened in.
  ;; $cmdHead marks a body command name. $depth counts open brackets, so an
  ;; indented line inside them continues the expression. $expect is the name
  ;; a line-start keyword awaits (see $justExpectHl). $str is a string that
  ;; continues on the next line (see $justStringBody).
  (func $hlJust
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $lineHead i32)
    (local $inRecipe i32)
    (local $mode i32)
    (local $depth i32)
    (local $interp i32)
    (local $cmdHead i32)
    (local $expect i32)
    (local $str i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $str)
          (then
            (if (call $justStringBody (local.get $str))
              (then (local.set $str (i32.const 0))))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            (local.set $interp (i32.const 0))
            (local.set $expect (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if (local.get $lineHead)
          (then
            (local.set $lineHead (i32.const 0))
            (local.set $v (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))
            (if
              (i32.and (i32.gt_u (local.get $lhs) (global.get $srcBase)) (byteset.get " \t" (local.get $v)))
              (then
                ;; an indented line: a recipe body line, or more of an
                ;; expression inside brackets
                (if
                  (i32.and
                    (local.get $inRecipe)
                    (i32.or (i32.eqz (local.get $depth)) (i32.eq (local.get $mode) (i32.const 1))))
                  (then
                    (local.set $mode (i32.const 1))
                    (local.set $cmdHead (i32.const 1))
                    (local.set $depth (i32.const 0)))
                  (else
                    (if (i32.eqz (local.get $depth))
                      (then (local.set $mode (i32.const 0)))))))
              (else
                (local.set $inRecipe (i32.const 0))
                (local.set $depth (i32.const 0))
                (local.set $mode (select (i32.const 4) (i32.const 0) (i32.eq (local.get $c) (i32.const "["))))
                ;; `@` before a recipe name makes it quiet
                (if (i32.eq (local.get $c) (i32.const "@"))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                    (local.set $lineHead (i32.const 1))
                    (br $next)))
                (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
                  (then
                    (call $scanIdentRun (i32.const "-"))
                    (local.set $rhs (global.get $ptr))
                    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                    (local.set $c2 (call $templateByte (local.get $p)))
                    (local.set $hl (enum.get $Token.variable))
                    (block $classified
                      ;; `name :=` assigns
                      (br_if $classified
                        (i32.and
                          (i32.eq (local.get $c2) (i32.const ":"))
                          (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "="))))
                      ;; `set x`, `export x :=`, `import 'f'`; before a `:` the
                      ;; same word names a recipe
                      (if (i32.ne (local.get $c2) (i32.const ":"))
                        (then
                          (local.set $v (keyword-table.value $justWords (local.get $lhs) (local.get $rhs)))
                          (if (i32.ge_s (local.get $v) (i32.const 256))
                            (then
                              (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                              (local.set $expect (i32.shr_u (local.get $v) (i32.const 8)))
                              (br $classified)))))
                      (local.set $hl (enum.get $Token.function.definition))
                      (local.set $mode (i32.const 2))
                      (local.set $inRecipe (i32.const 1)))
                    (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                    (br $next)))))))

        ;; a recipe body line is shell text
        (if (i32.and (i32.eq (local.get $mode) (i32.const 1)) (i32.eqz (local.get $interp)))
          (then
            (if (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const "{")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.punctuation.special))
                (local.set $interp (i32.const 1))
                (local.set $depth (i32.const 0))
                ;; `{{{{` writes a literal `{{`
                (if
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "{"))
                    (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{")))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 4)))
                    (local.set $hl (enum.get $Token.string.escape))
                    (local.set $interp (i32.const 0))))
                (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                (local.set $cmdHead (i32.const 0))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "#"))
                (i32.or
                  (local.get $cmdHead)
                  (call $lexIsSpace (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (br $next)))
            ;; `@` quiets a line and `-` ignores its failure
            (if
              (i32.and
                (local.get $cmdHead)
                (i32.or (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c) (i32.const "-"))))
              (then
                (loop $prefix
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $v (call $templateByte (global.get $ptr)))
                  (br_if $prefix
                    (i32.or (i32.eq (local.get $v) (i32.const "@")) (i32.eq (local.get $v) (i32.const "-")))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $p (local.get $cmdHead))
            (local.set $cmdHead (i32.const 0))
            (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (local.set $interp
                  (select (local.get $c) (i32.const 0) (call $justBodyString (local.get $c) (local.get $lhs))))
                (br $next)))
            ;; `$NAME` and `${NAME}` are shell variables; in `${{x}}` the
            ;; `{{` interpolates first
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (if (i32.eq (local.get $c2) (i32.const "{"))
                  (then
                    (if (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "{"))
                      (then
                        (global.set $ptr
                          (call $scanFind3 (global.get $ptr) (i32.const "}") (i32.const 10) (i32.const 13)))
                        (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}"))
                          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))))
                  (else (call $scanIdentRun (i32.const "_"))))
                (call $emitTok
                  (select
                    (enum.get $Token.variable)
                    (enum.get $Token.none)
                    (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))
            (if (byteset.get "&;<>|" (local.get $c))
              (then
                (loop $op
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $v (call $templateByte (global.get $ptr)))
                  (br_if $op (byteset.get "&;<>|" (local.get $v))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                ;; `;`, pipes, `&&`, and `&` start a command; redirections do not
                (local.set $v (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
                (local.set $cmdHead
                  (i32.or
                    (i32.eq (local.get $c) (i32.const ";"))
                    (i32.or
                      (i32.eq (local.get $v) (i32.const "|"))
                      (i32.and (i32.eq (local.get $v) (i32.const "&")) (i32.eq (local.get $c) (i32.const "&"))))))
                (br $next)))
            ;; a word up to a blank, quote, `$`, operator, or bracket; the first
            ;; byte always belongs to it, so a lone `{` or `(` is text
            (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
            (block $wordDone
              (loop $word
                (call $scanIdentRun (i32.const "-"))
                (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $v (i32.load8_u (global.get $ptr)))
                (br_if $wordDone (byteset.get "\09\0a\0b\0c\0d \22$&'()\5c;<>[]{}|" (local.get $v)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $word)))
            (call $emitTok
              (select (enum.get $Token.function) (enum.get $Token.none) (local.get $p))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        ;; expressions: assignments, settings, recipe headers, attributes,
        ;; and interpolations
        (if
          (i32.and
            (i32.and (i32.ne (local.get $interp) (i32.const 0)) (i32.eqz (local.get $depth)))
            (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.eq (local.get $c2) (i32.const "}"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            ;; a body string the `{{` interrupted goes on
            (if (i32.gt_u (local.get $interp) (i32.const 1))
              (then
                (local.set $interp
                  (select
                    (local.get $interp)
                    (i32.const 0)
                    (call $justBodyString (local.get $interp) (global.get $ptr)))))
              (else (local.set $interp (i32.const 0))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eqz (local.get $interp)))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (i32.eq (local.get $c) (i32.const "`")))
          (then
            (local.set $v (local.get $c))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (local.get $c2) (local.get $c))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (local.get $c)))
              (then
                (local.set $v (i32.or (local.get $c) (i32.const 256)))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))))
            (call $emitTok
              (select
                (enum.get $Token.string.special)
                (enum.get $Token.string)
                (i32.eq (local.get $c) (i32.const "`")))
              (local.get $lhs)
              (global.get $ptr))
            (if (i32.eqz (call $justStringBody (local.get $v)))
              (then (local.set $str (local.get $v))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.eq (local.get $c2) (i32.const "="))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.operator)))
              (else
                (if (i32.eq (local.get $mode) (i32.const 2))
                  (then (local.set $mode (i32.const 3))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (byteset.get "([{" (local.get $c))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
              (else
                (if (local.get $depth)
                  (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "-"))
            (local.set $rhs (global.get $ptr))
            (local.set $v (call $templateByte (local.get $rhs)))
            ;; `x'...'` and `f"..."` prefix a string
            (if
              (i32.and
                (i32.and
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                  (i32.or (i32.eq (local.get $c) (i32.const "x")) (i32.eq (local.get $c) (i32.const "f"))))
                (i32.or (i32.eq (local.get $v) (i32.const 34)) (i32.eq (local.get $v) (i32.const 39))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (br $next)))
            (block $classified
              (if (local.get $expect)
                (then
                  (local.set $hl (call $justExpectHl (local.get $expect)))
                  (local.set $expect (select (i32.const 5) (i32.const 0) (i32.eq (local.get $expect) (i32.const 2))))
                  (br $classified)))
              ;; recipe parameters, and a variable as a default after `=`
              (if (i32.eq (local.get $mode) (i32.const 2))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.variable)
                      (enum.get $Token.variable.parameter)
                      (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const "="))))
                  (br $classified)))
              ;; dependencies, and the arguments of `(dep arg)`
              (if (i32.eq (local.get $mode) (i32.const 3))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function)
                      (enum.get $Token.variable)
                      (i32.or
                        (i32.eqz (local.get $depth))
                        (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const "(")))))
                  (br $classified)))
              (local.set $hl (enum.get $Token.attribute))
              (br_if $classified (i32.eq (local.get $mode) (i32.const 4)))
              (local.set $hl (keyword-table.value $justWords (local.get $lhs) (local.get $rhs)))
              (br_if $classified (i32.lt_u (local.get $hl) (i32.const 256)))
              (local.set $hl
                (select
                  (enum.get $Token.function)
                  (enum.get $Token.variable)
                  (i32.eq (local.get $v) (i32.const "(")))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (if (byteset.get "!$%&*+-/:<=>?@^|~" (local.get $c))
          (then
            (loop $op
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (local.set $v (call $templateByte (global.get $ptr)))
              (br_if $op (byteset.get "!%&*+-/<=>?^|~" (local.get $v))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
