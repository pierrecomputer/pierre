(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./frontmatter.wat")
  (import "./htmlscan.wat")
  (import "./link.wat")
  (import "./extlink.wat")
  (import "./inline.wat")
  (import "./record.wat")
  (import "./block.wat")

  ;; The input position just past a delivery-ending link label. Inline analysis
  ;; repairs that label once real references have failed.
  (global $completeClosedLabelEnd (mut i32) (i32.const 0))
  ;; The input position of the placeholder destination that completion wrote.
  (global $completePlaceholder (mut i32) (i32.const 0))

  ;; Write the closers of delimiter stack entries [$bottom, $top) at $at,
  ;; innermost first, and return the position after them.
  (func $completeClosers (param $at i32) (param $stack i32) (param $bottom i32) (param $top i32) (result i32)
    (local $e i32)
    (local $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.le_u (local.get $top) (local.get $bottom)))
        (local.set $top (i32.sub (local.get $top) (i32.const 1)))
        (local.set $e (i32.add (local.get $stack) (i32.shl (local.get $top) (i32.const 4))))
        (local.set $n (i32.load offset=4 (local.get $e)))
        (memory.fill (local.get $at) (i32.load (local.get $e)) (local.get $n))
        (local.set $at (i32.add (local.get $at) (local.get $n)))
        (br $l)))
    (local.get $at))

  ;; The input position of content offset $off. Rebuilt content finds it through
  ;; the lines of record $r.
  (func $completeInputAt (param $r i32) (param $off i32) (result i32)
    (local $line i32)
    (local $len i32)
    (if (i32.lt_u (global.get $contentBase) (global.get $eof))
      (then (return (i32.add (global.get $contentBase) (local.get $off)))))
    (local.set $line (call $recLines (local.get $r)))
    (loop $lines
      (local.set $len (i32.sub (call $lineEndOf (local.get $line)) (call $lineBeg (local.get $line))))
      (if (i32.gt_u (local.get $off) (local.get $len))
        (then
          (local.set $off (i32.sub (local.get $off) (i32.add (local.get $len) (i32.const 1))))
          (local.set $line (i32.add (local.get $line) (i32.const $R.line)))
          (br $lines))))
    (i32.add (call $lineBeg (local.get $line)) (local.get $off)))

  ;; Complete a streaming input after block analysis, so repair follows the
  ;; parser's blocks. Only the block that the next bytes can extend is scanned,
  ;; over the content inline analysis will read. Code spans, raw HTML, link
  ;; destinations, and bare URLs are skipped whole, as inline analysis does. A
  ;; bounded stack of open delimiter runs pairs closers as the parser does
  ;; (flanking, nearest opener, rule of three) and supplies the missing closing
  ;; markers. Where it cannot be sure a closer would pair, it writes none: a
  ;; closer that does not pair would show as text the user did not type.
  ;; Returns whether the input changed, which needs another parse.
  ;; $firstItemBlock says the block is the first in a list item, where `[x]`
  ;; can become a task marker.
  (func $complete (param $firstItemBlock i32) (result i32)
    (local $r i32) (local $type i32) (local $line i32) (local $last i32)
    (local $base i32) (local $p i32) (local $q i32) (local $t i32) (local $e i32)
    (local $c i32) (local $n i32) (local $prev i32) (local $next i32)
    (local $k i32) (local $flags i32) (local $m i32) (local $join i32) (local $glue i32)
    (local $esc i32) (local $at i32) (local $low i32) (local $dirty i32)
    (local $depth i32) (local $top i32) (local $remaining i32)
    (local $links i32) (local $extra i32) (local $meta i32) (local $open i32) (local $openDepth i32)
    (local $tick i32) (local $cut i32)
    (local $closeAt i32) (local $from i32) (local $to i32)
    (local.set $r (global.get $leafRec))
    (if (i32.eqz (local.get $r)) (then (return (i32.const 0))))
    (local.set $type (i32.load8_u (local.get $r)))
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    ;; A paragraph proved literal holds no syntax to repair.
    (if (i32.or (i32.or (i32.eqz (local.get $n)) (i32.eq (local.get $type) (enum.get $Blk.code)))
          (i32.and (i32.load8_u offset=1 (local.get $r)) (i32.const $F.plainInline)))
      (then (return (i32.const 0))))
    (local.set $line (call $lineAt (local.get $r) (i32.sub (local.get $n) (i32.const 1))))
    (local.set $last (call $lineEndOf (local.get $line)))
    (if (i32.eq (local.get $type) (enum.get $Blk.p))
      (then
        ;; A paragraph can continue after one line break and indentation.
        (if (i32.lt_u
              (call $skipSpace
                (call $lineAfter (call $skipSpace (local.get $last) (global.get $eof)))
                (global.get $eof))
              (global.get $eof))
          (then (return (i32.const 0))))
        (drop (call $blockContent (local.get $r))))
      (else
        ;; Headings, table rows, and HTML lines end at their line break. Raw
        ;; HTML that skipHtml drops needs no repair.
        (if (i32.or (i32.lt_u (call $findLineEnd (local.get $last)) (global.get $eof))
              (i32.and (i32.eq (local.get $type) (enum.get $Blk.html))
                (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 2)) (i32.const 0))))
          (then (return (i32.const 0))))
        (if (i32.eq (local.get $type) (enum.get $Blk.heading))
          (then (drop (call $blockContent (local.get $r))))
          (else
            (local.set $q (call $lineBeg (local.get $line)))
            ;; Cells parse apart, so a table row repairs only its last cell.
            (if (i32.eq (local.get $type) (enum.get $Blk.table))
              (then
                (local.set $t (local.get $q))
                (block $cells
                  (loop $cell
                    (local.set $t (call $findCellBoundary (local.get $t) (local.get $last)))
                    (br_if $cells (i32.ge_u (local.get $t) (local.get $last)))
                    (if (i32.eq (i32.load8_u (local.get $t)) (i32.const "\5c"))
                      (then
                        (local.set $t (i32.add (local.get $t) (i32.add (i32.const 1)
                          (call $isAsciiPunct (i32.load8_u offset=1 (local.get $t)))))))
                      (else
                        (local.set $t (i32.add (local.get $t) (i32.const 1)))
                        (local.set $q (local.get $t))))
                    (br $cell)))
                (local.set $q (call $skipSpace (local.get $q) (local.get $last)))))
            (global.set $contentBase (local.get $q))
            (global.set $contentLen (i32.sub (local.get $last) (local.get $q)))
            (global.set $contentInputEnd (local.get $last))))))
    (local.set $e (global.get $contentLen))
    (if (i32.eqz (local.get $e)) (then (return (i32.const 0))))
    (call $inlineReset)
    (local.set $cut (local.get $e))
    (local.set $base (global.get $contentBase))
    ;; The start of a task marker stays hidden until the item shows what it is.
    (if (i32.and (i32.and (local.get $firstItemBlock) (i32.le_u (local.get $e) (i32.const 3)))
          (i32.and (i32.eq (local.get $type) (enum.get $Blk.p))
            (i32.eq (i32.load8_u (local.get $base)) (i32.const "["))))
      (then
        (local.set $c (i32.load8_u offset=1 (local.get $base)))
        (if (i32.or (i32.eq (local.get $e) (i32.const 1))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const 32))
                  (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "x")))
                (i32.or (i32.eq (local.get $e) (i32.const 2))
                  (i32.eq (i32.load8_u offset=2 (local.get $base)) (i32.const "]")))))
          (then
            (local.set $cut (i32.const 0))
            (local.set $e (i32.const 0))))))
    (block $done
      (loop $scan
        ;; Link and bare URL scans can grow scratch and move rebuilt content.
        (local.set $base (global.get $contentBase))
        (block $found
          (loop $find
            (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
            (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
            ;; * . : < [ \ ] _ ` ~
            (br_if $found (call $byteIn (local.get $c)
              (i64.const 0x1400440000000000) (i64.const 0x40000001b8000000)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $find)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (local.set $q (i32.add (local.get $base) (local.get $p)))
            (local.set $t (i32.add (local.get $base) (local.get $e)))
            (global.set $tagAtEnd (i32.const 0))
            (local.set $n (call $scanAutolinkUri (local.get $q) (local.get $t)))
            (if (i32.eqz (local.get $n))
              (then (local.set $n (call $scanAutolinkEmail (local.get $q) (local.get $t)))))
            (if (i32.eqz (local.get $n))
              (then (local.set $n (call $scanHtmlAny (local.get $q) (local.get $t)))))
            (if (local.get $n)
              (then
                (local.set $p (i32.sub (local.get $n) (local.get $base)))
                (br $scan)))
            ;; An unfinished tag on the last line is dropped with what follows
            ;; it. A `<` right after a word is more likely a comparison or a
            ;; generic type, whose words would look like attributes.
            (if (global.get $tagAtEnd)
              (then
                (if (i32.and
                      (i32.eqz (i32.and (i32.ne (local.get $p) (i32.const 0))
                        (call $isAlnum (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))))
                      (i32.ge_u (call $findByte (local.get $q) (local.get $t) (i32.const 10)) (local.get $t)))
                  (then
                    (local.set $cut (local.get $p))
                    (br $done)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        ;; Raw HTML keeps everything but an unfinished tag.
        (if (i32.eq (local.get $type) (enum.get $Blk.html))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        ;; Only ASCII punctuation is escaped.
        (if (i32.eq (local.get $c) (i32.const "\5c"))
          (then
            (local.set $p (i32.add (local.get $p) (i32.add (i32.const 1)
              (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $e))
                (call $isAsciiPunct
                  (i32.load8_u offset=1 (i32.add (local.get $base) (local.get $p))))))))
            ;; an escaped `!` before a `[` starts no image
            (local.set $esc (local.get $p))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $nSlots (i32.const 0))
            (global.set $bracketSp (i32.add (local.get $links) (local.get $extra)))
            (local.set $p (call $tryUrlAutolink (local.get $p) (local.get $e)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $nSlots (i32.const 0))
            (global.set $bracketSp (i32.add (local.get $links) (local.get $extra)))
            (local.set $p (call $tryWwwAutolink (local.get $p) (local.get $e)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            ;; An entry holds the offset after the `[`, then the emphasis depth
            ;; there, bit 8 for an image, bit 9 when this bracket cannot end as a
            ;; link, because a link cannot hold a link, and bit 10 for `[^`: it
            ;; may be a footnote reference and never shows as a pending link.
            ;; Past the limit brackets are only counted.
            (if (i32.lt_u (local.get $links) (i32.const 64))
              (then
                (local.set $top (i32.add (i32.const $mem.completeLinks) (i32.shl (local.get $links) (i32.const 3))))
                (i32.store (local.get $top) (i32.add (local.get $p) (i32.const 1)))
                (i32.store offset=4 (local.get $top) (i32.or (local.get $depth) (i32.or
                  (i32.shl (i32.and (i32.ne (local.get $p) (local.get $esc))
                    (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $p)) (i32.const 1))) (i32.const "!")))
                    (i32.const 8))
                  (i32.shl (i32.eq (i32.load8_u offset=1 (i32.add (local.get $base) (local.get $p))) (i32.const "^"))
                    (i32.const 10)))))
                (local.set $links (i32.add (local.get $links) (i32.const 1))))
              (else (local.set $extra (i32.add (local.get $extra) (i32.const 1)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "]"))
          (then
            (local.set $q (i32.add (local.get $p) (i32.const 1)))
            (if (local.get $extra)
              (then
                (local.set $extra (i32.sub (local.get $extra) (i32.const 1)))
                (local.set $p (local.get $q))
                (br $scan)))
            (if (local.get $links)
              (then
                (local.set $top (i32.add (i32.const $mem.completeLinks)
                  (i32.shl (i32.sub (local.get $links) (i32.const 1)) (i32.const 3))))
                (local.set $meta (i32.load offset=4 (local.get $top)))
                (block $notLink
                  (br_if $notLink (i32.and (local.get $meta) (i32.const 512)))
                  (local.set $n (i32.add (local.get $base) (local.get $e)))
                  (local.set $c (select
                    (i32.load8_u (i32.add (local.get $base) (local.get $q)))
                    (i32.const 0)
                    (i32.lt_u (local.get $q) (local.get $e))))
                  ;; Each path to $closed leaves $t at the content offset after the link.
                  (block $closed
                    (if (i32.eq (local.get $c) (i32.const "("))
                      (then
                        (block $noInline
                          (block $pending
                            (local.set $t (call $skipWs
                              (i32.add (i32.add (local.get $base) (local.get $q)) (i32.const 1)) (local.get $n)))
                            (br_if $pending (i32.ge_u (local.get $t) (local.get $n)))
                            (global.set $linkDestAtEnd (i32.const 0))
                            (local.set $next (call $scanLinkDest (local.get $t) (local.get $n)))
                            (if (i32.lt_s (local.get $next) (i32.const 0))
                              (then
                                (br_if $pending (global.get $linkDestAtEnd))
                                (br $noInline)))
                            (local.set $t (call $skipWs (local.get $next) (local.get $n)))
                            (br_if $pending (i32.ge_u (local.get $t) (local.get $n)))
                            (if (i32.ne (local.get $t) (local.get $next))
                              (then
                                (local.set $c (i32.load8_u (local.get $t)))
                                (local.set $next (call $scanLinkTitle (local.get $t) (local.get $n)))
                                (if (local.get $next)
                                  (then
                                    (local.set $t (call $skipWs (local.get $next) (local.get $n)))
                                    (br_if $pending (i32.ge_u (local.get $t) (local.get $n))))
                                  (else
                                    ;; an opened title has not ended yet
                                    (br_if $pending (i32.or (i32.eq (local.get $c) (i32.const "("))
                                      (i32.or (i32.eq (local.get $c) (i32.const "\22"))
                                        (i32.eq (local.get $c) (i32.const "'")))))))))
                            (br_if $noInline (i32.ne (i32.load8_u (local.get $t)) (i32.const ")")))
                            (local.set $t (i32.sub (i32.add (local.get $t) (i32.const 1)) (local.get $base)))
                            (br $closed))
                          ;; The label keeps a placeholder for its unfinished destination.
                          (local.set $cut (local.get $p))
                          (br $done))
                        ;; A title byte in $c must not read as the next check's `[`.
                        (local.set $c (i32.const "("))))
                    ;; `[text][label` waits for its label the same way.
                    (if (i32.eq (local.get $c) (i32.const "["))
                      (then
                        (local.set $t (i32.add (i32.add (local.get $base) (local.get $q)) (i32.const 1)))
                        (if (i32.ge_u (call $findByte (local.get $t) (local.get $n) (i32.const "]")) (local.get $n))
                          (then
                            (if (i32.ge_u (call $findByte (local.get $t) (local.get $n) (i32.const "[")) (local.get $n))
                              (then
                                (local.set $cut (local.get $p))
                                (br $done)))))))
                    ;; A reference, found as inline analysis finds it. A resolved
                    ;; one stops the brackets around it from being links.
                    (local.set $next (call $scanLinkLabel (i32.add (local.get $base) (local.get $q)) (local.get $n)))
                    (local.set $t (select (i32.sub (local.get $next) (local.get $base)) (local.get $q) (local.get $next)))
                    (br_if $closed (if (result i32) (i32.gt_u (i32.sub (local.get $t) (local.get $q)) (i32.const 2))
                      (then (call $lookupLabel (i32.add (local.get $q) (i32.const 1)) (i32.sub (local.get $t) (i32.const 1)) (i32.const 0)))
                      (else (call $lookupLabel (i32.load (local.get $top)) (local.get $p) (i32.const 0)))))
                    ;; A delivery can stop between a label's `]` and its `(`. Inline
                    ;; analysis repairs that label if nothing else resolves it, but
                    ;; a label inside another bracket leaves that bracket unusable.
                    (if (i32.and (i32.and (i32.ge_u (local.get $q) (local.get $e))
                          (i32.eqz (i32.and (local.get $meta) (i32.const 0x500))))
                          (i32.eq (global.get $contentInputEnd) (global.get $eof)))
                      (then
                        (if (i32.gt_u (local.get $links) (i32.const 1))
                          (then (local.set $links (i32.const 1)))
                          (else
                            (global.set $completeClosedLabelEnd (global.get $eof))
                            ;; The host resets option flags before every render.
                            (i32.store8 (i32.const 1)
                              (i32.or (i32.load8_u (i32.const 1)) (i32.const 4)))
                            ;; The label will be a link: $t is $q, the content end.
                            (br $closed)))))
                    (br $notLink))
                  ;; Emphasis opened in a link's text cannot close outside it.
                  (if (i32.lt_u (i32.and (local.get $meta) (i32.const 255)) (local.get $depth))
                    (then (local.set $depth (i32.and (local.get $meta) (i32.const 255)))))
                  (local.set $links (i32.sub (local.get $links) (i32.const 1)))
                  (local.set $p (local.get $t))
                  ;; A link cannot hold a link, so brackets below this one stop being links.
                  (if (i32.eqz (i32.and (local.get $meta) (i32.const 256)))
                    (then
                      (local.set $q (local.get $links))
                      (block $below
                        (loop $outer
                          (br_if $below (i32.eqz (local.get $q)))
                          (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                          (local.set $top (i32.add (i32.const $mem.completeLinks) (i32.shl (local.get $q) (i32.const 3))))
                          (local.set $meta (i32.load offset=4 (local.get $top)))
                          (if (i32.eqz (i32.and (local.get $meta) (i32.const 256)))
                            (then (i32.store offset=4 (local.get $top) (i32.or (local.get $meta) (i32.const 512)))))
                          (br $outer)))))
                  (br $scan))
                (local.set $links (i32.sub (local.get $links) (i32.const 1)))))
            (local.set $p (local.get $q))
            (br $scan)))
        ;; [$p, $q) is the run of $c bytes.
        (local.set $q (local.get $p))
        (loop $run
          (local.set $q (i32.add (local.get $q) (i32.const 1)))
          (br_if $run (i32.and (i32.lt_u (local.get $q) (local.get $e))
            (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $q))) (local.get $c)))))
        (local.set $n (i32.sub (local.get $q) (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (local.set $t (call $scanToClosingBackticks (local.get $q) (local.get $e) (local.get $n)))
            (if (local.get $t)
              (then
                (local.set $p (local.get $t))
                (br $scan)))
            ;; Without a closing run the rest is code and gets closing ticks.
            ;; A run over 255 never pairs, and closing ticks would join a tick
            ;; that ends the content: then the run is text and the scan goes on.
            (if (i32.le_u (local.get $n) (i32.const 255))
              (then
                (if (i32.ne (i32.load8_u (i32.sub (call $trimSpaceBack
                      (i32.add (local.get $base) (local.get $e)) (i32.add (local.get $base) (local.get $q)))
                      (i32.const 1))) (i32.const "`"))
                  (then
                    (local.set $tick (local.get $n))
                    (br $done)))))
            (local.set $p (local.get $q))
            (br $scan)))
        ;; the content edges count as spaces
        (local.set $prev (select
          (call $utf8Before (i32.add (local.get $base) (local.get $p)) (local.get $base))
          (i32.const 32) (local.get $p)))
        (local.set $next (select
          (call $utf8At (i32.add (local.get $base) (local.get $q)) (i32.add (local.get $base) (local.get $e)))
          (i32.const 32) (i32.lt_u (local.get $q) (local.get $e))))
        ;; The run's flags, as $handleDelim finds them: $k is the class of the
        ;; character before the run times four plus the class after it, 2 for
        ;; whitespace, 1 for punctuation, else 0. Bit 0 says it can open, bit 1
        ;; that it can close. $k is 0 inside a word.
        (local.set $k (i32.or
          (i32.shl (select (i32.const 2) (call $isPunctCp (local.get $prev)) (call $isWhiteCp (local.get $prev)))
            (i32.const 2))
          (select (i32.const 2) (call $isPunctCp (local.get $next)) (call $isWhiteCp (local.get $next)))))
        (local.set $flags (i32.and
          (i32.shr_u (i32.const 0x52d2b) (i32.shl (local.get $k) (i32.const 1))) (i32.const 3)))
        (if (i32.eq (local.get $c) (i32.const "~"))
          (then
            ;; three or more tildes are text
            (if (i32.gt_u (local.get $n) (i32.const 2))
              (then
                (local.set $p (local.get $q))
                (br $scan))))
          (else
            (if (i32.and (i32.eq (local.get $c) (i32.const "_")) (i32.eqz (local.get $k)))
              (then (local.set $flags (i32.const 0))))))
        ;; $m counts the delimiters of the run that are not used yet.
        (local.set $m (local.get $n))
        (if (i32.and (local.get $flags) (i32.const 2))
          (then
            ;; Close as the parser does: take the nearest opener of this
            ;; character that the rule of three allows, then the ones below it
            ;; while the run lasts. Openers above a match are dead. $low is the
            ;; lowest opener the run took.
            (local.set $t (local.get $depth))
            (local.set $low (local.get $t))
            (block $closed
              (loop $match
                (br_if $closed (i32.eqz (local.get $t)))
                (local.set $t (i32.sub (local.get $t) (i32.const 1)))
                (local.set $top (i32.add (i32.const $mem.completeDelims) (i32.shl (local.get $t) (i32.const 4))))
                (local.set $meta (i32.load (local.get $top)))
                (br_if $match (i32.ne (i32.and (local.get $meta) (i32.const 255)) (local.get $c)))
                ;; The rule of three rejects these lengths when the closer can
                ;; open or the opener can close.
                (local.set $next (i32.and (i32.ne (i32.rem_u (local.get $n) (i32.const 3)) (i32.const 0))
                  (i32.eqz (i32.rem_u
                    (i32.add (i32.shr_u (local.get $meta) (i32.const 16)) (local.get $n)) (i32.const 3)))))
                (br_if $match (i32.and (local.get $next)
                  (i32.or (local.get $flags) (i32.shr_u (local.get $meta) (i32.const 8)))))
                ;; A run that pairs at such lengths must stay unable to open:
                ;; $dirty remembers where it ends.
                (if (local.get $next) (then (local.set $dirty (local.get $q))))
                (local.set $low (local.get $t))
                (local.set $depth (local.get $t))
                (local.set $remaining (i32.load offset=4 (local.get $top)))
                (if (i32.gt_u (local.get $remaining) (local.get $m))
                  (then
                    ;; The opener outlasts the run. When one delimiter of a pair
                    ;; ends the content and closed nothing else, it may be the
                    ;; first half of the closer: the opener stays whole and
                    ;; $join remembers where the run ends. Elsewhere tildes pair
                    ;; only at equal lengths, and both runs are done.
                    (if (i32.eq (i32.shr_u (local.get $meta) (i32.const 16)) (i32.const 2))
                      (then
                        (if (i32.and (i32.ge_u (local.get $q) (local.get $e))
                              (i32.eq (local.get $m) (local.get $n)))
                          (then
                            (local.set $join (local.get $q))
                            (local.set $m (i32.const 0)))
                          (else
                            (local.set $t (i32.sub (local.get $t) (i32.eq (local.get $c) (i32.const "~"))))))))
                    (i32.store offset=4 (local.get $top) (i32.sub (local.get $remaining) (local.get $m)))
                    (local.set $depth (i32.add (local.get $t) (i32.const 1)))
                    (local.set $m (i32.const 0))
                    (br $closed)))
                ;; a tilde run pairs once
                (local.set $m (select (i32.const 0) (i32.sub (local.get $m) (local.get $remaining))
                  (i32.eq (local.get $c) (i32.const "~"))))
                (br_if $match (local.get $m))))
            ;; Emphasis opened before a bracket can close inside it. Bit 11
            ;; marks the bracket: a link's text cannot do that, and if an
            ;; unfinished image is dropped, the closer goes with it and the
            ;; opener is open again.
            (local.set $t (local.get $links))
            (block $lowered
              (loop $lower
                (br_if $lowered (i32.eqz (local.get $t)))
                (local.set $t (i32.sub (local.get $t) (i32.const 1)))
                (local.set $next (i32.add (i32.const $mem.completeLinks) (i32.shl (local.get $t) (i32.const 3))))
                (local.set $meta (i32.load offset=4 (local.get $next)))
                (local.set $remaining (i32.and (local.get $meta) (i32.const 255)))
                (br_if $lowered (i32.le_u (local.get $remaining) (local.get $low)))
                (i32.store offset=4 (local.get $next)
                  (i32.or (i32.or (i32.and (local.get $meta) (i32.const -256)) (i32.const 0x800))
                    (select (local.get $depth) (local.get $remaining)
                      (i32.lt_u (local.get $depth) (local.get $remaining)))))
                (br $lower)))))
        (if (i32.and (i32.and (local.get $flags) (i32.const 1)) (i32.ne (local.get $m) (i32.const 0)))
          (then
            ;; Past the limit the stack would no longer follow the parser.
            (if (i32.ge_u (local.get $depth) (i32.const 64)) (then (return (i32.const 0))))
            ;; An entry holds the character, bit 8 when the opener can also
            ;; close, bit 9 when it gets no closers, and the run length modulo 3
            ;; from bit 16, then the delimiters left and the content offset
            ;; after the run. The parser can pair any opener, but some are not
            ;; repaired: intraword runs (an asterisk there is often
            ;; arithmetic), runs over three, a lone `~` (usually "about"), and
            ;; what a closing run has left.
            (local.set $t (i32.or
              (i32.or (i32.eqz (local.get $k)) (i32.gt_u (local.get $n) (i32.const 3)))
              (i32.or (i32.ne (local.get $m) (local.get $n))
                (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $n) (i32.const 1))))))
            (local.set $top (i32.add (i32.const $mem.completeDelims) (i32.shl (local.get $depth) (i32.const 4))))
            (i32.store (local.get $top) (i32.or
              (i32.or (local.get $c) (i32.shl (i32.and (local.get $flags) (i32.const 2)) (i32.const 7)))
              (i32.or (i32.shl (local.get $t) (i32.const 9))
                (i32.shl (i32.rem_u (local.get $n) (i32.const 3)) (i32.const 16)))))
            (i32.store offset=4 (local.get $top) (local.get $m))
            (i32.store offset=8 (local.get $top) (local.get $q))
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            ;; The closer of a `~~` below a tilde run that stays open would
            ;; meet that run first and pair with nothing.
            (if (i32.and (local.get $t) (i32.eq (local.get $c) (i32.const "~")))
              (then
                (loop $below
                  (if (i32.ne (local.get $top) (i32.const $mem.completeDelims))
                    (then
                      (local.set $top (i32.sub (local.get $top) (i32.const 16)))
                      (if (i32.eq (i32.load8_u (local.get $top)) (i32.const "~"))
                        (then (i32.store8 offset=1 (local.get $top)
                          (i32.or (i32.load8_u offset=1 (local.get $top)) (i32.const 2)))))
                      (br $below))))))))
        (local.set $p (local.get $q))
        (br $scan)))
    (local.set $base (global.get $contentBase))
    ;; An unfinished image is dropped with what opened in its text. Below it, an
    ;; open bracket that can still be a link keeps its text and gets a placeholder
    ;; destination in place of a partial one.
    (block $settled
      (loop $images
        (br_if $settled (i32.eqz (local.get $links)))
        (local.set $links (i32.sub (local.get $links) (i32.const 1)))
        (local.set $top (i32.add (i32.const $mem.completeLinks) (i32.shl (local.get $links) (i32.const 3))))
        (local.set $meta (i32.load offset=4 (local.get $top)))
        (local.set $openDepth (i32.and (local.get $meta) (i32.const 255)))
        (if (i32.and (local.get $meta) (i32.const 256))
          (then
            (local.set $cut (i32.sub (i32.load (local.get $top)) (i32.const 2)))
            ;; The stack lost an opener to a closer in the image (bit 11): it
            ;; no longer follows the parser, so nothing gets closers.
            (if (i32.and (local.get $meta) (i32.const 0x800))
              (then (local.set $depth (i32.const 0))))
            (local.set $tick (i32.const 0))
            (br $images)))
        (if (i32.eqz (i32.and (local.get $meta) (i32.const 0x600)))
          (then
            (local.set $open (i32.load (local.get $top)))
            ;; A closer in this bracket's text took an opener before it, which
            ;; a link's text cannot do: what the text opened is not known.
            (if (i32.and (local.get $meta) (i32.const 0x800))
              (then (local.set $depth (local.get $openDepth))))
            ;; After `][` the placeholder's `]` could end the label of a
            ;; reference, and its destination would show as text.
            (if (i32.gt_u (local.get $open) (i32.const 1))
              (then
                (if (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $open)) (i32.const 2)))
                      (i32.const "]"))
                  (then (local.set $open (i32.const 0))))))))))
    ;; $prev counts the closers that stay outside a pending link's text.
    (local.set $prev (select (local.get $openDepth) (i32.const 0) (local.get $open)))
    ;; Closers go before trailing whitespace, so spaces between streamed words
    ;; cannot remove and recreate their formatting. They cannot follow an
    ;; unescaped `\` either, which would escape them. One that ends a word has
    ;; nothing to escape yet: $n is 1 for it, and the closers replace it. One
    ;; before whitespace is text or a hard break, and one after whitespace would
    ;; leave the closers behind that whitespace: both stay after the closers.
    (local.set $n (i32.const 0))
    (loop $place
      (local.set $closeAt (local.get $cut))
      (loop $back
        (block $contentEnd
          (loop $trailingWhite
            (br_if $contentEnd (i32.eqz (local.get $closeAt)))
            (local.set $c (call $utf8Before (i32.add (local.get $base) (local.get $closeAt)) (local.get $base)))
            (br_if $contentEnd (i32.eqz (call $isWhiteCp (local.get $c))))
            (local.set $closeAt (i32.sub (local.get $closeAt)
              (if (result i32) (i32.lt_u (local.get $c) (i32.const 0x80)) (then (i32.const 1))
                (else (if (result i32) (i32.lt_u (local.get $c) (i32.const 0x800))
                  (then (i32.const 2)) (else (i32.const 3)))))))
            (br $trailingWhite)))
        ;; Inside an unfinished code span a `\` is code.
        (if (i32.eqz (local.get $tick))
          (then
            (local.set $q (local.get $closeAt))
            (loop $slashes
              (if (i32.and (i32.ne (local.get $q) (i32.const 0))
                    (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $q)) (i32.const 1))) (i32.const "\5c")))
                (then
                  (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                  (br $slashes))))
            (local.set $n (i32.and (i32.sub (local.get $closeAt) (local.get $q)) (i32.const 1)))
            (if (local.get $n)
              (then
                ;; $lastMarkEnd is the end of the last bare URL. A `\` that
                ;; ends it is no escape, and closers before or after it would
                ;; change where the URL ends. Wait for more bytes.
                (if (i32.eq (local.get $closeAt) (global.get $lastMarkEnd))
                  (then (return (i32.const 0))))
                (local.set $t (i32.lt_u (local.get $closeAt) (local.get $cut)))
                (if (i32.eqz (local.get $t))
                  (then
                    (if (i32.eq (i32.sub (local.get $closeAt) (local.get $q)) (i32.const 1))
                      (then (local.set $t (call $isWhiteCp
                        (call $utf8Before (i32.add (local.get $base) (local.get $q)) (local.get $base))))))
                    ;; A placeholder right after it would be escaped, so it goes.
                    (if (i32.and (local.get $t) (i32.ne (local.get $open) (i32.const 0)))
                      (then (local.set $cut (local.get $q))))))
                (if (local.get $t)
                  (then
                    (local.set $closeAt (i32.sub (local.get $closeAt) (i32.const 1)))
                    (br $back))))))))
      ;; The closers start at $at. Openers at or after the cut went with it.
      (local.set $at (i32.sub (local.get $closeAt) (local.get $n)))
      (block $kept
        (loop $drop
          (br_if $kept (i32.eqz (local.get $depth)))
          (br_if $kept (i32.le_u
            (i32.load offset=$mem.completeDelims-8 (i32.shl (local.get $depth) (i32.const 4)))
            (local.get $cut)))
          (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
          (br $drop)))
      (if (i32.gt_u (local.get $prev) (local.get $depth)) (then (local.set $prev (local.get $depth))))
      (local.set $c (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $at)) (i32.const 1))))
      (local.set $k (i32.const 0))
      ;; `*`, `_` or `~`: closers join the run [$q, $at) of delimiters typed
      ;; before them. In an unfinished code span they are code.
      (if (i32.and (i32.eqz (i32.or (local.get $tick) (i32.eqz (local.get $at))))
            (call $byteIn (local.get $c) (i64.const 0x40000000000) (i64.const 0x4000000080000000)))
        (then
          (local.set $q (local.get $at))
          (loop $run
            (local.set $q (i32.sub (local.get $q) (i32.const 1)))
            (br_if $run (i32.and (i32.ne (local.get $q) (i32.const 0))
              (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $q)) (i32.const 1))) (local.get $c)))))
          (local.set $t (select
            (call $utf8Before (i32.add (local.get $base) (local.get $q)) (local.get $base))
            (i32.const 32) (local.get $q)))
          ;; $k: after punctuation the longer run may be able to open too
          (local.set $k (call $isPunctCp (local.get $t)))
          ;; $m: the run is an opener that is still open
          (local.set $m (if (result i32) (local.get $depth)
            (then (i32.eq (local.get $at)
              (i32.load offset=$mem.completeDelims-8 (i32.shl (local.get $depth) (i32.const 4)))))
            (else (i32.const 0))))
          ;; A run after whitespace cannot close, and neither can an opener:
          ;; closers glued to it would turn the text literal. When openers
          ;; below it get closers, the run waits for the bytes that decide
          ;; what it is. Else an opener only loses its own closers. A lone `~`
          ;; (usually "about") is text that closers can follow.
          (if (i32.or (local.get $m)
                (i32.and (call $isWhiteCp (local.get $t))
                  (i32.ne (i32.add (local.get $c) (i32.sub (local.get $at) (local.get $q))) (i32.const 127))))
            (then
              (local.set $t (i32.sub (local.get $depth) (local.get $m)))
              (block $live
                (loop $trim
                  (br_if $live (i32.le_u (local.get $t) (local.get $prev)))
                  (br_if $live (i32.eqz (i32.and (i32.const 2)
                    (i32.load8_u offset=$mem.completeDelims-15 (i32.shl (local.get $t) (i32.const 4))))))
                  (local.set $t (i32.sub (local.get $t) (i32.const 1)))
                  (br $trim)))
              (if (i32.gt_u (local.get $t) (local.get $prev))
                (then
                  (local.set $cut (local.get $q))
                  (br $place)))
              (if (i32.gt_u (local.get $depth) (local.get $prev))
                (then (local.set $depth (i32.sub (local.get $depth) (local.get $m))))))))))
    ;; A closing tick run would join a run that ends the content. The scan stopped
    ;; at the opening run, so a pending link may have syntax after it that was
    ;; never read, and a placeholder could pair with that.
    (if (i32.and (i32.ne (local.get $tick) (i32.const 0)) (i32.eq (local.get $c) (i32.const "`")))
      (then
        (local.set $tick (i32.const 0))
        (local.set $open (i32.const 0))
        (local.set $prev (i32.const 0))))
    ;; Zero the closers of openers that cannot get them. Go from the last
    ;; closer written to the first. $k is the character of the closer run that
    ;; the closers so far begin with, $m its length, and $flags says that
    ;; punctuation follows it: another run, the placeholder's `]`, or a `\` that
    ;; stays behind the closers. Such a run may be able to open too, and then
    ;; the rule of three applies to all of its openers, as it does to an opener
    ;; that can also close: it rejects a run of length L for an opener of length
    ;; n when L is no multiple of 3 and L + n is one. $next has a bit for each n
    ;; modulo 3 that the rule applies to. Delimiters typed right before the
    ;; closers make the run longer by a length this pass does not know.
    ;; The rule may reject that too, unless they are the first half of a closer
    ;; ($join). Two `~~` closers in a row are four tildes, which is text.
    (local.set $join (i32.and (i32.ne (local.get $join) (i32.const 0))
      (i32.eq (local.get $join) (local.get $at))))
    (local.set $glue (local.get $k))
    ;; $esc is the byte before the closers: closing ticks come first
    (local.set $esc (select (i32.const "`") (local.get $c) (local.get $tick)))
    (local.set $t (i32.const 0))
    (local.set $k (i32.const 0))
    (local.set $flags (i32.const 0))
    (block $marked
      (loop $mark
        (br_if $marked (i32.ge_u (local.get $t) (local.get $depth)))
        ;; the placeholder separates the closers on its two sides
        (if (i32.eq (local.get $t) (local.get $prev))
          (then
            (local.set $k (i32.const 0))
            (local.set $flags (i32.or (i32.ne (local.get $open) (i32.const 0))
              (i32.and (i32.lt_u (local.get $closeAt) (local.get $cut))
                (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $closeAt))) (i32.const "\5c")))))))
        (local.set $top (i32.add (i32.const $mem.completeDelims) (i32.shl (local.get $t) (i32.const 4))))
        (local.set $meta (i32.load (local.get $top)))
        (local.set $low (i32.and (local.get $meta) (i32.const 255)))
        ;; $q says the opener loses its closers
        (local.set $q (i32.and (local.get $meta) (i32.const 512)))
        (if (i32.eqz (local.get $q))
          (then
            (local.set $n (i32.eq (local.get $low) (local.get $k)))
            (local.set $from (i32.or (local.get $flags)
              (i32.and (i32.ne (local.get $k) (i32.const 0)) (i32.eqz (local.get $n)))))
            (local.set $to (i32.add (i32.load offset=4 (local.get $top))
              (select (local.get $m) (i32.const 0) (local.get $n))))
            (local.set $remaining (i32.or
              (select (local.get $next) (i32.const 0) (local.get $n))
              (i32.shl
                (i32.and (i32.or (local.get $from) (i32.shr_u (local.get $meta) (i32.const 8))) (i32.const 1))
                (i32.shr_u (local.get $meta) (i32.const 16)))))
            (if (i32.or
                  (i32.or
                    (i32.and (local.get $n) (i32.eq (local.get $low) (i32.const "~")))
                    (i32.and
                      (i32.or (i32.shr_u (local.get $meta) (i32.const 8))
                        (i32.and (local.get $from) (local.get $glue)))
                      (i32.and (i32.eq (local.get $low) (local.get $esc)) (i32.eqz (local.get $join)))))
                  (i32.and (i32.const 1) (i32.shr_u (local.get $remaining)
                    (i32.sub (i32.const 3) (i32.rem_u (local.get $to) (i32.const 3))))))
              (then (local.set $q (i32.const 1)))
              (else
                (local.set $flags (local.get $from))
                (local.set $m (local.get $to))
                (local.set $next (local.get $remaining))
                (local.set $k (local.get $low))))))
        (if (local.get $q) (then (i32.store offset=4 (local.get $top) (i32.const 0))))
        (local.set $t (i32.add (local.get $t) (i32.const 1)))
        (br $mark)))
    ;; Leave an opener that gets closers on top of the pending link's text.
    (block $live
      (loop $trim
        (br_if $live (i32.le_u (local.get $depth) (local.get $prev)))
        (br_if $live (i32.load offset=$mem.completeDelims-12 (i32.shl (local.get $depth) (i32.const 4))))
        (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
        (br $trim)))
    ;; Tildes typed right before a `~~` closer join its run. When they are its
    ;; first half ($join), one more tilde finishes it, as one more delimiter
    ;; does for any other pair. Else the closer would be a run that closes
    ;; nothing, so it is not written.
    (if (i32.gt_u (local.get $depth) (local.get $prev))
      (then
        (local.set $top (i32.add (i32.const $mem.completeDelims-16) (i32.shl (local.get $depth) (i32.const 4))))
        (if (i32.and (i32.eq (i32.load8_u (local.get $top)) (local.get $esc))
              (i32.or (local.get $join) (i32.eq (local.get $esc) (i32.const "~"))))
          (then (i32.store offset=4 (local.get $top) (local.get $join))))))
    (local.set $remaining (local.get $tick))
    (local.set $q (local.get $depth))
    (block $sized
      (loop $size
        (br_if $sized (i32.le_u (local.get $q) (local.get $prev)))
        (local.set $q (i32.sub (local.get $q) (i32.const 1)))
        (local.set $remaining (i32.add (local.get $remaining)
          (i32.load offset=$mem.completeDelims+4 (i32.shl (local.get $q) (i32.const 4)))))
        (br $size)))
    ;; an earlier pass used $n for itself
    (local.set $n (i32.sub (local.get $closeAt) (local.get $at)))
    ;; The delimiters typed before the closers paired at lengths the rule of
    ;; three allows only to a run that cannot open. After punctuation ($glue),
    ;; closers or a placeholder right after the run let it open: wait.
    (if (i32.and (i32.and (i32.eq (local.get $dirty) (local.get $at)) (i32.eqz (local.get $join)))
          (i32.and (local.get $glue) (i32.ne (i32.or (local.get $remaining) (local.get $open)) (i32.const 0))))
      (then (return (i32.const 0))))
    (if (i32.eqz (i32.or (i32.or (local.get $remaining) (local.get $open))
          (i32.lt_u (local.get $cut) (global.get $contentLen))))
      (then (return (i32.const 0))))
    ;; After `[label]:` a paragraph still waits for a link destination, and
    ;; closers would be one.
    (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $type) (enum.get $Blk.p)))
      (then
        (if (i32.eq (call $scanLinkLabel (local.get $base) (i32.add (local.get $base) (local.get $at)))
              (i32.sub (i32.add (local.get $base) (local.get $at)) (i32.const 1)))
          (then (return (i32.const 0))))))
    (local.set $from (call $completeInputAt (local.get $r) (local.get $closeAt)))
    ;; A heading's closing `#` run is not content and the closers replace it.
    (local.set $to (if (result i32) (i32.lt_u (local.get $cut) (global.get $contentLen))
      (then (call $completeInputAt (local.get $r) (local.get $cut)))
      (else (select (local.get $last) (global.get $eof) (i32.eq (local.get $type) (enum.get $Blk.heading))))))
    ;; A placeholder or a tick after the space of a bare list marker would give
    ;; that item content, and an item with content ends the paragraph.
    ;; $line becomes the line they land on, which is an earlier one when the
    ;; last line was cut.
    (if (i32.and (i32.ne (i32.or (local.get $open) (local.get $tick)) (i32.const 0))
          (i32.eq (local.get $type) (enum.get $Blk.p)))
      (then
        (loop $landed
          (if (i32.gt_u (call $lineBeg (local.get $line)) (local.get $from))
            (then
              (local.set $line (i32.sub (local.get $line) (i32.const $R.line)))
              (br $landed))))
        (global.set $lineEnd (local.get $from))
        (local.set $q (call $lineBeg (local.get $line)))
        (if (i32.ge_u (i32.add (local.get $q) (call $parseListMarker (local.get $q) (i32.const 0)))
              (local.get $from))
          (then (local.set $to (local.get $from))))))
    ;; Only closers written right after the `\` turn it into an escape. Before
    ;; whitespace it stays as text, and before a line break it is a hard break.
    (if (i32.and (i32.eqz (local.get $remaining))
          (i32.or (i32.eqz (local.get $open)) (i32.lt_u (local.get $from) (local.get $to))))
      (then (local.set $n (i32.const 0))))
    ;; Ticks stay on the last line: after a line break they could start a fence.
    (if (local.get $tick)
      (then
        (block $lineEnd
          (loop $sameLine
            (br_if $lineEnd (i32.ge_u (local.get $from) (local.get $to)))
            (local.set $c (i32.load8_u (local.get $from)))
            (br_if $lineEnd (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
            (local.set $from (i32.add (local.get $from) (i32.const 1)))
            (br $sameLine)))))
    ;; Move the whitespace once, however long it is.
    (memory.copy (i32.sub (i32.add (local.get $from) (local.get $remaining)) (local.get $n))
      (local.get $from) (i32.sub (local.get $to) (local.get $from)))
    (local.set $to (i32.sub (i32.add (local.get $to) (local.get $remaining)) (local.get $n)))
    (local.set $from (i32.sub (local.get $from) (local.get $n)))
    (memory.fill (local.get $from) (i32.const "`") (local.get $tick))
    (drop (call $completeClosers (i32.add (local.get $from) (local.get $tick))
      (i32.const $mem.completeDelims) (local.get $prev) (local.get $depth)))
    (if (local.get $open)
      (then
        ;; $htmlLinkOpen recognizes this destination and writes no URL. Bit 4 says
        ;; that this input holds it; the host resets option flags before every render.
        (i32.store8 (i32.const 1) (i32.or (i32.load8_u (i32.const 1)) (i32.const 16)))
        ;; The space keeps the line from becoming a link reference definition:
        ;; a bare destination that ends in `(` is never valid.
        (i64.store (local.get $to) (i64.const "]( strea"))
        (i64.store offset=8 (local.get $to) (i64.const "mdown:in"))
        (i64.store offset=16 (local.get $to) (i64.const "complete"))
        (i64.store offset=24 (local.get $to) (i64.const "-link)"))
        (global.set $completePlaceholder (i32.add (local.get $to) (i32.const 3)))
        (local.set $to (call $completeClosers (i32.add (local.get $to) (i32.const 30))
          (i32.const $mem.completeDelims) (i32.const 0) (local.get $prev)))))
    ;; the NUL sentinel and the slack the SIMD scans read into
    (memory.fill (local.get $to) (i32.const 0) (i32.const 32))
    (i32.store (i32.const 2) (i32.sub (local.get $to) (i32.const $mem.input)))
    (i32.const 1))
)
