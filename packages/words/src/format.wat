(module
  ;; Formatted HTML for the host's HTML renderer: what html.wat writes when
  ;; the format flags are set, and the code block parts both share.
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./record.wat")
  (import "./render.wat")
  (import "./html.wat")

  ;; Format flags, control byte 26. The host's HTML renderer sets them to get
  ;; its final markup from one pass: each tag names itself in `data-markdown`,
  ;; links pass the URL rules, ids take a prefix, and code blocks get their
  ;; header, line numbers, and line groups. Zero writes plain HTML.
  (const $Fmt.on 1)
  (const $Fmt.numbers 2)   ;; code blocks show line numbers
  (const $Fmt.copy 4)      ;; code blocks have a copy button
  (const $Fmt.download 8)  ;; code blocks have a download button
  (const $Fmt.active 16)   ;; the stream is active, so the open fence shows as incomplete
  (const $Fmt.slots 32)    ;; every code block is in slots (see $htmlCodeBlockFmt)
  (const $Fmt.rawUrls 64)  ;; the host checks URLs and prefixes footnote links
  (global $fmt (mut i32) (i32.const 0))
  ;; Where a formatted image started when its URL failed the rules, or 0.
  (global $imgDrop (mut i32) (i32.const 0))

  ;; Add ` data-markdown="name"` to the tag `<name>` that ends at $dst, and
  ;; return the new end. The name has $n bytes, at most 16. The caller reserved
  ;; 17 + $n bytes past $dst.
  (func $markAt (param $dst i32) (param $n i32) (result i32)
    (local $name v128)
    (local.set $name (v128.load (i32.sub (i32.sub (local.get $dst) (i32.const 1)) (local.get $n))))
    (i64.store (i32.sub (local.get $dst) (i32.const 1)) (i64.const " data-ma"))
    (i64.store offset=7 (local.get $dst) (i64.const "rkdown=\22"))
    (v128.store offset=15 (local.get $dst) (local.get $name))
    (local.set $dst (i32.add (i32.add (local.get $dst) (i32.const 15)) (local.get $n)))
    (i32.store16 (local.get $dst) (i32.const "\22>"))
    (i32.add (local.get $dst) (i32.const 2)))

  ;; Mark the tag written last: `<name>` with $n name bytes, then $nl line
  ;; feeds (0 or 1).
  (func $mark (param $n i32) (param $nl i32)
    (local $dst i32)
    (call $ensureOut (i32.const 34))
    (local.set $dst (call $markAt (i32.sub (global.get $out) (local.get $nl)) (local.get $n)))
    (i32.store8 (local.get $dst) (i32.const 10))
    (global.set $out (i32.add (local.get $dst) (local.get $nl))))

  ;; Write the id prefix. A footnote link takes it too, unless the host checks
  ;; URLs: the host then adds it after its own URL hook.
  (func $outIdPrefix (param $href i32)
    (if (i32.eqz (global.get $fmt)) (then (return)))
    (if (i32.and (local.get $href)
          (i32.ne (i32.and (global.get $fmt) (i32.const $Fmt.rawUrls)) (i32.const 0)))
      (then (return)))
    (call $outRaw (i32.const $mem.idPrefix) (i32.load16_u (i32.const 28))))

  ;; Whether the escaped URL in [$p, $e) of the output passes the URL rules of
  ;; the host's `defaultUrlTransform`: it is relative, or its scheme is http,
  ;; https, ftp, mailto, tel, or xmpp, and it is not a network path. The URL
  ;; is percent-encoded, so it holds no space, control byte, or backslash.
  (func $urlAllowed (param $p i32) (param $e i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $colon i32)
    (local $name i64)
    (if (i32.and (global.get $fmt) (i32.const $Fmt.rawUrls)) (then (return (i32.const 1))))
    (if (i32.ge_u (i32.sub (local.get $e) (local.get $p)) (i32.const 2))
      (then
        (if (i32.eq (i32.load16_u (local.get $p)) (i32.const "//")) (then (return (i32.const 0))))))
    ;; The scheme ends at the last `:` before the path, query, or fragment.
    (local.set $q (local.get $p))
    (block $path
      (loop $l
        (br_if $path (i32.ge_u (local.get $q) (local.get $e)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $path (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const "?"))))
        ;; `&#39;` is an escaped quote, not a fragment
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (br_if $path (i32.eq (local.get $q) (local.get $p)))
            (br_if $path (i32.ne (i32.load8_u (i32.sub (local.get $q) (i32.const 1))) (i32.const "&")))))
        (if (i32.eq (local.get $c) (i32.const ":")) (then (local.set $colon (local.get $q))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (if (i32.eqz (local.get $colon)) (then (return (i32.const 1))))
    (local.set $q (i32.sub (local.get $colon) (local.get $p)))
    (if (i32.gt_u (i32.sub (local.get $q) (i32.const 3)) (i32.const 3)) (then (return (i32.const 0))))
    ;; Compare the scheme in lower case. Only a letter changes to a letter.
    (local.set $name (i64.and
      (i64.or (i64.load (local.get $p)) (i64.const 0x2020202020202020))
      (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $q) (i32.const 3))))
        (i64.const 1))))
    (i32.or
      (i32.or
        (i32.or (i64.eq (local.get $name) (i64.const "http")) (i64.eq (local.get $name) (i64.const "https")))
        (i32.or (i64.eq (local.get $name) (i64.const "mailto")) (i64.eq (local.get $name) (i64.const "ftp"))))
      (i32.or (i64.eq (local.get $name) (i64.const "tel")) (i64.eq (local.get $name) (i64.const "xmpp")))))

  ;; Write ` href="` and the link URL, or nothing when the URL fails the rules.
  (func $htmlHref (param $kind i32) (param $flags i32)
    (local $at i32)
    (local $url i32)
    (local.set $at (global.get $out))
    (out.str " href=\22")
    (local.set $url (global.get $out))
    (if (i32.eq (local.get $kind) (i32.const 1)) (then (out.str "http://")))
    (if (i32.eq (local.get $kind) (i32.const 2)) (then (out.str "mailto:")))
    (call $htmlUrl (local.get $flags))
    (if (call $urlAllowed (local.get $url) (global.get $out))
      (then (call $outByte (i32.const 34)))
      (else (global.set $out (local.get $at)))))

  ;; Write the first word of the info string of code block $r, escaped. The
  ;; word has entities and escapes resolved first, as cmark does. Literal
  ;; whitespace ends the word in the source. Decoded whitespace is trimmed
  ;; before the word and ends it after, so cut the cleaned output: escaping
  ;; never adds or removes whitespace. An info string that decodes to
  ;; whitespace writes nothing.
  (func $htmlInfoWord (param $r i32)
    (local $p i32)
    (local $e i32)
    (local $c i32)
    (local $k i32)
    (local $start i32)
    (local.set $p (i32.load offset=8 (local.get $r)))
    (local.set $e (local.get $p))
    (block $word
      (loop $l
        (br_if $word (i32.ge_u (local.get $e) (i32.load offset=12 (local.get $r))))
        (local.set $c (i32.load8_u (local.get $e)))
        (br_if $word (call $isWhiteByte (local.get $c)))
        (local.set $k (i32.or (local.get $k) (i32.eq (local.get $c) (i32.const "&"))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (call $ensureOut (i32.add
      (i32.mul (i32.sub (local.get $e) (local.get $p)) (i32.const 12)) (i32.const 64)))
    (local.set $start (global.get $out))
    (call $outCleanText (local.get $p) (local.get $e) (i32.const 3))
    ;; only entities can decode to whitespace
    (if (local.get $k)
      (then
        (local.set $p (call $skipWs (local.get $start) (global.get $out)))
        (local.set $e (local.get $p))
        (block $cut
          (loop $l
            (br_if $cut (i32.ge_u (local.get $e) (global.get $out)))
            (br_if $cut (call $isWhiteByte (i32.load8_u (local.get $e))))
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (br $l)))
        (memory.copy (local.get $start) (local.get $p) (i32.sub (local.get $e) (local.get $p)))
        (global.set $out (i32.add (local.get $start) (i32.sub (local.get $e) (local.get $p)))))))

  ;; Write the lines of code block $r, each with its line feed.
  (func $htmlCodeLines (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
    (local $next i32)
    (local $p i32)
    (local $e i32)
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $line (call $lineAt (local.get $r) (local.get $i)))
        (call $outSpaces (call $linePad (local.get $line)))
        (local.set $p (call $lineBeg (local.get $line)))
        (local.set $e (call $lineEndOf (local.get $line)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        ;; following unpadded lines that continue in the source share one write
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
            (br $group)))
        (call $outText (local.get $p) (local.get $e))
        (call $outByte (i32.const 10))
        (br $l))))

  ;; Count the line feeds in [$p, $e). The last vector may read up to 15 bytes
  ;; past $e.
  (func $lineFeeds (param $p i32) (param $e i32) (result i32)
    (local $n i32)
    (local $hit v128)
    (local $mask i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $hit (i8x16.eq (v128.load (local.get $p)) (i8x16.splat (i32.const 10))))
        (if (v128.any_true (local.get $hit))
          (then
            (local.set $mask (i8x16.bitmask (local.get $hit)))
            (if (i32.lt_u (i32.sub (local.get $e) (local.get $p)) (i32.const 16))
              (then (local.set $mask (i32.and (local.get $mask) (i32.sub
                (i32.shl (i32.const 1) (i32.sub (local.get $e) (local.get $p))) (i32.const 1))))))
            (local.set $n (i32.add (local.get $n) (i32.popcnt (local.get $mask))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $l)))
    (local.get $n))

  ;; Count the lines of code block $r. One line range of a record can hold
  ;; several source lines.
  (func $codeLineCount (param $r i32) (result i32)
    (local $i i32)
    (local $line i32)
    (local $count i32)
    (local.set $count (i32.load offset=$R.nLines (local.get $r)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (i32.load offset=$R.nLines (local.get $r))))
        (local.set $line (call $lineAt (local.get $r) (local.get $i)))
        (local.set $count (i32.add (local.get $count)
          (call $lineFeeds (call $lineBeg (local.get $line)) (call $lineEndOf (local.get $line)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (local.get $count))

  ;; Write the lines of code block $r in groups: a span around every 64 lines,
  ;; so a browser lays out only the group that changes. A block without lines
  ;; still gets one group.
  (func $htmlCodeGroups (param $r i32)
    (local $i i32)
    (local $line i32)
    (local $p i32)
    (local $e i32)
    (local $q i32)
    (local $left i32)
    (local $k i32)
    (out.str "<span data-markdown=\22code-lines\22>")
    (local.set $left (i32.const 64))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (i32.load offset=$R.nLines (local.get $r))))
        (local.set $line (call $lineAt (local.get $r) (local.get $i)))
        (local.set $p (call $lineBeg (local.get $line)))
        (local.set $e (call $lineEndOf (local.get $line)))
        (local.set $k (call $linePad (local.get $line)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (loop $part
          (if (i32.eqz (local.get $left))
            (then
              (out.str "</span>")
              (out.str "<span data-markdown=\22code-lines\22>")
              (local.set $left (i32.const 64))))
          (call $outSpaces (local.get $k))
          (local.set $k (i32.add (call $lineFeeds (local.get $p) (local.get $e)) (i32.const 1)))
          (if (i32.gt_u (local.get $k) (local.get $left))
            (then
              ;; The range has more lines than the group takes: cut it after
              ;; the group's last line.
              (local.set $q (local.get $p))
              (loop $skip
                (local.set $q (i32.add
                  (call $findByte (local.get $q) (local.get $e) (i32.const 10)) (i32.const 1)))
                (br_if $skip (local.tee $left (i32.sub (local.get $left) (i32.const 1)))))
              (call $outText (local.get $p) (i32.sub (local.get $q) (i32.const 1)))
              (call $outByte (i32.const 10))
              (local.set $p (local.get $q))
              (local.set $k (i32.const 0))
              (br $part)))
          (local.set $left (i32.sub (local.get $left) (local.get $k)))
          (call $outText (local.get $p) (local.get $e))
          (call $outByte (i32.const 10)))
        (br $l)))
    (out.str "</span>"))

  ;; Write the language of code block $r for an attribute or text: its info
  ;; word with `'` escaped too, or "text".
  (func $htmlLanguage (param $r i32)
    (local $start i32)
    (local $src i32)
    (local $dst i32)
    (local $n i32)
    (local $c i32)
    (local.set $start (global.get $out))
    (call $htmlInfoWord (local.get $r))
    (if (i32.eq (global.get $out) (local.get $start))
      (then (out.str "text") (return)))
    (local.set $src (local.get $start))
    (loop $count
      (local.set $n (i32.add (local.get $n)
        (i32.eq (i32.load8_u (local.get $src)) (i32.const "'"))))
      (br_if $count (i32.lt_u
        (local.tee $src (i32.add (local.get $src) (i32.const 1))) (global.get $out))))
    (if (i32.eqz (local.get $n)) (then (return)))
    ;; Each `'` grows to `&#39;`: move the word up from its end.
    (call $ensureOut (i32.shl (local.get $n) (i32.const 2)))
    (local.set $dst (i32.add (local.get $src) (i32.shl (local.get $n) (i32.const 2))))
    (global.set $out (local.get $dst))
    (loop $move
      (local.set $src (i32.sub (local.get $src) (i32.const 1)))
      (local.set $c (i32.load8_u (local.get $src)))
      (if (i32.eq (local.get $c) (i32.const "'"))
        (then
          (local.set $dst (i32.sub (local.get $dst) (i32.const 5)))
          (i32.store (local.get $dst) (i32.const "&#39"))
          (i32.store8 offset=4 (local.get $dst) (i32.const ";")))
        (else
          (local.set $dst (i32.sub (local.get $dst) (i32.const 1)))
          (i32.store8 (local.get $dst) (local.get $c))))
      (br_if $move (i32.gt_u (local.get $src) (local.get $start)))))

  ;; A code block button of the host: `copy` or `download`.
  (func $htmlCodeButton (param $download i32) (param $disabled i32)
    (if (local.get $download)
      (then (out.str "<button type=\22button\22 data-code-action=\22download\22 aria-label=\22Download code\22"))
      (else (out.str "<button type=\22button\22 data-code-action=\22copy\22 aria-label=\22Copy code\22")))
    (if (local.get $disabled) (then (out.str " disabled=\22\22")))
    (if (local.get $download)
      (then (out.str ">Download</button>"))
      (else (out.str ">Copy</button>"))))

  ;; A formatted code block: a header with the language and buttons, a gutter
  ;; of line numbers, and the code in line groups.
  ;;
  ;; The host needs the parts of some blocks: every block when it has code
  ;; plugins ($Fmt.slots), and the fence that is still open, whose lines it
  ;; updates one by one. Such a block is in slots, each after a NUL, which no
  ;; other output holds:
  ;;
  ;;   NUL state, language   state is "0" closed, "1" open, "2" open and active
  ;;   NUL markup up to <code>; the host adds the gutter of an open fence
  ;;   NUL the <code> tag
  ;;   NUL the escaped code, not in groups
  ;;   NUL then `</code></pre></div>` as for any block
  (func $htmlCodeBlockFmt (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $open i32)
    (local $live i32)
    (local $slots i32)
    (local $at i32)
    (call $cr)
    (local.set $open (i32.eq (local.get $r) (global.get $incompleteCodeRec)))
    (local.set $live (i32.and (local.get $open)
      (i32.ne (i32.and (global.get $fmt) (i32.const $Fmt.active)) (i32.const 0))))
    (local.set $slots (i32.or (local.get $open)
      (i32.and (global.get $fmt) (i32.const $Fmt.slots))))
    (if (local.get $slots)
      (then
        ;; tell the host, which then has no need to search for slots
        (i32.store8 (i32.const 27) (i32.const 1))
        (call $outSmall
          (i64.extend_i32_u (i32.shl
            (i32.add (i32.const "0") (i32.add (local.get $open) (local.get $live))) (i32.const 8)))
          (i32.const 2))
        (call $htmlInfoWord (local.get $r))
        (call $outByte (i32.const 0))))
    (out.str "<div data-markdown=\22code-block\22 data-language=\22")
    (call $htmlLanguage (local.get $r))
    (if (local.get $live) (then (out.str "\22 data-incomplete=\22true")))
    (out.str "\22><div data-markdown=\22code-header\22><span>")
    (call $htmlLanguage (local.get $r))
    (out.str "</span><span>")
    (if (i32.and (global.get $fmt) (i32.const $Fmt.copy))
      (then (call $htmlCodeButton (i32.const 0) (local.get $live))))
    (if (i32.and (global.get $fmt) (i32.const $Fmt.download))
      (then (call $htmlCodeButton (i32.const 1) (local.get $live))))
    (out.str "</span></div><pre dir=\22ltr\22>")
    (if (i32.and (i32.eqz (local.get $open))
          (i32.ne (i32.and (global.get $fmt) (i32.const $Fmt.numbers)) (i32.const 0)))
      (then
        ;; Numbers sit in the same 64-line groups as the code. A line feed
        ;; ends each number but the last. An empty block shows line 1.
        (out.str "<span data-markdown=\22line-numbers\22 aria-hidden=\22true\22>")
        (local.set $n (call $codeLineCount (local.get $r)))
        (local.set $n (select (local.get $n) (i32.const 1) (local.get $n)))
        (loop $number
          (if (i32.eqz (i32.and (local.get $i) (i32.const 63)))
            (then (out.str "<span data-markdown=\22code-lines\22>")))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (call $outNum (local.get $i))
          (if (i32.lt_u (local.get $i) (local.get $n)) (then (call $outByte (i32.const 10))))
          (if (i32.or (i32.eqz (i32.and (local.get $i) (i32.const 63)))
                (i32.eq (local.get $i) (local.get $n)))
            (then (out.str "</span>")))
          (br_if $number (i32.lt_u (local.get $i) (local.get $n))))
        (out.str "</span>")))
    (if (local.get $slots) (then (call $outByte (i32.const 0))))
    (out.str "<code data-markdown=\22code\22")
    (local.set $at (global.get $out))
    (out.str " class=\22language-")
    (local.set $i (global.get $out))
    (call $htmlInfoWord (local.get $r))
    (if (i32.eq (global.get $out) (local.get $i))
      (then (global.set $out (local.get $at)))
      (else (call $outByte (i32.const 34))))
    (call $outByte (i32.const ">"))
    (if (local.get $slots) (then (call $outByte (i32.const 0))))
    (if (local.get $slots)
      (then (call $htmlCodeLines (local.get $r)))
      (else (call $htmlCodeGroups (local.get $r))))
    (if (local.get $slots) (then (call $outByte (i32.const 0))))
    (out.str "</code></pre></div>\n"))
)
