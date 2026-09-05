(module
  (import "../common.wat")

  (func $groovyByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlGroovy. The high byte of a
  ;; declaration value names the next name's capture: 1 after `def`, where
  ;; the name is a function when `(` follows, 2 a type.
  (keyword-table $groovyWords $mem.groovyWords $mem.groovyWords+640
    (group $Token.keyword.control ;; 1: control flow
      "if" "else" "for" "while" "do" "switch" "case" "default" "break"
      "continue" "return" "throw" "throws" "try" "catch" "finally" "assert"
      "yield")
    (group $Token.keyword.declaration+256 "def") ;; 2: next name is a function or variable
    (group $Token.keyword.declaration+512 ;; 3: next name is a type
      "class" "interface" "trait" "enum" "record")
    (group $Token.keyword.declaration ;; 4: modifiers and other declarations
      "var" "final" "static" "abstract" "synchronized" "transient" "volatile"
      "native" "strictfp" "public" "private" "protected" "extends"
      "implements")
    (group $Token.keyword.import "import" "package") ;; 5
    (group $Token.keyword "new")                     ;; 6
    (group $Token.keyword.operator "in" "as" "instanceof") ;; 7
    (group $Token.type.builtin ;; 8: primitive types
      "boolean" "byte" "char" "short" "int" "long" "float" "double" "void")
    (group $Token.boolean "true" "false")            ;; 9
    (group $Token.constant.builtin "null")           ;; 10
    (group $Token.variable.special "this" "super" "it")) ;; 11

  ;; Token in the low byte and the next-name capture in the high byte, or -1
  ;; for an ordinary name.
  (func $groovyWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $groovyWords (local.get $lhs) (local.get $rhs)))

  ;; Scan a string body from $ptr with the bytes since $seg still unemitted.
  ;; $q is the quote byte and $triple selects the three-quote form; a
  ;; double-quoted body ($expand) is a GString with `$name.path` values and
  ;; `${` splices. Backslash escapes are emitted separately. Returns 1 past
  ;; the closer, 2 past a `${` that opens a splice - emitted as
  ;; punctuation.special, the caller lexes the expression - 3 when an
  ;; escaped line break ends exactly at $end, and 0 when the body stops at
  ;; $end or at the raw line break of a single-line string. $nested is
  ;; nonzero inside a splice, where a nested string keeps `${` plain.
  (func $groovyStringBody
    (param $q i32) (param $triple i32) (param $expand i32) (param $nested i32) (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $p i32)
    (local $stop i32) (local $dollar i32) (local $status i32)
    (local.set $stop (global.get $ptr))
    (local.set $dollar (global.get $ptr))
    (block $done
      (loop $scan
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (local.get $q)
              (i32.const 1) (i32.eqz (local.get $triple))))
            (local.set $dollar (local.get $stop))
            (if (local.get $expand)
              (then (local.set $dollar (call $scanFindSpecial
                (global.get $ptr) (local.get $stop) (i32.const "$")
                (i32.const 0) (i32.const 0))))))
          (else
            (if (i32.and (local.get $expand) (i32.gt_u (global.get $ptr) (local.get $dollar)))
              (then (local.set $dollar (call $scanFindSpecial
                (global.get $ptr) (local.get $stop) (i32.const "$")
                (i32.const 0) (i32.const 0)))))))
        (global.set $ptr (select (local.get $dollar) (local.get $stop)
          (i32.lt_u (local.get $dollar) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (if (i32.or (i32.eqz (local.get $triple))
                  (i32.and
                    (i32.eq (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $q))
                    (i32.eq (call $groovyByte (i32.add (global.get $ptr) (i32.const 2))) (local.get $q))))
              (then
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
        ;; `$`: a splice or a dotted value path
        (local.set $c2 (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.const 2))))
        (if (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $p (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $pathDone
              (loop $path
                (call $scanIdentRun (i32.const "_"))
                (br_if $pathDone (i32.eqz (i32.and
                  (i32.eq (call $groovyByte (global.get $ptr)) (i32.const "."))
                  (i32.and
                    (call $lexIsIdentStart (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))))
                    (i32.ne (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "$"))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $path)))
            (call $emitTok (enum.get $Token.variable) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  (func $groovyIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/:<=>?^|~" (local.get $c)))

  ;; $strKind is 1 inside a `'` body, 2 inside `'''`, 3 inside a `"`
  ;; GString, and 4 inside `"""`, with $seg the start of the bytes not yet
  ;; emitted; $interp counts braces inside a `${` splice and $interpKind
  ;; remembers which body to return to. $expect is 1 after `def` and 2
  ;; after a type keyword; $member is 1 after `.`; $importCtx is 1 on an
  ;; import or package line; $prevType is 1 after a type name, so the name
  ;; before `(` is a method definition; $stmtHead is 1 before the first
  ;; token of a statement, where a bare word followed by an argument is a
  ;; command call such as `println "x"` or `dependencies {`. All are
  ;; checkpointed.
  (func $hlGroovy
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $pc i32)
    (local $kind i32) (local $hl i32) (local $status i32)
    (local $strKind i32) (local $seg i32) (local $interp i32) (local $interpKind i32)
    (local $expect i32) (local $member i32) (local $importCtx i32) (local $prevType i32) (local $stmtHead i32)
    (local.set $stmtHead (i32.const 1))
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
            (local.set $status (call $groovyStringBody
              (select (i32.const 34) (i32.const 39) (i32.ge_u (local.get $strKind) (i32.const 3)))
              (i32.eqz (i32.and (local.get $strKind) (i32.const 1)))
              (i32.ge_u (local.get $strKind) (i32.const 3))
              (local.get $interp)
              (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
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
                        (i32.and (local.get $strKind) (i32.const 1))
                        (i32.eqz (local.get $status))))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break ends an import line and starts a statement
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $importCtx (i32.const 0))
            (local.set $stmtHead (i32.const 1))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $groovyByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.and (i32.eq (local.get $c3) (i32.const "*"))
                (i32.ne (call $groovyByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/")))))
            (br $next)))
        ;; a `#!` line opens a script
        (if (i32.and
              (i32.eq (local.get $lhs) (global.get $srcBase))
              (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "!"))))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))

        ;; string openers are emitted at once; the body is scanned at the top
        ;; of the loop, where it can also resume after a chunk boundary
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $strKind (select (i32.const 3) (i32.const 1) (i32.eq (local.get $c) (i32.const 34))))
            (if (i32.and (i32.eq (local.get $c2) (local.get $c)) (i32.eq (local.get $c3) (local.get $c)))
              (then
                (local.set $strKind (i32.add (local.get $strKind) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $prevType (i32.const 0))
            (local.set $stmtHead (i32.const 0))
            (br $next)))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "@"))
              (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "."))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $groovyByte (local.get $p)))
            (local.set $kind (select (i32.const -1)
              (call $groovyWordHl (local.get $lhs) (local.get $rhs))
              (i32.or (local.get $member) (local.get $importCtx))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                (if (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                  (then (local.set $importCtx (i32.const 1))))
                (local.set $prevType (i32.eq (local.get $hl) (enum.get $Token.type.builtin))))
              (else
                (if (local.get $importCtx)
                  (then (local.set $hl (enum.get $Token.namespace)))
                  (else
                    (if (local.get $expect)
                      (then
                        ;; `def name(` defines a method, `def name =` a variable
                        (local.set $hl (enum.get $Token.type))
                        (if (i32.eq (local.get $expect) (i32.const 1))
                          (then (local.set $hl (select
                            (enum.get $Token.function.definition) (enum.get $Token.variable)
                            (i32.eq (local.get $pc) (i32.const "("))))))
                        (local.set $expect (i32.const 0)))
                      (else
                        (if (local.get $member)
                          (then
                            (local.set $hl (enum.get $Token.property))
                            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type))))
                            (if (i32.or (i32.eq (local.get $pc) (i32.const "(")) (i32.eq (local.get $pc) (i32.const "{")))
                              (then (local.set $hl (enum.get $Token.function.method)))))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else
                                    (if (i32.eq (local.get $pc) (i32.const "("))
                                      (then (local.set $hl (select
                                        (enum.get $Token.function.definition) (enum.get $Token.function)
                                        (local.get $prevType))))
                                      (else
                                        ;; `key:` names an argument or map entry;
                                        ;; a command call heads its statement
                                        (if (i32.and
                                              (i32.eq (call $groovyByte (local.get $rhs)) (i32.const ":"))
                                              (i32.ne (call $groovyByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":")))
                                          (then (local.set $hl (enum.get $Token.property)))
                                          (else
                                            (local.set $hl (select (enum.get $Token.function) (enum.get $Token.variable)
                                              (i32.and
                                                (local.get $stmtHead)
                                                (i32.and
                                                  (i32.eqz (local.get $prevType))
                                                  (i32.or
                                                    (i32.or (call $lexIsIdentStart (local.get $pc)) (call $lexIsDigit (local.get $pc)))
                                                    (byteset.get "\22'{" (local.get $pc)))))))))))))))))))))
                (local.set $prevType (i32.eq (local.get $hl) (enum.get $Token.type)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $prevType (i32.const 0))
            (local.set $stmtHead (i32.const 0))
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
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (local.set $expect (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; `List<T>[]` rides its brackets; a brace starts a statement
            (if (i32.eqz (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]"))))
              (then
                (local.set $expect (i32.const 0))
                (local.set $prevType (i32.const 0))))
            (local.set $stmtHead (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}"))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then (local.set $importCtx (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $expect (i32.const 0))
                (local.set $importCtx (i32.const 0))
                (local.set $prevType (i32.const 0))
                (local.set $stmtHead (i32.const 1))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.ne (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (local.set $stmtHead (i32.const 0))
            (br $next)))

        (if (i32.or (call $groovyIsOp (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (i32.or
                  (call $groovyIsOp (call $groovyByte (global.get $ptr)))
                  (i32.eq (call $groovyByte (global.get $ptr)) (i32.const ".")))))
                ;; a comment opener ends the run
                (br_if $opDone (i32.and
                  (i32.eq (call $groovyByte (global.get $ptr)) (i32.const "/"))
                  (i32.or
                    (i32.eq (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "/"))
                    (i32.eq (call $groovyByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "*")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; a lone `:` ends a case label, so a statement follows it
            (local.set $stmtHead (i32.and
              (i32.eq (local.get $c) (i32.const ":"))
              (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1))))
            ;; `<`, `>`, and `?` glue a generic or nullable type together
            (if (i32.eqz (call $lexIsTypeGlue (local.get $lhs) (global.get $ptr)))
              (then
                (local.set $expect (i32.const 0))
                (local.set $prevType (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then (local.set $importCtx (i32.const 0))))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $stmtHead (i32.const 0))
        (br $next))))
)
