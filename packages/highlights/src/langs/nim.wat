(module
  (import "../common.wat")

  ;; Group values carry the token. Routine words add 256: the next name is a
  ;; definition and its parameter list is marked. Import words add 512: names
  ;; are modules until the statement ends. `raise` shares its hash features
  ;; with `range`, and `export` with `except`, so $hlNim matches those two
  ;; directly.
  (keyword-table $nimWords $mem.nimWords $mem.nixWords
    (group $Token.keyword.declaration+256
      "proc" "func" "method" "iterator" "converter" "macro" "template")
    (group $Token.keyword.declaration "var" "let" "const" "type")
    (group $Token.keyword.import+512 "import" "include" "from")
    (group $Token.keyword.control
      "if" "when" "case" "elif" "else" "for" "while" "continue" "break" "return" "yield"
      "try" "except" "finally")
    (group $Token.keyword.operator
      "and" "or" "xor" "not" "div" "mod" "shl" "shr" "as" "of" "in" "notin" "is" "isnot"
      "cast")
    (group $Token.keyword
      "addr" "asm" "bind" "block" "concept" "defer" "discard" "distinct" "do" "enum" "mixin"
      "object" "out" "ptr" "ref" "static" "tuple" "using")
    (group $Token.boolean "true" "false" "on" "off")
    (group $Token.constant.builtin "nil")
    (group $Token.variable.special "result")
    (group $Token.type.builtin
      "int" "int8" "int16" "int32" "int64" "uint" "uint8" "uint16" "uint32" "uint64" "float"
      "float32" "float64" "bool" "char" "string" "cstring" "pointer" "void" "auto" "untyped"
      "typed" "typedesc" "seq" "array" "set" "openArray" "varargs" "range" "byte")
    ;; command-call builtins: `echo x` has no `(` to mark it a call
    (group $Token.function "echo" "inc" "dec" "assert" "doAssert"))

  ;; The end of the escape at backslash $p: `\xHH`, `\uHHHH`, `\u{H..}`, a
  ;; decimal code such as `\65`, or one character. A backslash before a line
  ;; break escapes nothing: Nim strings never continue on the next line.
  (func $nimEscapeEnd (param $p i32) (result i32)
    (local $c i32)
    (local $q i32)
    (if (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
      (then
        (local.set $c (i32.load8_u offset=1 (local.get $p)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then (return (i32.add (local.get $p) (i32.const 1)))))
        (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "x"))
          (then (return (call $scanHexRun (i32.add (local.get $p) (i32.const 2)) (i32.const 2)))))
        (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "u"))
          (then
            (local.set $q (i32.add (local.get $p) (i32.const 2)))
            (if (i32.ne (call $templateByte (local.get $q)) (i32.const "{"))
              (then (return (call $scanHexRun (local.get $q) (i32.const 4)))))
            (local.set $q (call $scanHexRun (i32.add (local.get $q) (i32.const 1)) (i32.const 8)))
            (return
              (select
                (i32.add (local.get $q) (i32.const 1))
                (local.get $q)
                (i32.eq (call $templateByte (local.get $q)) (i32.const "}"))))))
        (if (call $lexIsDigit (local.get $c))
          (then
            (local.set $q (i32.add (local.get $p) (i32.const 2)))
            (block $digitsDone
              (loop $digits
                (br_if $digitsDone (i32.eqz (call $lexIsDigit (call $templateByte (local.get $q)))))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $digits)))
            (return (local.get $q))))))
    (call $lexEscapeEnd (local.get $p)))

  ;; Scan a raw string body from $ptr and emit [$lhs, $ptr). `""` is a quote;
  ;; one `"` ends the string, and a line break ends it unterminated.
  (func $nimRawString (param $lhs i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (i32.const 34)
            (i32.const 0)
            (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 34)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br_if $done (i32.ne (call $templateByte (global.get $ptr)) (i32.const 34)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))

  ;; Scan a `"""` body from $ptr through its closing quotes - the last three
  ;; of a run of three or more - and emit [$lhs, $ptr). Return 1 when the
  ;; body runs to $end unclosed.
  (func $nimTriple (param $lhs i32) (result i32)
    (local $p i32)
    (local $open i32)
    (local.set $open (i32.const 1))
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 34)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (global.get $ptr))
        (loop $quotes
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (br_if $quotes (i32.eq (call $templateByte (global.get $ptr)) (i32.const 34))))
        (br_if $scan (i32.lt_u (i32.sub (global.get $ptr) (local.get $p)) (i32.const 3)))
        (local.set $open (i32.const 0))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (local.get $open))

  ;; Scan a `#[ ]#` comment from $ptr and emit [$lhs, $ptr). $state is the open
  ;; depth, plus 0x10000 for a `##[ ]##` doc comment, which also takes the `#`
  ;; after its last `]#`. Return the state still open at $end, or 0.
  (func $nimBlockComment (param $lhs i32) (param $state i32) (result i32)
    (local $depth i32)
    (local $doc i32)
    (local.set $doc (i32.and (local.get $state) (i32.const 0x10000)))
    (local.set $depth
      (call $lexNestedScan
        (i32.and (local.get $state) (i32.const 0xffff))
        (i32.const "#[")
        (i32.const "]#")))
    (if
      (i32.and
        (i32.eqz (local.get $depth))
        (i32.and
          (i32.ne (local.get $doc) (i32.const 0))
          (i32.eq (call $templateByte (global.get $ptr)) (i32.const "#"))))
      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok
      (select (enum.get $Token.comment.doc) (enum.get $Token.comment) (local.get $doc))
      (local.get $lhs)
      (global.get $ptr))
    (select (i32.or (local.get $depth) (local.get $doc)) (i32.const 0) (local.get $depth)))

  (func $hlNim
    (local $afterDecl i32) ;; the next name defines a routine
    (local $afterDot i32)
    (local $c i32)
    (local $c2 i32)
    (local $comment i32)   ;; a block comment open across chunks ($nimBlockComment state)
    (local $decl i32)
    (local $defEnd i32)    ;; end of a definition name: a `*` there exports it
    (local $depth i32)     ;; open brackets
    (local $dot i32)
    (local $g i32)
    (local $gap i32)
    (local $hl i32)
    (local $import i32)    ;; 1 names are modules until the line ends, 2 after a comma
    (local $lhs i32)
    (local $nameEnd i32)   ;; end of the last name, for an adjacent export `*`
    (local $p i32)
    (local $pragma i32)    ;; inside `{. .}`: 1 a pragma name is due, 2 after it
    (local $triple i32)    ;; a `"""` string open across chunks
    (call $lexEmitLeadingContinuation)
    ;; name positions belong to one chunk
    (local.set $defEnd (i32.const 0))
    (local.set $nameEnd (i32.const 0))
    (if (local.get $comment)
      (then (local.set $comment (call $nimBlockComment (global.get $ptr) (local.get $comment)))))
    (if (local.get $triple)
      (then (local.set $triple (call $nimTriple (global.get $ptr)))))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; an import statement ends at a line break outside brackets unless
        ;; its last token was a comma
        (if
          (i32.and
            (i32.eq (local.get $import) (i32.const 1))
            (i32.and
              (i32.eqz (local.get $depth))
              (call $lexGapHasBreak (local.get $gap) (global.get $ptr))))
          (then (local.set $import (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "["))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (local.set $comment (call $nimBlockComment (local.get $lhs) (i32.const 1)))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const "#"))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "[")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (local.set $comment (call $nimBlockComment (local.get $lhs) (i32.const 0x10001)))
                (br $next)))
            (call $lexLineComment
              (i32.const 1)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.eq (local.get $c2) (i32.const "#"))))
            (br $next)))

        ;; every other token consumes a pending definition or member position
        (local.set $decl (local.get $afterDecl))
        (local.set $afterDecl (i32.const 0))
        (local.set $dot (local.get $afterDot))
        (local.set $afterDot (i32.const 0))
        ;; a pending routine head survives only its export marker, its `[...]`
        ;; generic list, and its name on the way to the `(` of its parameters
        (if (i32.and (global.get $sigFnPend) (i32.eqz (global.get $sigFnAngle)))
          (then
            (if (i32.eqz (byteset.get "(*[`" (local.get $c)))
              (then (global.set $sigFnPend (i32.const 0))))))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const 34))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 34)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (local.set $triple (call $nimTriple (local.get $lhs)))
                (br $next)))
            ;; ends at its quote or, unterminated, before the line break
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $strDone
              (loop $str
                (global.set $ptr
                  (call $scanFindSpecial
                    (global.get $ptr)
                    (global.get $end)
                    (i32.const 34)
                    (i32.const 1)
                    (i32.const 1)))
                (br_if $strDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (if (i32.eq (local.get $c) (i32.const 34))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $strDone)))
                (br_if $strDone (i32.ne (local.get $c) (i32.const 92)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $p (call $nimEscapeEnd (global.get $ptr)))
                (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $p))
                (global.set $ptr (local.get $p))
                (local.set $lhs (local.get $p))
                (br $str)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; a character literal: `'a'`, `'\n'`; a lone `'` stays plain
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then (local.set $p (call $nimEscapeEnd (global.get $ptr))))
              (else
                (local.set $p
                  (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))))
            (if
              (i32.and
                (i32.eq (call $templateByte (local.get $p)) (i32.const 39))
                (i32.eqz (byteset.get "\0a\0d'" (local.get $c2))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (call $emitTok
                  (select
                    (enum.get $Token.string.escape)
                    (enum.get $Token.string)
                    (i32.eq (local.get $c2) (i32.const 92)))
                  (global.get $ptr)
                  (local.get $p))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr)))
              (else (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            ;; a type suffix: `1'i32`, `0xff'u8`, `2.0'f64`
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const 39))
                (call $lexIsIdentStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $scanIdentRun (i32.const "_"))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            ;; a string right after a name: `r"raw"` is one raw literal; any
            ;; other name calls a generalized raw literal such as `sql"..."`
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const 34))
              (then
                (local.set $p (global.get $ptr))
                (if
                  (i32.eqz
                    (i32.and
                      (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 1))
                      (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "r"))))
                  (then
                    (call $emitTok (enum.get $Token.function) (local.get $lhs) (local.get $p))
                    (local.set $lhs (local.get $p))))
                (if
                  (i32.and
                    (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
                    (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34)))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 3)))
                    (local.set $triple (call $nimTriple (local.get $lhs))))
                  (else
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $nimRawString (local.get $lhs))))
                (br $next)))
            (local.set $g (i32.const -1))
            (if (i32.eqz (local.get $dot))
              (then
                (local.set $g (keyword-table.value $nimWords (local.get $lhs) (global.get $ptr)))
                ;; kept out of the table (see above); wide loads stay inside
                ;; the input slack
                (if
                  (i32.and
                    (i32.eq (local.get $g) (i32.const -1))
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 5)))
                  (then
                    (if
                      (i64.eq
                        (i64.and (i64.load (local.get $lhs)) (i64.const 0x000000ffffffffff))
                        (i64.const "raise"))
                      (then (local.set $g (enum.get $Token.keyword.control))))))
                (if
                  (i32.and
                    (i32.eq (local.get $g) (i32.const -1))
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 6)))
                  (then
                    (if
                      (i64.eq
                        (i64.and (i64.load (local.get $lhs)) (i64.const 0x0000ffffffffffff))
                        (i64.const "export"))
                      (then (local.set $g (i32.add (enum.get $Token.keyword.import) (i32.const 512)))))))))
            (local.set $hl (i32.and (local.get $g) (i32.const 255)))
            (block $classified
              (if (i32.ne (local.get $g) (i32.const -1))
                (then
                  (if (i32.eq (i32.shr_u (local.get $g) (i32.const 8)) (i32.const 1))
                    (then
                      (local.set $afterDecl (i32.const 1))
                      (global.set $sigFnPend (i32.const 1))
                      (global.set $sigFnAngle (i32.const 0))))
                  (if (i32.eq (i32.shr_u (local.get $g) (i32.const 8)) (i32.const 2))
                    (then (local.set $import (i32.const 1))))
                  (br $classified)))
              (local.set $nameEnd (global.get $ptr))
              (local.set $hl (enum.get $Token.function.definition))
              (if (local.get $decl)
                (then
                  (local.set $defEnd (global.get $ptr))
                  (global.set $sigFnPend (i32.const 1))
                  (global.set $sigFnAngle (i32.const 0))
                  (br $classified)))
              (local.set $hl (enum.get $Token.namespace))
              (if (local.get $import)
                (then
                  (local.set $import (i32.const 1))
                  (br $classified)))
              (local.set $hl (enum.get $Token.attribute))
              (if (i32.eq (local.get $pragma) (i32.const 1))
                (then
                  (local.set $pragma (i32.const 2))
                  (br $classified)))
              (local.set $p (i32.eq (call $templateByte (global.get $ptr)) (i32.const "(")))
              (if (local.get $dot)
                (then
                  (local.set $hl
                    (select (enum.get $Token.function.method) (enum.get $Token.property) (local.get $p)))
                  (br $classified)))
              ;; a name at the top level of a marked routine list after `(`,
              ;; `,`, or `;` is a parameter
              (local.set $hl (enum.get $Token.variable.parameter))
              (br_if $classified
                (i32.and
                  (i32.and (call $sigActive) (global.get $sigPattern))
                  (i32.eqz (global.get $sigObscure))))
              (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.constant)
                      (enum.get $Token.type)
                      (call $lexIsConstCase (local.get $lhs) (global.get $ptr))))
                  (br $classified)))
              (local.set $hl (select (enum.get $Token.function) (enum.get $Token.variable) (local.get $p))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (global.set $sigPattern (i32.const 0))
            (br $next)))

        ;; an accent-quoted name: `+`, `type`
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (local.set $p
              (call $scanFindSpecial
                (i32.add (global.get $ptr) (i32.const 1))
                (global.get $end)
                (i32.const "`")
                (i32.const 0)
                (i32.const 1)))
            (if (i32.eq (call $templateByte (local.get $p)) (i32.const "`"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.special)
                  (local.get $lhs)
                  (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok
                  (if (result i32)
                    (local.get $decl)
                    (then (enum.get $Token.function.definition))
                    (else
                      (select
                        (enum.get $Token.function)
                        (enum.get $Token.variable)
                        (i32.eq (call $templateByte (global.get $ptr)) (i32.const "(")))))
                  (i32.add (local.get $lhs) (i32.const 1))
                  (local.get $p))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
                (local.set $nameEnd (global.get $ptr))
                (if (local.get $decl)
                  (then
                    (local.set $defEnd (global.get $ptr))
                    (global.set $sigFnPend (i32.const 1))
                    (global.set $sigFnAngle (i32.const 0))))
                (br $next)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; pragmas: `{.inline, raises: [].}`
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const ".")))
            (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $pragma (i32.const 1))
            (br $next)))
        (if
          (i32.and
            (i32.ne (local.get $pragma) (i32.const 0))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const "}"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $pragma (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            ;; parameter machine: `(` may open the armed routine list and puts
            ;; the next name in parameter position; `[` right after the name
            ;; is a generic list; brackets inside a marked list obscure its
            ;; top level (types and default values)
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (global.set $sigParens (i32.add (global.get $sigParens) (i32.const 1)))
                (if (i32.eqz (global.get $sigFnAngle))
                  (then
                    (if (global.get $sigFnPend)
                      (then (call $sigMark)))
                    (global.set $sigFnPend (i32.const 0))))
                (global.set $sigPattern (i32.const 1)))
              (else
                (global.set $sigPattern (i32.const 0))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (if (call $sigActive)
                      (then (call $sigUnmark)))
                    (if (global.get $sigParens)
                      (then
                        (global.set $sigParens (i32.sub (global.get $sigParens) (i32.const 1))))))
                  (else
                    (if (global.get $sigFnPend)
                      (then
                        (if (i32.eq (local.get $c) (i32.const "["))
                          (then
                            (global.set $sigFnAngle (i32.add (global.get $sigFnAngle) (i32.const 1))))
                          (else
                            (if (i32.eq (local.get $c) (i32.const "]"))
                              (then (call $sigFnAngleDrop (i32.const 1)))
                              (else (global.set $sigFnPend (i32.const 0)))))))
                      (else
                        (if (call $sigActive)
                          (then
                            (if (byteset.get "[{" (local.get $c))
                              (then
                                (global.set $sigObscure (i32.add (global.get $sigObscure) (i32.const 1))))
                              (else
                                (if (global.get $sigObscure)
                                  (then
                                    (global.set $sigObscure
                                      (i32.sub (global.get $sigObscure) (i32.const 1)))))))))))))))
            (if (byteset.get "([{" (local.get $c))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
              (else
                (if (local.get $depth)
                  (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            ;; both separate parameters: `(a, b: int; c = 1)`
            (global.set $sigPattern (i32.const 1))
            (if (i32.eq (local.get $pragma) (i32.const 2))
              (then (local.set $pragma (i32.const 1))))
            (if (local.get $import)
              (then
                (local.set $import
                  (select (i32.const 2) (i32.const 0) (i32.eq (local.get $c) (i32.const ","))))))
            (br $next)))

        (if (byteset.get "=+-*/<>@$~&%|!?^.:\\" (local.get $c))
          (then
            (global.set $sigPattern (i32.const 0))
            ;; an export marker right after a name: `proc run*(`, `field*: int`
            (if
              (i32.and
                (i32.and (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $lhs) (local.get $nameEnd)))
                (i32.or
                  (i32.eq (local.get $lhs) (local.get $defEnd))
                  (byteset.get ":,[ \09\0a\0d" (local.get $c2))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (loop $op
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (local.set $p (call $templateByte (global.get $ptr)))
              (br_if $op (byteset.get "=+-*/<>@$~&%|!?^.:\\" (local.get $p))))
            ;; a lone `.` or `:` is punctuation
            (if
              (i32.and
                (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1))
                (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ":"))))
              (then
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $afterDot (i32.eq (local.get $c) (i32.const "."))))
              (else (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
