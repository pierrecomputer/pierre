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

  ;; Write the closers of delimiter stack entries [$bottom, $top) at $at,
  ;; innermost first, and return the position after them.
  (func $completeClosers (param $at i32) (param $stack i32) (param $bottom i32) (param $top i32) (result i32)
    (local $e i32)
    (local $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.le_u (local.get $top) (local.get $bottom)))
        (local.set $top (i32.sub (local.get $top) (i32.const 1)))
        (local.set $e (i32.add (local.get $stack) (i32.shl (local.get $top) (i32.const 3))))
        (local.set $n (i32.load offset=4 (local.get $e)))
        (memory.fill (local.get $at) (i32.load (local.get $e)) (local.get $n))
        (local.set $at (i32.add (local.get $at) (local.get $n)))
        (br $l)))
    (local.get $at))

  ;; The input position of content offset $off. Rebuilt content finds it through
  ;; the lines of record $r.
  (func $completeInputAt (param $r i32) (param $off i32) (result i32)
    (local $line i32)
    (local $pad i32)
    (local $len i32)
    (if (i32.lt_u (global.get $contentBase) (global.get $eof))
      (then (return (i32.add (global.get $contentBase) (local.get $off)))))
    (local.set $line (call $recLines (local.get $r)))
    (loop $lines
      (local.set $pad (call $linePad (local.get $line)))
      (local.set $len (i32.add (local.get $pad)
        (i32.sub (call $lineEndOf (local.get $line)) (call $lineBeg (local.get $line)))))
      (if (i32.gt_u (local.get $off) (local.get $len))
        (then
          (local.set $off (i32.sub (local.get $off) (i32.add (local.get $len) (i32.const 1))))
          (local.set $line (i32.add (local.get $line) (i32.const $R.line)))
          (br $lines))))
    (i32.add (call $lineBeg (local.get $line))
      (select (i32.sub (local.get $off) (local.get $pad)) (i32.const 0)
        (i32.gt_u (local.get $off) (local.get $pad)))))

  ;; Complete a streaming input after block analysis, so repair follows the
  ;; parser's blocks. Only the block that the next bytes can extend is scanned,
  ;; over the content inline analysis will read. Code spans, raw HTML, link
  ;; destinations, and bare URLs are skipped whole, as inline analysis does; a
  ;; bounded delimiter stack supplies the missing closing markers. Returns
  ;; whether the input changed, which needs another parse. $firstItemBlock says
  ;; the block is the first in a list item, where `[x]` can become a task marker.
  (func $complete (param $firstItemBlock i32) (result i32)
    (local $r i32) (local $type i32) (local $line i32) (local $last i32)
    (local $base i32) (local $p i32) (local $q i32) (local $t i32) (local $e i32)
    (local $c i32) (local $n i32) (local $prev i32) (local $next i32)
    (local $prevWhite i32) (local $nextWhite i32) (local $intraword i32)
    (local $depth i32) (local $top i32) (local $remaining i32) (local $openEnd i32)
    (local $links i32) (local $extra i32) (local $meta i32) (local $open i32) (local $openDepth i32)
    (local $tick i32) (local $cut i32) (local $held i32)
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
            ;; there, bit 8 for an image, and bit 9 when this bracket cannot end
            ;; as a link: `[^` starts a footnote reference, and a link cannot
            ;; hold a link. Past the limit brackets are only counted.
            (if (i32.lt_u (local.get $links) (i32.const 64))
              (then
                (local.set $top (i32.add (i32.const $mem.completeLinks) (i32.shl (local.get $links) (i32.const 3))))
                (i32.store (local.get $top) (i32.add (local.get $p) (i32.const 1)))
                (i32.store offset=4 (local.get $top) (i32.or (local.get $depth) (i32.or
                  (i32.shl (i32.and (i32.ne (local.get $p) (i32.const 0))
                    (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $p)) (i32.const 1))) (i32.const "!")))
                    (i32.const 8))
                  (i32.shl (i32.eq (i32.load8_u offset=1 (i32.add (local.get $base) (local.get $p))) (i32.const "^"))
                    (i32.const 9)))))
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
                          (i32.eqz (i32.and (local.get $meta) (i32.const 256))))
                          (i32.eq (global.get $contentInputEnd) (global.get $eof)))
                      (then
                        (if (i32.gt_u (local.get $links) (i32.const 1))
                          (then (local.set $links (i32.const 1)))
                          (else
                            (global.set $completeClosedLabelEnd (global.get $eof))
                            ;; The host resets option flags before every render.
                            (i32.store8 (i32.const 1)
                              (i32.or (i32.load8_u (i32.const 1)) (i32.const 4)))))))
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
            ;; Without a closing run the rest is code, but runs over 255 never pair.
            (if (i32.le_u (local.get $n) (i32.const 255))
              (then
                (local.set $tick (local.get $n))
                (br $done)))
            (local.set $p (local.get $q))
            (br $scan)))
        ;; Only `~~` is repaired; a lone `~` is usually "about".
        (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.ne (local.get $n) (i32.const 2)))
          (then
            (local.set $p (local.get $q))
            (br $scan)))
        ;; the content edges count as spaces
        (local.set $prev (select
          (call $utf8Before (i32.add (local.get $base) (local.get $p)) (local.get $base))
          (i32.const 32) (local.get $p)))
        (local.set $next (select
          (call $utf8At (i32.add (local.get $base) (local.get $q)) (i32.add (local.get $base) (local.get $e)))
          (i32.const 32) (i32.lt_u (local.get $q) (local.get $e))))
        (local.set $prevWhite (call $isWhiteCp (local.get $prev)))
        (local.set $nextWhite (call $isWhiteCp (local.get $next)))
        ;; Intraword underscores and arithmetic asterisks stay literal.
        (local.set $intraword (i32.eqz (i32.or (i32.or (local.get $prevWhite) (local.get $nextWhite))
          (i32.or (call $isPunctCp (local.get $prev)) (call $isPunctCp (local.get $next))))))
        (if (i32.and (i32.ne (local.get $depth) (i32.const 0))
              (i32.eqz (i32.or (local.get $intraword) (local.get $prevWhite))))
          (then
            (local.set $top (i32.add (i32.const $mem.completeDelims) (i32.shl (i32.sub (local.get $depth) (i32.const 1)) (i32.const 3))))
            (if (i32.eq (i32.load (local.get $top)) (local.get $c))
              (then
                (local.set $remaining (i32.load offset=4 (local.get $top)))
                (if (i32.ge_u (local.get $n) (local.get $remaining))
                  (then
                    (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                    ;; Emphasis opened before a bracket can close inside it.
                    (local.set $t (local.get $links))
                    (block $lowered
                      (loop $lower
                        (br_if $lowered (i32.eqz (local.get $t)))
                        (local.set $t (i32.sub (local.get $t) (i32.const 1)))
                        (local.set $next (i32.add (i32.const $mem.completeLinks) (i32.shl (local.get $t) (i32.const 3))))
                        (local.set $meta (i32.load offset=4 (local.get $next)))
                        (br_if $lowered (i32.le_u (i32.and (local.get $meta) (i32.const 255)) (local.get $depth)))
                        (i32.store offset=4 (local.get $next)
                          (i32.or (i32.and (local.get $meta) (i32.const -256)) (local.get $depth)))
                        (br $lower))))
                  (else (i32.store offset=4 (local.get $top) (i32.sub (local.get $remaining) (local.get $n)))))
                (local.set $p (local.get $q))
                (br $scan)))))
        (if (i32.eqz (i32.or (i32.or (local.get $intraword) (local.get $nextWhite))
              (i32.or (i32.ge_u (local.get $depth) (i32.const 64)) (i32.gt_u (local.get $n) (i32.const 3)))))
          (then
            (local.set $top (i32.add (i32.const $mem.completeDelims) (i32.shl (local.get $depth) (i32.const 3))))
            (i32.store (local.get $top) (local.get $c))
            (i32.store offset=4 (local.get $top) (local.get $n))
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (local.set $openEnd (local.get $q)))
          (else
            ;; A run that ends the content may open once more bytes arrive.
            (if (i32.ge_u (local.get $q) (local.get $e))
              (then (local.set $held (local.get $p))))))
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
            (if (i32.lt_u (local.get $openDepth) (local.get $depth))
              (then (local.set $depth (local.get $openDepth))))
            (local.set $tick (i32.const 0))
            ;; An opener inside the image went with it. Closers can still reach
            ;; a run right before the image, which the check below must see.
            (if (i32.and (i32.gt_u (local.get $openEnd) (local.get $cut))
                  (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $cut)) (i32.const 1)))
                    (i32.load (i32.sub (i32.add (i32.const $mem.completeDelims) (i32.shl (local.get $depth) (i32.const 3))) (i32.const 8)))))
              (then (local.set $openEnd (local.get $cut))))
            (br $images)))
        (if (i32.eqz (i32.and (local.get $meta) (i32.const 512)))
          (then (local.set $open (i32.load (local.get $top)))))))
    ;; $prev counts the closers that stay outside a pending link's text.
    (local.set $prev (select (local.get $openDepth) (i32.const 0) (local.get $open)))
    ;; Closers glued to a run that cannot close would turn the text literal, so
    ;; that run waits for the bytes that decide what it is.
    (if (i32.and (i32.and (i32.ne (local.get $held) (i32.const 0)) (i32.lt_u (local.get $held) (local.get $cut)))
          (i32.gt_u (local.get $depth) (local.get $prev)))
      (then (local.set $cut (local.get $held))))
    ;; Closers go before trailing whitespace, so spaces between streamed words
    ;; cannot remove and recreate their formatting.
    (local.set $closeAt (local.get $cut))
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
    (local.set $c (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $closeAt)) (i32.const 1))))
    ;; A closing tick run would join a run that ends the content. The scan stopped
    ;; at the opening run, so a pending link may have syntax after it that was
    ;; never read, and a placeholder could pair with that.
    (if (i32.and (i32.ne (local.get $tick) (i32.const 0)) (i32.eq (local.get $c) (i32.const "`")))
      (then
        (local.set $tick (i32.const 0))
        (local.set $open (i32.const 0))
        (local.set $prev (i32.const 0))))
    (local.set $remaining (local.get $tick))
    (local.set $q (local.get $depth))
    (block $sized
      (loop $size
        (br_if $sized (i32.le_u (local.get $q) (local.get $prev)))
        (local.set $q (i32.sub (local.get $q) (i32.const 1)))
        (local.set $remaining (i32.add (local.get $remaining)
          (i32.load offset=$mem.bracket+4 (i32.shl (local.get $q) (i32.const 3)))))
        (br $size)))
    (local.set $n (i32.const 0))
    (if (i32.eqz (local.get $tick))
      (then
        ;; An unescaped final `\` would escape what follows it, and it has
        ;; nothing to escape yet. $n is 1 for it, and the closers replace it.
        (local.set $q (local.get $closeAt))
        (loop $slashes
          (if (i32.and (i32.ne (local.get $q) (i32.const 0))
                (i32.eq (i32.load8_u (i32.sub (i32.add (local.get $base) (local.get $q)) (i32.const 1))) (i32.const "\5c")))
            (then
              (local.set $q (i32.sub (local.get $q) (i32.const 1)))
              (br $slashes))))
        (local.set $n (i32.and (i32.sub (local.get $closeAt) (local.get $q)) (i32.const 1)))
        ;; Closers right after their opener would only double it as text.
        (if (i32.eq (i32.sub (local.get $closeAt) (local.get $n)) (local.get $openEnd))
          (then
            (local.set $depth (local.get $prev))
            (local.set $remaining (i32.const 0))))
        ;; A lone `~` is not a closer, but one that ends the content joins the next.
        (if (i32.gt_u (local.get $depth) (local.get $prev))
          (then
            (local.set $top (i32.add (i32.const $mem.completeDelims) (i32.shl (i32.sub (local.get $depth) (i32.const 1)) (i32.const 3))))
            (if (i32.and (i32.eq (i32.load (local.get $top)) (i32.const "~"))
                  (i32.eq (local.get $c) (i32.const "~")))
              (then
                (i32.store offset=4 (local.get $top) (i32.const 1))
                (local.set $remaining (i32.sub (local.get $remaining) (i32.const 1)))))))))
    (if (i32.eqz (i32.or (i32.or (local.get $remaining) (local.get $open))
          (i32.lt_u (local.get $cut) (global.get $contentLen))))
      (then (return (i32.const 0))))
    (local.set $from (call $completeInputAt (local.get $r) (local.get $closeAt)))
    ;; A heading's closing `#` run is not content and the closers replace it.
    (local.set $to (if (result i32) (i32.lt_u (local.get $cut) (global.get $contentLen))
      (then (call $completeInputAt (local.get $r) (local.get $cut)))
      (else (select (local.get $last) (global.get $eof) (i32.eq (local.get $type) (enum.get $Blk.heading))))))
    ;; A placeholder after the space of a bare list marker would give that item
    ;; content, and an item with content ends the paragraph.
    (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $type) (enum.get $Blk.p)))
      (then
        (global.set $lineEnd (local.get $last))
        (local.set $q (call $lineBeg (local.get $line)))
        (if (i32.ge_u (i32.add (local.get $q) (call $parseListMarker (local.get $q) (i32.const 0)))
              (local.get $last))
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
        (i64.store (local.get $to) (i64.const "](stream"))
        (i64.store offset=8 (local.get $to) (i64.const "down:inc"))
        (i64.store offset=16 (local.get $to) (i64.const "omplete-"))
        (i64.store offset=24 (local.get $to) (i64.const "link)"))
        (local.set $to (call $completeClosers (i32.add (local.get $to) (i32.const 29))
          (i32.const $mem.completeDelims) (i32.const 0) (local.get $prev)))))
    ;; the NUL sentinel and the slack the SIMD scans read into
    (memory.fill (local.get $to) (i32.const 0) (i32.const 32))
    (i32.store (i32.const 2) (i32.sub (local.get $to) (i32.const $mem.input)))
    (i32.const 1))
)
