(module
  (import "../common.wat")
  (import "./ocaml.wat")

  (func $fsByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlFsharp. The high byte of a
  ;; declaration value names the pending capture: 1 a value binding whose
  ;; name is a function when arguments follow, 2 a type, 3 a module or
  ;; namespace line, 5 a member whose self identifier and name follow.
  (keyword-table $fsharpWords $mem.fsharpWords $mem.fsharpWords+1024
    (group $Token.keyword.control ;; 1: control flow
      "if" "then" "elif" "else" "match" "with" "when" "for" "to" "downto"
      "while" "do" "done" "try" "finally" "raise" "failwith" "yield" "return"
      "begin" "end" "function" "fun" "lazy" "assert" "in")
    (group $Token.keyword.declaration+256 "let" "and" "rec" "use") ;; 2: value bindings
    (group $Token.keyword.declaration+512 "type" "exception")      ;; 3: type declarations
    (group $Token.keyword.declaration+768 "module" "namespace" "open") ;; 4: module names
    (group $Token.keyword.declaration+1280 ;; 5: members
      "member" "override" "abstract" "default")
    (group $Token.keyword.declaration ;; 6: other declarations and modifiers
      "as" "val" "static" "mutable" "inline" "interface" "inherit" "new"
      "class" "struct" "delegate" "of" "internal" "private" "public" "extern"
      "global" "upcast" "downcast" "base" "void" "fixed")
    (group $Token.keyword.operator ;; 7: word operators
      "or" "not" "mod" "land" "lor" "lxor" "lsl" "lsr" "asr")
    (group $Token.type.builtin ;; 8: built-in types
      "int" "int8" "int16" "int32" "int64" "uint8" "uint16" "uint32" "uint64"
      "byte" "sbyte" "float" "float32" "double" "single" "decimal" "bigint"
      "bool" "char" "string" "unit" "obj" "exn" "list" "option" "seq" "array"
      "nativeint" "unativeint" "byref" "inref" "outref")
    (group $Token.boolean "true" "false")           ;; 9
    (group $Token.constant.builtin "null")          ;; 10
    (group $Token.variable.special "this" "__"))    ;; 11

  ;; Token in the low byte and the capture in the high byte, or -1 for an
  ;; ordinary identifier.
  (func $fsWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $fsharpWords (local.get $lhs) (local.get $rhs)))

  ;; Scan a string body from $ptr with the bytes since $seg still unemitted.
  ;; $kind has bit 1 for `"""`, bit 2 for a verbatim `@"` body whose only
  ;; escape is `""`, and bit 4 for an interpolated `$"` body with `{expr}`
  ;; splices and `{{` `}}` escapes. Every form spans lines. Returns 1 past
  ;; the closer, 2 past a `{` that opens a splice - emitted as
  ;; punctuation.special, the caller lexes the expression - and 0 at $end.
  ;; $nested is nonzero inside a splice, where a nested string keeps `{`
  ;; plain.
  (func $fsStringBody (param $kind i32) (param $nested i32) (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $p i32)
    (local $verbatim i32) (local $interp i32)
    (local.set $verbatim (i32.ne (i32.and (local.get $kind) (i32.const 2)) (i32.const 0)))
    (local.set $interp (i32.ne (i32.and (local.get $kind) (i32.const 4)) (i32.const 0)))
    (block $done
      (loop $scan
        (if (local.get $verbatim)
          (then
            (if (local.get $interp)
              (then (local.set $p (call $lexFindEither (global.get $ptr) (i32.const 34) (i32.const "{"))))
              (else (local.set $p (call $lexFindByte (global.get $ptr) (i32.const 34))))))
          (else
            (if (local.get $interp)
              (then (local.set $p (call $scanFind3 (global.get $ptr) (i32.const 34) (i32.const 92) (i32.const "{"))))
              (else (local.set $p (call $scanFindSpecial
                (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 0)))))))
        ;; an interpolated body also escapes `}}`, found inside the run
        (if (local.get $interp)
          (then
            (local.set $e (call $scanFindSpecial
              (global.get $ptr) (local.get $p) (i32.const "}") (i32.const 0) (i32.const 0)))
            (if (i32.lt_u (local.get $e) (local.get $p))
              (then
                (if (i32.eq (call $fsByte (i32.add (local.get $e) (i32.const 1))) (i32.const "}"))
                  (then
                    (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $e))
                    (global.set $ptr (i32.add (local.get $e) (i32.const 2)))
                    (call $emitTok (enum.get $Token.string.escape) (local.get $e) (global.get $ptr))
                    (local.set $seg (global.get $ptr)))
                  (else (global.set $ptr (i32.add (local.get $e) (i32.const 1)))))
                (br $scan)))))
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (local.get $p))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $c2 (call $fsByte (i32.add (local.get $p) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.and (local.get $kind) (i32.const 1))
              (then
                (if (i32.and
                      (i32.eq (local.get $c2) (i32.const 34))
                      (i32.eq (call $fsByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34)))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 3)))
                    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                    (return (i32.const 1))))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (br $scan)))
            ;; a doubled quote escapes itself in a verbatim body
            (if (i32.and (local.get $verbatim) (i32.eq (local.get $c2) (i32.const 34)))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (br $scan)))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (local.set $e (call $lexEscapeEnd (local.get $p)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        ;; `{`: an escaped brace or a splice
        (if (i32.eq (local.get $c2) (i32.const "{"))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if (i32.eqz (local.get $nested))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (return (i32.const 2))))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; the end of the identifier run at $p, primes included
  (func $fsIdEnd (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (i32.or
          (call $lexIsIdentContinue (i32.load8_u (local.get $p)))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 39)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Whether the bytes at $p begin an argument of an application: a value
  ;; start that is not a keyword, so `match s with` does not apply `s`.
  (func $fsIsArgAt (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (call $fsByte (local.get $p)))
    (if (i32.eqz (call $mlIsArgStart (local.get $c)))
      (then (return (i32.const 0))))
    (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
      (then (return (i32.lt_s
        (call $fsWordHl (local.get $p) (call $fsIdEnd (local.get $p)))
        (i32.const 0)))))
    (i32.const 1))

  ;; $strKind is one more than the body kind of $fsStringBody while a string
  ;; is open, with $seg the start of the bytes not yet emitted; $interp
  ;; counts braces inside a `{` splice and $interpKind remembers which body
  ;; to return to. $expect is the pending capture: 1 after `let`, `and`,
  ;; `rec`, or `use` - the name is a function when arguments follow - 2
  ;; after `type`, 3 on a module, namespace, or open line, 5 after `member`
  ;; and its kin, whose self identifier precedes the `.name`. $typeMode is 1
  ;; inside a type annotation, where lowercase names are types; $member is 1
  ;; after `.` and 2 after a module's `.`; $afterValue is 1 after a value, so
  ;; the head of an application can be told from its arguments; $attr is 1
  ;; inside `[< ... >]`. All are checkpointed.
  (func $hlFsharp
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $pc i32)
    (local $kind i32) (local $hl i32) (local $status i32) (local $n i32)
    (local $strKind i32) (local $seg i32) (local $interp i32) (local $interpKind i32)
    (local $expect i32) (local $member i32) (local $typeMode i32) (local $afterValue i32)
    (local $lastModule i32) (local $attr i32)
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
            (local.set $status (call $fsStringBody
              (i32.sub (local.get $strKind) (i32.const 1)) (local.get $interp) (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0))
                (local.set $afterValue (i32.const 0)))
              (else
                (if (i32.eq (local.get $status) (i32.const 1))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))
                    (local.set $afterValue (i32.const 1))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break ends a module, namespace, or open line, and starts
        ;; a new expression where the first name may head an application
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $afterValue (i32.const 0))
            (if (i32.eq (local.get $expect) (i32.const 3))
              (then (local.set $expect (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $fsByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $fsByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; `//` comments, `///` documents; `(* ... *)` nests but `(*)` is an
        ;; operator
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.and (i32.eq (local.get $c3) (i32.const "/"))
                (i32.ne (call $fsByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/")))))
            (br $next)))
        (if (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "*")))
              (i32.ne (local.get $c3) (i32.const ")")))
          (then
            (call $lexNestedBlockComment (i32.const "(*") (i32.const "*)") (enum.get $Token.comment))
            (br $next)))
        ;; `#if`, `#else`, `#endif`, `#r`, `#load`, `#nowarn` directives
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; string openers - `"`, `"""`, `@"`, `$"`, `$@"`, `@$"`, `$"""` - are
        ;; emitted at once; the body is scanned at the top of the loop, where
        ;; it can also resume after a chunk boundary
        (local.set $n (i32.const 0))
        (local.set $p (global.get $ptr))
        (block $prefixDone
          (loop $prefix
            (local.set $pc (call $fsByte (local.get $p)))
            (if (i32.eq (local.get $pc) (i32.const "@"))
              (then (local.set $n (i32.or (local.get $n) (i32.const 2))))
              (else
                (if (i32.eq (local.get $pc) (i32.const "$"))
                  (then (local.set $n (i32.or (local.get $n) (i32.const 4))))
                  (else (br $prefixDone)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $prefixDone (i32.gt_u (local.get $p) (i32.add (global.get $ptr) (i32.const 2))))
            (br $prefix)))
        (if (i32.eq (call $fsByte (local.get $p)) (i32.const 34))
          (then
            (if (i32.and
                  (i32.eq (call $fsByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
                  (i32.eq (call $fsByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34)))
              (then
                (local.set $n (i32.or (local.get $n) (i32.const 1)))
                (local.set $p (i32.add (local.get $p) (i32.const 2)))))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strKind (i32.add (local.get $n) (i32.const 1)))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (call $mlIsCharLiteral (global.get $ptr)))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 1))
            (br $next)))
        ;; `'T` type parameters
        (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const 39))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `[< ... >]` attributes
        (if (i32.and (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c2) (i32.const "<")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 1))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.and (i32.eq (local.get $c2) (i32.const "]")) (local.get $attr)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $attr (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            ;; primes continue a name: x', f''
            (call $scanIdentRun (i32.const 39))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $fsByte (local.get $p)))
            (local.set $kind (select (i32.const -1)
              (call $fsWordHl (local.get $lhs) (local.get $rhs))
              (i32.or (local.get $member) (local.get $attr))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; a capture keyword sets the pending name; a modifier such
                ;; as `mutable` or `inline` keeps it; anything else ends it
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))
                  (else
                    (if (i32.ne (local.get $hl) (enum.get $Token.keyword.declaration))
                      (then (local.set $expect (i32.const 0))))))
                ;; `of` and `:` open a type; `in`, `=`, and the rest close it
                (local.set $typeMode (i32.and
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                  (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "of"))))
                (local.set $afterValue (i32.or
                  (i32.or
                    (i32.eq (local.get $hl) (enum.get $Token.boolean))
                    (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))
                  (i32.eq (local.get $hl) (enum.get $Token.variable.special)))))
              (else
                (if (local.get $attr)
                  (then (local.set $hl (enum.get $Token.attribute)))
                  (else
                    (if (i32.eq (local.get $expect) (i32.const 3))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else
                        (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                          (then
                            ;; `Foo.bar` names a module, a bare `Foo` a
                            ;; constructor, and in a type position a type
                            (local.set $lastModule (i32.eq (call $fsByte (local.get $rhs)) (i32.const ".")))
                            (local.set $hl (enum.get $Token.constructor))
                            (if (i32.or (local.get $typeMode) (i32.eq (local.get $expect) (i32.const 2)))
                              (then (local.set $hl (enum.get $Token.type))))
                            (if (i32.and (local.get $lastModule) (i32.eqz (local.get $member)))
                              (then (local.set $hl (enum.get $Token.namespace))))
                            (if (local.get $member)
                              (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                                (call $mlIsArgStart (local.get $pc))))))
                            (if (i32.eq (local.get $expect) (i32.const 2))
                              (then (local.set $expect (i32.const 0)))))
                          (else
                            (if (i32.eq (local.get $expect) (i32.const 1))
                              (then
                                ;; `let f x =` defines a function, `let x =` a value
                                (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.variable)
                                  (call $mlIsArgStart (local.get $pc))))
                                (local.set $expect (i32.const 0)))
                              (else
                                (if (i32.eq (local.get $expect) (i32.const 2))
                                  (then
                                    (local.set $hl (enum.get $Token.type))
                                    (local.set $expect (i32.const 0)))
                                  (else
                                    (if (i32.eq (local.get $expect) (i32.const 5))
                                      (then
                                        ;; `member this.Name`: the self identifier,
                                        ;; then the member
                                        (if (i32.eq (call $fsByte (local.get $rhs)) (i32.const "."))
                                          (then (local.set $hl (enum.get $Token.variable)))
                                          (else
                                            (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                                              (call $mlIsArgStart (local.get $pc))))
                                            (local.set $expect (i32.const 0)))))
                                      (else
                                        (if (local.get $typeMode)
                                          (then (local.set $hl (enum.get $Token.type)))
                                          (else
                                            (if (local.get $member)
                                              (then (local.set $hl (select
                                                (enum.get $Token.function.method) (enum.get $Token.property)
                                                (call $mlIsArgStart (local.get $pc)))))
                                              (else
                                                ;; the head of an application - a name
                                                ;; before an argument that no value
                                                ;; precedes - is the function applied
                                                (local.set $hl (select (enum.get $Token.function) (enum.get $Token.variable)
                                                  (i32.and
                                                    (i32.eqz (local.get $afterValue))
                                                    (call $fsIsArgAt (local.get $p)))))))))))))))))))))
                (local.set $afterValue (i32.or
                  (i32.or
                    (i32.eq (local.get $hl) (enum.get $Token.variable))
                    (i32.eq (local.get $hl) (enum.get $Token.function)))
                  (i32.or
                    (i32.eq (local.get $hl) (enum.get $Token.constructor))
                    (i32.eq (local.get $hl) (enum.get $Token.property)))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 1))
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
                        ;; the brace matching the splice returns to the string body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (byteset.get ")]}" (local.get $c)))
            (if (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "]")))
              (then (local.set $typeMode (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (if (i32.ne (local.get $expect) (i32.const 3))
                  (then (local.set $expect (i32.const 0))))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.and (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c2) (i32.const ";"))))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 0))
            (local.set $typeMode (i32.const 0))
            (if (i32.ne (local.get $expect) (i32.const 3))
              (then (local.set $expect (i32.const 0))))
            (br $next)))
        ;; `.` names a member, `Foo.` a module member; `..` is a range
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.ne (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (select (i32.const 2) (i32.const 1) (local.get $lastModule)))
            (local.set $afterValue (i32.const 0))
            (br $next)))

        (if (call $mlIsSymbol (local.get $c))
          (then
            (block $symbolDone
              (loop $symbol
                (br_if $symbolDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $symbolDone (i32.eqz (i32.or
                  (call $mlIsSymbol (i32.load8_u (global.get $ptr)))
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ".")))))
                ;; a comment opener or a closing `>]` ends the run
                (br_if $symbolDone (i32.and
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/"))
                  (i32.eq (call $fsByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "/"))))
                (br_if $symbolDone (i32.and
                  (i32.gt_u (global.get $ptr) (local.get $lhs))
                  (i32.and
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ">"))
                    (i32.eq (call $fsByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "]")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $symbol)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
            ;; `:` opens a type annotation, `->` keeps it, `=` and `|` end
            ;; it; `::` is the cons operator
            (if (i32.eq (local.get $n) (i32.const 1))
              (then
                (if (i32.eq (local.get $c) (i32.const ":"))
                  (then (local.set $typeMode (i32.const 1))))
                (if (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "|")))
                  (then
                    (local.set $typeMode (i32.const 0))
                    (if (i32.ne (local.get $expect) (i32.const 3))
                      (then (local.set $expect (i32.const 0))))))))
            (if (i32.and (i32.eq (local.get $n) (i32.const 2)) (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "::")))
              (then (local.set $typeMode (i32.const 0))))
            (local.set $member (i32.const 0))
            (local.set $afterValue (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
