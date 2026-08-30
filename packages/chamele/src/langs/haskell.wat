(module
  (import "../common.wat")

  ;; Haskell block comments nest, unlike C-style comments.
  (func $hsBlockComment (param $hl i32)
    (local $depth i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (local.set $depth (i32.const 1))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (then
            (if (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "{-"))
              (then
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br $scan)))
            (if (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "-}"))
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br_if $done (i32.eqz (local.get $depth)))
                (br $scan)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (call $streamSetNested
      (local.get $depth) (i32.const "{-") (i32.const "-}") (local.get $hl)))

  (func $hsPragma
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.and
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
              (i32.and
                (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "#"))
                (i32.eq (i32.load16_u offset=1 (global.get $ptr)) (i32.const "-}"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr)))

  (func $hsWordHl (param $hash i32) (result i32)
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x7c881713)) ;; True
          (i32.eq (local.get $hash) (i32.const 0x0c4d6f38))) ;; False
      (then (return (enum.get $Token.boolean))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x576099bf)) ;; module
            (i32.eq (local.get $hash) (i32.const 0x5fc4f278))) ;; import
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0xbb66624b)) ;; qualified
            (i32.eq (local.get $hash) (i32.const 0x5df255c0)))) ;; hiding
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7c6adc15)) ;; data
            (i32.eq (local.get $hash) (i32.const 0xca4925e1))) ;; newtype
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7c737f9d)) ;; type
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0a8b90ab)) ;; class
              (i32.eq (local.get $hash) (i32.const 0x1cf1548c))))) ;; instance
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c70c251)) ;; case
              (i32.eq (local.get $hash) (i32.const 0x00596f6c))) ;; of
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x00596f2a)) ;; if
              (i32.eq (local.get $hash) (i32.const 0x7c73be32)))) ;; then
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c6b8f5a)) ;; else
              (i32.eq (local.get $hash) (i32.const 0x00596d8e))) ;; do
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b874078)) ;; let
              (i32.eq (local.get $hash) (i32.const 0x00596f22))))) ;; in
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b66f508)) ;; where
              (i32.eq (local.get $hash) (i32.const 0x68d45049))) ;; deriving
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0a4b5460)) ;; guard
              (i32.eq (local.get $hash) (i32.const 0x0b874443)))) ;; mdo
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0b878b71)) ;; rec
            (i32.eq (local.get $hash) (i32.const 0x7c7581eb)))) ;; proc
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x00596e37)) ;; as
              (i32.eq (local.get $hash) (i32.const 0x50b6649f))) ;; forall
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x5045ca33)) ;; family
              (i32.eq (local.get $hash) (i32.const 0x7c790251)))) ;; role
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x959dcc2d)) ;; pattern
              (i32.eq (local.get $hash) (i32.const 0x6780dabb))) ;; foreign
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x9ce67dce)) ;; default
              (i32.eq (local.get $hash) (i32.const 0x0aa831f5))))) ;; infix
      (then (return (enum.get $Token.keyword))))
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x5fae70f9)) ;; infixl
          (i32.eq (local.get $hash) (i32.const 0x5fae70e7))) ;; infixr
      (then (return (enum.get $Token.keyword))))

    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b8743b9)) ;; map
              (i32.eq (local.get $hash) (i32.const 0x7c6e463f))) ;; fmap
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0a33a428)) ;; foldl
              (i32.eq (local.get $hash) (i32.const 0x0a33a436)))) ;; foldr
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c757ed7)) ;; pure
              (i32.eq (local.get $hash) (i32.const 0x7e985a8f))) ;; return
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b25c654)) ;; print
              (i32.eq (local.get $hash) (i32.const 0x7c79aa86))))) ;; show
      (then (return (enum.get $Token.function))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c78f9b7)) ;; read
              (i32.eq (local.get $hash) (i32.const 0x09de11bd))) ;; error
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x9c327aff)) ;; undefined
              (i32.eq (local.get $hash) (i32.const 0x00596f28)))) ;; id
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0a8bffc0)) ;; const
              (i32.eq (local.get $hash) (i32.const 0x7c6e4176))) ;; flip
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b87ace6)) ;; zip
              (i32.eq (local.get $hash) (i32.const 0x7c715ded))))) ;; head
      (then (return (enum.get $Token.function))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c73a175)) ;; tail
              (i32.eq (local.get $hash) (i32.const 0x7c72c9de))) ;; null
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x55758759)) ;; length
              (i32.eq (local.get $hash) (i32.const 0x50cebe25)))) ;; filter
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x5c0bb611)) ;; concat
              (i32.eq (local.get $hash) (i32.const 0x33636b5a))) ;; sequence
            (i32.eq (local.get $hash) (i32.const 0x204a1275)))) ;; traverse
      (then (return (enum.get $Token.function))))
    (enum.get $Token.none))

  (func $hsIsSymbol (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "!"))
                (i32.eq (local.get $c) (i32.const "#")))
        (i32.or (i32.eq (local.get $c) (i32.const "$"))
                (i32.eq (local.get $c) (i32.const "%"))))
      (i32.or
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "&"))
                  (i32.eq (local.get $c) (i32.const "*")))
          (i32.or (i32.eq (local.get $c) (i32.const "+"))
                  (i32.eq (local.get $c) (i32.const "."))))
        (i32.or
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "/"))
                    (i32.eq (local.get $c) (i32.const "<")))
            (i32.or (i32.eq (local.get $c) (i32.const "="))
                    (i32.eq (local.get $c) (i32.const ">"))))
          (i32.or
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "?"))
                      (i32.eq (local.get $c) (i32.const "@")))
              (i32.or (i32.eq (local.get $c) (i32.const 92))
                      (i32.eq (local.get $c) (i32.const "^"))))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|"))
                      (i32.eq (local.get $c) (i32.const "-")))
              (i32.or (i32.eq (local.get $c) (i32.const "~"))
                      (i32.eq (local.get $c) (i32.const ":")))))))))

  (func $hlHaskell
    (local $atHead i32)
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $hash i32)
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
        (block $spaceDone
          (loop $space
            (br_if $spaceDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $spaceDone (i32.eqz (call $lexIsSpace (local.get $c))))
            (if (i32.or (i32.eq (local.get $c) (i32.const 10))
                        (i32.eq (local.get $c) (i32.const 13)))
              (then
                (local.set $lineHead (i32.const 1))
                (local.set $importLine (i32.const 0))
                (local.set $typeMode (i32.const 0))
                (local.set $wantFunction (i32.const 0))
                (local.set $wantType (i32.const 0))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $space)))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $atHead (local.get $lineHead))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        (if (i32.and
              (i32.eq (local.get $c) (i32.const "{"))
              (i32.eq (local.get $c2) (i32.const "-")))
          (then
            (if (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "#")))
              (then (call $hsPragma))
              (else
                (local.set $hl (enum.get $Token.comment))
                (if (i32.and
                      (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                      (i32.or
                        (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "|"))
                        (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "^"))))
                  (then (local.set $hl (enum.get $Token.comment.doc))))
                (call $hsBlockComment (local.get $hl))))
            (br $next)))
        (block $notComment
          (if (i32.and
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
              (br_if $notComment (i32.and
                (i32.lt_u (local.get $p) (global.get $end))
                (call $hsIsSymbol (i32.load8_u (local.get $p)))))
              (local.set $hl (enum.get $Token.comment))
              (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (then
                  (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
                  (if (i32.and
                        (i32.lt_u (local.get $p) (global.get $end))
                        (i32.eq (i32.load8_u (local.get $p)) (i32.const 32)))
                    (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                  (if (i32.and
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
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string.special))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $inBacktick (i32.eqz (local.get $inBacktick)))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (local.set $hash (i32.const 5381))
            (block $identDone
              (loop $ident
                (br_if $identDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $identDone (i32.eqz
                  (i32.or
                    (call $lexIsIdentContinue (local.get $c))
                    (i32.eq (local.get $c) (i32.const 39)))))
                (local.set $hash (i32.xor
                  (i32.mul (local.get $hash) (i32.const 33)) (local.get $c)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $ident)))
            (local.set $hl (call $hsWordHl (local.get $hash)))
            (if (i32.eq (local.get $hl) (enum.get $Token.none))
              (then
                (if (i32.or
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
                    (if (i32.le_u
                          (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                          (i32.const 25))
                      (then (local.set $hl (enum.get $Token.constructor)))
                      (else
                        (if (i32.or
                              (local.get $inBacktick)
                              (i32.or (local.get $atHead) (local.get $wantFunction)))
                          (then (local.set $hl (select
                            (enum.get $Token.function)
                            (enum.get $Token.function.definition)
                            (local.get $inBacktick))))
                          (else
                            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                            (local.set $hl (select
                              (enum.get $Token.function) (enum.get $Token.variable)
                              (i32.and
                                (i32.lt_u (local.get $p) (global.get $end))
                                (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
              (then (local.set $wantType (i32.const 1)))
              (else
                (if (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                  (then (local.set $importLine (i32.const 1)))
                  (else
                    (local.set $wantType (i32.const 0))))))
            (local.set $wantFunction (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b874078)) ;; let
              (i32.eq (local.get $hash) (i32.const 0x0b66f508)))) ;; where
            (local.set $lineHead (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "["))
                        (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ","))
                    (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (call $hsIsSymbol (local.get $c))
          (then
            (block $symbolDone
              (loop $symbol
                (br_if $symbolDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $symbolDone (i32.eqz
                  (call $hsIsSymbol (i32.load8_u (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $symbol)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
            (if (i32.eq (local.get $n) (i32.const 2))
              (then
                (local.set $p (i32.load16_u (local.get $lhs)))
                (if (i32.eq (local.get $p) (i32.const "::"))
                  (then (local.set $typeMode (i32.const 1))))
                (if (i32.eq (local.get $p) (i32.const "="))
                  (then (local.set $typeMode (i32.const 0))))))
            (if (i32.and
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
