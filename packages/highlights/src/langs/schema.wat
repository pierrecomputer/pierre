(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")

  ;; WIT, Smithy, Pkl, CUE, and ZenScript: curly-brace declaration languages
  ;; with one lexer. $d selects the dialect: 0 WIT, 1 Smithy, 2 Pkl, 3 CUE,
  ;; 4 ZenScript.
  (func $hlWit
    (call $hlSchemaImpl (i32.const 0)))
  (func $hlSmithy
    (call $hlSchemaImpl (i32.const 1)))
  (func $hlPkl
    (call $hlSchemaImpl (i32.const 2)))
  (func $hlCue
    (call $hlSchemaImpl (i32.const 3)))
  (func $hlZenscript
    (call $hlSchemaImpl (i32.const 4)))

  (memory-region $mem.witWords 132)
  (memory-region $mem.smithyWords 128)
  (memory-region $mem.pklWords 140)
  (memory-region $mem.cueWords 120)
  (memory-region $mem.zsWords 164)

  ;; Each value is the token in the low byte and the next-name capture in
  ;; bits 8-9: 1 type, 2 function, 3 namespace. Bit 10 marks a declaration
  ;; whose `{` block lists cases, which are constants.
  (keyword-table $witWords $mem.witWords $mem.witWords+132
    (group $Token.keyword.declaration+256 "interface" "world" "record" "resource" "type")
    (group $Token.keyword.declaration+1280 "variant" "enum" "flags")
    (group $Token.keyword.declaration+768 "package")
    (group $Token.keyword.declaration "func" "constructor")
    (group $Token.keyword.import "use" "import" "export" "include")
    (group $Token.keyword "with" "as" "from" "static" "async")
    (group $Token.type.builtin
      "bool" "char" "string" "float32" "float64" "borrow" "own" "result" "option" "list" "tuple"
      "future" "stream"))
  (keyword-table $smithyWords $mem.smithyWords $mem.smithyWords+128
    (group $Token.keyword.declaration+256
      "structure" "service" "operation" "resource" "union" "list" "set" "map" "string" "blob"
      "boolean" "byte" "short" "integer" "long" "float" "double" "bigInteger" "bigDecimal"
      "timestamp" "document")
    (group $Token.keyword.declaration+1280 "enum" "intEnum")
    (group $Token.keyword.declaration+768 "namespace")
    (group $Token.keyword.import "use")
    (group $Token.keyword "metadata" "apply" "with" "for")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))
  (keyword-table $pklWords $mem.pklWords $mem.pklWords+140
    (group $Token.keyword.declaration+256 "class" "typealias")
    (group $Token.keyword.declaration+512 "function")
    (group $Token.keyword.declaration+768 "module")
    (group $Token.keyword.import "import")
    (group $Token.keyword
      "amends" "extends" "local" "hidden" "const" "fixed" "abstract" "open" "external" "new" "let"
      "throw" "trace" "read")
    (group $Token.keyword.control "when" "for" "in" "if" "else")
    (group $Token.keyword.operator "is" "as")
    (group $Token.variable.special "this" "outer" "super")
    (group $Token.type.builtin "unknown" "nothing")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))
  (keyword-table $cueWords $mem.cueWords $mem.cueWords+120
    (group $Token.keyword.declaration+768 "package")
    (group $Token.keyword.import "import")
    (group $Token.keyword "let")
    (group $Token.keyword.control "for" "in" "if")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.type.builtin
      "bool" "int" "int8" "int16" "int32" "int64" "int128" "uint" "uint8" "uint16" "uint32" "uint64"
      "uint128" "float" "float32" "float64" "string" "bytes" "number" "rune"))
  (keyword-table $zsWords $mem.zsWords $mem.zsWords+164
    (group $Token.keyword.declaration "val" "var" "global" "static" "zenConstructor")
    (group $Token.keyword.declaration+512 "function")
    (group $Token.keyword.declaration+256 "zenClass")
    (group $Token.keyword.import+768 "import")
    (group $Token.keyword.control "if" "else" "for" "while" "return" "break" "continue" "in")
    (group $Token.keyword.operator+256 "as")
    (group $Token.keyword.operator "has" "instanceof" "to")
    (group $Token.variable.special "this")
    (group $Token.type.builtin
      "void" "bool" "byte" "short" "int" "long" "float" "double" "string" "any")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.preproc
      "#loader" "#priority" "#modloaded" "#norun" "#debug" "#ignoreBracketErrors"))

  ;; The keyword table value of [lhs,rhs) for dialect $d, or -1.
  (func $schemaWord (param $d i32) (param $lhs i32) (param $rhs i32) (result i32)
    (if (i32.eqz (local.get $d))
      (then (return (keyword-table.value $witWords (local.get $lhs) (local.get $rhs)))))
    (if (i32.eq (local.get $d) (i32.const 1))
      (then (return (keyword-table.value $smithyWords (local.get $lhs) (local.get $rhs)))))
    (if (i32.eq (local.get $d) (i32.const 2))
      (then (return (keyword-table.value $pklWords (local.get $lhs) (local.get $rhs)))))
    (if (i32.eq (local.get $d) (i32.const 3))
      (then (return (keyword-table.value $cueWords (local.get $lhs) (local.get $rhs)))))
    (keyword-table.value $zsWords (local.get $lhs) (local.get $rhs)))

  ;; Whether $h `#` bytes start at $p, as Pkl and CUE custom string
  ;; delimiters need after a closing quote or a backslash.
  (func $schemaHashes (param $p i32) (param $h i32) (result i32)
    (block $no
      (loop $l
        (br_if $no (i32.eqz (local.get $h)))
        (if (i32.ne (call $templateByte (local.get $p)) (i32.const "#"))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $h (i32.sub (local.get $h) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; Scan the body of the string that $str describes from $ptr: the quote in
  ;; the low byte, bit 8 for a triple quote, and the `#` count above. Emit
  ;; text as string and escapes as string.escape. Return 0 after the closing
  ;; delimiter or at the line break that ends a one-line string, $str when
  ;; the body continues in the next chunk, or -1 at an interpolation `\(`
  ;; that $interp allows, with $ptr left on the backslash.
  (func $schemaStringBody (param $str i32) (param $interp i32) (result i32)
    (local $q i32)
    (local $h i32)
    (local $triple i32)
    (local $seg i32)
    (local $p i32)
    (local $c i32)
    (local $e i32)
    (local $cont i32)
    (local.set $q (i32.and (local.get $str) (i32.const 255)))
    (local.set $triple (i32.and (i32.shr_u (local.get $str) (i32.const 8)) (i32.const 1)))
    (local.set $h (i32.shr_u (local.get $str) (i32.const 9)))
    (local.set $seg (global.get $ptr))
    (block $closed
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $q)
            (i32.const 1)
            (i32.eqz (local.get $triple))))
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            ;; a one-line string continues only after an escaped line break
            (return
              (select
                (local.get $str)
                (i32.const 0)
                (i32.or
                  (local.get $triple)
                  (i32.and (local.get $cont) (i32.eq (global.get $ptr) (local.get $seg))))))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $triple)
              (then
                (local.set $p
                  (select
                    (i32.add (local.get $p) (i32.const 2))
                    (i32.const 0)
                    (i32.and
                      (i32.eq (call $templateByte (local.get $p)) (local.get $q))
                      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (local.get $q)))))))
            (if (i32.and (i32.ne (local.get $p) (i32.const 0)) (call $schemaHashes (local.get $p) (local.get $h)))
              (then
                (global.set $ptr (i32.add (local.get $p) (local.get $h)))
                (br $closed)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        ;; a raw line break ends a one-line string, unconsumed
        (br_if $closed (i32.ne (local.get $c) (i32.const 92)))
        (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.eqz (call $schemaHashes (local.get $p) (local.get $h)))
          (then
            (global.set $ptr (local.get $p))
            (br $scan)))
        (local.set $p (i32.add (local.get $p) (local.get $h)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (local.set $c (call $templateByte (local.get $p)))
        (if (i32.and (local.get $interp) (i32.eq (local.get $c) (i32.const "(")))
          (then (return (i32.const -1))))
        (local.set $e (call $lexEscapeEnd (i32.sub (local.get $p) (i32.const 1))))
        ;; `\u{1F600}`, `A`, `\U0001F600`, `\x41`
        (if (i32.or (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "u")) (i32.eq (local.get $c) (i32.const "x")))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (if (i32.eq (call $templateByte (local.get $p)) (i32.const "{"))
              (then
                (local.set $p (call $scanHexRun (i32.add (local.get $p) (i32.const 1)) (i32.const 8)))
                (local.set $p
                  (i32.add (local.get $p) (i32.eq (call $templateByte (local.get $p)) (i32.const "}")))))
              (else
                (local.set $p
                  (call $scanHexRun
                    (local.get $p)
                    (select
                      (i32.const 2)
                      (select (i32.const 8) (i32.const 4) (i32.eq (local.get $c) (i32.const "U")))
                      (i32.eq (local.get $c) (i32.const "x")))))))
            (if (i32.gt_u (local.get $p) (local.get $e))
              (then (local.set $e (local.get $p))))))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (local.set $c (i32.load8_u (i32.sub (local.get $e) (i32.const 1))))
        (local.set $cont (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; $str is an open string body (see $schemaStringBody), resumed at the top
  ;; of the loop. $interp holds an open `\(` interpolation: its paren depth
  ;; in the low byte and the enclosing string above, restored at the
  ;; closing `)`. $ctx is 1 after `.`, 2 in a type position (after `:` in
  ;; WIT, Smithy, and Pkl, or after a WIT operator), and $expect the next-name
  ;; capture of a keyword. $opens marks a case declaration until its `{`, and
  ;; $block that case block. $angle counts WIT `<` brackets.
  (func $hlSchemaImpl (param $d i32)
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $nctx i32)
    (local $str i32)
    (local $interp i32)
    (local $expect i32)
    (local $ctx i32)
    (local $paren i32)
    (local $angle i32)
    (local $block i32)
    (local $opens i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $str)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $p
              (call $schemaStringBody
                (local.get $str)
                (i32.and
                  (i32.eqz (local.get $interp))
                  (i32.le_u (i32.sub (local.get $d) (i32.const 2)) (i32.const 1)))))
            (local.set $ctx (i32.const 0))
            (if (i32.ge_s (local.get $p) (i32.const 0))
              (then
                (local.set $str (local.get $p))
                (br $next)))
            ;; `\(` or `\#(`: its `)` returns to this string
            (local.set $lhs (global.get $ptr))
            (global.set $ptr
              (i32.add (local.get $lhs) (i32.add (i32.const 2) (i32.shr_u (local.get $str) (i32.const 9)))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $interp (i32.or (i32.const 1) (i32.shl (local.get $str) (i32.const 8))))
            (local.set $str (i32.const 0))
            (br $next)))
        (local.set $nctx (i32.const 0))
        (block $emit
          (block $word
            (local.set $gap (global.get $ptr))
            (call $scanWhitespace)
            (call $emitGap (local.get $gap) (global.get $ptr))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $lhs (global.get $ptr))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))

            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (if (i32.eq (local.get $c2) (i32.const "/"))
                  (then
                    (global.set $ptr (local.get $lhs))
                    (call $lexLineComment
                      (i32.const 2)
                      (select
                        (enum.get $Token.comment.doc)
                        (enum.get $Token.comment)
                        (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "/"))))
                    (br $next)))
                ;; Smithy and CUE have no block comments
                (if
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "*"))
                    (i32.and (i32.ne (local.get $d) (i32.const 1)) (i32.ne (local.get $d) (i32.const 3))))
                  (then
                    (global.set $ptr (local.get $lhs))
                    (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                    (br $next)))))

            ;; strings: `"`, `'` in CUE and ZenScript, triple quotes in Smithy,
            ;; Pkl, and CUE, and `#"…"#` custom delimiters in Pkl and CUE
            (local.set $p (local.get $lhs))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "#"))
                (i32.le_u (i32.sub (local.get $d) (i32.const 2)) (i32.const 1)))
              (then
                (loop $hashes
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br_if $hashes (i32.eq (call $templateByte (local.get $p)) (i32.const "#"))))))
            (local.set $g (call $templateByte (local.get $p)))
            (if
              (i32.and
                (i32.ne (local.get $d) (i32.const 0))
                (i32.or
                  (i32.eq (local.get $g) (i32.const 34))
                  (i32.and
                    (i32.eq (local.get $g) (i32.const 39))
                    (i32.ge_u (local.get $d) (i32.const 3)))))
              (then
                (local.set $c
                  (i32.and
                    (i32.lt_u (i32.sub (local.get $d) (i32.const 1)) (i32.const 3))
                    (i32.and
                      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (local.get $g))
                      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (local.get $g)))))
                (local.set $rhs (i32.sub (local.get $p) (local.get $lhs)))
                (if (i32.gt_u (local.get $rhs) (i32.const 255))
                  (then (local.set $rhs (i32.const 255))))
                (global.set $ptr
                  (i32.add (local.get $p) (i32.add (i32.const 1) (i32.shl (local.get $c) (i32.const 1)))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $str
                  (i32.or
                    (local.get $g)
                    (i32.or
                      (i32.shl (local.get $c) (i32.const 8))
                      (i32.shl (local.get $rhs) (i32.const 9)))))
                (local.set $ctx (i32.const 0))
                (br $next)))

            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                ;; CUE definitions: `#Service`
                (if (i32.and (i32.eq (local.get $d) (i32.const 3)) (call $lexIsNameStart (local.get $c2)))
                  (then
                    (call $lexScanIdent)
                    (local.set $hl (enum.get $Token.type))
                    (br $emit)))
                ;; ZenScript: a known preprocessor line, else a comment
                (if (i32.eq (local.get $d) (i32.const 4))
                  (then
                    (call $lexScanIdent)
                    (local.set $hl
                      (select
                        (enum.get $Token.preproc)
                        (enum.get $Token.comment)
                        (i32.eq
                          (call $schemaWord (local.get $d) (local.get $lhs) (global.get $ptr))
                          (enum.get $Token.preproc))))
                    (global.set $ptr (local.get $lhs))
                    (call $lexLineComment (i32.const 0) (local.get $hl))
                    (br $next)))
                ;; the Smithy shape id separator: `smithy.api#String`
                (local.set $nctx (i32.const 2))
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                (br $emit)))

            (if (i32.eq (local.get $d) (i32.const 3))
              (then
                (if (i32.eq (local.get $c) (i32.const "_"))
                  (then
                    ;; bottom `_|_` and hidden definitions `_#Name`
                    (if
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const "|"))
                        (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "_")))
                      (then
                        (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                        (local.set $hl (enum.get $Token.constant.builtin))
                        (br $emit)))
                    (if (i32.eq (local.get $c2) (i32.const "#"))
                      (then
                        (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                        (call $lexScanIdent)
                        (local.set $hl (enum.get $Token.type))
                        (br $emit)))))))

            (if (i32.eq (local.get $c) (i32.const "@"))
              (then
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                (br_if $emit (i32.eqz (call $lexIsNameStart (local.get $c2))))
                ;; Smithy traits may use shape ids: `@smithy.api#required`
                (call $scanIdentRun (select (i32.const ".") (i32.const "$") (i32.eq (local.get $d) (i32.const 1))))
                (if
                  (i32.and
                    (i32.eq (local.get $d) (i32.const 1))
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "#")))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $scanIdentRun (i32.const "."))))
                (local.set $hl (enum.get $Token.attribute))
                (br $emit)))

            ;; Smithy `$version: "2"` control statements and `$member` targets
            (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $d) (i32.const 1)))
              (then
                (call $scanIdentRun (i32.const "_"))
                (local.set $hl
                  (select
                    (enum.get $Token.preproc)
                    (enum.get $Token.property)
                    (i32.eq (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const ":"))))
                (br $emit)))

            ;; WIT `%keyword` names and Pkl backquoted names
            (if (i32.and (i32.eq (local.get $c) (i32.const "%")) (i32.eqz (local.get $d)))
              (then
                (if (call $lexIsNameStart (local.get $c2))
                  (then (local.set $c (i32.const "_"))))))
            (if (i32.and (i32.eq (local.get $c) (i32.const 96)) (i32.eq (local.get $d) (i32.const 2)))
              (then
                (global.set $ptr
                  (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 96) (i32.const 0) (i32.const 1)))
                (global.set $ptr
                  (i32.add (global.get $ptr) (i32.eq (call $templateByte (global.get $ptr)) (i32.const 96))))
                (br $word)))

            (if (call $lexIsIdentStart (local.get $c))
              (then
                (global.set $ptr (local.get $lhs))
                (if (i32.eqz (local.get $d))
                  (then
                    ;; kebab-case: `input-stream` is one name, `x->` is not
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $scanIdentRun (i32.const "-"))
                    (loop $trim
                      (if (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "-"))
                        (then
                          (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))
                          (br $trim))))
                    (br $word)))
                (if (i32.eq (local.get $d) (i32.const 1))
                  (then
                    ;; a dotted Smithy namespace is one name
                    (call $scanIdentRun (i32.const "_"))
                    (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                      (then
                        (call $scanIdentRun (i32.const "."))
                        (local.set $nctx (i32.const 3))))
                    (br $word)))
                (call $lexScanIdent)
                (br $word)))

            (if
              (i32.or
                (call $lexIsDigit (local.get $c))
                (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
              (then
                (global.set $ptr (local.get $lhs))
                (call $lexScanNumber)
                (local.set $hl (enum.get $Token.number))
                (br $emit)))

            ;; ZenScript bracket handlers: `<minecraft:dirt:1>` is one token
            (if
              (i32.and
                (i32.and (i32.eq (local.get $d) (i32.const 4)) (i32.eq (local.get $c) (i32.const "<")))
                (call $lexIsNameStart (local.get $c2)))
              (then
                (local.set $p (global.get $ptr))
                (local.set $g (i32.const 0))
                (block $notHandler
                  (loop $handler
                    (local.set $c2 (call $templateByte (local.get $p)))
                    (br_if $notHandler (i32.le_u (local.get $c2) (i32.const 32)))
                    (br_if $notHandler (i32.eq (local.get $c2) (i32.const "<")))
                    (if (i32.eq (local.get $c2) (i32.const ">"))
                      (then
                        (br_if $notHandler (i32.eqz (local.get $g)))
                        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                        (local.set $hl (enum.get $Token.string.special))
                        (br $emit)))
                    (local.set $g (i32.or (local.get $g) (i32.eq (local.get $c2) (i32.const ":"))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $handler)))))

            ;; punctuation and operators end a pending capture, except a dot
            ;; inside a dotted namespace
            (local.set $p (local.get $expect))
            (local.set $expect (i32.const 0))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (byteset.get "()[]{}" (local.get $c))
              (then
                (if (i32.eq (local.get $c) (i32.const "("))
                  (then
                    (local.set $paren (i32.add (local.get $paren) (i32.const 1)))
                    (if (i32.and (i32.ne (local.get $interp) (i32.const 0)) (i32.lt_u (i32.and (local.get $interp) (i32.const 255)) (i32.const 255)))
                      (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (if (i32.eq (i32.and (local.get $interp) (i32.const 255)) (i32.const 1))
                      (then
                        (local.set $str (i32.shr_u (local.get $interp) (i32.const 8)))
                        (local.set $interp (i32.const 0))
                        (local.set $hl (enum.get $Token.punctuation.special))
                        (br $emit)))
                    (if (local.get $interp)
                      (then (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))))
                    (if (local.get $paren)
                      (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))))
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then
                    ;; WIT `use a.{b, c}` lists types
                    (local.set $block
                      (select (i32.const 2) (local.get $opens) (i32.eq (local.get $ctx) (i32.const 1))))
                    (local.set $opens (i32.const 0))
                    (local.set $angle (i32.const 0))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $block (i32.const 0))
                    (local.set $opens (i32.const 0))
                    (local.set $angle (i32.const 0))))
                (br $emit)))
            (if (i32.and (i32.eqz (local.get $d)) (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">"))))
              (then
                (local.set $angle
                  (select
                    (i32.add (local.get $angle) (i32.const 1))
                    (i32.sub (local.get $angle) (i32.ne (local.get $angle) (i32.const 0)))
                    (i32.eq (local.get $c) (i32.const "<"))))
                (br $emit)))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.eq (local.get $c) (i32.const "."))
              (then
                (if (i32.eq (local.get $c2) (i32.const "."))
                  (then
                    (global.set $ptr
                      (i32.add
                        (local.get $lhs)
                        (i32.add
                          (i32.const 2)
                          (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const ".")))))
                    (local.set $hl (enum.get $Token.operator))
                    (br $emit)))
                (local.set $nctx (i32.const 1))
                (if (i32.eq (local.get $p) (i32.const 3))
                  (then (local.set $expect (i32.const 3))))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (if (i32.eq (local.get $c2) (i32.const "="))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                    (local.set $hl (enum.get $Token.operator))
                    (br $emit)))
                ;; WIT `wasi:http` continues a package path
                (local.set $nctx
                  (select
                    (i32.const 3)
                    (i32.shl (i32.le_u (local.get $d) (i32.const 2)) (i32.const 1))
                    (i32.and (i32.eqz (local.get $d)) (call $lexIsNameStart (local.get $c2)))))
                (br $emit)))
            (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (then
                (if (i32.eq (local.get $c) (i32.const ";"))
                  (then
                    (local.set $opens (i32.const 0))
                    (local.set $angle (i32.const 0))))
                (br $emit)))
            (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
              (then
                ;; stop before a comment: `=//`
                (block $opDone
                  (loop $op
                    (local.set $c (call $templateByte (global.get $ptr)))
                    (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                    (br_if $opDone
                      (i32.and
                        (i32.eq (local.get $c) (i32.const "/"))
                        (i32.or
                          (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "/"))
                          (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "*")))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))
                ;; WIT `->` and `=` lead to a type, `/` to an interface name
                (if (i32.eqz (local.get $d))
                  (then
                    (local.set $nctx
                      (select (i32.const 3) (i32.const 2) (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "/"))))))
                (local.set $hl (enum.get $Token.operator))
                (br $emit)))
            (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
            (local.set $hl (enum.get $Token.none))
            (br $emit))

          ;; a name in [lhs,ptr); $nctx 3 marks a dotted Smithy name
          (local.set $rhs (global.get $ptr))
          (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
          (local.set $c2 (call $templateByte (local.get $p)))
          (local.set $g (local.get $nctx))
          (local.set $nctx (i32.const 0))
          (block $classified
            ;; a member after `.`, unless it continues a dotted namespace
            (if (i32.and (i32.eq (local.get $ctx) (i32.const 1)) (i32.ne (local.get $expect) (i32.const 3)))
              (then
                (local.set $hl
                  (select
                    (enum.get $Token.function)
                    (enum.get $Token.property)
                    (i32.eq (local.get $c2) (i32.const "("))))
                (br $classified)))
            (local.set $hl (enum.get $Token.namespace))
            (br_if $classified (i32.eq (local.get $ctx) (i32.const 3)))
            ;; a label: `name:`, CUE `name?:` and `name!:`; not in ZenScript,
            ;; where `:` is part of `? :`
            (local.set $gap
              (i32.and
                (i32.ne (local.get $d) (i32.const 4))
                (i32.or
                  (i32.eq (local.get $c2) (i32.const ":"))
                  (i32.and
                    (i32.eq (local.get $d) (i32.const 3))
                    (i32.and
                      (i32.or (i32.eq (local.get $c2) (i32.const "?")) (i32.eq (local.get $c2) (i32.const "!")))
                      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))))))
            ;; a function name after `function` may be a type keyword: `double`
            (if (i32.eqz (i32.or (local.get $gap) (i32.eq (local.get $expect) (i32.const 2))))
              (then
                (local.set $hl (call $schemaWord (local.get $d) (local.get $lhs) (local.get $rhs)))
                (if (i32.ge_s (local.get $hl) (i32.const 0))
                  (then
                    ;; `module.output` is a reference, not a declaration
                    (if (i32.ne (local.get $c2) (i32.const "."))
                      (then
                        (local.set $expect (i32.and (i32.shr_u (local.get $hl) (i32.const 8)) (i32.const 3)))))
                    (local.set $opens (i32.or (local.get $opens) (i32.shr_u (local.get $hl) (i32.const 10))))
                    (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                    (br $classified)))))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (local.set $rhs (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
            (if (local.get $expect)
              (then
                (local.set $hl
                  (select
                    (enum.get $Token.function.definition)
                    (select
                      (enum.get $Token.type)
                      (enum.get $Token.namespace)
                      (i32.or (i32.eq (local.get $expect) (i32.const 1)) (local.get $rhs)))
                    (i32.eq (local.get $expect) (i32.const 2))))
                (if (i32.or (i32.ne (local.get $expect) (i32.const 3)) (i32.ne (local.get $c2) (i32.const ".")))
                  (then (local.set $expect (i32.const 0))))
                (br $classified)))
            (if (local.get $gap)
              (then
                (if (i32.eqz (local.get $d))
                  (then
                    ;; `wasi:http` names a package; `name: func` a function
                    (local.set $hl (enum.get $Token.namespace))
                    (br_if $classified
                      (i32.and
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ":"))
                        (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                    (local.set $p (i32.load (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1)))))
                    (local.set $hl (enum.get $Token.function.definition))
                    (br_if $classified
                      (i32.or
                        (i32.eq (local.get $p) (i32.const "func"))
                        (i32.or (i32.eq (local.get $p) (i32.const "stat")) (i32.eq (local.get $p) (i32.const "asyn")))))))
                (local.set $hl
                  (select (enum.get $Token.variable.parameter) (enum.get $Token.property) (local.get $paren)))
                (br $classified)))
            (local.set $hl (enum.get $Token.namespace))
            ;; WIT `wasi:http/types@0.2.0`, Smithy `smithy.api#String`
            (br_if $classified
              (i32.and
                (i32.eqz (local.get $d))
                (i32.or (i32.eq (local.get $c2) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "@")))))
            (br_if $classified
              (i32.and
                (i32.eq (local.get $d) (i32.const 1))
                (i32.or
                  (i32.eq (local.get $g) (i32.const 3))
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "#")))))
            (local.set $hl (enum.get $Token.type.builtin))
            ;; CUE top `_`; WIT `u8`, `s64`, `f32`
            (br_if $classified
              (i32.and
                (i32.eq (local.get $d) (i32.const 3))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "_"))
                  (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))))
            (br_if $classified
              (i32.and
                (i32.eqz (local.get $d))
                (i32.and
                  (i32.le_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 3))
                  (i32.and
                    (i32.and
                      (call $lexIsDigit (i32.load8_u offset=1 (local.get $lhs)))
                      (call $lexIsDigit (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))))
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "u"))
                      (i32.or (i32.eq (local.get $c) (i32.const "s")) (i32.eq (local.get $c) (i32.const "f"))))))))
            (local.set $hl (enum.get $Token.constant))
            (br_if $classified
              (i32.and
                (i32.eq (local.get $block) (i32.const 1))
                (i32.and
                  (i32.eqz (local.get $paren))
                  (i32.ne (local.get $ctx) (i32.const 2)))))
            (br_if $classified (call $lexIsConstCase (local.get $lhs) (global.get $ptr)))
            (local.set $hl (enum.get $Token.type))
            (br_if $classified (i32.and (local.get $rhs) (i32.ne (local.get $d) (i32.const 3))))
            (local.set $hl (enum.get $Token.function))
            (br_if $classified (i32.eq (local.get $c2) (i32.const "(")))
            (local.set $hl (enum.get $Token.type))
            (br_if $classified
              (i32.or
                (i32.or (i32.eq (local.get $ctx) (i32.const 2)) (local.get $angle))
                (i32.and (i32.eqz (local.get $d)) (i32.ne (local.get $block) (i32.const 0)))))
            ;; Pkl members: `name = value`, `name { … }`
            (local.set $hl (enum.get $Token.property))
            (br_if $classified
              (i32.and
                (i32.eq (local.get $d) (i32.const 2))
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "{"))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "="))))))
            (local.set $hl (enum.get $Token.variable))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (local.set $ctx (local.get $nctx))
        (br $next))))
)
