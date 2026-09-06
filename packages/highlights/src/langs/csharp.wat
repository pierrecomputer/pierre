(module
  (import "../common.wat")

  (func $csByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $csWordHl below. `where` is absent
  ;; on purpose: the table hash sees only the first two bytes, the last byte,
  ;; and the length, which `while` shares, so $csWordHl matches it directly;
  ;; `unmanaged` collides with `unchecked` the same way and stays out, and
  ;; the rare `on` and `scoped` share their slot bits with `out` in every
  ;; geometry that fits the range.
  (keyword-table $csWords $mem.csharpWords $mem.csharpWords+1280
    (group $Token.keyword.control ;; 1: control
      "if" "do" "for" "try" "case" "else" "goto" "lock" "when" "break"
      "catch" "throw" "while" "yield" "return" "switch" "checked" "default"
      "finally" "foreach" "continue" "unchecked")
    (group $Token.keyword.declaration+256 ;; 2: declaration, next name is a type
      "enum" "class" "record" "struct" "delegate" "interface")
    (group $Token.keyword.declaration+512 "namespace") ;; 3: declaration, next name is a namespace
    (group $Token.keyword.import+512 "using")     ;; 4: import
    (group $Token.keyword.declaration ;; 5: declaration, modifiers, accessors, and query clauses
      "by" "in" "add" "get" "let" "out" "ref" "set" "var" "file" "from"
      "init" "join" "into" "async" "await" "const" "event" "fixed" "group"
      "sealed" "select" "static" "unsafe" "equals" "extern" "global"
      "params" "public" "remove" "managed" "notnull" "orderby" "partial"
      "private" "virtual" "abstract" "explicit" "implicit" "internal"
      "operator" "override" "readonly" "required" "volatile" "ascending"
      "protected" "descending")
    (group $Token.type.builtin ;; 6: built-in types
      "int" "bool" "byte" "char" "long" "nint" "uint" "void" "float" "nuint"
      "sbyte" "short" "ulong" "object" "string" "ushort" "decimal" "double"
      "dynamic")
    (group $Token.boolean "true" "false")    ;; 7: booleans
    (group $Token.constant.builtin "null")            ;; 8: built-in constant
    (group $Token.variable.special "this" "base")     ;; 9: special variables
    (group $Token.keyword.operator ;; 10: word operators
      "is" "as" "new" "typeof" "sizeof" "nameof" "stackalloc"))

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=type, 2=namespace - also after `using`. -1 means an ordinary
  ;; identifier.
  (func $csWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $hl i32)
    (local.set $hl (keyword-table.value $csWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eq (local.get $hl) (i32.const -1))
      (then
        ;; the one word the table cannot hold; the wide load stays inside the
        ;; input slack, as in the table's own compare
        (if (i32.and
              (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                (i64.const "where")))
          (then (return (enum.get $Token.keyword.declaration))))))
    (local.get $hl))

  ;; Scan a string body from $ptr with the string's bytes since $seg still
  ;; unemitted. $kind is 1 for a regular literal - escapes, one line - 2 for
  ;; a `@` verbatim literal - `""` escapes, many lines - and 3 for a `"""`
  ;; raw literal. $interp is 1 for a `$` literal, whose `{` opens an
  ;; interpolation while `{{` and `}}` stay literal braces; $nested is
  ;; nonzero inside an interpolation, where a nested string keeps its braces
  ;; plain so one brace depth suffices. Returns 1 past the closing quote, 2
  ;; past an opening `{` - emitted as punctuation.special, the caller lexes
  ;; the expression - 3 when an escaped line break ends exactly at $end, and
  ;; 0 when the body stops at $end or at a raw line break of a regular
  ;; literal.
  (func $csStringBody
    (param $kind i32) (param $interp i32) (param $nested i32) (param $seg i32)
    (result i32)
    (local $c i32) (local $e i32) (local $stop i32) (local $status i32)
    (local.set $interp (i32.and (local.get $interp) (i32.eqz (local.get $nested))))
    (block $done
      (loop $scan
        ;; every byte before the next quote, backslash, line break, or - in
        ;; an interpolated literal - brace is plain body; each stop class
        ;; is found with one SIMD hop
        (if (local.get $interp)
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $stop))
              (then (local.set $stop (call $lexFindEither
                (global.get $ptr) (i32.const "{") (i32.const "}"))))))
          (else (local.set $stop (global.get $end))))
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (local.get $stop) (i32.const 34)
          (i32.eq (local.get $kind) (i32.const 1)) (i32.eq (local.get $kind) (i32.const 1))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.eq (local.get $kind) (i32.const 2))
              (then
                ;; a doubled quote is a verbatim escape
                (if (i32.eq (call $csByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                    (br $scan)))))
            (if (i32.eq (local.get $kind) (i32.const 3))
              (then
                (if (i32.eqz (i32.and
                      (i32.eq (call $csByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                      (i32.eq (call $csByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $scan)))))
            ;; the trailing quotes of a raw literal read below $end, so this
            ;; cannot overshoot
            (global.set $ptr (i32.add (global.get $ptr)
              (select (i32.const 3) (i32.const 1) (i32.eq (local.get $kind) (i32.const 3)))))
            (local.set $status (i32.const 1))
            (br $done)))
        ;; a raw line break ends a regular literal, unconsumed
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
        ;; a brace: doubled ones are literal, a lone `{` opens an
        ;; interpolation, and a stray `}` is left as body
        (if (i32.eq (call $csByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 1)) (global.get $ptr))
            (return (i32.const 2))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; The string literal prefix at $p: bit 0 for `$`, bit 1 for `@`, in either
  ;; order, the prefix length in bits 4-5, and bit 8 set for any literal;
  ;; zero when no quote follows.
  (func $csStringPrefix (param $p i32) (result i32)
    (local $c i32) (local $flags i32) (local $n i32)
    (block $done
      (loop $l
        (local.set $c (call $csByte (i32.add (local.get $p) (local.get $n))))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then (local.set $flags (i32.or (local.get $flags) (i32.const 1))))
          (else
            (if (i32.eq (local.get $c) (i32.const "@"))
              (then (local.set $flags (i32.or (local.get $flags) (i32.const 2))))
              (else (br $done)))))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br_if $l (i32.lt_u (local.get $n) (i32.const 2)))))
    (if (i32.ne (local.get $c) (i32.const 34)) (then (return (i32.const 0))))
    (i32.or (i32.const 256) (i32.or (local.get $flags) (i32.shl (local.get $n) (i32.const 4)))))

  (func $csIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>?^|~" (local.get $c)))

  ;; $strKind packs an open string body: 1 regular, 2 verbatim, 3 raw, with
  ;; bit 8 for an interpolated literal; $seg is the start of its bytes not
  ;; yet emitted. $interp counts braces inside an interpolation and
  ;; $interpKind remembers which body to return to. $expect is the pending
  ;; next-name capture, $afterType is 1 right after a type - riding through
  ;; the `<`, `>`, `?`, `,`, `[`, `]`, and `.` of a generic, nullable,
  ;; array, or qualified type - so the name before a `(` after it is a
  ;; definition, and $member is 1 after `.`, `?.`, `->`, or `::`. $attr is
  ;; 1 inside a `[...]` that opened a line, whose names are attributes, and
  ;; $lineHead is 1 until the first token of a line. All are checkpointed.
  (func $hlCsharp
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $afterType i32) (local $strKind i32) (local $seg i32)
    (local $interp i32) (local $interpKind i32) (local $status i32)
    (local $attr i32) (local $lineHead i32) (local $atHead i32)
    (local.set $lineHead (i32.const 1))
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
            (local.set $status (call $csStringBody
              (i32.and (local.get $strKind) (i32.const 255))
              (i32.shr_u (local.get $strKind) (i32.const 8))
              (local.get $interp)
              (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                ;; `{` opened an interpolation: code until the matching `}`
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0)))
              (else
                ;; closed, or a regular body cut by a raw line break; a
                ;; verbatim or raw body, or a regular one continued by an
                ;; escaped line break at $end, stays open for the next chunk
                (if (i32.or
                      (i32.eq (local.get $status) (i32.const 1))
                      (i32.and
                        (i32.eq (i32.and (local.get $strKind) (i32.const 255)) (i32.const 1))
                        (i32.eqz (local.get $status))))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            (local.set $attr (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $csByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $csByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.and
                (i32.eq (local.get $c3) (i32.const "*"))
                (i32.ne (call $csByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/")))))
            (br $next)))

        ;; a preprocessor directive owns its line
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (local.get $lineHead))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanToLineEnd)
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        ;; a string opener with its `$`/`@` prefixes and `"""` is emitted at
        ;; once; its body is scanned at the top of the loop, where it can
        ;; also resume after a chunk boundary
        (local.set $kind (call $csStringPrefix (global.get $ptr)))
        (if (local.get $kind)
          (then
            (global.set $ptr (i32.add (global.get $ptr)
              (i32.and (i32.shr_u (local.get $kind) (i32.const 4)) (i32.const 3))))
            (if (i32.and
                  (i32.eq (call $csByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                  (i32.eq (call $csByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))
              (then
                (local.set $strKind (i32.const 3))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3))))
              (else
                (local.set $strKind (select (i32.const 2) (i32.const 1)
                  (i32.and (local.get $kind) (i32.const 2))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $strKind (i32.or (local.get $strKind)
              (i32.shl (i32.and (local.get $kind) (i32.const 1)) (i32.const 8))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        ;; a verbatim identifier `@class` is a plain name
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; a member name is never a keyword: `x.select`, `this.value`
            (local.set $kind (select (i32.const -1)
              (call $csWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; a keyword either arms the next-name capture or ends it
                (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                (local.set $afterType (i32.eq (local.get $hl) (enum.get $Token.type.builtin))))
              (else
                (if (local.get $attr)
                  (then
                    ;; `[Obsolete]`, `[return: NotNull]`: names are attributes,
                    ;; their arguments ordinary code
                    (local.set $hl (select (enum.get $Token.attribute) (enum.get $Token.variable)
                      (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))))
                    (local.set $afterType (i32.const 0)))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.type) (enum.get $Token.namespace)
                          (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $afterType (i32.eq (local.get $expect) (i32.const 1)))
                        ;; a dotted namespace keeps its capture: `Demo.App`
                        (if (i32.or
                              (i32.eq (local.get $expect) (i32.const 1))
                              (i32.ne (call $csByte (local.get $p)) (i32.const ".")))
                          (then (local.set $expect (i32.const 0)))))
                      (else
                        (if (local.get $member)
                          (then
                            ;; `List.Empty` is a nested type or static member,
                            ;; `obj.field` a field, `obj.Call(` a method
                            (if (i32.eq (call $csByte (local.get $p)) (i32.const "("))
                              (then
                                (local.set $hl (enum.get $Token.function.method))
                                (local.set $afterType (i32.const 0)))
                              (else
                                (local.set $afterType (i32.le_u
                                  (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                                (local.set $hl (select (enum.get $Token.type) (enum.get $Token.property)
                                  (local.get $afterType))))))
                          (else
                            (if (i32.eq (call $csByte (local.get $p)) (i32.const "("))
                              (then
                                ;; after a type, `Name(` declares a method;
                                ;; elsewhere it is a call - C# capitalizes
                                ;; methods, so the case says nothing here
                                (local.set $hl (select
                                  (enum.get $Token.function.definition) (enum.get $Token.function)
                                  (local.get $afterType)))
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
                                      (local.get $afterType)))))))))))))))
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

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            ;; a bracket opening a line starts an attribute list
            (if (i32.eq (local.get $c) (i32.const "["))
              (then (local.set $attr (local.get $atHead))))
            (if (i32.eq (local.get $c) (i32.const "]"))
              (then (local.set $attr (i32.const 0))))
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
                        ;; the brace matching `{` returns to the string body
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
            ;; array brackets keep a type pending; the others end it along
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
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.eq (local.get $c2) (i32.const ":")))
            (local.set $afterType (i32.const 0))
            (br $next)))
        ;; member access: `.`, `?.`, and `->`; `..` is a range
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "."))
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c2) (i32.const ".")))
                (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))))
          (then
            (if (i32.eq (local.get $c) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
                  (i32.eq (local.get $c2) (i32.const ".")))))
                (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
                  (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
                (if (i32.eq (local.get $c2) (i32.const "."))
                  (then (local.set $afterType (i32.const 0)))))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))))
            (br $next)))

        (if (call $csIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c2) (i32.const ">")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
              (else
                (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                            (i32.and (i32.eq (local.get $c) (local.get $c2))
                              (byteset.get "&+-<>?|" (local.get $c))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.and
                          (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "?")))
                          (i32.or (i32.eq (call $csByte (global.get $ptr)) (i32.const ">"))
                                  (i32.eq (call $csByte (global.get $ptr)) (i32.const "="))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.and (i32.eq (local.get $c) (i32.const ">"))
                                     (i32.eq (call $csByte (global.get $ptr)) (i32.const "=")))
                          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                    (if (i32.and (i32.eq (local.get $c) (i32.const "<"))
                                 (i32.eq (call $csByte (global.get $ptr)) (i32.const "=")))
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
