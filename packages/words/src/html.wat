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

  (func $htmlBlockOpen (param $t i32) (param $r i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then (call $cr) (out.str "<blockquote>\n") (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.ul))
      (then (call $cr) (out.str "<ul>\n") (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.ol))
      (then
        (call $cr)
        (if (i32.eq (i32.load offset=8 (local.get $r)) (i32.const 1))
          (then (out.str "<ol>\n"))
          (else
            (out.str "<ol start=\22")
            (call $outNum (i32.load offset=8 (local.get $r)))
            (out.str "\22>\n")))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then (call $cr) (out.str "<li>") (return))))

  (func $htmlBlockClose (param $t i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then (call $cr) (out.str "</blockquote>\n") (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.ul))
      (then (call $cr) (out.str "</ul>\n") (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.ol))
      (then (call $cr) (out.str "</ol>\n") (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then (out.str "</li>\n") (return))))

  (func $htmlLeaf (param $t i32) (param $r i32)
    (local $lev i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.hr))
      (then (call $cr) (out.str "<hr />\n") (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.p))
      (then
        (if (call $tightParagraph)
          (then
            (call $htmlTaskBox)
            (call $renderInline (local.get $r)))
          (else
            (call $cr)
            (out.str "<p>")
            (call $htmlTaskBox)
            (call $renderInline (local.get $r))
            (out.str "</p>\n")))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.heading))
      (then
        (local.set $lev (i32.load offset=8 (local.get $r)))
        (call $cr)
        (out.str "<h")
        (call $outByte (i32.add (i32.const "0") (local.get $lev)))
        (call $outByte (i32.const ">"))
        (call $htmlTaskBox)
        (call $renderInline (local.get $r))
        (out.str "</h")
        (call $outByte (i32.add (i32.const "0") (local.get $lev)))
        (out.str ">\n")
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.code))
      (then (call $htmlCodeBlock (local.get $r)) (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.html))
      (then (call $htmlRawBlock (local.get $r)) (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.table))
      (then (call $htmlTable (local.get $r)) (return))))

  ;; GFM renders a task list item's marker as a disabled checkbox
  (func $htmlTaskBox
    (if (i32.eqz (global.get $pendingTask)) (then (return)))
    (if (i32.eq (global.get $pendingTask) (i32.const 2))
      (then (out.str "<input checked=\22\22 disabled=\22\22 type=\22checkbox\22>"))
      (else (out.str "<input disabled=\22\22 type=\22checkbox\22>")))
    (global.set $pendingTask (i32.const 0)))

  (func $htmlCodeBlock (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
    (local $next i32)
    (local $p i32)
    (local $e i32)
    (local $c i32)
    (call $cr)
    (out.str "<pre")
    (if (i32.and (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 2)) (i32.const 0))
          (i32.eq (local.get $r) (global.get $incompleteCodeRec)))
      (then (out.str " data-markdown-incomplete")))
    (out.str ">")
    (if (i32.gt_u (i32.load offset=12 (local.get $r)) (i32.load offset=8 (local.get $r)))
      (then
        (out.str "<code class=\22language-")
        ;; The info string's first word, with entities and escapes resolved.
        (local.set $p (i32.load offset=8 (local.get $r)))
        (local.set $e (i32.load offset=12 (local.get $r)))
        (block $infoDone
          (loop $info
            (br_if $infoDone (i32.ge_u (local.get $p) (local.get $e)))
            (local.set $next (local.get $p))
            (block $spanDone
              (loop $span
                (br_if $spanDone (i32.ge_u (local.get $p) (local.get $e)))
                (local.set $c (i32.load8_u (local.get $p)))
                (br_if $spanDone (i32.or
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "&"))
                    (i32.eq (local.get $c) (i32.const "\5c")))
                  (call $isWhiteByte (local.get $c))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $span)))
            (call $outText (local.get $next) (local.get $p))
            (br_if $infoDone (i32.ge_u (local.get $p) (local.get $e)))
            (br_if $infoDone (call $isWhiteByte (local.get $c)))
            (if (i32.eq (local.get $c) (i32.const "&"))
              (then
                (local.set $n (call $entityMatch (local.get $p) (local.get $e)))
                (if (local.get $n)
                  (then
                    (call $outText (global.get $entVal)
                      (i32.add (global.get $entVal) (global.get $entLen)))
                    (local.set $p (i32.add (local.get $p) (local.get $n)))
                    (br $info)))))
            (if (i32.eq (local.get $c) (i32.const "\5c"))
              (then
                (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $e))
                      (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
            (call $outText (local.get $p) (i32.add (local.get $p) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $info)))
        (out.str "\22>"))
      (else (out.str "<code>")))
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $line (call $lineAt (local.get $r) (local.get $i)))
        (local.set $c (call $linePad (local.get $line)))
        (if (local.get $c)
          (then
            (call $outSpaces (local.get $c))
            (local.set $p (call $lineBeg (local.get $line)))
            (local.set $e (call $lineEndOf (local.get $line)))
            (local.set $i (i32.add (local.get $i) (i32.const 1))))
          (else
            (local.set $p (call $lineBeg (local.get $line)))
            (local.set $e (call $lineEndOf (local.get $line)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (block $groupDone
              (loop $group
                (br_if $groupDone (i32.ge_u (local.get $i) (local.get $n)))
                (local.set $next (call $lineAt (local.get $r) (local.get $i)))
                (br_if $groupDone (call $linePad (local.get $next)))
                (br_if $groupDone (i32.ne
                  (call $lineBeg (local.get $next))
                  (i32.add (local.get $e) (i32.const 1))))
                (br_if $groupDone
                  (i32.ne (i32.load8_u (local.get $e)) (i32.const 10)))
                (local.set $e (call $lineEndOf (local.get $next)))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $group)))))
        (call $outText (local.get $p) (local.get $e))
        (call $outByte (i32.const 10))
        (br $l)))
    (out.str "</code></pre>\n"))

  (func $outSpaces (param $n i32)
    (if (i32.eqz (local.get $n)) (then (return)))
    (call $ensureOut (i32.const 8))
    (memory.fill (global.get $out) (i32.const 32) (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n))))

  (func $htmlRawBlock (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
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
            (if (if (result i32) (i32.ge_u (local.get $tagEnd) (local.get $e))
                  (then (local.get $eol))
                  (else (i32.or
                    (i32.or
                      (call $isTagSpace (i32.load8_u (local.get $tagEnd)))
                      (i32.eq (i32.load8_u (local.get $tagEnd)) (i32.const ">")))
                    (if (result i32)
                        (i32.eq (i32.load8_u (local.get $tagEnd)) (i32.const "/"))
                      (then
                        (if (result i32)
                            (i32.lt_u (i32.add (local.get $tagEnd) (i32.const 1)) (local.get $e))
                          (then (i32.eq
                            (i32.load8_u offset=1 (local.get $tagEnd)) (i32.const ">")))
                          (else (i32.const 0))))
                      (else (i32.const 0))))))
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
    (out.str "<table>\n<thead>\n")
    (call $htmlTableRow (local.get $r) (i32.const 0) (local.get $cols) (i32.const 1))
    (out.str "</thead>\n")
    (if (i32.gt_u (local.get $rows) (i32.const 1))
      (then
        (out.str "<tbody>\n")
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
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $cols)))
        (local.set $align (i32.load8_u
          (i32.add (i32.add (local.get $r) (i32.const $R.header)) (local.get $i))))
        (if (local.get $head) (then (out.str "<th")) (else (out.str "<td")))
        (if (i32.eq (local.get $align) (i32.const $A.left))
          (then (out.str " align=\22left\22"))
          (else
            (if (i32.eq (local.get $align) (i32.const $A.center))
              (then (out.str " align=\22center\22"))
              (else
                (if (i32.eq (local.get $align) (i32.const $A.right))
                  (then (out.str " align=\22right\22")))))))
        (call $outByte (i32.const ">"))
        (local.set $has (call $cellRange (local.get $p) (local.get $end)))
        (local.set $p (global.get $cellNext))
        (if (local.get $has)
          (then (call $renderCell (global.get $cellBeg) (global.get $cellEnd))))
        (if (local.get $head) (then (out.str "</th>\n")) (else (out.str "</td>\n")))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (out.str "</tr>\n"))

  (func $htmlFootnoteRef (param $n i32) (param $k i32)
    (out.str "<sup class=\22footnote-ref\22><a href=\22#fn-")
    (call $outNum (local.get $n))
    (out.str "\22 id=\22fnref-")
    (call $outNum (local.get $n))
    (if (i32.gt_u (local.get $k) (i32.const 1))
      (then
        (call $outByte (i32.const "-"))
        (call $outNum (local.get $k))))
    (out.str "\22 data-footnote-ref>")
    (call $outNum (local.get $n))
    (out.str "</a></sup>"))

  (func $htmlFootnotesOpen
    (call $cr)
    (out.str "<section class=\22footnotes\22 data-footnotes>\n<ol>\n"))

  (func $htmlFootnotesClose
    (call $cr)
    (out.str "</ol>\n</section>\n"))

  (func $htmlFootnoteOpen (param $n i32)
    (call $cr)
    (out.str "<li id=\22fn-")
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
        (out.str " <a href=\22#fnref-")
        (call $outNum (local.get $n))
        (if (i32.gt_u (local.get $k) (i32.const 1))
          (then
            (call $outByte (i32.const "-"))
            (call $outNum (local.get $k))))
        (out.str "\22 class=\22footnote-backref\22 data-footnote-backref data-footnote-backref-idx=\22")
        (call $outNum (local.get $n))
        (if (i32.gt_u (local.get $k) (i32.const 1))
          (then
            (call $outByte (i32.const "-"))
            (call $outNum (local.get $k))))
        (out.str "\22 aria-label=\22Back to reference ")
        (call $outNum (local.get $n))
        (if (i32.gt_u (local.get $k) (i32.const 1))
          (then
            (call $outByte (i32.const "-"))
            (call $outNum (local.get $k))))
        (out.str "\22>\e2\86\a9</a>")
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br $l)))
    (if (local.get $inside) (then (out.str "</p>\n")))
    (call $cr)
    (out.str "</li>\n"))

  (func $htmlLinkOpen (param $image i32)
    (if (local.get $image)
      (then
        (out.str "<img src=\22")
        (call $ensureOut (i32.add (i32.mul (call $linkUrlLen) (i32.const 8)) (i32.const 64)))
        (call $outHref (call $linkUrl) (call $linkUrlTo) (i32.const 3))
        (out.str "\22 alt=\22")
        (return)))
    (if (global.get $linkPending)
      (then
        (out.str "<a href=\22streamdown:incomplete-link\22>")
        (return)))
    (out.str "<a href=\22")
    (call $ensureOut (i32.add (i32.mul (call $linkUrlLen) (i32.const 8)) (i32.const 64)))
    (call $outHref (call $linkUrl) (call $linkUrlTo) (i32.const 3))
    (call $outByte (i32.const "\22"))
    (if (call $linkTitleLen)
      (then
        (out.str " title=\22")
        (call $ensureOut (i32.add (i32.mul (call $linkTitleLen) (i32.const 12)) (i32.const 64)))
        (call $outCleanText (call $linkTitle) (call $linkTitleTo) (i32.const 3))
        (call $outByte (i32.const "\22"))))
    (call $outByte (i32.const ">")))

  (func $htmlLinkClose (param $image i32)
    (if (local.get $image)
      (then
        (if (call $linkTitleLen)
          (then
            (out.str "\22 title=\22")
            (call $ensureOut (i32.add (i32.mul (call $linkTitleLen) (i32.const 12)) (i32.const 64)))
            (call $outCleanText (call $linkTitle) (call $linkTitleTo) (i32.const 3))))
        (out.str "\22 />")
        (return)))
    (out.str "</a>"))

  (func $htmlAutolink (param $kind i32)
    (out.str "<a href=\22")
    (if (local.get $kind) (then (out.str "mailto:")))
    (call $ensureOut (i32.add (i32.mul (call $linkUrlLen) (i32.const 8)) (i32.const 64)))
    (call $outHref (call $linkUrl) (call $linkUrlTo) (i32.const 1))
    (out.str "\22>")
    (call $ensureOut (i32.add (i32.mul (call $linkUrlLen) (i32.const 12)) (i32.const 64)))
    (call $outCleanText (call $linkUrl) (call $linkUrlTo) (i32.const 1))
    (out.str "</a>"))

  (func $htmlExtLink (param $kind i32)
    (out.str "<a href=\22")
    (if (i32.eq (local.get $kind) (i32.const 1)) (then (out.str "http://")))
    (if (i32.eq (local.get $kind) (i32.const 2)) (then (out.str "mailto:")))
    (call $ensureOut (i32.add (i32.mul (call $linkUrlLen) (i32.const 8)) (i32.const 64)))
    (call $outHref (call $linkUrl) (call $linkUrlTo) (i32.const 0))
    (out.str "\22>")
    (call $ensureOut (i32.add (i32.mul (call $linkUrlLen) (i32.const 6)) (i32.const 64)))
    (call $outTextReserved (call $linkUrl) (call $linkUrlTo))
    (out.str "</a>"))
)
