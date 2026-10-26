(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./record.wat")
  (import "./htmlscan.wat")
  (import "./entity.wat")
  (import "./link.wat")
  (import "./inline.wat")
  (import "./html.wat")
  (import "./ansi.wat")

  (global $mode (mut i32) (i32.const 0))   ;; 0 = html, 1 = ansi
  (global $wrap (mut i32) (i32.const 0))   ;; ansi wrap width, 0 = none
  (global $plain (mut i32) (i32.const 0))  ;; rendering an image's alt text
  (global $rsp (mut i32) (i32.const 0))    ;; render container stack depth
  (global $pendingTask (mut i32) (i32.const 0))
  (global $fnSkip (mut i32) (i32.const 0))

  ;; the render-time container stack reuses the block analysis stack, which is
  ;; finished by now: one byte of type and one of list tightness per level
  (func $rsAt (param $i i32) (result i32)
    (i32.add (i32.const $mem.container) (i32.mul (local.get $i) (i32.const 4))))

  ;; a paragraph is tight when it sits directly inside an item of a tight list
  (func $tightParagraph (result i32)
    (if (i32.lt_u (global.get $rsp) (i32.const 2)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (call $rsAt (i32.sub (global.get $rsp) (i32.const 1))))
          (enum.get $Blk.li))
      (then (return (i32.const 0))))
    (i32.load8_u offset=1 (call $rsAt (i32.sub (global.get $rsp) (i32.const 2)))))

  (func $renderBlocks
    (local $r i32)
    (global.set $rsp (i32.const 0))
    (global.set $plain (i32.const 0))
    (global.set $pendingTask (i32.const 0))
    (global.set $fnSkip (i32.const 0))
    (if (global.get $mode)
      (then
        (global.set $prefixLen (i32.const 0))
        (global.set $prefixCols (i32.const 0))
        (global.set $needBlank (i32.const 0))
        (global.set $atLineStart (i32.const 1))
        (global.set $pendingLen (i32.const 0))
        (global.set $pendingAt (i32.const 0))
        (global.set $markerSgr (i32.const 0))
        (global.set $listDepth (i32.const 0))
        (global.set $ansiCol (i32.const 0))
        (global.set $sgr (i32.const 0))
        (global.set $sgrLive (i32.const 0))
        (i64.store (i32.const $mem.sgr) (i64.const 0))
        (global.set $pendingSpace (i32.const 0))
        (global.set $noWrap (i32.const 0))))
    (local.set $r (global.get $recBase))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $r) (global.get $recEnd)))
        (call $renderBlock (local.get $r))
        (local.set $r (i32.add (local.get $r) (i32.load offset=4 (local.get $r))))
        (br $l)))
    (call $renderFootnotes)
    (if (global.get $mode)
      (then
        (i64.store (i32.const $mem.sgr) (i64.const 0))
        (call $sgrSet (i32.const 0))
        (call $ansiEol))))

  ;; the definitions live where they were written, but render at the end in the
  ;; order they were first referenced
  (func $renderFootnotes
    (local $i i32)
    (local $def i32)
    (local $r i32)
    (local $depth i32)
    (local $t i32)
    (if (i32.eqz (global.get $fnUsed)) (then (return)))
    (if (global.get $mode) (then (call $ansiFootnotesOpen)) (else (call $htmlFootnotesOpen)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (global.get $fnUsed)))
        (local.set $def (i32.load
          (i32.add (global.get $fnOrder) (i32.mul (local.get $i) (i32.const 4)))))
        (if (global.get $mode)
          (then (call $ansiFootnoteOpen (i32.add (local.get $i) (i32.const 1))))
          (else (call $htmlFootnoteOpen (i32.add (local.get $i) (i32.const 1)))))
        (local.set $r (i32.add (local.get $def) (i32.load offset=4 (local.get $def))))
        (local.set $depth (i32.const 1))
        (block $bodyDone
          (loop $body
            (br_if $bodyDone (i32.ge_u (local.get $r) (global.get $recEnd)))
            (local.set $t (i32.load8_u (local.get $r)))
            (if (i32.eq (local.get $t) (enum.get $Blk.footnote))
              (then
                (if (i32.and (i32.load8_u offset=1 (local.get $r)) (i32.const $F.closer))
                  (then
                    (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                    (br_if $bodyDone (i32.eqz (local.get $depth))))
                  (else (local.set $depth (i32.add (local.get $depth) (i32.const 1))))))
              (else (call $renderBlock (local.get $r))))
            (local.set $r (i32.add (local.get $r) (i32.load offset=4 (local.get $r))))
            (br $body)))
        (if (global.get $mode)
          (then (call $ansiFootnoteClose))
          (else (call $htmlFootnoteClose (i32.add (local.get $i) (i32.const 1)) (local.get $def))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (if (i32.eqz (global.get $mode)) (then (call $htmlFootnotesClose))))

  (func $renderBlock (param $r i32)
    (local $t i32)
    (local $flags i32)
    (local.set $t (i32.load8_u (local.get $r)))
    (local.set $flags (i32.load8_u offset=1 (local.get $r)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.none))
          (i32.eq (local.get $t) (enum.get $Blk.linkdef)))
      (then (return)))
    ;; definitions are rendered later, in reference order
    (if (i32.eq (local.get $t) (enum.get $Blk.footnote))
      (then
        (if (i32.and (local.get $flags) (i32.const $F.closer))
          (then (global.set $fnSkip (i32.sub (global.get $fnSkip) (i32.const 1))))
          (else (global.set $fnSkip (i32.add (global.get $fnSkip) (i32.const 1)))))
        (return)))
    (if (global.get $fnSkip) (then (return)))
    (if (i32.and (local.get $flags) (i32.const $F.closer))
      (then
        (if (global.get $rsp)
          (then (global.set $rsp (i32.sub (global.get $rsp) (i32.const 1)))))
        (if (global.get $mode)
          (then (call $ansiBlockClose (local.get $t)))
          (else (call $htmlBlockClose (local.get $t))))
        (return)))
    (if (i32.and (local.get $flags) (i32.const $F.opener))
      (then
        (if (i32.lt_u (global.get $rsp) (i32.const $Nest))
          (then
            (i32.store8 (call $rsAt (global.get $rsp)) (local.get $t))
            (i32.store8 offset=1 (call $rsAt (global.get $rsp))
              (i32.eqz (i32.and (local.get $flags) (i32.const $F.loose))))
            (global.set $rsp (i32.add (global.get $rsp) (i32.const 1)))))
        (if (i32.and (i32.eq (local.get $t) (enum.get $Blk.li))
              (i32.ne (i32.and (local.get $flags) (i32.const $F.task)) (i32.const 0)))
          (then (global.set $pendingTask
            (select (i32.const 2) (i32.const 1)
              (i32.and (local.get $flags) (i32.const $F.taskDone))))))
        (if (global.get $mode)
          (then (call $ansiBlockOpen (local.get $t) (local.get $r)))
          (else (call $htmlBlockOpen (local.get $t) (local.get $r))))
        (return)))
    (if (global.get $mode)
      (then (call $ansiLeaf (local.get $t) (local.get $r)))
      (else (call $htmlLeaf (local.get $t) (local.get $r)))))

  (func $renderInline (param $r i32)
    (drop (call $blockContent (local.get $r)))
    (call $inlineScan)
    (call $walkInlines))

  (func $walkInlines
    (local $i i32)
    (local $p i32)
    (local $next i32)
    (local $m i32)
    (local $markEnd i32)
    (local $textEnd i32)
    (local $markType i32)
    (local $base i32)
    (block $done
      (loop $l
        (block $skipped
          (loop $skip
            (br_if $skipped (i32.ge_u (local.get $i) (global.get $nSlots)))
            (br_if $skipped (i32.ge_u
              (i32.load offset=$M.beg (call $slotAt (local.get $i))) (local.get $p)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $skip)))
        (local.set $next (global.get $contentLen))
        (if (i32.lt_u (local.get $i) (global.get $nSlots))
          (then (local.set $next
            (i32.load offset=$M.beg (call $slotAt (local.get $i))))))
        (if (i32.gt_u (local.get $next) (local.get $p))
          (then
            ;; Text that runs into a break is right-trimmed, keeping a hard
            ;; break's own two spaces out of the output.
            (local.set $textEnd (local.get $next))
            (if (i32.lt_u (local.get $i) (global.get $nSlots))
              (then
                (local.set $markType
                  (i32.load8_u offset=$M.type (call $slotAt (local.get $i))))
                (if (i32.or
                      (i32.eq (local.get $markType) (enum.get $Mk.softbreak))
                      (i32.eq (local.get $markType) (enum.get $Mk.hardbreak)))
                  (then
                    (local.set $base (call $contentAt (i32.const 0)))
                    (local.set $textEnd (i32.sub
                      (call $trimSpaceBack
                        (i32.add (local.get $base) (local.get $next))
                        (local.get $base))
                      (local.get $base)))))))
            (call $rText (local.get $p) (local.get $textEnd))
            (local.set $p (local.get $next))))
        (br_if $done (i32.ge_u (local.get $i) (global.get $nSlots)))
        (local.set $m (call $slotAt (local.get $i)))
        ;; Rendering can grow the output and move scratch, so preserve the end
        ;; before the mark pointer becomes stale.
        (local.set $markEnd (i32.load offset=$M.end (local.get $m)))
        (call $renderMark (local.get $i))
        (local.set $p (local.get $markEnd))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $done (i32.ge_u (local.get $p) (global.get $contentLen)))
        (br $l))))

  (func $renderMark (param $i i32)
    (local $m i32)
    (local $t i32)
    (local $tag i32)
    (local $tagWord i32)
    (local $tagNext i32)
    (local $tail i32)
    (local $b i32)
    (local $e i32)
    (local $kind i32)
    (local $use i32)
    (local $markLen i32)
    (local $rem i32)
    (local $openTag i32)
    (local $base i32)
    (local $q i32)
    (local $first i32)
    (local $last i32)
    (local $close i32)
    (local $image i32)
    (local $def i32)
    (local $n i32)
    (local $k i32)
    (local.set $m (call $slotAt (local.get $i)))
    (local.set $t (i32.load8_u offset=$M.type (local.get $m)))
    (if (i32.eq (local.get $t) (enum.get $Mk.escape))
      (then
        (call $rText (i32.add (i32.load offset=$M.beg (local.get $m)) (i32.const 1))
          (i32.load offset=$M.end (local.get $m)))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.entity))
      (then
        (if (i32.load8_u offset=$M.ch (local.get $m))
          (then (call $rRaw (i32.const $mem.numbuf)
            (call $utf8Encode (i32.const $mem.numbuf) (i32.load offset=$M.data (local.get $m)))))
          (else (call $rRaw (i32.load offset=$M.data (local.get $m))
            (i32.load8_u offset=$M.aux (local.get $m)))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.code))
      (then
        (local.set $b (i32.load offset=$M.data (local.get $m)))
        (local.set $e (i32.sub (i32.load offset=$M.end (local.get $m))
          (i32.sub (local.get $b) (i32.load offset=$M.beg (local.get $m)))))
        (local.set $base (call $contentAt (i32.const 0)))
        ;; Strip one leading and trailing space together unless all content is
        ;; spaces or line breaks.
        (if (i32.ge_u (i32.sub (local.get $e) (local.get $b)) (i32.const 2))
          (then
            (local.set $first (i32.load8_u (i32.add (local.get $base) (local.get $b))))
            (local.set $last (i32.load8_u
              (i32.add (local.get $base) (i32.sub (local.get $e) (i32.const 1)))))
            (if (i32.and
                  (i32.or (i32.eq (local.get $first) (i32.const 32))
                    (i32.eq (local.get $first) (i32.const 10)))
                  (i32.or (i32.eq (local.get $last) (i32.const 32))
                    (i32.eq (local.get $last) (i32.const 10))))
              (then
                (local.set $q (local.get $b))
                (block $spaceScan
                  (loop $spaces
                    (br_if $spaceScan (i32.ge_u (local.get $q) (local.get $e)))
                    (local.set $first
                      (i32.load8_u (call $contentAt (local.get $q))))
                    (if (i32.and (i32.ne (local.get $first) (i32.const 32))
                          (i32.ne (local.get $first) (i32.const 10)))
                      (then
                        (local.set $b (i32.add (local.get $b) (i32.const 1)))
                        (local.set $e (i32.sub (local.get $e) (i32.const 1)))
                        (br $spaceScan)))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $spaces)))))))
        (if (i32.and (global.get $mode) (i32.eqz (global.get $plain)))
          (then (call $sgrOn (i32.const $S.code))))
        (if (i32.and (i32.eqz (global.get $mode)) (i32.eqz (global.get $plain)))
          (then (out.str "<code>")))
        (block $codeDone
          (loop $codeLine
            (br_if $codeDone (i32.ge_u (local.get $b) (local.get $e)))
            (local.set $base (call $contentAt (i32.const 0)))
            (local.set $q (i32.sub (call $findByte
              (i32.add (local.get $base) (local.get $b))
              (i32.add (local.get $base) (local.get $e)) (i32.const 10))
              (local.get $base)))
            (call $rText (local.get $b) (local.get $q))
            (if (i32.lt_u (local.get $q) (local.get $e))
              (then (call $outByte (i32.const 32))))
            (local.set $b (i32.add (local.get $q) (i32.const 1)))
            (br $codeLine)))
        (if (i32.and (global.get $mode) (i32.eqz (global.get $plain)))
          (then (call $sgrOff (i32.const $S.code))))
        (if (i32.and (i32.eqz (global.get $mode)) (i32.eqz (global.get $plain)))
          (then (out.str "</code>")))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.autolink))
      (then
        (local.set $b (i32.load offset=$M.beg (local.get $m)))
        (local.set $e (i32.load offset=$M.end (local.get $m)))
        (local.set $kind (i32.load offset=$M.data (local.get $m)))
        (if (global.get $plain)
          (then
            (call $rText (i32.add (local.get $b) (i32.const 1))
              (i32.sub (local.get $e) (i32.const 1)))
            (return)))
        (global.set $linkInContent (i32.const 1))
        (global.set $linkUrlBeg (i32.add (local.get $b) (i32.const 1)))
        (global.set $linkUrlEnd (i32.sub (local.get $e) (i32.const 1)))
        (if (global.get $mode)
          (then (call $ansiAutolink))
          (else (call $htmlAutolink (local.get $kind))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.footnote))
      (then
        (local.set $def (i32.load offset=$M.data (local.get $m)))
        (local.set $n (i32.load offset=8 (local.get $def)))
        (if (i32.eqz (local.get $n))
          (then
            (if (i32.lt_u (global.get $fnUsed) (global.get $fnTotal))
              (then
                (global.set $fnUsed (i32.add (global.get $fnUsed) (i32.const 1)))
                (local.set $n (global.get $fnUsed))
                (i32.store offset=8 (local.get $def) (local.get $n))
                (i32.store (i32.add (global.get $fnOrder)
                  (i32.mul (i32.sub (local.get $n) (i32.const 1)) (i32.const 4)))
                  (local.get $def))))))
        (if (i32.eqz (local.get $n)) (then (return)))
        (local.set $k (i32.add (i32.load offset=12 (local.get $def)) (i32.const 1)))
        (i32.store offset=12 (local.get $def) (local.get $k))
        (if (global.get $plain) (then (return)))
        (if (global.get $mode)
          (then
            (call $ansiFlushSpace)
            (call $sgrOn (i32.const $S.link))
            (call $outByte (i32.const "["))
            (call $outNum (local.get $n))
            (call $outByte (i32.const "]"))
            (call $sgrOff (i32.const $S.link))
            (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 3))))
          (else (call $htmlFootnoteRef (local.get $n) (local.get $k))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.extlink))
      (then
        (local.set $b (i32.load offset=$M.beg (local.get $m)))
        (local.set $e (i32.load offset=$M.end (local.get $m)))
        (local.set $kind (i32.load offset=$M.data (local.get $m)))
        (if (global.get $plain)
          (then (call $rText (local.get $b) (local.get $e)) (return)))
        (global.set $linkInContent (i32.const 1))
        (global.set $linkUrlBeg (local.get $b))
        (global.set $linkUrlEnd (local.get $e))
        (if (global.get $mode)
          (then (call $ansiAutolink))
          (else (call $htmlExtLink (local.get $kind))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.rawhtml))
      (then
        (local.set $b (i32.load offset=$M.beg (local.get $m)))
        (local.set $e (i32.load offset=$M.end (local.get $m)))
        (if (global.get $plain)
          (then (call $rText (local.get $b) (local.get $e)) (return)))
        (if (global.get $mode) (then (return)))
        (call $ensureOut (i32.add
          (i32.mul (i32.sub (local.get $e) (local.get $b)) (i32.const 4)) (i32.const 64)))
        (call $htmlFiltered2
          (call $contentAt (local.get $b))
          (call $contentAt (local.get $e)) (i32.const 0))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.softbreak))
      (then
        (if (global.get $plain)
          (then (call $outByte (i32.const 32)))
          (else
            (if (global.get $mode)
              (then
                (if (global.get $wrap)
                  (then (call $ansiRawSpace))
                  (else (call $ansiEol))))
              (else (call $outByte (i32.const 10))))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.hardbreak))
      (then
        (if (global.get $plain)
          (then (call $outByte (i32.const 32)))
          (else
            (if (global.get $mode)
              (then (call $ansiEol))
              (else (out.str "<br />\n")))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.bracket))
      (then
        (call $rText (i32.load offset=$M.beg (local.get $m))
          (i32.load offset=$M.end (local.get $m)))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.linkopen))
      (then
        (local.set $close (i32.load offset=$M.data (local.get $m)))
        (local.set $image (i32.and
          (i32.load8_u offset=$M.flags (call $slotAt (local.get $close)))
          (i32.const $MF.image)))
        (if (i32.eqz (global.get $plain))
          (then
            (call $linkParts (local.get $close))
            (if (global.get $mode)
              (then (call $sgrOn
                (select (i32.const $S.dim) (i32.const $S.linkText) (local.get $image))))
              (else (call $htmlLinkOpen (local.get $image))))))
        (if (local.get $image)
          (then (global.set $plain (i32.add (global.get $plain) (i32.const 1)))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Mk.linkclose))
      (then
        (local.set $image (i32.and
          (i32.load8_u offset=$M.flags (local.get $m)) (i32.const $MF.image)))
        (if (local.get $image)
          (then (global.set $plain (i32.sub (global.get $plain) (i32.const 1)))))
        (if (i32.eqz (global.get $plain))
          (then
            (call $linkParts (local.get $i))
            (if (global.get $mode)
              (then
                (if (local.get $image)
                  (then (call $sgrOff (i32.const $S.dim)))
                  (else (call $sgrOff (i32.const $S.linkText))))
                (call $sgrOn (i32.const $S.dim))
                (call $ansiRawSpace)
                (call $outByte (i32.const "("))
                (call $ansiRaw (global.get $linkUrlBeg) (global.get $linkUrlEnd)
                  (global.get $linkInContent))
                (call $outByte (i32.const ")"))
                (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 2)))
                (call $sgrOff (i32.const $S.dim)))
              (else (call $htmlLinkClose (local.get $image))))))
        (return)))
    ;; An emphasis delimiter run: closing tags, leftover text, then opening tags.
    ;; Emitting can move scratch, so load every mark field first.
    (local.set $tail (i32.load offset=$M.closeTail (local.get $m)))
    (local.set $b (i32.load offset=$M.beg (local.get $m)))
    (local.set $markLen
      (i32.sub (i32.load offset=$M.end (local.get $m)) (local.get $b)))
    (local.set $rem (i32.load offset=$M.rem (local.get $m)))
    (local.set $openTag (i32.load offset=$M.openHead (local.get $m)))
    (if (local.get $tail)
      (then
        (local.set $tag (i32.and
          (i32.load (call $tagAt (local.get $tail))) (i32.const $T.nextMask)))
        (block $closed
          (loop $l
            (local.set $tagWord (i32.load (call $tagAt (local.get $tag))))
            (local.set $kind (i32.and (local.get $tagWord) (i32.const $T.kindMask)))
            (local.set $tagNext (i32.and (local.get $tagWord) (i32.const $T.nextMask)))
            (local.set $use (select (i32.const 1)
              (select (i32.const 2) (local.get $markLen)
                (i32.eq (local.get $kind) (i32.const $T.strong)))
              (i32.eq (local.get $kind) (i32.const $T.em))))
            (local.set $b (i32.add (local.get $b) (local.get $use)))
            (if (i32.eqz (global.get $plain))
              (then
                (if (global.get $mode)
                  (then (call $sgrOff (select (i32.const $S.italic)
                    (select (i32.const $S.bold) (i32.const $S.strike)
                      (i32.eq (local.get $kind) (i32.const $T.strong)))
                    (i32.eq (local.get $kind) (i32.const $T.em)))))
                  (else
                    (if (i32.eq (local.get $kind) (i32.const $T.em))
                      (then (out.str "</em>"))
                      (else
                        (if (i32.eq (local.get $kind) (i32.const $T.strong))
                          (then (out.str "</strong>"))
                          (else (out.str "</del>")))))))))
            (br_if $closed (i32.eq (local.get $tag) (local.get $tail)))
            (local.set $tag (local.get $tagNext))
            (br $l)))))
    ;; leftover delimiters sit after the closer-consumed prefix; rem is their count
    (call $rText (local.get $b) (i32.add (local.get $b) (local.get $rem)))
    (local.set $tag (local.get $openTag))
    (block $opened
      (loop $l
        (br_if $opened (i32.eqz (local.get $tag)))
        (local.set $tagWord (i32.load (call $tagAt (local.get $tag))))
        (local.set $kind (i32.and (local.get $tagWord) (i32.const $T.kindMask)))
        (local.set $tag (i32.and (local.get $tagWord) (i32.const $T.nextMask)))
        (if (i32.eqz (global.get $plain))
          (then
            (if (global.get $mode)
              (then (call $sgrOn (select (i32.const $S.italic)
                (select (i32.const $S.bold) (i32.const $S.strike)
                  (i32.eq (local.get $kind) (i32.const $T.strong)))
                (i32.eq (local.get $kind) (i32.const $T.em)))))
              (else
                (if (i32.eq (local.get $kind) (i32.const $T.em))
                  (then (out.str "<em>"))
                  (else
                    (if (i32.eq (local.get $kind) (i32.const $T.strong))
                      (then (out.str "<strong>"))
                      (else (out.str "<del>")))))))))
        (br $l))))

  ;; $b and $e are offsets into the current content. Resolve them only after
  ;; reserving output, because copied content can move with scratch.
  (func $rText (param $b i32) (param $e i32)
    (if (i32.ge_u (local.get $b) (local.get $e)) (then (return)))
    (if (global.get $mode)
      (then (call $ansiRaw (local.get $b) (local.get $e) (i32.const 1)))
      (else
        (call $ensureOut
          (i32.mul (i32.sub (local.get $e) (local.get $b)) (i32.const 6)))
        (call $outTextReserved
          (call $contentAt (local.get $b))
          (call $contentAt (local.get $e))))))

  ;; text that is already decoded and lives outside the content buffer
  (func $rRaw (param $p i32) (param $len i32)
    (if (global.get $mode)
      (then (call $ansiRaw (local.get $p) (i32.add (local.get $p) (local.get $len)) (i32.const 0)))
      (else (call $outText (local.get $p) (i32.add (local.get $p) (local.get $len))))))

  ;; write [$p,$e) percent-encoded. Bit 0 of $flags decodes entity references,
  ;; bit 1 removes backslash escapes, matching what each link form cleans.
  (func $outHref (param $p i32) (param $e i32) (param $flags i32)
    (local $c i32)
    (local $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "&"))
              (i32.ne (i32.and (local.get $flags) (i32.const 1)) (i32.const 0)))
          (then
            (local.set $n (call $entityMatch (local.get $p) (local.get $e)))
            (if (local.get $n)
              (then
                (call $outHref (global.get $entVal)
                  (i32.add (global.get $entVal) (global.get $entLen)) (i32.const 0))
                (local.set $p (i32.add (local.get $p) (local.get $n)))
                (br $l)))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
              (i32.ne (i32.and (local.get $flags) (i32.const 2)) (i32.const 0)))
          (then
            (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $e))
                  (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $c (i32.load8_u (local.get $p)))))))
        ;; Houdini's href-safe ASCII, two 64-bit masks for 0..63 and 64..127.
        ;; The caller reserved the complete URL, so this never grows output.
        (if (i32.and (i32.lt_u (local.get $c) (i32.const 128))
              (i32.wrap_i64 (i64.and (i64.const 1)
                (i64.shr_u
                  (select (i64.const 0xafffff3a00000000) (i64.const 0x47fffffe87ffffff)
                    (i32.lt_u (local.get $c) (i32.const 64)))
                  (i64.extend_i32_u (i32.and (local.get $c) (i32.const 63)))))))
          (then
            (i32.store8 (global.get $out) (local.get $c))
            (global.set $out (i32.add (global.get $out) (i32.const 1))))
          (else
            (if (i32.eq (local.get $c) (i32.const "&"))
              (then
                (i64.store (global.get $out) (i64.const "&amp;"))
                (global.set $out (i32.add (global.get $out) (i32.const 5))))
              (else
                (if (i32.eq (local.get $c) (i32.const "'"))
                  (then
                    (i64.store (global.get $out) (i64.const "&#x27;"))
                    (global.set $out (i32.add (global.get $out) (i32.const 6))))
                  (else
                    (i32.store8 (global.get $out) (i32.const "%"))
                    (i32.store8 offset=1 (global.get $out)
                      (i32.load8_u offset=$mem.hexdigits
                        (i32.shr_u (local.get $c) (i32.const 4))))
                    (i32.store8 offset=2 (global.get $out)
                      (i32.load8_u offset=$mem.hexdigits
                        (i32.and (local.get $c) (i32.const 15))))
                    (global.set $out (i32.add (global.get $out) (i32.const 3)))))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l))))

  (data (i32.const $mem.hexdigits) "0123456789ABCDEF")

  ;; write [$p,$e) as escaped text, cleaning it the same way $outHref does
  (func $outCleanText (param $p i32) (param $e i32) (param $flags i32)
    (local $c i32)
    (local $n i32)
    (local $seg i32)
    (local.set $seg (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "&"))
              (i32.ne (i32.and (local.get $flags) (i32.const 1)) (i32.const 0)))
          (then
            (local.set $n (call $entityMatch (local.get $p) (local.get $e)))
            (if (local.get $n)
              (then
                (call $outTextReserved (local.get $seg) (local.get $p))
                (call $outTextReserved (global.get $entVal)
                  (i32.add (global.get $entVal) (global.get $entLen)))
                (local.set $p (i32.add (local.get $p) (local.get $n)))
                (local.set $seg (local.get $p))
                (br $l)))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
              (i32.ne (i32.and (local.get $flags) (i32.const 2)) (i32.const 0)))
          (then
            (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $e))
                  (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
              (then
                (call $outTextReserved (local.get $seg) (local.get $p))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $seg (local.get $p))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (call $outTextReserved (local.get $seg) (local.get $e)))

  ;; the url and title of a resolved link, as absolute byte ranges
  (global $linkUrlBeg (mut i32) (i32.const 0))
  (global $linkUrlEnd (mut i32) (i32.const 0))
  (global $linkTitleBeg (mut i32) (i32.const 0))
  (global $linkTitleEnd (mut i32) (i32.const 0))
  (global $linkInContent (mut i32) (i32.const 0))
  (global $linkPending (mut i32) (i32.const 0))

  ;; resolve inline link offsets against the current content base
  (func $linkUrl (result i32)
    (i32.add (select (call $contentAt (i32.const 0)) (i32.const 0) (global.get $linkInContent))
      (global.get $linkUrlBeg)))

  (func $linkUrlTo (result i32)
    (i32.add (select (call $contentAt (i32.const 0)) (i32.const 0) (global.get $linkInContent))
      (global.get $linkUrlEnd)))

  (func $linkTitle (result i32)
    (i32.add (select (call $contentAt (i32.const 0)) (i32.const 0) (global.get $linkInContent))
      (global.get $linkTitleBeg)))

  (func $linkTitleTo (result i32)
    (i32.add (select (call $contentAt (i32.const 0)) (i32.const 0) (global.get $linkInContent))
      (global.get $linkTitleEnd)))

  (func $linkUrlLen (result i32)
    (i32.sub (global.get $linkUrlEnd) (global.get $linkUrlBeg)))

  (func $linkTitleLen (result i32)
    (i32.sub (global.get $linkTitleEnd) (global.get $linkTitleBeg)))

  (func $linkParts (param $closeMark i32)
    (local $close i32)
    (local $def i32)
    (local $base i32)
    (local.set $close (call $slotAt (local.get $closeMark)))
    (global.set $linkPending
      (i32.and (i32.load8_u offset=$M.flags (local.get $close)) (i32.const $LF.pending)))
    (local.set $def (i32.load offset=$L.def (local.get $close)))
    (global.set $linkInContent (i32.eqz (local.get $def)))
    (if (local.get $def)
      (then
        (local.set $base (i32.add (i32.add (local.get $def) (i32.const $R.labelBytes))
          (i32.load offset=$R.labelLen (local.get $def))))
        (global.set $linkUrlBeg (local.get $base))
        (global.set $linkUrlEnd (i32.add (local.get $base) (i32.load offset=8 (local.get $def))))
        (global.set $linkTitleBeg (global.get $linkUrlEnd))
        (global.set $linkTitleEnd
          (i32.add (global.get $linkTitleBeg) (i32.load offset=12 (local.get $def)))))
      (else
        (global.set $linkUrlBeg (i32.load offset=$L.urlBeg (local.get $close)))
        (global.set $linkUrlEnd (i32.load offset=$L.urlEnd (local.get $close)))
        (global.set $linkTitleBeg (i32.load offset=$L.titleBeg (local.get $close)))
        (global.set $linkTitleEnd (select
          (i32.load offset=$L.titleEnd (local.get $close))
          (global.get $linkTitleBeg)
          (i32.and (i32.load8_u offset=$M.flags (local.get $close))
            (i32.const $LF.hasTitle)))))))

  (func $renderCell (param $beg i32) (param $end i32)
    (local $dst i32)
    (local $n i32)
    (local $c i32)
    ;; Copy the cell into scratch, trimming it and unescaping `\|`.
    (global.set $scratchUsed (i32.const 0))
    (global.set $scratchTailUsed (i32.const 0))
    (local.set $beg (call $skipSpace (local.get $beg) (local.get $end)))
    (local.set $end (call $trimSpaceBack (local.get $end) (local.get $beg)))
    (global.set $contentInputEnd (local.get $end))
    (call $ensureScratch (i32.add (i32.sub (local.get $end) (local.get $beg)) (i32.const 64)))
    (local.set $dst (global.get $scratchBase))
    (global.set $contentBase (local.get $dst))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $beg) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $beg)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
              (i32.lt_u (i32.add (local.get $beg) (i32.const 1)) (local.get $end)))
          (then
            (if (i32.eq (i32.load8_u offset=1 (local.get $beg)) (i32.const "|"))
              (then
                (i32.store8 (i32.add (local.get $dst) (local.get $n)) (i32.const "|"))
                (local.set $n (i32.add (local.get $n) (i32.const 1)))
                (local.set $beg (i32.add (local.get $beg) (i32.const 2)))
                (br $l)))))
        (i32.store8 (i32.add (local.get $dst) (local.get $n)) (local.get $c))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (local.set $beg (i32.add (local.get $beg) (i32.const 1)))
        (br $l)))
    (memory.fill (i32.add (local.get $dst) (local.get $n)) (i32.const 0) (i32.const 32))
    (global.set $contentLen (local.get $n))
    (global.set $scratchUsed (i32.add (local.get $n) (i32.const 32)))
    (call $inlineScan)
    (call $walkInlines))

  ;; Current cell range and the cursor immediately after it.
  (global $cellBeg (mut i32) (i32.const 0))
  (global $cellEnd (mut i32) (i32.const 0))
  (global $cellNext (mut i32) (i32.const 0))

  ;; Scan one cell at $p and leave the cursor for the next cell in $cellNext.
  ;; Callers skip an optional leading pipe once before entering their row loop.
  (func $cellRange (param $p i32) (param $end i32) (result i32)
    (local $start i32)
    (local $c i32)
    (local $pipe i32)
    (global.set $cellNext (local.get $end))
    (block $done
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (local.set $start (local.get $p))
      (block $cellDone
        (loop $byte
          (br_if $cellDone (i32.ge_u (local.get $p) (local.get $end)))
          (local.set $c (i32.load8_u (local.get $p)))
          (if (i32.eq (local.get $c) (i32.const "\5c"))
            (then
              (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                    (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 2)))
                  (br $byte)))))
          (br_if $cellDone (i32.eq (local.get $c) (i32.const "|")))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (br $byte)))
      (global.set $cellBeg (local.get $start))
      (global.set $cellEnd (local.get $p))
      (if (i32.lt_u (local.get $p) (local.get $end))
        (then
          (local.set $pipe (i32.const 1))
          (global.set $cellNext
            (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))
      (if (i32.or (i32.gt_u (local.get $p) (local.get $start)) (local.get $pipe))
        (then (return (i32.const 1)))))
    (global.set $cellBeg (i32.const 0))
    (global.set $cellEnd (i32.const 0))
    (i32.const 0))
)
