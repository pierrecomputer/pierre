(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.dmWords 128)

  (import "@pierre/wat-tools/common.wat")

  ;; Each value is the word's token; the high byte is the path state it
  ;; starts (see $hlDreamMaker): 2 `proc`/`verb`, 3 `var`, 4 the types
  ;; after `as`.
  (keyword-table $dmWords $mem.dmWords $mem.dmWords+128
    (group $Token.keyword.declaration+768 "var")
    (group $Token.keyword.declaration+512 "proc" "verb")
    (group $Token.keyword "global" "static" "const" "tmp" "set" "new" "del")
    (group $Token.keyword.control
      "if" "else" "for" "while" "do" "switch" "break" "continue" "goto" "return" "spawn" "try"
      "catch" "throw")
    (group $Token.keyword.operator "in" "to" "step")
    (group $Token.keyword.operator+1024 "as")
    (group $Token.variable.special "src" "usr" "world" "args")
    (group $Token.constant.builtin "null"))

  ;; Scan a text body from $ptr; [$seg,$ptr) is not yet emitted. $kind is
  ;; `"` for a string, which ends at a raw line break, or `{` for a `{"..."}`
  ;; document. A `\` escapes one byte or names a text macro (`\the`,
  ;; `\red`); `\n` is two bytes. Returns 0 past the closer, 1 at the `[` of
  ;; an embedded expression, 2 at a line break or $end.
  (func $dmStrBody (param $kind i32) (param $seg i32) (result i32)
    (local $p i32)
    (local $c i32)
    (local $e i32)
    (loop $l
      (local.set $p (call $scanFind3 (global.get $ptr) (i32.const 34) (i32.const 92) (i32.const "[")))
      (if (i32.eq (local.get $kind) (i32.const 34))
        (then
          (local.set $p
            (call $scanFindSpecial (global.get $ptr) (local.get $p) (i32.const 10) (i32.const 0) (i32.const 1)))))
      (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
      (global.set $ptr (local.get $p))
      (local.set $seg (local.get $p))
      (if (i32.lt_u (local.get $p) (global.get $end))
        (then
          (local.set $c (i32.load8_u (local.get $p)))
          (if (i32.eq (local.get $c) (i32.const "["))
            (then (return (i32.const 1))))
          (if (i32.eq (local.get $c) (i32.const 34))
            (then
              (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
              (if (i32.eq (local.get $kind) (i32.const "{"))
                (then
                  (br_if $l (i32.ne (call $templateByte (global.get $ptr)) (i32.const "}")))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
              (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
              (return (i32.const 0))))
          (if (i32.eq (local.get $c) (i32.const 92))
            (then
              (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
              (local.set $c (call $templateByte (global.get $ptr)))
              (if
                (i32.and
                  (i32.ne (local.get $c) (i32.const "n"))
                  (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
                (then
                  (loop $macro
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (local.set $c (call $templateByte (global.get $ptr)))
                    (br_if $macro
                      (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))))
                (else (global.set $ptr (call $lexEscapeEnd (local.get $p)))))
              (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
              (local.set $seg (global.get $ptr))
              (br $l))))))
    (i32.const 2))

  ;; $str is the kind of a text body to resume: a document open at the
  ;; chunk end, a string continued by `\` at a line break, or the body whose
  ;; `[ ]` expression just closed. $fld holds 10 bits per open `[` expression,
  ;; innermost lowest: 1 in a `"` body or 2 in a `{"` one, plus 4 per nested
  ;; `[`; a fourth level drops the outermost. $path is
  ;; 1 in a type path, 6 in one that starts its line, 2 after its `proc` or
  ;; `verb`, 3 after its `var`, 4 in the types after `as`, and 5 after a proc name whose
  ;; parameters follow. $params counts
  ;; the parentheses open in a parameter list. $head is 1 before the first
  ;; token of a line. $operand is 1 where a value may start, so `/` opens a
  ;; path there, and 2 after a member `.` or `:`.
  (func $hlDreamMaker
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $prev i32)
    (local $kind i32)
    (local $str i32)
    (local $fld i32)
    (local $path i32)
    (local $params i32)
    (local $head i32)
    (local $operand i32)
    (local.set $head (i32.const 1))
    (local.set $operand (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (block $string
          (local.set $lhs (global.get $ptr))
          (local.set $c (local.get $str))
          (if (local.get $c)
            (then
              (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $str (i32.const 0))
              (br $string)))
          (local.set $gap (global.get $ptr))
          (call $scanWhitespace)
          (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
            (then
              (local.set $head (i32.const 1))
              (local.set $operand (i32.const 1))
              (local.set $path (i32.const 0))
              (if (i32.eq (i32.and (local.get $fld) (i32.const 3)) (i32.const 1))
                (then (local.set $fld (i32.const 0))))))
          (call $emitGap (local.get $gap) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (local.get $lhs)))
          (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          (local.set $v (local.get $head))
          (local.set $head (i32.const 0))
          (local.set $prev (local.get $path))
          (local.set $path (i32.const 0))
          (block $value
          (block $emit
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (if (i32.eq (local.get $c2) (i32.const "/"))
                  (then
                    (global.set $ptr (local.get $lhs))
                    (call $lexLineComment
                      (i32.const 2)
                      (select
                        (enum.get $Token.comment.doc)
                        (enum.get $Token.comment)
                        (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "/"))))
                    (local.set $head (local.get $v))
                    (local.set $path (local.get $prev))
                    (br $next)))
                (if (i32.eq (local.get $c2) (i32.const "*"))
                  (then
                    (global.set $ptr (local.get $lhs))
                    (call $lexNestedBlockComment
                      (i32.const "/*")
                      (i32.const "*/")
                      (select
                        (enum.get $Token.comment.doc)
                        (enum.get $Token.comment)
                        (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "*"))))
                    (local.set $head (local.get $v))
                    (local.set $path (local.get $prev))
                    (br $next)))
                ;; a path: `/obj/item` where a value may start, or the next segment
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                (if
                  (i32.and
                    (i32.or (local.get $operand) (i32.ne (local.get $prev) (i32.const 0)))
                    (call $lexIsNameStart (local.get $c2)))
                  (then
                    (local.set $path
                      (select (local.get $prev) (select (i32.const 6) (i32.const 1) (local.get $v)) (local.get $prev)))
                    (br $emit)))))
            ;; `.` and `:` start a relative path or name a member
            (if
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ":")))
                (call $lexIsNameStart (local.get $c2)))
              (then
                (local.set $path
                  (i32.and (i32.eq (local.get $operand) (i32.const 1)) (i32.eq (local.get $c) (i32.const "."))))
                (local.set $operand (i32.sub (i32.const 2) (local.get $path)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (br $next)))
            ;; preprocessor lines; a macro's name is part of the directive
            (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eqz (call $lexLineByteBefore (local.get $lhs))))
              (then
                (call $scanIdentRun (i32.const "_"))
                (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
                (local.set $hl (i32.load offset=1 (local.get $lhs)))
                (if
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 7))
                      (i32.or
                        (i32.eq (local.get $hl) (i32.const "defi"))
                        (i32.eq (local.get $hl) (i32.const "ifnd"))))
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 6))
                      (i32.or
                        (i32.eq (local.get $hl) (i32.const "unde"))
                        (i32.eq (local.get $hl) (i32.const "ifde")))))
                  (then
                    (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
                    (call $scanIdentRun (i32.const "_"))))
                (local.set $hl (enum.get $Token.preproc))
                (br $emit)))
            (br_if $string (i32.eq (local.get $c) (i32.const 34)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const 34)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (br $string)))
            (if (i32.eq (local.get $c) (i32.const 39))
              (then
                (global.set $ptr (local.get $lhs))
                (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string.special))
                (local.set $operand (i32.const 0))
                (br $next)))
            (if
              (i32.or
                (call $lexIsDigit (local.get $c))
                (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
              (then
                (global.set $ptr (local.get $lhs))
                (call $lexScanNumber)
                (local.set $hl (enum.get $Token.number))
                (br $value)))
            (if (call $lexIsNameStart (local.get $c))
              (then
                (call $scanIdentRun (i32.const "_"))
                (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                (local.set $c2 (call $templateByte (local.get $p)))
                (local.set $hl (keyword-table.value $dmWords (local.get $lhs) (global.get $ptr)))
                ;; a name followed by `/name` is a path segment
                (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (local.set $kind
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "/"))
                    (call $lexIsNameStart (local.get $c))))
                (if
                  (i32.and
                    (i32.and (local.get $kind) (i32.eqz (local.get $prev)))
                    (i32.or
                      (i32.or (local.get $v) (local.get $params))
                      (i32.ge_s (local.get $hl) (i32.const 512))))
                  (then (local.set $prev (select (i32.const 6) (i32.const 1) (local.get $v)))))
                (block $word
                  (if (i32.eq (local.get $prev) (i32.const 4))
                    (then
                      (local.set $path (i32.const 4))
                      (local.set $hl (enum.get $Token.type))
                      (br $word)))
                  (if (local.get $prev)
                    (then
                      (local.set $path (local.get $prev))
                      (if (i32.ge_s (local.get $hl) (i32.const 512))
                        (then
                          (local.set $path (i32.shr_u (local.get $hl) (i32.const 8)))
                          (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                          (br $word)))
                      (br_if $word
                        (i32.and
                          (i32.eq (local.get $prev) (i32.const 3))
                          (i32.eq (local.get $hl) (enum.get $Token.keyword))))
                      ;; a proc follows `proc/`, or ends a path that starts its line: `/mob/Login()`
                      (if
                        (i32.or
                          (i32.eq (local.get $prev) (i32.const 2))
                          (i32.and
                            (i32.eq (local.get $prev) (i32.const 6))
                            (i32.and (i32.eqz (local.get $kind)) (i32.eq (local.get $c2) (i32.const "(")))))
                        (then
                          (local.set $hl (enum.get $Token.function.definition))
                          (local.set $path (i32.mul (i32.eq (local.get $c2) (i32.const "(")) (i32.const 5)))
                          (br $word)))
                      (local.set $hl (enum.get $Token.type))
                      (br_if $word (local.get $kind))
                      (local.set $path (i32.const 0))
                      (if (i32.eq (local.get $prev) (i32.const 3))
                        (then (local.set $hl (enum.get $Token.variable))))
                      (if (local.get $params)
                        (then (local.set $hl (enum.get $Token.variable.parameter))))
                      (br $word)))
                  (if (i32.ge_s (local.get $hl) (i32.const 0))
                    (then
                      (local.set $path (i32.shr_u (local.get $hl) (i32.const 8)))
                      (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                      ;; `src`, `usr`, `world`, and `null` are values
                      (br_if $word
                        (i32.or
                          (i32.eq (local.get $hl) (enum.get $Token.variable.special))
                          (i32.eq (local.get $hl) (enum.get $Token.constant.builtin))))
                      (br $emit)))
                  (if (i32.eq (local.get $operand) (i32.const 2))
                    (then
                      (local.set $hl
                        (select
                          (enum.get $Token.function.method)
                          (enum.get $Token.property)
                          (i32.eq (local.get $c2) (i32.const "("))))
                      (br $word)))
                  (local.set $hl (enum.get $Token.function))
                  (br_if $word (i32.eq (local.get $c2) (i32.const "(")))
                  (local.set $hl (enum.get $Token.constant))
                  (br_if $word (call $lexIsConstCase (local.get $lhs) (global.get $ptr)))
                  (local.set $hl (enum.get $Token.variable))
                  ;; a parameter name before `,`, `)`, `=`, or `as`
                  (br_if $word (i32.eqz (local.get $params)))
                  (br_if $word
                    (i32.eqz
                      (i32.or
                        (i32.or
                          (i32.or (i32.eq (local.get $c2) (i32.const ",")) (i32.eq (local.get $c2) (i32.const ")")))
                          (i32.eq (local.get $c2) (i32.const "=")))
                        (i32.and
                          (i32.eq (local.get $c2) (i32.const "a"))
                          (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "s"))))))
                  (local.set $hl (enum.get $Token.variable.parameter)))
                (br $value)))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (if (i32.or (local.get $params) (i32.eq (local.get $prev) (i32.const 5)))
                  (then (local.set $params (i32.add (local.get $params) (i32.const 1)))))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (local.get $params)
                  (then (local.set $params (i32.sub (local.get $params) (i32.const 1)))))
                (br $value)))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then
                (if (local.get $fld)
                  (then (local.set $fld (i32.add (local.get $fld) (i32.const 4)))))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const "]"))
              (then
                ;; the `]` of an embedded expression returns to its text
                (if (i32.lt_u (i32.sub (i32.and (local.get $fld) (i32.const 0x3ff)) (i32.const 1)) (i32.const 2))
                  (then
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                    (local.set $str (select (i32.const "{") (i32.const 34) (i32.and (local.get $fld) (i32.const 2))))
                    (local.set $fld (i32.shr_u (local.get $fld) (i32.const 10)))
                    (br $next)))
                (if (local.get $fld)
                  (then (local.set $fld (i32.sub (local.get $fld) (i32.const 4)))))
                (br $value)))
            (br_if $emit (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}"))))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (br_if $emit (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";"))))
            (local.set $hl (enum.get $Token.operator))
            ;; `|` keeps the types after `as`
            (if (i32.eq (local.get $c) (i32.const "|"))
              (then (local.set $path (i32.shl (i32.eq (local.get $prev) (i32.const 4)) (i32.const 2))))))
          ;; a token after which a value may start
          (local.set $operand (i32.const 1))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (br $next))
          ;; a value token
          (local.set $operand (i32.const 0))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (br $next))
        ;; a text body: `"` or `{"` from $lhs, or resumed at $ptr
        (local.set $kind (select (i32.const "{") (i32.const 34) (i32.eq (local.get $c) (i32.const "{"))))
        (local.set $v (call $dmStrBody (local.get $kind) (local.get $lhs)))
        (local.set $operand (i32.const 0))
        (if (i32.eq (local.get $v) (i32.const 1))
          (then
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $fld
              (i32.or (i32.shl (local.get $fld) (i32.const 10)) (i32.add (i32.const 1) (i32.eq (local.get $kind) (i32.const "{")))))
            (local.set $operand (i32.const 1))))
        (if (i32.and (i32.eq (local.get $v) (i32.const 2)) (i32.ge_u (global.get $ptr) (global.get $end)))
          (then (local.set $str (local.get $kind))))
        (br $next))))
)
