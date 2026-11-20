(module
  (import "../embed.wat")
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./markdown.wat")
  (import "./rst.wat")

  ;; Org and Wikitext get their own copy of the language lookup. With
  ;; more callers Binaryen stops inlining it into the Markdown lexer.
  (func-variant $orgLanguageByName $embedLanguageByName)

  ;; Bit (marker & 31) is set for each emphasis marker with no closer later
  ;; on the current line, so a line of unpaired markers stays linear. Bits
  ;; 0-5 do the same for `]]`, `\)`, `\]`, `}}`, `]`, and `>`. Reset at each
  ;; line start.
  (global $orgNoClose (mut i32) (i32.const 0))
  ;; a `}}` not followed by `}` before the stop: every `{{{` that finds it first fails
  (global $orgMacroFail (mut i32) (i32.const 0))

  ;; Whether the $n (1..8) bytes at $p equal $w after `| 0x20` on each byte:
  ;; ASCII letters compare without case, and `_` reads as `\7f`.
  (func $orgIs (param $p i32) (param $n i32) (param $w i64) (result i32)
    (i64.eq
      (i64.and
        (i64.or (i64.load (local.get $p)) (i64.const 0x2020202020202020))
        (i64.shr_u
          (i64.const -1)
          (i64.extend_i32_u (i32.shl (i32.sub (i32.const 8) (local.get $n)) (i32.const 3)))))
      (local.get $w)))

  ;; End of the name at $p: identifier bytes and `-`, bounded by $stop.
  (func $orgNameEnd (param $p i32) (param $stop i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done
          (i32.eqz (i32.or (call $lexIsIdentContinue (local.get $c)) (i32.eq (local.get $c) (i32.const "-")))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; First pair of bytes $w (source order) in [$p,$stop), or $stop.
  (func $orgFind2 (param $p i32) (param $stop i32) (param $w i32) (result i32)
    (block $done
      (loop $l
        (local.set $p
          (call $scanFindSpecial (local.get $p) (local.get $stop) (i32.and (local.get $w) (i32.const 255)) (i32.const 0) (i32.const 0)))
        (br_if $done (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $stop)))
        (br_if $done (i32.eq (i32.load16_u (local.get $p)) (local.get $w)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (select (local.get $p) (local.get $stop) (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $stop))))

  ;; The block name [$p,$q): 1 src, 2 example, 3 export, 4 comment, 0 another.
  (func $orgBlockName (param $p i32) (param $q i32) (result i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $q) (local.get $p)))
    (if (i32.eq (local.get $n) (i32.const 3))
      (then (return (call $orgIs (local.get $p) (i32.const 3) (i64.const "src")))))
    (if (i32.eq (local.get $n) (i32.const 6))
      (then (return (i32.mul (call $orgIs (local.get $p) (i32.const 6) (i64.const "export")) (i32.const 3)))))
    (if (i32.eq (local.get $n) (i32.const 7))
      (then
        (if (call $orgIs (local.get $p) (i32.const 7) (i64.const "example"))
          (then (return (i32.const 2))))
        (return (i32.shl (call $orgIs (local.get $p) (i32.const 7) (i64.const "comment")) (i32.const 2)))))
    (i32.const 0))

  ;; Whether the line at $p is `#+end_` and block name $code, in any case.
  (func $orgIsEnd (param $p i32) (param $code i32) (result i32)
    (local $stop i32)
    (local.set $stop (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 6)) (local.get $stop))
      (then (return (i32.const 0))))
    (i32.and
      (call $orgIs (local.get $p) (i32.const 6) (i64.const "#+end\7f"))
      (i32.eq
        (call $orgBlockName
          (i32.add (local.get $p) (i32.const 6))
          (call $orgNameEnd (i32.add (local.get $p) (i32.const 6)) (local.get $stop)))
        (local.get $code))))

  ;; End of `SCHEDULED:`, `DEADLINE:`, or `CLOSED:` at $p, before $stop, or 0.
  (func $orgPlanning (param $p i32) (param $stop i32) (result i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $stop) (local.get $p)))
    (if
      (i32.and
        (i32.ge_s (local.get $n) (i32.const 10))
        (i32.and
          (i64.eq (i64.load (local.get $p)) (i64.const "SCHEDULE"))
          (i32.eq (i32.load16_u offset=8 (local.get $p)) (i32.const "D:"))))
      (then (return (i32.add (local.get $p) (i32.const 10)))))
    (if
      (i32.and
        (i32.ge_s (local.get $n) (i32.const 9))
        (i32.and
          (i64.eq (i64.load (local.get $p)) (i64.const "DEADLINE"))
          (i32.eq (i32.load8_u offset=8 (local.get $p)) (i32.const ":"))))
      (then (return (i32.add (local.get $p) (i32.const 9)))))
    (if
      (i32.and
        (i32.ge_s (local.get $n) (i32.const 7))
        (i64.eq (i64.and (i64.load (local.get $p)) (i64.const 0xffffffffffffff)) (i64.const "CLOSED:")))
      (then (return (i32.add (local.get $p) (i32.const 7)))))
    (i32.const 0))

  ;; Whether [$p,$q) is a TODO keyword of a headline.
  (func $orgIsTodo (param $p i32) (param $q i32) (result i32)
    (local $n i32)
    (local $w i32)
    (local.set $n (i32.sub (local.get $q) (local.get $p)))
    (local.set $w (i32.load (local.get $p)))
    (if (i32.eq (local.get $n) (i32.const 4))
      (then
        (return
          (i32.or
            (i32.or
              (i32.eq (local.get $w) (i32.const "TODO"))
              (i32.eq (local.get $w) (i32.const "DONE")))
            (i32.or
              (i32.or (i32.eq (local.get $w) (i32.const "NEXT")) (i32.eq (local.get $w) (i32.const "WAIT")))
              (i32.eq (local.get $w) (i32.const "HOLD")))))))
    (if (i32.eq (local.get $n) (i32.const 7))
      (then
        (return
          (i64.eq
            (i64.and (i64.load (local.get $p)) (i64.const 0xffffffffffffff))
            (i64.const "WAITING")))))
    (i32.and
      (i32.or (i32.eq (local.get $n) (i32.const 8)) (i32.eq (local.get $n) (i32.const 9)))
      (i64.eq (i64.load (local.get $p)) (i64.const "CANCELLE"))))

  ;; A timestamp `<2024-01-31 Wed 10:00>` or `[2024-01-31]` at $p: its end
  ;; after the closing bracket, or 0.
  (func $orgTimestamp (param $p i32) (param $stop i32) (result i32)
    (local $q i32)
    (local $bit i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 7)) (local.get $stop))
      (then (return (i32.const 0))))
    (if
      (i32.or
        (i32.ne (i32.load8_u offset=5 (local.get $p)) (i32.const "-"))
        (i32.eqz
          (i32.and
            (i32.and (call $lexIsDigit (i32.load8_u offset=1 (local.get $p))) (call $lexIsDigit (i32.load8_u offset=2 (local.get $p))))
            (i32.and (call $lexIsDigit (i32.load8_u offset=3 (local.get $p))) (call $lexIsDigit (i32.load8_u offset=4 (local.get $p)))))))
      (then (return (i32.const 0))))
    (local.set $bit (select (i32.const 16) (i32.const 32) (i32.eq (i32.load8_u (local.get $p)) (i32.const "["))))
    (if (i32.and (global.get $orgNoClose) (local.get $bit))
      (then (return (i32.const 0))))
    (local.set $q
      (call $scanFindSpecial
        (local.get $p)
        (local.get $stop)
        (i32.add (i32.load8_u (local.get $p)) (i32.const 2))
        (i32.const 0)
        (i32.const 0)))
    (if (i32.ge_u (local.get $q) (local.get $stop))
      (then
        (global.set $orgNoClose (i32.or (global.get $orgNoClose) (local.get $bit)))
        (return (i32.const 0))))
    (i32.add (local.get $q) (i32.const 1)))

  ;; Inline markup from $ptr to $stop: emphasis, links, footnotes,
  ;; timestamps, LaTeX, entities, and macros. Other text gets $base. In a
  ;; table row ($table), `|` separates cells.
  (func $orgInline (param $stop i32) (param $base i32) (param $table i32)
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $bit i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $stop)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eqz (byteset.get "$*+/<=[\5c_{|~" (local.get $c)))
          (then
            (local.set $p (local.get $lhs))
            (block $plainDone
              (loop $plain
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $plainDone (i32.ge_u (local.get $p) (local.get $stop)))
                (local.set $c (i32.load8_u (local.get $p)))
                (br_if $plain (i32.eqz (byteset.get "$*+/<=[\5c_{|~" (local.get $c))))))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "/"))
                (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $stop))
                  (i32.eq (i32.and (i32.load (i32.sub (local.get $p) (i32.const 1))) (i32.const 0xffffff)) (i32.const "://"))))
              (then
                (local.set $q (call $rstWordStart (local.get $lhs) (i32.sub (local.get $p) (i32.const 1))))
                (if (i32.lt_u (local.get $q) (i32.sub (local.get $p) (i32.const 1)))
                  (then
                    (call $emitTok (local.get $base) (local.get $lhs) (local.get $q))
                    (global.set $ptr (call $scanFindSpecial (local.get $p) (local.get $stop) (i32.const 32) (i32.const 0) (i32.const 0)))
                    (call $emitTok (enum.get $Token.link_uri) (local.get $q) (global.get $ptr))
                    (br $next)))))
            (global.set $ptr (local.get $p))
            (call $emitTok (local.get $base) (local.get $lhs) (local.get $p))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $c2
          (select
            (i32.load8_u (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (global.get $ptr) (local.get $stop))))
        (block $plainByte
          (if (i32.eq (local.get $c) (i32.const "|"))
            (then
              (br_if $plainByte (i32.eqz (local.get $table)))
              (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
              (br $next)))
          ;; `[[target]]`, `[[target][text]]`, `[fn:x]`, `[2024-01-31]`
          (if (i32.eq (local.get $c) (i32.const "["))
            (then
              (if (i32.eq (local.get $c2) (i32.const "["))
                (then
                  (br_if $plainByte (i32.and (global.get $orgNoClose) (i32.const 1)))
                  (local.set $q (call $orgFind2 (i32.add (local.get $lhs) (i32.const 2)) (local.get $stop) (i32.const "]]")))
                  (if (i32.ge_u (local.get $q) (local.get $stop))
                    (then
                      (global.set $orgNoClose (i32.or (global.get $orgNoClose) (i32.const 1)))
                      (br $plainByte)))
                  (local.set $p (call $orgFind2 (i32.add (local.get $lhs) (i32.const 2)) (local.get $q) (i32.const "][")))
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (call $emitTok (enum.get $Token.link_uri) (global.get $ptr) (local.get $p))
                  (if (i32.lt_u (local.get $p) (local.get $q))
                    (then
                      (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (i32.add (local.get $p) (i32.const 2)))
                      (call $emitTok (enum.get $Token.link_text) (i32.add (local.get $p) (i32.const 2)) (local.get $q))))
                  (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $q) (global.get $ptr))
                  (br $next)))
              (local.set $q (call $orgTimestamp (local.get $lhs) (local.get $stop)))
              (if (local.get $q)
                (then
                  (global.set $ptr (local.get $q))
                  (call $emitTok (enum.get $Token.constant) (local.get $lhs) (local.get $q))
                  (br $next)))
              (br_if $plainByte
                (i32.or
                  (i32.gt_u (i32.add (local.get $lhs) (i32.const 4)) (local.get $stop))
                  (i32.ne (i32.and (i32.load offset=1 (local.get $lhs)) (i32.const 0xffffff)) (i32.const "fn:"))))
              (br_if $plainByte (i32.and (global.get $orgNoClose) (i32.const 16)))
              (local.set $q (call $scanFindSpecial (local.get $lhs) (local.get $stop) (i32.const "]") (i32.const 0) (i32.const 0)))
              (if (i32.ge_u (local.get $q) (local.get $stop))
                (then
                  (global.set $orgNoClose (i32.or (global.get $orgNoClose) (i32.const 16)))
                  (br $plainByte)))
              (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
              (call $emitTok (enum.get $Token.label) (local.get $lhs) (global.get $ptr))
              (br $next)))
          ;; an active timestamp, then perhaps the next planning keyword
          (if (i32.eq (local.get $c) (i32.const "<"))
            (then
              (local.set $q (call $orgTimestamp (local.get $lhs) (local.get $stop)))
              (br_if $plainByte (i32.eqz (local.get $q)))
              (global.set $ptr (local.get $q))
              (call $emitTok (enum.get $Token.constant) (local.get $lhs) (local.get $q))
              (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
              (call $emitGap (local.get $q) (global.get $ptr))
              (local.set $q (call $orgPlanning (global.get $ptr) (local.get $stop)))
              (if (local.get $q)
                (then
                  (call $emitTok (enum.get $Token.keyword) (global.get $ptr) (local.get $q))
                  (global.set $ptr (local.get $q))))
              (br $next)))
          ;; `$math$`
          (if (i32.eq (local.get $c) (i32.const "$"))
            (then
              (br_if $plainByte (i32.or (i32.eqz (local.get $c2)) (call $lexIsSpace (local.get $c2))))
              (local.set $q (call $scanFindSpecial (global.get $ptr) (local.get $stop) (i32.const "$") (i32.const 0) (i32.const 0)))
              (br_if $plainByte
                (i32.or
                  (i32.ge_u (local.get $q) (local.get $stop))
                  (call $lexIsSpace (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))))
              (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
              (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
              (br $next)))
          ;; `\(math\)`, `\[math\]`, and entities such as `\alpha`
          (if (i32.eq (local.get $c) (i32.const 92))
            (then
              (if (i32.or (i32.eq (local.get $c2) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "[")))
                (then
                  (local.set $bit (select (i32.const 4) (i32.const 2) (i32.eq (local.get $c2) (i32.const "["))))
                  (br_if $plainByte (i32.and (global.get $orgNoClose) (local.get $bit)))
                  (local.set $q
                    (call $orgFind2
                      (i32.add (local.get $lhs) (i32.const 2))
                      (local.get $stop)
                      (i32.or
                        (i32.const 92)
                        (i32.shl
                          (i32.add (local.get $c2) (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const "["))))
                          (i32.const 8)))))
                  (if (i32.ge_u (local.get $q) (local.get $stop))
                    (then
                      (global.set $orgNoClose (i32.or (global.get $orgNoClose) (local.get $bit)))
                      (br $plainByte)))
                  (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
                  (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (br_if $plainByte
                (i32.gt_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25)))
              (call $scanIdentRun (i32.const 0))
              (if (i32.gt_u (global.get $ptr) (local.get $stop))
                (then (global.set $ptr (local.get $stop))))
              (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
              (br $next)))
          ;; `{{{macro(args)}}}`
          (if (i32.eq (local.get $c) (i32.const "{"))
            (then
              (br_if $plainByte
                (i32.or
                  (i32.gt_u (i32.add (local.get $lhs) (i32.const 3)) (local.get $stop))
                  (i32.ne (i32.load16_u offset=1 (local.get $lhs)) (i32.const "{{"))))
              (br_if $plainByte (i32.and (global.get $orgNoClose) (i32.const 8)))
              (br_if $plainByte (i32.le_u (i32.add (local.get $lhs) (i32.const 3)) (global.get $orgMacroFail)))
              (local.set $q (call $orgFind2 (i32.add (local.get $lhs) (i32.const 3)) (local.get $stop) (i32.const "}}")))
              (if (i32.ge_u (local.get $q) (local.get $stop))
                (then
                  (global.set $orgNoClose (i32.or (global.get $orgNoClose) (i32.const 8)))
                  (br $plainByte)))
              (if
                (i32.or
                  (i32.ge_u (i32.add (local.get $q) (i32.const 2)) (local.get $stop))
                  (i32.ne (i32.load8_u offset=2 (local.get $q)) (i32.const "}")))
                (then
                  (global.set $orgMacroFail (local.get $q))
                  (br $plainByte)))
              (global.set $ptr (i32.add (local.get $q) (i32.const 3)))
              (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
              (br $next)))
          ;; emphasis `*b*`, `/i/`, `_u_`, `=v=`, `~c~`, `+s+`: the opener
          ;; follows no word byte and precedes a non-blank; the closer follows a
          ;; non-blank and precedes no word byte
          (local.set $bit (i32.shl (i32.const 1) (i32.and (local.get $c) (i32.const 31))))
          (br_if $plainByte
            (i32.or
              (i32.and (global.get $orgNoClose) (local.get $bit))
              (i32.or
                (i32.or (i32.eqz (local.get $c2)) (call $lexIsSpace (local.get $c2)))
                (i32.and
                  (i32.gt_u (local.get $lhs) (global.get $srcBase))
                  (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))))
          (local.set $q (i32.add (local.get $lhs) (i32.const 1)))
          (block $found
            (loop $close
              (local.set $q
                (call $scanFindSpecial (i32.add (local.get $q) (i32.const 1)) (local.get $stop) (local.get $c) (i32.const 0) (i32.const 0)))
              (if (i32.ge_u (local.get $q) (local.get $stop))
                (then
                  (global.set $orgNoClose (i32.or (global.get $orgNoClose) (local.get $bit)))
                  (br $plainByte)))
              (br_if $close (call $lexIsSpace (i32.load8_u (i32.sub (local.get $q) (i32.const 1)))))
              (br_if $found (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (local.get $stop)))
              (br_if $close (call $lexIsIdentContinue (i32.load8_u offset=1 (local.get $q))))))
          (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
          (call $emitTok
            (select
              (enum.get $Token.emphasis.strong)
              (select
                (enum.get $Token.emphasis)
                (select
                  (enum.get $Token.comment)
                  (select (enum.get $Token.string) (enum.get $Token.text.literal) (i32.eq (local.get $c) (i32.const "=")))
                  (i32.eq (local.get $c) (i32.const "+")))
                (i32.or (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c) (i32.const "_"))))
              (i32.eq (local.get $c) (i32.const "*")))
            (local.get $lhs)
            (global.get $ptr))
          (br $next))
        (call $emitTok (local.get $base) (local.get $lhs) (global.get $ptr))
        (br $next))))

  ;; Org mode, line by line. $block: an open block body. Bits 0-3: the block
  ;; name that closes it (see $orgBlockName). Bits 8-15: the language of a
  ;; source block, highlighted by $markdownCodeRange. Bit 16: its lexer
  ;; already ran in an earlier chunk. Bits 24-31: the stream region the body
  ;; left open while region 92 marks our open body for $streamResumeLang.
  (func $hlOrg
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $rhs i32)
    (local $lineEnd i32)
    (local $block i32)
    (call $lexEmitLeadingContinuation)
    (global.set $orgMacroFail (i32.const 0))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 92))
      (then (global.set $streamRegionKind (i32.shr_u (local.get $block) (i32.const 24)))))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (global.set $orgNoClose (i32.const 0))
        (block $line
          (if (local.get $block)
            (then
              (local.set $c (i32.and (local.get $block) (i32.const 15)))
              (local.set $q (i32.and (i32.shr_u (local.get $block) (i32.const 8)) (i32.const 255)))
              (if (local.get $q)
                (then
                  (local.set $p (local.get $lhs))
                  (block $closed
                    (loop $find
                      (br_if $closed (i32.ge_u (local.get $p) (global.get $end)))
                      (br_if $closed (call $orgIsEnd (local.get $p) (local.get $c)))
                      (local.set $p
                        (call $markdownAfterLine (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13))))
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
                          (global.set $streamRegionKind (i32.const 92))))
                      (br $next)))
                  (if (global.get $streaming)
                    (then (call $markdownClearEmbeddedStream)))
                  (local.set $lhs (local.get $p)))
                (else
                  (if (i32.eqz (call $orgIsEnd (local.get $lhs) (local.get $c)))
                    (then
                      (global.set $ptr (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13)))
                      (call $emitTok
                        (select (enum.get $Token.comment) (enum.get $Token.text.literal) (i32.eq (local.get $c) (i32.const 4)))
                        (local.get $lhs)
                        (global.get $ptr))
                      (br $line)))))
              (local.set $block (i32.const 0))))
          (local.set $lineEnd (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13)))
          (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
          (call $emitGap (local.get $lhs) (global.get $ptr))
          (local.set $p (global.get $ptr))
          (br_if $line (i32.ge_u (local.get $p) (local.get $lineEnd)))
          (local.set $rhs (call $rstTrimEnd (local.get $p) (local.get $lineEnd)))
          (local.set $c (i32.load8_u (local.get $p)))
          (local.set $c2 (select (i32.load8_u offset=1 (local.get $p)) (i32.const 32) (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $lineEnd))))

          ;; headline: stars, TODO keyword, priority, title, tags
          (if (i32.and (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $p) (local.get $lhs)))
            (then
              (local.set $q (local.get $p))
              (block $starsDone
                (loop $stars
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br_if $starsDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                  (br_if $stars (i32.eq (i32.load8_u (local.get $q)) (i32.const "*")))))
              (if (i32.or (i32.ge_u (local.get $q) (local.get $lineEnd)) (call $lexIsSpace (i32.load8_u (local.get $q))))
                (then
                  (call $emitTok (enum.get $Token.punctuation.markup) (local.get $p) (local.get $q))
                  (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                  (call $emitGap (local.get $q) (global.get $ptr))
                  (local.set $p (global.get $ptr))
                  (local.set $q (call $orgNameEnd (local.get $p) (local.get $rhs)))
                  (if (call $orgIsTodo (local.get $p) (local.get $q))
                    (then
                      (call $emitTok (enum.get $Token.keyword) (local.get $p) (local.get $q))
                      (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                      (call $emitGap (local.get $q) (global.get $ptr))
                      (local.set $p (global.get $ptr))))
                  (if
                    (i32.and
                      (i32.le_u (i32.add (local.get $p) (i32.const 4)) (local.get $rhs))
                      (i32.and
                        (i32.eq (i32.load16_u (local.get $p)) (i32.const "[#"))
                        (i32.eq (i32.load8_u offset=3 (local.get $p)) (i32.const "]"))))
                    (then
                      (local.set $q (i32.add (local.get $p) (i32.const 4)))
                      (call $emitTok (enum.get $Token.constant) (local.get $p) (local.get $q))
                      (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                      (call $emitGap (local.get $q) (global.get $ptr))))
                  ;; trailing `:tag1:tag2:` after a blank
                  (local.set $q (local.get $rhs))
                  (if (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const ":"))
                    (then
                      (block $tagsDone
                        (loop $tags
                          (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                          (if (i32.le_u (local.get $q) (global.get $ptr))
                            (then
                              (local.set $q (local.get $rhs))
                              (br $tagsDone)))
                          (local.set $c (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))
                          (br_if $tagsDone (call $lexIsSpace (local.get $c)))
                          (br_if $tags
                            (i32.or
                              (call $lexIsIdentContinue (local.get $c))
                              (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "@")))))
                          (local.set $q (local.get $rhs))))
                      (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ":"))
                        (then (local.set $q (local.get $rhs))))))
                  (call $orgInline (local.get $q) (enum.get $Token.title) (i32.const 0))
                  (call $emitTok (enum.get $Token.label) (local.get $q) (local.get $rhs))
                  (if (i32.lt_u (global.get $ptr) (local.get $rhs)) (then (global.set $ptr (local.get $rhs))))
                  (br $line)))))

          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              ;; `# comment`
              (if (call $lexIsSpace (local.get $c2))
                (then
                  (global.set $ptr (local.get $lineEnd))
                  (call $emitTok (enum.get $Token.comment) (local.get $p) (local.get $lineEnd))
                  (br $line)))
              (if (i32.eq (local.get $c2) (i32.const "+"))
                (then
                  (local.set $q (call $orgNameEnd (i32.add (local.get $p) (i32.const 2)) (local.get $lineEnd)))
                  (if
                    (i32.and
                      (i32.ge_u (local.get $q) (i32.add (local.get $p) (i32.const 8)))
                      (call $orgIs (local.get $p) (i32.const 8) (i64.const "#+begin\7f")))
                    (then
                      (local.set $c (call $orgBlockName (i32.add (local.get $p) (i32.const 8)) (local.get $q)))
                      (call $emitTok (enum.get $Token.keyword) (local.get $p) (local.get $q))
                      (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                      (call $emitGap (local.get $q) (global.get $ptr))
                      (local.set $p (global.get $ptr))
                      (local.set $block (local.get $c))
                      ;; the language of a source block
                      (if (local.get $c)
                        (then
                          (local.set $q (call $scanFindSpecial (local.get $p) (local.get $rhs) (i32.const 32) (i32.const 0) (i32.const 0)))
                          (call $emitTok (enum.get $Token.label) (local.get $p) (local.get $q))
                          (if (i32.eq (local.get $c) (i32.const 1))
                            (then
                              (local.set $c (call $orgLanguageByName (local.get $p) (local.get $q)))
                              ;; an Org body would reuse our checkpoint window
                              (if (i32.ne (local.get $c) (enum.get $Language.org))
                                (then
                                  (local.set $block
                                    (i32.or (local.get $block) (i32.shl (local.get $c) (i32.const 8))))))))
                          (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                          (call $emitGap (local.get $q) (global.get $ptr))))
                      (call $emitTok (enum.get $Token.attribute) (global.get $ptr) (local.get $rhs))
                      (if (i32.lt_u (global.get $ptr) (local.get $rhs)) (then (global.set $ptr (local.get $rhs))))
                      (br $line)))
                  ;; `#+TITLE: value`, `#+end_src`
                  (if (i32.eq (call $templateByte (local.get $q)) (i32.const ":"))
                    (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
                  (call $emitTok (enum.get $Token.keyword) (local.get $p) (local.get $q))
                  (local.set $c
                    (select
                      (enum.get $Token.title)
                      (enum.get $Token.none)
                      (i32.and
                        (i32.eq (i32.sub (local.get $q) (local.get $p)) (i32.const 8))
                        (call $orgIs (local.get $p) (i32.const 8) (i64.const "#+title:")))))
                  (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                  (call $emitGap (local.get $q) (global.get $ptr))
                  (call $orgInline (local.get $rhs) (local.get $c) (i32.const 0))
                  (br $line)))))

          (if (i32.eq (local.get $c) (i32.const ":"))
            (then
              ;; `: fixed-width text`
              (if (call $lexIsSpace (local.get $c2))
                (then
                  (global.set $ptr (local.get $lineEnd))
                  (call $emitTok (enum.get $Token.text.literal) (local.get $p) (local.get $lineEnd))
                  (br $line)))
              ;; `:PROPERTIES:` and `:END:` alone; `:key: value` inside drawers
              (local.set $q (call $orgNameEnd (i32.add (local.get $p) (i32.const 1)) (local.get $rhs)))
              (if (i32.eq (call $templateByte (local.get $q)) (i32.const "+"))
                (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
              (if
                (i32.and
                  (i32.lt_u (local.get $q) (local.get $rhs))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const ":")))
                (then
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (call $emitTok
                    (select (enum.get $Token.keyword) (enum.get $Token.property) (i32.eq (local.get $q) (local.get $rhs)))
                    (local.get $p)
                    (local.get $q))
                  (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                  (call $emitGap (local.get $q) (global.get $ptr))
                  (call $orgInline (local.get $rhs) (enum.get $Token.none) (i32.const 0))
                  (br $line)))))

          ;; `-----` rule
          (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.ge_u (i32.sub (local.get $rhs) (local.get $p)) (i32.const 5)))
            (then
              (local.set $q (local.get $p))
              (block $dashesDone
                (loop $dashes
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br_if $dashesDone (i32.ge_u (local.get $q) (local.get $rhs)))
                  (br_if $dashes (i32.eq (i32.load8_u (local.get $q)) (i32.const "-")))))
              (if (i32.eq (local.get $q) (local.get $rhs))
                (then
                  (global.set $ptr (local.get $rhs))
                  (call $emitTok (enum.get $Token.punctuation.markup) (local.get $p) (local.get $rhs))
                  (br $line)))))

          ;; table rows and `|---+---|` rules
          (if (i32.eq (local.get $c) (i32.const "|"))
            (then
              (if (i32.eq (local.get $c2) (i32.const "-"))
                (then
                  (global.set $ptr (local.get $rhs))
                  (call $emitTok (enum.get $Token.punctuation.markup) (local.get $p) (local.get $rhs))
                  (br $line)))
              (call $orgInline (local.get $rhs) (enum.get $Token.none) (i32.const 1))
              (br $line)))

          ;; planning: `SCHEDULED: <2024-01-31 Wed>`
          (local.set $q (call $orgPlanning (local.get $p) (local.get $rhs)))
          (if (local.get $q)
            (then
              (call $emitTok (enum.get $Token.keyword) (local.get $p) (local.get $q))
              (global.set $ptr (local.get $q))
              (call $orgInline (local.get $rhs) (enum.get $Token.none) (i32.const 0))
              (br $line)))

          ;; list items: `-`, `+`, `*` (indented), `1.`, `1)`, `a.`; then a
          ;; checkbox and a `term ::` of a description list
          (local.set $q (i32.add (local.get $p) (i32.const 1)))
          (if (i32.eqz
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "+")))
                  (i32.and (i32.eq (local.get $c) (i32.const "*")) (i32.gt_u (local.get $p) (local.get $lhs)))))
            (then
              (local.set $q (local.get $p))
              (if (call $lexIsDigit (local.get $c))
                (then
                  (block $digitsDone
                    (loop $digits
                      (local.set $q (i32.add (local.get $q) (i32.const 1)))
                      (br_if $digitsDone (i32.ge_u (local.get $q) (local.get $rhs)))
                      (br_if $digits (call $lexIsDigit (i32.load8_u (local.get $q))))))))
              (if (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (then (local.set $q (i32.add (local.get $p) (i32.const 1)))))
              (local.set $c (call $templateByte (local.get $q)))
              (local.set $q
                (select
                  (i32.add (local.get $q) (i32.const 1))
                  (local.get $p)
                  (i32.and
                    (i32.gt_u (local.get $q) (local.get $p))
                    (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ")"))))))))
          (if
            (i32.and
              (i32.gt_u (local.get $q) (local.get $p))
              (i32.or (i32.ge_u (local.get $q) (local.get $rhs)) (call $lexIsSpace (i32.load8_u (local.get $q)))))
            (then
              (call $emitTok (enum.get $Token.punctuation.list_marker) (local.get $p) (local.get $q))
              (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
              (call $emitGap (local.get $q) (global.get $ptr))
              (local.set $p (global.get $ptr))
              (if
                (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 3)) (local.get $rhs))
                  (i32.and
                    (i32.eq (i32.load8_u (local.get $p)) (i32.const "["))
                    (i32.eq (i32.load8_u offset=2 (local.get $p)) (i32.const "]"))))
                (then
                  (local.set $c (i32.load8_u offset=1 (local.get $p)))
                  (if
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const "-")))
                      (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "x")))
                    (then
                      (local.set $q (i32.add (local.get $p) (i32.const 3)))
                      (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (local.get $q))
                      (global.set $ptr (call $lexSkipSpaceAt (local.get $q)))
                      (call $emitGap (local.get $q) (global.get $ptr))
                      (local.set $p (global.get $ptr))))))
              (local.set $q (local.get $p))
              (block $termDone
                (loop $term
                  (local.set $q (call $orgFind2 (local.get $q) (local.get $rhs) (i32.const "::")))
                  (br_if $termDone (i32.ge_u (local.get $q) (local.get $rhs)))
                  (if
                    (i32.and
                      (i32.gt_u (local.get $q) (local.get $p))
                      (i32.and
                        (call $lexIsSpace (i32.load8_u (i32.sub (local.get $q) (i32.const 1))))
                        (i32.or
                          (i32.ge_u (i32.add (local.get $q) (i32.const 2)) (local.get $rhs))
                          (call $lexIsSpace (i32.load8_u offset=2 (local.get $q))))))
                    (then
                      (call $orgInline (local.get $q) (enum.get $Token.property) (i32.const 0))
                      ;; the term ends before the line end: its failed searches no longer hold
                      (global.set $orgNoClose (i32.const 0))
                      (global.set $ptr (i32.add (local.get $q) (i32.const 2)))
                      (call $emitTok (enum.get $Token.punctuation.special) (local.get $q) (global.get $ptr))
                      (br $termDone)))
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br $term)))))
          (call $orgInline (local.get $rhs) (enum.get $Token.none) (i32.const 0)))
        ;; the line break, and blanks before it
        (local.set $lhs (global.get $ptr))
        (global.set $ptr
          (call $markdownAfterLine (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13))))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br $next))))
)
