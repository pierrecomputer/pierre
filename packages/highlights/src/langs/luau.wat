(module
  (import "./lua.wat")

  ;; Luau words that Lua lacks. +512: a keyword only before a name on the
  ;; same line (`type Name`, `export type`), so `type(x)` stays a call; +1024:
  ;; a builtin only inside a type, so `string.format` stays a library.
  (keyword-table $luauWords $mem.luauWords $mem.hackWords
    (group $Token.keyword.control "continue")
    (group $Token.keyword+512 "export")
    (group $Token.keyword.declaration+512 "type")
    (group $Token.type.builtin+1024
      "any" "never" "number" "string" "thread" "buffer" "vector" "boolean" "unknown"))

  ;; Scan the text of a Luau interpolated string from $ptr ($seg: its first
  ;; unemitted byte) to the closing backtick or a `{` that opens an
  ;; expression. Like a Lua string it stops at the line end. Returns 1 after
  ;; a `{`.
  (func $luauTemplate (param $seg i32) (result i32)
    (local $c i32)
    (local $open i32)
    (local $saveEnd i32)
    (local.set $saveEnd (global.get $end))
    (global.set $end (call $lexFindEither (global.get $ptr) (i32.const 10) (i32.const 13)))
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFind3 (global.get $ptr) (i32.const "`") (i32.const 92) (i32.const "{")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (drop (call $stringEscapeAt (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (local.set $open (i32.eq (local.get $c) (i32.const "{")))
        (if (local.get $open)
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok
          (select (enum.get $Token.punctuation.special) (enum.get $Token.string) (local.get $open))
          (local.get $seg)
          (global.get $ptr))
        (local.set $seg (global.get $ptr))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (global.set $end (local.get $saveEnd))
    (local.get $open))

  ;; Luau: the Lua loop plus types, interpolated strings, and attributes.
  ;; WARNING: keep it apart from $hlLua; a shared dialect loop slowed Lua ~4%
  ;; in V8. $type is 0 outside a type annotation, else bit 0 is set, bit 1 marks a complete operand
  ;; (`number`, `T>`), bit 2 a `type Name` alias that waits for its `=`, and
  ;; bits 3+ count the brackets open inside the type. $interp holds the brace
  ;; depth of each open string interpolation, four bits per nesting level.
  (func $hlLuau
    (local $c i32)
    (local $decl i32)
    (local $group i32)
    (local $hl i32)
    (local $lhs i32)
    (local $member i32)
    (local $next i32)
    (local $p i32)
    (local $type i32)
    (local $interp i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break after a complete type at depth 0 ends it
        (if (i32.eq (i32.and (local.get $type) (i32.const -6)) (i32.const 2))
          (then
            (if (call $lexGapHasBreak (local.get $lhs) (global.get $ptr))
              (then (local.set $type (i32.const 0))))))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "-"))
            (i32.eq (local.get $next) (i32.const "-")))
          (then
            (if (call $luaLong (i32.const 2) (enum.get $Token.comment))
              (then (br $token)))
            (call $lexLineComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "-")))))
            (br $token)))
        ;; a `#!` shebang line: Lua skips a first line starting with `#`, and
        ;; `#!` is never code anywhere else (`#` is length, and there is no
        ;; `!` operator), so no first-line tracking is needed
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.eq (local.get $next) (i32.const "!")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            ;; a string singleton type completes an operand
            (if (local.get $type)
              (then (local.set $type (i32.or (local.get $type) (i32.const 2)))))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (if (call $luaLong (i32.const 0) (enum.get $Token.string))
              (then
                (local.set $decl (i32.const 0))
                (local.set $member (i32.const 0))
                (br $token)))))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $next))))
          (then
            (call $lexScanHexNumber (i32.const 0))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $group (keyword-table.value $luaWords (local.get $lhs) (global.get $ptr)))
            (if (i32.lt_s (local.get $group) (i32.const 0))
              (then
                (local.set $group (keyword-table.value $luauWords (local.get $lhs) (global.get $ptr)))
                (if (i32.gt_s (local.get $group) (i32.const 255))
                  (then
                    (if
                      (i32.eqz
                        (select
                          (call $lexIsIdentStart
                            (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
                          (local.get $type)
                          (i32.and (local.get $group) (i32.const 512))))
                      (then (local.set $group (i32.const -1))))))))
            (local.set $hl
              (select
                (enum.get $Token.variable)
                (i32.and (local.get $group) (i32.const 255))
                (i32.lt_s (local.get $group) (i32.const 0))))
            ;; inside a type a name is a type, or a field or parameter before
            ;; `:`; any keyword but a literal ends the type
            (if (local.get $type)
              (then
                (if
                  (i32.or
                    (i32.lt_s (local.get $group) (i32.const 0))
                    (i32.or
                      (i32.eq (local.get $hl) (enum.get $Token.boolean))
                      (i32.or
                        (i32.eq (local.get $hl) (enum.get $Token.constant.builtin))
                        (i32.eq (local.get $hl) (enum.get $Token.type.builtin)))))
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $c (call $templateByte (local.get $p)))
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $hl
                          (select
                            (enum.get $Token.function)
                            (enum.get $Token.type)
                            (i32.eq (local.get $c) (i32.const "("))))
                        (if
                          (i32.and
                            (i32.eq (local.get $c) (i32.const ":"))
                            (i32.ne
                              (call $templateByte (i32.add (local.get $p) (i32.const 1)))
                              (i32.const ":")))
                          (then (local.set $hl (enum.get $Token.property)))))
                      (else
                        (if (i32.eq (local.get $hl) (enum.get $Token.constant.builtin))
                          (then (local.set $hl (enum.get $Token.type.builtin))))))
                    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                    (local.set $type (i32.or (local.get $type) (i32.const 2)))
                    (local.set $decl (i32.const 0))
                    (local.set $member (i32.const 0))
                    (br $token)))
                (local.set $type (i32.const 0))))
            (if (local.get $decl)
              (then
                (local.set $hl (enum.get $Token.function.definition))
                (local.set $decl (i32.const 0)))
              (else
                (if (local.get $member)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.and
                          (i32.lt_u (local.get $p) (global.get $end))
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))
                    (local.set $member (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if
                          (i32.and
                            (i32.lt_u (local.get $p) (global.get $end))
                            (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            ;; `function` opens a definition; the token test keeps a `function`
            ;; that was itself captured as a definition from opening another one
            (if
              (i32.and
                (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                (i32.ne (i32.and (local.get $group) (i32.const 256)) (i32.const 0)))
              (then (local.set $decl (i32.const 1))))
            (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
              (then
                (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (then (local.set $hl (enum.get $Token.constant))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            ;; `type Name` opens an alias and `function name<T>` a generic list
            (if
              (i32.and
                (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                (i32.ne (i32.and (local.get $group) (i32.const 512)) (i32.const 0)))
              (then (local.set $type (i32.const 5))))
            (if
              (i32.and
                (i32.eq (local.get $hl) (enum.get $Token.function.definition))
                (i32.eq
                  (call $templateByte (call $lexSkipSpaceAt (global.get $ptr)))
                  (i32.const "<")))
              (then (local.set $type (i32.const 3))))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.lt_u (global.get $ptr) (global.get $end))
                (i32.eq (i32.load8_u (global.get $ptr)) (local.get $c)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "."))
                    (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "."))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 1))))
            ;; a `::` cast, or a `:` not followed by a method call
            ;; (`obj:name(`, `obj:name "s"`, `obj:name {`), starts a type
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (local.set $p (i32.const 0))
                (if
                  (i32.and
                    (local.get $member)
                    (call $lexIsIdentStart (call $templateByte (global.get $ptr))))
                  (then
                    (call $lexScanIdent)
                    (local.set $p (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
                (if
                  (i32.eqz
                    (i32.or (byteset.get "\22'{" (local.get $p)) (i32.eq (local.get $p) (i32.const "("))))
                  (then (local.set $type (i32.or (local.get $type) (i32.const 1)))))))
            (if (local.get $type)
              (then
                (local.set $type (i32.and (local.get $type) (i32.const -3)))
                (local.set $member (i32.const 0))))
            (local.set $decl (i32.const 0))
            (br $token)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            ;; inside a type brackets nest; a closer at depth 0 ends the type,
            ;; and so does a call or parameter list after a complete type
            (if (local.get $type)
              (then
                (if (byteset.get "([{" (local.get $c))
                  (then
                    (local.set $type
                      (select
                        (i32.const 0)
                        (i32.and (i32.add (local.get $type) (i32.const 8)) (i32.const -3))
                        (i32.and
                          (i32.eq (local.get $c) (i32.const "("))
                          (i32.eq (i32.and (local.get $type) (i32.const -6)) (i32.const 2))))))
                  (else
                    (local.set $type
                      (select
                        (i32.const 0)
                        (i32.or (i32.sub (local.get $type) (i32.const 8)) (i32.const 2))
                        (i32.lt_u (local.get $type) (i32.const 8))))))))
            ;; the `}` that closes an interpolation resumes its string
            (if (i32.and (i32.ne (local.get $interp) (i32.const 0)) (i32.eqz (local.get $type)))
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then
                    (if (i32.ne (i32.and (local.get $interp) (i32.const 15)) (i32.const 15))
                      (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (i32.and (local.get $interp) (i32.const 15)))
                      (then
                        (call $emitTok
                          (enum.get $Token.punctuation.special)
                          (local.get $lhs)
                          (global.get $ptr))
                        (local.set $interp (i32.shr_u (local.get $interp) (i32.const 4)))
                        (if (call $luauTemplate (global.get $ptr))
                          (then
                            (local.set $interp
                              (i32.or (i32.shl (local.get $interp) (i32.const 4)) (i32.const 1)))))
                        (local.set $decl (i32.const 0))
                        (local.set $member (i32.const 0))
                        (br $token)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (if (local.get $type)
              (then
                (local.set $type
                  (select
                    (i32.const 0)
                    (i32.and (local.get $type) (i32.const -3))
                    (i32.lt_u (local.get $type) (i32.const 8))))))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $hl (enum.get $Token.operator))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (if (call $luauTemplate (local.get $lhs))
              (then
                (local.set $interp
                  (i32.or (i32.shl (local.get $interp) (i32.const 4)) (i32.const 1)))))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $next)))
          (then
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $next) (i32.const ">")))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        ;; `|`, `&` and `->` only build types; `?` keeps one going; `<`, `>`
        ;; nest inside one; an alias `=` starts its body; anything else ends it
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.gt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1)))
          (then (local.set $type (i32.and (i32.or (local.get $type) (i32.const 1)) (i32.const -3))))
          (else
            (if (local.get $type)
              (then
                (if (i32.eq (local.get $c) (i32.const "<"))
                  (then
                    (local.set $hl (enum.get $Token.punctuation.bracket))
                    (local.set $type
                      (i32.and (i32.add (local.get $type) (i32.const 8)) (i32.const -3))))
                  (else
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const ">"))
                        (i32.ge_u (local.get $type) (i32.const 8)))
                      (then
                        (local.set $hl (enum.get $Token.punctuation.bracket))
                        (local.set $type
                          (i32.or (i32.sub (local.get $type) (i32.const 8)) (i32.const 2))))
                      (else
                        (if (i32.eq (local.get $c) (i32.const "="))
                          (then
                            (local.set $type
                              (select
                                (i32.and (local.get $type) (i32.const -7))
                                (i32.const 0)
                                (i32.or
                                  (i32.and (local.get $type) (i32.const 4))
                                  (i32.ge_u (local.get $type) (i32.const 8))))))
                          (else
                            (if (i32.ne (local.get $c) (i32.const "?"))
                              (then (local.set $type (i32.const 0))))))))))))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (local.set $decl (i32.const 0))
        (local.set $member (i32.const 0))
        (br $token))))
)
