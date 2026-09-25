(module
  (import "../token.wat")
  (import "../scan.wat")
  (import "../emit.wat")
  (import "./tsx.wat")
  (import "./css.wat")
  (import "./xml.wat")

  ;; does [lhs,rhs) name a raw-text element? 1=script 2=style 0=other.
  ;; the OR 0x20 fold is safe: letters fold, digits/dashes already have bit 5
  (func $rawTextKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 6))
      (then
        (if
          (i64.eq
            (i64.or
              (i64.and (i64.load (local.get $lhs)) (i64.const 0xFFFFFFFFFFFF))
              (i64.const 0x202020202020))
            (i64.const "script"))
          (then (return (i32.const 1))))))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then
        (if
          (i64.eq
            (i64.or
              (i64.and (i64.load (local.get $lhs)) (i64.const 0xFFFFFFFFFF))
              (i64.const 0x2020202020))
            (i64.const "style"))
          (then (return (i32.const 2))))))
    (i32.const 0))

  ;; is $p the start of `</script` (kind 1) or `</style` (kind 2), followed by
  ;; a name-ending byte? $p points at the `<`.
  (func $isRawTextClose (param $p i32) (param $kind i32) (result i32)
    (local $t i32)
    (local $tp i32)
    (if (i32.eq (local.get $kind) (i32.const 1))
      (then
        (if (i32.gt_u (i32.add (local.get $p) (i32.const 8)) (global.get $end))
          (then (return (i32.const 0))))
        ;; bytes p+1..p+7 = "/script" (letters folded)
        (if
          (i64.ne
            (i64.or
              (i64.and (i64.load offset=1 (local.get $p)) (i64.const 0x00FFFFFFFFFFFFFF))
              (i64.const 0x0020202020202000))
            (i64.const "/script"))
          (then (return (i32.const 0))))
        (local.set $tp (i32.add (local.get $p) (i32.const 8))))
      (else
        (if (i32.gt_u (i32.add (local.get $p) (i32.const 7)) (global.get $end))
          (then (return (i32.const 0))))
        ;; bytes p+1..p+6 = "/style" (letters folded)
        (if
          (i64.ne
            (i64.or
              (i64.and (i64.load offset=1 (local.get $p)) (i64.const 0xFFFFFFFFFFFF))
              (i64.const 0x202020202000))
            (i64.const "/style"))
          (then (return (i32.const 0))))
        (local.set $tp (i32.add (local.get $p) (i32.const 7)))))
    ;; the close-tag name must end here: whitespace, `>`, `/`, or input end
    (if (i32.ge_u (local.get $tp) (global.get $end))
      (then (return (i32.const 1))))
    (local.set $t (i32.load8_u (local.get $tp)))
    (i32.or
      (i32.or (i32.eq (local.get $t) (i32.const ">")) (i32.eq (local.get $t) (i32.const "/")))
      (i32.or
        (i32.eq (local.get $t) (i32.const 32))
        (i32.le_u (i32.sub (local.get $t) (i32.const 9)) (i32.const 4)))))

  ;; scan a character reference at `&`; emits it as string.escape and returns 1,
  ;; or returns 0 leaving $ptr on the `&`
  (func $htmlEntity (result i32)
    (local $q i32)
    (local $c i32)
    (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
    (if
      (i32.and
        (i32.lt_u (local.get $q) (global.get $end))
        (i32.eq (i32.load8_u (local.get $q)) (i32.const "#")))
      (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
    (block $stop
      (loop $l
        (br_if $stop (i32.ge_u (local.get $q) (global.get $end)))
        ;; 32 covers the longest named reference (CounterClockwiseContourIntegral)
        (br_if $stop (i32.gt_u (i32.sub (local.get $q) (global.get $ptr)) (i32.const 32)))
        (local.set $c (i32.load8_u (local.get $q)))
        (block $ok
          (br_if $ok (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (br_if $ok
            (i32.le_u
              (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
              (i32.const 25)))
          (br $stop))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    ;; need at least one name character and a closing `;`
    (if
      (i32.or
        (i32.le_u
          (i32.sub (local.get $q) (global.get $ptr))
          (select
            (i32.const 2)
            (i32.const 1)
            (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const "#"))))
        (i32.or
          (i32.ge_u (local.get $q) (global.get $end))
          (i32.ne (i32.load8_u (local.get $q)) (i32.const ";"))))
      (then (return (i32.const 0))))
    (call $emitTok
      (enum.get $Token.string.special)
      (global.get $ptr)
      (i32.add (local.get $q) (i32.const 1)))
    (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
    (i32.const 1))

  ;; `<!--` comment: advance past `-->` (or to $end) and emit the whole token.
  ;; The close scan, the spec's abrupt-closing rule (`<!-->` and `<!--->` are
  ;; complete comments), and the streaming checkpoint are byte-identical to an
  ;; XML comment section, so delegate.
  (func $htmlComment (param $lhs i32)
    (call $xmlSection (local.get $lhs) (i32.const 4) (i32.const 1) (enum.get $Token.comment)))

  ;; `<!...>` declaration ($pi 0) or `<?...?>` processing instruction ($pi 1)
  ;; at $ptr: emit it as $hl, advancing past the close (or to $end). A token
  ;; still open at a real chunk end is checkpointed as a fixed-delimiter mode
  ;; so the next chunk keeps its color; a bounded sub-range end is not a
  ;; chunk end and leaves no mode behind.
  (func $htmlDecl (param $lhs i32) (param $pi i32) (param $hl i32)
    (local $p i32)
    (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
    (block $found
      (loop $l
        (local.set $p (call $lexFindByte (local.get $p) (i32.const ">")))
        (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $found
          (i32.or
            (i32.eqz (local.get $pi))
            (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "?"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))
      (else
        (global.set $ptr (global.get $end))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (if (i32.eq (global.get $ptr) (global.get $eof))
          (then
            (call $streamSetFixed32
              (select (i32.const "?>") (i32.const ">") (local.get $pi))
              (i32.add (local.get $pi) (i32.const 1))
              (local.get $hl)))))))

  ;; tag / attribute name: ends at whitespace, `=`, `>`, `/`, a quote, or `<`
  ;; (so a stray tag start ends the run) - one byte-set test per byte
  (func $htmlNameEnd (param $q i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $q) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $done (byteset.get "\09\0a\0b\0c\0d \22'/<=>" (local.get $c)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.get $q))

  ;; unquoted attribute value: ends at whitespace, `>`, `<`, or a quote - `/`
  ;; and `=` are ordinary value bytes per spec, so `href=/foo/bar` stays whole
  (func $htmlValueEnd (param $q i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $q) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $done (byteset.get "\09\0a\0b\0c\0d \22'<>" (local.get $c)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.get $q))

  ;; the rest of a quoted attribute value: scan from $ptr to the closing
  ;; $quote and emit [$lhs, after the quote) as one string. Returns $quote
  ;; when the value is still open at $end (so a chunk end can checkpoint it),
  ;; 0 once it closed. $lhs is the opening quote, or the chunk start when a
  ;; value left open by the previous chunk resumes.
  (func $htmlQuotedBody (param $quote i32) (param $lhs i32) (result i32)
    (local $p i32)
    (local.set $p (call $lexFindByte (global.get $ptr) (local.get $quote)))
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $quote (i32.const 0)))
      (else (global.set $ptr (global.get $end))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (local.get $quote))

  ;; Svelte and Astro cut their html ranges at every `{`, including one inside
  ;; a start tag (`class={x}`, `{...props}`). When a range ends inside a start
  ;; tag, the attribute loop leaves its state here for the owner, packed as
  ;; 1 | after-`=` << 1 | open quote << 8 | raw-text kind << 16 (0: no open
  ;; tag). The owner clears it before each range, reads it right after, and
  ;; continues the tag's attributes once the expression is highlighted.
  (global $htmlOpenTag (mut i32) (i32.const 0))

  ;; Raw-text kinds: 1 script, 2 style, and a style whose `lang` attribute
  ;; names a css preprocessor: 14 less, 15 scss, 16 sass (13 + the css.wat
  ;; dialect). The kind doubles as the stream region of a body cut by a chunk
  ;; end. Bit 6 marks a style tag whose `lang` still waits for its value.

  ;; A style tag's attribute name [$lhs,$rhs): `lang` sets the waiting mark,
  ;; any other name clears it. Scripts keep their kind.
  (func $htmlLangName (param $kind i32) (param $lhs i32) (param $rhs i32) (result i32)
    (local.set $kind (i32.and (local.get $kind) (i32.const 63)))
    (if
      (i32.and
        (i32.ne (local.get $kind) (i32.const 1))
        (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 4))
          (i32.eq (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)) (i32.const "lang"))))
      (then (local.set $kind (i32.or (local.get $kind) (i32.const 64)))))
    (local.get $kind))

  ;; The value [$lhs,$rhs) of an attribute: after a waiting `lang`, `less`,
  ;; `scss`, or `sass` (any case) selects that dialect's style kind. The mark
  ;; clears either way; an unterminated value passes an empty range.
  (func $htmlLangValue (param $kind i32) (param $lhs i32) (param $rhs i32) (result i32)
    (local $w i32)
    (if (i32.eqz (i32.and (local.get $kind) (i32.const 64)))
      (then (return (local.get $kind))))
    (local.set $kind (i32.and (local.get $kind) (i32.const 63)))
    (if (i32.ne (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 4))
      (then (return (local.get $kind))))
    (local.set $w (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)))
    (if (i32.eq (local.get $w) (i32.const "less"))
      (then (return (i32.const 14))))
    (if (i32.eq (local.get $w) (i32.const "scss"))
      (then (return (i32.const 15))))
    (if (i32.eq (local.get $w) (i32.const "sass"))
      (then (return (i32.const 16))))
    (local.get $kind))

  ;; Attributes after a tag name until `>` / `/>`. Returns the status in the
  ;; low byte - 1 when the tag was closed by a plain `>`, 2 for `/>`, 0 for a
  ;; stray `<` (the caller reparses it in text mode) or input end - and the
  ;; raw-text kind above it (a style's `lang` may refine it). The loop is
  ;; re-enterable so a tag cut by a chunk end resumes where it stopped:
  ;; $afterEq is set when the value after `=` is still expected, $quote is
  ;; the open quote of an unterminated value. At a real chunk end (never a
  ;; bounded sub-range end) the open tag becomes stream region $region with
  ;; $streamA = $kind (a raw-text body must follow the tag), $streamB =
  ;; after-`=` flag, $streamC = open quote; the owning lexer's resume hook
  ;; calls back into this loop with them. A bounded end in a svelte or astro
  ;; range (regions 12 and 13) sets $htmlOpenTag instead.
  (func $htmlAttrs
    (param $afterEq i32)
    (param $quote i32)
    (param $kind i32)
    (param $region i32)
    (result i32)
    (local $c i32)
    (local $lhs i32)
    (if (local.get $quote)
      (then (local.set $quote (call $htmlQuotedBody (local.get $quote) (global.get $ptr)))))
    (block $done
      (result i32)
      (loop $next
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (if (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof)))
              (then
                (call $streamSetRegion (local.get $region))
                (global.set $streamA (local.get $kind))
                (global.set $streamB (local.get $afterEq))
                (global.set $streamC (local.get $quote)))
              (else
                (if (i32.ge_u (local.get $region) (i32.const 12))
                  (then
                    (global.set $htmlOpenTag
                      (i32.or
                        (i32.or (i32.const 1) (i32.shl (local.get $afterEq) (i32.const 1)))
                        (i32.or
                          (i32.shl (local.get $quote) (i32.const 8))
                          (i32.shl (local.get $kind) (i32.const 16)))))))))
            (br $done (i32.const 0))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $lhs (global.get $ptr))
        ;; whitespace gap
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 32))
            (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.html)
              (local.get $lhs)
              (global.get $ptr))
            (br $done
              (i32.or (i32.const 1) (i32.shl (i32.and (local.get $kind) (i32.const 63)) (i32.const 8))))))
        ;; the value right after `=`: quoted, or an unquoted run (which may
        ;; contain `/` and `=`, so this comes before those branches)
        (if (local.get $afterEq)
          (then
            (local.set $afterEq (i32.const 0))
            (if
              (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $quote (call $htmlQuotedBody (local.get $c) (local.get $lhs)))
                (if (i32.and (local.get $kind) (i32.const 64))
                  (then
                    (local.set $kind
                      (call $htmlLangValue
                        (local.get $kind)
                        (i32.add (local.get $lhs) (i32.const 1))
                        (select
                          (i32.sub (global.get $ptr) (i32.const 1))
                          (i32.add (local.get $lhs) (i32.const 1))
                          (i32.eqz (local.get $quote)))))))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then (br $done (i32.const 0)))) ;; stray tag start: reparse in TEXT mode
            (global.set $ptr (call $htmlValueEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (if (i32.and (local.get $kind) (i32.const 64))
              (then
                (local.set $kind
                  (call $htmlLangValue (local.get $kind) (local.get $lhs) (global.get $ptr)))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            ;; `/>` or a stray slash
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.lt_u (global.get $ptr) (global.get $end))
                (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.bracket.html)
                  (local.get $lhs)
                  (global.get $ptr))
                (br $done
                  (i32.or
                    (i32.const 2)
                    (i32.shl (i32.and (local.get $kind) (i32.const 63)) (i32.const 8))))))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter.html)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $afterEq (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $quote (call $htmlQuotedBody (local.get $c) (local.get $lhs)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then (br $done (i32.const 0)))) ;; stray tag start: reparse in TEXT mode
        ;; attribute name (values were consumed by the $afterEq branch above);
        ;; every byte $htmlNameEnd refuses was taken by a branch above, so the
        ;; name is never empty
        (global.set $ptr (call $htmlNameEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
        (if (local.get $kind)
          (then
            (local.set $kind (call $htmlLangName (local.get $kind) (local.get $lhs) (global.get $ptr)))))
        (br $next))
      (unreachable)))

  ;; a style body [$ptr, $end) as css, or as the preprocessor its `lang`
  ;; named (raw-text kinds 14-16)
  (func $htmlStyleBody (param $kind i32)
    (if (i32.eq (local.get $kind) (i32.const 14))
      (then
        (call $hlLess)
        (return)))
    (if (i32.eq (local.get $kind) (i32.const 15))
      (then
        (call $hlScss)
        (return)))
    (if (i32.eq (local.get $kind) (i32.const 16))
      (then
        (call $hlSass)
        (return)))
    (call $hlCss))

  ;; raw-text body: emit [$ptr, the matching close tag) with the embedded
  ;; lexer, leaving $ptr on the `<` of the close tag
  (func $htmlRawText (param $kind i32)
    (local $from i32)
    (local $to i32)
    (local $save i32)
    (local $continued i32)
    (local.set $from (global.get $ptr))
    (block $found
      (loop $l
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "<")))
        (br_if $found (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $found (call $isRawTextClose (global.get $ptr) (local.get $kind)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    ;; hand [from,to) to the embedded language over an $end swap
    (local.set $to (global.get $ptr))
    (local.set $save (global.get $end))
    (local.set $continued
      (i32.and (global.get $streaming) (i32.eq (local.get $to) (local.get $save))))
    (if (local.get $continued)
      (then (call $streamSetRegion (local.get $kind))))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (if (i32.eq (local.get $kind) (i32.const 1))
      (then
        (if (local.get $continued)
          (then (call $hlJsStream (i32.const 1)))
          (else (call $hlJs))))
      (else
        (if (local.get $continued)
          (then
            (global.set $streamDepth (i32.const 0))
            (global.set $streamReset (i32.const 1))))
        (call $htmlStyleBody (local.get $kind))
        (if (local.get $continued)
          (then
            (global.set $streamDepth (i32.const 1))
            (global.set $streamReset (i32.const 0))))))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to))
    (if (local.get $continued)
      (then (global.set $streamRegionStarted (i32.const 1)))))

  ;; `<name ...>` start tag at $ptr (a name byte follows the `<`). A raw-text
  ;; body follows a completed script/style tag - `/>` counts too, real html
  ;; ignores the slash on script/style, so does the browser. Leaves $ptr
  ;; after the tag, or on the `<` of the close tag for raw-text elements.
  ;; $region is the stream region an unfinished tag is checkpointed as.
  (func $htmlTag (param $region i32)
    (local $lhs i32)
    (local $q i32)
    (local $kind i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
    (local.set $q (call $htmlNameEnd (global.get $ptr)))
    (local.set $kind (call $rawTextKind (global.get $ptr) (local.get $q)))
    (call $emitTok (enum.get $Token.tag) (global.get $ptr) (local.get $q))
    (global.set $ptr (local.get $q))
    (call $htmlTagEnd
      (call $htmlAttrs (i32.const 0) (i32.const 0) (local.get $kind) (local.get $region))))

  ;; Finish a start tag from its attribute loop's packed result (see
  ;; $htmlAttrs): a closed script/style tag is followed by its raw-text body.
  (func $htmlTagEnd (param $r i32)
    (if
      (i32.and
        (i32.ne (i32.and (local.get $r) (i32.const 3)) (i32.const 0))
        (i32.gt_u (local.get $r) (i32.const 255)))
      (then (call $htmlRawText (i32.shr_u (local.get $r) (i32.const 8))))))

  ;; The html main loop over [$ptr, $end). Frameworks that lex html between
  ;; their own constructs call it with their own $region (svelte 12, astro
  ;; 13) so a start tag cut by a chunk end is resumed by their hook, which
  ;; knows where the html range must stop; the html lexer itself uses 9.
  (func $htmlLex (param $region i32)
    (local $c i32)
    (local $lhs i32)
    (local $q i32)
    (local $textFrom i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; text run: everything up to the next `<` or `&`
        (local.set $textFrom (global.get $ptr))
        (global.set $ptr (call $lexFindEither (global.get $ptr) (i32.const "<") (i32.const "&")))
        (call $emitTok (enum.get $Token.none) (local.get $textFrom) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $lhs (global.get $ptr))

        ;; character reference
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (if (i32.eqz (call $htmlEntity))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; `<`: comment, declaration, close tag, open tag, or plain text
        (local.set $c
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        ;; `<!--` / `<!...>` / `<?...?>`
        (if (i32.eq (local.get $c) (i32.const "!"))
          (then
            (if
              (i32.and
                (i32.le_u (i32.add (global.get $ptr) (i32.const 4)) (global.get $end))
                (i32.eq (i32.load (global.get $ptr)) (i32.const "<!--")))
              (then (call $htmlComment (local.get $lhs)))
              (else (call $htmlDecl (local.get $lhs) (i32.const 0) (enum.get $Token.tag.doctype))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "?"))
          (then
            (call $htmlDecl (local.get $lhs) (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        ;; `</name ... >`
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.html)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $q (call $htmlNameEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.tag) (global.get $ptr) (local.get $q))
            (global.set $ptr (local.get $q))
            (drop (call $htmlAttrs (i32.const 0) (i32.const 0) (i32.const 0) (local.get $region)))
            (br $next)))

        ;; `<name`: an open tag only when a name really starts here
        (if
          (i32.or
            (i32.le_u
              (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
              (i32.const 25))
            (i32.or
              (i32.eq (local.get $c) (i32.const "_"))
              (i32.ge_u (local.get $c) (i32.const 128))))
          (then
            (call $htmlTag (local.get $region))
            (br $next)))

        ;; a lone `<`: plain text
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))

  (func $hlHtml
    (call $lexEmitLeadingContinuation)
    (call $htmlLex (i32.const 9)))

  ;; Finish a resumed start tag from its attribute-loop status. Status 0 with
  ;; the cursor at the chunk end means the tag is still open (the loop
  ;; checkpointed it again): report the chunk as consumed. Status 0 elsewhere
  ;; abandons the tag at a stray `<` or at the owner's range bound. A closed
  ;; script/style tag starts its raw-text body, which may itself continue as
  ;; region 1/2. The resume hooks run at stream depth 1 so embedded lexers
  ;; behave as they do under the html root; this resets the depth.
  (func $htmlTagResumeEnd (param $status i32) (param $kind i32) (result i32)
    (if (i32.and (i32.eqz (local.get $status)) (i32.eq (global.get $ptr) (global.get $eof)))
      (then
        (global.set $streamDepth (i32.const 0))
        (return (i32.const 1))))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamMode (i32.const 0))
    (if
      (i32.and (i32.ne (local.get $status) (i32.const 0)) (i32.ne (local.get $kind) (i32.const 0)))
      (then (call $htmlRawText (local.get $kind))))
    (global.set $streamDepth (i32.const 0))
    (i32.const 0))

  ;; Continue a start tag checkpointed by $htmlAttrs as region $region from
  ;; the chunk start, within the current [$ptr, $end).
  (func $htmlTagResume (param $region i32) (result i32)
    (local $r i32)
    (global.set $streamDepth (i32.const 1))
    (local.set $r
      (call $htmlAttrs
        (global.get $streamB)
        (global.get $streamC)
        (global.get $streamA)
        (local.get $region)))
    (call $htmlTagResumeEnd
      (i32.and (local.get $r) (i32.const 3))
      (i32.shr_u (local.get $r) (i32.const 8))))

  ;; Resume stream region 9: a start tag whose attributes continue past
  ;; the previous chunk end. Returns 1 when the region consumed the whole
  ;; chunk, 0 when the language lexer should continue from $ptr.
  (func $htmlStreamResumeTag (result i32)
    (call $htmlTagResume (i32.const 9)))

  ;; Svelte and Astro share this html lexing around `{...}` expressions.
  ;; $astro (0 or 1) selects the dialect: Svelte's html ranges checkpoint as
  ;; stream region 12 and its expressions as region 7; Astro's as 13 and 8.

  ;; lex [$from,$to) as html; a start tag cut by the chunk end is
  ;; checkpointed as region 12 + $astro so $braceStreamResumeTag continues it
  (func $braceHtmlRange (param $from i32) (param $to i32) (param $astro i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to))
      (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $htmlLex (i32.add (i32.const 12) (local.get $astro)))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  ;; 1 for `<script`, 2 for `<style`, 0 otherwise. $p sits on a proven `<`.
  (func $braceRawKind (param $p i32) (result i32)
    (local $kind i32)
    (local $q i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.le_u (i32.add (local.get $q) (i32.const 6)) (global.get $end))
      (then
        (local.set $kind
          (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 6))))))
    (if (i32.eqz (local.get $kind))
      (then
        (if (i32.le_u (i32.add (local.get $q) (i32.const 5)) (global.get $end))
          (then
            (local.set $kind
              (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 5))))))))
    (if (local.get $kind)
      (then
        (local.set $q
          (i32.add
            (local.get $q)
            (select (i32.const 6) (i32.const 5) (i32.eq (local.get $kind) (i32.const 1)))))
        (if
          (i32.and
            (i32.lt_u (local.get $q) (global.get $end))
            (i32.eqz
              (i32.or
                (call $lexIsSpace (i32.load8_u (local.get $q)))
                (i32.or
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const ">"))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const "/"))))))
          (then (return (i32.const 0))))))
    (local.get $kind))

  ;; The next position at or after $p where the html range must stop: a `{`
  ;; expression, a `<!--` comment, or a `<script`/`<style` element (whose
  ;; body must stay opaque to `{`); $end when there is none. The main loop
  ;; and the tag resume share it so both cut html identically.
  (func $braceNextCut (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))
        (br_if $done (call $braceRawKind (local.get $p)))
        (br_if $done
          (i32.and
            (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
            (i32.eq (i32.load (local.get $p)) (i32.const "<!--"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Highlight the `{...}` at $from in one pass (see $hlTsxExpression).
  ;; Svelte emits the `{` itself and a block or directive marker word after
  ;; it (`#if`, `:else`, `/each`, `@html`) as a keyword, then lexes the body
  ;; as TSX in regexp-allowed position; its braces are punctuation.special.
  ;; Astro lexes the braces as TSX too, so they stay brackets. Returns 1 with
  ;; $ptr after the closing `}`, 0 when the body ran to $end; a body open at
  ;; a chunk end streams on as region 7 + $astro, keeping $tag.
  (func $braceExpression (param $from i32) (param $tag i32) (param $astro i32) (result i32)
    (local $c i32)
    (local $markerEnd i32)
    (local $p i32)
    (local.set $p (local.get $from))
    (if (i32.eqz (local.get $astro))
      (then
        (call $emitTok
          (enum.get $Token.punctuation.special)
          (local.get $from)
          (i32.add (local.get $from) (i32.const 1)))
        (local.set $p (i32.add (local.get $from) (i32.const 1)))
        (if (i32.lt_u (local.get $p) (global.get $end))
          (then
            (local.set $c (i32.load8_u (local.get $p)))
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const "#"))
                (i32.or
                  (i32.eq (local.get $c) (i32.const ":"))
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "/"))
                    (i32.eq (local.get $c) (i32.const "@")))))
              (then
                (local.set $markerEnd (i32.add (local.get $p) (i32.const 1)))
                (block $markerDone
                  (loop $marker
                    (br_if $markerDone (i32.ge_u (local.get $markerEnd) (global.get $end)))
                    (br_if $markerDone
                      (i32.gt_u
                        (i32.sub
                          (i32.or (i32.load8_u (local.get $markerEnd)) (i32.const 32))
                          (i32.const "a"))
                        (i32.const 25)))
                    (local.set $markerEnd (i32.add (local.get $markerEnd) (i32.const 1)))
                    (br $marker)))
                (call $emitTok (enum.get $Token.keyword.control) (local.get $p) (local.get $markerEnd))
                (local.set $p (local.get $markerEnd))))))))
    (global.set $ptr (local.get $p))
    (if
      (call $hlTsxExpression
        (i32.const 1)
        (local.get $astro)
        (i32.add (i32.const 7) (local.get $astro))
        (local.get $tag))
      (then
        (call $emitTok
          (select
            (enum.get $Token.punctuation.bracket)
            (enum.get $Token.punctuation.special)
            (local.get $astro))
          (global.get $ptr)
          (i32.add (global.get $ptr) (i32.const 1)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (return (i32.const 1))))
    (i32.const 0))

  ;; Continue a start tag that a `{` cut interrupted, from $ptr: after an
  ;; expression (`class={x}`, `{...props}`, Svelte's `title="a {b} c"`), or,
  ;; in Astro, at a `{` inside a quoted value, which Astro keeps literal
  ;; (`href="/x/{id}"`). The attributes run to the next cut, and each `{`
  ;; there is another expression (Astro: unless quoted), until the tag
  ;; closes, a stray `<` or another cut abandons it, or the input ends. $tag
  ;; is the packed attribute state at the `{` (see $htmlOpenTag): the value
  ;; an expression gave is complete, and an open quote continues after it.
  (func $braceTagRest (param $tag i32) (param $astro i32)
    (local $quote i32)
    (local $r i32)
    (local $save i32)
    (block $done
      (loop $next
        (local.set $quote (i32.and (i32.shr_u (local.get $tag) (i32.const 8)) (i32.const 255)))
        (local.set $save (global.get $end))
        ;; an Astro quoted `{` is value text, so the next cut lies beyond it
        (global.set $end
          (call $braceNextCut
            (i32.add
              (global.get $ptr)
              (i32.and (local.get $astro) (i32.ne (local.get $quote) (i32.const 0))))))
        (global.set $htmlOpenTag (i32.const 0))
        (local.set $r
          (call $htmlAttrs
            (i32.const 0)
            (local.get $quote)
            (i32.shr_u (local.get $tag) (i32.const 16))
            (i32.add (i32.const 12) (local.get $astro))))
        (global.set $end (local.get $save))
        (call $htmlTagEnd (local.get $r))
        (local.set $tag (global.get $htmlOpenTag))
        (global.set $htmlOpenTag (i32.const 0))
        (br_if $done (i32.eqz (local.get $tag)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "{")))
        (if
          (i32.eqz
            (i32.and (local.get $astro) (i32.ne (i32.and (local.get $tag) (i32.const 0xff00)) (i32.const 0))))
          (then
            (br_if $done
              (i32.eqz (call $braceExpression (global.get $ptr) (local.get $tag) (local.get $astro))))))
        (br $next))))

  ;; The `{` at $ptr: an expression - or, in Astro, value text inside a
  ;; quoted attribute value - and when it sits inside a start tag ($tag
  ;; nonzero) the rest of that tag.
  (func $braceBrace (param $tag i32) (param $astro i32)
    (if (i32.and (local.get $astro) (i32.ne (i32.and (local.get $tag) (i32.const 0xff00)) (i32.const 0)))
      (then
        (call $braceTagRest (local.get $tag) (local.get $astro))
        (return)))
    (if (call $braceExpression (global.get $ptr) (local.get $tag) (local.get $astro))
      (then
        (if (local.get $tag)
          (then (call $braceTagRest (local.get $tag) (local.get $astro)))))))

  ;; Lex from $ptr to $end: html ranges between cuts, each `{` an expression
  ;; (continuing the start tag it interrupted), and script/style elements
  ;; and comments scanned once, opaque to `{` even when their text contains
  ;; braces.
  (func $braceMarkup (param $astro i32)
    (local $from i32)
    (local $p i32)
    (local $tag i32)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $braceNextCut (local.get $from)))
        (global.set $htmlOpenTag (i32.const 0))
        (call $braceHtmlRange (local.get $from) (local.get $p) (local.get $astro))
        (local.set $tag (global.get $htmlOpenTag))
        (global.set $htmlOpenTag (i32.const 0))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
          (then
            (global.set $ptr (local.get $p))
            (call $braceBrace (local.get $tag) (local.get $astro))
            (local.set $from (global.get $ptr))
            (br $scan)))
        (global.set $ptr (local.get $p))
        (if (call $braceRawKind (local.get $p))
          (then (call $htmlTag (i32.add (i32.const 12) (local.get $astro))))
          (else (call $htmlComment (local.get $p))))
        (local.set $from (global.get $ptr))
        (br $scan)))
    (global.set $ptr (global.get $end)))

  ;; Resume stream region 12 + $astro: a start tag whose attributes continue
  ;; past the previous chunk end. Returns 1 when the region consumed the
  ;; whole chunk, 0 when the language lexer should continue from $ptr. An
  ;; ordinary tag stops where the html range would have been cut; a
  ;; script/style tag ($streamA set) never is. A `{` cut inside the tag
  ;; continues it as in the main loop.
  (func $braceStreamResumeTag (param $astro i32) (result i32)
    (local $r i32)
    (local $save i32)
    (local $tag i32)
    (local.set $save (global.get $end))
    (if (i32.eqz (global.get $streamA))
      (then (global.set $end (call $braceNextCut (global.get $ptr)))))
    (global.set $htmlOpenTag (i32.const 0))
    (local.set $r (call $htmlTagResume (i32.add (i32.const 12) (local.get $astro))))
    (global.set $end (local.get $save))
    (local.set $tag (global.get $htmlOpenTag))
    (global.set $htmlOpenTag (i32.const 0))
    (if
      (i32.and
        (i32.ne (local.get $tag) (i32.const 0))
        (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "{"))))
      (then
        (call $braceBrace (local.get $tag) (local.get $astro))
        (local.set $r (i32.ge_u (global.get $ptr) (global.get $end)))))
    (local.get $r))
)
