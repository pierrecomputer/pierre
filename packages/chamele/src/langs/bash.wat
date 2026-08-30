(module
  (import "../common.wat")

  ;; open `$((` arithmetic expansions: inside one, `<<` is a left shift and
  ;; must not be mistaken for a heredoc opener
  (global $bashArith (mut i32) (i32.const 0))

  (func $bashWordEq (param $lhs i32) (param $rhs i32) (param $n i32) (param $word i64) (result i32)
    (local $mask i64)
    (if (i32.ne (i32.sub (local.get $rhs) (local.get $lhs)) (local.get $n))
      (then (return (i32.const 0))))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then (return (i64.eq (i64.load (local.get $lhs)) (local.get $word)))))
    (local.set $mask (i64.sub
      (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
      (i64.const 1)))
    (i64.eq (i64.and (i64.load (local.get $lhs)) (local.get $mask)) (local.get $word)))

  (func $bashWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "do"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "fi"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "if"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 2) (i64.const "in"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 3) (i64.const "for"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "case"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "done"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "elif"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "else"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "esac"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "then"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "break"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "until"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "while"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "return"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "select"))
      (then (return (enum.get $Token.keyword.control))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "continue"))
      (then (return (enum.get $Token.keyword.control))))

    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 5) (i64.const "local"))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "export"))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "declare"))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "function"))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "readonly"))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 7) (i64.const "typeset"))
      (then (return (enum.get $Token.keyword.declaration))))

    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 1) (i64.const "!"))
      (then (return (enum.get $Token.keyword.operator))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 4) (i64.const "time"))
      (then (return (enum.get $Token.keyword))))
    (if (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 6) (i64.const "coproc"))
      (then (return (enum.get $Token.keyword))))
    (enum.get $Token.variable))

  ;; `$` ends a word so a glued expansion still lexes as one: `abc$def` is the
  ;; word `abc` followed by `$def`, and `pre${VAR}post` keeps `${` together.
  (func $bashIsWordChar (param $c i32) (result i32)
    (i32.and
      (i32.ne (local.get $c) (i32.const "$"))
      (i32.or
        (call $lexIsIdentContinue (local.get $c))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "-"))
                  (i32.eq (local.get $c) (i32.const "/")))
          (i32.eq (local.get $c) (i32.const "."))))))

  ;; `$@`, `$*`, `$#`, `$?`, `$!`, `$-` and `$1`..`$9`. A `$` before anything
  ;; else - a quote, a space, end of input - is a literal dollar sign.
  (func $bashIsSpecialParam (param $c i32) (result i32)
    (i32.or
      (call $lexIsDigit (local.get $c))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "@"))
                (i32.eq (local.get $c) (i32.const "*")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "#"))
                  (i32.eq (local.get $c) (i32.const "?")))
          (i32.or (i32.eq (local.get $c) (i32.const "!"))
                  (i32.eq (local.get $c) (i32.const "-")))))))

  (func $bashScanWord
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.eqz (call $bashIsWordChar (i32.load8_u (global.get $ptr)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  (func $bashHasNl (param $lhs i32) (param $rhs i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (if (i32.or
              (i32.eq (i32.load8_u (local.get $lhs)) (i32.const 10))
              (i32.eq (i32.load8_u (local.get $lhs)) (i32.const 13)))
          (then (return (i32.const 1))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; Emit a parameter expansion beginning at `$`. In a double-quoted string,
  ;; command substitutions are kept together so the quote remains owned by the
  ;; outer lexer; unquoted substitutions return after their opener.
  (func $bashDollar (param $quoted i32)
    (local $c i32)
    (local $close i32)
    (local $depth i32)
    (local $lhs i32)
    (local $seg i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then
        (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
        (return)))
    (local.set $c (i32.load8_u (global.get $ptr)))
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (block $braceDone
          (loop $brace
            (br_if $braceDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (br_if $braceDone (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "}")))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $brace)))
        (call $emitTok (enum.get $Token.variable) (local.get $seg) (global.get $ptr))
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (local.set $seg (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))))
        (return)))
    (if (i32.eq (local.get $c) (i32.const "("))
      (then
        (local.set $close (i32.const 1))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.and
              (i32.lt_u (global.get $ptr) (global.get $end))
              (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "(")))
          (then
            (local.set $close (i32.const 2))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (if (i32.eqz (local.get $quoted))
          (then
            (if (i32.eq (local.get $close) (i32.const 2))
              (then (global.set $bashArith (i32.add (global.get $bashArith) (i32.const 1)))))
            (return)))
        (local.set $seg (global.get $ptr))
        (local.set $depth (local.get $close))
        (block $subDone
          (loop $sub
            (br_if $subDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (if (i32.eqz (local.get $depth)) (then (br $subDone)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $sub)))
        (call $emitTok (enum.get $Token.string.special) (local.get $seg) (global.get $ptr))
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (local.set $seg (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))))
        (return)))
    (if (i32.and (call $lexIsIdentStart (local.get $c))
                 (i32.ne (local.get $c) (i32.const "$")))
      (then (call $scanIdentRun (i32.const 0)))
      (else
        (if (i32.or (i32.eq (local.get $c) (i32.const "$"))
                    (call $bashIsSpecialParam (local.get $c)))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
    (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr)))

  (func $bashDouble
    (local $c i32)
    (local $e i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const 92))
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
            (local.set $seg (global.get $ptr))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (call $bashDollar (i32.const 1))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  (func $bashRangeEq (param $a i32) (param $b i32) (param $n i32) (result i32)
    (local $i i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.ne
              (i32.load8_u (i32.add (local.get $a) (local.get $i)))
              (i32.load8_u (i32.add (local.get $b) (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; Consume a simple here-document. Delimiters may be bare or quoted; `<<-`
  ;; permits leading tabs on the closing line.
  (func $bashHeredoc (result i32)
    (local $body i32)
    (local $c i32)
    (local $delim i32)
    (local $delimEnd i32)
    (local $gap i32)
    (local $lhs i32)
    (local $line i32)
    (local $n i32)
    (local $quote i32)
    (local $strip i32)
    (if (i32.or
          (i32.ge_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (i32.ne (i32.load16_u (global.get $ptr)) (i32.const "<<")))
      (then (return (i32.const 0))))
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (if (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "-")))
      (then
        (local.set $strip (i32.const 1))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
    (local.set $gap (global.get $ptr))
    (block $spaceDone
      (loop $space
        (br_if $spaceDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $spaceDone (i32.and (i32.ne (local.get $c) (i32.const 32))
                                   (i32.ne (local.get $c) (i32.const 9))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $space)))
    (call $emitGap (local.get $gap) (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then (return (i32.const 1))))
    (local.set $lhs (global.get $ptr))
    (local.set $quote (i32.load8_u (global.get $ptr)))
    (if (i32.or (i32.eq (local.get $quote) (i32.const 34))
                (i32.eq (local.get $quote) (i32.const 39)))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $delim (global.get $ptr))
        (block $quotedDone
          (loop $quoted
            (br_if $quotedDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (br_if $quotedDone (i32.eq (i32.load8_u (global.get $ptr)) (local.get $quote)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $quoted)))
        (local.set $delimEnd (global.get $ptr))
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
      (else
        (local.set $delim (global.get $ptr))
        (block $bareDone
          (loop $bare
            (br_if $bareDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $bareDone (call $lexIsSpace (local.get $c)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $bare)))
        (local.set $delimEnd (global.get $ptr))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (local.set $n (i32.sub (local.get $delimEnd) (local.get $delim)))
    (local.set $gap (global.get $ptr))
    (call $scanToLineEnd)
    (if (i32.lt_u (global.get $ptr) (global.get $end))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.and
              (i32.eq
                (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))
                (i32.const 13))
              (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                       (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 10))))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
    (call $emitGap (local.get $gap) (global.get $ptr))
    (local.set $body (global.get $ptr))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $line (global.get $ptr))
        (if (local.get $strip)
          (then
            (block $tabsDone
              (loop $tabs
                (br_if $tabsDone (i32.ge_u (local.get $line) (global.get $end)))
                (br_if $tabsDone (i32.ne (i32.load8_u (local.get $line)) (i32.const 9)))
                (local.set $line (i32.add (local.get $line) (i32.const 1)))
                (br $tabs)))))
        (if (i32.and
              (i32.le_u (i32.add (local.get $line) (local.get $n)) (global.get $end))
              (i32.and
                (call $bashRangeEq (local.get $line) (local.get $delim) (local.get $n))
                (i32.or
                  (i32.eq (i32.add (local.get $line) (local.get $n)) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (i32.add (local.get $line) (local.get $n))) (i32.const 10))
                    (i32.eq (i32.load8_u (i32.add (local.get $line) (local.get $n))) (i32.const 13))))))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $scanToLineEnd)
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (return (i32.const 1))))
        (call $scanToLineEnd)
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br $lines)))
    (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $ptr))
    (call $streamSetLine
      (local.get $delim) (local.get $n) (local.get $strip) (i32.const 0)
      (enum.get $Token.string))
    (i32.const 1))

  (func $bashIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))
        (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c) (i32.const "<"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "~"))))))

  (func $hlBash
    (local $c i32)
    (local $c2 i32)
    (local $cmd i32)
    (local $decl i32)
    (local $gap i32)
    (local $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local $rhs i32)
    (call $lexEmitLeadingContinuation)
    (global.set $bashArith (i32.const 0))
    (local.set $cmd (i32.const 1))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $lexScanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (if (call $bashHasNl (local.get $gap) (global.get $ptr))
          (then (local.set $cmd (i32.const 1))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        (if (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.or (local.get $cmd)
                      (i32.lt_u (local.get $gap) (global.get $ptr))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexRawString (i32.const 39) (i32.const 1) (enum.get $Token.string))
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $bashDouble)
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexString (i32.const "`") (i32.const 1) (enum.get $Token.string.special))
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (if (i32.eq (local.get $c2) (i32.const 39))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (call $lexString (i32.const 39) (i32.const 1) (enum.get $Token.string))
                (local.set $cmd (i32.const 0))
                (br $next)))
            (call $bashDollar (i32.const 0))
            (local.set $cmd (i32.const 0))
            (br $next)))
        ;; `<<` opens a heredoc only as a redirection: `<<<` is a here-string and
        ;; a `<<` inside `$(( ))` is a left shift, and both fall through to the
        ;; operator path instead.
        (if (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const "<"))
                       (i32.eq (local.get $c2) (i32.const "<")))
              (i32.and
                (i32.eqz (global.get $bashArith))
                (i32.or
                  (i32.ge_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (i32.ne (i32.load8_u offset=2 (global.get $ptr)) (i32.const "<")))))
          (then
            (if (call $bashHeredoc)
              (then
                (local.set $cmd (i32.const 1))
                (br $next)))))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $bashScanWord)
            (local.set $rhs (global.get $ptr))
            (local.set $hl (call $bashWordHl (local.get $lhs) (local.get $rhs)))
            (if (local.get $decl)
              (then
                (local.set $hl (enum.get $Token.function.definition))
                (local.set $decl (i32.const 0)))
              (else
                (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (then
                    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                    (if (i32.and
                          (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                          (i32.eq (i32.load16_u (local.get $p)) (i32.const "()")))
                      (then (local.set $hl (enum.get $Token.function.definition)))
                      (else
                        (if (i32.and (local.get $cmd)
                                     (i32.or
                                       (i32.ge_u (global.get $ptr) (global.get $end))
                                       (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "="))))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            (if (i32.and
                  (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                  (call $bashWordEq (local.get $lhs) (local.get $rhs) (i32.const 8) (i64.const "function")))
              (then (local.set $decl (i32.const 1))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (if (i32.or
                  (i32.eq (local.get $hl) (enum.get $Token.keyword.control))
                  (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration)))
              (then (local.set $cmd (i32.const 1)))
              (else (local.set $cmd (i32.const 0))))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            ;; `[[`/`]]` double only when the second bracket is inside the range:
            ;; a bounded scan must never emit a byte the host still owns.
            (if (i32.and
                  (i32.or (i32.eq (local.get $c) (i32.const "["))
                          (i32.eq (local.get $c) (i32.const "]")))
                  (i32.and
                    (i32.lt_u (global.get $ptr) (global.get $end))
                    (i32.eq (i32.load8_u (global.get $ptr)) (local.get $c))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            ;; `))` closes the innermost `$((` we counted
            (if (i32.and
                  (i32.and (global.get $bashArith)
                           (i32.eq (local.get $c) (i32.const ")")))
                  (i32.and
                    (i32.lt_u (global.get $ptr) (global.get $end))
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ")"))))
              (then (global.set $bashArith (i32.sub (global.get $bashArith) (i32.const 1)))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $bashIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.eq (local.get $c) (local.get $c2))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.eq (i32.load8_u (global.get $ptr)) (local.get $c)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (if (i32.or
                  (i32.eq (local.get $c) (i32.const ";"))
                  (i32.or (i32.eq (local.get $c) (i32.const "&"))
                          (i32.eq (local.get $c) (i32.const "|"))))
              (then (local.set $cmd (i32.const 1))))
            (br $next)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $cmd (i32.const 0))
        (br $next))))
)
