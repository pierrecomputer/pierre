(module
  (import "./memory.wat")
  (import "./scan.wat")

  ;; Tag names that open an HTML block of type 6.
  (word-table $mem.blockTags $mem.blockTagsEnd
    "address" "article" "aside" "base" "basefont" "blockquote" "body" "caption"
    "center" "col" "colgroup" "dd" "details" "dialog" "dir" "div" "dl" "dt"
    "fieldset" "figcaption" "figure" "footer" "form" "frame" "frameset"
    "h1" "h2" "h3" "h4" "h5" "h6" "head" "header" "hr" "html" "iframe" "legend"
    "li" "link" "main" "menu" "menuitem" "nav" "noframes" "ol" "optgroup"
    "option" "p" "param" "search" "section" "summary" "table" "tbody" "td"
    "tfoot" "th" "thead" "title" "tr" "track" "ul")

  ;; Tag names GFM escapes instead of passing through (the tagfilter extension).
  (word-table $mem.filterTags $mem.filterTagsEnd
    "title" "textarea" "style" "xmp" "iframe" "noembed" "noframes" "script" "plaintext")

  ;; Binary search $count sorted names of $len bytes at $names for the bytes
  ;; at $key, each ORed with $fold. Returns the index of the match, or -1.
  (func $findName
    (param $names i32) (param $count i32) (param $len i32) (param $key i32) (param $fold i32)
    (result i32)
    (local $lo i32)
    (local $mid i32)
    (local $i i32)
    (local $a i32)
    (local $b i32)
    (local $name i32)
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $count)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $count)) (i32.const 1)))
        (local.set $name (i32.add (local.get $names)
          (i32.mul (local.get $mid) (local.get $len))))
        (local.set $i (i32.const 0))
        (block $mismatch
          (loop $byte
            (if (i32.eq (local.get $i) (local.get $len))
              (then (return (local.get $mid))))
            (local.set $a (i32.load8_u (i32.add (local.get $name) (local.get $i))))
            (local.set $b (i32.or (i32.load8_u (i32.add (local.get $key) (local.get $i)))
              (local.get $fold)))
            (br_if $mismatch (i32.ne (local.get $a) (local.get $b)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $byte)))
        (if (i32.lt_u (local.get $a) (local.get $b))
          (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
          (else (local.set $count (local.get $mid))))
        (br $search)))
    (i32.const -1))

  ;; case-insensitive lookup of [$p,$p+$len) in a generated word table.
  ;; Tag names are letters, digits and `-`, and every one of those bytes
  ;; already has bit 0x20 set or is a letter, so `| 32` folds case exactly.
  (func $wordLookup
    (param $table i32) (param $p i32) (param $len i32) (param $max i32) (result i32)
    (local $group i32)
    (if (i32.gt_u (local.get $len) (local.get $max)) (then (return (i32.const 0))))
    (local.set $group (i32.load16_u (i32.add (local.get $table)
      (i32.shl (local.get $len) (i32.const 1)))))
    (i32.ge_s (call $findName
      (i32.add (local.get $table) (i32.and (local.get $group) (i32.const 0x1ff)))
      (i32.shr_u (local.get $group) (i32.const 9)) (local.get $len) (local.get $p) (i32.const 32))
      (i32.const 0)))

  ;; spacechar in the HTML grammar: space, tab, and the vertical whitespace
  (func $isTagSpace (param $c i32) (result i32)
    (i32.or
      (i32.eq (local.get $c) (i32.const 32))
      (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))

  ;; tagname = [A-Za-z][A-Za-z0-9-]* ; returns the length, or 0
  (func $scanTagName (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.eqz (call $isAlpha (i32.load8_u (local.get $p)))) (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $q) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $done (i32.eqz (i32.or
          (call $isAlnum (local.get $c))
          (i32.eq (local.get $c) (i32.const "-")))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (i32.sub (local.get $q) (local.get $p)))

  ;; opentag = tagname attribute* spacechar* [/]? [>], starting at the tag name.
  ;; Returns the position just past `>`, or 0.
  (func $scanOpenTag (param $p i32) (param $end i32) (result i32)
    (local $n i32)
    (local $q i32)
    (local $c i32)
    (local.set $n (call $scanTagName (local.get $p) (local.get $end)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $p) (local.get $n)))
    (block $attrsDone
      (loop $attr
        ;; an attribute needs at least one space before its name
        (local.set $q (call $skipWs (local.get $p) (local.get $end)))
        (br_if $attrsDone (i32.eq (local.get $q) (local.get $p)))
        (local.set $p (local.get $q))
        ;; attributename = [a-zA-Z_:][a-zA-Z0-9:._-]*
        (block $nameDone
          (loop $name
            (br_if $nameDone (i32.ge_u (local.get $q) (local.get $end)))
            (br_if $nameDone (i32.eqz (call $byteIn (i32.load8_u (local.get $q))
              (select (i64.const 0x7ff600000000000) (i64.const 0x400000000000000)
                (i32.gt_u (local.get $q) (local.get $p)))
              (i64.const 0x7fffffe87fffffe))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $name)))
        (br_if $attrsDone (i32.eq (local.get $q) (local.get $p)))
        (local.set $p (local.get $q))
        ;; optional spacechar* '=' spacechar* value
        (local.set $q (call $skipWs (local.get $p) (local.get $end)))
        (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
              (i32.eq (i32.load8_u (local.get $q)) (i32.const "=")))
          (then
            (local.set $q (call $skipWs (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
            ;; attributevalue = unquoted | 'single' | "double"
            (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
            (local.set $c (i32.load8_u (local.get $q)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "'"))
                  (i32.eq (local.get $c) (i32.const "\22")))
              (then
                (local.set $p (call $findByte
                  (i32.add (local.get $q) (i32.const 1)) (local.get $end) (local.get $c)))
                (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
                (local.set $p (i32.add (local.get $p) (i32.const 1))))
              (else
                ;; unquotedvalue = [^ \t\r\n\v\f"'=<>`]+
                (local.set $p (local.get $q))
                (block $valueDone
                  (loop $value
                    (br_if $valueDone (i32.ge_u (local.get $p) (local.get $end)))
                    (br_if $valueDone (call $byteIn (i32.load8_u (local.get $p))
                      (i64.const 0x7000008500003e00) (i64.const 0x100000000)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $value)))
                (if (i32.eq (local.get $p) (local.get $q)) (then (return (i32.const 0))))))))
        (br $attr)))
    (local.set $p (call $skipWs (local.get $p) (local.get $end)))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $p) (i32.eq (i32.load8_u (local.get $p)) (i32.const "/"))))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const ">")) (then (return (i32.const 0))))
    (i32.add (local.get $p) (i32.const 1)))

  ;; closetag = tagname spacechar* [>], starting just past the `/`
  (func $scanCloseTag (param $p i32) (param $end i32) (result i32)
    (local $n i32)
    (local.set $n (call $scanTagName (local.get $p) (local.get $end)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (local.set $p (call $skipWs (i32.add (local.get $p) (local.get $n)) (local.get $end)))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const ">")) (then (return (i32.const 0))))
    (i32.add (local.get $p) (i32.const 1)))

  ;; Bits for the constructs whose closer is known to be absent from the rest
  ;; of the inline content: comment 1, processing instruction 2, CDATA 4,
  ;; declaration 8. A later opener of the same kind searches a suffix of the
  ;; failed range, so it fails at once. The inline scan clears this per leaf.
  (global $htmlNoClose (mut i32) (i32.const 0))

  ;; The position past the first $n-byte sequence $seq (packed little-endian)
  ;; in [$p,$end), or 0. A miss sets $kind in $htmlNoClose; a known miss
  ;; returns at once.
  (func $findSeq (param $p i32) (param $end i32) (param $seq i32) (param $n i32) (param $kind i32)
    (result i32)
    (if (i32.eqz (i32.and (global.get $htmlNoClose) (local.get $kind)))
      (then
        (loop $l
          (local.set $p (call $findByte (local.get $p) (local.get $end)
            (i32.and (local.get $seq) (i32.const 0xff))))
          (if (i32.le_u (i32.add (local.get $p) (local.get $n)) (local.get $end))
            (then
              (if (i32.eq (local.get $seq) (i32.and (i32.load (local.get $p))
                    (i32.shr_u (i32.const -1)
                      (i32.sub (i32.const 32) (i32.shl (local.get $n) (i32.const 3))))))
                (then (return (i32.add (local.get $p) (local.get $n)))))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $l))))
        (global.set $htmlNoClose (i32.or (global.get $htmlNoClose) (local.get $kind)))))
    (i32.const 0))

  ;; A complete raw HTML construct starting at `<`, or 0. Handles tags,
  ;; comments, processing instructions, declarations and CDATA.
  (func $scanHtmlAny (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local $q i32)
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=1 (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "!"))
      (then
        (if (i32.gt_u (i32.add (local.get $p) (i32.const 4)) (local.get $end))
          (then (return (i32.const 0))))
        ;; A comment ends at the first `-->`; `<!-->` and `<!--->` are whole.
        (if (i32.eq (i32.load16_u offset=2 (local.get $p)) (i32.const "--"))
          (then (return (call $findSeq (i32.add (local.get $p) (i32.const 2)) (local.get $end)
            (i32.const "-->") (i32.const 3) (i32.const 1)))))
        (if (i32.eq (i32.load8_u offset=2 (local.get $p)) (i32.const "["))
          (then
            (if (i32.or (i32.gt_u (i32.add (local.get $p) (i32.const 9)) (local.get $end))
                  (i64.ne (i64.and (i64.load offset=3 (local.get $p)) (i64.const 0xffffffffffff))
                    (i64.const "CDATA[")))
              (then (return (i32.const 0))))
            (return (call $findSeq (i32.add (local.get $p) (i32.const 9)) (local.get $end)
              (i32.const "]]>") (i32.const 3) (i32.const 4)))))
        ;; declaration: `<!` letter+ [^>]* `>`
        (local.set $q (i32.add (local.get $p) (i32.const 2)))
        (block $declNameDone
          (loop $declName
            (br_if $declNameDone (i32.ge_u (local.get $q) (local.get $end)))
            (br_if $declNameDone (i32.eqz (call $isAlpha (i32.load8_u (local.get $q)))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $declName)))
        (if (i32.eq (local.get $q) (i32.add (local.get $p) (i32.const 2))) (then (return (i32.const 0))))
        (return (call $findSeq (local.get $q) (local.get $end)
          (i32.const ">") (i32.const 1) (i32.const 8)))))
    (if (i32.eq (local.get $c) (i32.const "?"))
      (then (return (call $findSeq (i32.add (local.get $p) (i32.const 2)) (local.get $end)
        (i32.const "?>") (i32.const 2) (i32.const 2)))))
    (if (i32.eq (local.get $c) (i32.const "/"))
      (then (return (call $scanCloseTag (i32.add (local.get $p) (i32.const 2)) (local.get $end)))))
    (call $scanOpenTag (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
)
