(module
  (import "../common.wat")

  ;; Each group's value is its token; the high byte marks what follows:
  ;; 1 the next name is a type, 2 names are module path parts until `;` or
  ;; `:`, 3 the word acts as a type, so `name(` after it defines a function.
  ;; `__FILE__` and the other special tokens share hash features, so
  ;; $dWordKind matches them by shape instead.
  (keyword-table $dWords $mem.dWords $mem.llvmWords
    (group $Token.keyword.control
      "if" "do" "for" "try" "case" "else" "goto" "with" "break" "catch" "throw" "while"
      "return" "switch" "default" "finally" "foreach" "continue" "foreach_reverse")
    (group $Token.keyword.declaration+256 "enum" "class" "union" "struct" "template" "interface")
    (group $Token.keyword.declaration "alias" "mixin" "function" "delegate")
    (group $Token.keyword.import+512 "import" "module")
    (group $Token.type.builtin+768
      "int" "bool" "byte" "cent" "char" "long" "real" "uint" "void" "ubyte" "ucent" "dchar"
      "float" "ireal" "creal" "short" "ulong" "wchar" "double" "ushort" "ifloat" "cfloat"
      "string" "size_t" "idouble" "cdouble" "dstring" "wstring" "noreturn" "ptrdiff_t")
    (group $Token.keyword+768 "auto")
    (group $Token.keyword
      "in" "is" "asm" "new" "out" "ref" "body" "cast" "lazy" "pure" "align" "const" "debug"
      "final" "inout" "scope" "assert" "delete" "export" "extern" "public" "pragma" "shared"
      "static" "typeid" "typeof" "nothrow" "package" "private" "version" "abstract" "override"
      "unittest" "__traits" "__vector" "immutable" "invariant" "protected" "__gshared"
      "deprecated" "synchronized" "__parameters")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.variable.special "this" "super"))

  (func $dWordKind (param $lhs i32) (param $rhs i32) (result i32)
    (if (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "__"))
      (then
        (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
          (then (return (enum.get $Token.constant.builtin))))))
    (keyword-table.value $dWords (local.get $lhs) (local.get $rhs)))

  ;; Scan a `"` string body from $ptr; bytes from $seg are not yet emitted.
  ;; D strings span lines and use C escapes. Returns 1 while the string is
  ;; still open at $end, so the caller resumes it in the next chunk.
  (func $dStringBody (param $seg i32) (result i32)
    (local $e i32)
    (block $open
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (i32.const 34)
            (i32.const 1)
            (i32.const 0)))
        (br_if $open (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 0))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (local.set $e (call $lexCEscapeEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 1))

  ;; Scan a `q{...}` token string from $ptr at brace depth $depth and emit it
  ;; as one string. Returns the depth still open at $end, or 0 when closed.
  (func $dTokenString (param $depth i32) (result i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (block $done
      (loop $scan
        (global.set $ptr (call $lexFindEither (global.get $ptr) (i32.const "{") (i32.const "}")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $depth
          (i32.add
            (local.get $depth)
            (select (i32.const 1) (i32.const -1) (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "{")))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br_if $scan (local.get $depth))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (local.get $depth))

  ;; `q"` and a delimiter: a bracket closes with its partner and `"`, other
  ;; punctuation with itself and `"`. A heredoc name (`q"EOS ... EOS"`) falls
  ;; back to a raw string up to the next quote, which ends it in practice.
  (func $dDelimitedString
    (local $lhs i32)
    (local $close i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $close (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
    (if
      (i32.or
        (call $lexIsIdentContinue (local.get $close))
        (i32.le_u (local.get $close) (i32.const 32)))
      (then
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
        (call $lexRawString (i32.const 34) (i32.const 1) (enum.get $Token.string))
        (return)))
    ;; `(` `[` `{` `<` pair with the byte one or two above them
    (if (i32.eq (local.get $close) (i32.const "("))
      (then (local.set $close (i32.const ")")))
      (else
        (if (byteset.get "[{" (local.get $close))
          (then (local.set $close (i32.add (local.get $close) (i32.const 2))))
          (else
            (if (i32.eq (local.get $close) (i32.const "<"))
              (then (local.set $close (i32.const ">"))))))))
    (local.set $p (i32.add (local.get $lhs) (i32.const 3)))
    (block $open
      (loop $find
        (local.set $p (call $lexFindByte (local.get $p) (local.get $close)))
        (br_if $open (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (return)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $find)))
    (global.set $ptr (global.get $end))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (call $streamSetFixed32
      (i32.or (local.get $close) (i32.const 0x2200))
      (i32.const 2)
      (enum.get $Token.string)))

  ;; $expect: 1 the next name is a type, 2 names are module path parts until
  ;; `;` or `:`. $dq is 1 while a `"` string is open and $qDepth the brace
  ;; depth of an open `q{...}`; all three carry across chunks. $afterType (a
  ;; type came last, so `name(` defines a function) and $member (after `.`)
  ;; reset at line breaks, which every chunk starts after.
  (func $hlD
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $gap i32)
    (local $hl i32)
    (local $kind i32)
    (local $expect i32)
    (local $dq i32)
    (local $qDepth i32)
    (local $afterType i32)
    (local $member i32)
    (call $lexEmitLeadingContinuation)
    (local.set $afterType (i32.const 0))
    (local.set $member (i32.const 0))
    (block $done
      (loop $next
        (if (local.get $dq)
          (then
            (local.set $dq (call $dStringBody (global.get $ptr)))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (if (local.get $qDepth)
          (then
            (local.set $qDepth (call $dTokenString (local.get $qDepth)))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $afterType (i32.const 0))
            (local.set $member (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))

        ;; `//`, `/* */`, and nesting `/+ +/`; `///`, `/**`, and `/++` are docs
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (local.set $hl
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (local.get $c3) (local.get $c2))
                  (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "/")))))
            (if (i32.eq (local.get $c2) (i32.const "/"))
              (then
                (call $lexLineComment (i32.const 2) (local.get $hl))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "*"))
              (then
                (call $lexBlockComment (i32.const 2) (local.get $hl))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "+"))
              (then
                (call $lexNestedBlockComment (i32.const "/+") (i32.const "+/") (local.get $hl))
                (br $next)))))

        ;; `#line` directives, and the `#!` script line that opens a file
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.eqz (call $lexLineByteBefore (local.get $lhs))))
          (then
            (call $scanToLineEnd)
            (call $emitTok
              (select
                (enum.get $Token.comment)
                (enum.get $Token.preproc)
                (i32.and
                  (i32.eq (local.get $lhs) (global.get $docStart))
                  (i32.eq (local.get $c2) (i32.const "!"))))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $dq (call $dStringBody (local.get $lhs)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexRawString (i32.const "`") (i32.const 1) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        ;; WYSIWYG `r"..."` and hex `x"..."` strings have no escapes
        (if
          (i32.and
            (i32.eq (local.get $c2) (i32.const 34))
            (i32.or (i32.eq (local.get $c) (i32.const "r")) (i32.eq (local.get $c) (i32.const "x"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (call $lexRawString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "q"))
          (then
            (if (i32.eq (local.get $c2) (i32.const 34))
              (then
                (call $dDelimitedString)
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $qDepth (call $dTokenString (i32.const 1)))
                (br $next)))))
        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            ;; a `c`, `w`, or `d` right after a closing quote is the string's suffix
            (if
              (i32.and
                (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1)))
                (i32.gt_u (local.get $lhs) (global.get $srcBase)))
              (then
                (local.set $c3 (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))
                (if
                  (i32.and
                    (i32.or (i32.eq (local.get $c3) (i32.const 34)) (i32.eq (local.get $c3) (i32.const "`")))
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const "c")) (i32.eq (local.get $c) (i32.const "w")))
                      (i32.eq (local.get $c) (i32.const "d"))))
                  (then
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                    (br $next)))))
            ;; the next byte on the line, after blanks
            (local.set $c2 (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            ;; `to!string(x)` instantiates a template; `a != b` does not
            (local.set $c3
              (i32.or
                (i32.eq (local.get $c2) (i32.const "("))
                (i32.and
                  (i32.eq (call $templateByte (local.get $rhs)) (i32.const "!"))
                  (i32.ne (call $templateByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const "=")))))
            (local.set $kind (i32.const -1))
            (block $classified
              (if (i32.eq (local.get $expect) (i32.const 2))
                (then
                  (local.set $hl (enum.get $Token.namespace))
                  (br $classified)))
              (if (local.get $member)
                (then
                  (local.set $hl
                    (select (enum.get $Token.function.method) (enum.get $Token.property) (local.get $c3)))
                  (br $classified)))
              (local.set $kind (call $dWordKind (local.get $lhs) (local.get $rhs)))
              (if (i32.ge_s (local.get $kind) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                  (if (i32.lt_u (i32.sub (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 1)) (i32.const 2))
                    (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
                  (br $classified)))
              ;; `enum x = 1;` declares a constant, not a type
              (if (local.get $expect)
                (then
                  (local.set $hl
                    (select (enum.get $Token.variable) (enum.get $Token.type) (i32.eq (local.get $c2) (i32.const "="))))
                  (local.set $expect (i32.const 0))
                  (br $classified)))
              (if (local.get $c3)
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function.definition)
                      (select
                        (enum.get $Token.type)
                        (enum.get $Token.function)
                        (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
                      (local.get $afterType)))
                  (br $classified)))
              (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                (then
                  (local.set $hl (enum.get $Token.constant))
                  (br $classified)))
              (local.set $hl
                (select
                  (enum.get $Token.type)
                  (enum.get $Token.variable)
                  (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $afterType
              (i32.or
                (i32.eq (local.get $hl) (enum.get $Token.type))
                (i32.eq (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 3))))
            (local.set $member (i32.const 0))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanHexNumber (i32.const 1))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $afterType (i32.const 0))
            (br $next)))

        ;; `@safe`, `@nogc`, `@property`, and `@(...)` user attributes
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if
              (i32.or
                (i32.ge_u (local.get $c2) (i32.const 0x80))
                (i32.or
                  (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                  (i32.eq (local.get $c2) (i32.const "_"))))
              (then (call $scanIdentRun (i32.const "_"))))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (local.set $member (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            ;; `..` slices and `...` variadics; a lone `.` reaches a member
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add (local.get $lhs) (select (i32.const 3) (i32.const 2) (i32.eq (local.get $c3) (i32.const ".")))))
                (local.set $hl (enum.get $Token.operator)))
              (else
                (local.set $hl (enum.get $Token.punctuation.delimiter))
                (local.set $member (i32.const 1))))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $expect (i32.const 0))))
        (if (byteset.get ",:;" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.ne (local.get $c) (i32.const ","))
              (then (local.set $expect (i32.const 0))))))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then (local.set $hl (enum.get $Token.variable.special))))
        ;; one run of operator bytes, stopping before a comment opener
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            (block $opDone
              (loop $op
                (br_if $opDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c3 (i32.load8_u (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c3))))
                (if (i32.eq (local.get $c3) (i32.const "/"))
                  (then
                    (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                    (br_if $opDone
                      (i32.or
                        (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "*")))
                        (i32.eq (local.get $c3) (i32.const "+"))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        ;; pointer and array types keep a pending definition name; `| 6` maps
        ;; only `[`, `]`, `Y`, and `_` onto `_`, and names never reach here
        (local.set $afterType
          (i32.and
            (local.get $afterType)
            (i32.and
              (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
              (i32.or
                (i32.eq (local.get $c) (i32.const "*"))
                (i32.eq (i32.or (local.get $c) (i32.const 6)) (i32.const "_"))))))
        (br $next))))
)
