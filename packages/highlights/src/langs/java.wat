(module
  (import "../common.wat")

  (func $javaByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $javaWordHl below. The module
  ;; directives `exports`/`opens`/`requires` stay out: `exports` shares its
  ;; hash features with `extends`, and module descriptors are rare.
  (keyword-table $javaWords $mem.javaWords $mem.juliaWords
    (group $Token.keyword.control ;; 1: control
      "if" "do" "for" "try" "case" "else" "goto" "break" "catch" "throw" "while" "yield" "assert"
      "return" "switch" "default" "finally" "continue")
    (group $Token.keyword.declaration+256 "enum" "class" "interface") ;; 2: declaration, next name is a type
    (group $Token.keyword.declaration+512 "package")                           ;; 3: declaration, next name is a namespace
    (group $Token.keyword.import "import")                            ;; 4: import
    (group $Token.keyword.declaration ;; 5: declaration and modifiers
      "var" "const" "final" "native" "sealed" "static" "throws" "extends" "permits" "private"
      "abstract" "strictfp" "volatile" "protected" "public" "transient" "implements" "synchronized")
    (group $Token.type.builtin ;; 6: primitive types
      "int" "byte" "char" "long" "void" "float" "short" "double" "boolean")
    (group $Token.boolean "true" "false")    ;; 7: booleans
    (group $Token.constant.builtin "null")            ;; 8: built-in constant
    (group $Token.variable.special "this" "super")    ;; 9: special variables
    (group $Token.keyword.operator "new" "instanceof") ;; 10: word operators
    (group $Token.keyword.declaration+1280 "record")) ;; 11: contextual declaration, next name is a type

  ;; Token in the low byte; bits 8-9 select the next-name capture: 1=type,
  ;; 2=namespace. Bit 10 flags the contextual `record`. -1 means an ordinary
  ;; identifier.
  (func $javaWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $javaWords (local.get $lhs) (local.get $rhs)))

  (global $javaApex (mut i32) (i32.const 0))

  ;; Lowercase. Bits 8-9: the $javaWords captures. Bit 11: a SOQL word, a keyword
  ;; only inside `[...]`. Bit 12: `select` and `find`, which open a query.
  ;; `where` collides with `while` and is matched directly.
  (keyword-table $apexWords $mem.apexWords $mem.haxeWords
    (group $Token.keyword.control
      "if" "else" "for" "while" "do" "try" "catch" "finally" "throw" "return" "break" "continue"
      "switch" "when")
    (group $Token.keyword.declaration+256 "class" "interface" "enum" "trigger")
    (group $Token.keyword.declaration
      "public" "private" "protected" "global" "static" "final" "abstract" "virtual" "override"
      "transient" "webservice" "testmethod" "extends" "implements" "with" "without" "inherited"
      "sharing")
    (group $Token.type.builtin
      "string" "integer" "long" "double" "decimal" "boolean" "id" "date" "datetime" "time" "blob"
      "object" "list" "set" "map" "sobject" "void")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.variable.special "this" "super")
    (group $Token.keyword.operator "new" "instanceof")
    (group $Token.keyword
      "insert" "update" "upsert" "delete" "undelete" "merge" "on" "before" "after")
    (group $Token.keyword+6144 "select" "find")
    (group $Token.keyword+2304 "from")
    (group $Token.keyword+2048
      "limit" "order" "by" "asc" "desc" "group" "having" "offset" "nulls" "first" "last"
      "typeof" "includes" "excludes" "returning")
    (group $Token.keyword.operator+2048 "and" "or" "not" "in" "like")
    (group $Token.constant.builtin+2048 "today" "yesterday" "tomorrow"))

  ;; The lowercase copy stays in $mem.lexLowerScratch for the caller.
  (func $apexWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n
      (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (if
      (i32.and
        (i32.eq (local.get $n) (i32.const 5))
        (i32.and
          (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "wher"))
          (i32.eq (i32.load8_u (i32.const $mem.lexLowerScratch+4)) (i32.const "e"))))
      (then (return (i32.or (enum.get $Token.keyword) (i32.const 2048)))))
    (keyword-table.value $apexWords
      (i32.const $mem.lexLowerScratch)
      (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))

  ;; Scan a text block body from $ptr, whose bytes from $seg on are still
  ;; unemitted, through the closing `"""` or to $end. Escapes are emitted as
  ;; string.escape so `\"""` stays inside the block. Returns 1 once the block
  ;; closed and 0 when it runs past $end.
  (func $javaTextBlockBody (param $seg i32) (result i32)
    (local $c i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (i32.const 34)
            (i32.const 1)
            (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if
              (i32.and
                (i32.eq (call $javaByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 34))
                (i32.eq (call $javaByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))
              (then
                ;; both trailing quotes read below $end, so this cannot overshoot
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (return (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (drop (call $stringEscapeAt (local.get $seg)))
        (local.set $seg (global.get $ptr))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  (func $javaIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>?^|~" (local.get $c)))

  ;; $expect is the pending next-name capture from $javaWordHl. $afterType
  ;; is 1 right after a type - a primitive, a capitalized name, or a member
  ;; capitalized name - and rides through the `<`, `>`, `[`, `]`, `,`, `?`,
  ;; and `.` of a generic or array type, so the name before a `(` after it
  ;; is a method definition rather than a call. $member is 1 after `.` or
  ;; `::`. $textBlock is 1 while a `"""` body is open, also across chunks.
  ;; Apex: $soql is 1 right after `[`, and n > 1 inside a query with n - 1
  ;; brackets open; $pending marks the token after `[`.
  (func $hlJavaImpl
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (local $afterType i32)
    (local $textBlock i32)
    (local $soql i32)
    (local $pending i32)
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
        (local.set $pending (i32.eq (local.get $soql) (i32.const 1)))
        (if (local.get $pending)
          (then (local.set $soql (i32.const 0))))

        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            ;; `/**` opens Javadoc, but `/**/` is an empty plain comment
            (call $lexBlockComment
              (i32.const 2)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (local.get $c3) (i32.const "*"))
                  (i32.ne
                    (call $javaByte (i32.add (global.get $ptr) (i32.const 3)))
                    (i32.const "/")))))
            (br $next)))

        ;; a text block opener is emitted at once; its body is scanned at
        ;; the top of the loop
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 34))
            (i32.and
              (i32.eq (local.get $c2) (i32.const 34))
              (i32.eq (local.get $c3) (i32.const 34))))
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
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
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
            (if (global.get $javaApex)
              (then
                ;; a member such as `Trigger.new` is never a keyword
                (local.set $kind (i32.const -1))
                (if (i32.eqz (local.get $member))
                  (then (local.set $kind (call $apexWordHl (local.get $lhs) (local.get $rhs)))))
                (if (i32.and (local.get $pending) (i32.ge_s (local.get $kind) (i32.const 4096)))
                  (then (local.set $soql (i32.const 2))))
                ;; in a query Apex types such as `Id` are field names
                (if (i32.gt_u (local.get $soql) (i32.const 1))
                  (then
                    (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                    (if (i32.lt_s (local.get $kind) (i32.const 0))
                      (then
                        (local.set $hl
                          (select
                            (enum.get $Token.type)
                            (select
                              (enum.get $Token.function)
                              (enum.get $Token.variable)
                              (i32.eq (call $javaByte (local.get $rhs)) (i32.const "(")))
                            (local.get $expect)))
                        (local.set $expect (i32.const 0)))
                      (else
                        (local.set $expect (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 3)))
                        (if (i32.eq (local.get $hl) (enum.get $Token.type.builtin))
                          (then (local.set $hl (enum.get $Token.variable))))))
                    (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                    (local.set $member (i32.const 0))
                    (br $next)))
                ;; `Trigger.new` names the class
                (if
                  (i32.or
                    (i32.gt_s (local.get $kind) (i32.const 2047))
                    (i32.and
                      (i32.gt_s (local.get $kind) (i32.const 255))
                      (i32.eq (call $javaByte (local.get $rhs)) (i32.const "."))))
                  (then (local.set $kind (i32.const -1))))
                ;; Apex ignores case, so a lowercase `date` before `=`, `;`,
                ;; `.`, `)`, or an operator is a variable, not a type
                (if
                  (i32.and
                    (i32.eq (local.get $kind) (enum.get $Token.type.builtin))
                    (i32.ge_u (local.get $c) (i32.const "a")))
                  (then
                    (local.set $c3 (call $javaByte (call $lexSkipSpaceAt (local.get $rhs))))
                    (if (byteset.get "=;.)!+-*/%&|?:" (local.get $c3))
                      (then (local.set $kind (i32.const -1))))))
                (if
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                    (i32.eq
                      (i32.load16_u offset=1 (i32.const $mem.lexLowerScratch))
                      (i32.const "et")))
                  (then
                    (local.set $c3 (call $javaByte (call $lexSkipSpaceAt (local.get $rhs))))
                    (if
                      (i32.and
                        (i32.eqz (local.get $member))
                        (i32.and
                          (i32.or
                            (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "g"))
                            (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "s")))
                          (i32.or (i32.eq (local.get $c3) (i32.const ";")) (i32.eq (local.get $c3) (i32.const "{")))))
                      (then (local.set $kind (enum.get $Token.keyword.declaration)))))))
              (else (local.set $kind (call $javaWordHl (local.get $lhs) (local.get $rhs)))))
            ;; `record` heads a declaration only before a name - `record
            ;; Point(` - so `record : records` and `record.key()` keep it a
            ;; variable that arms no type capture
            (if (i32.gt_s (local.get $kind) (i32.const 1023))
              (then
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (local.set $kind
                  (select
                    (i32.and (local.get $kind) (i32.const 1023))
                    (i32.const -1)
                    (i32.and
                      (i32.and
                        (i32.eqz (local.get $member))
                        (i32.gt_u (local.get $p) (local.get $rhs)))
                      (call $lexIsIdentStart (call $javaByte (local.get $p))))))))
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
                    (local.set $hl
                      (select
                        (enum.get $Token.type)
                        (enum.get $Token.namespace)
                        (i32.eq (local.get $expect) (i32.const 1))))
                    (local.set $afterType (i32.eq (local.get $expect) (i32.const 1)))
                    ;; a dotted package keeps its capture: `demo.app`
                    (if
                      (i32.or
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
                            (local.set $afterType
                              (i32.and
                                (i32.eqz (global.get $javaApex))
                                (i32.le_u
                                  (i32.sub (local.get $c) (i32.const "A"))
                                  (i32.const 25))))
                            (local.set $hl
                              (select
                                (enum.get $Token.type)
                                (enum.get $Token.property)
                                (local.get $afterType))))))
                      (else
                        (if (i32.eq (call $javaByte (local.get $p)) (i32.const "("))
                          (then
                            ;; `Foo(` is a constructor; a lowercase name after
                            ;; a type is the method being declared
                            (if
                              (i32.le_u
                                (i32.sub (local.get $c) (i32.const "A"))
                                (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type)))
                              (else
                                (local.set $hl
                                  (select
                                    (enum.get $Token.function.definition)
                                    (enum.get $Token.function)
                                    (local.get $afterType)))))
                            (local.set $afterType (i32.const 0)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then
                                (local.set $hl (enum.get $Token.constant))
                                (local.set $afterType (i32.const 0)))
                              (else
                                (local.set $afterType
                                  (i32.le_u
                                    (i32.sub (local.get $c) (i32.const "A"))
                                    (i32.const 25)))
                                (local.set $hl
                                  (select
                                    (enum.get $Token.type)
                                    (enum.get $Token.variable)
                                    (local.get $afterType)))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanHexNumber (i32.const 1))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; an Apex `[` may open a query; inside one, brackets nest
            (if (global.get $javaApex)
              (then
                (if (i32.eq (local.get $c) (i32.const "["))
                  (then
                    (local.set $soql
                      (select
                        (i32.add (local.get $soql) (i32.const 1))
                        (i32.const 1)
                        (i32.gt_u (local.get $soql) (i32.const 1))))))
                (if (i32.and (i32.eq (local.get $c) (i32.const "]")) (i32.gt_u (local.get $soql) (i32.const 1)))
                  (then
                    (local.set $soql
                      (select
                        (i32.const 0)
                        (i32.sub (local.get $soql) (i32.const 1))
                        (i32.eq (local.get $soql) (i32.const 2))))))))
            ;; array brackets keep a type pending - `int[] read(` - while the
            ;; others end it along with any declaration head
            (if
              (i32.and
                (i32.ne (local.get $c) (i32.const "["))
                (i32.ne (local.get $c) (i32.const "]")))
              (then
                (local.set $afterType (i32.const 0))
                (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            ;; a comma separates the type arguments of a pending type
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ":"))
            (i32.and (i32.gt_u (local.get $soql) (i32.const 1)) (call $lexIsIdentStart (local.get $c2))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            ;; `Type::method` references a member
            (local.set $member (i32.eq (local.get $c2) (i32.const ":")))
            (local.set $afterType (i32.const 0))
            ;; a stale capture never crosses `:` onto the name after it
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (select
                  (i32.const 3)
                  (i32.const 1)
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "."))
                    (i32.eq (local.get $c3) (i32.const "."))))))
            (call $emitTok
              (select
                (enum.get $Token.operator)
                (enum.get $Token.punctuation.delimiter)
                (i32.eq (local.get $c2) (i32.const ".")))
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))

        (if (call $javaIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "-"))
                (i32.eq (local.get $c2) (i32.const ">")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
              (else
                (if
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.and
                      (i32.eq (local.get $c) (local.get $c2))
                      (byteset.get "&+-<>|" (local.get $c))))
                  (then
                    ;; two bytes in, so the third is $c3
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const ">"))
                        (i32.or
                          (i32.eq (local.get $c3) (i32.const ">"))
                          (i32.eq (local.get $c3) (i32.const "="))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.eq (call $javaByte (global.get $ptr)) (i32.const "="))
                          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const "<"))
                        (i32.eq (local.get $c3) (i32.const "=")))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; the angles of a generic - `>>` closes two - and a nullable
            ;; `?` keep the type pending; any other operator ends it
            ;; so does a spaced one, which type syntax never is - `Foo.MAX >
            ;; limit()` - and a `>` directly before a name: the explicit type
            ;; arguments of `Collections.<T>emptyList()`
            (if (call $lexIsTypeGlue (local.get $lhs) (global.get $ptr))
              (then
                (if
                  (i32.or
                    (i32.ne (local.get $gap) (local.get $lhs))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const ">"))
                      (call $lexIsIdentStart (call $javaByte (global.get $ptr)))))
                  (then (local.set $afterType (i32.const 0)))))
              (else (local.set $afterType (i32.const 0))))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $afterType (i32.const 0))
        (br $next))))

  (func $hlJava
    (global.set $javaApex (i32.const 0))
    (call $hlJavaImpl))
)
