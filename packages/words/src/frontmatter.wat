(module
  (import "./memory.wat")
  (import "./scan.wat")
  (import "./out.wat")

  ;; A YAML frontmatter block is `---` on the first line, the document, and a
  ;; closing `---` or `...` line. It is converted to JSON in the output buffer
  ;; so the host can hand it straight to JSON.parse; the practical subset is
  ;; block mappings and sequences, flow collections, quoted and plain scalars,
  ;; block scalars, and comments. `[` and `{` differ only in bit 5, as do `]`
  ;; and `}`, so `c | 32` tests both.
  (global $ylBeg (mut i32) (i32.const 0))   ;; first non-space byte of the current line
  (global $ylEnd (mut i32) (i32.const 0))
  (global $ylIndent (mut i32) (i32.const 0)) ;; -1 when no content line is left
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
  ;; by a `---` line at $p, or 0. Both lines may end in spaces or tabs.
  (func $frontmatterClose (param $p i32) (result i32)
    (local $e i32)
    (local $q i32)
    (local $later i32)
    (loop $l
      (local.set $e (call $findLineEnd (local.get $p)))
      (local.set $q (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)))
      ;; the opening line must be a fence, and the first later fence closes
      (if (i32.eq (local.get $later)
            (i32.and
              (i32.and (i32.ge_u (i32.sub (local.get $e) (local.get $p)) (i32.const 3))
                (i32.ge_u (call $skipSpace (i32.add (local.get $p) (i32.const 3)) (local.get $e)) (local.get $e)))
              (i32.or (i32.eq (local.get $q) (i32.const "---"))
                (i32.and (local.get $later) (i32.eq (local.get $q) (i32.const "..."))))))
        (then (return (select (local.get $p) (i32.const 0) (local.get $later)))))
      (local.set $later (i32.const 1))
      (local.set $p (call $lineAfter (local.get $e)))
      (br_if $l (i32.lt_u (local.get $p) (global.get $eof))))
    (i32.const 0))

  ;; load the next content line, skipping blanks and comments
  (func $yTakeLine
    (local $p i32)
    (local $e i32)
    (loop $l
      (global.set $ylIndent (i32.const -1))
      (local.set $p (global.get $yNext))
      (if (i32.lt_u (local.get $p) (global.get $yEnd))
        (then
          (local.set $e (call $findLineEnd (local.get $p)))
          (global.set $yNext (call $lineAfter (local.get $e)))
          (global.set $ylBeg (call $skipSpace (local.get $p) (local.get $e)))
          (global.set $ylEnd (call $trimSpaceBack (local.get $e) (global.get $ylBeg)))
          (br_if $l (i32.ge_u (global.get $ylBeg) (global.get $ylEnd)))
          (br_if $l (i32.eq (i32.load8_u (global.get $ylBeg)) (i32.const "#")))
          (global.set $ylIndent (i32.sub (global.get $ylBeg) (local.get $p)))))))

  ;; A node whose first line is the current line. $parent is the indentation of
  ;; the enclosing collection, or -1 at the top level.
  (func $yParseNode (param $parent i32)
    (local $c i32)
    (if (i32.lt_s (global.get $ylIndent) (i32.const 0)) (then (call $yNull) (return)))
    (if (call $yIsSeqItem) (then (call $yParseBlock (global.get $ylIndent) (i32.const 0)) (return)))
    (local.set $c (i32.load8_u (global.get $ylBeg)))
    ;; flow collections and block scalars are values even when they hold `: `
    (if (i32.and
          (i32.eqz (i32.or (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "{"))
            (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const ">")))))
          (i32.lt_u (call $yKeyEnd) (global.get $ylEnd)))
      (then (call $yParseBlock (global.get $ylIndent) (i32.const 1)) (return)))
    (call $yInlineValue (global.get $ylBeg) (local.get $parent)))

  ;; The `:` that ends the key on the current line, or $ylEnd. A comment before
  ;; it ends the search: `- a # b: c` is a scalar.
  (func $yKeyEnd (result i32)
    (local $q i32)
    (local.set $q (call $yFind (global.get $ylBeg) (global.get $ylEnd) (i32.const ":")))
    (select (global.get $ylEnd) (local.get $q)
      (i32.lt_u (call $yFind (global.get $ylBeg) (local.get $q) (i32.const "#")) (local.get $q))))

  ;; the current line starts with a `-` item marker
  (func $yIsSeqItem (result i32)
    (i32.and (i32.eq (i32.load8_u (global.get $ylBeg)) (i32.const "-"))
      (i32.or (i32.eq (i32.add (global.get $ylBeg) (i32.const 1)) (global.get $ylEnd))
        (call $isSpaceByte (i32.load8_u offset=1 (global.get $ylBeg))))))

  ;; A block sequence ($map = 0) or mapping ($map = 1) whose entries sit at
  ;; column $indent.
  (func $yParseBlock (param $indent i32) (param $map i32)
    (local $first i32)
    (local $colon i32)
    (local $rest i32)
    (if (i32.gt_u (global.get $yDepth) (i32.const 32))
      (then (call $yNull) (return)))
    (global.set $yDepth (i32.add (global.get $yDepth) (i32.const 1)))
    (call $outByte (select (i32.const "{") (i32.const "[") (local.get $map)))
    (local.set $first (i32.const 1))
    (block $done
      (loop $l
        (br_if $done (i32.ne (global.get $ylIndent) (local.get $indent)))
        (br_if $done (i32.eq (call $yIsSeqItem) (local.get $map)))
        ;; a sequence item's content follows its `-` as a value follows `: `
        (local.set $colon (global.get $ylBeg))
        (if (local.get $map)
          (then
            (local.set $colon (call $yKeyEnd))
            (br_if $done (i32.ge_u (local.get $colon) (global.get $ylEnd)))))
        (if (local.get $first)
          (then (local.set $first (i32.const 0)))
          (else (call $outByte (i32.const ","))))
        (if (local.get $map)
          (then
            (call $yString (global.get $ylBeg)
              (call $trimSpaceBack (local.get $colon) (global.get $ylBeg)))
            (call $outByte (i32.const ":"))))
        (local.set $rest (call $skipSpace
          (i32.add (local.get $colon) (i32.const 1)) (global.get $ylEnd)))
        (if (i32.or (i32.ge_u (local.get $rest) (global.get $ylEnd))
              (i32.eq (i32.load8_u (local.get $rest)) (i32.const "#")))
          (then
            ;; The value starts on the following lines. A mapping's sequence
            ;; may sit in the key's own column.
            (call $yTakeLine)
            (if (i32.or (i32.gt_s (global.get $ylIndent) (local.get $indent))
                  (i32.and (local.get $map)
                    (i32.and (i32.eq (global.get $ylIndent) (local.get $indent)) (call $yIsSeqItem))))
              (then (call $yParseNode (local.get $indent)))
              (else (call $yNull))))
          (else
            (if (local.get $map)
              (then (call $yInlineValue (local.get $rest) (local.get $indent)))
              (else
                ;; The item is a node that starts here, in the column of $rest.
                (global.set $ylIndent (i32.add (local.get $indent)
                  (i32.sub (local.get $rest) (global.get $ylBeg))))
                (global.set $ylBeg (local.get $rest))
                (call $yParseNode (local.get $indent))))))
        (br $l)))
    (call $outByte (select (i32.const "}") (i32.const "]") (local.get $map)))
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
    (local $block i32)
    (local $flow i32)
    (local $fold i32)
    (local $chomp i32)
    (local $base i32)
    (local $first i32)
    (local $more i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (local.set $first (i32.const 1))
    (local.set $fold (i32.const 1))
    (local.set $end (global.get $ylEnd))
    ;; 2 for a flow collection, 1 for a quoted scalar
    (local.set $flow (i32.or
      (i32.shl (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "{")) (i32.const 1))
      (call $yIsQuote (local.get $c))))
    (if (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const ">")))
      (then
        ;; Block scalar: chomping (`-` strip, `+` keep) and an indentation digit
        ;; may follow in either order.
        (local.set $block (i32.const 1))
        (local.set $fold (i32.eq (local.get $c) (i32.const ">")))
        (local.set $chomp (i32.const 1))
        (local.set $base (i32.const -1))
        (local.set $q (local.get $p))
        (loop $indicator
          (local.set $q (i32.add (local.get $q) (i32.const 1)))
          (if (i32.lt_u (local.get $q) (global.get $ylEnd))
            (then
              (local.set $c (i32.load8_u (local.get $q)))
              (if (i32.eqz (i32.and (i32.sub (local.get $c) (i32.const "+")) (i32.const -3)))
                (then (local.set $chomp (i32.sub (i32.const "-") (local.get $c))) (br $indicator)))
              (if (i32.le_u (i32.sub (local.get $c) (i32.const "1")) (i32.const 8))
                (then
                  (local.set $base (i32.add (local.get $indent) (i32.sub (local.get $c) (i32.const "0"))))
                  (br $indicator))))))
        (call $outByte (i32.const "\22")))
      (else
        (if (i32.eqz (local.get $flow))
          (then (local.set $end (call $yTrimComment (local.get $p) (global.get $ylEnd)))))))
    ;; Later lines indented past $indent continue the scalar, and so does one
    ;; line that starts with the closer of a flow collection, which often sits
    ;; in the column of its key. Block scalar lines are raw from their
    ;; indentation on; plain lines lose spaces and comments. Folded and plain
    ;; line breaks become spaces, and blank lines between lines become line
    ;; feeds. A folded scalar keeps the line breaks around a line that is
    ;; indented further ($more is 1 on such a line and 2 on the line after).
    (local.set $q (global.get $yNext))
    (block $done
      (loop $more
        (br_if $done (i32.ge_u (local.get $q) (global.get $yEnd)))
        ;; a comment on the first line ends a plain scalar there
        (br_if $done (i32.lt_u (local.get $end) (global.get $ylEnd)))
        (local.set $e (call $findLineEnd (local.get $q)))
        (local.set $s (call $skipSpace (local.get $q) (local.get $e)))
        (if (i32.lt_u (local.get $s) (local.get $e))
          (then
            (if (i32.le_s (i32.sub (local.get $s) (local.get $q)) (local.get $indent))
              (then
                ;; Only the first such closer line is taken, so a document of
                ;; closer lines cannot be scanned once per key.
                (if (i32.and (i32.eq (local.get $flow) (i32.const 2))
                      (i32.eq (i32.or (i32.load8_u (local.get $s)) (i32.const 32)) (i32.const "}")))
                  (then (local.set $end (local.get $e))))
                (br $done))))
          (else (local.set $n (i32.add (local.get $n) (i32.const 1)))))
        ;; a flow collection or quoted scalar spans blank lines too
        (if (i32.or (local.get $flow) (i32.ge_u (local.get $s) (local.get $e)))
          (then
            (if (local.get $flow) (then (local.set $end (local.get $e))))
            (local.set $q (call $lineAfter (local.get $e)))
            (br $more)))
        (if (local.get $block)
          (then
            (if (i32.lt_s (local.get $base) (i32.const 0))
              (then (local.set $base (i32.sub (local.get $s) (local.get $q)))))
            (br_if $done (i32.lt_s (i32.sub (local.get $s) (local.get $q)) (local.get $base)))
            (local.set $s (i32.add (local.get $q) (local.get $base)))
            (local.set $more (i32.or (i32.shl (i32.and (local.get $more) (i32.const 1)) (i32.const 1))
              (call $isSpaceByte (i32.load8_u (local.get $s))))))
          (else
            (br_if $done (i32.eq (i32.load8_u (local.get $s)) (i32.const "#")))
            ;; a plain scalar becomes a string once a second line joins it
            (if (local.get $first)
              (then
                (call $outByte (i32.const "\22"))
                (call $yEscaped (local.get $p) (local.get $end) (i32.const 0))
                (local.set $first (i32.const 0))))))
        (local.set $q (call $lineAfter (local.get $e)))
        (global.set $yNext (local.get $q))
        (local.set $c (i32.and (local.get $fold) (i32.eqz (local.get $more))))
        (if (i32.and (i32.and (local.get $c) (i32.eqz (local.get $n))) (i32.eqz (local.get $first)))
          (then (call $outByte (i32.const 32))))
        (call $yNewlines (i32.add (local.get $n)
          (i32.eqz (i32.or (local.get $c) (local.get $first)))))
        (local.set $n (i32.const 0))
        (local.set $first (i32.const 0))
        (local.set $end (local.get $e))
        (if (i32.eqz (local.get $block))
          (then (local.set $end (call $yTrimComment (local.get $s)
            (local.tee $e (call $trimSpaceBack (local.get $e) (local.get $s)))))))
        (call $yEscaped (local.get $s) (local.get $end) (i32.const 0))
        ;; a comment ends a plain scalar
        (br_if $done (i32.lt_u (local.get $end) (local.get $e)))
        (br $more)))
    (if (local.get $flow)
      (then
        (local.set $q (if (result i32) (i32.and (local.get $flow) (i32.const 2))
          (then (call $yFlow (local.get $p) (local.get $end)))
          (else (call $yQuoted (local.get $p) (local.get $end)))))
        (if (i32.gt_u (local.get $q) (global.get $ylEnd))
          (then (global.set $yNext (call $lineAfter (call $findLineEnd (local.get $q)))))))
      (else
        (if (i32.and (local.get $first) (i32.eqz (local.get $block)))
          (then (call $yValue (local.get $p) (local.get $end)))
          (else
            (if (i32.and (local.get $block) (i32.eqz (local.get $first)))
              (then (call $yNewlines (select (i32.add (local.get $n) (i32.const 1))
                (local.get $chomp) (i32.eq (local.get $chomp) (i32.const 2))))))
            (call $outByte (i32.const "\22"))))))
    (call $yTakeLine))

  (func $yIsQuote (param $c i32) (result i32)
    (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'"))))

  (func $yNull
    (out.str "null"))

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
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const "\22"))
          (i32.or (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
            (i32.ne (i32.load8_u offset=1 (local.get $p)) (i32.const "'")))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (select (local.get $end) (local.get $p) (i32.gt_u (local.get $p) (local.get $end))))

  ;; The first separating $ch in [$p, $end), or $end: a `#` after a space or
  ;; tab starts a comment, and a `:` before one or the end ends a key. A
  ;; quoted scalar at $p may hold either.
  (func $yFind (param $p i32) (param $end i32) (param $ch i32) (result i32)
    (local $q i32)
    (local.set $q (local.get $p))
    (if (i32.lt_u (local.get $p) (local.get $end))
      (then
        (if (call $yIsQuote (i32.load8_u (local.get $p)))
          (then (local.set $q (call $yQuoteEnd (local.get $p) (local.get $end)))))))
    (block $done
      (loop $l
        (local.set $q (call $findByte (local.get $q) (local.get $end) (local.get $ch)))
        (br_if $done (i32.ge_u (local.get $q) (local.get $end)))
        (br_if $done (if (result i32) (i32.eq (local.get $ch) (i32.const "#"))
          (then (i32.and (i32.gt_u (local.get $q) (local.get $p))
            (call $isSpaceByte (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))))
          (else (i32.or (i32.eq (i32.add (local.get $q) (i32.const 1)) (local.get $end))
            (call $isSpaceByte (i32.load8_u offset=1 (local.get $q)))))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.get $q))

  ;; [$p, $end) without a trailing ` #` comment
  (func $yTrimComment (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local.set $q (call $yFind (local.get $p) (local.get $end) (i32.const "#")))
    (if (result i32) (i32.lt_u (local.get $q) (local.get $end))
      (then (call $trimSpaceBack (local.get $q) (local.get $p)))
      (else (local.get $end))))

  ;; A scalar or flow collection in [$p, $end), with YAML 1.2 core schema types.
  ;; The caller has cut a trailing comment: a nested collection may hold ` #`
  ;; in a quoted scalar.
  (func $yValue (param $p i32) (param $end i32)
    (local $c i32)
    (local $q i32)
    (local $n i32)
    (local $int i32)
    (local $frac i32)
    (local $exp i32)
    (local $v i64)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (call $yNull) (return)))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (call $yIsQuote (local.get $c))
      (then (drop (call $yQuoted (local.get $p) (local.get $end))) (return)))
    (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "{"))
      (then (drop (call $yFlow (local.get $p) (local.get $end))) (return)))
    (local.set $n (i32.sub (local.get $end) (local.get $p)))
    (if (i32.or (call $yWordIs (local.get $p) (local.get $n) (i64.const "null") (i32.const 4))
          (i32.and (i32.eq (local.get $n) (i32.const 1)) (i32.eq (local.get $c) (i32.const "~"))))
      (then (call $yNull) (return)))
    (if (call $yWordIs (local.get $p) (local.get $n) (i64.const "true") (i32.const 4))
      (then (out.str "true") (return)))
    (if (call $yWordIs (local.get $p) (local.get $n) (i64.const "false") (i32.const 5))
      (then (out.str "false") (return)))
    ;; JSON has no infinities or NaN; JSON.stringify writes them as null.
    (local.set $q (call $ySign (local.get $p) (local.get $end)))
    (if (i32.and (i32.eq (i32.load8_u (local.get $q)) (i32.const "."))
          (i32.eq (i32.sub (local.get $end) (local.get $q)) (i32.const 4)))
      (then
        (local.set $int (i32.and (i32.load offset=1 (local.get $q)) (i32.const 0xffffff)))
        (if (i32.or
              (call $yWordIs (i32.add (local.get $q) (i32.const 1)) (i32.const 3) (i64.const "inf") (i32.const 3))
              (i32.and (i32.eq (local.get $q) (local.get $p))
                (i32.or (i32.or (i32.eq (local.get $int) (i32.const "nan")) (i32.eq (local.get $int) (i32.const "NaN")))
                  (i32.eq (local.get $int) (i32.const "NAN")))))
          (then (call $yNull) (return)))))
    ;; 0x and 0o integers, written in decimal when they fit 64 bits
    (if (i32.and (i32.gt_u (local.get $n) (i32.const 2))
          (i32.or (i32.eq (i32.load16_u (local.get $p)) (i32.const "0x"))
            (i32.eq (i32.load16_u (local.get $p)) (i32.const "0o"))))
      (then
        ;; bits per digit
        (local.set $n (i32.add (i32.const 3) (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "x"))))
        (local.set $q (i32.add (local.get $p) (i32.const 2)))
        (block $radixDone
          (loop $radix
            (br_if $radixDone (i32.ge_u (local.get $q) (local.get $end)))
            (local.set $int (call $yHexDigit (i32.load8_u (local.get $q))))
            (br_if $radixDone (i32.or (i32.shr_u (local.get $int) (local.get $n))
              (i32.wrap_i64 (i64.shr_u (local.get $v) (i64.extend_i32_u (i32.sub (i32.const 64) (local.get $n)))))))
            (local.set $v (i64.or (i64.shl (local.get $v) (i64.extend_i32_u (local.get $n)))
              (i64.extend_i32_u (local.get $int))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $radix)))
        (if (i32.lt_u (local.get $q) (local.get $end))
          (then (call $yString (local.get $p) (local.get $end)) (return)))
        ;; digits go right to left into reserved output, then move into place
        (call $ensureOut (i32.const 20))
        (local.set $n (i32.add (global.get $out) (i32.const 20)))
        (local.set $q (local.get $n))
        (loop $digit
          (local.set $q (i32.sub (local.get $q) (i32.const 1)))
          (i64.store8 (local.get $q) (i64.add (i64.const "0") (i64.rem_u (local.get $v) (i64.const 10))))
          (local.set $v (i64.div_u (local.get $v) (i64.const 10)))
          (br_if $digit (i64.ne (local.get $v) (i64.const 0))))
        (call $outCopy (local.get $q) (local.get $n))
        (return)))
    ;; Decimal numbers: [-+] digits [. digits] [e [-+] digits], where either
    ;; the integer or the fraction may be empty. JSON needs both and no `+`.
    (local.set $int (local.get $q))
    (local.set $frac (call $ySkipDigits (local.get $q) (local.get $end)))
    (local.set $q (local.get $frac))
    (if (i32.and (i32.lt_u (local.get $q) (local.get $end)) (i32.eq (i32.load8_u (local.get $q)) (i32.const ".")))
      (then (local.set $q (call $ySkipDigits (i32.add (local.get $q) (i32.const 1)) (local.get $end)))))
    (local.set $exp (local.get $q))
    (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
          (i32.eq (i32.or (i32.load8_u (local.get $q)) (i32.const 32)) (i32.const "e")))
      (then
        (local.set $n (call $ySign (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
        (local.set $q (call $ySkipDigits (local.get $n) (local.get $end)))
        ;; an exponent needs digits
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
        (return)))
    (call $yString (local.get $p) (local.get $end)))

  ;; $p past one `-` or `+` before $end
  (func $ySign (param $p i32) (param $end i32) (result i32)
    (i32.add (local.get $p) (i32.and (i32.lt_u (local.get $p) (local.get $end))
      (i32.eqz (i32.and (i32.sub (i32.load8_u (local.get $p)) (i32.const "+")) (i32.const -3))))))

  ;; the value of hex digit $c, or a number above 15
  (func $yHexDigit (param $c i32) (result i32)
    (if (call $isDigit (local.get $c))
      (then (return (i32.sub (local.get $c) (i32.const "0")))))
    (local.set $c (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")))
    (select (i32.add (local.get $c) (i32.const 10)) (i32.const 16)
      (i32.le_u (local.get $c) (i32.const 5))))

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
  (func $yFlow (param $p i32) (param $end i32) (result i32)
    (local $close i32)
    (local $c i32)
    (local $seg i32)
    (local $q i32)
    (local $colon i32)
    (local $map i32)
    (local $n i32)
    (if (i32.gt_u (global.get $yDepth) (i32.const 32))
      (then (call $yNull) (return (local.get $end))))
    (global.set $yDepth (i32.add (global.get $yDepth) (i32.const 1)))
    (local.set $c (i32.load8_u (local.get $p)))
    (call $outByte (local.get $c))
    ;; `]` and `}` follow `[` and `{` two code points later
    (local.set $close (i32.add (local.get $c) (i32.const 2)))
    (local.set $map (i32.eq (local.get $c) (i32.const "{")))
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
        ;; an item takes at least one byte, so the loop advances
        (local.set $seg (call $yFlowItemEnd (local.get $p) (local.get $end)))
        (local.set $seg (i32.add (local.get $seg) (i32.eq (local.get $seg) (local.get $p))))
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
        ;; an empty value is null
        (call $yValue (local.get $p) (local.get $seg))
        (local.set $p (local.get $seg))
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
        ;; the item start counts as a space
        (local.set $prev (if (result i32) (i32.gt_u (local.get $p) (local.get $start))
          (then (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))) (else (i32.const 32))))
        (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "{"))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "}"))
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
                (br_if $done (i32.or
                  (i32.or (call $isWhiteByte (local.get $next)) (i32.eq (local.get $next) (i32.const ",")))
                  (i32.or (i32.eq (i32.or (local.get $next) (i32.const 32)) (i32.const "}"))
                    (call $yIsQuote (local.get $prev)))))))))
        (if (i32.and (i32.and (call $yIsQuote (local.get $c))
              (i32.or (i32.ne (local.get $depth) (i32.const 0)) (i32.eq (local.get $p) (local.get $start))))
              (i32.or
                (i32.or (call $isWhiteByte (local.get $prev)) (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "{")))
                (i32.or (i32.eq (local.get $prev) (i32.const ",")) (i32.eq (local.get $prev) (i32.const ":")))))
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
              (call $yIsQuote (local.get $c))
              (i32.eq (call $yQuoteEnd (local.get $p) (local.get $end)) (i32.sub (local.get $end) (i32.const 1))))
          (then (drop (call $yQuoted (local.get $p) (local.get $end))) (return)))))
    (call $outByte (i32.const "\22"))
    (call $yEscaped (local.get $p) (local.get $end) (i32.const 0))
    (call $outByte (i32.const "\22")))

  ;; Write the quoted scalar that opens at $p as a JSON string, and return the
  ;; position of its closing quote, or $end.
  (func $yQuoted (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local.set $q (call $yQuoteEnd (local.get $p) (local.get $end)))
    (call $outByte (i32.const "\22"))
    (call $yEscaped (i32.add (local.get $p) (i32.const 1)) (local.get $q) (i32.load8_u (local.get $p)))
    (call $outByte (i32.const "\22"))
    (local.get $q))

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
                  ;; Lanes 0-6 are escapes that JSON spells the same way, 7-8
                  ;; escapes it does not need, and 9-15 named control and
                  ;; space characters.
                  (local.set $i (i8x16.bitmask (i8x16.eq (i8x16.splat (local.get $c))
                    (v128.const i8x16 0x62 0x74 0x6e 0x66 0x72 0x22 0x5c 0x2f 0x20 0x09 0x30 0x61 0x76 0x65 0x4e 0x5f))))
                  (if (i32.and (local.get $i) (i32.const 0x7f)) (then (call $outByte (i32.const "\5c"))))
                  (if (i32.and (local.get $i) (i32.const 0x1ff)) (then (call $outByte (local.get $c)) (br $written)))
                  ;; Lanes 9-15 hold their value plus one. A miss has ctz 32, and
                  ;; lane 32 reads as 0, so its value is -1.
                  (local.set $v (i32.sub (i8x16.extract_lane_u 0 (i8x16.swizzle
                    (v128.const i8x16 0 0 0 0 0 0 0 0 0 0x0a 0x01 0x08 0x0c 0x1c 0x86 0xa1)
                    (i8x16.splat (i32.ctz (local.get $i))))) (i32.const 1)))
                  ;; `\L` and `\P` are line and paragraph separators; `\x`, `\u` and
                  ;; `\U` take two, four and eight hex digits
                  (local.set $i (i8x16.bitmask (i8x16.eq (i8x16.splat (local.get $c))
                    (v128.const i8x16 0x4c 0x50 0x78 0x75 0x55 0 0 0 0 0 0 0 0 0 0 0))))
                  (if (i32.and (local.get $i) (i32.const 3))
                    (then (local.set $v (i32.add (i32.const 0x2027) (local.get $i)))))
                  (local.set $i (i32.and (i32.shr_u (local.get $i) (i32.const 1)) (i32.const 14)))
                  (if (i32.and (i32.ne (local.get $i) (i32.const 0))
                        (i32.le_u (i32.add (i32.add (local.get $p) (i32.const 2)) (local.get $i)) (local.get $end)))
                    (then
                      (local.set $v (i32.const 0))
                      (local.set $i (i32.add (local.get $i) (i32.const 2)))
                      (block $hexDone
                        (loop $hex
                          (local.set $d (call $yHexDigit (i32.load8_u (i32.add (local.get $p) (local.get $n)))))
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
    (local $i i32)
    (out.str "\5cu")
    (local.set $i (i32.const 16))
    (loop $digit
      (local.set $i (i32.sub (local.get $i) (i32.const 4)))
      (call $outByte (i32.load8_u offset=$mem.hexdigits
        (i32.and (i32.shr_u (local.get $v) (local.get $i)) (i32.const 15))))
      (br_if $digit (local.get $i))))
)
