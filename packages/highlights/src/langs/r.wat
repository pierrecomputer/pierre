(module
  (import "../common.wat")

  (func $rByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlR. `NA_complex_` is missing on
  ;; purpose: it shares its hash features with `NA_integer_`.
  (keyword-table $rWords $mem.rWords $mem.rWords+256
    (group ;; 1: control
      "if" "else" "repeat" "while" "for" "next" "break" "return")
    (group "function")     ;; 2: declaration
    (group "TRUE" "FALSE") ;; 3: booleans
    (group ;; 4: built-in constants
      "NULL" "NA" "NA_integer_" "NA_real_" "NA_character_" "Inf" "NaN")
    (group "in"))          ;; 5: word operator

  ;; Whether the name ending at $p is assigned a function: `<-`, `<<-`, or
  ;; a single `=` follows on the same line, then `function` or a `\(`
  ;; lambda.
  (func $rDefinedAhead (param $p i32) (result i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.eq (call $rByte (local.get $p)) (i32.const "<"))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (i32.eq (call $rByte (local.get $p)) (i32.const "<"))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (if (i32.ne (call $rByte (local.get $p)) (i32.const "-"))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1))))
      (else
        (if (i32.or
              (i32.ne (call $rByte (local.get $p)) (i32.const "="))
              (i32.eq (call $rByte (i32.add (local.get $p) (i32.const 1))) (i32.const "=")))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.and
          (i32.eq (call $rByte (local.get $p)) (i32.const 92))
          (i32.eq (call $rByte (i32.add (local.get $p) (i32.const 1))) (i32.const "(")))
      (then (return (i32.const 1))))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 8)) (global.get $end))
      (then (return (i32.const 0))))
    (i32.and
      (i64.eq (i64.load (local.get $p)) (i64.const "function"))
      (i32.eqz (i32.or
        (call $lexIsIdentContinue (call $rByte (i32.add (local.get $p) (i32.const 8))))
        (i32.eq (call $rByte (i32.add (local.get $p) (i32.const 8))) (i32.const "."))))))

  ;; A raw string `r"(...)"`, `R'[...]'`, or `r"---(...)---"` whose prefix
  ;; sits at $ptr. The closer - the matching bracket, the same dashes, and
  ;; the quote - is built in the stream delimiter slot and found with the
  ;; shared fixed-delimiter scan, which also checkpoints an unterminated
  ;; body. Returns 0, consuming nothing, when the bytes are not a raw
  ;; string opener.
  (func $rRawString (result i32)
    (local $lhs i32)
    (local $p i32)
    (local $n i32)
    (local $q i32)
    (local $close i32)
    (local.set $lhs (global.get $ptr))
    (local.set $q (call $rByte (i32.add (global.get $ptr) (i32.const 1))))
    (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
    (block $dashDone
      (loop $dash
        (br_if $dashDone (i32.ne (call $rByte (local.get $p)) (i32.const "-")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $dash)))
    (if (i32.gt_u (local.get $n) (i32.const 30))
      (then (return (i32.const 0))))
    (local.set $close (call $rByte (local.get $p)))
    (if (i32.eq (local.get $close) (i32.const "(")) (then (local.set $close (i32.const ")"))))
    (if (i32.eq (local.get $close) (i32.const "[")) (then (local.set $close (i32.const "]"))))
    (if (i32.eq (local.get $close) (i32.const "{")) (then (local.set $close (i32.const "}"))))
    (if (i32.eqz (i32.or
          (i32.or (i32.eq (local.get $close) (i32.const ")")) (i32.eq (local.get $close) (i32.const "]")))
          (i32.eq (local.get $close) (i32.const "}"))))
      (then (return (i32.const 0))))
    (i32.store8 (i32.const $mem.streamDelimiter) (local.get $close))
    (memory.fill (i32.const $mem.streamDelimiter+1) (i32.const "-") (local.get $n))
    (i32.store8 (i32.add (i32.const $mem.streamDelimiter+1) (local.get $n)) (local.get $q))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (global.set $streamA (i32.add (local.get $n) (i32.const 2)))
    (global.set $streamHl (enum.get $Token.string))
    (if (call $streamResumeFixed)
      (then
        (call $streamSetFixed
          (i32.const $mem.streamDelimiter) (i32.add (local.get $n) (i32.const 2))
          (enum.get $Token.string)))
      (else
        (global.set $streamA (i32.const 0))
        (global.set $streamHl (i32.const 0))))
    (i32.const 1))

  (func $rIsOp (param $c i32) (result i32)
    (byteset.get "!&*+-/:<=>?^|~" (local.get $c)))

  ;; $paren counts open parens, and $fnDepth is the depth of the formals of
  ;; a `function(` or `\(` head that $fnHead announced, where bare names are
  ;; parameters. $member is 1 after `$` or `@`. All are checkpointed.
  (func $hlR
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $g i32) (local $hl i32) (local $member i32)
    (local $paren i32) (local $fnHead i32) (local $fnDepth i32) (local $atFn i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $rByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $rByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atFn (local.get $fnHead))
        (local.set $fnHead (i32.const 0))

        ;; `#'` roxygen comments document the next object
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c2) (i32.const 39))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 1) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 96))
          (then
            (call $lexRawString (i32.const 96) (i32.const 0) (enum.get $Token.variable))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and
              (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "r"))
              (i32.and
                (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39)))
                (i32.or
                  (i32.eq (local.get $c3) (i32.const "-"))
                  (i32.or
                    (i32.or (i32.eq (local.get $c3) (i32.const "(")) (i32.eq (local.get $c3) (i32.const "[")))
                    (i32.eq (local.get $c3) (i32.const "{"))))))
          (then
            (if (call $rRawString)
              (then
                (local.set $member (i32.const 0))
                (br $next)))))
        ;; `%in%`, `%>%`, and other user operators
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (local.set $p (call $scanFindSpecial
              (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)
              (i32.const "%") (i32.const 0) (i32.const 1)))
            (if (i32.and
                  (i32.lt_u (local.get $p) (global.get $end))
                  (i32.eq (i32.load8_u (local.get $p)) (i32.const "%")))
              (then (global.set $ptr (i32.add (local.get $p) (i32.const 1))))
              (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `\(x)` lambda
        (if (i32.and (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $c2) (i32.const "(")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.keyword.declaration) (local.get $lhs) (global.get $ptr))
            (local.set $fnHead (i32.const 1))
            (br $next)))
        ;; `...` and `..1`
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $scanIdentRun (i32.const "."))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; names may contain and start with `.`
        (if (i32.or
              (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))))
          (then
            (call $scanIdentRun (i32.const "."))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $g (select (i32.const 0)
              (keyword-table.get $rWords (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (local.get $g)
              (then
                (local.set $hl (enum.get $Token.keyword.control))
                (if (i32.eq (local.get $g) (i32.const 2))
                  (then
                    (local.set $hl (enum.get $Token.keyword.declaration))
                    (local.set $fnHead (i32.const 1))))
                (if (i32.eq (local.get $g) (i32.const 3)) (then (local.set $hl (enum.get $Token.boolean))))
                (if (i32.eq (local.get $g) (i32.const 4)) (then (local.set $hl (enum.get $Token.constant.builtin))))
                (if (i32.eq (local.get $g) (i32.const 5)) (then (local.set $hl (enum.get $Token.keyword.operator)))))
              (else
                (if (local.get $member)
                  (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                    (i32.eq (call $rByte (local.get $p)) (i32.const "(")))))
                  (else
                    (if (i32.and
                          (i32.eq (call $rByte (local.get $rhs)) (i32.const ":"))
                          (i32.eq (call $rByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":")))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else
                        (if (call $rDefinedAhead (local.get $rhs))
                          (then (local.set $hl (enum.get $Token.function.definition)))
                          (else
                            (if (i32.eq (call $rByte (local.get $p)) (i32.const "("))
                              (then (local.set $hl (enum.get $Token.function)))
                              (else
                                ;; formals, and `name =` arguments of a call
                                (if (i32.or
                                      (i32.and
                                        (i32.ne (local.get $fnDepth) (i32.const 0))
                                        (i32.eq (local.get $paren) (local.get $fnDepth)))
                                      (i32.and
                                        (i32.ne (local.get $paren) (i32.const 0))
                                        (i32.and
                                          (i32.eq (call $rByte (local.get $p)) (i32.const "="))
                                          (i32.ne (call $rByte (i32.add (local.get $p) (i32.const 1))) (i32.const "=")))))
                                  (then (local.set $hl (enum.get $Token.variable.parameter)))
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

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $paren (i32.add (local.get $paren) (i32.const 1)))
                (if (local.get $atFn) (then (local.set $fnDepth (local.get $paren))))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (i32.eq (local.get $paren) (local.get $fnDepth))
                  (then (local.set $fnDepth (i32.const 0))))
                (if (local.get $paren)
                  (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `$` and `@` reach into lists and slots
        (if (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "@")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))
        (if (call $rIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $rIsOp (call $rByte (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
