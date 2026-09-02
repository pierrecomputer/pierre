(module
  (import "../common.wat")

  (func $dartByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $dartWordHl below. `get` and `set`
  ;; are contextual: $hlDart keeps them in group 3 only when a name follows,
  ;; so `Set<int>` stays a type and `set(x)` a call.
  (keyword-table $dartWords $mem.dartWords $mem.dartWords+1152 64 256
    (group ;; 1: control
      "if" "do" "on" "for" "try" "case" "else" "await" "break" "catch"
      "throw" "while" "yield" "assert" "return" "switch" "default"
      "finally" "rethrow" "continue")
    (group "enum" "class" "mixin" "typedef" "extension") ;; 2: declaration, next name is a type
    (group "get" "set")                                  ;; 3: accessor, next name is a function
    (group ;; 4: import
      "hide" "part" "show" "export" "import" "library" "deferred")
    (group ;; 5: declaration and modifiers
      "var" "base" "late" "with" "async" "const" "final" "static" "sealed"
      "extends" "factory" "abstract" "external" "operator" "required"
      "covariant" "interface" "implements")
    (group ;; 6: built-in types
      "int" "num" "Map" "Set" "Null" "List" "Type" "bool" "void" "Never"
      "Future" "Object" "Stream" "String" "Symbol" "double" "dynamic"
      "Function" "Iterable")
    (group "true" "false")    ;; 7: booleans
    (group "null")            ;; 8: built-in constant
    (group "this" "super")    ;; 9: special variables
    (group "in" "is" "as" "new" "sync")) ;; 10: word operators

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=type, 2=function. -1 means an ordinary identifier; group 3 is left to
  ;; the caller, which knows what follows the word.
  (func $dartWordHl (param $g i32) (result i32)
    (if (i32.eqz (local.get $g)) (then (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 1)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.eq (local.get $g) (i32.const 9))
      (then (return (enum.get $Token.variable.special))))
    (enum.get $Token.keyword.operator))

  ;; Scan a string body from $ptr with the string's bytes since $seg still
  ;; unemitted, emitting plain runs, escapes, and `$name` interpolations as
  ;; it goes. $quote is the quote byte, $triple selects a `'''`/`"""` body,
  ;; and $raw an `r` literal that keeps backslashes and dollars plain.
  ;; Returns 1 past the closing quote, 2 past a `${` that opens an
  ;; interpolation - emitted as punctuation.special, the caller lexes the
  ;; expression - 3 when an escaped line break ends exactly at $end, so a
  ;; streaming caller keeps the string open, and 0 when the body stops at
  ;; $end or at a raw line break of a single-line string. $interp is
  ;; nonzero inside an interpolation, where a nested string keeps `${` as
  ;; plain text so one brace depth suffices.
  (func $dartStringBody
    (param $quote i32) (param $triple i32) (param $raw i32) (param $interp i32)
    (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $template i32)
    (local $stop i32) (local $dollar i32) (local $status i32)
    (local.set $stop (global.get $ptr))
    (local.set $dollar (global.get $ptr))
    (block $done
      (loop $scan
        ;; the next stop byte - the quote, plus backslash and CR/LF in a
        ;; single-line string - and the next `$` before it are each found
        ;; with one SIMD hop and rescanned only once $ptr passes them
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (local.get $quote)
              (i32.eqz (local.get $raw)) (i32.eqz (local.get $triple))))
            (local.set $dollar (select (local.get $stop)
              (call $scanFindSpecial
                (global.get $ptr) (local.get $stop) (i32.const "$")
                (i32.const 0) (i32.const 0))
              (local.get $raw))))
          (else
            (if (i32.gt_u (global.get $ptr) (local.get $dollar))
              (then (local.set $dollar (select (local.get $stop)
                (call $scanFindSpecial
                  (global.get $ptr) (local.get $stop) (i32.const "$")
                  (i32.const 0) (i32.const 0))
                (local.get $raw)))))))
        (global.set $ptr (select (local.get $dollar) (local.get $stop)
          (i32.lt_u (local.get $dollar) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (if (i32.or (i32.eqz (local.get $triple))
                  (i32.and
                    (i32.eq (call $dartByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $quote))
                    (i32.eq (call $dartByte (i32.add (global.get $ptr) (i32.const 2))) (local.get $quote))))
              (then
                ;; both trailing quotes read below $end, so this cannot overshoot
                (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1) (local.get $triple))))
                (local.set $status (i32.const 1))
                (br $done)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        ;; a raw line break ends a single-line string, unconsumed
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (if (i32.and
                  (i32.eq (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13))))
              (then (local.set $status (i32.const 3))))
            (br $scan)))
        ;; `$`: an interpolation when a brace or a name follows
        (local.set $c2 (call $dartByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.eqz (local.get $interp)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            ;; the `{` was read below $end, so this cannot overshoot
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.const 2))))
        (if (call $lexIsIdentStart (local.get $c2))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $template (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable) (local.get $template) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  (func $dartIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))))))))

  ;; $strKind packs an open string body: the quote byte, bit 8 for a triple
  ;; body, bit 9 for a raw literal; $seg is the start of its bytes not yet
  ;; emitted. $interp counts braces inside a `${` interpolation and
  ;; $interpKind remembers which body to return to. $expect is the pending
  ;; next-name capture, $afterType is 1 right after a type - riding through
  ;; the `<`, `>`, `?`, `,`, `[`, `]`, and `.` of a generic, nullable, or
  ;; qualified type - so the name before a `(` after it is a definition, and
  ;; $member is 1 after `.`, `?.`, or a cascade. All are checkpointed.
  (func $hlDart
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $afterType i32) (local $strKind i32) (local $seg i32)
    (local $interp i32) (local $interpKind i32) (local $status i32) (local $g i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $strKind)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $dartStringBody
              (i32.and (local.get $strKind) (i32.const 255))
              (i32.and (local.get $strKind) (i32.const 256))
              (i32.and (local.get $strKind) (i32.const 512))
              (local.get $interp)
              (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                ;; `${` opened an interpolation: code until the matching `}`
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0)))
              (else
                ;; closed, or a single-line body cut by a raw line break; a
                ;; triple body, or a single-line one continued by an escaped
                ;; line break at $end, stays open for the next chunk
                (if (i32.or
                      (i32.eq (local.get $status) (i32.const 1))
                      (i32.and
                        (i32.eqz (i32.and (local.get $strKind) (i32.const 256)))
                        (i32.eqz (local.get $status))))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $dartByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $dartByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            ;; Dart block comments nest
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.and
                (i32.eq (local.get $c3) (i32.const "*"))
                (i32.ne (call $dartByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/")))))
            (br $next)))

        ;; a string opener - with an optional `r` raw prefix - is emitted at
        ;; once; its body is scanned at the top of the loop, where it can
        ;; also resume after a chunk boundary
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (i32.and (i32.eq (local.get $c) (i32.const "r"))
                (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39)))))
          (then
            (local.set $strKind (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "r"))
              (then
                (local.set $strKind (i32.const 512))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $c (local.get $c2))
                (local.set $c2 (local.get $c3))
                (local.set $c3 (call $dartByte (i32.add (global.get $ptr) (i32.const 2))))))
            (local.set $strKind (i32.or (local.get $strKind) (local.get $c)))
            (if (i32.and (i32.eq (local.get $c2) (local.get $c)) (i32.eq (local.get $c3) (local.get $c)))
              (then
                (local.set $strKind (i32.or (local.get $strKind) (i32.const 256)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3))))
              (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        ;; annotations
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $g (keyword-table.get $dartWords (local.get $lhs) (local.get $rhs)))
            ;; `get`/`set` are accessor keywords only before a name
            (if (i32.and
                  (i32.eq (local.get $g) (i32.const 3))
                  (i32.eqz (call $lexIsIdentStart (call $dartByte (local.get $p)))))
              (then (local.set $g (i32.const 0))))
            (local.set $kind (call $dartWordHl (local.get $g)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; a bare keyword either arms the next-name capture or ends
                ;; it; `x.new` names nothing
                (if (i32.eqz (local.get $member))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                (local.set $afterType (i32.eq (local.get $hl) (enum.get $Token.type.builtin))))
              (else
                (if (local.get $expect)
                  (then
                    (local.set $hl (select (enum.get $Token.type) (enum.get $Token.function.definition)
                      (i32.eq (local.get $expect) (i32.const 1))))
                    (local.set $afterType (i32.eq (local.get $expect) (i32.const 1)))
                    (local.set $expect (i32.const 0)))
                  (else
                    (if (local.get $member)
                      (then
                        ;; `Foo.bar(` is a method, `Foo.Bar` a nested or
                        ;; prefixed type, `obj.field` a field
                        (if (i32.eq (call $dartByte (local.get $p)) (i32.const "("))
                          (then
                            (local.set $hl (enum.get $Token.function.method))
                            (local.set $afterType (i32.const 0)))
                          (else
                            (local.set $afterType (i32.le_u
                              (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                            (local.set $hl (select (enum.get $Token.type) (enum.get $Token.property)
                              (local.get $afterType))))))
                      (else
                        (if (i32.eq (call $dartByte (local.get $p)) (i32.const "("))
                          (then
                            ;; `Foo(` is a constructor; a lowercase name after
                            ;; a type is the function being declared
                            (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type)))
                              (else (local.set $hl (select
                                (enum.get $Token.function.definition) (enum.get $Token.function)
                                (local.get $afterType)))))
                            (local.set $afterType (i32.const 0)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then
                                (local.set $hl (enum.get $Token.constant))
                                (local.set $afterType (i32.const 0)))
                              (else
                                (local.set $afterType (i32.le_u
                                  (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                                (local.set $hl (select (enum.get $Token.type) (enum.get $Token.variable)
                                  (local.get $afterType)))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
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
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (local.set $expect (i32.const 0))
                        (local.set $afterType (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; list brackets keep a type pending; the others end it along
            ;; with any declaration head
            (if (i32.and (i32.ne (local.get $c) (i32.const "[")) (i32.ne (local.get $c) (i32.const "]")))
              (then
                (local.set $afterType (i32.const 0))
                (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))
        ;; `.` member access, `..` cascade, `...` spread, and `?.`
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "."))
              (i32.and (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c2) (i32.const "."))))
          (then
            (if (i32.eq (local.get $c) (i32.const "?"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (local.get $c2) (i32.const "."))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.eq (local.get $c3) (i32.const "."))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
                  (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
                ;; a cascade names a member too; a spread does not
                (local.set $member (i32.ne (local.get $c3) (i32.const ".")))))
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))

        (if (call $dartIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or
                  (i32.and (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c2) (i32.const ">")))
                  (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c2) (i32.const "/"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c3) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
              (else
                (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                            (i32.and (i32.eq (local.get $c) (local.get $c2))
                              (i32.or
                                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                                (i32.or
                                  (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                                  (i32.or
                                    (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))
                                    (i32.eq (local.get $c) (i32.const "?")))))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.and
                          (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "?")))
                          (i32.or (i32.eq (call $dartByte (global.get $ptr)) (i32.const ">"))
                                  (i32.eq (call $dartByte (global.get $ptr)) (i32.const "="))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.and (i32.eq (local.get $c) (i32.const ">"))
                                     (i32.eq (call $dartByte (global.get $ptr)) (i32.const "=")))
                          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                    (if (i32.and (i32.eq (local.get $c) (i32.const "<"))
                                 (i32.eq (call $dartByte (global.get $ptr)) (i32.const "=")))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; the angles of a generic - `>>` closes two - and a nullable
            ;; `?` keep the type pending; any other operator ends it
            (if (i32.eqz (call $lexIsTypeGlue (local.get $lhs) (global.get $ptr)))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $afterType (i32.const 0))
        (br $next))))
)
