(module
  (import "../common.wat")

  (func $odinByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Endian-specific numeric types, such as `i32le` and `f64be`. They cannot
  ;; share the keyword table because `i16le` and `i16be` hash alike.
  (func $odinEndianType (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local $width i32)
    (if (i32.lt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
      (then (return (i32.const 0))))
    (local.set $c (i32.load16_u (i32.sub (local.get $rhs) (i32.const 2))))
    (if
      (i32.eqz
        (i32.or (i32.eq (local.get $c) (i32.const "le")) (i32.eq (local.get $c) (i32.const "be"))))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $lhs)))
    (if
      (i32.eqz
        (i32.or
          (i32.eq (local.get $c) (i32.const "i"))
          (i32.or (i32.eq (local.get $c) (i32.const "u")) (i32.eq (local.get $c) (i32.const "f")))))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $done
      (loop $digit
        (br_if $done (i32.ge_u (local.get $p) (i32.sub (local.get $rhs) (i32.const 2))))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eqz (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (then (return (i32.const 0))))
        (local.set $width
          (i32.add (i32.mul (local.get $width) (i32.const 10)) (i32.sub (local.get $c) (i32.const "0"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $digit)))
    (if (i32.eq (local.get $width) (i32.const 16))
      (then (return (i32.const 1))))
    (if (i32.eq (local.get $width) (i32.const 32))
      (then (return (i32.const 1))))
    (if (i32.eq (local.get $width) (i32.const 64))
      (then (return (i32.const 1))))
    (if
      (i32.and
        (i32.eq (local.get $width) (i32.const 128))
        (i32.ne (i32.load8_u (local.get $lhs)) (i32.const "f")))
      (then (return (i32.const 1))))
    (i32.const 0))

  ;; Group values carry a declaration kind in the high byte so the `::`
  ;; lookahead can tell a proc definition from a type construction or a
  ;; constant: 1 = proc, 2 = type constructor, 3 = package/import namespace.
  (keyword-table $odinWords $mem.odinWords $mem.leanWords
    (group $Token.keyword.control ;; 1: control flow
      "if" "else" "for" "in" "do" "when" "switch" "case" "break" "continue"
      "fallthrough" "defer" "return" "not_in" "or_else" "or_return" "or_break"
      "or_continue")
    (group $Token.keyword.declaration+256 "proc") ;; 2: procedure definition
    (group $Token.keyword.declaration+512 ;; 3: type constructors
      "struct" "union" "enum" "bit_set" "bit_field" "map" "matrix" "distinct")
    (group $Token.keyword.declaration+768 "package") ;; 4: next name is a package
    (group $Token.keyword.import+768 "import")       ;; 5: next name is an import alias
    (group $Token.keyword.declaration ;; 6: declarations
      "foreign" "where" "using" "dynamic")
    (group $Token.type.builtin ;; 7: built-in types
      "bool" "b8" "b16" "b32" "b64" "byte" "i8" "u8" "i16" "u16" "i32" "u32"
      "i64" "u64" "i128" "u128" "int" "uint" "uintptr" "rune" "f16" "f32" "f64"
      "complex32" "complex64" "complex128" "quaternion64" "quaternion128"
      "quaternion256" "rawptr" "string" "cstring" "string16" "cstring16" "any"
      "typeid")
    (group $Token.keyword ;; 8: operators and special values
      "cast" "transmute" "auto_cast" "asm" "context")
    (group $Token.boolean "true" "false") ;; 9: booleans
    (group $Token.constant.builtin "nil")) ;; 10: built-in constant

  ;; Classify the word after a `::`. Skip one leading directive such as
  ;; `#force_inline`, so `x :: #force_inline proc()` reads as a function.
  ;; `#type` marks the value as a type. Return 1 for proc, 2 for a type or
  ;; type constructor, 3 otherwise.
  (func $odinDeclKind (param $p i32) (result i32)
    (local $save i32)
    (local $q i32)
    (local $v i32)
    (local.set $save (global.get $ptr))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.eq (call $odinByte (local.get $p)) (i32.const "#"))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $p (call $lexSkipSpaceAt (local.get $p)))
        (if (call $lexIsIdentStart (call $odinByte (local.get $p)))
          (then
            (global.set $ptr (local.get $p))
            (call $lexScanIdent)
            (local.set $q (global.get $ptr))
            (if
              (i32.and
                (i32.eq (i32.sub (local.get $q) (local.get $p)) (i32.const 4))
                (i32.eq (i32.load (local.get $p)) (i32.const "type")))
              (then
                (global.set $ptr (local.get $save))
                (return (i32.const 2))))
            (local.set $p (local.get $q))))))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.eqz (call $lexIsIdentStart (call $odinByte (local.get $p))))
      (then
        (global.set $ptr (local.get $save))
        (return (i32.const 3))))
    (global.set $ptr (local.get $p))
    (call $lexScanIdent)
    (local.set $q (global.get $ptr))
    (global.set $ptr (local.get $save))
    (if (call $odinEndianType (local.get $p) (local.get $q))
      (then (return (i32.const 2))))
    (local.set $v (keyword-table.value $odinWords (local.get $p) (local.get $q)))
    (if (i32.lt_s (local.get $v) (i32.const 0))
      (then (return (i32.const 3))))
    (if (i32.eq (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.type.builtin))
      (then (return (i32.const 2))))
    (local.set $v (i32.shr_u (i32.and (local.get $v) (i32.const 0xffff)) (i32.const 8)))
    (if (i32.eq (local.get $v) (i32.const 1))
      (then (return (i32.const 1))))
    (if (i32.eq (local.get $v) (i32.const 2))
      (then (return (i32.const 2))))
    (i32.const 3))

  ;; Length of the operator starting at $c: one to three bytes.
  (func $odinOpLen (param $c i32) (param $c2 i32) (param $c3 i32) (result i32)
    (local $n i32)
    (local.set $n (i32.const 1))
    (if (i32.eq (local.get $c2) (i32.const "="))
      (then (local.set $n (i32.const 2))))
    (if
      (i32.or
        (i32.and
          (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))
          (i32.eq (local.get $c2) (local.get $c)))
        (i32.or
          (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
            (i32.eq (local.get $c2) (local.get $c)))))
      (then (local.set $n (i32.const 2))))
    (if
      (i32.and (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c2) (i32.const "*")))
      (then (local.set $n (i32.const 2))))
    (if
      (i32.and (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c2) (i32.const "~")))
      (then (local.set $n (i32.const 2))))
    (if
      (i32.and (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c2) (i32.const "%")))
      (then (local.set $n (i32.const 2))))
    (if
      (i32.or
        (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
        (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c2) (i32.const ">"))))
      (then (local.set $n (i32.const 2))))
    ;; three-byte assignments: &&= ||= &~= %%= <<= >>=
    (if
      (i32.and
        (i32.eq (local.get $c3) (i32.const "="))
        (i32.or
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))
            (i32.eq (local.get $c2) (local.get $c)))
          (i32.or
            (i32.and (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c2) (i32.const "~")))
            (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c2) (i32.const "%")))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                (i32.eq (local.get $c2) (local.get $c)))))))
      (then (local.set $n (i32.const 3))))
    (local.get $n))

  ;; Scan a multi-line string body at $ptr for a closing triple quote.
  ;; Return 1 when closed, 0 when the scan reaches $end. $seg starts the
  ;; pending string token and $raw skips escape handling for raw strings.
  (func $odinTripleBody (param $quote i32) (param $raw i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if
          (i32.and
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
            (i32.and
              (i32.eq (local.get $c) (local.get $quote))
              (i32.and
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
                (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote)))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (if
          (i32.and (i32.eqz (local.get $raw)) (i32.eq (local.get $c) (i32.const 92)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; Triple-quoted strings span lines and can be processed (`"""`) or raw
  ;; (three backticks). Checkpoint an unfinished one for the next stream chunk.
  (func $odinTripleString (param $quote i32)
    (local $lhs i32)
    (local $closed i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
    (local.set $closed
      (call $odinTripleBody
        (local.get $quote)
        (i32.eq (local.get $quote) (i32.const 96))
        (local.get $lhs)))
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (i32.eqz (local.get $closed))
          (i32.eq (global.get $ptr) (global.get $eof))))
      (then
        (global.set $streamMode (i32.const 23))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (i32.eq (local.get $quote) (i32.const 96))))))

  ;; Resume the unfinished triple-quoted string stored in the stream globals.
  (func $odinStreamResumeTriple (result i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (if
      (i32.eqz
        (call $odinTripleBody
          (global.get $streamA)
          (global.get $streamB)
          (local.get $lhs)))
      (then (return (i32.const 1))))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))

  ;; $expect holds a pending namespace capture (3 after package/import).
  ;; $member is 1 after `.`. $attrDepth counts open attribute parentheses.
  ;; All three are checkpointed for streaming.
  (func $hlOdin
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    (local $decl i32)
    (local $expect i32)
    (local $member i32)
    (local $attrDepth i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $odinByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $odinByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; `//` comments and `#!` shebangs run to the line end
        (if
          (i32.or
            (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
            (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "!"))))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            ;; Odin block comments nest
            (call $lexNestedBlockComment
              (i32.const "/*")
              (i32.const "*/")
              (enum.get $Token.comment))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const 34))
                (i32.eq (local.get $c3) (i32.const 34)))
              (then
                (call $odinTripleString (i32.const 34)))
              (else
                (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const "`"))
                (i32.eq (local.get $c3) (i32.const "`")))
              (then
                (call $odinTripleString (i32.const 96)))
              (else
                (call $lexRawString (i32.const "`") (i32.const 1) (enum.get $Token.string))))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        ;; `@private` and `@(private="file")`
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $lexScanIdent)
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr)))
              (else
                (if (i32.eq (local.get $c2) (i32.const "("))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                    (call $emitTok
                      (enum.get $Token.punctuation.bracket)
                      (i32.add (local.get $lhs) (i32.const 1))
                      (global.get $ptr))
                    (local.set $attrDepth (i32.add (local.get $attrDepth) (i32.const 1))))
                  (else
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok
                      (enum.get $Token.punctuation.special)
                      (local.get $lhs)
                      (global.get $ptr))))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (call $odinByte (global.get $ptr)) (i32.const "+"))
              (then
                ;; file tags such as `#+build linux, windows` run to the line
                ;; end or a comment, as in the Odin tokenizer
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (block $tagDone
                  (loop $tag
                    (br_if $tagDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (local.set $c (i32.load8_u (global.get $ptr)))
                    (br_if $tagDone
                      (i32.or
                        (i32.eq (local.get $c) (i32.const 10))
                        (i32.eq (local.get $c) (i32.const 13))))
                    (br_if $tagDone (i32.eq (local.get $c) (i32.const "/")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $tag)))
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr)))
              (else
                (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                (if (call $lexIsIdentStart (call $odinByte (local.get $p)))
                  (then
                    (global.set $ptr (local.get $p))
                    (call $lexScanIdent)
                    (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr)))
                  (else
                    (call $emitTok
                      (enum.get $Token.punctuation.special)
                      (local.get $lhs)
                      (global.get $ptr))))))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `$T` polymorphic parameter
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (call $lexIsIdentStart (call $odinByte (global.get $ptr)))
              (then
                (call $lexScanIdent)
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr)))
              (else
                (call $emitTok
                  (enum.get $Token.punctuation.special)
                  (local.get $lhs)
                  (global.get $ptr))))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `---` uninitialized value
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "-"))
            (i32.and (i32.eq (local.get $c2) (i32.const "-")) (i32.eq (local.get $c3) (i32.const "-"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
            (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            ;; attribute-list names read as attributes, not variables
            (if (i32.gt_u (local.get $attrDepth) (i32.const 0))
              (then
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (local.get $rhs))
                (local.set $member (i32.const 0))
                (br $next)))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $c2 (call $odinByte (local.get $p)))
            (local.set $c3 (call $odinByte (i32.add (local.get $p) (i32.const 1))))
            (local.set $kind (keyword-table.value $odinWords (local.get $lhs) (local.get $rhs)))
            (if
              (i32.and
                (i32.lt_s (local.get $kind) (i32.const 0))
                (call $odinEndianType (local.get $lhs) (local.get $rhs)))
              (then (local.set $kind (enum.get $Token.type.builtin))))
            (local.set $decl (i32.const 0))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const ":"))
                (i32.eq (local.get $c3) (i32.const ":")))
              (then (local.set $decl (call $odinDeclKind (i32.add (local.get $p) (i32.const 2))))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect
                  (i32.shr_u (i32.and (local.get $kind) (i32.const 0xffff)) (i32.const 8)))
                ;; only package/import arm a namespace capture
                (if (i32.ne (local.get $expect) (i32.const 3))
                  (then (local.set $expect (i32.const 0)))))
              (else
                ;; Ordinary identifiers: declaration target, member, namespace,
                ;; type, constant, call, variable, in that precedence order.
                (local.set $hl (i32.const 0))
                (if (local.get $decl)
                  (then
                    (if (i32.eq (local.get $decl) (i32.const 1))
                      (then (local.set $hl (enum.get $Token.function.definition))))
                    (if (i32.eq (local.get $decl) (i32.const 2))
                      (then (local.set $hl (enum.get $Token.type))))
                    (if (i32.eq (local.get $decl) (i32.const 3))
                      (then (local.set $hl (enum.get $Token.constant))))))
                (if
                  (i32.and (i32.eqz (local.get $hl)) (i32.eq (local.get $member) (i32.const 1)))
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.eq (local.get $c2) (i32.const "("))))))
                (if
                  (i32.and
                    (i32.eqz (local.get $hl))
                    (i32.and
                      (i32.eqz (local.get $member))
                      (i32.eq (local.get $expect) (i32.const 3))))
                  (then
                    (local.set $hl (enum.get $Token.namespace))
                    (local.set $expect (i32.const 0))))
                (if
                  (i32.and
                    (i32.eqz (local.get $hl))
                    (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))
                  (then (local.set $hl (enum.get $Token.constant))))
                (if
                  (i32.and
                    (i32.eqz (local.get $hl))
                    (i32.le_u
                      (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                      (i32.const 25)))
                  (then (local.set $hl (enum.get $Token.type))))
                (if
                  (i32.and (i32.eqz (local.get $hl)) (i32.eq (local.get $c2) (i32.const "(")))
                  (then (local.set $hl (enum.get $Token.function))))
                (if (i32.eqz (local.get $hl))
                  (then (local.set $hl (enum.get $Token.variable))))
              ))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            ;; a trailing `.` is part of a float unless it opens a range
            (if
              (i32.and
                (i32.eq (call $odinByte (global.get $ptr)) (i32.const "."))
                (i32.ne
                  (call $odinByte (i32.add (global.get $ptr) (i32.const 1)))
                  (i32.const ".")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                ;; `1.e3` is also a float: the dot may be followed by an exponent
                (if
                  (i32.eq
                    (i32.or (call $odinByte (global.get $ptr)) (i32.const 32))
                    (i32.const "e"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if
                      (i32.or
                        (i32.eq (call $odinByte (global.get $ptr)) (i32.const "+"))
                        (i32.eq (call $odinByte (global.get $ptr)) (i32.const "-")))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                    (block $exponent
                      (loop $digit
                        (br_if $exponent
                          (i32.eqz
                            (call $lexIsDigit (call $odinByte (global.get $ptr)))))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (br $digit)))))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "("))
                (i32.gt_u (local.get $attrDepth) (i32.const 0)))
              (then
                (local.set $attrDepth (i32.add (local.get $attrDepth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (i32.gt_u (local.get $attrDepth) (i32.const 0))
                  (then
                    (local.set $attrDepth
                      (i32.sub (local.get $attrDepth) (i32.const 1)))))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (if (i32.eq (local.get $c2) (i32.const ":"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr)))
              (else
                (if (i32.eq (local.get $c2) (i32.const "="))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                    (call $emitTok
                      (enum.get $Token.operator)
                      (local.get $lhs)
                      (global.get $ptr)))
                  (else
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok
                      (enum.get $Token.punctuation.delimiter)
                      (local.get $lhs)
                      (global.get $ptr))))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add
                    (local.get $lhs)
                    (select
                      (i32.const 3)
                      (i32.const 2)
                      (i32.or
                        (i32.eq (local.get $c3) (i32.const "<"))
                        (i32.eq (local.get $c3) (i32.const "="))))))
                (call $emitTok
                  (enum.get $Token.operator)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 1))))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.special)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "!%&*+-/<=>^|~?" (local.get $c))
          (then
            (local.set $p
              (call $odinOpLen (local.get $c) (local.get $c2) (local.get $c3)))
            (global.set $ptr (i32.add (local.get $lhs) (local.get $p)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
