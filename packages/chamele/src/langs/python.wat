(module
  (import "../common.wat")

  ;; Scan a Python string body. $seg includes the prefix and opening quote for
  ;; a new literal and starts at $ptr when resuming a stream chunk. Returns one
  ;; after the closing quote, two after a continued line, or zero otherwise.
  (func $pyStringBody (param $quote i32) (param $raw i32)
        (param $format i32) (param $triple i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (if (local.get $triple)
              (then
                (if (i32.and
                      (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                      (i32.and
                        (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
                        (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                    (local.set $status (i32.const 1))
                    (br $done))))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $status (i32.const 1))
                (br $done)))))
        (br_if $done (i32.and
          (i32.eqz (local.get $triple))
          (i32.or (i32.eq (local.get $c) (i32.const 10))
                  (i32.eq (local.get $c) (i32.const 13)))))
        (if (i32.and (local.get $raw)
                     (i32.eq (local.get $c) (i32.const 92)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (br $scan)))
        (if (i32.and (i32.eqz (local.get $raw))
                     (i32.eq (local.get $c) (i32.const 92)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (i32.add (global.get $ptr) (i32.const 2)))
            (if (i32.gt_u (local.get $e) (global.get $end))
              (then (local.set $e (global.get $end))))
            (block $utf8Done
              (loop $utf8
                (br_if $utf8Done (i32.ge_u (local.get $e) (global.get $end)))
                (br_if $utf8Done (i32.ne
                  (i32.and (i32.load8_u (local.get $e)) (i32.const 0xc0))
                  (i32.const 0x80)))
                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                (br $utf8)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (if (i32.and
                  (i32.eq (global.get $ptr) (global.get $end))
                  (i32.and
                    (i32.gt_u (global.get $ptr) (local.get $seg))
                    (i32.or
                      (i32.eq
                        (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))
                        (i32.const 10))
                      (i32.eq
                        (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))
                        (i32.const 13)))))
              (then (local.set $status (i32.const 2))))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if (i32.and
              (local.get $format)
              (i32.or (i32.eq (local.get $c) (i32.const "{"))
                      (i32.eq (local.get $c) (i32.const "}"))))
          (then
            (if (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                  (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $c)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br $scan)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $e) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; Python string literal at $ptr, including a 0-2 byte prefix. Triple quotes
  ;; are multiline; raw literals retain backslashes and f-string braces are
  ;; surfaced without attempting to recursively parse their expressions.
  (func $pyString (param $prefix i32) (param $quote i32)
        (param $raw i32) (param $format i32)
    (local $seg i32)
    (local $status i32)
    (local $triple i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $prefix)))
    (if (i32.and
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
          (i32.and
            (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
            (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote))))
      (then
        (local.set $triple (i32.const 1))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 3))))
      (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (local.set $status (call $pyStringBody
      (local.get $quote) (local.get $raw) (local.get $format)
      (local.get $triple) (local.get $seg)))
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.and
              (i32.ne (local.get $status) (i32.const 1))
              (i32.or
                (local.get $triple)
                (i32.eq (local.get $status) (i32.const 2))))))
      (then
        (global.set $streamMode (i32.const 10))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (i32.or
          (local.get $raw)
          (i32.or
            (i32.shl (local.get $format) (i32.const 1))
            (i32.shl (local.get $triple) (i32.const 2))))))))

  (func $pyStreamResume (result i32)
    (local $flags i32)
    (local $status i32)
    (if (i32.ne (global.get $streamMode) (i32.const 10))
      (then (return (i32.const 0))))
    (local.set $flags (global.get $streamB))
    (local.set $status (call $pyStringBody
      (global.get $streamA)
      (i32.and (local.get $flags) (i32.const 1))
      (i32.and (i32.shr_u (local.get $flags) (i32.const 1)) (i32.const 1))
      (i32.and (i32.shr_u (local.get $flags) (i32.const 2)) (i32.const 1))
      (global.get $ptr)))
    (if (i32.eq (local.get $status) (i32.const 1))
      (then
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.and
          (i32.eq (global.get $ptr) (global.get $end))
          (i32.or
            (i32.and (local.get $flags) (i32.const 4))
            (i32.eq (local.get $status) (i32.const 2))))
      (then (return (i32.const 1))))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))

  (func $pyWordHl (param $hash i32) (result i32)
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x7c881713)) ;; True
          (i32.eq (local.get $hash) (i32.const 0x0c4d6f38))) ;; False
      (then (return (enum.get $Token.boolean))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x7c82d16f)) ;; None
            (i32.eq (local.get $hash) (i32.const 0x6aa6e0f0))) ;; Ellipsis
          (i32.eq (local.get $hash) (i32.const 0x357cc63e))) ;; NotImplemented
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x7c797779)) ;; self
          (i32.eq (local.get $hash) (i32.const 0x0b874c59))) ;; cls
      (then (return (enum.get $Token.variable.special))))
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x0b871e62)) ;; def
          (i32.eq (local.get $hash) (i32.const 0x0a8b90ab))) ;; class
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.or
          (i32.eq (local.get $hash) (i32.const 0x7c6e3bb3)) ;; from
          (i32.eq (local.get $hash) (i32.const 0x5fc4f278))) ;; import
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.or
          (i32.or
            (i32.eq (local.get $hash) (i32.const 0x0b87330e)) ;; and
            (i32.eq (local.get $hash) (i32.const 0x00596f22))) ;; in
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x00596f3f)) ;; is
              (i32.eq (local.get $hash) (i32.const 0x0b8757b0))) ;; not
            (i32.eq (local.get $hash) (i32.const 0x00596f78)))) ;; or
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x4f6c4c47)) ;; assert
              (i32.eq (local.get $hash) (i32.const 0x0a2a4b23))) ;; async
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0a283ecf)) ;; await
              (i32.eq (local.get $hash) (i32.const 0x0a7dd9fa)))) ;; break
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c70c251)) ;; case
              (i32.eq (local.get $hash) (i32.const 0x8f091da4))) ;; continue
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b871e68)) ;; del
              (i32.eq (local.get $hash) (i32.const 0x7c6b8b83))))) ;; elif
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c6b8f5a)) ;; else
              (i32.eq (local.get $hash) (i32.const 0x465d5a5a))) ;; except
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x6a34fe5c)) ;; finally
              (i32.eq (local.get $hash) (i32.const 0x0b8737be)))) ;; for
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x532fc42e)) ;; global
              (i32.eq (local.get $hash) (i32.const 0x00596f2a))) ;; if
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x55320e62)) ;; lambda
              (i32.eq (local.get $hash) (i32.const 0x0a672296))))) ;; match
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0xce20a807)) ;; nonlocal
              (i32.eq (local.get $hash) (i32.const 0x7c75cfb4))) ;; pass
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b9a8149)) ;; raise
              (i32.eq (local.get $hash) (i32.const 0x7e985a8f)))) ;; return
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b875f9a)) ;; try
              (i32.eq (local.get $hash) (i32.const 0x0b66c65a))) ;; while
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c7775e7)) ;; with
              (i32.eq (local.get $hash) (i32.const 0x0bcc4938))))) ;; yield
      (then (return (enum.get $Token.keyword.control))))

    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c703ceb)) ;; bool
              (i32.eq (local.get $hash) (i32.const 0x5fcca376))) ;; bytearray
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0a85b25c)) ;; bytes
              (i32.eq (local.get $hash) (i32.const 0xdd349dc5)))) ;; complex
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c6afc3f)) ;; dict
              (i32.eq (local.get $hash) (i32.const 0x0a364435))) ;; float
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x91f79ced)) ;; frozenset
              (i32.eq (local.get $hash) (i32.const 0x0b875316))))) ;; int
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c6f1d27)) ;; list
              (i32.eq (local.get $hash) (i32.const 0x775b4469))) ;; memoryview
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x649a8d90)) ;; object
              (i32.eq (local.get $hash) (i32.const 0x0b9a5e1a)))) ;; range
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b878f27)) ;; set
              (i32.eq (local.get $hash) (i32.const 0x0bacf4b5))) ;; slice
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b878d50)) ;; str
              (i32.or
                (i32.eq (local.get $hash) (i32.const 0x0ae141fd)) ;; tuple
                (i32.eq (local.get $hash) (i32.const 0x7c737f9d)))))) ;; type
      (then (return (enum.get $Token.type.builtin))))

    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b873295)) ;; abs
              (i32.eq (local.get $hash) (i32.const 0x0b873344))) ;; all
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b873313)) ;; any
              (i32.eq (local.get $hash) (i32.const 0xe01d700d)))) ;; callable
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0xbb93ba71)) ;; enumerate
              (i32.eq (local.get $hash) (i32.const 0x50cebe25))) ;; filter
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0xa67c17c0)) ;; getattr
              (i32.eq (local.get $hash) (i32.const 0x0aa85a73))))) ;; input
      (then (return (enum.get $Token.function))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0bbabeb6)) ;; isinstance
              (i32.eq (local.get $hash) (i32.const 0x7c72218f))) ;; iter
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b874062)) ;; len
              (i32.eq (local.get $hash) (i32.const 0x0b8743b9)))) ;; map
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b8743b1)) ;; max
              (i32.eq (local.get $hash) (i32.const 0x0b8742af))) ;; min
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c728842)) ;; next
              (i32.eq (local.get $hash) (i32.const 0x7c733ad1))))) ;; open
      (then (return (enum.get $Token.function))))
    (if (i32.or
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b87732d)) ;; pow
              (i32.eq (local.get $hash) (i32.const 0x0b25c654))) ;; print
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x7c78f7d0)) ;; repr
              (i32.eq (local.get $hash) (i32.const 0x0b9925e7)))) ;; round
          (i32.or
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x8158155e)) ;; sorted
              (i32.eq (local.get $hash) (i32.const 0x0b878d2e))) ;; sum
            (i32.or
              (i32.eq (local.get $hash) (i32.const 0x0b9fb2c4)) ;; super
              (i32.eq (local.get $hash) (i32.const 0x0b87ace6))))) ;; zip
      (then (return (enum.get $Token.function))))
    (enum.get $Token.none))

  (func $pyIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+"))
                (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*"))
                (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%"))
                (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "<"))
                  (i32.eq (local.get $c) (i32.const ">")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "!"))
                    (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|"))
                      (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~"))
                      (i32.eq (local.get $c) (i32.const "@")))))))))

  (func $hlPython
    (local $afterDecl i32) ;; 1 = def, 2 = class
    (local $afterDot i32)
    (local $c i32)
    (local $c2 i32)
    (local $format i32)
    (local $gap i32)
    (local $hash i32)
    (local $hl i32)
    (local $lhs i32)
    (local $lineHead i32)
    (local $p i32)
    (local $prefix i32)
    (local $q i32)
    (local $raw i32)
    (local $typeNext i32)
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
              (then (local.set $lineHead (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $space)))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and
              (local.get $lineHead)
              (i32.eq (local.get $c) (i32.const "@")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $decoratorDone
              (loop $decorator
                (br_if $decoratorDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $decoratorDone (i32.eqz
                  (i32.or (call $lexIsIdentContinue (local.get $c))
                          (i32.eq (local.get $c) (i32.const ".")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $decorator)))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.lt_u (i32.add (local.get $lhs) (i32.const 2)) (global.get $end))
          (then
            (local.set $p (i32.or (i32.load16_u (local.get $lhs)) (i32.const 0x2020)))
            (if (i32.and
                  (i32.or
                    (i32.or (i32.eq (local.get $p) (i32.const "br"))
                            (i32.eq (local.get $p) (i32.const "rb")))
                    (i32.or (i32.eq (local.get $p) (i32.const "fr"))
                            (i32.eq (local.get $p) (i32.const "rf"))))
                  (i32.or
                    (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const 34))
                    (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const 39))))
              (then
                (call $pyString
                  (i32.const 2) (i32.load8_u offset=2 (local.get $lhs))
                  (i32.const 1)
                  (i32.or
                    (i32.eq (local.get $p) (i32.const "fr"))
                    (i32.eq (local.get $p) (i32.const "rf"))))
                (local.set $lineHead (i32.const 0))
                (local.set $afterDot (i32.const 0))
                (br $next)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $pyString (i32.const 0) (local.get $c) (i32.const 0) (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (br $next)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $lineHead (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $typeNext (i32.const 0))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            ;; Recognize case-insensitive r/u/b/f and br/rb/fr/rf prefixes.
            (local.set $prefix (i32.const 0))
            (local.set $raw (i32.const 0))
            (local.set $format (i32.const 0))
            (local.set $c (i32.or (local.get $c) (i32.const 32)))
            (if (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "r"))
                          (i32.eq (local.get $c) (i32.const "u")))
                  (i32.or (i32.eq (local.get $c) (i32.const "b"))
                          (i32.eq (local.get $c) (i32.const "f"))))
              (then
                (local.set $prefix (i32.const 1))
                (local.set $raw (i32.eq (local.get $c) (i32.const "r")))
                (local.set $format (i32.eq (local.get $c) (i32.const "f")))))
            (local.set $q (i32.add (local.get $lhs) (local.get $prefix)))
            (if (i32.and
                  (local.get $prefix)
                  (i32.and
                    (i32.lt_u (local.get $q) (global.get $end))
                    (i32.or
                      (i32.eq (i32.load8_u (local.get $q)) (i32.const 34))
                      (i32.eq (i32.load8_u (local.get $q)) (i32.const 39)))))
              (then
                (call $pyString
                  (local.get $prefix) (i32.load8_u (local.get $q))
                  (local.get $raw) (local.get $format))
                (local.set $lineHead (i32.const 0))
                (local.set $afterDot (i32.const 0))
                (br $next)))

            ;; Identifier and djb2-xor hash in one forward scan.
            (local.set $hash (i32.const 5381))
            (block $identDone
              (loop $ident
                (br_if $identDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $identDone (i32.eqz (call $lexIsIdentContinue (local.get $c))))
                (local.set $hash (i32.xor
                  (i32.mul (local.get $hash) (i32.const 33)) (local.get $c)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $ident)))
            (local.set $hl (call $pyWordHl (local.get $hash)))
            (if (i32.eq (local.get $hl) (enum.get $Token.none))
              (then
                (if (local.get $afterDecl)
                  (then
                    (local.set $hl (select
                      (enum.get $Token.type.class)
                      (enum.get $Token.function.definition)
                      (i32.eq (local.get $afterDecl) (i32.const 2)))))
                  (else
                    (if (local.get $afterDot)
                      (then
                        (local.set $q (call $lexSkipSpaceAt (global.get $ptr)))
                        (local.set $hl (select
                          (enum.get $Token.function.method) (enum.get $Token.property)
                          (i32.and
                            (i32.lt_u (local.get $q) (global.get $end))
                            (i32.eq (i32.load8_u (local.get $q)) (i32.const "("))))))
                      (else
                        (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                          (then (local.set $hl (enum.get $Token.constant)))
                          (else
                            (if (i32.or
                                  (local.get $typeNext)
                                  (i32.le_u
                                    (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                                    (i32.const 25)))
                              (then (local.set $hl (enum.get $Token.type)))
                              (else
                                (local.set $q (call $lexSkipSpaceAt (global.get $ptr)))
                                (local.set $hl (select
                                  (enum.get $Token.function) (enum.get $Token.variable)
                                  (i32.and
                                    (i32.lt_u (local.get $q) (global.get $end))
                                    (i32.eq (i32.load8_u (local.get $q)) (i32.const "(")))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (local.set $afterDecl (select
              (i32.const 1) (i32.const 2)
              (i32.eq (local.get $hash) (i32.const 0x0b871e62)))) ;; def/class
            (if (i32.and
                  (i32.ne (local.get $hash) (i32.const 0x0b871e62))
                  (i32.ne (local.get $hash) (i32.const 0x0a8b90ab)))
              (then (local.set $afterDecl (i32.const 0))))
            (local.set $afterDot (i32.const 0))
            (local.set $typeNext (i32.const 0))
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
            (local.set $afterDot (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "."))
                      (i32.eq (local.get $c) (i32.const ",")))
              (i32.or (i32.and
                        (i32.eq (local.get $c) (i32.const ":"))
                        (i32.ne (local.get $c2) (i32.const "=")))
                      (i32.eq (local.get $c) (i32.const ";"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $afterDot (i32.eq (local.get $c) (i32.const ".")))
            (local.set $typeNext (i32.eq (local.get $c) (i32.const ":")))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.or
              (call $pyIsOp (local.get $c))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.or
                      (i32.eq (local.get $c) (local.get $c2))
                      (i32.and
                        (i32.eq (local.get $c) (i32.const "-"))
                        (i32.eq (local.get $c2) (i32.const ">"))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.or
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "="))
                        (i32.and
                          (i32.eq (local.get $c) (i32.const "/"))
                          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/")))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $typeNext (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.eq (local.get $c2) (i32.const ">"))))
            (local.set $afterDot (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $afterDot (i32.const 0))
        (local.set $lineHead (i32.const 0))
        (br $next))))
)
