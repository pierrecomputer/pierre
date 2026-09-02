(module
  (import "../common.wat")

  (func $tfByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; group order is the dispatch order in $hlTerraform's identifier branch
  (keyword-table $tfWords $mem.terraformWords $mem.terraformWords+384 16 64
    (group "if" "in" "for" "else" "endif" "endfor") ;; 1: template and for-expression keywords
    (group "true" "false")                          ;; 2: booleans
    (group "null")                                  ;; 3: built-in constant
    (group ;; 4: type constructors
      "any" "map" "set" "bool" "list" "tuple" "number" "object" "string"
      "optional")
    (group ;; 5: the roots of the built-in references, `var.x` and friends
      "var" "data" "each" "path" "self" "count" "local" "module"
      "terraform"))

  ;; Scan a quoted template body from $ptr with the string's bytes since
  ;; $seg still unemitted. Returns 1 past the closing quote, 2 past a `${`
  ;; or `%{` that opens an interpolation or directive - emitted as
  ;; punctuation.special, the caller lexes the expression - 3 when an
  ;; escaped line break ends exactly at $end, and 0 at $end or at a raw line
  ;; break. `$${` and `%%{` are literal. $nested is nonzero inside an
  ;; interpolation, where a nested string keeps its markers plain so one
  ;; brace depth suffices.
  (func $tfStringBody (param $nested i32) (param $seg i32) (result i32)
    (local $c i32) (local $e i32) (local $stop i32) (local $mark i32) (local $status i32)
    (local.set $stop (global.get $ptr))
    (local.set $mark (global.get $ptr))
    (block $done
      (loop $scan
        ;; the next quote, backslash, or line break and the next `$` or `%`
        ;; before it are each found with one SIMD hop and rescanned only
        ;; once $ptr passes them
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 1)))
            (local.set $mark (call $lexFindEither (global.get $ptr) (i32.const "$") (i32.const "%"))))
          (else
            (if (i32.gt_u (global.get $ptr) (local.get $mark))
              (then (local.set $mark (call $lexFindEither
                (global.get $ptr) (i32.const "$") (i32.const "%")))))))
        (global.set $ptr (select (local.get $mark) (local.get $stop)
          (i32.lt_u (local.get $mark) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (if (i32.and
                  (i32.eq (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
                    (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13))))
              (then (local.set $status (i32.const 3))))
            (br $scan)))
        ;; `$` or `%`: doubled before a brace it is literal, otherwise a
        ;; brace opens an interpolation
        (if (i32.and
              (i32.eq (call $tfByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $c))
              (i32.eq (call $tfByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "{")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (br $scan)))
        (if (i32.and
              (i32.eq (call $tfByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{"))
              (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.const 2))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  (func $tfRangeEq (param $a i32) (param $b i32) (param $n i32) (result i32)
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

  ;; Consume the body of a heredoc from $ptr, the start of the line after
  ;; its opener, through the line holding the $n-byte delimiter at $delim;
  ;; `$strip` permits leading blanks on that line (`<<-`). An unterminated
  ;; body runs to $end and, in streaming, checkpoints the delimiter so the
  ;; next chunk keeps looking for it.
  (func $tfHeredocBody (param $delim i32) (param $n i32) (param $strip i32)
    (local $body i32)
    (local $lhs i32)
    (local $line i32)
    (local.set $body (global.get $ptr))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $line (global.get $ptr))
        (if (local.get $strip)
          (then (local.set $line (call $lexSkipSpaceAt (local.get $line)))))
        (if (i32.and
              (i32.le_u (i32.add (local.get $line) (local.get $n)) (global.get $end))
              (i32.and
                (call $tfRangeEq (local.get $line) (local.get $delim) (local.get $n))
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
            (return)))
        (call $scanToLineEnd)
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br $lines)))
    (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $ptr))
    (call $streamSetLine
      (local.get $delim) (local.get $n) (i32.shl (local.get $strip) (i32.const 1))
      (enum.get $Token.string)))

  (func $tfIsOp (param $c i32) (result i32)
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
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "?")))
              (i32.eq (local.get $c) (i32.const "~"))))))))

  ;; $strOpen is 1 while a quoted template body is open, with $seg the start
  ;; of its bytes not yet emitted; $interp counts braces inside a `${` or
  ;; `%{`. A heredoc opener leaves $hdLen, $hdDelim, and $hdStrip pending
  ;; until the line break, after which its body runs to the delimiter line.
  ;; $lineHead is 1 until the first token of a line: a name there is a block
  ;; type unless `=` follows. $member is 1 after `.`. All are checkpointed.
  (func $hlTerraform
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $g i32) (local $hl i32) (local $member i32) (local $lineHead i32)
    (local $atHead i32) (local $strOpen i32) (local $seg i32) (local $interp i32)
    (local $status i32) (local $hdLen i32) (local $hdDelim i32) (local $hdStrip i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (if (local.get $hdLen)
          (then
            ;; the pending heredoc body starts after this line's break, so
            ;; skip blanks only and consume just the LF or CRLF
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 10))
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 13))))
              (then
                (local.set $c (i32.load8_u (global.get $ptr)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const 13))
                      (i32.eq (call $tfByte (global.get $ptr)) (i32.const 10)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitGap (local.get $gap) (global.get $ptr))
                (call $tfHeredocBody (local.get $hdDelim) (local.get $hdLen) (local.get $hdStrip))
                (local.set $hdLen (i32.const 0))
                (local.set $lineHead (i32.const 1))
                (br $next)))))

        ;; an open quoted template; $seg is zero across a chunk boundary,
        ;; where the body resumes at the chunk start
        (if (local.get $strOpen)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $tfStringBody (local.get $interp) (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $interp (i32.const 1))
                (local.set $strOpen (i32.const 0))
                (local.set $seg (i32.const 0)))
              (else
                ;; closed, or cut by a raw line break; only an escaped line
                ;; break at $end keeps the body open for the next chunk
                (if (i32.ne (local.get $status) (i32.const 3))
                  (then
                    (local.set $strOpen (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (call $scanWhitespace)
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            ;; a line break without a body - the opener was the final line
            ;; of a bounded range - drops the pending heredoc
            (local.set $hdLen (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $tfByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $tfByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/"))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))

        ;; a quoted template opener; its body is scanned at the top of the loop
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strOpen (i32.const 1))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `<<EOF` / `<<-EOF`: the opener is a string and the body follows
        ;; the line break
        (if (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
              (i32.or
                (call $lexIsIdentStart (local.get $c3))
                (i32.and
                  (i32.eq (local.get $c3) (i32.const "-"))
                  (call $lexIsIdentStart (call $tfByte (i32.add (global.get $ptr) (i32.const 3)))))))
          (then
            (local.set $hdStrip (i32.eq (local.get $c3) (i32.const "-")))
            (global.set $ptr (i32.add (global.get $ptr) (i32.add (i32.const 2) (local.get $hdStrip))))
            (local.set $hdDelim (global.get $ptr))
            (call $lexScanIdent)
            (local.set $hdLen (i32.sub (global.get $ptr) (local.get $hdDelim)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `$` is not an identifier byte here: a stray one is plain text
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "-"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $g (select (i32.const 0)
              (keyword-table.get $tfWords (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.eq (local.get $g) (i32.const 1))
              (then (local.set $hl (enum.get $Token.keyword.control)))
              (else
                (if (i32.eq (local.get $g) (i32.const 2))
                  (then (local.set $hl (enum.get $Token.boolean)))
                  (else
                    (if (i32.eq (local.get $g) (i32.const 3))
                      (then (local.set $hl (enum.get $Token.constant.builtin)))
                      (else
                        (if (i32.and
                              (i32.eq (local.get $g) (i32.const 4))
                              (i32.ne (call $tfByte (local.get $p)) (i32.const "=")))
                          (then (local.set $hl (enum.get $Token.type.builtin)))
                          (else
                            (if (i32.and
                                  (i32.eq (local.get $g) (i32.const 5))
                                  (i32.eq (call $tfByte (local.get $p)) (i32.const ".")))
                              (then (local.set $hl (enum.get $Token.variable.special)))
                              (else
                                (if (local.get $member)
                                  (then (local.set $hl (enum.get $Token.property)))
                                  (else
                                    (if (i32.and
                                          (i32.eq (call $tfByte (local.get $p)) (i32.const "="))
                                          (i32.ne (call $tfByte (i32.add (local.get $p) (i32.const 1))) (i32.const "=")))
                                      (then (local.set $hl (enum.get $Token.property)))
                                      (else
                                        (if (i32.eq (call $tfByte (local.get $p)) (i32.const "("))
                                          (then (local.set $hl (enum.get $Token.function)))
                                          (else
                                            ;; a name opening a line before a label,
                                            ;; a brace, or another name is a block type
                                            (if (i32.and
                                                  (local.get $atHead)
                                                  (i32.or
                                                    (i32.or
                                                      (i32.eq (call $tfByte (local.get $p)) (i32.const 34))
                                                      (i32.eq (call $tfByte (local.get $p)) (i32.const "{")))
                                                    (call $lexIsIdentStart (call $tfByte (local.get $p)))))
                                              (then (local.set $hl (enum.get $Token.keyword.declaration)))
                                              (else (local.set $hl (enum.get $Token.variable))))))))))))))))))))
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
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the brace matching `${` returns to the template body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strOpen (i32.const 1))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 3) (i32.const 1)
              (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eq (local.get $c3) (i32.const "."))))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (br $next)))

        (if (call $tfIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or
                  (i32.eq (local.get $c2) (i32.const "="))
                  (i32.or
                    (i32.and (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c2) (i32.const ">")))
                    (i32.and (i32.eq (local.get $c) (local.get $c2))
                      (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|"))))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
