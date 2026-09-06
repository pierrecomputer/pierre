(module
  (import "../common.wat")

  (func $pasByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Pascal is case-insensitive, so the table holds lowercase words and
  ;; $pasWordHl probes it with a lowercased copy of the input word. Group
  ;; order is the dispatch order in $hlPascal. The high byte of a
  ;; declaration value names the pending capture: 1 a routine name, 2 a
  ;; module name, 3 the unit names of a `uses` clause. Group 12 holds the
  ;; property directives, which are ordinary names outside a property
  ;; declaration and carry bit 12. `result` shares its hash features with
  ;; `repeat` and is matched directly.
  (keyword-table $pascalWords $mem.pascalWords $mem.pascalWords+1792
    (group $Token.keyword.control ;; 1: control flow
      "if" "then" "else" "case" "of" "for" "to" "downto" "while" "do"
      "repeat" "until" "with" "goto" "break" "continue" "exit" "try" "except"
      "finally" "raise" "on")
    (group $Token.keyword.declaration+256 ;; 2: next name is a routine
      "procedure" "function" "constructor" "destructor" "operator")
    (group $Token.keyword.declaration+512 ;; 3: next name is a module
      "unit" "program" "library" "package")
    (group $Token.keyword.import+768 "uses") ;; 4: unit names follow
    (group $Token.keyword.declaration ;; 5: sections, types, and directives
      "type" "var" "const" "threadvar" "resourcestring" "label" "interface"
      "implementation" "initialization" "finalization" "class" "record"
      "object" "packed" "set" "array" "file" "property" "published" "public"
      "private" "protected" "strict" "inherited" "inline" "overload"
      "override" "virtual" "dynamic" "abstract" "reintroduce" "message"
      "cdecl" "stdcall" "safecall" "register" "pascal" "external" "forward"
      "deprecated" "platform" "static" "sealed" "final" "helper" "reference"
      "out" "absolute" "exports" "dispinterface" "generic" "specialize"
      "experimental" "assembler" "asm")
    (group $Token.keyword "begin" "end")            ;; 6: blocks
    (group $Token.keyword.operator ;; 7: word operators
      "and" "or" "not" "xor" "div" "mod" "shl" "shr" "in" "is" "as")
    (group $Token.boolean "true" "false")           ;; 8
    (group $Token.constant.builtin "nil")           ;; 9
    (group $Token.variable.special "self")          ;; 10
    (group $Token.type.builtin ;; 11: built-in types
      "integer" "cardinal" "string" "ansistring" "widestring" "unicodestring"
      "shortstring" "char" "ansichar" "widechar" "boolean" "bytebool"
      "wordbool" "longbool" "byte" "word" "longint" "longword" "int64"
      "uint64" "shortint" "smallint" "single" "double" "extended" "real"
      "comp" "currency" "pointer" "variant" "olevariant" "tdatetime"
      "tobject" "textfile" "pchar" "pansichar" "pwidechar" "nativeint"
      "nativeuint")
    (group $Token.keyword+4096 ;; 12: property directives
      "read" "write" "stored" "default" "nodefault" "implements" "index"
      "dispid" "readonly" "writeonly"))

  ;; Token in the low byte and the capture in the high byte of the word
  ;; [lhs,rhs) compared case-insensitively, or -1 for an ordinary name.
  (func $pasWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $v i32)
    (local.set $n (call $lexLowerCopy
      (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (local.set $v (keyword-table.value $pascalWords
      (i32.const $mem.lexLowerScratch)
      (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
    (if (i32.ge_s (local.get $v) (i32.const 0)) (then (return (local.get $v))))
    (if (i32.and
          (i32.eq (local.get $n) (i32.const 6))
          (i32.and
            (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "resu"))
            (i32.eq (i32.load16_u (i32.const $mem.lexLowerScratch+4)) (i32.const "lt"))))
      (then (return (enum.get $Token.variable.special))))
    (i32.const -1))

  ;; Whether the name [lhs,rhs) follows the Delphi type convention: a `T`,
  ;; `I`, `E`, or `P` prefix before an uppercase letter, as in `TForm`,
  ;; `IUnknown`, `EConvertError`, or `PChar`.
  (func $pasIsTypeName (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (if (i32.lt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $lhs)))
    (i32.and
      (byteset.get "EIPT" (local.get $c))
      (i32.le_u (i32.sub (i32.load8_u offset=1 (local.get $lhs)) (i32.const "A")) (i32.const 25))))

  ;; A `{ ... }` or `(* ... *)` region from $ptr - a comment, or a compiler
  ;; directive when `$` follows the opener - through its closer or to $end,
  ;; where streaming checkpoints the closer.
  (func $pasBraced (param $paren i32)
    (local $lhs i32) (local $hl i32) (local $p i32) (local $closed i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1) (local.get $paren))))
    (local.set $hl (select (enum.get $Token.preproc) (enum.get $Token.comment)
      (i32.eq (call $pasByte (global.get $ptr)) (i32.const "$"))))
    (if (local.get $paren)
      (then
        (block $done
          (loop $l
            (local.set $p (call $lexFindByte (global.get $ptr) (i32.const "*")))
            (if (i32.ge_u (local.get $p) (global.get $end))
              (then
                (global.set $ptr (global.get $end))
                (br $done)))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (if (i32.eq (call $pasByte (global.get $ptr)) (i32.const ")"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $closed (i32.const 1))
                (br $done)))
            (br $l))))
      (else
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "}")))
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $closed (i32.const 1))))))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (if (i32.eqz (local.get $closed))
      (then
        (if (local.get $paren)
          (then (call $streamSetFixed32 (i32.const "*)") (i32.const 2) (local.get $hl)))
          (else (call $streamSetFixed32 (i32.const "}") (i32.const 1) (local.get $hl)))))))

  ;; A quoted string from $ptr: a doubled quote escapes itself, and the
  ;; literal ends at the quote or the line break.
  (func $pasString
    (local $seg i32) (local $p i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (i32.const 39) (i32.const 0) (i32.const 1)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (i32.const 39)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br_if $done (i32.ne (call $pasByte (global.get $ptr)) (i32.const 39)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  (func $pasIsOp (param $c i32) (result i32)
    (byteset.get "*+-/<=>@^" (local.get $c)))

  ;; $expect is the pending capture: 1 after a routine keyword - a name
  ;; before `.` is the class, the next the routine - 2 after a module
  ;; keyword, 3 over the unit names of a `uses` clause. $fnHead is 1 after
  ;; a routine name until its `(`; $paren counts open parentheses and
  ;; $paramDepth is the depth of a parameter list, where bare names are
  ;; parameters. $typeCtx is 1 after `:` or `of`, where names are types;
  ;; $propCtx is 1 inside a property declaration, with $propName over its
  ;; name; $member is 1 after `.`. All are checkpointed.
  (func $hlPascal
    (local $c i32) (local $c2 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $pc i32)
    (local $kind i32) (local $hl i32)
    (local $expect i32) (local $fnHead i32) (local $paren i32) (local $paramDepth i32)
    (local $typeCtx i32) (local $propCtx i32) (local $propName i32) (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $pasByte (i32.add (global.get $ptr) (i32.const 1))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (call $pasBraced (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $pasBraced (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $pasString)
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `#13`, `#$0A` character codes
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.or (call $lexIsDigit (local.get $c2)) (i32.eq (local.get $c2) (i32.const "$"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `$FF` hex, `%1010` binary, `&17` octal
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsHex (local.get $c2)))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "&")))
                (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $pasByte (local.get $p)))
            (local.set $kind (select (i32.const -1)
              (call $pasWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            ;; a property directive is an ordinary name outside a property
            (if (i32.and
                  (i32.ge_s (local.get $kind) (i32.const 0))
                  (i32.and
                    (i32.ne (i32.and (local.get $kind) (i32.const 4096)) (i32.const 0))
                    (i32.eqz (local.get $propCtx))))
              (then (local.set $kind (i32.const -1))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 15))
                  (then (local.set $expect (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 15)))))
                (local.set $fnHead (i32.const 0))
                ;; `of` opens a type; `property` opens a declaration; a block
                ;; keyword ends both
                (local.set $typeCtx (i32.and
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                  (i32.eq (i32.load16_u (i32.const $mem.lexLowerScratch)) (i32.const "of"))))
                (if (i32.and
                      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 8))
                      (i64.eq (i64.load (i32.const $mem.lexLowerScratch)) (i64.const "property")))
                  (then
                    (local.set $propCtx (i32.const 1))
                    (local.set $propName (i32.const 1))))
                ;; `begin` and `end` close a property declaration; the
                ;; property directives are keywords too but keep it open
                (if (i32.and
                      (i32.eq (local.get $hl) (enum.get $Token.keyword))
                      (i32.eqz (i32.and (local.get $kind) (i32.const 4096))))
                  (then
                    (local.set $propCtx (i32.const 0))
                    (local.set $expect (i32.const 0)))))
              (else
                (if (local.get $member)
                  (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                    (i32.eq (local.get $pc) (i32.const "(")))))
                  (else
                    (if (i32.eq (local.get $expect) (i32.const 3))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else
                        (if (i32.eq (local.get $expect) (i32.const 2))
                          (then (local.set $hl (enum.get $Token.namespace)))
                          (else
                            (if (i32.eq (local.get $expect) (i32.const 1))
                              (then
                                ;; `procedure TForm1.Click(` names the class first
                                (if (i32.eq (call $pasByte (local.get $rhs)) (i32.const "."))
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else
                                    (local.set $hl (enum.get $Token.function.definition))
                                    (local.set $expect (i32.const 0))
                                    (local.set $fnHead (i32.const 1)))))
                              (else
                                (if (local.get $typeCtx)
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else
                                    (if (i32.and
                                          (i32.ne (local.get $paramDepth) (i32.const 0))
                                          (i32.eq (local.get $paren) (local.get $paramDepth)))
                                      (then (local.set $hl (enum.get $Token.variable.parameter)))
                                      (else
                                        (if (local.get $propName)
                                          (then
                                            (local.set $hl (enum.get $Token.property))
                                            (local.set $propName (i32.const 0)))
                                          (else
                                            (if (i32.eq (local.get $pc) (i32.const "("))
                                              (then (local.set $hl (enum.get $Token.function)))
                                              (else
                                                (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                                  (then (local.set $hl (enum.get $Token.constant)))
                                                  (else
                                                    (local.set $hl (select (enum.get $Token.type) (enum.get $Token.variable)
                                                      (call $pasIsTypeName (local.get $lhs) (local.get $rhs))))))))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $paren (i32.add (local.get $paren) (i32.const 1)))
                (if (local.get $fnHead)
                  (then
                    (local.set $paramDepth (local.get $paren))
                    (local.set $fnHead (i32.const 0))))
                (if (i32.ne (local.get $expect) (i32.const 3))
                  (then (local.set $expect (i32.const 0))))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (i32.eq (local.get $paren) (local.get $paramDepth))
                  (then (local.set $paramDepth (i32.const 0))))
                (if (local.get $paren)
                  (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))
                (local.set $typeCtx (i32.const 0))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $typeCtx (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $expect (i32.const 0))
                (local.set $fnHead (i32.const 0))
                (local.set $propCtx (i32.const 0))
                (local.set $propName (i32.const 0))))
            (br $next)))
        ;; `..` ranges; `.` selects a member
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.eq (local.get $expect) (i32.const 0)))))
            (br $next)))
        ;; `:=` assigns; a lone `:` opens the type of a declaration
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "="))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $typeCtx (i32.const 1))
                (local.set $fnHead (i32.const 0))))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $pasIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $pasIsOp (call $pasByte (global.get $ptr)))))
                ;; a comment opener ends the run
                (br_if $opDone (i32.and
                  (i32.eq (call $pasByte (global.get $ptr)) (i32.const "/"))
                  (i32.eq (call $pasByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "/"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then (local.set $typeCtx (i32.const 0))))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
