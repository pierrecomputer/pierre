(module
  (import "../common.wat")

  ;; A character literal starts at the tick $p when a single character - an
  ;; escape, or one code point - sits between it and a closing tick. Any other
  ;; tick is a name quote: a promoted constructor like 'True or '[] under
  ;; DataKinds, or a Template Haskell 'name / ''Type.
  ;; A line break never sits inside one, so the test stays on the line - a
  ;; stream chunk ends there.
  (func $hsIsCharLiteral (param $p i32) (result i32)
    (local $e i32)
    (local $c i32)
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=1 (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const 92))
      (then (return (i32.const 1))))
    (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
      (then (return (i32.const 0))))
    (local.set $e (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 2)) (global.get $end)))
    (i32.and
      (i32.lt_u (local.get $e) (global.get $end))
      (i32.eq (i32.load8_u (local.get $e)) (i32.const 39))))

  ;; Each group's value is its token; bit 8 marks `let` and `where`, which
  ;; prime the next name as a definition.
  (keyword-table $hsWords $mem.haskellWords $mem.hlslWords
    (group $Token.boolean "True" "False")
    (group $Token.keyword.import "module" "import" "qualified" "hiding")
    (group $Token.keyword.declaration "data" "newtype" "type" "class" "instance")
    (group $Token.keyword.control+256 "let" "where")
    ;; control keywords; the extension-only `rec` and `proc` are left out,
    ;; since both are common variable names
    (group $Token.keyword.control
      "case" "of" "if" "then" "else" "do" "in" "deriving" "guard" "mdo")
    (group $Token.keyword ;; other keywords
      "as" "forall" "family" "role" "pattern" "foreign" "default" "infix" "infixl" "infixr")
    (group $Token.function ;; prelude functions
      "map" "fmap" "foldl" "foldr" "pure" "return" "print" "show" "read" "error" "undefined" "id"
      "const" "flip" "zip" "head" "tail" "null" "length" "filter" "concat" "sequence" "traverse"))

  (func $hsIsSymbol (param $c i32) (result i32)
    (byteset.get "!#$%&*+-./:<=>?@\5c^|~" (local.get $c)))

  (func $hlHaskell
    (local $atHead i32)
    (local $braces i32)
    (local $c i32)
    (local $c2 i32)
    (local $g i32)
    (local $gap i32)
    (local $hl i32)
    (local $importLine i32)
    (local $inBacktick i32)
    (local $lhs i32)
    (local $lineHead i32)
    (local $n i32)
    (local $p i32)
    (local $typeMode i32)
    (local $wantFunction i32)
    (local $wantType i32)
    (call $lexEmitLeadingContinuation)
    (local.set $lineHead (i32.const 1))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; the gap crossed a line break when a CR/LF sits before the new $ptr
        (if
          (i32.lt_u
            (call $scanFindSpecial
              (local.get $gap)
              (global.get $ptr)
              (i32.const 10)
              (i32.const 0)
              (i32.const 1))
            (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            (local.set $importLine (i32.const 0))
            (local.set $typeMode (i32.const 0))
            (local.set $wantFunction (i32.const 0))
            (local.set $wantType (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $atHead (local.get $lineHead))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        (if
          (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const "-")))
          (then
            (if
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "#")))
              (then
                ;; a pragma closes with `#-}`, so the nested comment scan
                ;; finds its end and checkpoints a pragma that spans chunks
                (call $lexNestedBlockComment
                  (i32.const "{-")
                  (i32.const "-}")
                  (enum.get $Token.preproc)))
              (else
                (local.set $hl (enum.get $Token.comment))
                (if
                  (i32.and
                    (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                    (i32.or
                      (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "|"))
                      (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "^"))))
                  (then (local.set $hl (enum.get $Token.comment.doc))))
                ;; Haskell block comments nest, unlike C-style comments.
                (call $lexNestedBlockComment (i32.const "{-") (i32.const "-}") (local.get $hl))))
            (br $next)))
        (block $notComment
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.eq (local.get $c2) (i32.const "-")))
            (then
              ;; A dash run only opens a comment when what follows is not a
              ;; symbol, so `-->` and `--|` stay operators while `---` does not.
              (local.set $p (global.get $ptr))
              (block $dashDone
                (loop $dash
                  (br_if $dashDone (i32.ge_u (local.get $p) (global.get $end)))
                  (br_if $dashDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "-")))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $dash)))
              (br_if $notComment
                (i32.and
                  (i32.lt_u (local.get $p) (global.get $end))
                  (call $hsIsSymbol (i32.load8_u (local.get $p)))))
              (local.set $hl (enum.get $Token.comment))
              (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (then
                  (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
                  (if
                    (i32.and
                      (i32.lt_u (local.get $p) (global.get $end))
                      (i32.eq (i32.load8_u (local.get $p)) (i32.const 32)))
                    (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                  (if
                    (i32.and
                      (i32.lt_u (local.get $p) (global.get $end))
                      (i32.or
                        (i32.or
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const "|"))
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const "^")))
                        (i32.eq (i32.load8_u (local.get $p)) (i32.const "$"))))
                    (then (local.set $hl (enum.get $Token.comment.doc))))))
              (call $lexLineComment (i32.const 2) (local.get $hl))
              (br $next))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if
          (if (result i32) (i32.eq (local.get $c) (i32.const 39))
            (then (call $hsIsCharLiteral (global.get $ptr)))
            (else (i32.const 0)))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string.special))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        ;; a name-quoting tick: the constructor or name after it lexes as usual
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $inBacktick (i32.eqz (local.get $inBacktick)))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        ;; `$` is an operator here, not an identifier byte as in the shared
        ;; predicate, so `f $ x` keeps its application operator
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            ;; identifier bytes plus prime, which marks variants like foldl';
            ;; 16 bytes per step
            (call $scanIdentRun (i32.const 39))
            ;; the group value, or -1 for a name that is not a keyword
            (local.set $g (keyword-table.value $hsWords (local.get $lhs) (global.get $ptr)))
            (local.set $hl (i32.and (local.get $g) (i32.const 255)))
            (if (i32.lt_s (local.get $g) (i32.const 0))
              (then
                (if
                  (i32.or
                    (local.get $wantType)
                    (i32.or
                      (local.get $typeMode)
                      (i32.and
                        (local.get $importLine)
                        (i32.le_u
                          (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                          (i32.const 25)))))
                  (then (local.set $hl (enum.get $Token.type)))
                  (else
                    (if
                      (i32.le_u
                        (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                        (i32.const 25))
                      (then (local.set $hl (enum.get $Token.constructor)))
                      (else
                        (if
                          (i32.or
                            (local.get $inBacktick)
                            (i32.or (local.get $atHead) (local.get $wantFunction)))
                          (then
                            (local.set $hl
                              (select
                                (enum.get $Token.function)
                                (enum.get $Token.function.definition)
                                (local.get $inBacktick))))
                          (else
                            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                            (local.set $hl
                              (select
                                (enum.get $Token.function)
                                (enum.get $Token.variable)
                                (i32.and
                                  (i32.lt_u (local.get $p) (global.get $end))
                                  (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
              (then (local.set $wantType (i32.const 1)))
              (else
                (if (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                  (then (local.set $importLine (i32.const 1)))
                  (else (local.set $wantType (i32.const 0))))))
            (local.set $wantFunction (i32.gt_s (local.get $g) (i32.const 255)))
            (local.set $lineHead (i32.const 0))
            (br $next)))

        ;; $braces is a stack of open brackets, one bit each with 1 for `{`,
        ;; so a `,` directly inside a record ends a field's type while one
        ;; inside a tuple type keeps it
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (byteset.get ")]}" (local.get $c))
              (then (local.set $braces (i32.shr_u (local.get $braces) (i32.const 1))))
              (else
                (local.set $braces
                  (i32.or
                    (i32.shl (local.get $braces) (i32.const 1))
                    (i32.eq (local.get $c) (i32.const "{"))))))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (if (i32.and (local.get $braces) (i32.const 1))
              (then (local.set $typeMode (i32.const 0))))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (call $hsIsSymbol (local.get $c))
          (then
            (block $symbolDone
              (loop $symbol
                (br_if $symbolDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $symbolDone (i32.eqz (call $hsIsSymbol (i32.load8_u (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $symbol)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
            (if (i32.eq (local.get $n) (i32.const 2))
              (then
                (local.set $p (i32.load16_u (local.get $lhs)))
                (if (i32.eq (local.get $p) (i32.const "::"))
                  (then (local.set $typeMode (i32.const 1))))
                (if (i32.eq (local.get $p) (i32.const "=="))
                  (then (local.set $typeMode (i32.const 0))))))
            (if
              (i32.and
                (i32.eq (local.get $n) (i32.const 1))
                (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "=")))
              (then
                (local.set $typeMode (i32.const 0))
                (local.set $wantType (i32.const 0))))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $lineHead (i32.const 0))
        (br $next))))
)
