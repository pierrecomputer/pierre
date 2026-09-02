(module
  (import "../common.wat")

  (func $goByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; group order is the dispatch order in $goWordHl below
  (keyword-table $goWords $mem.goWords $mem.goWords+512 16 64
    (group ;; 1: control
      "go" "if" "for" "case" "else" "goto" "break" "defer" "range" "return"
      "select" "switch" "default" "continue" "fallthrough")
    (group "func")    ;; 2: declaration, next name is a function
    (group "type")    ;; 3: declaration, next name is a type
    (group "package") ;; 4: declaration, next name is a namespace
    (group ;; 5: declaration
      "var" "const" "map" "chan" "struct" "interface")
    (group "import")  ;; 6: import
    (group ;; 7: built-in types and constraints
      "int" "bool" "byte" "rune" "uint" "error" "string" "uintptr"
      "int8" "int16" "int32" "int64" "uint8" "uint16" "uint32" "uint64"
      "float32" "float64" "complex64" "complex128" "any" "comparable")
    (group "true" "false") ;; 8: booleans
    (group "nil" "iota"))  ;; 9: built-in constants

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type, 3=namespace.
  (func $goWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g (keyword-table.get $goWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g)) (then (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 4))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 1)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.boolean))))
    (enum.get $Token.constant.builtin))

  (func $goIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^"))))))))

  ;; $expect is the pending next-name capture from $goWordHl, or 4 for the
  ;; name after a receiver's closing paren, which is a method definition only
  ;; when its own parameter list follows - `func (s *T) Name(` - and an
  ;; ordinary name otherwise, as in a literal's result type `func(x int) T {`.
  ;; $recv is 1 inside the paren that directly follows `func`.
  (func $hlGo
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $recv i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $goByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $goByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/"))
                      (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "*"))
                      (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexRawString (i32.const "`") (i32.const 1) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $goWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; a keyword after a receiver's `)` is a result type, not
                ;; the method name
                (if (i32.eq (local.get $expect) (i32.const 4))
                  (then (local.set $expect (i32.const 0))))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                ;; after a receiver, only a name with its own parameter
                ;; list is the method being defined
                (if (i32.and
                      (i32.eq (local.get $expect) (i32.const 4))
                      (i32.ne (call $goByte (local.get $p)) (i32.const "(")))
                  (then (local.set $expect (i32.const 0))))
                (if (local.get $expect)
                  (then
                    (local.set $hl
                      (select (enum.get $Token.function.definition)
                        (select (enum.get $Token.namespace) (enum.get $Token.type)
                          (i32.eq (local.get $expect) (i32.const 3)))
                        (i32.or
                          (i32.eq (local.get $expect) (i32.const 1))
                          (i32.eq (local.get $expect) (i32.const 4)))))
                    (local.set $expect (i32.const 0)))
                  (else
                    (if (i32.eq (call $goByte (local.get $p)) (i32.const "("))
                      (then (local.set $hl (select
                        (enum.get $Token.function.method) (enum.get $Token.function) (local.get $member))))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (if (i32.le_u
                                      (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                                  (then (local.set $hl (enum.get $Token.type)))
                                  (else (local.set $hl (enum.get $Token.variable))))))))))))))
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

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; A paren right after `func` opens a receiver or a literal's
            ;; parameter list and ends the plain next-name capture; its close
            ;; re-arms the conditional one when a name follows on the same
            ;; line - a line break ends the statement instead. Braces end
            ;; any pending capture.
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $recv (i32.eq (local.get $expect) (i32.const 1)))
                (local.set $expect (i32.const 0))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (local.get $recv))
              (then
                (local.set $recv (i32.const 0))
                (if (call $lexIsIdentStart
                      (call $goByte (call $lexSkipSpaceAt (global.get $ptr))))
                  (then (local.set $expect (i32.const 4))))))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then
                (local.set $recv (i32.const 0))
                (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (local.set $recv (i32.const 0))
                (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))

        (if (call $goIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "+"))
                                    (i32.eq (local.get $c) (i32.const "-")))
                            (i32.or
                              (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                      (i32.eq (local.get $c) (i32.const ">")))
                              (i32.or (i32.eq (local.get $c) (i32.const "&"))
                                      (i32.eq (local.get $c) (i32.const "|")))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const "<"))
                              (i32.eq (local.get $c) (i32.const ">")))
                      (i32.eq (call $goByte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
