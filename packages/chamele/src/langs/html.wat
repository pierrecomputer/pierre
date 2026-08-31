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
        (if (i64.eq
              (i64.or (i64.and (i64.load (local.get $lhs)) (i64.const 0xFFFFFFFFFFFF))
                      (i64.const 0x202020202020))
              (i64.const "script"))
          (then (return (i32.const 1))))))
    (if (i32.eq (local.get $len) (i32.const 5))
      (then
        (if (i64.eq
              (i64.or (i64.and (i64.load (local.get $lhs)) (i64.const 0xFFFFFFFFFF))
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
        (if (i64.ne
              (i64.or (i64.and (i64.load offset=1 (local.get $p)) (i64.const 0x00FFFFFFFFFFFFFF))
                      (i64.const 0x0020202020202000))
              (i64.const "/script"))
          (then (return (i32.const 0))))
        (local.set $tp (i32.add (local.get $p) (i32.const 8))))
      (else
        (if (i32.gt_u (i32.add (local.get $p) (i32.const 7)) (global.get $end))
          (then (return (i32.const 0))))
        ;; bytes p+1..p+6 = "/style" (letters folded)
        (if (i64.ne
              (i64.or (i64.and (i64.load offset=1 (local.get $p)) (i64.const 0xFFFFFFFFFFFF))
                      (i64.const 0x202020202000))
              (i64.const "/style"))
          (then (return (i32.const 0))))
        (local.set $tp (i32.add (local.get $p) (i32.const 7)))))
    ;; the close-tag name must end here: whitespace, `>`, `/`, or input end
    (if (i32.ge_u (local.get $tp) (global.get $end)) (then (return (i32.const 1))))
    (local.set $t (i32.load8_u (local.get $tp)))
    (i32.or
      (i32.or (i32.eq (local.get $t) (i32.const ">")) (i32.eq (local.get $t) (i32.const "/")))
      (i32.or (i32.eq (local.get $t) (i32.const 32))
              (i32.le_u (i32.sub (local.get $t) (i32.const 9)) (i32.const 4)))))

  ;; scan a character reference at `&`; emits it as string.escape and returns 1,
  ;; or returns 0 leaving $ptr on the `&`
  (func $htmlEntity (result i32)
    (local $q i32)
    (local $c i32)
    (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
    (if (i32.and (i32.lt_u (local.get $q) (global.get $end))
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
          (br_if $ok (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
          (br $stop))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    ;; need at least one name character and a closing `;`
    (if (i32.or
          (i32.le_u (i32.sub (local.get $q) (global.get $ptr))
            (select (i32.const 2) (i32.const 1)
              (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const "#"))))
          (i32.or (i32.ge_u (local.get $q) (global.get $end))
                  (i32.ne (i32.load8_u (local.get $q)) (i32.const ";"))))
      (then (return (i32.const 0))))
    (call $emitTok (enum.get $Token.string.special) (global.get $ptr)
      (i32.add (local.get $q) (i32.const 1)))
    (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
    (i32.const 1))

  ;; `<!--` comment: advance past `-->` (or to $end) and emit the whole token.
  ;; The close scan, the spec's abrupt-closing rule (`<!-->` and `<!--->` are
  ;; complete comments), and the streaming checkpoint are byte-identical to an
  ;; XML comment section, so delegate.
  (func $htmlComment (param $lhs i32)
    (call $xmlSection
      (local.get $lhs) (i32.const 4) (i32.const 1) (enum.get $Token.comment)))

  ;; `<!...>` / `<?...>` declaration: advance past `>` (or to $end)
  (func $htmlDecl
    (local $p i32)
    (local.set $p (call $lexFindByte (global.get $ptr) (i32.const ">")))
    (global.set $ptr (select
      (i32.add (local.get $p) (i32.const 1)) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end)))))

  ;; tag / attribute name: `<` excluded so a stray tag start ends the run
  (func $htmlNameEnd (param $q i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $q) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $done (i32.eq (local.get $c) (i32.const 32)))
        (br_if $done (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
        (br_if $done (i32.eq (local.get $c) (i32.const "=")))
        (br_if $done (i32.eq (local.get $c) (i32.const ">")))
        (br_if $done (i32.eq (local.get $c) (i32.const "/")))
        (br_if $done (i32.eq (local.get $c) (i32.const "<")))
        (br_if $done (i32.eq (local.get $c) (i32.const 34)))
        (br_if $done (i32.eq (local.get $c) (i32.const 39)))
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
        (br_if $done (i32.eq (local.get $c) (i32.const 32)))
        (br_if $done (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
        (br_if $done (i32.eq (local.get $c) (i32.const ">")))
        (br_if $done (i32.eq (local.get $c) (i32.const "<")))
        (br_if $done (i32.eq (local.get $c) (i32.const 34)))
        (br_if $done (i32.eq (local.get $c) (i32.const 39)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (local.get $q))

  ;; quoted attribute value starting at the quote
  (func $htmlQuoted (param $quote i32)
    (local $lhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (call $lexFindByte
      (i32.add (global.get $ptr) (i32.const 1)) (local.get $quote)))
    (global.set $ptr (select
      (i32.add (local.get $p) (i32.const 1)) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))

  ;; attributes after a tag name until `>` / `/>`; returns 1 when the tag was
  ;; closed by a plain `>`, 2 for `/>` (0 for a stray `<` or input end)
  (func $htmlAttrs (result i32)
    (local $c i32)
    (local $lhs i32)
    (local $afterEq i32)
    (block $done (result i32)
      (loop $next
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then (br $done (i32.const 0))))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $lhs (global.get $ptr))
        ;; whitespace gap
        (if (i32.or (i32.eq (local.get $c) (i32.const 32))
                    (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done (i32.const 1))))
        ;; the value right after `=`: quoted, or an unquoted run (which may
        ;; contain `/` and `=`, so this comes before those branches)
        (if (local.get $afterEq)
          (then
            (local.set $afterEq (i32.const 0))
            (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (then
                (call $htmlQuoted (local.get $c))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then (br $done (i32.const 0)))) ;; stray tag start: reparse in TEXT mode
            (global.set $ptr (call $htmlValueEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            ;; `/>` or a stray slash
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                         (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                (br $done (i32.const 2))))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (global.get $ptr))
            (local.set $afterEq (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $htmlQuoted (local.get $c))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then (br $done (i32.const 0)))) ;; stray tag start: reparse in TEXT mode
        ;; attribute name (values were consumed by the $afterEq branch above);
        ;; every byte $htmlNameEnd refuses was taken by a branch above, so the
        ;; name is never empty
        (global.set $ptr (call $htmlNameEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
        (br $next))
      (unreachable)))

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
    (local.set $continued (i32.and
      (global.get $streaming) (i32.eq (local.get $to) (local.get $save))))
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
        (call $hlCss)
        (if (local.get $continued)
          (then
            (global.set $streamDepth (i32.const 1))
            (global.set $streamReset (i32.const 0))))))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to))
    (if (local.get $continued)
      (then (global.set $streamRegionStarted (i32.const 1)))))

  (func $hlHtml
    (local $c i32)
    (local $lhs i32)
    (local $q i32)
    (local $kind i32)
    (local $textFrom i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; text run: everything up to the next `<` or `&`
        (local.set $textFrom (global.get $ptr))
        (global.set $ptr (call $lexFindEither
          (global.get $ptr) (i32.const "<") (i32.const "&")))
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
        (local.set $c (select (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        ;; `<!--` / `<!...>` / `<?...>`
        (if (i32.eq (local.get $c) (i32.const "!"))
          (then
            (if (i32.and
                  (i32.le_u (i32.add (global.get $ptr) (i32.const 4)) (global.get $end))
                  (i32.eq (i32.load (global.get $ptr)) (i32.const "<!--")))
              (then (call $htmlComment (local.get $lhs)))
              (else
                (call $htmlDecl)
                (call $emitTok (enum.get $Token.tag.doctype) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "?"))
          (then
            (call $htmlDecl)
            (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; `</name ... >`
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (local.set $q (call $htmlNameEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.tag) (global.get $ptr) (local.get $q))
            (global.set $ptr (local.get $q))
            (drop (call $htmlAttrs))
            (br $next)))

        ;; `<name`: an open tag only when a name really starts here
        (if (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.ge_u (local.get $c) (i32.const 128))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (local.set $q (call $htmlNameEnd (global.get $ptr)))
            (local.set $kind (call $rawTextKind (global.get $ptr) (local.get $q)))
            (call $emitTok (enum.get $Token.tag) (global.get $ptr) (local.get $q))
            (global.set $ptr (local.get $q))
            ;; raw-text bodies after a completed open tag; `/>` counts too -
            ;; real html ignores the slash on script/style, so does the browser
            (if (i32.and (i32.ne (call $htmlAttrs) (i32.const 0))
                         (i32.ne (local.get $kind) (i32.const 0)))
              (then (call $htmlRawText (local.get $kind))))
            (br $next)))

        ;; a lone `<`: plain text
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
