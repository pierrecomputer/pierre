(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./record.wat")
  (import "./htmlscan.wat")
  (import "./entity.wat")
  (import "./render.wat")

  (global $incompleteCodeRec (mut i32) (i32.const 0))

  ;; start a new output line unless one has just started, matching the
  ;; reference renderer's `cr()`
  (func $cr
    (if (i32.le_u (global.get $out) (global.get $outBase)) (then (return)))
    (if (i32.ne (i32.load8_u (i32.sub (global.get $out) (i32.const 1))) (i32.const 10))
      (then (call $outByte (i32.const 10)))))

  ;; Container openers are quote, ul, ol and li; each starts a new line.
  (func $htmlBlockOpen (param $t i32) (param $r i32)
    (call $cr)
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then
        (out.str "<blockquote>\n")
        (if (global.get $fmt) (then (call $mark (i32.const 10) (i32.const 1))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then
        (out.str "<li>")
        (if (global.get $fmt) (then (call $mark (i32.const 2) (i32.const 0))))
        (return)))
    (if (i32.and (i32.eq (local.get $t) (enum.get $Blk.ol))
          (i32.ne (i32.load offset=8 (local.get $r)) (i32.const 1)))
      (then
        (if (global.get $fmt)
          (then (out.str "<ol data-markdown=\22ol\22 start=\22"))
          (else (out.str "<ol start=\22")))
        (call $outNum (i32.load offset=8 (local.get $r)))
        (out.str "\22>\n")
        (return)))
    ;; "<ol>" is "<ul>" with `u` lowered by six
    (call $outSmall (i64.sub (i64.const "<ul>\n")
      (i64.extend_i32_u (i32.mul (i32.eq (local.get $t) (enum.get $Blk.ol)) (i32.const 0x600))))
      (i32.const 5))
    (if (global.get $fmt) (then (call $mark (i32.const 2) (i32.const 1)))))

  (func $htmlBlockClose (param $t i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then (out.str "</li>\n") (return)))
    (call $cr)
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then (out.str "</blockquote>\n") (return)))
    (call $outSmall (i64.sub (i64.const "</ul>\n")
      (i64.extend_i32_u (i32.mul (i32.eq (local.get $t) (enum.get $Blk.ol)) (i32.const 0x60000))))
      (i32.const 6)))

  (func $htmlLeaf (param $t i32) (param $r i32)
    (local $n i32)
    (block $table
      (block $p
        (block $html
          (block $code
            (block $heading
              (block $hr
                (br_table $hr $heading $code $html $p $table
                  (i32.sub (local.get $t) (enum.get $Blk.hr))))
              (call $cr)
              (if (global.get $fmt)
                (then (out.str "<hr data-markdown=\22hr\22>\n"))
                (else (out.str "<hr />\n")))
              (return))
            ;; "<hN>" and "</hN>" put the level digit into a literal "0"
            (local.set $n (i32.load offset=8 (local.get $r)))
            (call $cr)
            (call $outSmall (i64.extend_i32_u
              (i32.or (i32.const "<h0>") (i32.shl (local.get $n) (i32.const 16)))) (i32.const 4))
            (if (global.get $fmt) (then (call $mark (i32.const 2) (i32.const 0))))
            (call $renderInline (local.get $r))
            (call $outSmall (i64.or (i64.const "</h0>\n")
              (i64.shl (i64.extend_i32_u (local.get $n)) (i64.const 24))) (i32.const 6))
            (return))
          (if (global.get $fmt)
            (then (call $htmlCodeBlockFmt (local.get $r)))
            (else (call $htmlCodeBlock (local.get $r))))
          (return))
        (call $htmlRawBlock (local.get $r))
        (return))
      ;; a tight list item's paragraph has no tags
      (local.set $n (call $tightParagraph))
      (if (i32.eqz (local.get $n))
        (then
          (call $cr)
          (out.str "<p>")
          (if (global.get $fmt) (then (call $mark (i32.const 1) (i32.const 0))))))
      (call $htmlTaskBox)
      (call $renderInline (local.get $r))
      (if (i32.eqz (local.get $n))
        (then (out.str "</p>\n")))
      (return))
    (call $htmlTable (local.get $r)))

  ;; GFM renders a task list item's marker as a disabled checkbox
  (func $htmlTaskBox
    (if (i32.eqz (global.get $pendingTask)) (then (return)))
    (if (global.get $fmt)
      (then
        (out.str "<input data-markdown=\22input\22")
        (if (i32.eq (global.get $pendingTask) (i32.const 2))
          (then (out.str " checked=\22\22")))
        (out.str " disabled=\22\22 type=\22checkbox\22 readonly=\22\22>")
        (global.set $pendingTask (i32.const 0))
        (return)))
    ;; the unchecked tail is a pooled substring of the checked box
    (if (i32.eq (global.get $pendingTask) (i32.const 2))
      (then (out.str "<input checked=\22\22 disabled=\22\22 type=\22checkbox\22>"))
      (else
        (out.str "<input ")
        (out.str "disabled=\22\22 type=\22checkbox\22>")))
    (global.set $pendingTask (i32.const 0)))

  ;; Code needs only HTML escaping, its two tags, and a space for each line
  ;; ending. Reserve everything together, then resolve content pointers after
  ;; possible growth. Single-line content skips the line-ending search.
  (func $htmlCodeSpan (param $beg i32) (param $end i32)
    (local $dst i32)
    (local $q i32)
    (call $ensureOut (i32.add
      (i32.mul (i32.sub (local.get $end) (local.get $beg)) (i32.const 6))
      (i32.const 48)))
    (local.set $dst (global.get $out))
    (i64.store (local.get $dst) (i64.const "<code>"))
    (local.set $dst (i32.add (local.get $dst) (i32.const 6)))
    (if (global.get $fmt) (then (local.set $dst (call $markAt (local.get $dst) (i32.const 4)))))
    (local.set $beg (call $contentAt (local.get $beg)))
    (local.set $end (call $contentAt (local.get $end)))
    (block $done
      (loop $line
        (local.set $q (local.get $end))
        (if (i32.eqz (global.get $singleLineContent))
          (then (local.set $q (call $findByte (local.get $beg) (local.get $end) (i32.const 10)))))
        (local.set $dst (call $outTextAt (local.get $beg) (local.get $q) (local.get $dst)))
        (br_if $done (i32.ge_u (local.get $q) (local.get $end)))
        (i32.store8 (local.get $dst) (i32.const 32))
        (local.set $dst (i32.add (local.get $dst) (i32.const 1)))
        (local.set $beg (i32.add (local.get $q) (i32.const 1)))
        (br $line)))
    (i64.store (local.get $dst) (i64.const "</code>"))
    (global.set $out (i32.add (local.get $dst) (i32.const 7))))

  (func $htmlCodeBlock (param $r i32)
    (local $word i32)
    (call $cr)
    (out.str "<pre")
    ;; Only sessions mark an open fence.
    (if (i32.and (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 8)) (i32.const 0))
          (i32.eq (local.get $r) (global.get $incompleteCodeRec)))
      (then (out.str " data-markdown-incomplete")))
    (out.str "><code class=\22language-")
    (local.set $word (global.get $out))
    (call $htmlInfoWord (local.get $r))
    (if (i32.eq (global.get $out) (local.get $word))
      (then
        (global.set $out (i32.sub (local.get $word) (i32.const 22)))
        (out.str "<code>"))
      (else (out.str "\22>")))
    (call $htmlCodeLines (local.get $r))
    (out.str "</code></pre>\n"))

  ;; write $n spaces, at most eight (a line's virtual tab padding)
  (func $outSpaces (param $n i32)
    (call $ensureOut (i32.const 8))
    (i64.store (global.get $out) (i64.const 0x2020202020202020))
    (global.set $out (i32.add (global.get $out) (local.get $n))))

  (func $htmlRawBlock (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
    ;; skipped raw HTML leaves no line breaks behind
    (if (i32.and (i32.load8_u (i32.const 1)) (i32.const 2)) (then (return)))
    (call $cr)
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $line (call $lineAt (local.get $r) (local.get $i)))
        (call $outSpaces (call $linePad (local.get $line)))
        (call $htmlFiltered2 (call $lineBeg (local.get $line)) (call $lineEndOf (local.get $line))
          (i32.const 1))
        (call $outByte (i32.const 10))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l))))

  ;; raw HTML passes through, except that GFM escapes a handful of tag names
  (func $htmlFiltered2 (param $p i32) (param $e i32) (param $eol i32)
    (local $q i32)
    (local $n i32)
    (local $tag i32)
    (local $tagEnd i32)
    ;; Structured React output excludes raw HTML; generated elements remain intact.
    (if (i32.and (i32.load8_u (i32.const 1)) (i32.const 2)) (then (return)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $q (call $findByte (local.get $p) (local.get $e) (i32.const "<")))
        ;; NUL is U+FFFD, as in text
        (local.set $tag (call $findByte (local.get $p) (local.get $q) (i32.const 0)))
        (if (i32.lt_u (local.get $tag) (local.get $q))
          (then
            (call $outCopy (local.get $p) (local.get $tag))
            (out.str "\ef\bf\bd")
            (local.set $p (i32.add (local.get $tag) (i32.const 1)))
            (br $l)))
        (call $outCopy (local.get $p) (local.get $q))
        (br_if $done (i32.ge_u (local.get $q) (local.get $e)))
        (local.set $tag (i32.add (local.get $q) (i32.const 1)))
        (if (i32.and (i32.lt_u (local.get $tag) (local.get $e))
              (i32.eq (i32.load8_u (local.get $tag)) (i32.const "/")))
          (then (local.set $tag (i32.add (local.get $tag) (i32.const 1)))))
        (local.set $n (call $scanTagName (local.get $tag) (local.get $e)))
        (if (i32.and (i32.ne (local.get $n) (i32.const 0))
              (call $wordLookup
                (i32.const $mem.filterTags) (local.get $tag) (local.get $n) (i32.const 9)))
          (then
            (local.set $tagEnd (i32.add (local.get $tag) (local.get $n)))
            ;; the name must end the tag: space, >, or />; the line end counts
            ;; for whole raw lines. Lookahead past $e stays inside input slack.
            (if (if (result i32) (i32.ge_u (local.get $tagEnd) (local.get $e))
                  (then (local.get $eol))
                  (else
                    (local.set $n (i32.load8_u (local.get $tagEnd)))
                    (i32.or
                      (i32.or (call $isWhiteByte (local.get $n)) (i32.eq (local.get $n) (i32.const ">")))
                      (i32.and
                        (i32.and (i32.eq (local.get $n) (i32.const "/"))
                          (i32.lt_u (i32.add (local.get $tagEnd) (i32.const 1)) (local.get $e)))
                        (i32.eq (i32.load8_u offset=1 (local.get $tagEnd)) (i32.const ">"))))))
              (then
                (out.str "&lt;")
                (local.set $p (i32.add (local.get $q) (i32.const 1)))
                (br $l)))))
        (call $outByte (i32.const "<"))
        (local.set $p (i32.add (local.get $q) (i32.const 1)))
        (br $l))))

  (func $htmlTable (param $r i32)
    (local $cols i32)
    (local $rows i32)
    (local $i i32)
    (call $cr)
    (local.set $cols (i32.load offset=8 (local.get $r)))
    (local.set $rows (i32.load offset=$R.nLines (local.get $r)))
    (if (global.get $fmt)
      (then (out.str "<table data-markdown=\22table\22>\n<thead data-markdown=\22thead\22>\n"))
      (else (out.str "<table>\n<thead>\n")))
    (call $htmlTableRow (local.get $r) (i32.const 0) (local.get $cols) (i32.const 1))
    (out.str "</thead>\n")
    (if (i32.gt_u (local.get $rows) (i32.const 1))
      (then
        (out.str "<tbody>\n")
        (if (global.get $fmt) (then (call $mark (i32.const 5) (i32.const 1))))
        (local.set $i (i32.const 1))
        (block $done
          (loop $l
            (br_if $done (i32.ge_u (local.get $i) (local.get $rows)))
            (call $htmlTableRow (local.get $r) (local.get $i) (local.get $cols) (i32.const 0))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (out.str "</tbody>\n")))
    (out.str "</table>\n"))

  (func $htmlTableRow (param $r i32) (param $row i32) (param $cols i32) (param $head i32)
    (local $line i32)
    (local $i i32)
    (local $align i32)
    (local $p i32)
    (local $end i32)
    (local $has i32)
    (local.set $line (call $lineAt (local.get $r) (local.get $row)))
    (local.set $p (call $lineBeg (local.get $line)))
    (local.set $end (call $lineEndOf (local.get $line)))
    (if (i32.lt_u (local.get $p) (local.get $end))
      (then
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "|"))
          (then
            (local.set $p
              (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))))
    (out.str "<tr>\n")
    (if (global.get $fmt) (then (call $mark (i32.const 2) (i32.const 1))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $cols)))
        (local.set $align (i32.load8_u
          (i32.add (i32.add (local.get $r) (i32.const $R.header)) (local.get $i))))
        (call $htmlCellOpen (local.get $head) (local.get $align))
        (local.set $has (call $cellRange (local.get $p) (local.get $end)))
        (local.set $p (global.get $cellNext))
        (if (local.get $has)
          (then (call $renderCell (global.get $cellBeg) (global.get $cellEnd)
            (global.get $cellUnescapePipe))))
        (call $outSmall (select (i64.const "</th>\n") (i64.const "</td>\n") (local.get $head))
          (i32.const 6))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (out.str "</tr>\n"))

  ;; Emit the whole cell opener under one reservation instead of three small
  ;; writes for its tag, optional alignment, and closing angle bracket.
  ;; Formatted cells align with a style.
  (func $htmlCellOpen (param $head i32) (param $align i32)
    (local $dst i32)
    (call $ensureOut (i32.const 56))
    (local.set $dst (i32.add (global.get $out) (i32.const 4)))
    (i32.store (global.get $out) (select
      (i32.const "<th>") (i32.const "<td>") (local.get $head)))
    (if (global.get $fmt) (then (local.set $dst (call $markAt (local.get $dst) (i32.const 2)))))
    (if (local.get $align)
      (then
        ;; the attribute starts over the closing angle bracket
        (if (global.get $fmt)
          (then
            (i64.store (i32.sub (local.get $dst) (i32.const 1)) (i64.const " style=\22"))
            (i64.store offset=7 (local.get $dst) (i64.const "text-ali"))
            (i32.store offset=15 (local.get $dst) (i32.const "gn:"))
            (local.set $dst (i32.add (local.get $dst) (i32.const 18))))
          (else
            (i64.store (i32.sub (local.get $dst) (i32.const 1)) (i64.const " align=\22"))
            (local.set $dst (i32.add (local.get $dst) (i32.const 7)))))
        (i64.store (local.get $dst) (select
          (i64.const "left\22>")
          (select (i64.const "center\22>") (i64.const "right\22>")
            (i32.eq (local.get $align) (i32.const $A.center)))
          (i32.eq (local.get $align) (i32.const $A.left))))
        (local.set $dst (i32.add (local.get $dst) (select (i32.const 6)
          (select (i32.const 8) (i32.const 7)
            (i32.eq (local.get $align) (i32.const $A.center)))
          (i32.eq (local.get $align) (i32.const $A.left)))))))
    (global.set $out (local.get $dst)))

  ;; write footnote $n's reference id: "n", or "n-k" for its $k-th reference
  (func $outRefId (param $n i32) (param $k i32)
    (call $outNum (local.get $n))
    (if (i32.gt_u (local.get $k) (i32.const 1))
      (then
        (call $outByte (i32.const "-"))
        (call $outNum (local.get $k)))))

  (func $htmlFootnoteRef (param $n i32) (param $k i32)
    (if (global.get $fmt)
      (then (out.str "<sup data-markdown=\22sup\22 class=\22footnote-ref\22><a data-markdown=\22a\22 href=\22#"))
      (else (out.str "<sup class=\22footnote-ref\22><a href=\22#")))
    (call $outIdPrefix (i32.const 1))
    (out.str "fn-")
    (call $outNum (local.get $n))
    (out.str "\22 id=\22")
    (call $outIdPrefix (i32.const 0))
    (out.str "fnref-")
    (call $outRefId (local.get $n) (local.get $k))
    (out.str "\22 data-footnote-ref>")
    (call $outNum (local.get $n))
    (out.str "</a></sup>"))

  (func $htmlFootnotesOpen
    (call $cr)
    (if (global.get $fmt)
      (then (out.str "<section data-markdown=\22section\22 class=\22footnotes\22 data-footnotes>\n<ol data-markdown=\22ol\22>\n"))
      (else (out.str "<section class=\22footnotes\22 data-footnotes>\n<ol>\n"))))

  (func $htmlFootnotesClose
    (call $cr)
    (out.str "</ol>\n</section>\n"))

  (func $htmlFootnoteOpen (param $n i32)
    (call $cr)
    (if (global.get $fmt)
      (then (out.str "<li data-markdown=\22li\22 id=\22"))
      (else (out.str "<li id=\22")))
    (call $outIdPrefix (i32.const 0))
    (out.str "fn-")
    (call $outNum (local.get $n))
    (out.str "\22>\n"))

  ;; the back references belong at the end of the last paragraph, so rewind
  ;; over its closing tag and write them inside it
  (func $htmlFootnoteClose (param $n i32) (param $def i32)
    (local $k i32)
    (local $inside i32)
    (local.set $k (i32.const 1))
    (if (i32.ge_u (global.get $out) (i32.add (global.get $outBase) (i32.const 5)))
      (then
        (if (i64.eq (i64.and (i64.load (i32.sub (global.get $out) (i32.const 5)))
              (i64.const 0xffffffffff)) (i64.const "</p>\n"))
          (then
            (local.set $inside (i32.const 1))
            (global.set $out (i32.sub (global.get $out) (i32.const 5)))))))
    (block $done
      (loop $l
        (br_if $done (i32.gt_u (local.get $k) (i32.load offset=12 (local.get $def))))
        (if (global.get $fmt)
          (then (out.str " <a data-markdown=\22a\22 href=\22#"))
          (else (out.str " <a href=\22#")))
        (call $outIdPrefix (i32.const 1))
        (out.str "fnref-")
        (call $outRefId (local.get $n) (local.get $k))
        (out.str "\22 class=\22footnote-backref\22 data-footnote-backref data-footnote-backref-idx=\22")
        (call $outRefId (local.get $n) (local.get $k))
        (out.str "\22 aria-label=\22Back to reference ")
        (call $outRefId (local.get $n) (local.get $k))
        (out.str "\22>\e2\86\a9</a>")
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br $l)))
    (if (local.get $inside) (then (out.str "</p>\n")))
    (call $cr)
    (out.str "</li>\n"))

  ;; Write the link URL percent-encoded; $flags is as for $outHref. Its
  ;; reservation leaves 64 bytes for the attribute boundaries that follow.
  (func $htmlUrl (param $flags i32)
    (call $ensureOut (i32.add (i32.mul
      (i32.sub (global.get $linkUrlEnd) (global.get $linkUrlBeg)) (i32.const 9)) (i32.const 64)))
    (call $outHref (i32.add (call $linkBase) (global.get $linkUrlBeg))
      (i32.add (call $linkBase) (global.get $linkUrlEnd)) (local.get $flags)))

  ;; Write a link range as cleaned, escaped text; $flags is as for $outCleanText.
  (func $htmlLinkText (param $beg i32) (param $end i32) (param $flags i32)
    (call $ensureOut (i32.add (i32.mul
      (i32.sub (local.get $end) (local.get $beg)) (i32.const 12)) (i32.const 64)))
    (call $outCleanText (i32.add (call $linkBase) (local.get $beg))
      (i32.add (call $linkBase) (local.get $end)) (local.get $flags)))

  ;; Write ` title="..."` when the link has a title, without its closing quote.
  (func $htmlTitle
    (if (i32.ne (global.get $linkTitleEnd) (global.get $linkTitleBeg))
      (then
        (out.str "\22 title=\22")
        (call $htmlLinkText (global.get $linkTitleBeg) (global.get $linkTitleEnd) (i32.const 3)))))

  (func $htmlLinkOpen (param $image i32)
    (local $url i32)
    (if (local.get $image)
      (then
        (global.set $imgDrop (global.get $out))
        (if (global.get $fmt)
          (then (out.str "<img data-markdown=\22img\22 src=\22"))
          (else (out.str "<img src=\22")))
        (local.set $url (global.get $out))
        (call $htmlUrl (i32.const 3))
        ;; a formatted image whose URL fails the rules is dropped when it closes
        (if (i32.or (i32.eqz (global.get $fmt))
              (call $urlAllowed (local.get $url) (global.get $out)))
          (then (global.set $imgDrop (i32.const 0))))
        (out.str "\22 alt=\22")
        (return)))
    ;; No destination yet: an inert anchor around the label. Completion's
    ;; placeholder (option bit 4) is known by its input position, counted back
    ;; from the end of the content, so a source that writes the same URL keeps it.
    (if (i32.or (global.get $linkPending)
          (i32.and
            (i32.and (i32.shr_u (i32.load8_u (i32.const 1)) (i32.const 4)) (global.get $linkInContent))
            (i32.eq (global.get $completePlaceholder)
              (i32.sub (i32.add (global.get $contentInputEnd) (global.get $linkUrlBeg))
                (global.get $contentLen)))))
      (then
        (if (global.get $fmt)
          (then (out.str "<a data-markdown=\22incomplete-link\22>"))
          (else (out.str "<a data-markdown-incomplete>")))
        (return)))
    (if (global.get $fmt)
      (then
        (out.str "<a data-markdown=\22a\22")
        (call $htmlHref (i32.const 0) (i32.const 3))
        (if (i32.ne (global.get $linkTitleEnd) (global.get $linkTitleBeg))
          (then
            (out.str " title=\22")
            (call $htmlLinkText (global.get $linkTitleBeg) (global.get $linkTitleEnd) (i32.const 3))
            (call $outByte (i32.const 34))))
        (call $outByte (i32.const ">"))
        (return)))
    (out.str "<a href=\22")
    (call $htmlUrl (i32.const 3))
    (call $htmlTitle)
    (out.str "\22>"))

  (func $htmlLinkClose (param $image i32)
    (if (local.get $image)
      (then
        (call $htmlTitle)
        (if (global.get $fmt)
          (then
            (out.str "\22 loading=\22lazy\22>")
            (if (global.get $imgDrop) (then (global.set $out (global.get $imgDrop)))))
          (else (out.str "\22 />")))
        (return)))
    (out.str "</a>"))

  ;; $kind 1 adds http:// and 2 adds mailto:. $flags selects the URL and text
  ;; cleanup, as for $outHref: autolinks decode entities, extended ones do not.
  (func $htmlAutolink (param $kind i32) (param $flags i32)
    (if (global.get $fmt)
      (then
        (out.str "<a data-markdown=\22a\22")
        (call $htmlHref (local.get $kind) (local.get $flags))
        (call $outByte (i32.const ">")))
      (else
        (out.str "<a href=\22")
        (if (i32.eq (local.get $kind) (i32.const 1)) (then (out.str "http://")))
        (if (i32.eq (local.get $kind) (i32.const 2)) (then (out.str "mailto:")))
        (call $htmlUrl (local.get $flags))
        (out.str "\22>")))
    (call $htmlLinkText (global.get $linkUrlBeg) (global.get $linkUrlEnd) (local.get $flags))
    (out.str "</a>"))
)
