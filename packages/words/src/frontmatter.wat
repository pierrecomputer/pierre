(module
  (import "./memory.wat")
  (import "./scan.wat")
  (import "./out.wat")

  ;; A YAML frontmatter block is `---` on the first line, the document, and a
  ;; closing `---` or `...` line. It is converted to JSON in the output buffer
  ;; so the host can hand it straight to JSON.parse; the practical subset is
  ;; block mappings and sequences, flow collections, quoted and plain scalars,
  ;; block scalars, and comments.
  (global $ylBeg (mut i32) (i32.const 0))   ;; first non-space byte of the current line
  (global $ylEnd (mut i32) (i32.const 0))
  (global $ylIndent (mut i32) (i32.const 0))
  (global $ylValid (mut i32) (i32.const 0))
  (global $yNext (mut i32) (i32.const 0))   ;; start of the line after the current one
  (global $yEnd (mut i32) (i32.const 0))    ;; end of the frontmatter block
  (global $yDepth (mut i32) (i32.const 0))

  (func $lineAfter (param $end i32) (result i32)
    (i32.add (local.get $end)
      (select
        (i32.add (i32.const 1)
          (i32.eq (i32.load16_u (local.get $end)) (i32.const 0x0a0d)))
        (i32.const 0)
        (i32.lt_u (local.get $end) (global.get $eof)))))

  ;; load the next content line, skipping blanks and comments
  (func $yTakeLine
    (local $p i32)
    (local $e i32)
    (global.set $ylValid (i32.const 0))
    (block $done
      (loop $l
        (local.set $p (global.get $yNext))
        (br_if $done (i32.ge_u (local.get $p) (global.get $yEnd)))
        (local.set $e (call $findLineEnd (local.get $p)))
        (if (i32.gt_u (local.get $e) (global.get $yEnd)) (then (local.set $e (global.get $yEnd))))
        (global.set $yNext (call $lineAfter (local.get $e)))
        (global.set $ylBeg (call $skipSpace (local.get $p) (local.get $e)))
        (global.set $ylIndent (i32.sub (global.get $ylBeg) (local.get $p)))
        (global.set $ylEnd (call $trimSpaceBack (local.get $e) (global.get $ylBeg)))
        (br_if $l (i32.ge_u (global.get $ylBeg) (global.get $ylEnd)))
        (br_if $l (i32.eq (i32.load8_u (global.get $ylBeg)) (i32.const "#")))
        (global.set $ylValid (i32.const 1))
        (br $done))))

  (func $yParseNode
    (if (i32.eqz (global.get $ylValid))
      (then (out.str "null"))
      (else
        (if (call $yIsSeqItem)
          (then (call $yParseSeq (global.get $ylIndent)))
          (else (call $yParseMap (global.get $ylIndent)))))))

  (func $yIsSeqItem (result i32)
    (if (i32.ne (i32.load8_u (global.get $ylBeg)) (i32.const "-")) (then (return (i32.const 0))))
    (if (i32.eq (i32.add (global.get $ylBeg) (i32.const 1)) (global.get $ylEnd))
      (then (return (i32.const 1))))
    (call $isSpaceByte (i32.load8_u offset=1 (global.get $ylBeg))))

  (func $yParseSeq (param $indent i32)
    (local $first i32)
    (local $rest i32)
    (local $col i32)
    (if (i32.gt_u (global.get $yDepth) (i32.const 32))
      (then (out.str "null") (return)))
    (global.set $yDepth (i32.add (global.get $yDepth) (i32.const 1)))
    (call $outByte (i32.const "["))
    (local.set $first (i32.const 1))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (global.get $ylValid)))
        (br_if $done (i32.ne (global.get $ylIndent) (local.get $indent)))
        (br_if $done (i32.eqz (call $yIsSeqItem)))
        (if (local.get $first)
          (then (local.set $first (i32.const 0)))
          (else (call $outByte (i32.const ","))))
        (local.set $rest (call $skipSpace
          (i32.add (global.get $ylBeg) (i32.const 1)) (global.get $ylEnd)))
        (if (i32.ge_u (local.get $rest) (global.get $ylEnd))
          (then
            ;; the item's content starts on the following lines
            (call $yTakeLine)
            (if (i32.and (global.get $ylValid) (i32.gt_u (global.get $ylIndent) (local.get $indent)))
              (then (call $yParseNode))
              (else (out.str "null"))))
          (else
            ;; The item is a scalar or a nested map/sequence starting here.
            (block $inlineDone
              (local.set $col (i32.add (local.get $indent)
                (i32.sub (local.get $rest) (global.get $ylBeg))))
              (global.set $ylBeg (local.get $rest))
              (global.set $ylIndent (local.get $col))
              (if (call $yFindColon (local.get $rest) (global.get $ylEnd))
                (then
                  (call $yParseMap (local.get $col))
                  (br $inlineDone)))
              (if (call $yIsSeqItem)
                (then
                  (call $yParseSeq (local.get $col))
                  (br $inlineDone)))
              (call $yValue (local.get $rest) (global.get $ylEnd))
              (call $yTakeLine))))
        (br $l)))
    (call $outByte (i32.const "]"))
    (global.set $yDepth (i32.sub (global.get $yDepth) (i32.const 1))))

  (func $yParseMap (param $indent i32)
    (local $first i32)
    (local $colon i32)
    (local $rest i32)
    (local $scalarP i32)
    (local $scalarC i32)
    (local $scalarFold i32)
    (local $scalarChomp i32)
    (local $scalarBase i32)
    (local $scalarText i32)
    (local $scalarFirst i32)
    (local $scalarPending i32)
    (if (i32.gt_u (global.get $yDepth) (i32.const 32))
      (then (out.str "null") (return)))
    (global.set $yDepth (i32.add (global.get $yDepth) (i32.const 1)))
    (call $outByte (i32.const "{"))
    (local.set $first (i32.const 1))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (global.get $ylValid)))
        (br_if $done (i32.ne (global.get $ylIndent) (local.get $indent)))
        (br_if $done (call $yIsSeqItem))
        (local.set $colon (call $yFindColon (global.get $ylBeg) (global.get $ylEnd)))
        (br_if $done (i32.eqz (local.get $colon)))
        (if (local.get $first)
          (then (local.set $first (i32.const 0)))
          (else (call $outByte (i32.const ","))))
        (call $yString (global.get $ylBeg)
          (call $trimSpaceBack (local.get $colon) (global.get $ylBeg)))
        (call $outByte (i32.const ":"))
        (local.set $rest (call $skipSpace
          (i32.add (local.get $colon) (i32.const 1)) (global.get $ylEnd)))
        (if (i32.ge_u (local.get $rest) (global.get $ylEnd))
          (then
            (call $yTakeLine)
            (if (i32.and (global.get $ylValid) (i32.gt_u (global.get $ylIndent) (local.get $indent)))
              (then (call $yParseNode))
              (else (out.str "null"))))
          (else
            (local.set $scalarP (local.get $rest))
            (local.set $scalarC (i32.load8_u (local.get $scalarP)))
            (if (i32.or
                  (i32.eq (local.get $scalarC) (i32.const "|"))
                  (i32.eq (local.get $scalarC) (i32.const ">")))
              (then
                ;; Block scalar, with the usual folding and chomping rules.
                (local.set $scalarFold (i32.eq (local.get $scalarC) (i32.const ">")))
                (local.set $scalarChomp (i32.const 1))
                (local.set $scalarP (i32.add (local.get $scalarP) (i32.const 1)))
                (if (i32.lt_u (local.get $scalarP) (global.get $ylEnd))
                  (then
                    (local.set $scalarC (i32.load8_u (local.get $scalarP)))
                    (if (i32.eq (local.get $scalarC) (i32.const "-"))
                      (then (local.set $scalarChomp (i32.const 0))))
                    (if (i32.eq (local.get $scalarC) (i32.const "+"))
                      (then (local.set $scalarChomp (i32.const 2))))))
                (call $outByte (i32.const "\22"))
                (local.set $scalarBase (i32.const -1))
                (local.set $scalarFirst (i32.const 1))
                (local.set $scalarPending (i32.const 0))
                ;; Scalar lines are raw, so read them straight from $yNext.
                (block $scalarDone
                  (loop $scalar
                    (local.set $scalarP (global.get $yNext))
                    (br_if $scalarDone
                      (i32.ge_u (local.get $scalarP) (global.get $yEnd)))
                    (local.set $scalarC (call $findLineEnd (local.get $scalarP)))
                    (if (i32.gt_u (local.get $scalarC) (global.get $yEnd))
                      (then (local.set $scalarC (global.get $yEnd))))
                    (local.set $scalarText
                      (call $skipSpace (local.get $scalarP) (local.get $scalarC)))
                    (if (i32.ge_u (local.get $scalarText) (local.get $scalarC))
                      (then
                        (global.set $yNext (call $lineAfter (local.get $scalarC)))
                        (local.set $scalarPending
                          (i32.add (local.get $scalarPending) (i32.const 1)))
                        (br $scalar)))
                    (br_if $scalarDone
                      (i32.le_u
                        (i32.sub (local.get $scalarText) (local.get $scalarP))
                        (local.get $indent)))
                    (if (i32.lt_s (local.get $scalarBase) (i32.const 0))
                      (then
                        (local.set $scalarBase
                          (i32.sub (local.get $scalarText) (local.get $scalarP)))))
                    (global.set $yNext (call $lineAfter (local.get $scalarC)))
                    (if (i32.eqz (local.get $scalarFirst))
                      (then
                        (if (local.get $scalarPending)
                          (then
                            (block $pendingDone
                              (loop $pending
                                (br_if $pendingDone
                                  (i32.eqz (local.get $scalarPending)))
                                (out.str "\5cn")
                                (local.set $scalarPending
                                  (i32.sub (local.get $scalarPending) (i32.const 1)))
                                (br $pending))))
                          (else
                            (if (local.get $scalarFold)
                              (then (call $outByte (i32.const 32)))
                              (else (out.str "\5cn")))))))
                    (local.set $scalarFirst (i32.const 0))
                    (call $yEscaped
                      (i32.add (local.get $scalarP) (local.get $scalarBase))
                      (local.get $scalarC))
                    (br $scalar)))
                (if (i32.eq (local.get $scalarChomp) (i32.const 2))
                  (then
                    (block $keptDone
                      (loop $kept
                        (br_if $keptDone (i32.eqz (local.get $scalarPending)))
                        (out.str "\5cn")
                        (local.set $scalarPending
                          (i32.sub (local.get $scalarPending) (i32.const 1)))
                        (br $kept)))))
                (if (i32.and
                      (i32.ne (local.get $scalarChomp) (i32.const 0))
                      (i32.eqz (local.get $scalarFirst)))
                  (then (out.str "\5cn")))
                (call $outByte (i32.const "\22"))
                (call $yTakeLine))
              (else
                (call $yValue (local.get $rest) (global.get $ylEnd))
                (call $yTakeLine)))))
        (br $l)))
    (call $outByte (i32.const "}"))
    (global.set $yDepth (i32.sub (global.get $yDepth) (i32.const 1))))

  ;; the position of the `: ` that separates a key from its value, or 0
  (func $yFindColon (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local $q i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
      (then
        (local.set $q (call $findByte (i32.add (local.get $p) (i32.const 1))
          (local.get $end) (local.get $c)))
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $q) (i32.const 1)))))
    (block $done
      (loop $l
        (local.set $p (call $findByte (local.get $p) (local.get $end) (i32.const ":")))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (if (i32.or
              (i32.eq (i32.add (local.get $p) (i32.const 1)) (local.get $end))
              (call $isSpaceByte (i32.load8_u offset=1 (local.get $p))))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  (func $yValue (param $p i32) (param $end i32)
    (local $c i32)
    (local $q i32)
    (local $n i32)
    (local $numP i32)
    (local $numC i32)
    (local $numQ i32)
    (local $isNum i32)
    ;; Drop a trailing ` #` comment, skipping quoted spans.
    (local.set $q (local.get $p))
    (block $commentDone
      (loop $comment
        (br_if $commentDone (i32.ge_u (local.get $q) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "\22"))
              (i32.eq (local.get $c) (i32.const "'")))
          (then
            (local.set $q (call $findByte (i32.add (local.get $q) (i32.const 1))
              (local.get $end) (local.get $c)))
            (br_if $commentDone (i32.ge_u (local.get $q) (local.get $end)))))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.gt_u (local.get $q) (local.get $p)))
          (then
            (if (call $isSpaceByte
                  (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))
              (then
                (local.set $end (call $trimSpaceBack
                  (local.get $q) (local.get $p)))
                (br $commentDone)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $comment)))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (out.str "null") (return)))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or
          (i32.eq (local.get $c) (i32.const "\22"))
          (i32.eq (local.get $c) (i32.const "'")))
      (then
        (local.set $q (call $findByte (i32.add (local.get $p) (i32.const 1))
          (local.get $end) (local.get $c)))
        (call $outByte (i32.const "\22"))
        (call $yEscaped (i32.add (local.get $p) (i32.const 1)) (local.get $q))
        (call $outByte (i32.const "\22"))
        (return)))
    (if (i32.eq (local.get $c) (i32.const "["))
      (then (call $yFlow (local.get $p) (local.get $end) (i32.const "]")) (return)))
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then (call $yFlow (local.get $p) (local.get $end) (i32.const "}")) (return)))
    ;; A plain scalar becomes a JSON number, boolean, null, or string.
    (local.set $n (i32.sub (local.get $end) (local.get $p)))
    (block $plainDone
      (if (i32.eqz (local.get $n))
        (then (out.str "null") (br $plainDone)))
      (if (i32.eq (local.get $n) (i32.const 1))
        (then
          (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "~"))
            (then (out.str "null") (br $plainDone)))))
      (if (call $yWordEq (local.get $p) (local.get $n) (i64.const "true") (i32.const 4))
        (then (out.str "true") (br $plainDone)))
      (if (call $yWordEq (local.get $p) (local.get $n) (i64.const "false") (i32.const 5))
        (then (out.str "false") (br $plainDone)))
      (if (call $yWordEq (local.get $p) (local.get $n) (i64.const "null") (i32.const 4))
        (then (out.str "null") (br $plainDone)))
      ;; Only JSON.parse-compatible number spellings are emitted bare.
      (local.set $isNum (i32.const 0))
      (local.set $numP (local.get $p))
      (block $numberDone
        (if (i32.eq (i32.load8_u (local.get $numP)) (i32.const "-"))
          (then (local.set $numP (i32.add (local.get $numP) (i32.const 1)))))
        (br_if $numberDone (i32.ge_u (local.get $numP) (local.get $end)))
        (local.set $numC (i32.load8_u (local.get $numP)))
        (br_if $numberDone (i32.eqz (call $isDigit (local.get $numC))))
        (local.set $numP (i32.add (local.get $numP) (i32.const 1)))
        ;; A leading zero admits no more integer digits.
        (if (i32.ne (local.get $numC) (i32.const "0"))
          (then (local.set $numP
            (call $ySkipDigits (local.get $numP) (local.get $end)))))
        (if (i32.ge_u (local.get $numP) (local.get $end))
          (then
            (local.set $isNum (i32.const 1))
            (br $numberDone)))
        (if (i32.eq (i32.load8_u (local.get $numP)) (i32.const "."))
          (then
            (local.set $numQ (i32.add (local.get $numP) (i32.const 1)))
            (local.set $numP
              (call $ySkipDigits (local.get $numQ) (local.get $end)))
            (br_if $numberDone (i32.eq (local.get $numP) (local.get $numQ)))
            (if (i32.ge_u (local.get $numP) (local.get $end))
              (then
                (local.set $isNum (i32.const 1))
                (br $numberDone)))))
        (br_if $numberDone (i32.ne
          (i32.or (i32.load8_u (local.get $numP)) (i32.const 32)) (i32.const "e")))
        (local.set $numP (i32.add (local.get $numP) (i32.const 1)))
        (if (i32.lt_u (local.get $numP) (local.get $end))
          (then
            (if (i32.or
                  (i32.eq (i32.load8_u (local.get $numP)) (i32.const "-"))
                  (i32.eq (i32.load8_u (local.get $numP)) (i32.const "+")))
              (then
                (local.set $numP (i32.add (local.get $numP) (i32.const 1)))))))
        (local.set $numQ (local.get $numP))
        (local.set $numP (call $ySkipDigits (local.get $numP) (local.get $end)))
        (local.set $isNum (i32.and
          (i32.gt_u (local.get $numP) (local.get $numQ))
          (i32.eq (local.get $numP) (local.get $end)))))
      (if (local.get $isNum)
        (then
          (call $outCopy (local.get $p) (local.get $end))
          (br $plainDone)))
      (call $yString (local.get $p) (local.get $end))))

  (func $yWordEq (param $p i32) (param $len i32) (param $word i64) (param $n i32) (result i32)
    (if (i32.ne (local.get $len) (local.get $n)) (then (return (i32.const 0))))
    (i64.eqz (i64.shl
      (i64.xor
        (i64.or (i64.load (local.get $p)) (i64.const 0x2020202020202020))
        (local.get $word))
      (i64.mul (i64.const 8)
        (i64.extend_i32_u (i32.sub (i32.const 8) (local.get $n)))))))

  (func $ySkipDigits (param $p i32) (param $end i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (br_if $done (i32.eqz (call $isDigit (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; A flow collection, rebuilt as JSON rather than copied through. The
  ;; structure is re-emitted so a malformed collection still parses: stray
  ;; separators are dropped, a missing value is null, `a: b` inside a sequence
  ;; is the one-pair mapping YAML says it is, and an unterminated collection
  ;; is closed.
  (func $yFlow (param $p i32) (param $end i32) (param $close i32)
    (local $c i32)
    (local $seg i32)
    (local $q i32)
    (local $colon i32)
    (local $map i32)
    (local $n i32)
    (if (i32.gt_u (global.get $yDepth) (i32.const 32))
      (then (out.str "null") (return)))
    (global.set $yDepth (i32.add (global.get $yDepth) (i32.const 1)))
    (local.set $map (i32.eq (local.get $close) (i32.const "}")))
    (call $outByte (i32.load8_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $skipSpace (local.get $p) (local.get $end)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (i32.eq (local.get $c) (local.get $close)))
        ;; separators are only consumed here; the commas between entries are
        ;; emitted with the entry, so `[a,,b]` and `[a,]` stay valid
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if (local.get $n) (then (call $outByte (i32.const ","))))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (local.set $seg (call $yFlowItemEnd (local.get $p) (local.get $end)))
        (if (i32.le_u (local.get $seg) (local.get $p))
          (then (local.set $seg (i32.add (local.get $p) (i32.const 1)))))
        (local.set $q (call $skipSpace (local.get $seg) (local.get $end)))
        (local.set $colon (i32.and (i32.lt_u (local.get $q) (local.get $end))
          (i32.eq (i32.load8_u (local.get $q)) (i32.const ":"))))
        (if (i32.eqz (i32.or (local.get $map) (local.get $colon)))
          (then
            (call $yValue (local.get $p) (local.get $seg))
            (local.set $p (local.get $seg))
            (br $l)))
        (if (i32.eqz (local.get $map)) (then (call $outByte (i32.const "{"))))
        (call $yString (local.get $p) (local.get $seg))
        (call $outByte (i32.const ":"))
        (local.set $p (local.get $seg))
        (if (local.get $colon)
          (then
            (local.set $p (call $skipSpace (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
            (local.set $seg (call $yFlowItemEnd (local.get $p) (local.get $end))))
          (else (local.set $seg (local.get $p))))
        (if (i32.le_u (local.get $seg) (local.get $p))
          (then (out.str "null"))
          (else
            (call $yValue (local.get $p) (local.get $seg))
            (local.set $p (local.get $seg))))
        (if (i32.eqz (local.get $map)) (then (call $outByte (i32.const "}"))))
        (br $l)))
    ;; an unterminated collection still has to close, or the JSON is invalid
    (call $outByte (local.get $close))
    (global.set $yDepth (i32.sub (global.get $yDepth) (i32.const 1))))

  (func $yFlowItemEnd (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "{")))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "]")) (i32.eq (local.get $c) (i32.const "}")))
          (then
            (br_if $done (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $done (i32.eqz (local.get $depth)))
            (br $l)))
        (if (i32.and (i32.eqz (local.get $depth))
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":"))))
          (then (br $done)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
          (then
            (local.set $p (call $findByte (i32.add (local.get $p) (i32.const 1))
              (local.get $end) (local.get $c)))
            (br_if $done (i32.ge_u (local.get $p) (local.get $end)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (call $trimSpaceBack (local.get $p) (i32.const 0)))

  (func $yString (param $p i32) (param $end i32)
    (local $c i32)
    (if (i32.and (i32.lt_u (local.get $p) (local.get $end))
          (i32.or
            (i32.eq (i32.load8_u (local.get $p)) (i32.const "\22"))
            (i32.eq (i32.load8_u (local.get $p)) (i32.const "'"))))
      (then
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and (i32.gt_u (local.get $end) (i32.add (local.get $p) (i32.const 1)))
              (i32.eq (i32.load8_u (i32.sub (local.get $end) (i32.const 1))) (local.get $c)))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $end (i32.sub (local.get $end) (i32.const 1)))))))
    (call $outByte (i32.const "\22"))
    (call $yEscaped (local.get $p) (local.get $end))
    (call $outByte (i32.const "\22")))

  (func $yEscaped (param $p i32) (param $end i32)
    (local $c i32)
    (local $seg i32)
    (local.set $seg (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "\5c")))
              (i32.lt_u (local.get $c) (i32.const 32)))
          (then
            (call $outCopy (local.get $seg) (local.get $p))
            (if (i32.lt_u (local.get $c) (i32.const 32))
              (then
                (out.str "\5cu00")
                (call $outByte (i32.load8_u offset=$mem.hexdigits (i32.shr_u (local.get $c) (i32.const 4))))
                (call $outByte (i32.load8_u offset=$mem.hexdigits (i32.and (local.get $c) (i32.const 15)))))
              (else
                (call $outByte (i32.const "\5c"))
                (call $outByte (local.get $c))))
            (local.set $seg (i32.add (local.get $p) (i32.const 1)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (call $outCopy (local.get $seg) (local.get $end)))
)
