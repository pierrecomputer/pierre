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
          (if (i32.and (global.get $ext) (i32.const 2))
            (then (if (call $mathBlock (local.get $r)) (then (return)))))
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

  ;; Reserve the worst case once, then resolve content pointers, which growth
  ;; may move. Line endings become spaces.
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
    (if (global.get $allowAt) (then (call $allowBlock (local.get $r)) (return)))
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
    ;; structured React output drops raw HTML
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

  ;; The host's allowed HTML list (control bytes 44 to 47), or 0. Each entry
  ;; is the name length, flags (bit 0: void element), the lowercase name, the
  ;; byte length of its attribute list (u16), then each lowercase attribute
  ;; as its name length, flags (bit 0: URL attribute), and name.
  (global $allowAt (mut i32) (i32.const 0))
  (global $allowEnd (mut i32) (i32.const 0))
  ;; Open allowed elements at $mem.allowStack, four bytes each: the entry
  ;; offset (u16), the render depth, and 1 for an element of inline content.
  ;; Inline elements close at the end of their leaf and block elements with
  ;; their container, so the output stays balanced.
  (global $allowTop (mut i32) (i32.const 0))
  ;; The input length before the last boundary with no open element.
  (global $allowSafe (mut i32) (i32.const 0))

  ;; Find the $n-byte name at $p in the list [$at, $end): tag entries when
  ;; $tags is 1, attributes when 0. Letters match in either case.
  ;; Returns the entry, or 0.
  (func $allowFind (param $at i32) (param $end i32) (param $p i32) (param $n i32) (param $tags i32)
    (result i32)
    (local $name i32)
    (local $i i32)
    (local $c i32)
    (block $none
      (loop $entry
        (br_if $none (i32.ge_u (local.get $at) (local.get $end)))
        (local.set $name (i32.add (local.get $at) (i32.const 2)))
        (block $next
          (br_if $next (i32.ne (i32.load8_u (local.get $at)) (local.get $n)))
          (local.set $i (i32.const 0))
          (loop $byte
            (if (i32.eq (local.get $i) (local.get $n)) (then (return (local.get $at))))
            (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $i))))
            (br_if $next (i32.ne (i32.load8_u (i32.add (local.get $name) (local.get $i)))
              (i32.or (local.get $c) (i32.shl
                (i32.lt_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 26)) (i32.const 5)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $byte)))
        (local.set $at (i32.add (local.get $name) (i32.load8_u (local.get $at))))
        (if (local.get $tags)
          (then (local.set $at (i32.add (i32.add (local.get $at) (i32.const 2))
            (i32.load16_u (local.get $at))))))
        (br $entry)))
    (i32.const 0))

  ;; Write `</name>` for the list entry at offset $off into reserved output at
  ;; $dst, and return the end.
  (func $allowCloserAt (param $dst i32) (param $off i32) (result i32)
    (local.set $off (i32.add (global.get $allowAt) (local.get $off)))
    (i32.store16 (local.get $dst) (i32.const "</"))
    (local.set $dst (call $copyAt (i32.add (local.get $dst) (i32.const 2))
      (i32.add (local.get $off) (i32.const 2)) (i32.load8_u (local.get $off))))
    (i32.store8 (local.get $dst) (i32.const ">"))
    (i32.add (local.get $dst) (i32.const 1)))

  ;; Close the open elements whose key (render depth, plus 256 when inline) is
  ;; above $keep, innermost first. A block element's closer ends a line.
  (func $allowClose (param $keep i32)
    (local $entry i32)
    ;; 32 closers of at most 255 name bytes and a line feed
    (call $ensureOut (i32.const 8448))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (global.get $allowTop)))
        (local.set $entry (i32.load offset=$mem.allowStack
          (i32.shl (i32.sub (global.get $allowTop) (i32.const 1)) (i32.const 2))))
        (br_if $done (i32.le_s (i32.shr_u (local.get $entry) (i32.const 16)) (local.get $keep)))
        (global.set $allowTop (i32.sub (global.get $allowTop) (i32.const 1)))
        (global.set $out (call $allowCloserAt (global.get $out)
          (i32.and (local.get $entry) (i32.const 0xffff))))
        (i32.store8 (global.get $out) (i32.const 10))
        (global.set $out (i32.add (global.get $out)
          (i32.lt_u (local.get $entry) (i32.const 0x1000000))))
        (br $l))))

