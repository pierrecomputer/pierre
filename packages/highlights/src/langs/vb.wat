(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.vbWords 520)

  (import "@pierre/wat-tools/common.wat")

  ;; Visual Basic is case-insensitive, so the table holds lowercase words.
  ;; Token in the low byte; bits 8-9 capture the next name: 1 a routine,
  ;; 2 a type, 3 a namespace. Bit 10 marks `End` and `Exit`, whose next
  ;; word captures nothing. Bit 11 marks `Rem`, which starts a comment.
  ;; After a routine keyword, bit 12 keeps the capture (`Property Get Name`)
  ;; and bit 13 takes it (`Sub New`).
  ;; `overloads` and `notinheritable` share their hashes with `overrides`
  ;; and `notoverridable` and are matched directly.
  (keyword-table $vbWords $mem.vbWords $mem.vbWords+520
    (group $Token.keyword.declaration+256 "sub" "function" "property" "operator")
    (group $Token.keyword.declaration+512 "class" "module" "structure" "interface" "enum")
    (group $Token.keyword.declaration+768 "namespace")
    (group $Token.keyword.import+768 "imports")
    (group $Token.keyword+512 "as" "of" "inherits" "implements")
    (group $Token.keyword+8704 "new")
    (group $Token.keyword+1024 "end")
    (group $Token.keyword.control+1024 "exit")
    (group $Token.keyword.declaration
      "dim" "const" "redim" "preserve" "event" "delegate" "declare" "lib" "alias" "public"
      "private" "protected" "friend" "shared" "shadows" "overrides"
      "overridable" "notoverridable" "mustoverride" "mustinherit"
      "readonly" "writeonly" "partial" "static" "async" "iterator" "byval" "byref" "optional"
      "paramarray" "withevents" "default" "widening" "narrowing" "handles" "option" "explicit"
      "strict" "infer" "compare" "erase")
    (group $Token.keyword.declaration+4096 "get" "set" "let")
    (group $Token.keyword.control
      "if" "then" "else" "elseif" "for" "each" "in" "to" "step" "next" "do" "loop" "while"
      "until" "wend" "select" "case" "try" "catch" "finally" "throw" "return" "continue" "goto"
      "with" "using" "synclock" "when" "yield" "await" "resume" "on" "error" "call"
      "raiseevent" "addhandler" "removehandler")
    (group $Token.keyword.operator
      "and" "or" "not" "xor" "andalso" "orelse" "mod" "is" "isnot" "like" "typeof" "addressof")
    (group $Token.variable.special "me" "mybase" "myclass")
    (group $Token.constant.builtin "nothing")
    (group $Token.boolean "true" "false")
    (group $Token.type.builtin
      "integer" "long" "short" "byte" "sbyte" "uinteger" "ulong" "ushort" "single" "double"
      "decimal" "boolean" "char" "string" "object" "date" "variant" "currency")
    (group $Token.comment+2048 "rem"))

  ;; A string body from $ptr, emitted from $seg: `""` escapes a quote and,
  ;; when $interp is set, `{{` and `}}` escape braces. Ends after the closing
  ;; quote or at the line end. Return 1 when it stops after the `{` of an
  ;; interpolation hole, which it emits.
  (func $vbString (param $seg i32) (param $interp i32) (result i32)
    (local $p i32)
    (local $c i32)
    (local $hole i32)
    (local.set $p (global.get $ptr))
    (block $done
      (loop $l
        (if (i32.eqz (local.get $interp))
          (then
            (local.set $p
              (call $scanFindSpecial (local.get $p) (global.get $end) (i32.const 34) (i32.const 0) (i32.const 1)))))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (byteset.get "\n\r" (local.get $c)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 34))
            (i32.and
              (local.get $interp)
              (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (if (i32.eq (call $templateByte (local.get $p)) (local.get $c))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (i32.sub (local.get $p) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.string.escape)
                  (i32.sub (local.get $p) (i32.const 1))
                  (i32.add (local.get $p) (i32.const 1)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $seg (local.get $p))
                (br $l)))
            (br_if $done (i32.eq (local.get $c) (i32.const 34)))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (i32.sub (local.get $p) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.special)
                  (i32.sub (local.get $p) (i32.const 1))
                  (local.get $p))
                (local.set $seg (local.get $p))
                (local.set $hole (i32.const 1))
                (br $done)))))
        (br $l)))
    (global.set $ptr (local.get $p))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
    (local.get $hole))

  ;; $expect is the pending capture: 1 a routine name, 2 a type, 3 a
  ;; namespace, 4 the `(` of a routine. $paren counts open parentheses and
  ;; $params is the depth of a parameter list. $attr is one more than the
  ;; depth of an open `<Attribute>` list; $hole is 1 inside the `{...}` of
  ;; an interpolated string. $noCap is 1 after `End` or `Exit`; $member is 1
  ;; after `.`.
  (func $hlVb
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $v i32)
    (local $hl i32)
    (local $expect i32)
    (local $paren i32)
    (local $params i32)
    (local $attr i32)
    (local $hole i32)
    (local $noCap i32)
    (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        ;; Check before the end test, so a line-fed chunk sees its
        ;; own line break. An interpolation hole or attribute list ends with
        ;; its line.
        (if (i32.or (local.get $hole) (local.get $attr))
          (then
            (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
              (then
                (local.set $hole (i32.const 0))
                (local.set $attr (i32.const 0))))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        ;; `'` comments; `'''` documentation comments
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexLineComment
              (i32.const 1)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (local.get $c2) (i32.const 39))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const 39)))))
            (br $next)))

        ;; every token but a name, `[name]`, or `.` ends a capture and a member access
        (if (i32.eqz (call $lexIsNameStart (local.get $c)))
          (then
            (if (i32.and (i32.ne (local.get $c) (i32.const ".")) (i32.ne (local.get $c) (i32.const "[")))
              (then
                (local.set $member (i32.const 0))
                (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $expect) (i32.const 4)))
                  (then (local.set $params (i32.add (local.get $paren) (i32.const 1)))))
                (local.set $expect (i32.const 0))))))

        ;; strings, `$"..."` interpolated strings, and the `}` that resumes one
        (if
          (i32.or
            (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c2) (i32.const 34))))
            (i32.and (i32.eq (local.get $c) (i32.const "}")) (local.get $hole)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))))
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (local.set $hole
              (call $vbString (local.get $lhs) (i32.ne (local.get $c) (i32.const 34))))
            (br $next)))

        ;; `#If`, `#Region` preprocessor lines; `#1/31/2024#` dates
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (if
              (i32.and
                (i32.eqz (call $lexLineByteBefore (local.get $lhs)))
                (i32.eqz (call $lexIsDigit (local.get $c2))))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.preproc))
                (br $next)))
            (if (call $lexIsDigit (local.get $c2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (loop $date
                  (local.set $v (call $templateByte (global.get $ptr)))
                  (if (byteset.get "0123456789/-:. \09AMPamp" (local.get $v))
                    (then
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (br $date))))
                (if (i32.eq (local.get $v) (i32.const "#"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                    (br $next)))
                (global.set $ptr (local.get $lhs))))))

        ;; `&H1F`, `&O17`, `&B101`
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "&"))
            (i32.and
              (i32.or
                (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "h"))
                (i32.or
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "o"))
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "b"))))
              (call $lexIsHex (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; names and `[escaped]` names
        (local.set $v (i32.const -1))
        (local.set $rhs (i32.const 0))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "["))
            (call $lexIsNameStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "]"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $rhs (global.get $ptr)))
              (else (global.set $ptr (local.get $lhs))))))
        (if (call $lexIsNameStart (local.get $c))
          (then
            (call $scanIdentRun (i32.const "_"))
            ;; `Left$(` type character
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "$"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $rhs (global.get $ptr))
            (if (i32.eqz (local.get $member))
              (then
                (local.set $v
                  (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
                (local.set $hl (local.get $v))
                (local.set $v
                  (keyword-table.value $vbWords
                    (i32.const $mem.lexLowerScratch)
                    (i32.add (i32.const $mem.lexLowerScratch) (local.get $hl))))
                (if
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $hl) (i32.const 9))
                      (i32.and
                        (i64.eq (i64.load (i32.const $mem.lexLowerScratch)) (i64.const "overload"))
                        (i32.eq (i32.load8_u (i32.const $mem.lexLowerScratch+8)) (i32.const "s"))))
                    (i32.and
                      (i32.eq (local.get $hl) (i32.const 14))
                      (i32.and
                        (i64.eq (i64.load (i32.const $mem.lexLowerScratch)) (i64.const "notinher"))
                        (i64.eq (i64.load (i32.const $mem.lexLowerScratch+6)) (i64.const "eritable")))))
                  (then (local.set $v (enum.get $Token.keyword.declaration))))))))
        (if (local.get $rhs)
          (then
            (local.set $c2 (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            ;; `_` at a line end continues the line
            (if (i32.and (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1))))
              (then (local.set $v (enum.get $Token.punctuation.special))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (if (i32.and (local.get $v) (i32.const 2048))
                  (then
                    (global.set $ptr (local.get $lhs))
                    (call $lexLineComment (i32.const 0) (enum.get $Token.comment))
                    (br $next)))
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (if (i32.and (i32.eq (local.get $expect) (i32.const 1)) (i32.ge_u (local.get $v) (i32.const 4096)))
                  (then
                    (if (i32.ge_u (local.get $v) (i32.const 8192))
                      (then
                        (local.set $hl (enum.get $Token.function.definition))
                        (local.set $expect (i32.const 4)))))
                  (else
                    (local.set $expect
                      (select
                        (i32.const 0)
                        (i32.and (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 3))
                        (local.get $noCap)))
                    (local.set $noCap (i32.shr_u (i32.and (local.get $v) (i32.const 1024)) (i32.const 10))))))
              (else
                (local.set $noCap (i32.const 0))
                (local.set $hl (enum.get $Token.variable))
                (if
                  (i32.and
                    (i32.ne (local.get $params) (i32.const 0))
                    (i32.eq (local.get $paren) (local.get $params)))
                  (then (local.set $hl (enum.get $Token.variable.parameter))))
                (if (i32.eq (local.get $c2) (i32.const "("))
                  (then (local.set $hl (enum.get $Token.function))))
                (if (local.get $member)
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.eq (local.get $c2) (i32.const "("))))))
                (if (i32.and (i32.ne (local.get $attr) (i32.const 0)) (i32.eq (local.get $attr) (i32.add (local.get $paren) (i32.const 1))))
                  (then (local.set $hl (enum.get $Token.attribute))))
                (if (i32.eq (local.get $expect) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (local.set $expect (i32.const 4))))
                (if (i32.lt_u (i32.sub (local.get $expect) (i32.const 2)) (i32.const 2))
                  (then
                    (if (i32.eq (local.get $expect) (i32.const 2))
                      (then (local.set $hl (enum.get $Token.type))))
                    ;; `System.Text.StringBuilder`: namespaces up to the type
                    (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const "."))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else
                        (if (i32.eq (local.get $expect) (i32.const 3))
                          (then (local.set $hl (enum.get $Token.namespace))))
                        (local.set $expect (i32.const 0))))))))
            (global.set $ptr (local.get $rhs))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        ;; `<Serializable()>` attributes open at a line start, `(`, or `,`
        (local.set $v (call $lexLineByteBefore (local.get $lhs)))
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $lexIsNameStart (local.get $c2)))
            (i32.or
              (i32.eqz (local.get $v))
              (i32.or (i32.eq (local.get $v) (i32.const "(")) (i32.eq (local.get $v) (i32.const ",")))))
          (then
            (local.set $attr (i32.add (local.get $paren) (i32.const 1)))
            (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ">"))
            (i32.and
              (i32.ne (local.get $attr) (i32.const 0))
              (i32.eq (local.get $attr) (i32.add (local.get $paren) (i32.const 1)))))
          (then
            (local.set $attr (i32.const 0))
            (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (i32.and (i32.eqz (local.get $hl)) (byteset.get "+-*/=<>|&^!%#?~\5c" (local.get $c)))
          (then
            (local.set $hl (enum.get $Token.operator))
            (block $opDone
              (loop $op
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "+-*/=<>|&^!%#?~\5c" (local.get $v))))
                ;; `&H` starts a number
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $v) (i32.const "&"))
                    (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))))
        (if (byteset.get "()[]" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $paren (i32.add (local.get $paren) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (i32.eq (local.get $paren) (local.get $params))
                  (then (local.set $params (i32.const 0))))
                (if (local.get $paren)
                  (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))))))
        (if (byteset.get ",.:;" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const "=")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.operator))))))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (local.set $member (i32.const 1))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
