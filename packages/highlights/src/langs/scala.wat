(module
  (import "../common.wat")

  ;; Group order is the dispatch order in $scalaWordHl below.
  (keyword-table $scalaWords $mem.scalaWords $mem.solidityWords
    (group $Token.keyword.control ;; 1: control
      "if" "else" "then" "match" "case" "do" "while" "for" "yield" "return" "throw" "try" "catch"
      "finally" "end")
    (group $Token.keyword.declaration+256 "def") ;; 2: declaration, next name is a function
    (group $Token.keyword.declaration+512 ;; 3: declaration, next name is a type
      "class" "trait" "object" "type" "enum")
    (group $Token.keyword.declaration ;; 4: declaration
      "val" "var" "lazy" "given" "extension")
    (group $Token.keyword.import "import" "export" "package") ;; 5: import
    (group $Token.keyword ;; 6: modifiers and other keywords
      "abstract" "final" "sealed" "implicit" "override" "private" "protected" "inline" "opaque"
      "open" "transparent" "infix" "using" "extends" "with" "derives" "new" "forSome" "macro")
    (group $Token.boolean "true" "false")  ;; 7: booleans
    (group $Token.constant.builtin "null")          ;; 8: built-in constant
    (group $Token.variable.special "this" "super")) ;; 9: special variables

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type. -1 for an ordinary name.
  (func $scalaWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $scalaWords (local.get $lhs) (local.get $rhs)))

  ;; Scan a `"` or `"""` body from $ptr. Bytes from $seg are not yet emitted.
  ;; Only non-raw, single-quoted bodies process backslash escapes.
  ;; $expand enables `$name`, `${...}`, and `$$` for interpolated strings.
  ;; Return 1 after the quote, 2 after `${`, 3 after an escaped line break
  ;; at $end, or 0 at $end or a single-line string's raw line break.
  ;; Emit `${` as punctuation.special. $nested keeps `${` literal inside
  ;; a string nested in an interpolation.
  (func $scalaStringBody
    (param $triple i32)
    (param $expand i32)
    (param $raw i32)
    (param $nested i32)
    (result i32)
    (local $seg i32)
    (local $c i32)
    (local $c2 i32)
    (local $stop i32)
    (local $dollar i32)
    (local $status i32)
    (local.set $seg (global.get $ptr))
    (local.set $stop (global.get $ptr))
    (block $done
      (loop $scan
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (i32.const 34)
                (i32.eqz (local.get $triple))
                (i32.eqz (local.get $triple))))
            ;; a plain body has no `$` stop; zero, below $ptr, makes an
            ;; interpolated one search for the next
            (local.set $dollar (select (i32.const 0) (local.get $stop) (local.get $expand)))))
        (if (i32.gt_u (global.get $ptr) (local.get $dollar))
          (then
            (local.set $dollar
              (call $scanFindSpecial
                (global.get $ptr)
                (local.get $stop)
                (i32.const "$")
                (i32.const 0)
                (i32.const 0)))))
        (global.set $ptr
          (select
            (local.get $dollar)
            (local.get $stop)
            (i32.lt_u (local.get $dollar) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if
              (i32.or
                (i32.eqz (local.get $triple))
                (i32.and
                  (i32.eq
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                    (i32.const 34))
                  (i32.eq
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 2)))
                    (i32.const 34))))
              (then
                ;; both trailing quotes read below $end, so this cannot overshoot
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (select (i32.const 3) (i32.const 1) (local.get $triple))))
                (local.set $status (i32.const 1))
                (br $done)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        ;; a raw line break ends a single-line string, unconsumed
        (br_if $done
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (if (local.get $raw)
              (then
                (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (global.set $ptr
                  (i32.add (global.get $ptr)
                    (select (i32.const 2) (i32.const 1)
                      (byteset.get "\22\5c" (local.get $c2)))))
                (br $scan)))
            (if (call $stringEscapeAt (local.get $seg))
              (then (local.set $status (i32.const 3))))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; `$`: a splice, an escaped dollar, or a name
        (local.set $seg (call $stringDollarAt (local.get $seg) (i32.const 8) (local.get $nested)))
        (br_if $scan (i32.ge_s (local.get $seg) (i32.const 0)))
        (return (i32.const 2))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  (func $scalaIsOp (param $c i32) (result i32)
    (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c)))

  ;; $strKind is 1 inside a `"` body, 2 inside `"""`, and 3 or 4 for their
  ;; interpolated forms, 5 or 6 for `raw`, its body resuming at $ptr;
  ;; $interp counts braces inside a `${` splice and $interpKind remembers
  ;; which body to return to. $expect is 1 after `def` and 2 after a type
  ;; keyword; $member is 1 after `.`; $importCtx is 1 on an import or
  ;; package line, where dotted names are namespaces. All are
  ;; checkpointed.
  (func $hlScala
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $e i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (local $wasMember i32)
    (local $importCtx i32)
    (local $strKind i32)
    (local $interp i32)
    (local $interpKind i32)
    (local $status i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; every path here leaves its unemitted bytes
        ;; starting at $ptr, as does a chunk boundary
        (if (local.get $strKind)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $status
              (call $scalaStringBody
                (i32.eqz (i32.and (local.get $strKind) (i32.const 1)))
                (i32.ge_u (local.get $strKind) (i32.const 3))
                (i32.ge_u (local.get $strKind) (i32.const 5))
                (local.get $interp)))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                ;; `${` opened a splice: code until the matching `}`
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0)))
              (else
                ;; closed, or a single-line body cut by a raw line break; a
                ;; triple body, or a single-line one continued by an escaped
                ;; line break at $end, stays open for the next chunk
                (if
                  (i32.or
                    (i32.eq (local.get $status) (i32.const 1))
                    (i32.and
                      (i32.and (local.get $strKind) (i32.const 1))
                      (i32.eqz (local.get $status))))
                  (then (local.set $strKind (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; an import line ends at its line break
        (if (local.get $importCtx)
          (then
            (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
              (then (local.set $importCtx (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))
        ;; only `.` sets $member, and comments and annotations keep it;
        ;; every other token clears it
        (local.set $wasMember (local.get $member))
        (local.set $member (i32.const 0))

        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (local.set $member (local.get $wasMember))
            (br $next)))
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment
              (i32.const "/*")
              (i32.const "*/")
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.eq (local.get $c3) (i32.const "*"))))
            (local.set $member (local.get $wasMember))
            (br $next)))

        ;; a string opener is emitted at once; its body is scanned at the top
        ;; of the loop, where it can also resume after a chunk boundary
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $strKind (i32.const 1))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const 34))
                (i32.eq (local.get $c3) (i32.const 34)))
              (then
                (local.set $strKind (i32.const 2))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `'c'` and `'\n'` character literals, `'name` symbols
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then (local.set $e (call $lexEscapeEnd (i32.add (global.get $ptr) (i32.const 1)))))
              (else
                (local.set $e
                  (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))))
            (if
              (i32.and
                (i32.gt_u (local.get $c2) (i32.const 0))
                (i32.eq (call $templateByte (local.get $e)) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (local.get $e) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))
              (else
                (if
                  (i32.or
                    (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                    (i32.or (i32.eq (local.get $c2) (i32.const "_")) (i32.ge_u (local.get $c2) (i32.const 128))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $lexScanIdent)
                    (call $emitTok
                      (enum.get $Token.string.special.symbol)
                      (local.get $lhs)
                      (global.get $ptr)))
                  (else
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 96))
          (then
            (call $lexRawString (i32.const 96) (i32.const 0) (enum.get $Token.variable))
            (br $next)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "@"))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.or (i32.eq (local.get $c2) (i32.const "_")) (i32.ge_u (local.get $c2) (i32.const 128)))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "."))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (local.get $wasMember))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            ;; `s"..."`: an interpolator prefix, then the string opener
            (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const 34))
              (then
                (call $emitTok (enum.get $Token.function) (local.get $lhs) (local.get $rhs))
                (local.set $strKind (i32.const 3))
                (if
                  (i32.and
                    (i32.eq
                      (call $templateByte (i32.add (local.get $rhs) (i32.const 1)))
                      (i32.const 34))
                    (i32.eq
                      (call $templateByte (i32.add (local.get $rhs) (i32.const 2)))
                      (i32.const 34)))
                  (then
                    (local.set $strKind (i32.const 4))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
                (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                  (then
                    (if (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "raw"))
                      (then (local.set $strKind (i32.add (local.get $strKind) (i32.const 2)))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $rhs) (global.get $ptr))
                (local.set $expect (i32.const 0))
                (br $next)))
            ;; `package object util`: `object` ends the package line
            (if (local.get $importCtx)
              (then
                (if
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 6))
                    (i64.eq
                      (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff))
                      (i64.const "object")))
                  (then (local.set $importCtx (i32.const 0))))))
            (local.set $kind (i32.const -1))
            (if (i32.eqz (i32.or (local.get $wasMember) (local.get $importCtx)))
              (then (local.set $kind (call $scalaWordHl (local.get $lhs) (local.get $rhs)))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                (if (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                  (then (local.set $importCtx (i32.const 1)))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $importCtx)
                  (then (local.set $hl (enum.get $Token.namespace)))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl
                          (select
                            (enum.get $Token.function.definition)
                            (enum.get $Token.type)
                            (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $expect (i32.const 0)))
                      (else
                        ;; a block argument calls too: `xs.foreach { … }`
                        (local.set $c2 (call $templateByte (local.get $p)))
                        (local.set $e
                          (i32.or (i32.eq (local.get $c2) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "{"))))
                        (if (local.get $wasMember)
                          (then
                            (local.set $hl (enum.get $Token.property))
                            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type))))
                            (if (local.get $e)
                              (then (local.set $hl (enum.get $Token.function.method)))))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (if
                                  (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else
                                    (local.set $hl
                                      (select
                                        (enum.get $Token.function)
                                        (enum.get $Token.variable)
                                        (local.get $e)))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the brace matching `${` returns to the string body
                        (call $emitTok
                          (enum.get $Token.punctuation.special)
                          (local.get $lhs)
                          (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $expect (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; `def foo[T]` rides its type parameters; any other bracket
            ;; ends a pending head
            (if
              (i32.eqz
                (i32.or
                  (i32.eq (local.get $c) (i32.const "["))
                  (i32.eq (local.get $c) (i32.const "]"))))
              (then (local.set $expect (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then (local.set $importCtx (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $expect (i32.const 0))
                (local.set $importCtx (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))
        ;; a lone `:` ascribes a type; with more symbols it is an operator
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ":"))
            (i32.eqz (call $scalaIsOp (local.get $c2))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        (if (call $scalaIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c2 (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (call $scalaIsOp (local.get $c2))))
                ;; a comment opener ends the run
                (if (i32.eq (local.get $c2) (i32.const "/"))
                  (then
                    (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                    (br_if $opDone
                      (i32.or (i32.eq (local.get $c2) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*"))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then (local.set $importCtx (i32.const 0))))
            (br $next)))

        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
