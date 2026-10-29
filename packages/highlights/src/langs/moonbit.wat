(module
  (import "../common.wat")

  ;; Token in the low byte; the high byte holds what a word arms in
  ;; $hlMoonbit: 1 a function name, 2 a type name, 4 a `pub(...)` visibility
  ;; word.
  (keyword-table $moonbitWords $mem.moonbitWords $mem.laterWordsFree
    (group $Token.keyword.declaration+256 "fn") ;; 1: declaration, next name is a function
    (group $Token.keyword+256 "with")           ;; 2: impl method, next name is a function
    (group $Token.keyword.declaration+512 ;; 3: declaration, next name is a type
      "type" "enum" "trait" "struct" "suberror" "typealias" "traitalias")
    (group $Token.keyword+1024 "pub") ;; 4: visibility, `pub(all)` names a modifier
    (group $Token.keyword.declaration "let" "impl" "test" "const" "fnalias") ;; 5: declaration
    (group $Token.keyword "mut" "priv" "async" "derive" "extern" "noraise") ;; 6: modifiers
    (group $Token.keyword.import "using" "import") ;; 7: import
    (group $Token.keyword.control ;; 8: control
      "if" "for" "try" "else" "loop" "break" "catch" "defer" "guard" "match" "raise" "while"
      "return" "continue")
    (group $Token.keyword.operator "as" "in" "is") ;; 9: word operators
    (group $Token.type.builtin ;; 10: built-in types
      "Int" "Map" "Bool" "Byte" "Char" "Json" "Self" "Unit" "UInt" "Array" "Bytes" "Error" "Float"
      "Int16" "Int64" "BigInt" "Double" "Option" "Result" "String" "UInt16" "UInt64" "FixedArray")
    (group $Token.boolean "true" "false")    ;; 11: booleans
    (group $Token.variable.special "self")   ;; 12: the receiver
    (group $Token.constructor "None"))       ;; 13: the constructor that takes no argument

  ;; Scan a string body from $ptr whose bytes from $seg are not yet emitted.
  ;; Stop after the closing $quote, before a line break, or at $end. With
  ;; $interp set, a `\{` opens an interpolation: emit it as
  ;; punctuation.special and return 1. Return 0 otherwise. A `$|` line passes
  ;; the backslash as $quote, so only its line break ends it.
  (func $moonbitString (param $quote i32) (param $interp i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $quote)
            (i32.const 1)
            (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (byteset.get "\n\r" (local.get $c)))
        (if (i32.ne (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $c (call $templateByte (local.get $e)))
        (if (i32.and (local.get $interp) (i32.eq (local.get $c) (i32.const "{")))
          (then
            ;; the `{` was read below $end, so this cannot overshoot
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (return (i32.const 1))))
        ;; `\x41`, `\o101`, `兔`, `\u{1F600}`, or one character; a
        ;; backslash before a line break stays alone, as strings end there
        (if (i32.eqz (byteset.get "\n\r" (local.get $c)))
          (then
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const "x"))
              (then (local.set $e (call $scanHexRun (local.get $e) (i32.const 2)))))
            (if (i32.eq (local.get $c) (i32.const "o"))
              (then (local.set $e (call $scanHexRun (local.get $e) (i32.const 3)))))
            (if (i32.eq (local.get $c) (i32.const "u"))
              (then
                (if (i32.eq (call $templateByte (local.get $e)) (i32.const "{"))
                  (then
                    (local.set $e
                      (call $scanHexRun (i32.add (local.get $e) (i32.const 1)) (i32.const 6)))
                    (if (i32.eq (call $templateByte (local.get $e)) (i32.const "}"))
                      (then (local.set $e (i32.add (local.get $e) (i32.const 1))))))
                  (else (local.set $e (call $scanHexRun (local.get $e) (i32.const 4)))))))))
        (local.set $e (call $utf8SpanEnd (local.get $e) (global.get $end)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; $expect is 1 after `fn` or `with` and 2 after a type declaration
  ;; keyword: it names the next name. `fn[T] name` keeps it through the
  ;; type parameters, whose depth $sigFnAngle counts while `fn` arms the
  ;; parameter machine. $member is 1 after `.`, 2 after `::` or a package's
  ;; `.`, and 3 after a `..` cascade or spread. $str is the quote of the
  ;; string that an open `\{` interpolation returns to (a backslash for a
  ;; `$|` line); a line break ends both. All are checkpointed.
  (func $hlMoonbit
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $path i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (local $str i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; token tails: $sig leaves parameter position, then $tok ends a
        ;; member access
        (block $tok
        (block $sig
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (local.get $str)
          (then
            (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
              (then (local.set $str (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        ;; `//` comments; `///` and the `///|` block separator are doc comments
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.eq
                  (call $templateByte (i32.add (local.get $lhs) (i32.const 2)))
                  (i32.const "/"))))
            (br $next)))

        ;; a pending name survives only names, `fn[T]` brackets, and `::`
        (if (i32.and (i32.ne (local.get $expect) (i32.const 0)) (i32.eqz (global.get $sigFnAngle)))
          (then
            (if
              (i32.eqz
                (i32.or
                  (call $lexIsIdentStart (local.get $c))
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "["))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const ":"))
                      (i32.eq (local.get $c2) (i32.const ":"))))))
              (then (local.set $expect (i32.const 0))))))

        ;; `b"..."` bytes and `b'x'` bytes share the string scan
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "b"))
            (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (local.set $c (local.get $c2))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            ;; a string inside an interpolation keeps `\{` as an escape
            (if
              (call $moonbitString
                (local.get $c)
                (i32.and (i32.eq (local.get $c) (i32.const 34)) (i32.eqz (local.get $str)))
                (local.get $lhs))
              (then (local.set $str (local.get $c))))
            (br $tok)))

        ;; multi-line strings: each `#|` line is raw, each `$|` line escapes
        ;; and interpolates
        (if (i32.eq (local.get $c2) (i32.const "|"))
          (then
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (call $lexLineComment (i32.const 2) (enum.get $Token.string))
                (br $tok)))
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (if (call $moonbitString (i32.const 92) (i32.eqz (local.get $str)) (local.get $lhs))
                  (then (local.set $str (i32.const 92))))
                (br $tok)))))

        ;; `#deprecated`, `#borrow(x)`, `#coverage.skip`; `@pkg` and
        ;; `@author/pkg/sub` packages, whose `.` opens a path
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c) (i32.const "@")))
            (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (call $scanIdentRun (i32.const "."))
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (block $pathDone
              (loop $segment
                (call $scanIdentRun (i32.const "_"))
                (br_if $pathDone (i32.ne (call $templateByte (global.get $ptr)) (i32.const "/")))
                (br_if $pathDone
                  (i32.eqz
                    (call $lexIsIdentStart
                      (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $segment)))
            (call $emitTok (enum.get $Token.namespace) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
              (then
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 2))))
            (br $next)))

        ;; a name starts with a letter, `_`, or a UTF-8 byte
        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            ;; a pending fn head outside its type parameters expects only
            ;; the opening paren; another name here is stale context
            (if (i32.and (global.get $sigFnPend) (i32.eqz (global.get $sigFnAngle)))
              (then (global.set $sigFnPend (i32.const 0))))
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            ;; `Type::` keeps a pending function name, as in `fn Type::name`
            (local.set $path
              (i32.and
                (i32.eq (local.get $c2) (i32.const ":"))
                (i32.eq (call $templateByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":"))))
            (local.set $kind
              (select
                (i32.const -1)
                (keyword-table.value $moonbitWords (local.get $lhs) (local.get $rhs))
                (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $kind (i32.shr_u (local.get $kind) (i32.const 8)))
                (if (i32.eqz (i32.or (local.get $path) (global.get $sigFnAngle)))
                  (then (local.set $expect (i32.and (local.get $kind) (i32.const 3)))))
                ;; `fn` also arms the parameter machine for a lambda's list
                (if (i32.eq (local.get $kind) (i32.const 1))
                  (then
                    (global.set $sigFnPend (i32.const 1))
                    (global.set $sigFnAngle (i32.const 0))))
                ;; `pub(all)`, `pub(open)`, `pub(readonly)`
                (if
                  (i32.and
                    (i32.eq (local.get $kind) (i32.const 4))
                    (i32.eq (local.get $c2) (i32.const "(")))
                  (then
                    (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                    (call $scanIdentRun (i32.const "_"))
                    (if
                      (i32.and
                        (i32.gt_u (global.get $ptr) (i32.add (local.get $rhs) (i32.const 1)))
                        (i32.eq (call $templateByte (global.get $ptr)) (i32.const ")")))
                      (then
                        (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                        (local.set $lhs (i32.add (local.get $rhs) (i32.const 1)))
                        (call $emitTok
                          (enum.get $Token.punctuation.bracket)
                          (local.get $rhs)
                          (local.get $lhs))
                        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                        (local.set $lhs (global.get $ptr))
                        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                        (call $emitTok
                          (enum.get $Token.punctuation.bracket)
                          (local.get $lhs)
                          (global.get $ptr))
                        (br $next)))
                    (global.set $ptr (local.get $rhs)))))
              (else
                (if
                  (i32.and
                    (i32.ne (local.get $expect) (i32.const 0))
                    (i32.eqz (i32.or (local.get $path) (global.get $sigFnAngle))))
                  (then
                    (if (i32.eq (local.get $expect) (i32.const 1))
                      (then
                        (local.set $hl (enum.get $Token.function.definition))
                        ;; the name arms the parameter machine for its paren
                        ;; after optional `[T]` type parameters
                        (global.set $sigFnPend (i32.const 1))
                        (global.set $sigFnAngle (i32.const 0)))
                      (else (local.set $hl (enum.get $Token.type))))
                    (local.set $expect (i32.const 0)))
                  (else
                    (local.set $hl (enum.get $Token.variable))
                    (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                      (then
                        ;; capitals name types, constructors when applied, and
                        ;; SCREAMING_CASE constants
                        (local.set $hl
                          (select
                            (enum.get $Token.constructor)
                            (select
                              (enum.get $Token.constant)
                              (enum.get $Token.type)
                              (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))
                            (i32.eq (local.get $c2) (i32.const "(")))))
                      (else
                        (if
                          (i32.or
                            (i32.eq (local.get $c2) (i32.const "("))
                            ;; the older `f!(x)` and `f?(x)` error-handling calls
                            (i32.and
                              (i32.or
                                (i32.eq (local.get $c2) (i32.const "!"))
                                (i32.eq (local.get $c2) (i32.const "?")))
                              (i32.eq
                                (call $templateByte (i32.add (local.get $rhs) (i32.const 1)))
                                (i32.const "("))))
                          (then
                            (local.set $hl
                              (select
                                (enum.get $Token.function.method)
                                (enum.get $Token.function)
                                (i32.and (local.get $member) (i32.const 1)))))
                          (else
                            (if (i32.eq (local.get $member) (i32.const 1))
                              (then (local.set $hl (enum.get $Token.property)))
                              (else
                                ;; `label~` arguments, and names at the top level
                                ;; of a `fn` parameter list before an annotation,
                                ;; `?`, `,`, or `)`
                                (if (i32.eq (local.get $c2) (i32.const "~"))
                                  (then (local.set $hl (enum.get $Token.variable.parameter)))
                                  (else
                                    (if
                                      (i32.and
                                        (i32.and (call $sigActive) (global.get $sigPattern))
                                        (i32.eqz (global.get $sigObscure)))
                                      (then
                                        (local.set $c2
                                          (call $templateByte
                                            (call $lexSkipSpaceAt (local.get $rhs))))
                                        (if
                                          (i32.or
                                            (byteset.get ":),=;]}" (local.get $c2))
                                            (i32.eq (local.get $c2) (i32.const "?")))
                                          (then
                                            (local.set $hl
                                              (enum.get $Token.variable.parameter))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $sig)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (if (i32.eq (local.get $member) (i32.const 1))
              (then
                ;; a tuple index `t.0.1` is only digits
                (loop $index
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br_if $index (call $lexIsDigit (call $templateByte (global.get $ptr))))))
              (else (call $lexScanNumber)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $sig)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $member (i32.const 0))
            ;; the `}` of an open interpolation returns to its string
            (if
              (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.ne (local.get $str) (i32.const 0)))
              (then
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (if (i32.eqz (call $moonbitString (local.get $str) (i32.const 1) (global.get $ptr)))
                  (then (local.set $str (i32.const 0))))
                (br $next)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; parameter machine: a paren may open the armed fn list and puts
            ;; the next name in parameter position; square brackets of a
            ;; pending head hold its type parameters
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (global.set $sigParens (i32.add (global.get $sigParens) (i32.const 1)))
                (if (i32.eqz (global.get $sigFnAngle))
                  (then
                    (if (global.get $sigFnPend)
                      (then (call $sigMark)))
                    (global.set $sigFnPend (i32.const 0))))
                (global.set $sigPattern (i32.const 1))
                (br $next)))
            (global.set $sigPattern (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (call $sigActive)
                  (then (call $sigUnmark)))
                (if (global.get $sigParens)
                  (then (global.set $sigParens (i32.sub (global.get $sigParens) (i32.const 1)))))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then
                (global.set $sigFnAngle
                  (i32.add (global.get $sigFnAngle) (global.get $sigFnPend)))))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "]"))
                (i32.ne (global.get $sigFnAngle) (i32.const 0)))
              (then (global.set $sigFnAngle (i32.sub (global.get $sigFnAngle) (i32.const 1)))))
            ;; outside type parameters, only the `]` closing them keeps a
            ;; pending head
            (if (i32.eqz (global.get $sigFnAngle))
              (then
                (global.set $sigFnPend
                  (i32.and (global.get $sigFnPend) (i32.eq (local.get $c) (i32.const "]"))))))
            (if (call $sigActive)
              (then
                (if (byteset.get "[{" (local.get $c))
                  (then (global.set $sigObscure (i32.add (global.get $sigObscure) (i32.const 1))))
                  (else
                    (if (global.get $sigObscure)
                      (then
                        (global.set $sigObscure (i32.sub (global.get $sigObscure) (i32.const 1)))))))))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (local.set $path (i32.eq (local.get $c2) (i32.const ":")))
            (global.set $ptr (i32.add (i32.add (global.get $ptr) (i32.const 1)) (local.get $path)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.shl (local.get $path) (i32.const 1)))
            (global.set $sigPattern (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            ;; a comma returns to parameter position
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const ",")))
            (br $tok)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                ;; `..` cascades and spreads, `..<` and `..=` ranges
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (local.set $c (call $templateByte (global.get $ptr)))
                (if
                  (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member
                  (select
                    (i32.const 3)
                    (i32.const 0)
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2)))))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))))
            (global.set $sigPattern (i32.const 0))
            (br $next)))

        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                (br_if $op (i32.ne (local.get $c) (i32.const "/")))
                (br_if $op
                  (i32.ne
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                    (i32.const "/")))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (if (i32.eqz (global.get $sigFnAngle))
              (then (global.set $sigFnPend (i32.const 0))))
            (br $sig)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $tok))
        (global.set $sigPattern (i32.const 0)))
        (local.set $member (i32.const 0))
        (br $next))))
)
