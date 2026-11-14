(module
  (import "../embed.wat")
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./markdown.wat")
  (import "./org.wat")
  (import "./xml.wat")

  ;; Wikitext gets its own copy of the entity scan. With two callers
  ;; Binaryen stops inlining $xmlEntity into the XML lexer.
  (func-variant $wikiEntity $xmlEntity)

  ;; The `lang` attribute value [from, to) that the last $wikiAttrs saw.
  (global $wikiLangFrom (mut i32) (i32.const 0))
  (global $wikiLangTo (mut i32) (i32.const 0))

  ;; HTML attributes from $ptr up to `>`, `/>`, or $stop: names, `=`, and
  ;; quoted or bare values. Returns 1 after `>`, 2 after `/>`, 0 otherwise.
  (func $wikiAttrs (param $stop i32) (result i32)
    (local $c i32)
    (local $lhs i32)
    (local $q i32)
    (local $lang i32)
    (local $value i32)
    (global.set $wikiLangFrom (i32.const 0))
    (global.set $wikiLangTo (i32.const 0))
    (block $done
      (result i32)
      (loop $next
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (local.set $lhs (global.get $ptr))
        (br_if $done (i32.const 0) (i32.ge_u (local.get $lhs) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (br_if $done (i32.const 0) (i32.eq (local.get $c) (i32.const "<")))
        (local.set $q (i32.add (local.get $lhs) (i32.const 1)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ">"))
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.and
                (i32.lt_u (local.get $q) (local.get $stop))
                (i32.eq (i32.load8_u (local.get $q)) (i32.const ">")))))
          (then
            (global.set $ptr (i32.add (local.get $q) (i32.eq (local.get $c) (i32.const "/"))))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done (i32.add (i32.const 1) (i32.eq (local.get $c) (i32.const "/"))))))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (local.get $q))
            (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (local.get $q))
            (local.set $value (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $q (call $scanFindSpecial (local.get $q) (local.get $stop) (local.get $c) (i32.const 0) (i32.const 0)))
            (if (local.get $lang)
              (then
                (global.set $wikiLangFrom (i32.add (local.get $lhs) (i32.const 1)))
                (global.set $wikiLangTo (local.get $q))))
            (global.set $ptr
              (select (i32.add (local.get $q) (i32.const 1)) (local.get $stop) (i32.lt_u (local.get $q) (local.get $stop))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $value (i32.const 0))
            (local.set $lang (i32.const 0))
            (br $next)))
        (block $wordDone
          (loop $word
            (br_if $wordDone (i32.ge_u (local.get $q) (local.get $stop)))
            (local.set $c (i32.load8_u (local.get $q)))
            (br_if $wordDone (byteset.get "\09\0a\0b\0c\0d \22'/<=>" (local.get $c)))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $word)))
        (if (i32.and (local.get $value) (local.get $lang))
          (then
            (global.set $wikiLangFrom (local.get $lhs))
            (global.set $wikiLangTo (local.get $q))))
        (global.set $ptr (local.get $q))
        (call $emitTok
          (select (enum.get $Token.string) (enum.get $Token.attribute) (local.get $value))
          (local.get $lhs)
          (local.get $q))
        (local.set $lang
          (i32.and
            (i32.eqz (local.get $value))
            (i32.and
              (i32.eq (i32.sub (local.get $q) (local.get $lhs)) (i32.const 4))
              (call $orgIs (local.get $lhs) (i32.const 4) (i64.const "lang")))))
        (local.set $value (i32.const 0))
        (br $next))
      (unreachable)))

  ;; Length of the name of block tag $mode: 2 nowiki, 3 pre, 4
  ;; syntaxhighlight, 5 source.
  (func $wikiTagLength (param $mode i32) (result i32)
    (if (i32.eq (local.get $mode) (i32.const 3))
      (then (return (i32.const 3))))
    (select (i32.const 15) (i32.const 6) (i32.eq (local.get $mode) (i32.const 4))))

  ;; Whether the bytes at $p name block tag $mode, in any case.
  (func $wikiIsTag (param $p i32) (param $mode i32) (result i32)
    (if (i32.eq (local.get $mode) (i32.const 2))
      (then (return (call $orgIs (local.get $p) (i32.const 6) (i64.const "nowiki")))))
    (if (i32.eq (local.get $mode) (i32.const 3))
      (then (return (call $orgIs (local.get $p) (i32.const 3) (i64.const "pre")))))
    (if (i32.eq (local.get $mode) (i32.const 5))
      (then (return (call $orgIs (local.get $p) (i32.const 6) (i64.const "source")))))
    (i32.and
      (call $orgIs (local.get $p) (i32.const 8) (i64.const "syntaxhi"))
      (call $orgIs (i32.add (local.get $p) (i32.const 8)) (i32.const 7) (i64.const "ghlight"))))

  ;; The end tag of block $mode at $p, such as `</pre >`: the position after
  ;; its `>`, or 0.
  (func $wikiCloseTag (param $p i32) (param $mode i32) (result i32)
    (local $q i32)
    (local.set $q (i32.add (i32.add (local.get $p) (i32.const 2)) (call $wikiTagLength (local.get $mode))))
    (if
      (i32.or
        (i32.ge_u (local.get $q) (global.get $end))
        (i32.ne (i32.load16_u (local.get $p)) (i32.const "</")))
      (then (return (i32.const 0))))
    (if (i32.eqz (call $wikiIsTag (i32.add (local.get $p) (i32.const 2)) (local.get $mode)))
      (then (return (i32.const 0))))
    (local.set $q (call $lexSkipSpaceAt (local.get $q)))
    (select
      (i32.add (local.get $q) (i32.const 1))
      (i32.const 0)
      (i32.eq (call $templateByte (local.get $q)) (i32.const ">"))))

  ;; Emit the end tag [$p, $q) that $wikiCloseTag found.
  (func $wikiEmitCloseTag (param $p i32) (param $q i32) (param $mode i32)
    (local $name i32)
    (local.set $name (i32.add (i32.add (local.get $p) (i32.const 2)) (call $wikiTagLength (local.get $mode))))
    (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $p) (i32.add (local.get $p) (i32.const 2)))
    (call $emitTok (enum.get $Token.tag) (i32.add (local.get $p) (i32.const 2)) (local.get $name))
    (call $emitGap (local.get $name) (i32.sub (local.get $q) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.bracket.html) (i32.sub (local.get $q) (i32.const 1)) (local.get $q))
    (global.set $ptr (local.get $q)))

  ;; MediaWiki markup. $block: an open block. Bits 0-3: 1 an HTML comment,
  ;; else the tag that closes it (see $wikiTagLength). Bits 8-15: the
  ;; language of a source block, highlighted by $markdownCodeRange. Bit 16:
  ;; its lexer already ran in an earlier chunk. Bits 24-31: the stream region
  ;; the body left open while region 93 marks our open body for
  ;; $streamResumeLang. $tpl: open templates and parameters; bits 0-4 the
  ;; depth, and bit 4 + depth set when the innermost is a `{{{parameter}}}`.
  ;; Bold, italic, links, headings ($head: where the closing `=` start), and
  ;; table cells end with their line.
  (func $hlWikitext
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $lineEnd i32)
    (local $stop i32)
    (local $block i32)
    (local $tpl i32)
    (local $bold i32)
    (local $italic i32)
    (local $link i32)
    (local $head i32)
    (local $cell i32)
    (local $lineStart i32)
    (local $noBr i32)
    (call $lexEmitLeadingContinuation)
    (if (i32.eq (global.get $streamRegionKind) (i32.const 93))
      (then (global.set $streamRegionKind (i32.shr_u (local.get $block) (i32.const 24)))))
    (local.set $lineStart (i32.const 1))
    (local.set $bold (i32.const 0))
    (local.set $italic (i32.const 0))
    (local.set $link (i32.const 0))
    (local.set $head (i32.const 0))
    (local.set $cell (i32.const 0))
    (local.set $noBr (i32.const 0))
    (local.set $lineEnd (call $lexFindEither (global.get $ptr) (i32.const 10) (i32.const 13)))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (if (local.get $block)
          (then
            (local.set $c (i32.and (local.get $block) (i32.const 15)))
            (local.set $q (i32.and (i32.shr_u (local.get $block) (i32.const 8)) (i32.const 255)))
            (local.set $lineStart (i32.const 0))
            (if (local.get $q)
              (then
                (local.set $p (local.get $lhs))
                (block $found
                  (loop $find
                    (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
                    (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
                    (br_if $found (call $wikiCloseTag (local.get $p) (local.get $c)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $find)))
                (call $markdownCodeRange
                  (local.get $q)
                  (local.get $lhs)
                  (local.get $p)
                  (i32.and (i32.shr_u (local.get $block) (i32.const 16)) (i32.const 1)))
                (if (i32.ge_u (local.get $p) (global.get $end))
                  (then
                    (local.set $block
                      (i32.or (local.get $block) (i32.shl (global.get $markdownBodyRan) (i32.const 16))))
                    (if (i32.and (global.get $streaming) (i32.eq (global.get $end) (global.get $eof)))
                      (then
                        (local.set $block
                          (i32.or
                            (i32.and (local.get $block) (i32.const 0xffffff))
                            (i32.shl (global.get $streamRegionKind) (i32.const 24))))
                        (global.set $streamRegionKind (i32.const 93))))
                    (br $next)))
                (if (global.get $streaming)
                  (then (call $markdownClearEmbeddedStream)))
                ;; a body that crossed a line break ends the line's markup, as
                ;; it does when each line is a chunk
                (if (i32.lt_u (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13)) (local.get $p))
                  (then
                    (local.set $bold (i32.const 0))
                    (local.set $italic (i32.const 0))
                    (local.set $link (i32.const 0))
                    (local.set $head (i32.const 0))
                    (local.set $cell (i32.const 0))))
                (local.set $lineEnd (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))
                (call $wikiEmitCloseTag (local.get $p) (call $wikiCloseTag (local.get $p) (local.get $c)) (local.get $c))
                (local.set $block (i32.const 0))
                (br $next)))
            ;; comments and literal bodies, one line at a time
            (if (i32.lt_u (local.get $lhs) (local.get $lineEnd))
              (then
                (local.set $p (local.get $lhs))
                (local.set $q (i32.const 0))
                (block $found
                  (loop $find
                    (local.set $p
                      (call $scanFindSpecial
                        (local.get $p)
                        (local.get $lineEnd)
                        (select (i32.const ">") (i32.const "<") (i32.eq (local.get $c) (i32.const 1)))
                        (i32.const 0)
                        (i32.const 0)))
                    (br_if $found (i32.ge_u (local.get $p) (local.get $lineEnd)))
                    (if (i32.eq (local.get $c) (i32.const 1))
                      (then
                        (if
                          (i32.and
                            (i32.ge_u (local.get $p) (i32.add (local.get $lhs) (i32.const 2)))
                            (i32.eq (i32.load16_u (i32.sub (local.get $p) (i32.const 2))) (i32.const "--")))
                          (then
                            (local.set $p (i32.add (local.get $p) (i32.const 1)))
                            (local.set $q (local.get $p))
                            (br $found))))
                      (else
                        (local.set $q (call $wikiCloseTag (local.get $p) (local.get $c)))
                        (br_if $found (local.get $q))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $find)))
                (if (i32.gt_u (local.get $p) (local.get $lineEnd))
                  (then (local.set $p (local.get $lineEnd))))
                (call $emitTok
                  (select (enum.get $Token.comment) (enum.get $Token.text.literal) (i32.eq (local.get $c) (i32.const 1)))
                  (local.get $lhs)
                  (local.get $p))
                (global.set $ptr (local.get $p))
                (if (local.get $q)
                  (then
                    (if (i32.ne (local.get $c) (i32.const 1))
                      (then (call $wikiEmitCloseTag (local.get $p) (local.get $q) (local.get $c))))
                    (local.set $block (i32.const 0))))
                (br $next)))))
        ;; a line break ends the line's markup
        (if (i32.ge_u (local.get $lhs) (local.get $lineEnd))
          (then
            (global.set $ptr (call $markdownAfterLine (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $lineEnd (call $lexFindEither (global.get $ptr) (i32.const 10) (i32.const 13)))
            (local.set $lineStart (i32.const 1))
            (local.set $bold (i32.const 0))
            (local.set $italic (i32.const 0))
            (local.set $link (i32.const 0))
            (local.set $head (i32.const 0))
            (local.set $cell (i32.const 0))
            (br $next)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (local.get $lineStart)
          (then
            (local.set $lineStart (i32.const 0))
            (local.set $q (call $rstTrimEnd (local.get $lhs) (local.get $lineEnd)))
            ;; `== Heading ==`
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                (local.set $p (local.get $lhs))
                (block $openDone
                  (loop $open
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $openDone (i32.ge_u (local.get $p) (local.get $q)))
                    (br_if $open (i32.eq (i32.load8_u (local.get $p)) (i32.const "=")))))
                (local.set $stop (local.get $q))
                (block $closeDone
                  (loop $close
                    (br_if $closeDone (i32.le_u (local.get $stop) (local.get $p)))
                    (br_if $closeDone (i32.ne (i32.load8_u (i32.sub (local.get $stop) (i32.const 1))) (i32.const "=")))
                    (local.set $stop (i32.sub (local.get $stop) (i32.const 1)))
                    (br $close)))
                (if (i32.and (i32.lt_u (local.get $stop) (local.get $q)) (i32.gt_u (local.get $stop) (local.get $p)))
                  (then
                    (global.set $ptr (local.get $p))
                    (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (local.get $p))
                    (local.set $head (local.get $stop))
                    (br $next)))))
            ;; `#REDIRECT [[Target]]`
            (if
              (i32.and
                (i32.le_u (i32.add (local.get $lhs) (i32.const 9)) (local.get $lineEnd))
                (i32.and
                  (call $orgIs (local.get $lhs) (i32.const 8) (i64.const "#redirec"))
                  (i32.eq (i32.or (i32.load8_u offset=8 (local.get $lhs)) (i32.const 32)) (i32.const "t"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 9)))
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (br $next)))
            ;; list markers `*`, `#`, `:`, `;`
            (if (byteset.get "#*:;" (local.get $c))
              (then
                (local.set $p (local.get $lhs))
                (block $markDone
                  (loop $mark
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $markDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                    (local.set $c (i32.load8_u (local.get $p)))
                    (br_if $mark (byteset.get "#*:;" (local.get $c)))))
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.punctuation.list_marker) (local.get $lhs) (local.get $p))
                (br $next)))
            ;; `----`
            (if
              (i32.and
                (i32.le_u (i32.add (local.get $lhs) (i32.const 4)) (local.get $lineEnd))
                (i32.eq (i32.load (local.get $lhs)) (i32.const "----")))
              (then
                (local.set $p (local.get $lhs))
                (block $dashDone
                  (loop $dash
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $dashDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                    (br_if $dash (i32.eq (i32.load8_u (local.get $p)) (i32.const "-")))))
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (local.get $p))
                (br $next)))
            ;; tables: `{|`, `|+`, `|-`, `|}`, `|` and `!` cells; inside a
            ;; template a leading `|` separates its arguments
            (if
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const "|")))
                (i32.and
                  (i32.eqz (i32.and (local.get $tpl) (i32.const 31)))
                  (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "!")))))
              (then
                (local.set $q
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "{"))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const "|"))
                      (i32.or
                        (i32.or (i32.eq (local.get $c2) (i32.const "+")) (i32.eq (local.get $c2) (i32.const "-")))
                        (i32.eq (local.get $c2) (i32.const "}"))))))
                (local.set $p (i32.add (i32.add (local.get $lhs) (i32.const 1)) (local.get $q)))
                (if (i32.and (local.get $q) (i32.eq (local.get $c2) (i32.const "-")))
                  (then
                    (block $rowDone
                      (loop $row
                        (br_if $rowDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
                        (br_if $rowDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "-")))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (br $row)))))
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (local.get $p))
                (if
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "{"))
                    (i32.and (local.get $q) (i32.eq (local.get $c2) (i32.const "-"))))
                  (then
                    (drop (call $wikiAttrs (local.get $lineEnd)))
                    (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $lineEnd))
                    (global.set $ptr (local.get $lineEnd))
                    (br $next)))
                (if (i32.eqz (local.get $q))
                  (then (local.set $cell (local.get $c))))
                (br $next)))))
        (local.set $stop (select (local.get $head) (local.get $lineEnd) (local.get $head)))
        ;; the closing `=` of a heading
        (if (i32.and (i32.ne (local.get $head) (i32.const 0)) (i32.ge_u (local.get $lhs) (local.get $head)))
          (then
            (local.set $p (call $rstTrimEnd (local.get $lhs) (local.get $lineEnd)))
            (global.set $ptr (local.get $lineEnd))
            (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (local.get $p))
            (call $emitGap (local.get $p) (local.get $lineEnd))
            (br $next)))
        (block $plainByte
          ;; `''italic''`, `'''bold'''`, `'''''both'''''`
          (if (i32.eq (local.get $c) (i32.const "'"))
            (then
              (br_if $plainByte (i32.ne (local.get $c2) (i32.const "'")))
              (local.set $p (local.get $lhs))
              (block $runDone
                (loop $run
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br_if $runDone (i32.ge_u (local.get $p) (local.get $stop)))
                  (br_if $run (i32.eq (i32.load8_u (local.get $p)) (i32.const "'")))))
              (local.set $q (i32.sub (local.get $p) (local.get $lhs)))
              ;; a run of 4 is an apostrophe and bold; past 5, the extra are text
              (if (i32.eq (local.get $q) (i32.const 4))
                (then (local.set $q (i32.const 3))))
              (if (i32.gt_u (local.get $q) (i32.const 5))
                (then (local.set $q (i32.const 5))))
              (call $emitTok
                (select
                  (enum.get $Token.emphasis.strong)
                  (select (enum.get $Token.emphasis) (enum.get $Token.none) (local.get $italic))
                  (local.get $bold))
                (local.get $lhs)
                (i32.sub (local.get $p) (local.get $q)))
              (global.set $ptr (local.get $p))
              (call $emitTok (enum.get $Token.punctuation.markup) (i32.sub (local.get $p) (local.get $q)) (local.get $p))
              (if (i32.ne (local.get $q) (i32.const 2))
                (then (local.set $bold (i32.eqz (local.get $bold)))))
              (if (i32.ne (local.get $q) (i32.const 3))
                (then (local.set $italic (i32.eqz (local.get $italic)))))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "["))
            (then
              ;; `[[Page|text]]`: the text after `|` is link text until `]]`
              (if (i32.eq (local.get $c2) (i32.const "["))
                (then
                  (local.set $p (i32.add (local.get $lhs) (i32.const 2)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (local.get $p))
                  (local.set $q (local.get $p))
                  (block $targetDone
                    (loop $target
                      (br_if $targetDone (i32.ge_u (local.get $q) (local.get $stop)))
                      (local.set $c (i32.load8_u (local.get $q)))
                      (br_if $targetDone (byteset.get "\n\r<[]{|}" (local.get $c)))
                      (local.set $q (i32.add (local.get $q) (i32.const 1)))
                      (br $target)))
                  (global.set $ptr (local.get $q))
                  (call $emitTok (enum.get $Token.link_uri) (local.get $p) (local.get $q))
                  (local.set $link (i32.add (local.get $link) (i32.const 1)))
                  (br $next)))
              ;; `[https://example.org text]` and `[mailto:a@b.org text]`; $noBr is
              ;; the $stop of a range with no `]` after an earlier `[`
              (br_if $plainByte (i32.eq (local.get $noBr) (local.get $stop)))
              (local.set $q
                (call $scanFindSpecial (i32.add (local.get $lhs) (i32.const 1)) (local.get $stop) (i32.const "]") (i32.const 0) (i32.const 0)))
              (if (i32.ge_u (local.get $q) (local.get $stop))
                (then
                  (local.set $noBr (local.get $stop))
                  (br $plainByte)))
              (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
              (block $schemeDone
                (loop $scheme
                  (br_if $schemeDone (i32.ge_u (local.get $p) (local.get $q)))
                  (br_if $schemeDone
                    (i32.gt_u (i32.sub (i32.or (i32.load8_u (local.get $p)) (i32.const 32)) (i32.const "a")) (i32.const 25)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $scheme)))
              (br_if $plainByte
                (i32.eqz
                  (i32.or
                    (i32.and
                      (i32.gt_u (local.get $p) (i32.add (local.get $lhs) (i32.const 1)))
                      (i32.eq (call $templateByte (local.get $p)) (i32.const ":")))
                    (i32.and
                      (i32.eq (local.get $p) (i32.add (local.get $lhs) (i32.const 1)))
                      (i32.eq (i32.load16_u (local.get $p)) (i32.const "//"))))))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (i32.add (local.get $lhs) (i32.const 1)))
              (local.set $p
                (call $scanFindSpecial (i32.add (local.get $lhs) (i32.const 1)) (local.get $q) (i32.const 32) (i32.const 0) (i32.const 0)))
              (call $emitTok (enum.get $Token.link_uri) (i32.add (local.get $lhs) (i32.const 1)) (local.get $p))
              (global.set $ptr (call $lexSkipSpaceAt (local.get $p)))
              (call $emitGap (local.get $p) (global.get $ptr))
              (call $emitTok (enum.get $Token.link_text) (global.get $ptr) (local.get $q))
              (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $q) (global.get $ptr))
              (br $next)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "]")) (i32.ne (local.get $link) (i32.const 0)))
            (then
              (br_if $plainByte (i32.ne (local.get $c2) (i32.const "]")))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
              (local.set $link (i32.sub (local.get $link) (i32.const 1)))
              (br $next)))
          ;; `{{template|...}}`, `{{#if:...}}`, `{{PAGENAME}}`, `{{{param|default}}}`
          (if (i32.eq (local.get $c) (i32.const "{"))
            (then
              (br_if $plainByte (i32.ne (local.get $c2) (i32.const "{")))
              (local.set $c2
                (i32.and
                  (i32.le_u (i32.add (local.get $lhs) (i32.const 3)) (local.get $stop))
                  (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const "{"))))
              (local.set $p (i32.add (i32.add (local.get $lhs) (i32.const 2)) (local.get $c2)))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (local.get $p))
              (local.set $c (i32.and (local.get $tpl) (i32.const 31)))
              (if (i32.lt_u (local.get $c) (i32.const 26))
                (then
                  (local.set $tpl
                    (i32.or
                      (i32.add (local.get $tpl) (i32.const 1))
                      (i32.shl (local.get $c2) (i32.add (local.get $c) (i32.const 5)))))))
              (global.set $ptr (call $lexSkipSpaceAt (local.get $p)))
              (call $emitGap (local.get $p) (global.get $ptr))
              (local.set $p (global.get $ptr))
              (local.set $q (local.get $p))
              (block $nameDone
                (loop $name
                  (br_if $nameDone (i32.ge_u (local.get $q) (local.get $stop)))
                  (local.set $c (i32.load8_u (local.get $q)))
                  (br_if $nameDone (byteset.get "\n\r<[]{|}" (local.get $c)))
                  (br_if $nameDone (i32.eq (local.get $c) (i32.const ":")))
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br $name)))
              (local.set $q (call $rstTrimEnd (local.get $p) (local.get $q)))
              (global.set $ptr (local.get $q))
              (local.set $c (call $templateByte (local.get $q)))
              (call $emitTok
                (if (result i32) (local.get $c2)
                  (then (enum.get $Token.variable.parameter))
                  (else
                    (select
                      (enum.get $Token.keyword.control)
                      (select
                        (enum.get $Token.constant.builtin)
                        (enum.get $Token.function)
                        (i32.or
                          (i32.eq (local.get $c) (i32.const ":"))
                          (call $lexIsConstCase (local.get $p) (local.get $q))))
                      (i32.eq (call $templateByte (local.get $p)) (i32.const "#")))))
                (local.get $p)
                (local.get $q))
              (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.lt_u (local.get $q) (local.get $stop)))
                (then
                  (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $q) (global.get $ptr))))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "}"))
            (then
              (br_if $plainByte
                (i32.or
                  (i32.ne (local.get $c2) (i32.const "}"))
                  (i32.eqz (i32.and (local.get $tpl) (i32.const 31)))))
              ;; `}}}` closes a parameter, `}}` a template
              (local.set $c (i32.and (local.get $tpl) (i32.const 31)))
              (local.set $q
                (i32.and
                  (i32.shr_u (local.get $tpl) (i32.add (local.get $c) (i32.const 4)))
                  (i32.and
                    (i32.lt_u (i32.add (local.get $lhs) (i32.const 2)) (local.get $stop))
                    (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const "}")))))
              (global.set $ptr (i32.add (i32.add (local.get $lhs) (i32.const 2)) (local.get $q)))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
              (local.set $tpl
                (i32.sub
                  (i32.and
                    (local.get $tpl)
                    (i32.xor (i32.const -1) (i32.shl (i32.const 1) (i32.add (local.get $c) (i32.const 4)))))
                  (i32.const 1)))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "|"))
            (then
              (if (i32.or (local.get $link) (i32.and (local.get $tpl) (i32.const 31)))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                  (br_if $next (local.get $link))
                  ;; `| key = value`
                  (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                  (local.set $q (local.get $p))
                  (block $keyDone
                    (loop $key
                      (br_if $keyDone (i32.ge_u (local.get $q) (local.get $stop)))
                      (local.set $c (i32.load8_u (local.get $q)))
                      (br_if $keyDone (byteset.get "\n\r<[]{|}" (local.get $c)))
                      (br_if $keyDone (i32.eq (local.get $c) (i32.const "=")))
                      (local.set $q (i32.add (local.get $q) (i32.const 1)))
                      (br $key)))
                  (if
                    (i32.and
                      (i32.lt_u (local.get $q) (local.get $stop))
                      (i32.eq (i32.load8_u (local.get $q)) (i32.const "=")))
                    (then
                      (call $emitGap (global.get $ptr) (local.get $p))
                      (local.set $c (call $rstTrimEnd (local.get $p) (local.get $q)))
                      (call $emitTok (enum.get $Token.property) (local.get $p) (local.get $c))
                      (call $emitGap (local.get $c) (local.get $q))
                      (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                      (call $emitTok (enum.get $Token.operator) (local.get $q) (global.get $ptr))))
                  (br $next)))
              (br_if $plainByte (i32.eqz (local.get $cell)))
              (global.set $ptr (i32.add (local.get $lhs) (i32.add (i32.const 1) (i32.eq (local.get $c2) (i32.const "|")))))
              (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "!"))
            (then
              (br_if $plainByte
                (i32.or (i32.ne (local.get $cell) (i32.const "!")) (i32.ne (local.get $c2) (i32.const "!"))))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "<"))
            (then
              ;; `<!-- comment -->`: the block scan continues the comment
              (if
                (i32.and
                  (i32.le_u (i32.add (local.get $lhs) (i32.const 4)) (local.get $lineEnd))
                  (i32.eq (i32.load (local.get $lhs)) (i32.const "<!--")))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 4)))
                  (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                  (local.set $block (i32.const 1))
                  (br $next)))
              (local.set $p (i32.add (i32.add (local.get $lhs) (i32.const 1)) (i32.eq (local.get $c2) (i32.const "/"))))
              (local.set $q (local.get $p))
              (block $tagDone
                (loop $tag
                  (br_if $tagDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                  (br_if $tagDone (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $q)))))
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br $tag)))
              (br_if $plainByte
                (i32.or
                  (i32.eq (local.get $q) (local.get $p))
                  (i32.eqz (call $lexIsIdentStart (i32.load8_u (local.get $p))))))
              (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (local.get $p))
              (call $emitTok (enum.get $Token.tag) (local.get $p) (local.get $q))
              (global.set $ptr (local.get $q))
              ;; the block tag this start tag opens: 2-5, or 6 for none
              (local.set $c (i32.const 2))
              (block $kindDone
                (loop $kind
                  (br_if $kindDone (i32.gt_u (local.get $c) (i32.const 5)))
                  (br_if $kindDone
                    (i32.and
                      (i32.eq (i32.sub (local.get $q) (local.get $p)) (call $wikiTagLength (local.get $c)))
                      (call $wikiIsTag (local.get $p) (local.get $c))))
                  (local.set $c (i32.add (local.get $c) (i32.const 1)))
                  (br $kind)))
              (if
                (i32.or
                  (i32.ne (call $wikiAttrs (local.get $lineEnd)) (i32.const 1))
                  (i32.eq (local.get $c2) (i32.const "/")))
                (then (local.set $c (i32.const 6))))
              (if (i32.le_u (local.get $c) (i32.const 5))
                (then
                  (local.set $block (local.get $c))
                  (if (i32.ge_u (local.get $c) (i32.const 4))
                    (then
                      (local.set $c (call $orgLanguageByName (global.get $wikiLangFrom) (global.get $wikiLangTo)))
                      ;; a Wikitext body would reuse our checkpoint window
                      (if (i32.ne (local.get $c) (enum.get $Language.wikitext))
                        (then
                          (local.set $block (i32.or (local.get $block) (i32.shl (local.get $c) (i32.const 8))))))))))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "&"))
            (then
              (global.set $ptr (local.get $lhs))
              (br_if $next (call $wikiEntity))
              (br $plainByte)))
          ;; `__TOC__`
          (if (i32.and (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c2) (i32.const "_")))
            (then
              (local.set $p (i32.add (local.get $lhs) (i32.const 2)))
              (block $wordDone
                (loop $word
                  (br_if $wordDone (i32.ge_u (local.get $p) (local.get $stop)))
                  (br_if $wordDone (i32.gt_u (i32.sub (i32.load8_u (local.get $p)) (i32.const "A")) (i32.const 25)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $word)))
              (br_if $plainByte
                (i32.or
                  (i32.eq (local.get $p) (i32.add (local.get $lhs) (i32.const 2)))
                  (i32.or
                    (i32.gt_u (i32.add (local.get $p) (i32.const 2)) (local.get $stop))
                    (i32.ne (i32.load16_u (local.get $p)) (i32.const "__")))))
              (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
              (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
              (br $next)))
          ;; signatures `~~~`, `~~~~`, `~~~~~`
          (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c2) (i32.const "~")))
            (then
              (local.set $p (local.get $lhs))
              (block $tildeDone
                (loop $tilde
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br_if $tildeDone (i32.ge_u (local.get $p) (local.get $stop)))
                  (br_if $tilde (i32.eq (i32.load8_u (local.get $p)) (i32.const "~")))))
              (br_if $plainByte (i32.lt_u (i32.sub (local.get $p) (local.get $lhs)) (i32.const 3)))
              (global.set $ptr (local.get $p))
              (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (local.get $p))
              (br $next)))
          ;; plain text, and bare URLs: letters, `://`, then up to a blank or
          ;; a bracket
          (local.set $p (local.get $lhs))
          (block $plainDone
            (loop $plain
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br_if $plainDone (i32.ge_u (local.get $p) (local.get $stop)))
              (local.set $c (i32.load8_u (local.get $p)))
              (br_if $plain (i32.eqz (byteset.get "!&':<[]_{|}~" (local.get $c))))
              (br_if $plainDone (i32.ne (local.get $c) (i32.const ":")))
              (br_if $plain
                (i32.or
                  (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (local.get $stop))
                  (i32.ne (i32.load16_u offset=1 (local.get $p)) (i32.const "//"))))
              (local.set $q (local.get $p))
              (block $schemeDone
                (loop $scheme
                  (br_if $schemeDone (i32.le_u (local.get $q) (local.get $lhs)))
                  (br_if $schemeDone
                    (i32.gt_u
                      (i32.sub (i32.or (i32.load8_u (i32.sub (local.get $q) (i32.const 1))) (i32.const 32)) (i32.const "a"))
                      (i32.const 25)))
                  (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                  (br $scheme)))
              (br_if $plain (i32.eq (local.get $q) (local.get $p)))
              (global.set $ptr (local.get $q))
              (call $emitTok
                (select
                  (enum.get $Token.emphasis.strong)
                  (select
                    (enum.get $Token.emphasis)
                    (select
                      (enum.get $Token.link_text)
                      (select (enum.get $Token.title) (enum.get $Token.none) (local.get $head))
                      (local.get $link))
                    (local.get $italic))
                  (local.get $bold))
                (local.get $lhs)
                (local.get $q))
              (block $urlDone
                (loop $url
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br_if $urlDone (i32.ge_u (local.get $p) (local.get $stop)))
                  (local.set $c (i32.load8_u (local.get $p)))
                  (br_if $urlDone (byteset.get "\09\0a\0b\0c\0d \22<[]{|}" (local.get $c)))
                  (br $url)))
              ;; trailing punctuation ends the sentence, not the URL
              (block $trimDone
                (loop $trim
                  (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
                  (br_if $trimDone (i32.eqz (byteset.get ",.:;" (local.get $c))))
                  (local.set $p (i32.sub (local.get $p) (i32.const 1)))
                  (br $trim)))
              (global.set $ptr (local.get $p))
              (call $emitTok (enum.get $Token.link_uri) (local.get $q) (local.get $p))
              (br $next)))
          (global.set $ptr (local.get $p)))
        ;; plain text up to $ptr, or the single byte at $lhs
        (if (i32.le_u (global.get $ptr) (local.get $lhs))
          (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
        (call $emitTok
          (select
            (enum.get $Token.emphasis.strong)
            (select
              (enum.get $Token.emphasis)
              (select
                (enum.get $Token.link_text)
                (select (enum.get $Token.title) (enum.get $Token.none) (local.get $head))
                (local.get $link))
              (local.get $italic))
            (local.get $bold))
          (local.get $lhs)
          (global.get $ptr))
        (br $next))))
)
