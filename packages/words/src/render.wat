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
  (global $singleLineContent (mut i32) (i32.const 0))

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
        (global.set $noWrap (i32.const 0))
        (global.set $prefixSkip (i32.const 0))
        (global.set $brkOut (i32.const 0))
        (global.set $fnRefEnd (i32.const 0))))
    (local.set $r (global.get $recBase))
    (block $done
      (loop $l
        (if (i32.eq (local.get $r) (global.get $boundaryRec))
          (then (global.set $boundaryOut (global.get $out))))
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
        ;; a task box never outlives its item
        (if (i32.eq (local.get $t) (enum.get $Blk.li))
          (then (global.set $pendingTask (i32.const 0))))
        (if (global.get $mode)
          (then (call $ansiBlockClose (local.get $t)))
          (else (call $htmlBlockClose (local.get $t))))
        (return)))
    (if (i32.and (local.get $flags) (i32.const $F.opener))
      (then
        (if (i32.lt_u (global.get $rsp) (i32.const $Nest))
          (then
            (i32.store16 (call $rsAt (global.get $rsp)) (i32.or (local.get $t)
              (i32.shl (i32.eqz (i32.and (local.get $flags) (i32.const $F.loose))) (i32.const 8))))
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
    ;; Resolve the proven literal range after reservation: rebuilt content may
    ;; move even though ordinary root paragraphs usually alias immutable input.
    (if (i32.and (i32.eqz (global.get $mode))
          (i32.ne (i32.and (i32.load8_u offset=1 (local.get $r))
            (i32.const $F.plainInline)) (i32.const 0)))
      (then
        (call $ensureOut (global.get $contentLen))
        (global.set $out (call $copyAt (global.get $out) (global.get $contentBase)
          (global.get $contentLen)))
        (return)))
    (global.set $singleLineContent (i32.and
      (i32.eq (i32.load offset=$R.nLines (local.get $r)) (i32.const 1))
      (i32.eqz (i32.and (i32.load8_u offset=1 (local.get $r))
        (i32.const $F.joinedLines)))))
    (call $inlineScan)
    (call $walkInlines))

  ;; Emit an emphasis tag into an already-reserved HTML run without touching
  ;; the global cursor or checking capacity for each fragment. Tags are
  ;; written branch-free: a whole word, then a nibble table of lengths indexed
  ;; by kind (em, strong, del for 1, 2, 3).
  (func $htmlEmphCloseAt (param $dst i32) (param $kind i32) (result i32)
    (i64.store (local.get $dst) (select (i64.const "</em>")
      (select (i64.const "</strong") (i64.const "</del>")
        (i32.eq (local.get $kind) (i32.const $T.strong)))
      (i32.eq (local.get $kind) (i32.const $T.em))))
    (i32.store8 offset=8 (local.get $dst) (i32.const ">"))
    (i32.add (local.get $dst) (i32.and (i32.shr_u (i32.const 0x6950)
      (i32.shl (local.get $kind) (i32.const 2))) (i32.const 15))))

  (func $htmlEmphOpenAt (param $dst i32) (param $kind i32) (result i32)
    (i64.store (local.get $dst) (select (i64.const "<em>")
      (select (i64.const "<strong>") (i64.const "<del>")
        (i32.eq (local.get $kind) (i32.const $T.strong)))
      (i32.eq (local.get $kind) (i32.const $T.em))))
    (i32.add (local.get $dst) (i32.and (i32.shr_u (i32.const 0x5840)
      (i32.shl (local.get $kind) (i32.const 2))) (i32.const 15))))

  ;; Batch safe literal gaps and consecutive emphasis marks within at most 256
  ;; source bytes. Six output bytes per source byte cover every emphasis tag.
  ;; Reserve before resolving scratch pointers, then keep the cursor local;
  ;; other mark kinds and image labels stay on the general rendering path.
  ;; Return the next slot in the low word and source offset in the high word.
  (func $htmlEmphasisRun (param $i i32) (param $p i32) (result i64)
    (local $limit i32)
    (local $n i32)
    (local $dst i32)
    (local $base i32)
    (local $m i32)
    (local $beg i32)
    (local $end i32)
    (local $tag i32)
    (local $tail i32)
    (local $word i32)
    (local.set $n (i32.sub (global.get $contentLen) (local.get $p)))
    (if (i32.gt_u (local.get $n) (i32.const 256))
      (then (local.set $n (i32.const 256))))
    (local.set $limit (i32.add (local.get $p) (local.get $n)))
    (call $ensureOut (i32.mul (local.get $n) (i32.const 6)))
    (local.set $dst (global.get $out))
    (local.set $base (global.get $contentBase))
    (block $done
      (loop $marks
        (br_if $done (i32.ge_u (local.get $i) (global.get $nSlots)))
        (local.set $m (call $slotAt (local.get $i)))
        (local.set $beg (i32.load offset=$M.beg (local.get $m)))
        (if (i32.lt_u (local.get $beg) (local.get $p))
          (then
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $marks)))
        (br_if $done (i32.ne (i32.load8_u offset=$M.type (local.get $m)) (enum.get $Mk.emph)))
        (local.set $end (i32.load offset=$M.end (local.get $m)))
        (br_if $done (i32.gt_u (local.get $end) (local.get $limit)))
        (local.set $dst (call $copyAt (local.get $dst)
          (i32.add (local.get $base) (local.get $p)) (i32.sub (local.get $beg) (local.get $p))))
        (local.set $tail (i32.load offset=$M.closeTail (local.get $m)))
        (if (local.get $tail)
          (then
            (local.set $tag (i32.and (i32.load (call $tagAt (local.get $tail)))
              (i32.const $T.nextMask)))
            (block $closed
              (loop $closing
                (local.set $word (i32.load (call $tagAt (local.get $tag))))
                (local.set $dst (call $htmlEmphCloseAt (local.get $dst)
                  (i32.and (local.get $word) (i32.const $T.kindMask))))
                (br_if $closed (i32.eq (local.get $tag) (local.get $tail)))
                (local.set $tag (i32.and (local.get $word) (i32.const $T.nextMask)))
                (br $closing)))))
        ;; leftover delimiters: one vector covers the usual short run
        (local.set $n (i32.load offset=$M.rem (local.get $m)))
        (v128.store (local.get $dst) (i8x16.splat (i32.load8_u offset=$M.ch (local.get $m))))
        (if (i32.gt_u (local.get $n) (i32.const 16))
          (then (memory.fill (local.get $dst) (i32.load8_u offset=$M.ch (local.get $m)) (local.get $n))))
        (local.set $dst (i32.add (local.get $dst) (local.get $n)))
        (local.set $tag (i32.load offset=$M.openHead (local.get $m)))
        (block $opened
          (loop $opening
            (br_if $opened (i32.eqz (local.get $tag)))
            (local.set $word (i32.load (call $tagAt (local.get $tag))))
            (local.set $dst (call $htmlEmphOpenAt (local.get $dst)
              (i32.and (local.get $word) (i32.const $T.kindMask))))
            (local.set $tag (i32.and (local.get $word) (i32.const $T.nextMask)))
            (br $opening)))
        (local.set $p (local.get $end))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $marks)))
    (global.set $out (local.get $dst))
    (i64.or (i64.extend_i32_u (local.get $i))
      (i64.shl (i64.extend_i32_u (local.get $p)) (i64.const 32))))

  (func $walkInlines
    (local $i i32)
    (local $p i32)
    (local $next i32)
    (local $m i32)
    (local $markEnd i32)
    (local $textEnd i32)
    (local $markType i32)
    (local $base i32)
    (local $fastHtml i32)
    (local $run i64)
    (local.set $fastHtml (i32.eqz
      (i32.or (global.get $mode) (global.get $literalNeedsEscape))))
    (block $done
      (loop $l
        (block $found
          (loop $skip
            (if (i32.ge_u (local.get $i) (global.get $nSlots))
              (then
                (call $rLiteral (local.get $p) (global.get $contentLen))
                (br $done)))
            (local.set $m (call $slotAt (local.get $i)))
            (local.set $next (i32.load offset=$M.beg (local.get $m)))
            (br_if $found (i32.ge_u (local.get $next) (local.get $p)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $skip)))
        ;; Capture the mark bounds before text emission can grow the output
        ;; and rebase scratch. renderMark resolves its own fresh slot address.
        (local.set $markEnd (i32.load offset=$M.end (local.get $m)))
        (if (i32.and (local.get $fastHtml) (i32.eqz (global.get $plain)))
          (then
            (if (i32.and
                  (i32.eq (i32.load8_u offset=$M.type (local.get $m)) (enum.get $Mk.emph))
                  (i32.le_u (i32.sub (local.get $markEnd) (local.get $p)) (i32.const 256)))
              (then
                (local.set $run (call $htmlEmphasisRun (local.get $i) (local.get $p)))
                (local.set $i (i32.wrap_i64 (local.get $run)))
                (local.set $p (i32.wrap_i64 (i64.shr_u (local.get $run) (i64.const 32))))
                (br $l)))))
        (if (i32.gt_u (local.get $next) (local.get $p))
          (then
            (local.set $textEnd (local.get $next))
            (local.set $markType (i32.load8_u offset=$M.type (local.get $m)))
            ;; Keep the spaces before a line break out of the text span. A
            ;; backslash hard break starts at its backslash and keeps them.
            (if (i32.or
                  (i32.eq (local.get $markType) (enum.get $Mk.softbreak))
                  (i32.eq (local.get $markType) (enum.get $Mk.hardbreak)))
              (then
                (local.set $base (global.get $contentBase))
                (if (i32.eq (i32.load8_u (i32.add (local.get $base) (local.get $next)))
                      (i32.const 10))
                  (then
                    (local.set $textEnd (i32.sub
                      (call $trimSpaceBack
                        (i32.add (local.get $base) (local.get $next))
                        (local.get $base))
                      (local.get $base)))))))
            (call $rLiteral (local.get $p) (local.get $textEnd))))
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
    (local.set $b (i32.load offset=$M.beg (local.get $m)))
    (local.set $e (i32.load offset=$M.end (local.get $m)))
    ;; Dispatch on the mark type: each handler follows the block it names.
    (block $emph
     (block $text
      (block $footnote
       (block $link
        (block $linkclose
         (block $linkopen
          (block $hardbreak
           (block $softbreak
            (block $rawhtml
             (block $entity
              (block $code
               (block $escape
                (br_table $emph $text $emph $code $link $rawhtml $entity $escape
                  $softbreak $hardbreak $linkopen $linkclose $link $footnote
                  (local.get $t)))
               ;; an escaped character without its backslash
               (local.set $b (i32.add (local.get $b) (i32.const 1)))
               (br $text))
              ;; code span: its content range sits inside the backtick runs
              (local.set $q (i32.load offset=$M.data (local.get $m)))
              (local.set $e (i32.sub (i32.add (local.get $e) (local.get $b)) (local.get $q)))
              (local.set $b (local.get $q))
              (local.set $base (global.get $contentBase))
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
              (if (i32.eqz (i32.or (global.get $mode) (global.get $plain)))
                (then
                  (call $htmlCodeSpan (local.get $b) (local.get $e))
                  (return)))
              ;; ANSI, or HTML alt text without tags
              (if (i32.eqz (global.get $plain))
                (then (call $sgrOn (i32.const $S.code))))
              (block $codeDone
                ;; Single-line leaves and table cells cannot contain a code newline;
                ;; avoid searching them again before HTML escaping or ANSI emission.
                (if (global.get $singleLineContent)
                  (then
                    (call $rText (local.get $b) (local.get $e))
                    (br $codeDone)))
                (loop $codeLine
                  (br_if $codeDone (i32.ge_u (local.get $b) (local.get $e)))
                  (local.set $base (global.get $contentBase))
                  (local.set $q (i32.sub (call $findByte
                    (i32.add (local.get $base) (local.get $b))
                    (i32.add (local.get $base) (local.get $e)) (i32.const 10))
                    (local.get $base)))
                  (call $rText (local.get $b) (local.get $q))
                  ;; a line ending is a space; ANSI holds it back like any other
                  (if (i32.lt_u (local.get $q) (local.get $e))
                    (then
                      (if (global.get $mode)
                        (then
                          (if (i32.eqz (global.get $atLineStart))
                            (then (global.set $pendingSpace (i32.const 1)))))
                        (else (call $outByte (i32.const 32))))))
                  (local.set $b (i32.add (local.get $q) (i32.const 1)))
                  (br $codeLine)))
              (if (i32.eqz (global.get $plain))
                (then (call $sgrOff (i32.const $S.code))))
              (return))
             ;; entity: its value code (see $entityEncode)
             (call $rRaw (i32.const $mem.numbuf)
               (call $entityEncode (i32.const $mem.numbuf) (i32.load offset=$M.data (local.get $m))))
             (return))
            ;; raw HTML: dropped in ANSI, literal text in alt text
            (br_if $text (global.get $plain))
            (if (global.get $mode) (then (return)))
            (call $ensureOut (i32.add
              (i32.mul (i32.sub (local.get $e) (local.get $b)) (i32.const 4)) (i32.const 64)))
            (call $htmlFiltered2
              (call $contentAt (local.get $b))
              (call $contentAt (local.get $e)) (i32.const 0))
            (return))
           ;; soft break
           (if (global.get $plain)
             (then (call $outByte (i32.const 32)))
             (else
               (if (global.get $mode)
                 (then
                   (if (global.get $wrap)
                     (then
                       (if (i32.eqz (global.get $atLineStart))
                         (then (global.set $pendingSpace (i32.const 1)))))
                     (else (call $ansiEol))))
                 (else (call $outByte (i32.const 10))))))
           (return))
          ;; hard break
          (if (global.get $plain)
            (then (call $outByte (i32.const 32)))
            (else
              (if (global.get $mode)
                (then (call $ansiEol))
                (else (out.str "<br />\n")))))
          (return))
         ;; link opener: an image's label becomes plain alt text
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
         (return))
        ;; link closer
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
                ;; " (url)" wraps like a word glued to its parentheses
                (if (i32.gt_u (global.get $ansiCol) (global.get $prefixCols))
                  (then (global.set $pendingSpace (i32.const 1))))
                (i32.store16 (i32.const $mem.numbuf) (i32.const "()"))
                (call $ansiRaw (i32.const $mem.numbuf) (i32.const $mem.numbuf+1) (i32.const 0))
                (call $ansiRaw (global.get $linkUrlBeg) (global.get $linkUrlEnd)
                  (global.get $linkInContent))
                (call $ansiRaw (i32.const $mem.numbuf+1) (i32.const $mem.numbuf+2) (i32.const 0))
                (call $sgrOff (i32.const $S.dim)))
              (else (call $htmlLinkClose (local.get $image))))))
        (return))
       ;; An autolink's angle brackets are not part of its URL. Its email kind
       ;; maps to the extended autolink's mailto: kind.
       (local.set $k (i32.eq (local.get $t) (enum.get $Mk.autolink)))
       (local.set $b (i32.add (local.get $b) (local.get $k)))
       (local.set $e (i32.sub (local.get $e) (local.get $k)))
       (br_if $text (global.get $plain))
       (global.set $linkInContent (i32.const 1))
       (global.set $linkUrlBeg (local.get $b))
       (global.set $linkUrlEnd (local.get $e))
       (if (global.get $mode)
         (then (call $ansiAutolink))
         (else (call $htmlAutolink
           (i32.shl (i32.load offset=$M.data (local.get $m)) (local.get $k)) (local.get $k))))
       (return))
      ;; footnote reference: numbered on first use, counted on every use
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
          ;; "[n]" wraps as text; a line may break between two references
          (if (i32.and (i32.eq (global.get $out) (global.get $fnRefEnd))
                (i32.eqz (global.get $pendingSpace)))
            (then (call $markBreak (global.get $out) (global.get $ansiCol) (i32.const 0))))
          (call $sgrOn (i32.const $S.link))
          (i32.store8 (i32.const $mem.numbufEnd-1) (i32.const "]"))
          (local.set $q (i32.sub
            (call $digitsBefore (i32.const $mem.numbufEnd-1) (local.get $n)) (i32.const 1)))
          (i32.store8 (local.get $q) (i32.const "["))
          (call $ansiRaw (local.get $q) (i32.const $mem.numbufEnd) (i32.const 0))
          (call $sgrOff (i32.const $S.link))
          (global.set $fnRefEnd (global.get $out)))
        (else (call $htmlFootnoteRef (local.get $n) (local.get $k))))
      (return))
     ;; literal text: a bracket, an escape, or a link or raw HTML in alt text
     (call $rText (local.get $b) (local.get $e))
     (return))
    ;; An emphasis delimiter run: closing tags, leftover text, then opening tags.
    ;; Emitting can move scratch, so load every mark field first.
    (local.set $tail (i32.load offset=$M.closeTail (local.get $m)))
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
            (if (i32.eqz (global.get $plain))
              (then
                (if (global.get $mode)
                  (then (call $sgrOff (select (i32.const $S.italic)
                    (select (i32.const $S.bold) (i32.const $S.strike)
                      (i32.eq (local.get $kind) (i32.const $T.strong)))
                    (i32.eq (local.get $kind) (i32.const $T.em)))))
                  (else
                    (call $ensureOut (i32.const 9))
                    (global.set $out (call $htmlEmphCloseAt (global.get $out) (local.get $kind)))))))
            (br_if $closed (i32.eq (local.get $tag) (local.get $tail)))
            (local.set $tag (local.get $tagNext))
            (br $l)))))
    ;; rem delimiters are left over; a run repeats one byte, so any rem of its
    ;; bytes are the same text
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
                (call $ensureOut (i32.const 8))
                (global.set $out (call $htmlEmphOpenAt (global.get $out) (local.get $kind)))))))
        (br $l))))

  ;; Inline analysis already classified unmarked text. When none of it needs
  ;; HTML escaping, copy gaps directly rather than classifying each span again.
  ;; Marks (code, escapes, entities, image labels) retain their normal writers.
  (func $rLiteral (param $b i32) (param $e i32)
    (local $n i32)
    (if (i32.ge_u (local.get $b) (local.get $e)) (then (return)))
    (if (i32.or (global.get $mode) (global.get $literalNeedsEscape))
      (then (call $rText (local.get $b) (local.get $e)) (return)))
    (local.set $n (i32.sub (local.get $e) (local.get $b)))
    (call $ensureOut (local.get $n))
    (global.set $out (call $copyAt (global.get $out) (call $contentAt (local.get $b))
      (local.get $n))))

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

  ;; Copy URL bytes that need neither decoding nor escaping in SIMD spans.
  ;; The caller reserves the entire URL before resolving its source pointers.
  (func $outHrefSafe (param $p i32) (param $e i32) (result i32)
    (local $dst i32)
    (local $w v128)
    (local $mask i32)
    (local $n i32)
    (local $rem i32)
    (local.set $dst (global.get $out))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $w (v128.load (local.get $p)))
        ;; Low-nibble rows encode Houdini's safe ASCII set; high nibbles >=8
        ;; select zero so every non-ASCII byte follows percent encoding.
        (local.set $mask (i8x16.bitmask (i8x16.eq
          (v128.and
            (i8x16.swizzle (v128.const i8x16
              184 252 248 252 252 252 248 248 252 252 252 92 84 92 212 124)
              (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
            (i8x16.swizzle (v128.const i8x16
              1 2 4 8 16 32 64 128 0 0 0 0 0 0 0 0)
              (i8x16.shr_u (local.get $w) (i32.const 4))))
          (i8x16.splat (i32.const 0)))))
        (local.set $rem (i32.sub (local.get $e) (local.get $p)))
        (local.set $n (select (call $firstBit (local.get $mask)) (i32.const 16)
          (local.get $mask)))
        (if (i32.gt_u (local.get $n) (local.get $rem))
          (then (local.set $n (local.get $rem))))
        (v128.store (local.get $dst) (local.get $w))
        (local.set $dst (i32.add (local.get $dst) (local.get $n)))
        (local.set $p (i32.add (local.get $p) (local.get $n)))
        (br_if $done (i32.lt_u (local.get $n) (i32.const 16)))
        (br $scan)))
    (global.set $out (local.get $dst))
    (local.get $p))

  ;; write [$p,$e) percent-encoded. Bit 0 of $flags decodes entity references,
  ;; bit 1 removes backslash escapes, matching what each link form cleans.
  ;; The SIMD copier takes every safe byte, so the scalar path only encodes.
  ;; $lit is an escaped character's address: it is literal even if it is & or \.
  (func $outHref (param $p i32) (param $e i32) (param $flags i32)
    (local $c i32)
    (local $n i32)
    (local $lit i32)
    (block $done
      (loop $l
        (local.set $p (call $outHrefSafe (local.get $p) (local.get $e)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.ne (local.get $p) (local.get $lit))
          (then
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
                    (local.set $lit (local.get $p))
                    (br $l)))))))
        ;; The caller reserved nine bytes per URL byte (an encoded NUL), so this
        ;; never grows output.
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (i64.store (global.get $out) (i64.const "&amp;"))
            (global.set $out (i32.add (global.get $out) (i32.const 5))))
          (else
            (if (i32.eq (local.get $c) (i32.const "'"))
              (then
                (i64.store (global.get $out) (i64.const "&#x27;"))
                (global.set $out (i32.add (global.get $out) (i32.const 6))))
              (else (if (i32.eqz (local.get $c))
              (then
                ;; NUL is U+FFFD, as in text
                (i64.store (global.get $out) (i64.const "%EF%BF%B"))
                (i32.store8 offset=8 (global.get $out) (i32.const "D"))
                (global.set $out (i32.add (global.get $out) (i32.const 9))))
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

  ;; Clean entities/backslashes and HTML-escape in one pass. The caller already
  ;; reserved worst-case output; literal spans copy directly from SIMD loads.
  ;; Decoded entities still use the text escaper, never another cleanup pass.
  (func $outCleanText (param $p i32) (param $e i32) (param $flags i32)
    (local $c i32)
    (local $n i32)
    (local $rem i32)
    (local $mask i32)
    (local $dst i32)
    (local $w v128)
    (local $lo v128)
    (local.set $lo (v128.load (i32.const $mem.escapeNibbles)))
    (local.set $dst (global.get $out))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (i8x16.eq
            (i8x16.swizzle (local.get $lo)
              (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
            (i8x16.shr_u (local.get $w) (i32.const 4)))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const "\5c"))))))
        (local.set $rem (i32.sub (local.get $e) (local.get $p)))
        (local.set $n (select (call $firstBit (local.get $mask)) (i32.const 16) (local.get $mask)))
        (if (i32.gt_u (local.get $n) (local.get $rem))
          (then (local.set $n (local.get $rem))))
        (v128.store (local.get $dst) (local.get $w))
        (local.set $dst (i32.add (local.get $dst) (local.get $n)))
        (local.set $p (i32.add (local.get $p) (local.get $n)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (br_if $l (i32.eq (local.get $n) (i32.const 16)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "&"))
              (i32.and (local.get $flags) (i32.const 1)))
          (then
            (local.set $n (call $entityMatch (local.get $p) (local.get $e)))
            (if (local.get $n)
              (then
                (local.set $dst (call $outTextAt (global.get $entVal)
                  (i32.add (global.get $entVal) (global.get $entLen)) (local.get $dst)))
                (local.set $p (i32.add (local.get $p) (local.get $n)))
                (br $l)))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
              (i32.ne (i32.and (local.get $flags) (i32.const 2)) (i32.const 0)))
          (then
            (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $e))
                  (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
        ;; the text writer escapes or copies this one byte
        (local.set $dst (call $outTextAt (local.get $p) (i32.add (local.get $p) (i32.const 1))
          (local.get $dst)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (global.set $out (local.get $dst)))

  ;; the url and title of a resolved link, as absolute byte ranges
  (global $linkUrlBeg (mut i32) (i32.const 0))
  (global $linkUrlEnd (mut i32) (i32.const 0))
  (global $linkTitleBeg (mut i32) (i32.const 0))
  (global $linkTitleEnd (mut i32) (i32.const 0))
  (global $linkInContent (mut i32) (i32.const 0))
  (global $linkPending (mut i32) (i32.const 0))

  ;; inline link offsets resolve against the current content base
  (func $linkBase (result i32)
    (select (global.get $contentBase) (i32.const 0) (global.get $linkInContent)))

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

  ;; Alias trimmed input unless the boundary scan found an escaped pipe.
  ;; Only those cells need rebuilding; ordinary inline escapes stay in input.
  (func $renderCell (param $beg i32) (param $end i32) (param $unescapePipe i32)
    (local $dst i32)
    (local $n i32)
    (local $c i32)
    ;; Trim before choosing between immutable input and rebuilt content.
    (global.set $singleLineContent (i32.const 1))
    (global.set $scratchUsed (i32.const 0))
    (global.set $scratchTailUsed (i32.const 0))
    (local.set $beg (call $skipSpace (local.get $beg) (local.get $end)))
    (local.set $end (call $trimSpaceBack (local.get $end) (local.get $beg)))
    (global.set $contentInputEnd (local.get $end))
    (if (local.get $unescapePipe)
      (then
        (call $ensureScratch (i32.add (i32.sub (local.get $end) (local.get $beg)) (i32.const 64)))
        (local.set $dst (global.get $scratchBase))
        (block $done
          (loop $l
            (br_if $done (i32.ge_u (local.get $beg) (local.get $end)))
            (local.set $c (i32.load8_u (local.get $beg)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
                  (i32.lt_u (i32.add (local.get $beg) (i32.const 1)) (local.get $end)))
              (then
                (if (i32.eq (i32.load8_u offset=1 (local.get $beg)) (i32.const "|"))
                  (then
                    (local.set $c (i32.const "|"))
                    (local.set $beg (i32.add (local.get $beg) (i32.const 1)))))))
            (i32.store8 (i32.add (local.get $dst) (local.get $n)) (local.get $c))
            (local.set $n (i32.add (local.get $n) (i32.const 1)))
            (local.set $beg (i32.add (local.get $beg) (i32.const 1)))
            (br $l)))
        (memory.fill (i32.add (local.get $dst) (local.get $n)) (i32.const 0) (i32.const 32))
        (global.set $scratchUsed (i32.add (local.get $n) (i32.const 32)))
        (local.set $beg (local.get $dst))
        (local.set $end (i32.add (local.get $dst) (local.get $n)))))
    (global.set $contentBase (local.get $beg))
    (global.set $contentLen (i32.sub (local.get $end) (local.get $beg)))
    (call $inlineScan)
    (call $walkInlines))

  ;; Current cell range, following cursor, and whether pipe escapes need copying.
  (global $cellBeg (mut i32) (i32.const 0))
  (global $cellEnd (mut i32) (i32.const 0))
  (global $cellNext (mut i32) (i32.const 0))
  (global $cellUnescapePipe (mut i32) (i32.const 0))

  ;; Scan one cell at $p and leave the cursor for the next cell in $cellNext.
  ;; Callers skip an optional leading pipe once before entering their row loop.
  (func $cellRange (param $p i32) (param $end i32) (result i32)
    (local $start i32)
    (local $c i32)
    (local $pipe i32)
    (global.set $cellNext (local.get $end))
    (global.set $cellUnescapePipe (i32.const 0))
    (block $done
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (local.set $start (local.get $p))
      (block $cellDone
        (loop $byte
          (local.set $p (call $findCellBoundary (local.get $p) (local.get $end)))
          (br_if $cellDone (i32.ge_u (local.get $p) (local.get $end)))
          (local.set $c (i32.load8_u (local.get $p)))
          (if (i32.eq (local.get $c) (i32.const "\5c"))
            (then
              (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                    (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p))))
                (then
                  (if (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "|"))
                    (then (global.set $cellUnescapePipe (i32.const 1))))
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
