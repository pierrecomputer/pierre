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

  ;; case-insensitive lookup of [$p,$p+$len) in a generated word table.
  ;; Tag names are letters, digits and `-`, and every one of those bytes
  ;; already has bit 0x20 set or is a letter, so `| 32` folds case exactly.
  (func $wordLookup
    (param $table i32) (param $p i32) (param $len i32) (param $max i32) (result i32)
    (local $group i32)
    (local $names i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $i i32)
    (local $a i32)
    (local $b i32)
    (local $name i32)
    (if (i32.gt_u (local.get $len) (local.get $max)) (then (return (i32.const 0))))
    (local.set $group (i32.load16_u (i32.add (local.get $table)
      (i32.shl (local.get $len) (i32.const 1)))))
    (local.set $names (i32.add (local.get $table)
      (i32.and (local.get $group) (i32.const 0x1ff))))
    (local.set $hi (i32.shr_u (local.get $group) (i32.const 9)))
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $name (i32.add (local.get $names)
          (i32.mul (local.get $mid) (local.get $len))))
        (local.set $i (i32.const 0))
        (block $mismatch
          (loop $byte
            (if (i32.eq (local.get $i) (local.get $len))
              (then (return (i32.const 1))))
            (local.set $a (i32.load8_u (i32.add (local.get $name) (local.get $i))))
            (local.set $b (i32.or (i32.load8_u (i32.add (local.get $p) (local.get $i)))
              (i32.const 32)))
            (br_if $mismatch (i32.ne (local.get $a) (local.get $b)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $byte)))
        (if (i32.lt_u (local.get $a) (local.get $b))
          (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
          (else (local.set $hi (local.get $mid))))
        (br $search)))
    (i32.const 0))

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
    (local $sp i32)
    (local $c i32)
    (local.set $n (call $scanTagName (local.get $p) (local.get $end)))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $p) (local.get $n)))
    (block $attrsDone
      (loop $attr
        (local.set $sp (call $skipWs (local.get $p) (local.get $end)))
        ;; an attribute needs at least one space before its name
        (br_if $attrsDone (i32.eq (local.get $sp) (local.get $p)))
        (local.set $p (local.get $sp))
        ;; attributename = [a-zA-Z_:][a-zA-Z0-9:._-]*
        (local.set $n (i32.const 0))
        (block $attrNameInvalid
          (br_if $attrNameInvalid (i32.ge_u (local.get $p) (local.get $end)))
          (local.set $c (i32.load8_u (local.get $p)))
          (br_if $attrNameInvalid (i32.eqz (i32.or
            (call $isAlpha (local.get $c))
            (i32.or
              (i32.eq (local.get $c) (i32.const "_"))
              (i32.eq (local.get $c) (i32.const ":"))))))
          (local.set $q (i32.add (local.get $p) (i32.const 1)))
          (block $attrNameDone
            (loop $attrName
              (br_if $attrNameDone (i32.ge_u (local.get $q) (local.get $end)))
              (local.set $c (i32.load8_u (local.get $q)))
              (br_if $attrNameDone (i32.eqz (i32.or
                (call $isAlnum (local.get $c))
                (i32.or
                  (i32.or
                    (i32.eq (local.get $c) (i32.const ":"))
                    (i32.eq (local.get $c) (i32.const ".")))
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "_"))
                    (i32.eq (local.get $c) (i32.const "-")))))))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $attrName)))
          (local.set $n (i32.sub (local.get $q) (local.get $p))))
        (br_if $attrsDone (i32.eqz (local.get $n)))
        (local.set $p (i32.add (local.get $p) (local.get $n)))
        ;; optional spacechar* '=' spacechar* value
        (local.set $q (call $skipWs (local.get $p) (local.get $end)))
        (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
              (i32.eq (i32.load8_u (local.get $q)) (i32.const "=")))
          (then
            (local.set $q (call $skipWs (i32.add (local.get $q) (i32.const 1)) (local.get $end)))
            ;; attributevalue = unquoted | 'single' | "double"
            (local.set $n (i32.const 0))
            (block $attrValueInvalid
              (br_if $attrValueInvalid (i32.ge_u (local.get $q) (local.get $end)))
              (local.set $c (i32.load8_u (local.get $q)))
              (if (i32.or
                    (i32.eq (local.get $c) (i32.const "'"))
                    (i32.eq (local.get $c) (i32.const "\22")))
                (then
                  (local.set $sp (call $findByte
                    (i32.add (local.get $q) (i32.const 1)) (local.get $end) (local.get $c)))
                  (br_if $attrValueInvalid (i32.ge_u (local.get $sp) (local.get $end)))
                  (local.set $n (i32.add (local.get $sp) (i32.const 1)))
                  (br $attrValueInvalid)))
              ;; unquotedvalue = [^ \t\r\n\v\f"'=<>`]+
              (local.set $sp (local.get $q))
              (block $attrValueDone
                (loop $attrValue
                  (br_if $attrValueDone (i32.ge_u (local.get $sp) (local.get $end)))
                  (local.set $c (i32.load8_u (local.get $sp)))
                  (br_if $attrValueDone (call $isTagSpace (local.get $c)))
                  (br_if $attrValueDone (i32.or
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "\22"))
                      (i32.eq (local.get $c) (i32.const "'")))
                    (i32.or
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "="))
                        (i32.eq (local.get $c) (i32.const "<")))
                      (i32.or
                        (i32.eq (local.get $c) (i32.const ">"))
                        (i32.eq (local.get $c) (i32.const "\60"))))))
                  (local.set $sp (i32.add (local.get $sp) (i32.const 1)))
                  (br $attrValue)))
              (if (i32.gt_u (local.get $sp) (local.get $q))
                (then (local.set $n (local.get $sp)))))
            (if (i32.eqz (local.get $n)) (then (return (i32.const 0))))
            (local.set $p (local.get $n))))
        (br $attr)))
    (local.set $p (call $skipWs (local.get $p) (local.get $end)))
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "/"))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
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
        (if (i32.eq (i32.load16_u offset=2 (local.get $p)) (i32.const "--"))
          (then
            ;; `<!-->` and `<!--->` are comments in their own right
            (if (i32.eq (i32.load8_u offset=4 (local.get $p)) (i32.const ">"))
              (then (return (i32.add (local.get $p) (i32.const 5)))))
            (if (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 6)) (local.get $end))
                  (i32.eq (i32.load16_u offset=4 (local.get $p)) (i32.const "->")))
              (then (return (i32.add (local.get $p) (i32.const 6)))))
            ;; `--` may appear inside a comment unless followed by `>`.
            (local.set $p (i32.add (local.get $p) (i32.const 4)))
            (loop $comment
              (local.set $p (call $findByte (local.get $p) (local.get $end) (i32.const "-")))
              (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                (then (return (i32.const 0))))
              (if (i32.ne (i32.load8_u offset=1 (local.get $p)) (i32.const "-"))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 2)))
                  (br $comment)))
              (if (i32.ge_u (i32.add (local.get $p) (i32.const 2)) (local.get $end))
                (then (return (i32.const 0))))
              (if (i32.eq (i32.load8_u offset=2 (local.get $p)) (i32.const ">"))
                (then (return (i32.add (local.get $p) (i32.const 3)))))
              (local.set $p (i32.add (local.get $p) (i32.const 3)))
              (br $comment))))
        (if (i32.eq (i32.load8_u offset=2 (local.get $p)) (i32.const "["))
          (then
            (if (i32.gt_u (i32.add (local.get $p) (i32.const 9)) (local.get $end))
              (then (return (i32.const 0))))
            (if (i32.ne (i32.load offset=3 (local.get $p)) (i32.const "CDAT"))
              (then (return (i32.const 0))))
            (if (i32.ne (i32.load16_u offset=7 (local.get $p)) (i32.const "A["))
              (then (return (i32.const 0))))
            (local.set $p (i32.add (local.get $p) (i32.const 9)))
            (loop $cdata
              (local.set $p (call $findByte (local.get $p) (local.get $end) (i32.const "]")))
              (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (local.get $end))
                (then (return (i32.const 0))))
              (if (i32.eq (i32.load16_u offset=1 (local.get $p)) (i32.const "]>"))
                (then (return (i32.add (local.get $p) (i32.const 3)))))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $cdata))))
        ;; declaration: `<!` letter+ [^>]* `>`
        (local.set $p (i32.add (local.get $p) (i32.const 2)))
        (local.set $q (local.get $p))
        (block $declNameDone
          (loop $declName
            (br_if $declNameDone (i32.ge_u (local.get $q) (local.get $end)))
            (br_if $declNameDone (i32.eqz (call $isAlpha (i32.load8_u (local.get $q)))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $declName)))
        (if (i32.eq (local.get $q) (local.get $p)) (then (return (i32.const 0))))
        (local.set $q (call $findByte (local.get $q) (local.get $end) (i32.const ">")))
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (return (i32.add (local.get $q) (i32.const 1)))))
    (if (i32.eq (local.get $c) (i32.const "?"))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 2)))
        (loop $pi
          (local.set $p (call $findByte (local.get $p) (local.get $end) (i32.const "?")))
          (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
            (then (return (i32.const 0))))
          (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const ">"))
            (then (return (i32.add (local.get $p) (i32.const 2)))))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (br $pi))))
    (if (i32.eq (local.get $c) (i32.const "/"))
      (then (return (call $scanCloseTag (i32.add (local.get $p) (i32.const 2)) (local.get $end)))))
    (call $scanOpenTag (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
)
