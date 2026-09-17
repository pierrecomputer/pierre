(module
  (import "../common.wat")

  (func $fortranByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  (keyword-table $fortranWords $mem.fortranWords $mem.fsharpWords
    (group $Token.keyword.control
      "if" "then" "else" "elseif" "endif" "do" "enddo" "while" "concurrent" "select" "case"
      "endselect" "elsewhere" "endwhere" "forall" "endforall" "cycle" "exit"
      "stop" "error" "return" "goto" "go" "to" "continue" "call" "associate" "block")
    (group $Token.keyword.declaration+256 "function" "subroutine" "entry")
    (group $Token.keyword.declaration+512 "program" "module" "submodule")
    (group $Token.keyword.import+512 "use")
    (group $Token.keyword.import "include" "import" "only")
    (group $Token.type.builtin "integer" "real" "complex" "logical" "character" "double" "precision")
    (group $Token.keyword.declaration
      "type" "class" "interface" "procedure" "abstract" "extends" "generic" "enum" "enumerator"
      "implicit" "none" "parameter" "dimension" "allocatable" "pointer" "target" "intent"
      "optional" "save" "external" "intrinsic" "public" "private" "protected" "volatile"
      "asynchronous" "value" "common" "equivalence" "data" "namelist" "recursive" "pure"
      "elemental" "impure" "contiguous" "bind" "result")
    (group $Token.keyword
      "end" "contains" "endfunction" "endsubroutine" "endprogram" "endmodule" "endtype"
      "endinterface" "endblock" "in" "out" "inout" "kind" "len" "format")
    (group $Token.function
      "allocate" "deallocate" "nullify" "print" "read" "write" "open" "close"
      "flush" "rewind" "backspace" "wait" "sin" "cos" "sqrt" "abs" "max" "min"
      "sum" "size" "shape" "allocated" "associated" "present" "trim" "reshape" "matmul")
    (group $Token.boolean "true" "false")
    (group $Token.keyword.operator "and" "or" "not" "eq" "ne" "lt" "le" "gt" "ge" "eqv" "neqv"))

  ;; These words share the table hash's prefix, suffix, and length.
  (func $fortranWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (if
      (i32.and
        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
        (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "where")))
      (then (return (enum.get $Token.keyword.control))))
    (if
      (i32.and
        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 7))
        (i32.or
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff)) (i64.const "inquire"))
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff)) (i64.const "endfile"))))
      (then (return (enum.get $Token.function))))
    (keyword-table.value $fortranWords (local.get $lhs) (local.get $rhs)))

  ;; 1 while lexing the fixed-form dialect (`fortran-fixed-form`: .f, .for,
  ;; and .f77 sources), where any C or c in column one opens a comment line;
  ;; 0 for free-form source, where only a C set apart from its text does.
  ;; Every entry point sets it, so streamed chunks and fence bodies never
  ;; inherit another run's form.
  (global $fortranFixed (mut i32) (i32.const 0))

  ;; Classifies the fixed-form line at $p when the previous line left a
  ;; string open: 1 when columns one to five are blank and column six holds
  ;; a continuation marker (any character but blank or 0), 2 for a comment
  ;; line (C, c, * or ! in column one), 3 for a blank line, and 0 for an
  ;; ordinary statement line.
  (func $fortranFixedLineKind (param $p i32) (result i32)
    (local $c i32)
    (local $i i32)
    (local.set $c (call $fortranByte (local.get $p)))
    (if (byteset.get "Cc*!" (local.get $c))
      (then (return (i32.const 2))))
    (block $initial
      (loop $blank
        (br_if $initial
          (i32.ne (call $fortranByte (i32.add (local.get $p) (local.get $i))) (i32.const 32)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $blank (i32.lt_u (local.get $i) (i32.const 5))))
      (local.set $c (call $fortranByte (i32.add (local.get $p) (i32.const 5))))
      (br_if $initial
        (i32.or (i32.eqz (local.get $c))
          (i32.or (call $lexIsSpace (local.get $c)) (i32.eq (local.get $c) (i32.const "0")))))
      (return (i32.const 1)))
    (local.set $c (call $fortranByte (call $lexSkipSpaceAt (local.get $p))))
    (select (i32.const 3) (i32.const 0)
      (i32.or (i32.eqz (local.get $c))
        (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))))

  ;; Column position recognizes traditional fixed-form comments. Quoted text
  ;; carries only its quote and continuation flag, never an input pointer.
  ;; The continuation flag is 1 after a free-form `&` inside a string and 2
  ;; after a fixed-form line ended inside a string, where the next line's
  ;; column six decides whether the string goes on.
  (func $hlFortranImpl
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $previous i32)
    (local $column i32)
    (local $n i32)
    (local $hl i32)
    (local $kind i32)
    (local $expect i32)
    (local $member i32)
    (local $quote i32)
    (local $continued i32)
    (call $lexEmitLeadingContinuation)
    (local.set $previous (global.get $ptr))
    (block $done
      (loop $next
        (local.set $column (i32.add (local.get $column) (i32.sub (global.get $ptr) (local.get $previous))))
        (local.set $previous (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $fortranByte (i32.add (local.get $lhs) (i32.const 1))))
        ;; A fixed-form line after an unterminated string: a nonblank, non-zero
        ;; column six continues the statement, so the string resumes at column
        ;; seven. Comment and blank lines in between leave the question open;
        ;; any other line means the string ended with the previous one.
        (if (i32.eq (local.get $continued) (i32.const 2))
          (then
            (local.set $n (call $fortranFixedLineKind (local.get $lhs)))
            (if (i32.eq (local.get $n) (i32.const 1))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 5)))
                (call $emitGap (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $continued (i32.const 0))
                (br $next)))
            (if (i32.eq (local.get $n) (i32.const 2))
              (then (call $lexLineComment (i32.const 1) (enum.get $Token.comment)) (br $next)))
            (if (i32.eqz (local.get $n))
              (then
                (local.set $quote (i32.const 0))
                (local.set $continued (i32.const 0))))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $previous (global.get $ptr))
            (local.set $column (i32.const 0))
            (local.set $member (i32.const 0))
            ;; A string still open at a fixed-form line end may resume on a
            ;; column-six continuation line; the next line start decides.
            (if (i32.eqz (local.get $continued))
              (then
                (if (i32.and (global.get $fortranFixed) (i32.ne (local.get $quote) (i32.const 0)))
                  (then (local.set $continued (i32.const 2)))
                  (else (local.set $quote (i32.const 0))))))
            (br $next)))
        (if (i32.and (call $lexIsSpace (local.get $c))
              (i32.or (i32.eqz (local.get $quote)) (local.get $continued)))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (if (i32.eq (global.get $ptr) (local.get $lhs))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.or (i32.eqz (local.get $quote)) (local.get $continued))
              (i32.eq (local.get $c) (i32.const "!")))
          (then
            (call $lexLineComment (i32.const 1)
              (select (enum.get $Token.preproc) (enum.get $Token.comment)
                (i32.eq (local.get $c2) (i32.const "$"))))
            (br $next)))
        (if (i32.and (local.get $continued) (i32.eq (local.get $c) (i32.const "&")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $continued (i32.const 0))
            (br $next)))
        (if (local.get $quote)
          (then
            (local.set $continued (i32.const 0))
            (block $stringDone
              (loop $string
                (br_if $stringDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $stringDone (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
                (if (i32.eq (local.get $c) (local.get $quote))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.eq (call $fortranByte (global.get $ptr)) (local.get $quote))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
                      (else (local.set $quote (i32.const 0)) (br $stringDone))))
                  (else
                    (if (i32.eq (local.get $c) (i32.const "&"))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (i32.add (global.get $ptr) (i32.const 1))))
                        (local.set $c2 (call $fortranByte (local.get $p)))
                        (if (i32.or (i32.ge_u (local.get $p) (global.get $end))
                              (byteset.get "!\0a\0d" (local.get $c2)))
                          (then
                            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                            (local.set $lhs (global.get $ptr))
                            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                            (local.set $lhs (global.get $ptr))
                            (local.set $continued (i32.const 1))
                            (br $stringDone)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (br $string)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; A C or * in column one opens a comment line. Fixed-form source
        ;; takes any column-one * or C, with or without a blank after it
        ;; (Ccomment), because its statements start in column seven. Free-form
        ;; source has no * comments - a column-one * there is an operator on a
        ;; continuation line - and only takes a C separated from its text, so
        ;; assignments such as c = 1 and words such as contains remain
        ;; ordinary code.
        (if (i32.and (i32.eqz (local.get $column))
              (i32.or
                (i32.and (global.get $fortranFixed)
                  (i32.or (i32.eq (local.get $c) (i32.const "*"))
                    (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "c"))))
                (i32.and (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "c"))
                  (i32.and (i32.eq (local.get $c2) (i32.const 32))
                    (i32.ne (call $fortranByte (call $lexSkipSpaceAt (i32.add (local.get $lhs) (i32.const 1)))) (i32.const "="))))))
          (then (call $lexLineComment (i32.const 1) (enum.get $Token.comment)) (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then (call $lexLineComment (i32.const 1) (enum.get $Token.preproc)) (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $quote (local.get $c))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; BOZ literals use a radix letter followed by either quote style.
        (if (i32.and (byteset.get "bBoOzZ" (local.get $c))
              (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (call $lexRawString (local.get $c2) (i32.const 0) (enum.get $Token.number))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            (global.set $ptr (local.get $p))
            (call $scanIdentRun (i32.const "_"))
            (local.set $n (call $lexLowerCopy (local.get $p) (global.get $ptr) (i32.const $mem.lexLowerScratch)))
            (local.set $hl (call $fortranWordHl (i32.const $mem.lexLowerScratch)
              (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
            (if (i32.ne (local.get $hl) (enum.get $Token.boolean))
              (then (local.set $hl (enum.get $Token.keyword.operator))))
            (if (i32.eq (call $fortranByte (global.get $ptr)) (i32.const "."))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            ;; D exponents, kind suffixes, and a trailing decimal point are
            ;; Fortran numbers; a following .operator. stays separate.
            (local.set $p (i32.const 0))
            (block $numberDone
              (loop $number
                (br_if $numberDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (local.set $c2 (call $fortranByte (i32.add (global.get $ptr) (i32.const 1))))
                (local.set $n (call $fortranByte (i32.add (global.get $ptr) (i32.const 2))))
                (if (i32.eqz
                      (i32.or (call $lexIsIdentContinue (local.get $c))
                        (i32.or
                          (i32.and (i32.eq (local.get $c) (i32.const "."))
                            (i32.or
                              (i32.or (i32.eqz (call $lexIsIdentStart (local.get $c2)))
                                (i32.eq (local.get $c2) (i32.const "_")))
                              (i32.and (byteset.get "dDeEqQ" (local.get $c2))
                                (i32.or
                                  (call $lexIsDigit (local.get $n))
                                  (byteset.get "+-" (local.get $n))))))
                          (i32.and (byteset.get "+-" (local.get $c)) (byteset.get "dDeEqQ" (local.get $p))))))
                  (then (br $numberDone)))
                (local.set $p (local.get $c))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $number)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $n (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
            (local.set $kind (call $fortranWordHl (i32.const $mem.lexLowerScratch)
              (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $member)
              (then (local.set $hl (enum.get $Token.property)))
              (else
                (if (i32.ge_s (local.get $kind) (i32.const 0))
                  (then
                    (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                    (if (i32.shr_u (local.get $kind) (i32.const 8))
                      (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.namespace)
                          (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $expect (i32.const 0)))
                      (else
                        (if (i32.eq (call $fortranByte (call $lexSkipSpaceAt (local.get $rhs))) (i32.const "("))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (byteset.get ":,;" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "+-*/=<>&%" (local.get $c))
          (then (local.set $hl (enum.get $Token.operator))))
        (local.set $member (i32.eq (local.get $c) (i32.const "%")))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))

  ;; The entry points: free-form Fortran, and the fixed-form dialect that
  ;; shares its lexer but accepts column-one comment markers without a
  ;; following blank.
  (func $hlFortran
    (global.set $fortranFixed (i32.const 0))
    (call $hlFortranImpl))
  (func $hlFortranFixed
    (global.set $fortranFixed (i32.const 1))
    (call $hlFortranImpl))
)
