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

  ;; The start of the `---` or `...` line that closes a frontmatter block opened
  ;; by a `---` line at $p, or 0. Both lines may end in spaces or tabs. Render
  ;; and completion share this so they agree on where the markdown starts.
  (func $frontmatterClose (param $p i32) (result i32)
    (local $e i32)
    (local $q i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $eof))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)) (i32.const "---"))
      (then (return (i32.const 0))))
    (local.set $e (call $findLineEnd (local.get $p)))
    (if (i32.lt_u (call $skipSpace (i32.add (local.get $p) (i32.const 3)) (local.get $e))
          (local.get $e))
      (then (return (i32.const 0))))
    (block $done
      (loop $l
        (local.set $p (call $lineAfter (local.get $e)))
        (br_if $done (i32.ge_u (local.get $p) (global.get $eof)))
        (local.set $e (call $findLineEnd (local.get $p)))
        (if (i32.and
              (i32.ge_u (i32.sub (local.get $e) (local.get $p)) (i32.const 3))
              (i32.ge_u (call $skipSpace (i32.add (local.get $p) (i32.const 3)) (local.get $e))
                (local.get $e)))
          (then
            (local.set $q (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)))
            (if (i32.or (i32.eq (local.get $q) (i32.const "---")) (i32.eq (local.get $q) (i32.const "...")))
              (then (return (local.get $p))))))
        (br $l)))
    (i32.const 0))

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

  ;; A node whose first line is the current line. $parent is the indentation of
  ;; the enclosing collection, or -1 at the top level.
  (func $yParseNode (param $parent i32)
    (local $c i32)
    (if (i32.eqz (global.get $ylValid)) (then (out.str "null") (return)))
    (if (call $yIsSeqItem) (then (call $yParseSeq (global.get $ylIndent)) (return)))
    (local.set $c (i32.load8_u (global.get $ylBeg)))
    ;; flow collections and block scalars are values even when they hold `: `
    (if (i32.and
          (i32.eqz (i32.or (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "{")))
            (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const ">")))))
          (i32.ne (call $yFindColon (global.get $ylBeg) (global.get $ylEnd)) (i32.const 0)))
      (then (call $yParseMap (global.get $ylIndent)) (return)))
    (call $yInlineValue (global.get $ylBeg) (local.get $parent)))

  (func $yIsSeqItem (result i32)
    (if (i32.ne (i32.load8_u (global.get $ylBeg)) (i32.const "-")) (then (return (i32.const 0))))
    (if (i32.eq (i32.add (global.get $ylBeg) (i32.const 1)) (global.get $ylEnd))
      (then (return (i32.const 1))))
    (call $isSpaceByte (i32.load8_u offset=1 (global.get $ylBeg))))

  (func $yParseSeq (param $indent i32)
    (local $first i32)
    (local $rest i32)
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
        (if (i32.or (i32.ge_u (local.get $rest) (global.get $ylEnd))
              (i32.eq (i32.load8_u (local.get $rest)) (i32.const "#")))
          (then
            ;; the item's content starts on the following lines
            (call $yTakeLine)
            (if (i32.and (global.get $ylValid) (i32.gt_u (global.get $ylIndent) (local.get $indent)))
              (then (call $yParseNode (local.get $indent)))
              (else (out.str "null"))))
          (else
            ;; The item is a node that starts here, in the column of $rest.
            (global.set $ylIndent (i32.add (local.get $indent)
              (i32.sub (local.get $rest) (global.get $ylBeg))))
            (global.set $ylBeg (local.get $rest))
            (call $yParseNode (local.get $indent))))
        (br $l)))
    (call $outByte (i32.const "]"))
    (global.set $yDepth (i32.sub (global.get $yDepth) (i32.const 1))))

  (func $yParseMap (param $indent i32)
    (local $first i32)
    (local $colon i32)
    (local $rest i32)
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
        (if (i32.or (i32.ge_u (local.get $rest) (global.get $ylEnd))
              (i32.eq (i32.load8_u (local.get $rest)) (i32.const "#")))
          (then
            ;; The value starts on the following lines. A sequence may sit in
            ;; the key's own column.
            (call $yTakeLine)
            (if (i32.and (global.get $ylValid)
                  (i32.or (i32.gt_u (global.get $ylIndent) (local.get $indent))
                    (i32.and (i32.eq (global.get $ylIndent) (local.get $indent)) (call $yIsSeqItem))))
              (then (call $yParseNode (local.get $indent)))
              (else (out.str "null"))))
          (else (call $yInlineValue (local.get $rest) (local.get $indent))))
        (br $l)))
    (call $outByte (i32.const "}"))
    (global.set $yDepth (i32.sub (global.get $yDepth) (i32.const 1))))

  ;; Write the value that starts at $p on the current line, then load the next
  ;; line. Block scalars, flow collections and plain scalars continue on later
  ;; lines indented past $indent, the enclosing collection's indentation.
  (func $yInlineValue (param $p i32) (param $indent i32)
    (local $c i32)
    (local $q i32)
    (local $e i32)
    (local $s i32)
    (local $end i32)
    (local $n i32)
    (local $fold i32)
    (local $chomp i32)
    (local $base i32)
    (local $first i32)
    (local $string i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const ">")))
      (then
        ;; Block scalar: chomping (`-` strip, `+` keep) and an indentation digit
        ;; may follow in either order.
        (local.set $fold (i32.eq (local.get $c) (i32.const ">")))
        (local.set $chomp (i32.const 1))
        (local.set $base (i32.const -1))
        (local.set $q (i32.add (local.get $p) (i32.const 1)))
        (block $indicators
          (loop $indicator
            (br_if $indicators (i32.ge_u (local.get $q) (global.get $ylEnd)))
            (local.set $c (i32.load8_u (local.get $q)))
            (if (i32.eq (local.get $c) (i32.const "-")) (then (local.set $chomp (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "+")) (then (local.set $chomp (i32.const 2))))
            (if (i32.le_u (i32.sub (local.get $c) (i32.const "1")) (i32.const 8))
              (then (local.set $base (i32.add (i32.add (local.get $indent) (i32.const 1))
                (i32.sub (local.get $c) (i32.const "1"))))))
            (br_if $indicators (i32.eqz (i32.or (i32.or (i32.eq (local.get $c) (i32.const "-"))
              (i32.eq (local.get $c) (i32.const "+")))
              (i32.le_u (i32.sub (local.get $c) (i32.const "1")) (i32.const 8)))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $indicator)))
        (call $outByte (i32.const "\22"))
        (local.set $first (i32.const 1))
        ;; Scalar lines are raw, so read them straight from $yNext.
        (block $scalarDone
          (loop $scalar
            (local.set $q (global.get $yNext))
            (br_if $scalarDone (i32.ge_u (local.get $q) (global.get $yEnd)))
            (local.set $e (call $findLineEnd (local.get $q)))
            (if (i32.gt_u (local.get $e) (global.get $yEnd)) (then (local.set $e (global.get $yEnd))))
            (local.set $s (call $skipSpace (local.get $q) (local.get $e)))
            (if (i32.ge_u (local.get $s) (local.get $e))
              (then
                (global.set $yNext (call $lineAfter (local.get $e)))
                (local.set $n (i32.add (local.get $n) (i32.const 1)))
                (br $scalar)))
            (br_if $scalarDone (i32.le_s (i32.sub (local.get $s) (local.get $q)) (local.get $indent)))
            (if (i32.lt_s (local.get $base) (i32.const 0))
              (then (local.set $base (i32.sub (local.get $s) (local.get $q)))))
            (br_if $scalarDone (i32.lt_s (i32.sub (local.get $s) (local.get $q)) (local.get $base)))
            (global.set $yNext (call $lineAfter (local.get $e)))
            ;; Literal lines keep their breaks; folded lines join with a space
            ;; unless blank lines separate them.
            (if (i32.and (i32.and (local.get $fold) (i32.eqz (local.get $n))) (i32.eqz (local.get $first)))
              (then (call $outByte (i32.const 32))))
            (call $yNewlines (i32.add (local.get $n)
              (i32.eqz (i32.or (local.get $fold) (local.get $first)))))
            (local.set $n (i32.const 0))
            (local.set $first (i32.const 0))
            (call $yEscaped (i32.add (local.get $q) (local.get $base)) (local.get $e) (i32.const 0))
            (br $scalar)))
        (if (i32.eqz (local.get $first))
          (then (call $yNewlines (select (i32.add (local.get $n) (i32.const 1))
            (local.get $chomp) (i32.eq (local.get $chomp) (i32.const 2))))))
        (call $outByte (i32.const "\22"))
        (call $yTakeLine)
        (return)))
    (if (i32.or (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "{")))
          (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'"))))
      (then
        ;; Flow collections and quoted scalars may continue on blank or more
        ;; indented lines.
        (local.set $end (global.get $ylEnd))
        (local.set $q (global.get $yNext))
        (block $flowLines
          (loop $lines
            (br_if $flowLines (i32.ge_u (local.get $q) (global.get $yEnd)))
            (local.set $e (call $findLineEnd (local.get $q)))
            (if (i32.gt_u (local.get $e) (global.get $yEnd)) (then (local.set $e (global.get $yEnd))))
            (local.set $s (call $skipSpace (local.get $q) (local.get $e)))
            (br_if $flowLines (i32.and (i32.lt_u (local.get $s) (local.get $e))
              (i32.le_s (i32.sub (local.get $s) (local.get $q)) (local.get $indent))))
            (local.set $end (local.get $e))
            (local.set $q (call $lineAfter (local.get $e)))
            (br $lines)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "{")))
          (then
            (local.set $q (call $yFlow (local.get $p) (local.get $end)
              (select (i32.const "]") (i32.const "}") (i32.eq (local.get $c) (i32.const "["))))))
          (else
            (local.set $q (call $yQuoteEnd (local.get $p) (local.get $end)))
            (call $outByte (i32.const "\22"))
            (call $yEscaped (i32.add (local.get $p) (i32.const 1)) (local.get $q) (local.get $c))
            (call $outByte (i32.const "\22"))))
        (if (i32.gt_u (local.get $q) (global.get $ylEnd))
          (then (global.set $yNext (call $lineAfter (call $findLineEnd (local.get $q))))))
        (call $yTakeLine)
        (return)))
    (local.set $end (call $yTrimComment (local.get $p) (global.get $ylEnd)))
    (if (i32.lt_u (local.get $end) (global.get $ylEnd))
      (then
        (call $yValue (local.get $p) (local.get $end))
        (call $yTakeLine)
        (return)))
    ;; A plain scalar continues on more indented lines: each line break folds
    ;; into a space, and blank lines between become line feeds.
    (local.set $q (global.get $yNext))
    (block $plainDone
      (loop $plain
        (br_if $plainDone (i32.ge_u (local.get $q) (global.get $yEnd)))
        (local.set $e (call $findLineEnd (local.get $q)))
        (if (i32.gt_u (local.get $e) (global.get $yEnd)) (then (local.set $e (global.get $yEnd))))
        (local.set $s (call $skipSpace (local.get $q) (local.get $e)))
        (if (i32.ge_u (local.get $s) (local.get $e))
          (then
            (local.set $n (i32.add (local.get $n) (i32.const 1)))
            (local.set $q (call $lineAfter (local.get $e)))
            (br $plain)))
        (br_if $plainDone (i32.le_s (i32.sub (local.get $s) (local.get $q)) (local.get $indent)))
        (br_if $plainDone (i32.eq (i32.load8_u (local.get $s)) (i32.const "#")))
        (if (i32.eqz (local.get $string))
          (then
            (local.set $string (i32.const 1))
            (call $outByte (i32.const "\22"))
            (call $yEscaped (local.get $p) (local.get $end) (i32.const 0))))
        (if (local.get $n) (then (call $yNewlines (local.get $n))) (else (call $outByte (i32.const 32))))
        (local.set $n (i32.const 0))
        (local.set $q (call $lineAfter (local.get $e)))
        (global.set $yNext (local.get $q))
        (local.set $e (call $trimSpaceBack (local.get $e) (local.get $s)))
        (local.set $end (call $yTrimComment (local.get $s) (local.get $e)))
        (call $yEscaped (local.get $s) (local.get $end) (i32.const 0))
        ;; a comment ends the scalar
        (br_if $plainDone (i32.lt_u (local.get $end) (local.get $e)))
        (br $plain)))
    (if (local.get $string)
      (then (call $outByte (i32.const "\22")))
      (else (call $yValue (local.get $p) (global.get $ylEnd))))
    (call $yTakeLine))

  ;; write $n escaped line feeds
  (func $yNewlines (param $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $n)))
        (out.str "\5cn")
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (br $l))))

  ;; The closing quote of the quoted scalar that opens at $p, or $end. Double
  ;; quotes skip backslash escapes; single quotes skip doubled quotes.
  (func $yQuoteEnd (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (block $done
      (loop $l
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "\22"))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const "\5c")))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $l)))
        (br_if $l (i32.ne (i32.load8_u (local.get $p)) (local.get $c)))
        (br_if $done (i32.eq (local.get $c) (i32.const "\22")))
        (br_if $done (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
        (br_if $done (i32.ne (i32.load8_u offset=1 (local.get $p)) (i32.const "'")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (select (local.get $end) (local.get $p) (i32.gt_u (local.get $p) (local.get $end))))

  ;; Drop a trailing ` #` comment from [$p, $end). A quoted scalar at $p may
  ;; hold `#`.
  (func $yTrimComment (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local.set $q (local.get $p))
    (if (i32.lt_u (local.get $p) (local.get $end))
      (then
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
          (then (local.set $q (call $yQuoteEnd (local.get $p) (local.get $end)))))))
    (block $done
      (loop $l
        (local.set $q (call $findByte (local.get $q) (local.get $end) (i32.const "#")))
        (br_if $done (i32.ge_u (local.get $q) (local.get $end)))
        (if (i32.and (i32.gt_u (local.get $q) (local.get $p))
              (call $isSpaceByte (i32.load8_u (i32.sub (local.get $q) (i32.const 1)))))
          (then (return (call $trimSpaceBack (local.get $q) (local.get $p)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.get $end))

  ;; the position of the `: ` that separates a key from its value, or 0
  (func $yFindColon (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
      (then
        (local.set $p (call $yQuoteEnd (local.get $p) (local.get $end)))
        (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))))
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

  ;; A scalar or flow collection in [$p, $end), with YAML 1.2 core schema types.
  (func $yValue (param $p i32) (param $end i32)
    (local $c i32)
    (local $q i32)
    (local $n i32)
    (local $int i32)
    (local $frac i32)
    (local $exp i32)
    (local $v i64)
    (local $shift i64)
    (local.set $end (call $yTrimComment (local.get $p) (local.get $end)))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (out.str "null") (return)))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or
          (i32.eq (local.get $c) (i32.const "\22"))
          (i32.eq (local.get $c) (i32.const "'")))
      (then
        (call $outByte (i32.const "\22"))
        (call $yEscaped (i32.add (local.get $p) (i32.const 1))
          (call $yQuoteEnd (local.get $p) (local.get $end)) (local.get $c))
        (call $outByte (i32.const "\22"))
        (return)))
    (if (i32.eq (local.get $c) (i32.const "["))
      (then (drop (call $yFlow (local.get $p) (local.get $end) (i32.const "]"))) (return)))
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then (drop (call $yFlow (local.get $p) (local.get $end) (i32.const "}"))) (return)))
    (local.set $n (i32.sub (local.get $end) (local.get $p)))
    (block $plainDone
      (if (i32.or (call $yWordIs (local.get $p) (local.get $n) (i64.const "null") (i32.const 4))
            (i32.and (i32.eq (local.get $n) (i32.const 1)) (i32.eq (local.get $c) (i32.const "~"))))
        (then (out.str "null") (br $plainDone)))
      (if (call $yWordIs (local.get $p) (local.get $n) (i64.const "true") (i32.const 4))
        (then (out.str "true") (br $plainDone)))
      (if (call $yWordIs (local.get $p) (local.get $n) (i64.const "false") (i32.const 5))
        (then (out.str "false") (br $plainDone)))
      ;; JSON has no infinities or NaN; JSON.stringify writes them as null.
      (local.set $q (i32.add (local.get $p)
        (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "+")))))
      (if (i32.and (i32.eq (i32.load8_u (local.get $q)) (i32.const "."))
            (i32.eq (i32.sub (local.get $end) (local.get $q)) (i32.const 4)))
        (then
          (local.set $int (i32.and (i32.load offset=1 (local.get $q)) (i32.const 0xffffff)))
          (if (i32.or
                (call $yWordIs (i32.add (local.get $q) (i32.const 1)) (i32.const 3) (i64.const "inf") (i32.const 3))
                (i32.and (i32.eq (local.get $q) (local.get $p))
                  (i32.or (i32.or (i32.eq (local.get $int) (i32.const "nan")) (i32.eq (local.get $int) (i32.const "NaN")))
                    (i32.eq (local.get $int) (i32.const "NAN")))))
            (then (out.str "null") (br $plainDone)))))
      ;; 0x and 0o integers, written in decimal when they fit 64 bits
      (if (i32.and (i32.gt_u (local.get $n) (i32.const 2))
            (i32.or (i32.eq (i32.load16_u (local.get $p)) (i32.const "0x"))
              (i32.eq (i32.load16_u (local.get $p)) (i32.const "0o"))))
        (then
          (local.set $shift (select (i64.const 4) (i64.const 3)
            (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "x"))))
          (local.set $q (i32.add (local.get $p) (i32.const 2)))
          (block $radixDone
            (loop $radix
              (br_if $radixDone (i32.ge_u (local.get $q) (local.get $end)))
              (local.set $c (i32.load8_u (local.get $q)))
              (local.set $int (select (i32.sub (local.get $c) (i32.const "0"))
                (i32.add (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 10))
                (call $isDigit (local.get $c))))
              (br_if $radixDone (i32.or
                (i32.ge_u (local.get $int) (select (i32.const 16) (i32.const 8) (i64.eq (local.get $shift) (i64.const 4))))
                (i32.eqz (i64.eqz (i64.shr_u (local.get $v) (i64.sub (i64.const 64) (local.get $shift)))))))
              (local.set $v (i64.or (i64.shl (local.get $v) (local.get $shift)) (i64.extend_i32_u (local.get $int))))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $radix)))
          (if (i32.eq (local.get $q) (local.get $end))
            (then
              (call $ensureOut (i32.const 20))
              (local.set $q (global.get $out))
              (local.set $shift (local.get $v))
              (loop $count
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (local.set $shift (i64.div_u (local.get $shift) (i64.const 10)))
                (br_if $count (i64.ne (local.get $shift) (i64.const 0))))
              (global.set $out (local.get $q))
              (loop $digit
                (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                (i64.store8 (local.get $q) (i64.add (i64.const "0") (i64.rem_u (local.get $v) (i64.const 10))))
                (local.set $v (i64.div_u (local.get $v) (i64.const 10)))
                (br_if $digit (i64.ne (local.get $v) (i64.const 0))))
              (br $plainDone)))
          (call $yString (local.get $p) (local.get $end))
          (br $plainDone)))
      ;; Decimal numbers: [-+] digits [. digits] [e [-+] digits], where either
      ;; the integer or the fraction may be empty. JSON needs both and no `+`.
      (local.set $q (call $ySkipDigits (local.get $q) (local.get $end)))
      (local.set $int (i32.add (local.get $p)
        (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "+")))))
      (local.set $frac (local.get $q))
      (if (i32.and (i32.lt_u (local.get $q) (local.get $end)) (i32.eq (i32.load8_u (local.get $q)) (i32.const ".")))
        (then (local.set $q (call $ySkipDigits (i32.add (local.get $q) (i32.const 1)) (local.get $end)))))
      (local.set $exp (local.get $q))
      (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
            (i32.eq (i32.or (i32.load8_u (local.get $q)) (i32.const 32)) (i32.const "e")))
        (then
          (local.set $q (i32.add (local.get $q) (i32.const 1)))
          (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
                (i32.or (i32.eq (i32.load8_u (local.get $q)) (i32.const "-"))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const "+"))))
            (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
          (local.set $n (local.get $q))
          (local.set $q (call $ySkipDigits (local.get $q) (local.get $end)))
          (if (i32.eq (local.get $q) (local.get $n)) (then (local.set $q (i32.const 0))))))
      (if (i32.and (i32.eq (local.get $q) (local.get $end))
            (i32.gt_u (i32.sub (local.get $exp) (local.get $int))
              (i32.ne (local.get $frac) (local.get $exp))))
        (then
          (if (i32.eq (local.get $c) (i32.const "-")) (then (call $outByte (i32.const "-"))))
          ;; drop leading zeros but keep one integer digit
          (block $zeros
            (loop $zero
              (br_if $zeros (i32.ge_u (i32.add (local.get $int) (i32.const 1)) (local.get $frac)))
              (br_if $zeros (i32.ne (i32.load8_u (local.get $int)) (i32.const "0")))
              (local.set $int (i32.add (local.get $int) (i32.const 1)))
              (br $zero)))
          (if (i32.eq (local.get $int) (local.get $frac)) (then (call $outByte (i32.const "0"))))
          (call $outCopy (local.get $int) (local.get $frac))
          (if (i32.gt_u (i32.sub (local.get $exp) (local.get $frac)) (i32.const 1))
            (then (call $outCopy (local.get $frac) (local.get $exp))))
          (call $outCopy (local.get $exp) (local.get $end))
          (br $plainDone)))
      (call $yString (local.get $p) (local.get $end))))

  ;; The word $word of $n lowercase letters, in lowercase, uppercase, or with
  ;; only the first letter capitalized; YAML spells no other case.
  (func $yWordIs (param $p i32) (param $len i32) (param $word i64) (param $n i32) (result i32)
    (local $v i64)
    (local $mask i64)
    (if (i32.ne (local.get $len) (local.get $n)) (then (return (i32.const 0))))
    (local.set $mask (i64.shr_u (i64.const -1)
      (i64.mul (i64.const 8) (i64.extend_i32_u (i32.sub (i32.const 8) (local.get $n))))))
    (local.set $v (i64.and (i64.load (local.get $p)) (local.get $mask)))
    (i32.or (i32.or
      (i64.eq (local.get $v) (local.get $word))
      (i64.eq (local.get $v) (i64.xor (local.get $word) (i64.const 0x20))))
      (i64.eq (local.get $v) (i64.xor (local.get $word)
        (i64.and (i64.const 0x2020202020202020) (local.get $mask))))))

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
  ;; is closed. Line breaks are spaces, and `#` after a space starts a comment.
  ;; Returns the position after the collection.
  (func $yFlow (param $p i32) (param $end i32) (param $close i32) (result i32)
    (local $c i32)
    (local $seg i32)
    (local $q i32)
    (local $colon i32)
    (local $map i32)
    (local $n i32)
    (if (i32.gt_u (global.get $yDepth) (i32.const 32))
      (then (out.str "null") (return (local.get $end))))
    (global.set $yDepth (i32.add (global.get $yDepth) (i32.const 1)))
    (local.set $map (i32.eq (local.get $close) (i32.const "}")))
    (call $outByte (i32.load8_u (local.get $p)))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $skipWs (local.get $p) (local.get $end)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (local.get $close))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $done)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "#"))
              (call $isWhiteByte (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))))
          (then (local.set $p (call $findLineEnd (local.get $p))) (br $l)))
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
            (local.set $p (call $skipWs (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
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
    (global.set $yDepth (i32.sub (global.get $yDepth) (i32.const 1)))
    (select (local.get $end) (local.get $p) (i32.gt_u (local.get $p) (local.get $end))))

  ;; The end of the flow item at $p, with trailing whitespace trimmed. At
  ;; nesting depth zero an item ends at `,`, a closer, a ` #` comment, or a `:`
  ;; that a space, a flow indicator, or a quoted key precedes or follows. Quotes
  ;; open a scalar only where a scalar starts.
  (func $yFlowItemEnd (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (local $start i32)
    (local $prev i32)
    (local $next i32)
    (local.set $start (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $prev (if (result i32) (i32.gt_u (local.get $p) (local.get $start))
          (then (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))) (else (i32.const 32))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "{")))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "]")) (i32.eq (local.get $c) (i32.const "}")))
          (then
            (br_if $done (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $done (i32.eqz (local.get $depth)))
            (br $l)))
        (if (i32.eqz (local.get $depth))
          (then
            (br_if $done (i32.eq (local.get $c) (i32.const ",")))
            (br_if $done (i32.and (i32.eq (local.get $c) (i32.const "#"))
              (call $isWhiteByte (local.get $prev))))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (local.set $next (if (result i32) (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                  (then (i32.load8_u offset=1 (local.get $p))) (else (i32.const 32))))
                (br_if $done (i32.or (i32.or (call $isWhiteByte (local.get $next))
                    (i32.or (i32.eq (local.get $next) (i32.const ",")) (i32.eq (local.get $next) (i32.const "]"))))
                  (i32.or (i32.eq (local.get $next) (i32.const "}"))
                    (i32.or (i32.eq (local.get $prev) (i32.const "\22")) (i32.eq (local.get $prev) (i32.const "'"))))))))))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
              (i32.or (i32.eq (local.get $p) (local.get $start))
                (i32.and (i32.ne (local.get $depth) (i32.const 0))
                  (i32.or (call $isWhiteByte (local.get $prev))
                    (i32.or (i32.or (i32.eq (local.get $prev) (i32.const "[")) (i32.eq (local.get $prev) (i32.const "{")))
                      (i32.or (i32.eq (local.get $prev) (i32.const ",")) (i32.eq (local.get $prev) (i32.const ":"))))))))
          (then
            (local.set $p (call $yQuoteEnd (local.get $p) (local.get $end)))
            (br_if $done (i32.ge_u (local.get $p) (local.get $end)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (block $trimmed
      (loop $trim
        (br_if $trimmed (i32.le_u (local.get $p) (local.get $start)))
        (br_if $trimmed (i32.eqz (call $isWhiteByte (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $trim)))
    (local.get $p))

  ;; A key or flow item as a JSON string; a whole quoted scalar loses its quotes.
  (func $yString (param $p i32) (param $end i32)
    (local $c i32)
    (if (i32.lt_u (local.get $p) (local.get $end))
      (then
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
              (i32.eq (call $yQuoteEnd (local.get $p) (local.get $end)) (i32.sub (local.get $end) (i32.const 1))))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $end (i32.sub (local.get $end) (i32.const 1))))
          (else (local.set $c (i32.const 0))))))
    (call $outByte (i32.const "\22"))
    (call $yEscaped (local.get $p) (local.get $end) (local.get $c))
    (call $outByte (i32.const "\22")))

  ;; Write [$p, $end) as JSON string content. $quote is the byte that quoted
  ;; the scalar, or 0: double-quoted text decodes YAML escapes, single-quoted
  ;; text turns '' into '. Unknown escapes keep their backslash.
  (func $yEscaped (param $p i32) (param $end i32) (param $quote i32)
    (local $c i32)
    (local $seg i32)
    (local $n i32)
    (local $v i32)
    (local $i i32)
    (local $d i32)
    (local.set $seg (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "\5c")))
              (i32.or (i32.lt_u (local.get $c) (i32.const 32))
                (i32.and (i32.eq (local.get $c) (i32.const "'")) (i32.eq (local.get $quote) (i32.const "'")))))
          (then
            (call $outCopy (local.get $seg) (local.get $p))
            (local.set $n (i32.const 1))
            (block $written
              (if (i32.eq (local.get $c) (i32.const "'"))
                (then
                  (call $outByte (local.get $c))
                  (local.set $n (i32.const 2))
                  (br $written)))
              (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
                (then
                  ;; Multi-line flow and quoted scalars fold: spaces around line
                  ;; breaks go, one break is a space, and each blank line a line feed.
                  (global.set $out (i32.sub (global.get $out)
                    (i32.sub (local.get $p) (call $trimSpaceBack (local.get $p) (local.get $seg)))))
                  (local.set $i (local.get $p))
                  (local.set $d (i32.const 0))
                  (block $breaks
                    (loop $break
                      (br_if $breaks (i32.ge_u (local.get $i) (local.get $end)))
                      (local.set $c (i32.load8_u (local.get $i)))
                      (br_if $breaks (i32.and (i32.ne (local.get $c) (i32.const 10)) (i32.ne (local.get $c) (i32.const 13))))
                      (local.set $i (i32.add (local.get $i) (i32.add (i32.const 1)
                        (i32.and (i32.eq (local.get $c) (i32.const 13))
                          (i32.eq (i32.load8_u offset=1 (local.get $i)) (i32.const 10))))))
                      (local.set $d (i32.add (local.get $d) (i32.const 1)))
                      (local.set $i (call $skipSpace (local.get $i) (local.get $end)))
                      (br $break)))
                  (if (i32.eq (local.get $d) (i32.const 1))
                    (then (call $outByte (i32.const 32)))
                    (else (call $yNewlines (i32.sub (local.get $d) (i32.const 1)))))
                  (local.set $n (i32.sub (local.get $i) (local.get $p)))
                  (br $written)))
              (if (i32.lt_u (local.get $c) (i32.const 32))
                (then (call $yOutU (local.get $c)) (br $written)))
              (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
                    (i32.and (i32.eq (local.get $quote) (i32.const "\22"))
                      (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))))
                (then
                  (local.set $c (i32.load8_u offset=1 (local.get $p)))
                  (local.set $n (i32.const 2))
                  ;; an escaped line break joins the lines
                  (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
                    (then
                      (local.set $n (i32.sub (call $skipWs (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                        (local.get $p)))
                      (br $written)))
                  ;; escapes that JSON spells the same way
                  (if (i32.or (i32.or (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "t")))
                          (i32.or (i32.eq (local.get $c) (i32.const "n")) (i32.eq (local.get $c) (i32.const "f"))))
                        (i32.or (i32.or (i32.eq (local.get $c) (i32.const "r")) (i32.eq (local.get $c) (i32.const "\22")))
                          (i32.eq (local.get $c) (i32.const "\5c"))))
                    (then
                      (call $outByte (i32.const "\5c"))
                      (call $outByte (local.get $c))
                      (br $written)))
                  (if (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const " ")))
                    (then (call $outByte (local.get $c)) (br $written)))
                  (local.set $v (i32.const -1))
                  (if (i32.eq (local.get $c) (i32.const 9)) (then (local.set $v (i32.const 9))))
                  (if (i32.eq (local.get $c) (i32.const "0")) (then (local.set $v (i32.const 0))))
                  (if (i32.eq (local.get $c) (i32.const "a")) (then (local.set $v (i32.const 7))))
                  (if (i32.eq (local.get $c) (i32.const "v")) (then (local.set $v (i32.const 11))))
                  (if (i32.eq (local.get $c) (i32.const "e")) (then (local.set $v (i32.const 27))))
                  (if (i32.eq (local.get $c) (i32.const "N")) (then (local.set $v (i32.const 0x85))))
                  (if (i32.eq (local.get $c) (i32.const "_")) (then (local.set $v (i32.const 0xa0))))
                  (if (i32.eq (local.get $c) (i32.const "L")) (then (local.set $v (i32.const 0x2028))))
                  (if (i32.eq (local.get $c) (i32.const "P")) (then (local.set $v (i32.const 0x2029))))
                  ;; \xHH, \uHHHH and \UHHHHHHHH
                  (local.set $i (select (i32.const 2)
                    (select (i32.const 4) (select (i32.const 8) (i32.const 0) (i32.eq (local.get $c) (i32.const "U")))
                      (i32.eq (local.get $c) (i32.const "u")))
                    (i32.eq (local.get $c) (i32.const "x"))))
                  (if (i32.and (i32.ne (local.get $i) (i32.const 0))
                        (i32.le_u (i32.add (i32.add (local.get $p) (i32.const 2)) (local.get $i)) (local.get $end)))
                    (then
                      (local.set $v (i32.const 0))
                      (local.set $i (i32.add (local.get $i) (i32.const 2)))
                      (block $hexDone
                        (loop $hex
                          (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $n))))
                          (local.set $d (select (i32.sub (local.get $c) (i32.const "0"))
                            (i32.add (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 10))
                            (call $isDigit (local.get $c))))
                          (if (i32.gt_u (local.get $d) (i32.const 15))
                            (then (local.set $v (i32.const -1)) (br $hexDone)))
                          (local.set $v (i32.or (i32.shl (local.get $v) (i32.const 4)) (local.get $d)))
                          (local.set $n (i32.add (local.get $n) (i32.const 1)))
                          (br_if $hex (i32.lt_u (local.get $n) (local.get $i)))))))
                  (if (i32.lt_s (local.get $v) (i32.const 0))
                    (then
                      (call $outByte (i32.const "\5c"))
                      (call $outByte (i32.const "\5c"))
                      (local.set $n (i32.const 1))
                      (br $written)))
                  ;; code points above the BMP become a surrogate pair
                  (if (i32.gt_u (local.get $v) (i32.const 0x10ffff)) (then (local.set $v (i32.const 0xfffd))))
                  (if (i32.gt_u (local.get $v) (i32.const 0xffff))
                    (then
                      (call $yOutU (i32.add (i32.const 0xd7c0) (i32.shr_u (local.get $v) (i32.const 10))))
                      (local.set $v (i32.or (i32.const 0xdc00) (i32.and (local.get $v) (i32.const 0x3ff))))))
                  (call $yOutU (local.get $v))
                  (br $written)))
              ;; a literal quote or backslash
              (call $outByte (i32.const "\5c"))
              (call $outByte (local.get $c)))
            (local.set $p (i32.add (local.get $p) (local.get $n)))
            (local.set $seg (local.get $p))
            (br $l)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (call $outCopy (local.get $seg) (local.get $end)))

  ;; write $v as a JSON \u escape
  (func $yOutU (param $v i32)
    (out.str "\5cu")
    (call $outByte (i32.load8_u offset=$mem.hexdigits (i32.and (i32.shr_u (local.get $v) (i32.const 12)) (i32.const 15))))
    (call $outByte (i32.load8_u offset=$mem.hexdigits (i32.and (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 15))))
    (call $outByte (i32.load8_u offset=$mem.hexdigits (i32.and (i32.shr_u (local.get $v) (i32.const 4)) (i32.const 15))))
    (call $outByte (i32.load8_u offset=$mem.hexdigits (i32.and (local.get $v) (i32.const 15)))))
)
