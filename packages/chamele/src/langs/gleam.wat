(module
  (import "../common.wat")

  (func $gleamByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $gleamWordHl below.
  (keyword-table $gleamWords $mem.gleamWords $mem.gleamWords+384 16 64
    (group ;; 1: control
      "case" "if" "else" "panic" "todo" "assert" "echo" "use")
    (group "fn")   ;; 2: declaration, next name is a function
    (group "type") ;; 3: declaration, next name is a type
    (group ;; 4: declaration
      "let" "const" "pub" "opaque" "auto" "delegate" "derive" "implement"
      "macro" "test")
    (group "import" "as")  ;; 5: import
    (group "True" "False") ;; 6: booleans
    (group "Nil"))         ;; 7: built-in constant

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type. -1 for an ordinary name.
  (func $gleamWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g (keyword-table.get $gleamWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 1)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.boolean))))
    (enum.get $Token.constant.builtin))

  (func $gleamIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "!")))
          (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">"))))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "&")))
          (i32.eq (local.get $c) (i32.const "%"))))))

  ;; $expect is 1 after `fn` and 2 after `type`, naming the next capture.
  ;; $importCtx is 1 on an `import` line, where names are module paths.
  ;; $typeCtx is 1 after a `:` annotation or a return `->`, where an
  ;; uppercase name before `(` is a type rather than a constructor; $fnHead
  ;; is 1 between `fn` and its body, where `->` opens the return type
  ;; rather than a case clause. $member is 1 after `.`. All are
  ;; checkpointed.
  (func $hlGleam
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $importCtx i32) (local $typeCtx i32) (local $fnHead i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; an import line ends at its line break
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then (local.set $importCtx (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $gleamByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $gleamByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $kind (select (i32.const -1)
              (call $gleamWordHl (local.get $lhs) (local.get $rhs))
              (i32.or (local.get $member) (local.get $importCtx))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                (if (i32.eq (local.get $expect) (i32.const 1))
                  (then (local.set $fnHead (i32.const 1))))
                (if (i32.eq (local.get $expect) (i32.const 2))
                  (then (local.set $typeCtx (i32.const 1))))
                ;; `import` starts a module path
                (if (i32.and
                      (i32.eq (local.get $hl) (enum.get $Token.keyword.import))
                      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 6)))
                  (then (local.set $importCtx (i32.const 1)))))
              (else
                (if (local.get $importCtx)
                  (then (local.set $hl (enum.get $Token.namespace)))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                          (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $expect (i32.const 0)))
                      (else
                        (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                          (then
                            ;; a constructor applies outside type context
                            (local.set $hl (select
                              (enum.get $Token.constructor) (enum.get $Token.type)
                              (i32.and
                                (i32.eq (call $gleamByte (local.get $rhs)) (i32.const "("))
                                (i32.eqz (local.get $typeCtx))))))
                          (else
                            (if (local.get $member)
                              (then (local.set $hl (select
                                (enum.get $Token.function.method) (enum.get $Token.property)
                                (i32.eq (call $gleamByte (local.get $p)) (i32.const "(")))))
                              (else
                                (if (i32.eq (call $gleamByte (local.get $rhs)) (i32.const "("))
                                  (then (local.set $hl (enum.get $Token.function)))
                                  (else
                                    ;; `name:` labels arguments and fields
                                    (if (i32.and
                                          (i32.eq (call $gleamByte (local.get $p)) (i32.const ":"))
                                          (i32.ne (call $gleamByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))
                                      (then (local.set $hl (enum.get $Token.variable.parameter)))
                                      (else (local.set $hl (enum.get $Token.variable))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
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
            ;; a bracket ends a pending head; braces, closers, and `]` leave
            ;; type context
            (local.set $expect (i32.const 0))
            (if (i32.ne (local.get $c) (i32.const "(")) (then (local.set $typeCtx (i32.const 0))))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then
                (local.set $fnHead (i32.const 0))
                (local.set $importCtx (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $typeCtx (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $typeCtx (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (call $lexIsIdentStart (local.get $c2)))
                (local.set $importCtx (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `/` separates module path segments on an import line
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (local.get $importCtx))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $gleamIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                ;; `.` joins a float operator such as `+.` or `<=.`
                (br_if $opDone (i32.eqz (i32.or
                  (call $gleamIsOp (call $gleamByte (global.get $ptr)))
                  (i32.eq (call $gleamByte (global.get $ptr)) (i32.const ".")))))
                (br_if $opDone (i32.and
                  (i32.eq (call $gleamByte (global.get $ptr)) (i32.const "/"))
                  (i32.eq (call $gleamByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "/"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            ;; `->` after a parameter list opens the return type; `=` starts
            ;; a value
            (if (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
              (then
                (if (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "->"))
                  (then (local.set $typeCtx (local.get $fnHead))))))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then (local.set $typeCtx (i32.const 0))))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
