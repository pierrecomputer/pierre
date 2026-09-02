(module
  (import "../common.wat")

  (func $javaByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $javaWordHl below. The module
  ;; directives `exports`/`opens`/`requires` stay out: `exports` shares its
  ;; hash features with `extends`, and module descriptors are rare.
  (keyword-table $javaWords $mem.javaWords $mem.javaWords+1024 64 256
    (group ;; 1: control
      "if" "do" "for" "try" "case" "else" "goto" "break" "catch" "throw"
      "while" "yield" "assert" "return" "switch" "default" "finally"
      "continue")
    (group "enum" "class" "record" "interface") ;; 2: declaration, next name is a type
    (group "package")                           ;; 3: declaration, next name is a namespace
    (group "import")                            ;; 4: import
    (group ;; 5: declaration and modifiers
      "var" "const" "final" "native" "sealed" "static" "throws" "extends"
      "permits" "private" "abstract" "strictfp" "volatile" "protected"
      "public" "transient" "implements" "synchronized")
    (group ;; 6: primitive types
      "int" "byte" "char" "long" "void" "float" "short" "double" "boolean")
    (group "true" "false")    ;; 7: booleans
    (group "null")            ;; 8: built-in constant
    (group "this" "super")    ;; 9: special variables
    (group "new" "instanceof")) ;; 10: word operators

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=type, 2=namespace. -1 means an ordinary identifier.
  (func $javaWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g (keyword-table.get $javaWords (local.get $lhs) (local.get $rhs)))
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

  ;; Scan a text block body from $ptr, whose bytes from $seg on are still
  ;; unemitted, through the closing `"""` or to $end. Escapes are emitted as
  ;; string.escape so `\"""` stays inside the block. Returns 1 once the block
  ;; closed and 0 when it runs past $end.
  (func $javaTextBlockBody (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (block $done
      (loop $scan
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.and
                  (i32.eq (call $javaByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                  (i32.eq (call $javaByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))
              (then
                ;; both trailing quotes read below $end, so this cannot overshoot
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (return (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (local.set $e (call $lexEscapeEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  (func $javaIsOp (param $c i32) (result i32)
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

  ;; $expect is the pending next-name capture from $javaWordHl. $afterType
  ;; is 1 right after a type - a primitive, a capitalized name, or a member
  ;; capitalized name - and rides through the `<`, `>`, `[`, `]`, `,`, `?`,
  ;; and `.` of a generic or array type, so the name before a `(` after it
  ;; is a method definition rather than a call. $member is 1 after `.` or
  ;; `::`. $textBlock is 1 while a `"""` body is open, also across chunks.
  (func $hlJava
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $afterType i32) (local $textBlock i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open text block resumes at the top of the loop, so a body cut
        ;; by a chunk boundary continues from the chunk start
        (if (local.get $textBlock)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (if (call $javaTextBlockBody (global.get $ptr))
              (then (local.set $textBlock (i32.const 0))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $javaByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $javaByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            ;; `/**` opens Javadoc, but `/**/` is an empty plain comment
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.and
                (i32.eq (local.get $c3) (i32.const "*"))
                (i32.ne (call $javaByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/")))))
            (br $next)))

        ;; a text block opener is emitted at once; its body is scanned at
        ;; the top of the loop
        (if (i32.and (i32.eq (local.get $c) (i32.const 34))
              (i32.and (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 34))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $textBlock (i32.const 1))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        ;; annotations, including `@interface`
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
            (local.set $kind (call $javaWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; a bare keyword either arms the next-name capture or ends
                ;; it; `Foo.class` names no type
                (if (i32.eqz (local.get $member))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                (local.set $afterType (i32.eq (local.get $hl) (enum.get $Token.type.builtin))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expect)
                  (then
                    (local.set $hl (select (enum.get $Token.type) (enum.get $Token.namespace)
                      (i32.eq (local.get $expect) (i32.const 1))))
                    (local.set $afterType (i32.eq (local.get $expect) (i32.const 1)))
                    ;; a dotted package keeps its capture: `demo.app`
                    (if (i32.or
                          (i32.eq (local.get $expect) (i32.const 1))
                          (i32.ne (call $javaByte (local.get $p)) (i32.const ".")))
                      (then (local.set $expect (i32.const 0)))))
                  (else
                    (if (local.get $member)
                      (then
                        ;; `Map.Entry` is a nested type, `obj.field` a field,
                        ;; `obj.call(` a method
                        (if (i32.eq (call $javaByte (local.get $p)) (i32.const "("))
                          (then
                            (local.set $hl (enum.get $Token.function.method))
                            (local.set $afterType (i32.const 0)))
                          (else
                            (local.set $afterType (i32.le_u
                              (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                            (local.set $hl (select (enum.get $Token.type) (enum.get $Token.property)
                              (local.get $afterType))))))
                      (else
                        (if (i32.eq (call $javaByte (local.get $p)) (i32.const "("))
                          (then
                            ;; `Foo(` is a constructor; a lowercase name after
                            ;; a type is the method being declared
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
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; array brackets keep a type pending - `int[] read(` - while the
            ;; others end it along with any declaration head
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
            ;; a comma separates the type arguments of a pending type
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            ;; `Type::method` references a member
            (local.set $member (i32.eq (local.get $c2) (i32.const ":")))
            (local.set $afterType (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1)
              (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eq (local.get $c3) (i32.const "."))))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (if (i32.eq (local.get $c2) (i32.const ".")) (then (local.set $afterType (i32.const 0))))
            (br $next)))

        (if (call $javaIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
              (else
                (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                            (i32.and (i32.eq (local.get $c) (local.get $c2))
                              (i32.or
                                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                                (i32.or
                                  (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                                  (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.and (i32.eq (local.get $c) (i32.const ">"))
                                 (i32.or (i32.eq (call $javaByte (global.get $ptr)) (i32.const ">"))
                                         (i32.eq (call $javaByte (global.get $ptr)) (i32.const "="))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.eq (call $javaByte (global.get $ptr)) (i32.const "="))
                          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                    (if (i32.and (i32.eq (local.get $c) (i32.const "<"))
                                 (i32.eq (call $javaByte (global.get $ptr)) (i32.const "=")))
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
