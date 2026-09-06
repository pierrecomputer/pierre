(module
  (import "../common.wat")

  ;; Group order is the dispatch order in $cWordHl below; the C11 and C23
  ;; spellings sit alongside the classic keywords. `continue` is absent on
  ;; purpose: it shares every hash feature the table can use - first two
  ;; bytes, last byte, and length - with `alignof`, so $cWordHl matches it
  ;; with one exact eight-byte compare instead.
  (keyword-table $cWords $mem.cWords $mem.cWords+1024
    (group $Token.keyword.control ;; 1: control
      "do" "if" "for" "case" "else" "goto" "break" "while" "return" "switch"
      "default")
    (group $Token.keyword.declaration ;; 2: declaration
      "auto" "extern" "inline" "static" "typedef" "register" "_Noreturn"
      "thread_local" "_Thread_local")
    (group $Token.type.builtin ;; 3: built-in types
      "int" "bool" "char" "enum" "long" "void" "float" "short" "union"
      "_Bool" "double" "signed" "struct" "unsigned" "_Complex" "_Imaginary")
    (group $Token.keyword ;; 4: qualifiers and operators
      "const" "sizeof" "typeof" "alignas" "alignof" "restrict" "volatile"
      "_Atomic" "_Alignas" "_Alignof" "_Generic" "constexpr" "static_assert"
      "typeof_unqual" "_Static_assert")
    (group $Token.boolean "true" "false") ;; 5: booleans
    (group $Token.constant.builtin "nullptr"))     ;; 6: built-in constant

  (func $cWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $g i32)
    ;; the input sentinel slack keeps the unaligned i64 load safe
    (if (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 8))
          (i64.eq (i64.load (local.get $lhs)) (i64.const "continue")))
      (then (return (enum.get $Token.keyword.control))))
    (local.set $g (keyword-table.value $cWords (local.get $lhs) (local.get $rhs)))
    (if (i32.ne (local.get $g) (i32.const -1))
      (then (return (local.get $g))))

    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant))))
    (if (i32.and
          (i32.ge_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
          (i32.eq (i32.load16_u (i32.sub (local.get $rhs) (i32.const 2))) (i32.const "_t")))
      (then (return (enum.get $Token.type))))
    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
    (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                 (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
      (then (return (enum.get $Token.function))))
    (if (i32.le_u
          (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
      (then (return (enum.get $Token.type))))
    (enum.get $Token.variable))

  (func $cIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>?^|~" (local.get $c)))

  ;; Extend the shared numeric run for C hexadecimal floats, whose fractional
  ;; part may begin with an a-f digit (`0x1.fp+3`). The run starts at $ptr.
  (func $cScanNumber
    (local $lhs i32)
    (local $next i32)
    (local.set $lhs (global.get $ptr))
    (call $lexScanNumber)
    (if (i32.and
          (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end))
          (i32.and
            (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "0"))
            (i32.eq (i32.or (i32.load8_u offset=1 (local.get $lhs)) (i32.const 32)) (i32.const "x"))))
      (then
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (local.set $next (select
              (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (if (i32.and
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "."))
                  (call $lexIsHex (local.get $next)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanNumber))))))))

  (func $hlC
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $hl i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; whitespace gaps
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (local.set $c3 (select (i32.load8_u offset=2 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))))

        ;; comments
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c3) (i32.const "/"))
                        (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c3) (i32.const "*"))
                        (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        ;; A directive occupies its physical line. This also handles # and ##
        ;; inside macro definitions without a second state machine.
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanToLineEnd)
            (if (i32.eqz (call $lexEmitIncludeDirective (local.get $lhs) (global.get $ptr)))
              (then (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; strings and character literals
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))

        ;; identifiers, including C literal prefixes
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.and
                    (i32.or
                      (i32.and
                        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                        (i32.or
                          (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "L"))
                          (i32.or
                            (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "u"))
                            (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "U")))))
                      (i32.and
                        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                        (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "u8"))))
                    (i32.or
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 34))
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 39)))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (call $lexString (i32.load8_u (global.get $ptr))
                  (i32.const 0) (enum.get $Token.string))
                (br $next)))
            (local.set $hl (call $cWordHl (local.get $lhs) (local.get $rhs)))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        ;; numeric preprocessing tokens
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $cScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; brackets and delimiters
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; operators: consume at most one compound operator so a following
        ;; slash remains available to open a comment.
        (if (call $cIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.or
                      (i32.and (i32.eq (local.get $c) (local.get $c2))
                        (byteset.get "&+-<>|" (local.get $c)))
                      (i32.and (i32.eq (local.get $c) (i32.const "-"))
                               (i32.eq (local.get $c2) (i32.const ">"))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.and
                        (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                (i32.eq (local.get $c) (i32.const ">")))
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "="))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Unknown bytes are plain, but batch a run until the next byte class.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $plainDone
          (loop $plain
            (br_if $plainDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $plainDone (i32.or
              (i32.or
                (i32.or (call $lexIsIdentStart (local.get $c))
                        (call $lexIsDigit (local.get $c)))
                (i32.or (call $cIsOp (local.get $c))
                        (i32.or (i32.eq (local.get $c) (i32.const 34))
                                (i32.eq (local.get $c) (i32.const 39)))))
              (i32.or
                (i32.eq (local.get $c) (i32.const "#"))
                (call $lexIsSpace (local.get $c)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $plain)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