;; Whether the attribute value written at [$p, $e) may stay. Browsers skip
  ;; spaces and control bytes in URLs and read `\` as `/`, so the checks read
  ;; the first 16 other bytes, with `\` as `/`. A javascript: or vbscript: URL
  ;; never stays, and with $url the value must pass $urlRules.
  (func $allowValue (param $p i32) (param $e i32) (param $url i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $w i64)
    (v128.store (i32.const $mem.numbuf) (v128.const i64x2 0 0))
    (block $done
      (loop $l
        (br_if $done (i32.or (i32.ge_u (local.get $p) (local.get $e)) (i32.ge_u (local.get $n) (i32.const 16))))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $l (i32.le_u (local.get $c) (i32.const 32)))
        (i32.store8 offset=$mem.numbuf (local.get $n)
          (select (i32.const "/") (local.get $c) (i32.eq (local.get $c) (i32.const "\5c"))))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (local.set $w (i64.or (i64.load (i32.const $mem.numbuf)) (i64.const 0x2020202020202020)))
    (if (i32.or
          (i32.and (i64.eq (local.get $w) (i64.const "javascri"))
            (i32.eq (i32.or (i32.and (i32.load (i32.const $mem.numbuf+8)) (i32.const 0xffffff))
              (i32.const 0x2020)) (i32.const "pt:")))
          (i32.and (i64.eq (local.get $w) (i64.const "vbscript"))
            (i32.eq (i32.load8_u (i32.const $mem.numbuf+8)) (i32.const ":"))))
      (then (return (i32.const 0))))
    (i32.or (i32.eqz (local.get $url))
      (call $urlRules (i32.const $mem.numbuf) (i32.add (i32.const $mem.numbuf) (local.get $n)))))

  ;; The `<` of the closing tag of raw text element $name ($n bytes) in
  ;; [$p, $end), or $end.
  (func $allowSkipRaw (param $p i32) (param $end i32) (param $name i32) (param $n i32) (result i32)
    (local $i i32)
    (loop $l
      (local.set $p (call $findByte (local.get $p) (local.get $end) (i32.const "<")))
      (if (i32.gt_u (i32.add (i32.add (local.get $p) (i32.const 2)) (local.get $n)) (local.get $end))
        (then (return (local.get $end))))
      (block $miss
        (br_if $miss (i32.ne (i32.load8_u offset=1 (local.get $p)) (i32.const "/")))
        (local.set $i (i32.const 0))
        (loop $byte
          (if (i32.lt_u (local.get $i) (local.get $n))
            (then
              (br_if $miss (i32.ne
                (i32.or (i32.load8_u offset=2 (i32.add (local.get $p) (local.get $i))) (i32.const 32))
                (i32.or (i32.load8_u (i32.add (local.get $name) (local.get $i))) (i32.const 32))))
              (local.set $i (i32.add (local.get $i) (i32.const 1)))
              (br $byte))))
        ;; a longer name is another element; the byte at $end is slack
        (local.set $i (i32.load8_u offset=2 (i32.add (local.get $p) (local.get $n))))
        (br_if $miss (i32.or (call $isAlnum (local.get $i)) (i32.eq (local.get $i) (i32.const "-"))))
        (return (local.get $p)))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $l))
    (local.get $end))

  ;; Write the complete raw HTML construct [$p, $q) if it is a tag on the
  ;; allowed list, with only its allowed attributes; drop anything else.
  ;; $inline is 1 in inline content. The caller reserved 6 bytes per input
  ;; byte plus 8448. Returns where the caller goes on: $q, or in an HTML block
  ;; the closing tag of a dropped raw text element such as script or style.
  (func $allowTag (param $p i32) (param $q i32) (param $end i32) (param $inline i32) (result i32)
    (local $close i32)
    (local $name i32)
    (local $n i32)
    (local $entry i32)
    (local $off i32)
    (local $attrs i32)
    (local $attrsEnd i32)
    (local $a i32)
    (local $an i32)
    (local $hit i32)
    (local $v i32)
    (local $ve i32)
    (local $c i32)
    (local $i i32)
    (local $dst i32)
    (local $at i32)
    (local.set $close (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/")))
    (local.set $name (i32.add (i32.add (local.get $p) (i32.const 1)) (local.get $close)))
    ;; comments, processing instructions, declarations, and CDATA have no name
    (local.set $n (call $scanTagName (local.get $name) (local.get $q)))
    (if (i32.eqz (local.get $n)) (then (return (local.get $q))))
    (local.set $entry (call $allowFind (global.get $allowAt) (global.get $allowEnd)
      (local.get $name) (local.get $n) (i32.const 1)))
    (if (i32.eqz (local.get $entry))
      (then
        (if (i32.eqz (i32.or (local.get $inline) (local.get $close)))
          (then
            (if (call $wordLookup (i32.const $mem.filterTags) (local.get $name) (local.get $n) (i32.const 9))
              (then (return (call $allowSkipRaw (local.get $q) (local.get $end)
                (local.get $name) (local.get $n)))))))
        (return (local.get $q))))
    (local.set $off (i32.sub (local.get $entry) (global.get $allowAt)))
    (if (local.get $close)
      (then
        ;; A void element has no closing tag. Otherwise close the nearest
        ;; open element of this name in the same leaf or container, and the
        ;; elements opened after it.
        (if (i32.and (i32.load8_u offset=1 (local.get $entry)) (i32.const 1))
          (then (return (local.get $q))))
        (local.set $i (global.get $allowTop))
        (loop $search
          (if (i32.eqz (local.get $i)) (then (return (local.get $q))))
          (local.set $i (i32.sub (local.get $i) (i32.const 1)))
          (local.set $c (i32.load offset=$mem.allowStack (i32.shl (local.get $i) (i32.const 2))))
          (if (i32.ne (i32.shr_u (local.get $c) (i32.const 16))
                (i32.or (i32.shl (local.get $inline) (i32.const 8)) (global.get $rsp)))
            (then (return (local.get $q))))
          (br_if $search (i32.ne (i32.and (local.get $c) (i32.const 0xffff)) (local.get $off))))
        (local.set $dst (global.get $out))
        (loop $pop
          (global.set $allowTop (i32.sub (global.get $allowTop) (i32.const 1)))
          (local.set $dst (call $allowCloserAt (local.get $dst)
            (i32.load16_u offset=$mem.allowStack (i32.shl (global.get $allowTop) (i32.const 2)))))
          (br_if $pop (i32.gt_u (global.get $allowTop) (local.get $i))))
        (global.set $out (local.get $dst))
        (return (local.get $q))))
    (if (i32.and (i32.ge_u (global.get $allowTop) (i32.const 32))
          (i32.eqz (i32.and (i32.load8_u offset=1 (local.get $entry)) (i32.const 1))))
      (then (return (local.get $q))))
    (local.set $attrs (i32.add (i32.add (local.get $entry) (i32.const 2)) (local.get $n)))
    (local.set $attrsEnd (i32.add (i32.add (local.get $attrs) (i32.const 2))
      (i32.load16_u (local.get $attrs))))
    (local.set $attrs (i32.add (local.get $attrs) (i32.const 2)))
    (local.set $dst (global.get $out))
    (i32.store8 (local.get $dst) (i32.const "<"))
    (local.set $dst (call $copyAt (i32.add (local.get $dst) (i32.const 1))
      (i32.add (local.get $entry) (i32.const 2)) (local.get $n)))
    ;; The scanner accepted this tag, so its attributes parse as they did there.
    (local.set $a (i32.add (local.get $name) (local.get $n)))
    (block $attrsDone
      (loop $attr
        (local.set $an (call $skipWs (local.get $a) (local.get $q)))
        (br_if $attrsDone (i32.eq (local.get $an) (local.get $a)))
        (local.set $a (local.get $an))
        (block $nameDone
          (loop $nameByte
            (br_if $nameDone (i32.eqz (call $byteIn (i32.load8_u (local.get $an))
              (select (i64.const 0x7ff600000000000) (i64.const 0x400000000000000)
                (i32.gt_u (local.get $an) (local.get $a)))
              (i64.const 0x7fffffe87fffffe))))
            (local.set $an (i32.add (local.get $an) (i32.const 1)))
            (br $nameByte)))
        (br_if $attrsDone (i32.eq (local.get $an) (local.get $a)))
        (local.set $hit (call $allowFind (local.get $attrs) (local.get $attrsEnd)
          (local.get $a) (i32.sub (local.get $an) (local.get $a)) (i32.const 0)))
        (local.set $v (i32.const 0))
        (local.set $a (call $skipWs (local.get $an) (local.get $q)))
        (if (i32.eq (i32.load8_u (local.get $a)) (i32.const "="))
          (then
            (local.set $v (call $skipWs (i32.add (local.get $a) (i32.const 1)) (local.get $q)))
            (local.set $c (i32.load8_u (local.get $v)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "'")) (i32.eq (local.get $c) (i32.const "\22")))
              (then
                (local.set $v (i32.add (local.get $v) (i32.const 1)))
                (local.set $ve (call $findByte (local.get $v) (local.get $q) (local.get $c)))
                (local.set $a (i32.add (local.get $ve) (i32.const 1))))
              (else
                (local.set $ve (local.get $v))
                (block $valueDone
                  (loop $value
                    (br_if $valueDone (call $byteIn (i32.load8_u (local.get $ve))
                      (i64.const 0x7000008500003e00) (i64.const 0x100000000)))
                    (local.set $ve (i32.add (local.get $ve) (i32.const 1)))
                    (br $value)))
                (local.set $a (local.get $ve)))))
          (else (local.set $a (local.get $an))))
        (if (local.get $hit)
          (then
            (local.set $at (local.get $dst))
            (i32.store8 (local.get $dst) (i32.const " "))
            (local.set $dst (call $copyAt (i32.add (local.get $dst) (i32.const 1))
              (i32.add (local.get $hit) (i32.const 2)) (i32.load8_u (local.get $hit))))
            (if (local.get $v)
              (then
                (i32.store16 (local.get $dst) (i32.const "=\22"))
                (global.set $out (i32.add (local.get $dst) (i32.const 2)))
                (call $outCleanText (local.get $v) (local.get $ve) (i32.const 1))
                (local.set $dst (global.get $out))
                ;; formatted output checks URLs as the host's defaultUrlTransform does
                (if (call $allowValue
                      (i32.add (local.get $at) (i32.add (i32.load8_u (local.get $hit)) (i32.const 3)))
                      (local.get $dst)
                      (i32.and (i32.ne (global.get $fmt) (i32.const 0)) (i32.load8_u offset=1 (local.get $hit))))
                  (then
                    (i32.store8 (local.get $dst) (i32.const "\22"))
                    (local.set $dst (i32.add (local.get $dst) (i32.const 1))))
                  (else (local.set $dst (local.get $at))))))))
        (br $attr)))
    (if (i32.and (i32.load8_u offset=1 (local.get $entry)) (i32.const 1))
      (then
        (i32.store (local.get $dst) (i32.const " />"))
        (global.set $out (i32.add (local.get $dst) (i32.const 3)))
        (return (local.get $q))))
    (i32.store8 (local.get $dst) (i32.const ">"))
    (local.set $dst (i32.add (local.get $dst) (i32.const 1)))
    ;; HTML ignores `/>` on elements that are not void; here it closes them.
    (if (i32.eq (i32.load8_u (call $skipWs (local.get $a) (local.get $q))) (i32.const "/"))
      (then
        (global.set $out (call $allowCloserAt (local.get $dst) (local.get $off)))
        (return (local.get $q))))
    (global.set $out (local.get $dst))
    (i32.store offset=$mem.allowStack (i32.shl (global.get $allowTop) (i32.const 2))
      (i32.or (local.get $off) (i32.shl
        (i32.or (i32.shl (local.get $inline) (i32.const 8)) (global.get $rsp)) (i32.const 16))))
    (global.set $allowTop (i32.add (global.get $allowTop) (i32.const 1)))
    (local.get $q))

  ;; An HTML block through the allowed list: allowed tags pass, text shows only
  ;; inside an allowed element, and anything else is dropped. A block that
  ;; writes nothing leaves no line break.
  (func $allowBlock (param $r i32)
    (local $start i32)
    (local $mark i32)
    (local $b i32)
    (local $e i32)
    (local $base i32)
    (local $p i32)
    (local $n i32)
    (local.set $start (global.get $out))
    (call $cr)
    (local.set $mark (global.get $out))
    (local.set $e (call $blockContent (local.get $r)))
    (global.set $htmlNoClose (i32.const 0))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $b) (local.get $e)))
        (local.set $base (global.get $contentBase))
        (local.set $p (i32.add (local.get $base) (local.get $b)))
        (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "<"))
          (then
            (local.set $n (i32.sub (call $findByte (local.get $p)
              (i32.add (local.get $base) (local.get $e)) (i32.const "<")) (local.get $p)))
            (if (i32.gt_u (local.get $n) (i32.const 65536)) (then (local.set $n (i32.const 65536))))
            (if (global.get $allowTop)
              (then
                (call $ensureOut (i32.add (i32.mul (local.get $n) (i32.const 6)) (i32.const 16)))
                (local.set $p (call $contentAt (local.get $b)))
                (call $outCleanText (local.get $p) (i32.add (local.get $p) (local.get $n)) (i32.const 1))))
            (local.set $b (i32.add (local.get $b) (local.get $n)))
            (br $l)))
        (local.set $n (call $scanHtmlAny (local.get $p) (i32.add (local.get $base) (local.get $e))))
        (if (i32.eqz (local.get $n))
          (then
            ;; a `<` that starts no construct is text
            (if (global.get $allowTop) (then (out.str "&lt;")))
            (local.set $b (i32.add (local.get $b) (i32.const 1)))
            (br $l)))
        (local.set $n (i32.sub (local.get $n) (local.get $p)))
        ;; Only tags write output, so a long comment needs no reservation.
        (if (call $isAlpha (i32.load8_u offset=1 (i32.add (local.get $p)
              (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/")))))
          (then
            (call $ensureOut (i32.add (i32.mul (local.get $n) (i32.const 6)) (i32.const 8448)))
            (local.set $base (global.get $contentBase))
            (local.set $p (i32.add (local.get $base) (local.get $b)))
            (local.set $n (i32.sub (call $allowTag (local.get $p) (i32.add (local.get $p) (local.get $n))
              (i32.add (local.get $base) (local.get $e)) (i32.const 0)) (local.get $p)))))
        (local.set $b (i32.add (local.get $b) (local.get $n)))
        (br $l)))
    (if (i32.eq (global.get $out) (local.get $mark))
      (then (global.set $out (local.get $start)))
      (else (call $outByte (i32.const 10)))))

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

  ;; The whole cell opener under one reservation. Formatted cells align with
  ;; a style.
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
        (out.str "\22>\e2\86\a9")
        ;; later back-links show their number, as cmark-gfm does
        (if (i32.gt_u (local.get $k) (i32.const 1))
          (then
            (if (global.get $fmt)
              (then (out.str "<sup data-markdown=\22sup\22 class=\22footnote-ref\22>"))
              (else (out.str "<sup class=\22footnote-ref\22>")))
            (call $outNum (local.get $k))
            (out.str "</sup>")))
        (out.str "</a>")
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
