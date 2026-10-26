(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./htmlscan.wat")

  ;; Per-line cursors, mirroring the reference parser: $pos/$col are the byte
  ;; and (tab-expanded) column cursor, $fns/$fnsCol memoize the first byte that
  ;; is neither space nor tab, and $ptab records that a column advance stopped
  ;; inside a tab.
  (global $pos (mut i32) (i32.const 0))
  (global $col (mut i32) (i32.const 0))
  (global $ptab (mut i32) (i32.const 0))
  (global $fns (mut i32) (i32.const 0))
  (global $fnsCol (mut i32) (i32.const 0))
  (global $indent (mut i32) (i32.const 0))
  (global $blank (mut i32) (i32.const 0))
  (global $lineEnd (mut i32) (i32.const 0))

  ;; scanner results
  (global $atxLevel (mut i32) (i32.const 0))
  (global $lmOrdered (mut i32) (i32.const 0))
  (global $lmChar (mut i32) (i32.const 0))
  (global $lmStart (mut i32) (i32.const 0))

  ;; advance $count bytes (or columns, when $columns is set) from $pos,
  ;; expanding tabs to the next multiple of four
  (func $advance (param $count i32) (param $columns i32)
    (local $c i32)
    (local $toTab i32)
    (local $n i32)
    (local $p i32)
    (local $column i32)
    (local $partial i32)
    (local $end i32)
    (local.set $p (global.get $pos))
    (local.set $column (global.get $col))
    (local.set $partial (global.get $ptab))
    (local.set $end (global.get $lineEnd))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $count)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const 9))
          (then
            (local.set $toTab
              (i32.sub (i32.const 4) (i32.and (local.get $column) (i32.const 3))))
            (if (local.get $columns)
              (then
                (local.set $partial (i32.gt_u (local.get $toTab) (local.get $count)))
                (local.set $n (select (local.get $count) (local.get $toTab)
                  (local.get $partial)))
                (local.set $column (i32.add (local.get $column) (local.get $n)))
                (if (i32.eqz (local.get $partial))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (local.set $count (i32.sub (local.get $count) (local.get $n))))
              (else
                (local.set $partial (i32.const 0))
                (local.set $column (i32.add (local.get $column) (local.get $toTab)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $count (i32.sub (local.get $count) (i32.const 1))))))
          (else
            (local.set $partial (i32.const 0))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $column (i32.add (local.get $column) (i32.const 1)))
            (local.set $count (i32.sub (local.get $count) (i32.const 1)))))
        (br $l)))
    (global.set $pos (local.get $p))
    (global.set $col (local.get $column))
    (global.set $ptab (local.get $partial)))

  ;; advance $pos to the first byte that is neither space nor tab, without
  ;; expanding a tab that the cursor is standing on
  (func $advanceToFns
    (call $findFirstNonspace)
    (global.set $pos (global.get $fns))
    (global.set $col (global.get $fnsCol))
    (global.set $ptab (i32.const 0)))

  (func $findFirstNonspace
    (local $c i32)
    (local $toTab i32)
    (local $p i32)
    (local $column i32)
    (local $first i32)
    (local $firstCol i32)
    (local $end i32)
    (local.set $p (global.get $pos))
    (local.set $column (global.get $col))
    (local.set $first (global.get $fns))
    (local.set $firstCol (global.get $fnsCol))
    (local.set $end (global.get $lineEnd))
    (if (i32.le_u (local.get $first) (local.get $p))
      (then
        (local.set $first (local.get $p))
        (local.set $firstCol (local.get $column))
        (local.set $toTab
          (i32.sub (i32.const 4) (i32.and (local.get $column) (i32.const 3))))
        (block $done
          (loop $l
            (br_if $done (i32.ge_u (local.get $first) (local.get $end)))
            (local.set $c (i32.load8_u (local.get $first)))
            (if (i32.eq (local.get $c) (i32.const 32))
              (then
                (local.set $first (i32.add (local.get $first) (i32.const 1)))
                (local.set $firstCol (i32.add (local.get $firstCol) (i32.const 1)))
                (local.set $toTab (i32.sub (local.get $toTab) (i32.const 1)))
                (if (i32.eqz (local.get $toTab)) (then (local.set $toTab (i32.const 4)))))
              (else
                (br_if $done (i32.ne (local.get $c) (i32.const 9)))
                (local.set $first (i32.add (local.get $first) (i32.const 1)))
                (local.set $firstCol (i32.add (local.get $firstCol) (local.get $toTab)))
                (local.set $toTab (i32.const 4))))
            (br $l)))))
    (global.set $fns (local.get $first))
    (global.set $fnsCol (local.get $firstCol))
    (global.set $indent (i32.sub (local.get $firstCol) (local.get $column)))
    (global.set $blank (i32.ge_u (local.get $first) (local.get $end))))

  ;; three or more matching `-`, `_` or `*`, with spaces and tabs allowed
  ;; between and after them
  (func $scanThematicBreak (param $p i32) (result i32)
    (local $c i32)
    (local $nc i32)
    (local $count i32)
    (local $i i32)
    (if (i32.ge_u (local.get $p) (global.get $lineEnd)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const "*"))
          (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "-")))))
      (then (return (i32.const 0))))
    (local.set $count (i32.const 1))
    (local.set $i (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (global.get $lineEnd)))
        (local.set $nc (i32.load8_u (local.get $i)))
        (if (i32.eq (local.get $nc) (local.get $c))
          (then (local.set $count (i32.add (local.get $count) (i32.const 1))))
          (else (if (i32.eqz (call $isSpaceByte (local.get $nc)))
            (then (return (i32.const 0))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (if (i32.lt_u (local.get $count) (i32.const 3)) (then (return (i32.const 0))))
    (i32.sub (local.get $i) (local.get $p)))

  ;; one to six `#` followed by spaces, tabs, or the end of the line;
  ;; returns the bytes to consume and leaves the level in $atxLevel
  (func $scanAtxStart (param $p i32) (result i32)
    (local $i i32)
    (local $n i32)
    (local.set $i (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (global.get $lineEnd)))
        (br_if $done (i32.ne (i32.load8_u (local.get $i)) (i32.const "#")))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (local.set $n (i32.sub (local.get $i) (local.get $p)))
    (if (i32.or (i32.eqz (local.get $n)) (i32.gt_u (local.get $n) (i32.const 6)))
      (then (return (i32.const 0))))
    (if (i32.lt_u (local.get $i) (global.get $lineEnd))
      (then
        (if (i32.eqz (call $isSpaceByte (i32.load8_u (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (call $skipSpace (local.get $i) (global.get $lineEnd)))))
    (global.set $atxLevel (local.get $n))
    (i32.sub (local.get $i) (local.get $p)))

  ;; three or more backticks or tildes; a backtick fence may not be followed by
  ;; a backtick anywhere on the line
  (func $scanOpenFence (param $p i32) (result i32)
    (local $c i32)
    (local $i i32)
    (local $n i32)
    (if (i32.ge_u (local.get $p) (global.get $lineEnd)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const "\60"))
          (i32.eq (local.get $c) (i32.const "~"))))
      (then (return (i32.const 0))))
    (local.set $i (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (global.get $lineEnd)))
        (br_if $done (i32.ne (i32.load8_u (local.get $i)) (local.get $c)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (local.set $n (i32.sub (local.get $i) (local.get $p)))
    (if (i32.lt_u (local.get $n) (i32.const 3)) (then (return (i32.const 0))))
    (if (i32.eq (local.get $c) (i32.const "\60"))
      (then
        (if (i32.lt_u (call $findByte (local.get $i) (global.get $lineEnd) (i32.const "\60"))
              (global.get $lineEnd))
          (then (return (i32.const 0))))))
    (i32.sub (local.get $i) (local.get $p)))

  ;; a bullet or ordered list marker; returns its width in bytes and leaves the
  ;; kind in $lmOrdered / $lmChar / $lmStart
  (func $parseListMarker (param $p i32) (param $interrupts i32) (result i32)
    (local $c i32)
    (local $q i32)
    (local $digits i32)
    (local $start i32)
    (if (i32.ge_u (local.get $p) (global.get $lineEnd)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or
          (i32.le_u (i32.sub (local.get $c) (i32.const "*")) (i32.const 1))
          (i32.eq (local.get $c) (i32.const "-")))
      (then
        (local.set $q (i32.add (local.get $p) (i32.const 1)))
        (if (i32.lt_u (local.get $q) (global.get $lineEnd))
          (then
            (if (i32.eqz (call $isSpaceByte (i32.load8_u (local.get $q))))
              (then (return (i32.const 0))))))
        (if (local.get $interrupts)
          (then
            (if (i32.ge_u (call $skipSpace (local.get $q) (global.get $lineEnd)) (global.get $lineEnd))
              (then (return (i32.const 0))))))
        (global.set $lmOrdered (i32.const 0))
        (global.set $lmChar (local.get $c))
        (global.set $lmStart (i32.const 1))
        (return (i32.const 1))))
    (if (i32.eqz (call $isDigit (local.get $c))) (then (return (i32.const 0))))
    (local.set $q (local.get $p))
    (loop $digit
      (local.set $start (i32.add (i32.mul (local.get $start) (i32.const 10))
        (i32.sub (i32.load8_u (local.get $q)) (i32.const "0"))))
      (local.set $q (i32.add (local.get $q) (i32.const 1)))
      (local.set $digits (i32.add (local.get $digits) (i32.const 1)))
      (br_if $digit (i32.and
        (i32.lt_u (local.get $digits) (i32.const 9))
        (i32.and
          (i32.lt_u (local.get $q) (global.get $lineEnd))
          (call $isDigit (i32.load8_u (local.get $q)))))))
    (if (i32.and (local.get $interrupts) (i32.ne (local.get $start) (i32.const 1)))
      (then (return (i32.const 0))))
    (if (i32.ge_u (local.get $q) (global.get $lineEnd)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $q)))
    (if (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const "."))
          (i32.eq (local.get $c) (i32.const ")"))))
      (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $q) (i32.const 1)))
    (if (i32.lt_u (local.get $q) (global.get $lineEnd))
      (then
        (if (i32.eqz (call $isSpaceByte (i32.load8_u (local.get $q))))
          (then (return (i32.const 0))))))
    (if (local.get $interrupts)
      (then
        (if (i32.ge_u (call $skipSpace (local.get $q) (global.get $lineEnd)) (global.get $lineEnd))
          (then (return (i32.const 0))))))
    (global.set $lmOrdered (i32.const 1))
    (global.set $lmChar (local.get $c))
    (global.set $lmStart (local.get $start))
    (i32.sub (local.get $q) (local.get $p)))

  ;; a GFM footnote definition, `[^label]:`; returns the bytes to consume
  (func $scanFootnoteDef (param $p i32) (result i32)
    (local $q i32)
    (local $c i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 4)) (global.get $lineEnd))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load16_u (local.get $p)) (i32.const "[^")) (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 2)))
    (block $found
      (loop $l
        (if (i32.ge_u (local.get $q) (global.get $lineEnd)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.eq (local.get $c) (i32.const "[")) (then (return (i32.const 0))))
        (br_if $found (i32.eq (local.get $c) (i32.const "]")))
        (if (call $isWhiteByte (local.get $c)) (then (return (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const "\5c"))
          (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (if (i32.eq (local.get $q) (i32.add (local.get $p) (i32.const 2)))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u offset=1 (local.get $q)) (i32.const ":")) (then (return (i32.const 0))))
    (i32.sub (i32.add (local.get $q) (i32.const 2)) (local.get $p)))

  ;; the HTML block type (1..7) starting at $p, or 0. Type 7 is only offered
  ;; when $allow7 is set, because it may not interrupt a paragraph.
  (func $scanHtmlStart (param $p i32) (param $allow7 i32) (result i32)
    (local $end i32)
    (local $q i32)
    (local $n i32)
    (local.set $end (global.get $lineEnd))
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "<")) (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    ;; type 2: <!--
    (if (i32.le_u (i32.add (local.get $q) (i32.const 3)) (local.get $end))
      (then
        (if (i32.eq (i32.load (local.get $p)) (i32.const "<!--")) (then (return (i32.const 2))))))
    ;; type 3: <?
    (if (i32.eq (i32.load8_u (local.get $q)) (i32.const "?")) (then (return (i32.const 3))))
    ;; type 5: <![CDATA[
    (if (i32.le_u (i32.add (local.get $p) (i32.const 9)) (local.get $end))
      (then
        (if (i32.and
              (i64.eq (i64.load (local.get $p)) (i64.const "<![CDATA"))
              (i32.eq (i32.load8_u offset=8 (local.get $p)) (i32.const "[")))
          (then (return (i32.const 5))))))
    ;; type 4: <! followed by an ASCII letter
    (if (i32.eq (i32.load8_u (local.get $q)) (i32.const "!"))
      (then
        (if (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (local.get $end))
          (then (return (i32.const 0))))
        (if (call $isAlpha (i32.load8_u offset=1 (local.get $q))) (then (return (i32.const 4))))
        (return (i32.const 0))))
    ;; type 1: <pre <script <style <textarea
    (if (call $scanType1 (local.get $q) (local.get $end)) (then (return (i32.const 1))))
    ;; type 6: an optional `/` then a known block tag name
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.eq (i32.load8_u (local.get $q)) (i32.const "/"))
      (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
    (local.set $n (call $scanTagName (local.get $q) (local.get $end)))
    (if (local.get $n)
      (then
        (if (call $wordLookup
              (i32.const $mem.blockTags) (local.get $q) (local.get $n) (i32.const 10))
          (then
            (local.set $q (i32.add (local.get $q) (local.get $n)))
            (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 6))))
            (if (i32.or
                  (call $isTagSpace (i32.load8_u (local.get $q)))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const ">")))
              (then (return (i32.const 6))))
            (if (i32.eq (i32.load16_u (local.get $q)) (i32.const "/>"))
              (then (return (i32.const 6))))))))
    ;; type 7: a complete tag alone on the line
    (if (i32.eqz (local.get $allow7)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/"))
      (then
        (local.set $q
          (call $scanCloseTag (i32.add (local.get $p) (i32.const 2))
            (local.get $end))))
      (else
        (local.set $q
          (call $scanOpenTag (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))
    (if (i32.eqz (local.get $q)) (then (return (i32.const 0))))
    (if (i32.lt_u (call $skipSpace (local.get $q) (local.get $end)) (local.get $end))
      (then (return (i32.const 0))))
    (i32.const 7))

  ;; `<pre`, `<script`, `<style` or `<textarea` followed by whitespace, `>` or
  ;; the end of the line; $p points just past `<`
  (func $scanType1 (param $p i32) (param $end i32) (result i32)
    (local $n i32)
    (local $q i32)
    (local.set $n (call $scanTagName (local.get $p) (local.get $end)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (if (i32.eqz (i32.or
          (i32.or
            (call $wordEq (local.get $p) (local.get $n) (i64.const "pre") (i32.const 3))
            (call $wordEq (local.get $p) (local.get $n) (i64.const "script") (i32.const 6)))
          (i32.or
            (call $wordEq (local.get $p) (local.get $n) (i64.const "style") (i32.const 5))
            (call $wordEq (local.get $p) (local.get $n) (i64.const "textarea") (i32.const 8)))))
      (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (local.get $n)))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 1))))
    (i32.or
      (call $isTagSpace (i32.load8_u (local.get $q)))
      (i32.eq (i32.load8_u (local.get $q)) (i32.const ">"))))

  ;; case-insensitive comparison of [$p,$p+$len) against up to eight packed bytes
  (func $wordEq (param $p i32) (param $len i32) (param $word i64) (param $n i32) (result i32)
    (if (i32.ne (local.get $len) (local.get $n)) (then (return (i32.const 0))))
    (i64.eqz (i64.shl
      (i64.xor
        (i64.or (i64.load (local.get $p)) (i64.const 0x2020202020202020))
        (local.get $word))
      (i64.mul (i64.const 8)
        (i64.extend_i32_u (i32.sub (i32.const 8) (local.get $n)))))))

  ;; does the line from $p meet the end condition of an HTML block of $kind?
  (func $scanHtmlBlockEnd (param $kind i32) (param $p i32) (result i32)
    (local $end i32)
    (local $q i32)
    (local $n i32)
    (local.set $end (global.get $lineEnd))
    (if (i32.eq (local.get $kind) (i32.const 1))
      (then
        (block $done
          (loop $l
            (local.set $p (call $findByte (local.get $p) (local.get $end) (i32.const "<")))
            (br_if $done (i32.ge_u (i32.add (local.get $p) (i32.const 2)) (local.get $end)))
            (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/"))
              (then
                (local.set $q (i32.add (local.get $p) (i32.const 2)))
                (local.set $n (call $scanTagName (local.get $q) (local.get $end)))
                (if (i32.and (i32.ne (local.get $n) (i32.const 0))
                      (i32.and
                        (i32.lt_u (i32.add (local.get $q) (local.get $n)) (local.get $end))
                        (i32.eq (i32.load8_u (i32.add (local.get $q) (local.get $n))) (i32.const ">"))))
                  (then
                    (if (i32.or
                          (i32.or
                            (call $wordEq (local.get $q) (local.get $n) (i64.const "pre") (i32.const 3))
                            (call $wordEq (local.get $q) (local.get $n) (i64.const "script") (i32.const 6)))
                          (i32.or
                            (call $wordEq (local.get $q) (local.get $n) (i64.const "style") (i32.const 5))
                            (call $wordEq (local.get $q) (local.get $n) (i64.const "textarea") (i32.const 8))))
                      (then (return (i32.const 1))))))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (return (i32.const 0))))
    (if (i32.eq (local.get $kind) (i32.const 2))
      (then (return (call $containsSeq (local.get $p) (local.get $end) (i32.const "-->") (i32.const 3)))))
    (if (i32.eq (local.get $kind) (i32.const 3))
      (then (return (call $containsSeq (local.get $p) (local.get $end) (i32.const "?>") (i32.const 2)))))
    (if (i32.eq (local.get $kind) (i32.const 4))
      (then (return (i32.lt_u (call $findByte (local.get $p) (local.get $end) (i32.const ">"))
        (local.get $end)))))
    (if (i32.eq (local.get $kind) (i32.const 5))
      (then (return (call $containsSeq (local.get $p) (local.get $end) (i32.const "]]>") (i32.const 3)))))
    (i32.const 0))

  ;; does [$p,$end) contain the $n-byte sequence packed in $seq?
  (func $containsSeq (param $p i32) (param $end i32) (param $seq i32) (param $n i32) (result i32)
    (local $mask i32)
    (local.set $mask (i32.sub (i32.shl (i32.const 1) (i32.mul (local.get $n) (i32.const 8))) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $findByte (local.get $p) (local.get $end)
          (i32.and (local.get $seq) (i32.const 255))))
        (br_if $done (i32.gt_u (i32.add (local.get $p) (local.get $n)) (local.get $end)))
        (if (i32.eq (i32.and (i32.load (local.get $p)) (local.get $mask)) (local.get $seq))
          (then (return (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; a GFM table delimiter row; returns the column count and writes one
  ;; alignment byte per column to $mem.align
  (func $scanTableDelimRow (param $p i32) (result i32)
    (local $end i32)
    (local $cols i32)
    (local $align i32)
    (local $q i32)
    (local.set $end (global.get $lineEnd))
    (local.set $p (call $skipSpace (local.get $p) (local.get $end)))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "|"))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (block $rowDone
      (loop $cell
        (local.set $p (call $skipSpace (local.get $p) (local.get $end)))
        (local.set $align (i32.const 0))
        (if (i32.and (i32.lt_u (local.get $p) (local.get $end))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))
          (then
            (local.set $align (i32.const 1))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (local.set $q (local.get $p))
        (block $dashDone
          (loop $dash
            (br_if $dashDone (i32.ge_u (local.get $p) (local.get $end)))
            (br_if $dashDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "-")))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $dash)))
        (if (i32.eq (local.get $p) (local.get $q)) (then (return (i32.const 0))))
        (if (i32.and (i32.lt_u (local.get $p) (local.get $end))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))
          (then
            (local.set $align (i32.or (local.get $align) (i32.const 2)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (local.set $p (call $skipSpace (local.get $p) (local.get $end)))
        (if (i32.ge_u (local.get $cols) (i32.const 512)) (then (return (i32.const 0))))
        (i32.store8 (i32.add (i32.const $mem.align) (local.get $cols))
          (i32.xor (local.get $align)
            (i32.shr_u (local.get $align) (i32.const 1))))
        (local.set $cols (i32.add (local.get $cols) (i32.const 1)))
        (br_if $rowDone (i32.ge_u (local.get $p) (local.get $end)))
        (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "|"))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $rowDone (i32.ge_u (call $skipSpace (local.get $p) (local.get $end)) (local.get $end)))
        (br $cell)))
    (local.get $cols))

  ;; the number of cells the line [$beg,$end) parses into, or 0 when it is not
  ;; a table row
  (func $countRowCells (param $beg i32) (param $end i32) (result i32)
    (local $p i32)
    (local $cellStart i32)
    (local $n i32)
    (local $c i32)
    (local.set $p (local.get $beg))
    (if (i32.and (i32.lt_u (local.get $p) (local.get $end))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const "|")))
      (then (local.set $p (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))
    (block $done
      (loop $cell
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $cellStart (local.get $p))
        (block $cellDone
          (loop $byte
            (br_if $cellDone (i32.ge_u (local.get $p) (local.get $end)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if (i32.eq (local.get $c) (i32.const "\5c"))
              (then
                (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                      (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 2)))
                    (br $byte)))))
            (br_if $cellDone (i32.eq (local.get $c) (i32.const "|")))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $byte)))
        ;; The byte scan can stop only at the end or at an unescaped pipe.
        (if (i32.lt_u (local.get $p) (local.get $end))
          (then
            (local.set $n (i32.add (local.get $n) (i32.const 1)))
            (local.set $p
              (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
            (br $cell)))
        (if (i32.gt_u (local.get $p) (local.get $cellStart))
          (then (local.set $n (i32.add (local.get $n) (i32.const 1)))))))
    (local.get $n))
)
