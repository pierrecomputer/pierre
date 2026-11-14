(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.terraformWords 96)

  (import "@pierre/wat-tools/common.wat")

  ;; group order is the dispatch order in $hlTerraform's identifier branch
  (keyword-table $tfWords $mem.terraformWords $mem.terraformWords+96
    (group "if" "in" "for" "else" "endif" "endfor") ;; 1: template and for-expression keywords
    (group "true" "false")                          ;; 2: booleans
    (group "null")                                  ;; 3: built-in constant
    (group ;; 4: type constructors
      "any" "map" "set" "bool" "list" "tuple" "number" "object" "string" "optional")
    (group ;; 5: the roots of the built-in references, `var.x` and friends
      "var" "data" "each" "path" "self" "count" "local" "module" "terraform"))

  ;; Scan a quoted template body from $ptr with the string's bytes since
  ;; $seg still unemitted. Returns 1 past the closing quote, 2 past a `${`
  ;; or `%{` that opens an interpolation or directive - emitted as
  ;; punctuation.special, the caller lexes the expression - 3 when an
  ;; escaped line break ends exactly at $end, and 0 at $end or at a raw line
  ;; break. `$${` and `%%{` are literal. $nested is nonzero inside an
  ;; interpolation, where a nested string keeps its markers plain so one
  ;; brace depth suffices.
  (func $tfStringBody (param $nested i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $stop i32)
    (local $mark i32)
    (local $status i32)
    (local.set $stop (global.get $ptr))
    (local.set $mark (global.get $ptr))
    (block $done
      (loop $scan
        ;; the next quote, backslash, or line break and the next `$` or `%`
        ;; before it are each found with one SIMD hop and rescanned only
        ;; once $ptr passes them
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (i32.const 34)
                (i32.const 1)
                (i32.const 1)))
            (local.set $mark (i32.const 0))))
        ;; the `$`/`%` search stops at $stop, so each byte is scanned once
        (if (i32.gt_u (global.get $ptr) (local.get $mark))
          (then
            (local.set $c (global.get $end))
            (global.set $end (local.get $stop))
            (local.set $mark
              (call $lexFindEither (global.get $ptr) (i32.const "$") (i32.const "%")))
            (global.set $end (local.get $c))))
        (global.set $ptr
          (select
            (local.get $mark)
            (local.get $stop)
            (i32.lt_u (local.get $mark) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (br_if $done
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (if (call $stringEscapeAt (local.get $seg))
              (then (local.set $status (i32.const 3))))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; `$` or `%`: doubled before a brace it is literal, otherwise a
        ;; brace opens an interpolation
        (if
          (i32.and
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $c))
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "{")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (br $scan)))
        (if
          (i32.and
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{"))
            (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok
              (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2))
              (global.get $ptr))
            (return (i32.const 2))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; Returns 4 when a pending opener's line has more than blanks, 0 past the
  ;; delimiter, 1 past a `${` or `%{` (the caller lexes it), and at $end 2 at
  ;; a line start or 3 inside a line. Kept out of $hlTerraform for its speed.
  (func $tfHeredoc (param $hdLen i32) (param $delim i32) (result i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $rhs i32)
    (local $c i32)
    (local $c2 i32)
    (local $e i32)
    (if (i32.eqz (i32.and (local.get $hdLen) (i32.const 2)))
      (then
        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
        (local.set $c (call $templateByte (local.get $p)))
        (if (i32.and (i32.ne (local.get $c) (i32.const 10)) (i32.ne (local.get $c) (i32.const 13)))
          (then (return (i32.const 4))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 13))
            (i32.eq (call $templateByte (local.get $p)) (i32.const 10)))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (call $emitGap (global.get $ptr) (local.get $p))
        (global.set $ptr (local.get $p))
        (local.set $hdLen (i32.or (local.get $hdLen) (i32.const 2)))))
    (local.set $lhs (global.get $ptr))
    (block $stop
      (loop $line
        (br_if $stop (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eqz (i32.and (local.get $hdLen) (i32.const 4)))
          (then
            (local.set $p (global.get $ptr))
            (if (i32.and (local.get $hdLen) (i32.const 1))
              (then (local.set $p (call $lexSkipSpaceAt (local.get $p)))))
            (local.set $rhs (i32.add (local.get $p) (i32.shr_u (local.get $hdLen) (i32.const 3))))
            (if (i32.le_u (local.get $rhs) (global.get $end))
              (then
                (local.set $q (local.get $delim))
                (block $cmpDone
                  (loop $cmp
                    (br_if $cmpDone (i32.ge_u (local.get $p) (local.get $rhs)))
                    (br_if $cmpDone (i32.ne (i32.load8_u (local.get $p)) (i32.load8_u (local.get $q))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $cmp)))
                (if
                  (i32.and
                    (i32.eq (local.get $p) (local.get $rhs))
                    (call $lineDelimiterEnds (local.get $rhs) (i32.const 0)))
                  (then
                    (global.set $ptr (local.get $rhs))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    (return (i32.const 0))))))
            (local.set $hdLen (i32.or (local.get $hdLen) (i32.const 4)))))
        (local.set $p (global.get $ptr))
        (call $scanToLineEnd)
        (local.set $rhs (global.get $ptr))
        (global.set $ptr (local.get $p))
        (block $lineDone
          (loop $marks
            (local.set $e (global.get $end))
            (global.set $end (local.get $rhs))
            (global.set $ptr (call $lexFindEither (global.get $ptr) (i32.const "$") (i32.const "%")))
            (global.set $end (local.get $e))
            (br_if $lineDone (i32.ge_u (global.get $ptr) (local.get $rhs)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
            (if
              (i32.and
                (i32.eq (local.get $c2) (local.get $c))
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "{")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (br $marks)))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok
                  (enum.get $Token.punctuation.special)
                  (i32.sub (global.get $ptr) (i32.const 2))
                  (global.get $ptr))
                (return (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $marks)))
        (global.set $ptr (local.get $rhs))
        (br_if $stop (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 13))
            (i32.eq (call $templateByte (global.get $ptr)) (i32.const 10)))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $hdLen (i32.and (local.get $hdLen) (i32.const -5)))
        (br $line)))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (i32.add (i32.const 2) (i32.and (i32.shr_u (local.get $hdLen) (i32.const 2)) (i32.const 1))))

  (func $tfIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>?|~" (local.get $c)))

  ;; $seg is nonzero while a quoted template body is open: the start of its
  ;; bytes not yet emitted, or 1 across a chunk boundary, where the body
  ;; resumes at the chunk start. $interp counts braces inside a `${` or
  ;; `%{`. A heredoc opener leaves $hdLen (the delimiter length times 8, plus
  ;; 1 for `<<-`, 2 in the body, 4 past a body line start) and $hdDelim, in
  ;; $mem.streamDelimiter so the body can span chunks.
  ;; $lineHead is 1 until the first token of a line: a name there is a block
  ;; type unless `=` follows. $member is 1 after `.`. All are checkpointed.
  (func $hlTerraform
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $pc i32)
    (local $g i32)
    (local $hl i32)
    (local $member i32)
    (local $lineHead i32)
    (local $atHead i32)
    (local $seg i32)
    (local $interp i32)
    (local $status i32)
    (local $hdLen i32)
    (local $hdDelim i32)
    (local $hdStrip i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; token tails: $tok ends a member access, then $emit emits
        ;; [$lhs,$ptr) as $hl
        (block $emit
        (block $tok
        (local.set $gap (global.get $ptr))
        (if (local.get $hdLen)
          (then
            ;; a quote left open on the opener's line ends at its break first
            (if (i32.eqz (i32.or (local.get $seg) (local.get $interp)))
              (then
                (local.set $status (call $tfHeredoc (local.get $hdLen) (local.get $hdDelim)))
                (if (i32.ne (local.get $status) (i32.const 4))
                  (then
                    (if (i32.eqz (local.get $status))
                      (then
                        (local.set $hdLen (i32.const 0))
                        (br $next)))
                    (local.set $hdLen
                      (i32.or
                        (i32.or (i32.and (local.get $hdLen) (i32.const -5)) (i32.const 2))
                        (i32.shl (i32.and (local.get $status) (i32.const 1)) (i32.const 2))))
                    (if (i32.eq (local.get $status) (i32.const 1))
                      (then
                        (local.set $interp (i32.const 1))
                        (br $next)))
                    (br $done)))))))

        ;; an open quoted template
        (if (local.get $seg)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 1))
                (br $done)))
            (if (i32.eq (local.get $seg) (i32.const 1))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $tfStringBody (local.get $interp) (local.get $seg)))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then (local.set $interp (i32.const 1))))
            ;; closed, opened an interpolation, or cut by a raw line break;
            ;; only an escaped line break at $end keeps the body open for the
            ;; next chunk
            (local.set $seg
              (select (global.get $ptr) (i32.const 0) (i32.eq (local.get $status) (i32.const 3))))
            (br $next)))

        (call $scanWhitespace)
        (if
          (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            ;; a line break without a body - the opener was the final line
            ;; of a bounded range - drops the pending heredoc
            (if (i32.eqz (i32.and (local.get $hdLen) (i32.const 2)))
              (then (local.set $hdLen (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (local.get $c2) (i32.const "/"))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))

        ;; a quoted template opener; its body is scanned at the top of the loop
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $hl (enum.get $Token.string))
            (local.set $seg (global.get $ptr))
            (br $tok)))

        ;; `<<EOF` / `<<-EOF`: the opener is a string and the body follows
        ;; the line break
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
          (then
            (local.set $hdStrip (i32.eq (local.get $c3) (i32.const "-")))
            (if
              (i32.and
                (i32.eqz (local.get $interp))
                (call $lexIsIdentStart
                  (select
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 3)))
                    (local.get $c3)
                    (local.get $hdStrip))))
              (then
                (global.set $ptr
                  (i32.add (global.get $ptr) (i32.add (i32.const 2) (local.get $hdStrip))))
                (local.set $hdDelim (global.get $ptr))
                (call $lexScanIdent)
                (local.set $hdLen
                  (i32.or
                    (i32.shl (i32.sub (global.get $ptr) (local.get $hdDelim)) (i32.const 3))
                    (local.get $hdStrip)))
                ;; only a delimiter of up to 32 bytes survives a chunk break
                (if (i32.le_u (local.get $hdLen) (i32.const 263))
                  (then
                    (memory.copy
                      (i32.const $mem.streamDelimiter)
                      (local.get $hdDelim)
                      (i32.shr_u (local.get $hdLen) (i32.const 3)))
                    (local.set $hdDelim (i32.const $mem.streamDelimiter))))
                (local.set $hl (enum.get $Token.string))
                (br $tok)))))

        ;; `$` is not an identifier byte here: a stray one is plain text
        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            (call $scanIdentRun (i32.const "-"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $templateByte (local.get $p)))
            (local.set $g
              (select
                (i32.const 0)
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
                        (if
                          (i32.and
                            (i32.eq (local.get $g) (i32.const 4))
                            (i32.ne (local.get $pc) (i32.const "=")))
                          (then (local.set $hl (enum.get $Token.type.builtin)))
                          (else
                            (if
                              (i32.and
                                (i32.eq (local.get $g) (i32.const 5))
                                (i32.eq (local.get $pc) (i32.const ".")))
                              (then (local.set $hl (enum.get $Token.variable.special)))
                              (else
                                (if (local.get $member)
                                  (then (local.set $hl (enum.get $Token.property)))
                                  (else
                                    (if
                                      (i32.and
                                        (i32.eq (local.get $pc) (i32.const "="))
                                        (i32.ne
                                          (call $templateByte (i32.add (local.get $p) (i32.const 1)))
                                          (i32.const "=")))
                                      (then (local.set $hl (enum.get $Token.property)))
                                      (else
                                        (if (i32.eq (local.get $pc) (i32.const "("))
                                          (then (local.set $hl (enum.get $Token.function)))
                                          (else
                                            ;; a name opening a line before a label,
                                            ;; a brace, or another name is a block type
                                            (local.set $hl (enum.get $Token.variable))
                                            (if (local.get $atHead)
                                              (then
                                                (if
                                                  (i32.or
                                                    (i32.or
                                                      (i32.eq
                                                        (local.get $pc)
                                                        (i32.const 34))
                                                      (i32.eq
                                                        (local.get $pc)
                                                        (i32.const "{")))
                                                    (call $lexIsIdentStart
                                                      (local.get $pc)))
                                                  (then
                                                    (local.set $hl
                                                      (enum.get $Token.keyword.declaration))))))))))))))))))))))
            (br $tok)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (local.set $hl (enum.get $Token.number))
            (br $tok)))

        (if (byteset.get "()[]{}" (local.get $c))
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
                        (local.set $hl (enum.get $Token.punctuation.special))
                        (if (i32.eqz (i32.and (local.get $hdLen) (i32.const 2)))
                          (then (local.set $seg (global.get $ptr))))
                        (br $tok)))))))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (br $tok)))
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
            (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (br $tok)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (select
                  (i32.const 3)
                  (i32.const 1)
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "."))
                    (i32.eq (local.get $c3) (i32.const "."))))))
            (local.set $hl
              (select
                (enum.get $Token.operator)
                (enum.get $Token.punctuation.delimiter)
                (i32.eq (local.get $c2) (i32.const "."))))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (br $emit)))

        (if (call $tfIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.or
                (i32.eq (local.get $c2) (i32.const "="))
                (i32.or
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "="))
                    (i32.eq (local.get $c2) (i32.const ">")))
                  (i32.and
                    (i32.eq (local.get $c) (local.get $c2))
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "&"))
                      (i32.eq (local.get $c) (i32.const "|"))))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $hl (enum.get $Token.operator))
            (br $tok)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $hl (enum.get $Token.none)))
        (local.set $member (i32.const 0)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
