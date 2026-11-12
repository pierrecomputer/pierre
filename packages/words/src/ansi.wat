(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./record.wat")
  (import "./render.wat")

  ;; Terminal rendering keeps a line prefix (block quote bars, list indents) in
  ;; $mem.prefix and re-emits it after every line break, so nested content stays
  ;; aligned. Inline styling is a bit mask that is re-applied after each reset,
  ;; which keeps a prefix from inheriting the style of the text around it.
  (const $S.bold 1)
  (const $S.italic 2)
  (const $S.strike 4)
  (const $S.underline 8)
  (const $S.dim 16)
  (const $S.code 32)
  (const $S.link 64)
  (const $S.heading 128)
  (const $S.h1 137)   ;; heading + bold + underline
  (const $S.hN 129)   ;; heading + bold
  (const $S.linkText 72) ;; link + underline

  ;; Static bytes after the 16 spaces that indents copy: the style bit of each
  ;; lane, then bytes to splat. Vectors loaded from memory stay small, where
  ;; the optimizer would fold a constant splat into a 16-byte immediate.
  (const $K.bits $mem.spaces+16)
  (const $K.tab $mem.spaces+24)
  (const $K.del $mem.spaces+25)
  (const $K.c2 $mem.spaces+26)
  (const $K.ff $mem.spaces+27)
  (const $K.fffd $mem.spaces+28)

  (const $ansiCellLimit 65536)
  (global $cellWidths (mut i32) (i32.const 0))
  (global $cellWidthCount (mut i32) (i32.const 0))

  (global $prefixLen (mut i32) (i32.const 0))
  (global $prefixCols (mut i32) (i32.const 0))
  (global $needBlank (mut i32) (i32.const 0))
  (global $atLineStart (mut i32) (i32.const 1)) ;; 2: nested markers are on the line, see $ansiPrefix
  (global $pendingLen (mut i32) (i32.const 0))
  (global $pendingCols (mut i32) (i32.const 0))
  (global $pendingAt (mut i32) (i32.const 0))   ;; where in the prefix the marker goes
  (global $ansiCol (mut i32) (i32.const 0))
  (global $listDepth (mut i32) (i32.const 0))
  (global $sgr (mut i32) (i32.const 0))
  (global $sgrLive (mut i32) (i32.const 0))
  (global $noWrap (mut i32) (i32.const 0)) ;; table cells lay out on one line
  (global $pendingSpace (mut i32) (i32.const 0))
  (global $markerSgr (mut i32) (i32.const 0))
  (global $prefixSkip (mut i32) (i32.const 0)) ;; pushes that did not fit
  ;; The current line's last break opportunity: where the line can end, its
  ;; column there, the style in force, and whether a space there is dropped.
  ;; $brkOut is 0 when the line has none.
  (global $brkOut (mut i32) (i32.const 0))
  (global $brkCol (mut i32) (i32.const 0))
  (global $brkLive (mut i32) (i32.const 0))
  (global $brkDrop (mut i32) (i32.const 0))
  (global $fnRefEnd (mut i32) (i32.const 0)) ;; output end after the last footnote reference

  ;; A style that opens or closes on a byte that has not been written yet is
  ;; left to whoever writes it: the first writer after a prefix applies $sgr,
  ;; and $ansiFlushSpace syncs once the space it held back is out. Emitting
  ;; here instead would put the escape sequence before that space, which is
  ;; what underlines the leading space of a link.
  (func $sgrSet (param $mask i32)
    (global.set $sgr (local.get $mask))
    (if (i32.eqz (i32.or (global.get $atLineStart) (global.get $pendingSpace)))
      (then (call $sgrSync))))

  (func $sgrSync
    (if (i32.ne (global.get $sgr) (global.get $sgrLive))
      (then (call $sgrEmit (global.get $sgr)))))

  ;; Bit 0 of $m is the reset, which only has to clear what is actually on;
  ;; the others are the styles of $mask. The one-digit codes 0 1 3 9 4 2 are
  ;; nibbles of one constant, the rest are 256-color foregrounds.
  (func $sgrEmit (param $mask i32)
    (local $m i32)
    (local $i i32)
    (local $dst i32)
    (local.set $m (i32.or (i32.shl (local.get $mask) (i32.const 1))
      (i32.ne (global.get $sgrLive) (i32.const 0))))
    (global.set $sgrLive (local.get $mask))
    (call $ensureOut (i32.const 64))
    (local.set $dst (global.get $out))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $m)))
        (local.set $i (call $firstBit (local.get $m)))
        (if (i32.lt_u (local.get $i) (i32.const 6))
          (then
            (i32.store (local.get $dst) (i32.add (i32.const "\1b[0m")
              (i32.shl (i32.and (i32.shr_u (i32.const 0x249310)
                (i32.shl (local.get $i) (i32.const 2))) (i32.const 15)) (i32.const 16))))
            (local.set $dst (i32.add (local.get $dst) (i32.const 4))))
          (else
            ;; 203 for code, 39 for links and headings
            (i64.store (local.get $dst) (i64.const "\1b[38;5;"))
            (i32.store offset=7 (local.get $dst)
              (select (i32.const "203m") (i32.const "39m") (i32.eq (local.get $i) (i32.const 6))))
            (local.set $dst (i32.add (local.get $dst)
              (i32.add (i32.const 10) (i32.eq (local.get $i) (i32.const 6)))))))
        (local.set $m (i32.and (local.get $m) (i32.sub (local.get $m) (i32.const 1))))
        (br $l)))
    (global.set $out (local.get $dst)))

  ;; Warning: inline nesting can exceed 65535, so each style needs a 32-bit
  ;; depth counter. A byte-wide counter loses the style every 256 openers.
  (func $sgrAdjust (param $bits i32) (param $off i32)
    (local $at i32)
    (local $bit i32)
    (local $depth i32)
    (local $mask i32)
    (local.set $mask (global.get $sgr))
    (loop $adjust
      (local.set $at (i32.add (i32.const $mem.sgr)
        (i32.shl (i32.ctz (local.get $bits)) (i32.const 2))))
      (local.set $bit (i32.and (local.get $bits) (i32.sub (i32.const 0) (local.get $bits))))
      (local.set $depth (i32.load (local.get $at)))
      (local.set $depth (select
        (i32.sub (local.get $depth) (i32.ne (local.get $depth) (i32.const 0)))
        (i32.add (local.get $depth) (i32.const 1))
        (local.get $off)))
      (i32.store (local.get $at) (local.get $depth))
      (local.set $mask (select
        (i32.or (local.get $mask) (local.get $bit))
        (i32.and (local.get $mask) (i32.xor (local.get $bit) (i32.const -1)))
        (local.get $depth)))
      (local.set $bits (i32.xor (local.get $bits) (local.get $bit)))
      (br_if $adjust (local.get $bits)))
    (call $sgrSet (local.get $mask)))

  (func $sgrOn (param $bits i32)
    (call $sgrAdjust (local.get $bits) (i32.const 0)))

  (func $sgrOff (param $bits i32)
    (call $sgrAdjust (local.get $bits) (i32.const 1)))

  (func $ansiEol
    (if (global.get $atLineStart) (then (return)))
    (if (global.get $sgrLive) (then (call $sgrEmit (i32.const 0))))
    (call $outByte (i32.const 10))
    (global.set $atLineStart (i32.const 1))
    (global.set $pendingSpace (i32.const 0))
    (global.set $brkOut (i32.const 0))
    (global.set $ansiCol (i32.const 0)))

  (func $markBreak (param $at i32) (param $col i32) (param $drop i32)
    (global.set $brkOut (local.get $at))
    (global.set $brkCol (local.get $col))
    (global.set $brkLive (global.get $sgrLive))
    (global.set $brkDrop (local.get $drop)))

  ;; Move the text after the line's last break opportunity to a new line. It
  ;; is already written, so the line end, the prefix and the style in force at
  ;; the break are built after it and rotated into place.
  (func $ansiBreak
    (local $from i32)
    (local $tail i32)
    (local $at i32)
    (local $n i32)
    (local $live i32)
    (local.set $from (i32.add (global.get $brkOut) (global.get $brkDrop)))
    (local.set $tail (i32.sub (global.get $out) (local.get $from)))
    (local.set $live (global.get $sgrLive))
    (local.set $at (global.get $out))
    (global.set $sgrLive (global.get $brkLive))
    (call $sgrEmit (i32.const 0))
    (call $outByte (i32.const 10))
    (call $outCopy (i32.const $mem.prefix)
      (i32.add (i32.const $mem.prefix) (global.get $prefixLen)))
    (call $sgrEmit (global.get $brkLive))
    (local.set $n (i32.sub (global.get $out) (local.get $at)))
    (call $ensureOut (local.get $tail))
    (memory.copy (global.get $out) (local.get $from) (local.get $tail))
    (memory.copy (global.get $brkOut) (local.get $at) (i32.add (local.get $n) (local.get $tail)))
    (global.set $out (i32.add (global.get $brkOut) (i32.add (local.get $n) (local.get $tail))))
    (global.set $sgrLive (local.get $live))
    (global.set $ansiCol (i32.add (global.get $prefixCols)
      (i32.sub (i32.sub (global.get $ansiCol) (global.get $brkCol)) (global.get $brkDrop))))
    (global.set $brkOut (i32.const 0)))

  ;; Open a line with its prefix. The style in force is left to whoever writes
  ;; next: every writer syncs it, so a line that starts with a style change
  ;; emits one sequence, not two.
  (func $ansiIndent
    (if (i32.eqz (global.get $atLineStart)) (then (return)))
    (call $ansiPrefix)
    (global.set $atLineStart (i32.const 0))
    (global.set $ansiCol (global.get $prefixCols)))

  ;; Write the line prefix, with the pending list marker in the place of its
  ;; own indent, which is plain spaces. That indent is not always last: a block
  ;; quote inside the item pushes its bar after it. $atLineStart is 2 when an
  ;; item opened right inside another one: the outer marker and the prefix
  ;; before the inner marker are then on the line already.
  (func $ansiPrefix
    (local $at i32)
    (local.set $at (global.get $prefixLen))
    (if (i32.and (i32.ne (global.get $pendingLen) (i32.const 0))
          (i32.lt_u (global.get $pendingAt) (local.get $at)))
      (then (local.set $at (global.get $pendingAt))))
    (if (i32.eq (global.get $atLineStart) (i32.const 1))
      (then (call $outCopy (i32.const $mem.prefix) (i32.add (i32.const $mem.prefix) (local.get $at)))))
    (if (global.get $pendingLen)
      (then
        ;; The marker belongs to the content, not to the prefix: a bullet in a
        ;; block quote is dim like the quote around it.
        (if (i32.ne (global.get $markerSgr) (global.get $sgrLive))
          (then (call $sgrEmit (global.get $markerSgr))))
        (call $outCopy (i32.const $mem.pending)
          (i32.add (i32.const $mem.pending) (global.get $pendingLen)))
        (local.set $at (i32.add (local.get $at) (global.get $pendingCols)))
        ;; prefix bytes assume the default state, so anything still on has to
        ;; go off before the rest of the prefix follows the marker
        (if (i32.lt_u (local.get $at) (global.get $prefixLen))
          (then
            (call $sgrEmit (i32.const 0))
            (call $outCopy (i32.add (i32.const $mem.prefix) (local.get $at))
              (i32.add (i32.const $mem.prefix) (global.get $prefixLen)))))
        (global.set $pendingLen (i32.const 0)))))

  (func $ansiBlank
    (if (i32.eqz (global.get $needBlank)) (then (return)))
    (global.set $needBlank (i32.const 0))
    ;; A marker that still waits for its line has nothing above it to keep
    ;; apart: only empty blocks, such as an empty quote, came before.
    (if (global.get $pendingLen) (then (return)))
    (call $ansiEol)
    (call $outCopy (i32.const $mem.prefix)
      (i32.add (i32.const $mem.prefix) (global.get $prefixLen)))
    (call $outByte (i32.const 10)))

  ;; A push past 700 bytes, and every push inside it, is only counted, so each
  ;; pop still undoes its own push.
  (func $prefixPush (param $ptr i32) (param $len i32) (param $cols i32)
    (if (i32.or (global.get $prefixSkip)
          (i32.gt_u (i32.add (global.get $prefixLen) (local.get $len)) (i32.const 700)))
      (then
        (global.set $prefixSkip (i32.add (global.get $prefixSkip) (i32.const 1)))
        (return)))
    (memory.copy (i32.add (i32.const $mem.prefix) (global.get $prefixLen))
      (local.get $ptr) (local.get $len))
    (global.set $prefixLen (i32.add (global.get $prefixLen) (local.get $len)))
    (global.set $prefixCols (i32.add (global.get $prefixCols) (local.get $cols))))

  (func $prefixPop (param $len i32) (param $cols i32)
    (if (global.get $prefixSkip)
      (then
        (global.set $prefixSkip (i32.sub (global.get $prefixSkip) (i32.const 1)))
        (return)))
    (if (i32.ge_u (global.get $prefixLen) (local.get $len))
      (then
        (global.set $prefixLen (i32.sub (global.get $prefixLen) (local.get $len)))
        (global.set $prefixCols (i32.sub (global.get $prefixCols) (local.get $cols))))))

  ;; the terminal cells a code point from U+0080 up takes: 0, 1 or 2
  (func $cpWidth (param $cp i32) (result i32)
    (if (i32.lt_u (local.get $cp) (i32.const 0x300)) (then (return (i32.const 1))))
    ;; U+3250..U+A48C, the CJK ideographs among them, is wide throughout
    (if (i32.lt_u (i32.sub (local.get $cp) (i32.const 0x3250)) (i32.const 0x723d))
      (then (return (i32.const 2))))
    (if (call $inRanges (i32.const $mem.width) (local.get $cp)) (then (return (i32.const 0))))
    ;; nothing before the first wide range is wide: most scripts end here
    (if (i32.lt_u (local.get $cp)
          (i32.and (i32.load (i32.const $mem.wide+4)) (i32.const 0x1fffff)))
      (then (return (i32.const 1))))
    (i32.add (i32.const 1) (call $inRanges (i32.const $mem.wide) (local.get $cp))))

  (func $ansiBlockOpen (param $t i32) (param $r i32)
    (local $n i32)
    (local $num i32)
    (local $p i32)
    (local $q i32)
    (call $ansiEol)
    ;; Quotes, items and outermost lists open after the blank line that is
    ;; due, such as the one a loose list keeps between its items. A nested
    ;; list starts right after its parent item's text.
    (if (i32.or (i32.eqz (global.get $listDepth))
          (i32.ge_u (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 2)))
      (then (call $ansiBlank)))
    (global.set $needBlank (i32.const 0))
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then
        (call $prefixPush (i32.const $mem.quoteBar) (i32.const 19) (i32.const 2))
        (call $sgrOn (i32.const $S.dim))
        (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.ul)) (i32.eq (local.get $t) (enum.get $Blk.ol)))
      (then
        (global.set $listDepth (i32.add (global.get $listDepth) (i32.const 1)))
        (i32.store offset=$mem.listNum (i32.mul (global.get $listDepth) (i32.const 4))
          (i32.load offset=8 (local.get $r)))
        (i32.store8 offset=$mem.listKind (global.get $listDepth) (local.get $t))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then
        ;; An item that opens right inside another one, as in `- - a`: the
        ;; outer marker goes out now, and both share the line.
        (if (global.get $pendingLen)
          (then
            (call $ansiPrefix)
            (global.set $atLineStart (i32.const 2))))
        ;; Write this item's marker into the pending buffer and keep the style
        ;; that is in force at the marker rather than at the line start.
        (local.set $p (i32.const $mem.pending))
        (if (i32.eq (i32.load8_u offset=$mem.listKind (global.get $listDepth))
              (enum.get $Blk.ol))
          (then
            (local.set $num (i32.load offset=$mem.listNum
              (i32.mul (global.get $listDepth) (i32.const 4))))
            (i32.store offset=$mem.listNum (i32.mul (global.get $listDepth) (i32.const 4))
              (i32.add (local.get $num) (i32.const 1)))
            ;; "N. " is written as output, moved to the pending buffer and taken back
            (local.set $q (global.get $out))
            (call $outNum (local.get $num))
            (out.str ". ")
            (local.set $n (i32.sub (global.get $out) (local.get $q)))
            (global.set $out (local.get $q))
            (memory.copy (local.get $p) (local.get $q) (local.get $n))
            (global.set $markerSgr (global.get $sgr))
            (global.set $pendingLen (local.get $n))
            (global.set $pendingCols (local.get $n)))
          (else
            ;; Bullets cycle with nesting depth.
            (i32.store (local.get $p) (i32.load offset=$mem.bullet
              (i32.shl (i32.rem_u (i32.sub (global.get $listDepth) (i32.const 1)) (i32.const 3))
                (i32.const 2))))
            (global.set $markerSgr (i32.or (global.get $sgr) (i32.const $S.bold)))
            (global.set $pendingLen (i32.const 4))
            (global.set $pendingCols (i32.const 2))
            (local.set $n (i32.const 2))))
        (i32.store8 offset=$mem.itemIndent (global.get $listDepth) (local.get $n))
        (global.set $pendingAt (global.get $prefixLen))
        (call $prefixPush (i32.const $mem.spaces) (local.get $n) (local.get $n))
        (return))))

  (func $ansiBlockClose (param $t i32)
    (local $n i32)
    ;; an empty item still shows its marker, without the trailing space
    (if (i32.and (i32.eq (local.get $t) (enum.get $Blk.li)) (i32.ne (global.get $pendingLen) (i32.const 0)))
      (then
        (global.set $pendingLen (i32.sub (global.get $pendingLen) (i32.const 1)))
        (call $ansiIndent)))
    (call $ansiEol)
    (global.set $needBlank (i32.const 1))
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then
        (call $sgrOff (i32.const $S.dim))
        (call $prefixPop (i32.const 19) (i32.const 2))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.ul)) (i32.eq (local.get $t) (enum.get $Blk.ol)))
      (then (global.set $listDepth (i32.sub (global.get $listDepth) (i32.const 1)))))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then
        (local.set $n (i32.load8_u offset=$mem.itemIndent (global.get $listDepth)))
        (call $prefixPop (local.get $n) (local.get $n))
        ;; a loose list keeps its items apart
        (global.set $needBlank (i32.and (i32.gt_u (global.get $rsp) (i32.const 0))
          (i32.eqz (i32.load8_u offset=1
            (call $rsAt (i32.sub (global.get $rsp) (i32.const 1))))))))))

  (func $ansiLeaf (param $t i32) (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
    (local $p i32)
    (local $e i32)
    (local $k i32)
    (local $dst i32)
    (local $bad i32)
    (local $v v128)
    (local $v32 v128)
    (local $vtab v128)
    (local $vdel v128)
    (local $vc2 v128)
    (call $ansiBlank)
    (local.set $p (global.get $out))
    ;; Inline content opens its own line when its first word is placed, so a
    ;; space before that word, as after dropped raw HTML, is not written. A
    ;; leaf that wrote nothing asks for no blank line after it.
    (if (i32.eq (local.get $t) (enum.get $Blk.p))
      (then
        (call $ansiTaskBox)
        (call $renderInline (local.get $r))
        (call $ansiEol)
        (if (i32.ne (global.get $out) (local.get $p))
          (then (global.set $needBlank (i32.eqz (call $tightParagraph)))))
        (return)))
    ;; every other leaf is kept apart from what follows
    (global.set $needBlank (i32.const 1))
    (if (i32.eq (local.get $t) (enum.get $Blk.hr)) (then (call $ansiHr)))
    (if (i32.eq (local.get $t) (enum.get $Blk.table)) (then (call $ansiTable (local.get $r))))
    (if (i32.eq (local.get $t) (enum.get $Blk.heading))
      (then
        (local.set $n (select (i32.const $S.h1) (i32.const $S.hN)
          (i32.eq (i32.load offset=8 (local.get $r)) (i32.const 1))))
        (call $sgrOn (local.get $n))
        (call $renderInline (local.get $r))
        ;; the line ends first, so the style goes off with its reset
        (call $ansiEol)
        (call $sgrOff (local.get $n))
        (global.set $needBlank (i32.ne (global.get $out) (local.get $p)))))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.code)) (i32.eq (local.get $t) (enum.get $Blk.html)))
      (then
        (local.set $n (i32.load offset=$R.nLines (local.get $r)))
        (local.set $v32 (v128.load (i32.const $mem.spaces)))
        (local.set $vtab (v128.load8_splat (i32.const $K.tab)))
        (local.set $vdel (v128.load8_splat (i32.const $K.del)))
        (local.set $vc2 (v128.load8_splat (i32.const $K.c2)))
        ;; dim for the whole block: each line applies it after its prefix, and
        ;; the line end resets it
        (call $sgrOn (i32.const $S.dim))
        (block $done
          (loop $l
            (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
            (local.set $line (call $lineAt (local.get $r) (local.get $i)))
            (call $ansiIndent)
            (call $sgrSync)
            ;; the indent, then the virtual spaces of a partial tab, if any
            (out.str "  ")
            (call $ansiSpaces (call $linePad (local.get $line)))
            ;; Copy the line as is, except that controls other than tab, DEL
            ;; and C1 controls become U+FFFD: input must not drive the terminal.
            (local.set $p (call $lineBeg (local.get $line)))
            (local.set $e (call $lineEndOf (local.get $line)))
            (call $ensureOut (i32.mul (i32.sub (local.get $e) (local.get $p)) (i32.const 3)))
            (local.set $dst (global.get $out))
            (block $copied
              (loop $copy
                (br_if $copied (i32.ge_u (local.get $p) (local.get $e)))
                (local.set $v (v128.load (local.get $p)))
                (local.set $k (i8x16.bitmask (v128.or
                  (v128.andnot (i8x16.lt_u (local.get $v) (local.get $v32))
                    (i8x16.eq (local.get $v) (local.get $vtab)))
                  (v128.or (i8x16.eq (local.get $v) (local.get $vdel))
                    (i8x16.eq (local.get $v) (local.get $vc2))))))
                (local.set $k (select (call $firstBit (local.get $k)) (i32.const 16) (local.get $k)))
                (if (i32.gt_u (local.get $k) (i32.sub (local.get $e) (local.get $p)))
                  (then (local.set $k (i32.sub (local.get $e) (local.get $p)))))
                (v128.store (local.get $dst) (local.get $v))
                (local.set $dst (i32.add (local.get $dst) (local.get $k)))
                (local.set $p (i32.add (local.get $p) (local.get $k)))
                (br_if $copy (i32.eq (local.get $k) (i32.const 16)))
                (br_if $copied (i32.ge_u (local.get $p) (local.get $e)))
                ;; A C2 lead byte is a control only before 80..9F, and then both
                ;; bytes become U+FFFD; otherwise it is copied.
                (local.set $k (i32.load8_u (local.get $p)))
                (local.set $bad (i32.or (i32.ne (local.get $k) (i32.const 0xc2))
                  (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $e))
                    (i32.lt_u (i32.sub (i32.load8_u offset=1 (local.get $p)) (i32.const 0x80))
                      (i32.const 0x20)))))
                (i32.store (local.get $dst)
                  (select (i32.const "\ef\bf\bd") (local.get $k) (local.get $bad)))
                (local.set $dst (i32.add (local.get $dst)
                  (select (i32.const 3) (i32.const 1) (local.get $bad))))
                (local.set $p (i32.add (local.get $p) (i32.add (i32.const 1)
                  (i32.and (local.get $bad) (i32.eq (local.get $k) (i32.const 0xc2))))))
                (br $copy)))
            (global.set $out (local.get $dst))
            (call $ansiEol)
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (call $sgrOff (i32.const $S.dim)))))

  ;; a task list item's checkbox, before its first paragraph
  (func $ansiTaskBox
    (if (i32.eqz (global.get $pendingTask)) (then (return)))
    (call $ansiIndent)
    (if (i32.eq (global.get $pendingTask) (i32.const 2))
      (then
        (call $sgrOn (i32.const $S.link))
        (out.str "[\e2\9c\93]")
        (call $sgrOff (i32.const $S.link)))
      (else
        (call $sgrOn (i32.const $S.dim))
        (out.str "[ ]")
        (call $sgrOff (i32.const $S.dim))))
    (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 3)))
    (global.set $pendingTask (i32.const 0)))

  ;; A dim line across the wrap width, or 76 columns, but 1 to 200 columns:
  ;; the rule of a one-column table that wide.
  (func $ansiHr
    (local $n i32)
    (local.set $n (i32.sub (select (global.get $wrap) (i32.const 76) (global.get $wrap))
      (global.get $prefixCols)))
    (i32.store (i32.const $mem.column)
      (select (i32.const 1)
        (select (local.get $n) (i32.const 200) (i32.lt_s (local.get $n) (i32.const 200)))
        (i32.lt_s (local.get $n) (i32.const 1))))
    (call $ansiTableRule (i32.const 1)))

  (func $ansiRule (param $cols i32)
    (local $dst i32)
    (local $end i32)
    (if (i32.lt_s (local.get $cols) (i32.const 1)) (then (return)))
    (call $ensureOut (i32.mul (local.get $cols) (i32.const 3)))
    (local.set $dst (global.get $out))
    (local.set $end (i32.add (local.get $dst) (i32.mul (local.get $cols) (i32.const 3))))
    (loop $l
      (i32.store (local.get $dst) (i32.const "\e2\94\80"))
      (local.set $dst (i32.add (local.get $dst) (i32.const 3)))
      (br_if $l (i32.lt_u (local.get $dst) (local.get $end))))
    (global.set $out (local.get $end)))

  ;; Walk only table records to reserve one bounded workspace after the records.
  ;; HTML and table-free documents need none; the output never moves over it.
  (func $ansiTableSpace
    (local $r i32)
    (local $cols i32)
    (local $rows i32)
    (local $slots i32)
    (global.set $cellWidths (global.get $out))
    (global.set $cellWidthCount (i32.const 0))
    (local.set $r (global.get $tableHead))
    (block $done
      (loop $record
        (br_if $done (i32.eqz (local.get $r)))
        (local.set $cols (i32.load offset=8 (local.get $r)))
        (local.set $rows (i32.load offset=$R.nLines (local.get $r)))
        (local.set $slots
          (if (result i32) (i32.gt_u (local.get $rows)
                (i32.div_u (i32.const $ansiCellLimit) (local.get $cols)))
            (then (i32.const $ansiCellLimit))
            (else (i32.mul (local.get $rows) (local.get $cols)))))
        (if (i32.gt_u (local.get $slots) (global.get $cellWidthCount))
          (then (global.set $cellWidthCount (local.get $slots))))
        (local.set $r (i32.load offset=12 (local.get $r)))
        (br $record)))
    (call $ensureOut (i32.shl (global.get $cellWidthCount) (i32.const 2)))
    (global.set $out (i32.add (global.get $out)
      (i32.shl (global.get $cellWidthCount) (i32.const 2)))))

  ;; Block analysis limits tables to 512 columns, all held in this flat array.
  (func $ansiColumn (param $i i32) (result i32)
    (i32.add (i32.const $mem.column) (i32.shl (local.get $i) (i32.const 2))))

  ;; Two passes over the rows: the first measures every cell, so the columns
  ;; can be aligned, and the second writes them using those measurements.
  (func $ansiTable (param $r i32)
    (local $cols i32)
    (local $rows i32)
    (local $row i32)
    (local $i i32)
    (local $line i32)
    (local $w i32)
    (local $p i32)
    (local $end i32)
    (local $has i32)
    (local $cell i32)
    (local $col i32)
    (local $pass i32)
    (local $cached i32)
    (local $beg i32)
    (local $cellTo i32)
    (local $pad i32)
    (local $lead i32)
    (local.set $cols (i32.load offset=8 (local.get $r)))
    (local.set $rows (i32.load offset=$R.nLines (local.get $r)))
    ;; cells lay out on one line
    (global.set $noWrap (i32.const 1))
    (loop $passes
      (local.set $row (i32.const 0))
      (local.set $cell (i32.const 0))
      (block $rowsDone
        (loop $rl
          (br_if $rowsDone (i32.ge_u (local.get $row) (local.get $rows)))
          (local.set $line (call $lineAt (local.get $r) (local.get $row)))
          (local.set $p (call $lineBeg (local.get $line)))
          (local.set $end (call $lineEndOf (local.get $line)))
          (if (i32.lt_u (local.get $p) (local.get $end))
            (then
              (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "|"))
                (then
                  (local.set $p
                    (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))))
          (if (local.get $pass) (then (call $ansiIndent)))
          (local.set $i (i32.const 0))
          (block $cellsDone
            (loop $cl
              (br_if $cellsDone (i32.ge_u (local.get $i) (local.get $cols)))
              (if (i32.and (local.get $pass) (i32.ne (local.get $i) (i32.const 0)))
                (then
                  ;; Unstyled, the separator is one literal with its own dim and
                  ;; reset. The style is in sync after the previous cell.
                  (if (global.get $sgr)
                    (then
                      (call $sgrOn (i32.const $S.dim))
                      (out.str " \e2\94\82 ")
                      (call $sgrOff (i32.const $S.dim)))
                    (else (out.str "\1b[2m \e2\94\82 \1b[0m")))))
              (local.set $has (call $cellRange (local.get $p) (local.get $end)))
              (local.set $p (global.get $cellNext))
              (local.set $beg (global.get $cellBeg))
              (local.set $cellTo (global.get $cellEnd))
              (local.set $cached (i32.lt_u (local.get $cell) (global.get $cellWidthCount)))
              (local.set $w (i32.const 0))
              (if (local.get $has)
                (then
                  (local.set $w
                    (if (result i32) (i32.and (local.get $pass) (local.get $cached))
                      (then (i32.load (i32.add (global.get $cellWidths)
                        (i32.shl (local.get $cell) (i32.const 2)))))
                      (else (call $measureCell (local.get $beg) (local.get $cellTo)
                        (global.get $cellUnescapePipe)))))))
              (local.set $col (call $ansiColumn (local.get $i)))
              (if (i32.eqz (local.get $pass))
                (then
                  (if (local.get $cached)
                    (then (i32.store (i32.add (global.get $cellWidths)
                      (i32.shl (local.get $cell) (i32.const 2))) (local.get $w))))
                  (if (local.get $col)
                    (then
                      (if (i32.or (i32.eqz (local.get $row))
                            (i32.gt_u (local.get $w) (i32.load (local.get $col))))
                        (then (i32.store (local.get $col) (local.get $w)))))))
                (else
                  (local.set $pad (i32.sub
                    (select (i32.load (local.get $col)) (i32.const 0) (local.get $col))
                    (local.get $w)))
                  (if (i32.lt_s (local.get $pad) (i32.const 0)) (then (local.set $pad (i32.const 0))))
                  ;; right alignment pads before the cell, center splits the padding
                  (local.set $lead (i32.load8_u
                    (i32.add (i32.add (local.get $r) (i32.const $R.header)) (local.get $i))))
                  (local.set $lead (select
                    (i32.shr_u (local.get $pad) (i32.sub (i32.const $A.right) (local.get $lead)))
                    (i32.const 0)
                    (i32.ge_u (local.get $lead) (i32.const $A.center))))
                  (call $ansiSpaces (local.get $lead))
                  (local.set $pad (i32.sub (local.get $pad) (local.get $lead)))
                  ;; the header row is bold
                  (if (i32.eqz (local.get $row)) (then (call $sgrOn (i32.const $S.bold))))
                  ;; A cell starts at the prefix column, here and when it is measured: what
                  ;; it renders, such as the space before a link target, then depends
                  ;; only on the cell.
                  (global.set $ansiCol (global.get $prefixCols))
                  (if (local.get $has)
                    (then (call $renderCell (local.get $beg) (local.get $cellTo)
                      (global.get $cellUnescapePipe))))
                  ;; commit a held-back space (it belongs to this cell) and the style that
                  ;; was waiting on it, so the separator does not inherit a deferred close
                  (call $ansiFlushSpace)
                  (if (i32.eqz (local.get $row)) (then (call $sgrOff (i32.const $S.bold))))
                  ;; the last column needs no trailing padding
                  (if (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $cols))
                    (then (call $ansiSpaces (local.get $pad))))))
              (local.set $cell (i32.add (local.get $cell) (i32.const 1)))
              (local.set $i (i32.add (local.get $i) (i32.const 1)))
              (br $cl)))
          (if (local.get $pass)
            (then
              (call $ansiEol)
              (if (i32.eqz (local.get $row)) (then (call $ansiTableRule (local.get $cols))))))
          (local.set $row (i32.add (local.get $row) (i32.const 1)))
          (br $rl)))
      (local.set $pass (i32.add (local.get $pass) (i32.const 1)))
      (br_if $passes (i32.eq (local.get $pass) (i32.const 1))))
    (global.set $noWrap (i32.const 0)))

  ;; Render a cell, measure it, and rewind the output. The styles a cell opens
  ;; it also closes, so $sgr comes back by itself, but $sgrLive would claim
  ;; bytes that are no longer there. No space is held back between cells.
  (func $measureCell (param $beg i32) (param $end i32) (param $unescapePipe i32) (result i32)
    (local $save i32)
    (local $w i32)
    (local $saveStart i32)
    (local $saveLive i32)
    (local $q i32)
    (local $c i32)
    ;; Printable ASCII without inline syntax (& * < [ \ _ ` ~) or repeated
    ;; spaces renders as itself, so its width is its trimmed length. Bit c-32
    ;; of the masks (mod 64) marks the syntax.
    (local.set $beg (call $skipSpace (local.get $beg) (local.get $end)))
    (local.set $end (call $trimSpaceBack (local.get $end) (local.get $beg)))
    (local.set $q (local.get $beg))
    (block $marked
      (loop $scan
        (if (i32.ge_u (local.get $q) (local.get $end))
          (then (return (i32.sub (local.get $end) (local.get $beg)))))
        (local.set $c (i32.sub (i32.load8_u (local.get $q)) (i32.const 32)))
        (br_if $marked (i32.ge_u (local.get $c) (i32.const 95)))
        (br_if $marked (i32.wrap_i64 (i64.and (i64.const 1)
          (i64.shr_u
            (select (i64.const 0x9800000010000440) (i64.const 0x40000001)
              (i32.lt_u (local.get $c) (i32.const 64)))
            (i64.extend_i32_u (local.get $c))))))
        (br_if $marked (i32.eq (i32.load16_u (local.get $q)) (i32.const 0x2020)))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $scan)))
    (local.set $save (global.get $out))
    (local.set $saveStart (global.get $atLineStart))
    (local.set $saveLive (global.get $sgrLive))
    (global.set $atLineStart (i32.const 0))
    (global.set $ansiCol (global.get $prefixCols))
    (call $renderCell (local.get $beg) (local.get $end) (local.get $unescapePipe))
    ;; the column is exact in a cell; a held-back trailing space is a column too
    (local.set $w (i32.add (i32.sub (global.get $ansiCol) (global.get $prefixCols))
      (global.get $pendingSpace)))
    (global.set $out (local.get $save))
    (global.set $atLineStart (local.get $saveStart))
    (global.set $pendingSpace (i32.const 0))
    (global.set $sgrLive (local.get $saveLive))
    (local.get $w))

  ;; the rule under the header row: a column's rule reaches into the gaps
  ;; around its separators
  (func $ansiTableRule (param $cols i32)
    (local $i i32)
    (local $col i32)
    (call $ansiIndent)
    (call $sgrOn (i32.const $S.dim))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $cols)))
        (if (local.get $i) (then (out.str "\e2\94\bc")))
        (local.set $col (call $ansiColumn (local.get $i)))
        (call $ansiRule (i32.add
          (select (i32.load (local.get $col)) (i32.const 0) (local.get $col))
          (i32.add (i32.ne (local.get $i) (i32.const 0))
            (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $cols)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (call $sgrOff (i32.const $S.dim))
    (call $ansiEol))

  ;; padding: no column is counted, its lines do not wrap
  (func $ansiSpaces (param $n i32)
    (if (i32.le_s (local.get $n) (i32.const 0)) (then (return)))
    (call $ensureOut (local.get $n))
    (memory.fill (global.get $out) (i32.const 32) (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n))))

  ;; Write text, wrapping at the configured width. When $content is set the
  ;; range is an offset into the current content. Its base is re-read after
  ;; every write because copied content can move with scratch.
  ;;
  ;; Runs of printable bytes with single spaces between them are copied whole.
  ;; Each space is a break opportunity: a run that does not fit is cut at its
  ;; last space that does, and $ansiBreak moves text glued to an earlier one.
  ;; Other spaces are held back until the next word is placed, so a wrapped
  ;; line never ends in one. Controls, DEL and C1 controls become U+FFFD so
  ;; the text cannot drive the terminal.
  ;;
  ;; $ansiCol is exact when wrapping or in a table cell, which is measured by
  ;; it, so UTF-8 is then placed a character at a time. Otherwise it only has
  ;; to tell whether a line has content, and counts bytes. The text is valid
  ;; UTF-8: see $ansiScrubInput.
  (func $ansiRaw (param $p i32) (param $e i32) (param $content i32)
    (local $base i32)
    (local $end i32)
    (local $c i32)
    (local $q i32)
    (local $lim i32)
    (local $room i32)
    (local $n i32)
    (local $w i32)
    (local $sp i32)
    (local $mask i32)
    (local $spaces i32)
    (local $cut i32)
    (local $char i32)
    (local $wrapOn i32)
    (local $exact i32)
    (local $v v128)
    (local $hi v128)
    (local $v32 v128)
    (local $vdel v128)
    (local $vc2 v128)
    (if (i32.ge_u (local.get $p) (local.get $e)) (then (return)))
    (local.set $wrapOn (i32.and (i32.ne (global.get $wrap) (i32.const 0))
      (i32.eqz (global.get $noWrap))))
    (local.set $exact (i32.ne (i32.or (global.get $wrap) (global.get $noWrap)) (i32.const 0)))
    (local.set $hi (v128.load8_splat
      (select (i32.const $K.bits+7) (i32.const $K.ff) (local.get $exact))))
    (local.set $v32 (v128.load (i32.const $mem.spaces)))
    (local.set $vdel (v128.load8_splat (i32.const $K.del)))
    (local.set $vc2 (v128.load8_splat (i32.const $K.c2)))
    ;; all ones when the range is in the content, so masking picks the base
    (local.set $content (i32.sub (i32.const 0) (local.get $content)))
    (local.set $base (i32.and (global.get $contentBase) (local.get $content)))
    ;; a trailing space is held back, never copied with its run
    (local.set $end (i32.sub (local.get $e) (i32.eq (i32.const 32)
      (i32.load8_u (i32.add (local.get $base) (i32.sub (local.get $e) (i32.const 1)))))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $base (i32.and (global.get $contentBase) (local.get $content)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9)))
          (then
            (call $ansiSpace)
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const 10))
          (then
            (call $ansiEol)
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        ;; The columns left on the line, below 0 once it is over, and a scan
        ;; limit of at most one column past them.
        (local.set $room (i32.const 0x7fffffff))
        (if (local.get $wrapOn)
          (then
            ;; the prefix can grow the output and move the content
            (if (global.get $atLineStart)
              (then
                (call $ansiIndent)
                (local.set $base (i32.and (global.get $contentBase) (local.get $content)))))
            (local.set $room (i32.sub (i32.sub (global.get $wrap) (global.get $ansiCol))
              (global.get $pendingSpace)))))
        (local.set $lim (select (local.get $room) (i32.const 0)
          (i32.gt_s (local.get $room) (i32.const 0))))
        (local.set $lim (select (local.get $end)
          (i32.add (local.get $p) (i32.add (local.get $lim) (i32.const 1)))
          (i32.le_u (i32.sub (local.get $end) (local.get $p)) (local.get $lim))))
        ;; The run ends before a control, DEL, a C2 lead byte (C1 controls),
        ;; UTF-8 when wrapping, and a space that another space or control
        ;; follows. $sp keeps its last space, 0 when there is none.
        (local.set $q (local.get $p))
        (local.set $sp (i32.const 0))
        (block $scanned
          (loop $scan
            (local.set $v (v128.load (i32.add (local.get $base) (local.get $q))))
            (local.set $spaces (i8x16.bitmask (i8x16.eq (local.get $v) (local.get $v32))))
            (local.set $mask (i8x16.bitmask (v128.or
              (v128.or
                (v128.or
                  (i8x16.lt_u (local.get $v) (local.get $v32))
                  (i8x16.eq (local.get $v) (local.get $vdel)))
                (v128.or
                  (i8x16.ge_u (local.get $v) (local.get $hi))
                  (i8x16.eq (local.get $v) (local.get $vc2))))
              (v128.and (i8x16.eq (local.get $v) (local.get $v32))
                (i8x16.le_u
                  (v128.load offset=1 (i32.add (local.get $base) (local.get $q)))
                  (local.get $v32))))))
            (local.set $n (i32.sub (local.get $lim) (local.get $q)))
            (if (i32.lt_u (local.get $n) (i32.const 16))
              (then (local.set $mask (i32.or (local.get $mask) (i32.shl (i32.const 1) (local.get $n))))))
            (if (local.get $mask)
              (then
                (local.set $n (call $firstBit (local.get $mask)))
                (local.set $spaces (i32.and (local.get $spaces)
                  (i32.sub (i32.shl (i32.const 1) (local.get $n)) (i32.const 1))))))
            (if (local.get $spaces)
              (then (local.set $sp (i32.add (local.get $q)
                (i32.sub (i32.const 31) (i32.clz (local.get $spaces)))))))
            (br_if $scanned (local.get $mask))
            (local.set $q (i32.add (local.get $q) (i32.const 16)))
            (br $scan)))
        ;; Write [$p,$q) at $w columns: a run, or else one character the run
        ;; stopped at, a control, DEL or UTF-8. $char is 2 for a character,
        ;; 3 for one written as U+FFFD.
        (local.set $q (i32.add (local.get $q) (local.get $n)))
        (local.set $w (i32.sub (local.get $q) (local.get $p)))
        (loop $next
          (local.set $char (i32.const 0))
          (if (i32.eqz (local.get $w))
            (then
              (local.set $w (i32.const 1))
              (local.set $char (i32.const 3))
              (local.set $q (i32.add (local.get $p) (i32.const 1)))
              (if (i32.ge_u (local.get $c) (i32.const 0x80))
                (then
                  (local.set $c (call $utf8At (i32.add (local.get $base) (local.get $p))
                    (i32.add (local.get $base) (local.get $e))))
                  (local.set $q (i32.sub (global.get $utf8Next) (local.get $base)))
                  ;; C1 controls are U+0080..U+009F
                  (local.set $char (i32.add (i32.const 2)
                    (i32.lt_u (i32.sub (local.get $c) (i32.const 0x80)) (i32.const 0x20))))
                  (if (i32.and (local.get $exact) (i32.eq (local.get $char) (i32.const 2)))
                    (then (local.set $w (call $cpWidth (local.get $c)))))))))
          (local.set $cut (i32.const 0))
          (if (i32.gt_s (local.get $w) (local.get $room))
            (then
              (if (local.get $sp)
                (then
                  ;; fill the line up to the last space that fits, and end it there
                  (local.set $q (local.get $sp))
                  (local.set $w (i32.sub (local.get $q) (local.get $p)))
                  (local.set $sp (i32.const 0))
                  (local.set $cut (i32.const 1)))
                (else
                  ;; The first word does not fit. Break before it when the line
                  ;; has a break opportunity; otherwise it overflows, whole.
                  (if (global.get $pendingSpace)
                    (then
                      (if (i32.gt_u (global.get $ansiCol) (global.get $prefixCols))
                        (then (call $ansiEol) (br $l))))
                    (else (if (global.get $brkOut) (then (call $ansiBreak) (br $l)))))
                  (if (i32.eqz (local.get $char))
                    (then
                      (block $word
                        (loop $chars
                          (br_if $word (i32.ge_u (local.get $q) (local.get $end)))
                          (br_if $word (i32.ge_u (i32.sub
                            (i32.load8_u (i32.add (local.get $base) (local.get $q))) (i32.const 33))
                            (i32.const 94)))
                          (local.set $q (i32.add (local.get $q) (i32.const 1)))
                          (br $chars)))
                      (local.set $w (i32.sub (local.get $q) (local.get $p)))))))))
          (if (i32.or (i32.or (global.get $atLineStart) (global.get $pendingSpace))
                (i32.ne (global.get $sgr) (global.get $sgrLive)))
            (then (call $ansiFlushSpace)))
          ;; the bytes written: the run, the character, or U+FFFD
          (local.set $n (select (i32.const 3) (i32.sub (local.get $q) (local.get $p))
            (i32.eq (local.get $char) (i32.const 3))))
          (call $ensureOut (local.get $n))
          (local.set $base (i32.and (global.get $contentBase) (local.get $content)))
          (local.set $lim (select (i32.const $K.fffd) (i32.add (local.get $base) (local.get $p))
            (i32.eq (local.get $char) (i32.const 3))))
          (if (i32.le_u (local.get $n) (i32.const 16))
            (then (v128.store (global.get $out) (v128.load (local.get $lim))))
            (else (memory.copy (global.get $out) (local.get $lim) (local.get $n))))
          (if (i32.and (local.get $wrapOn) (i32.ne (local.get $sp) (i32.const 0)))
            (then (call $markBreak
              (i32.add (global.get $out) (i32.sub (local.get $sp) (local.get $p)))
              (i32.add (global.get $ansiCol) (i32.sub (local.get $sp) (local.get $p)))
              (i32.const 1))))
          (global.set $out (i32.add (global.get $out) (local.get $n)))
          (global.set $ansiCol (i32.add (global.get $ansiCol) (local.get $w)))
          (local.set $p (i32.add (local.get $q) (local.get $cut)))
          (if (local.get $cut) (then (call $ansiEol)))
          (if (local.get $char)
            (then
              ;; A line may break after a wide character, and after the zero-width
              ;; characters right behind it: a combining mark stays with its base.
              (if (i32.and (local.get $wrapOn)
                    (i32.or (i32.eq (local.get $w) (i32.const 2))
                      (i32.and (i32.eqz (local.get $w))
                        (i32.eq (global.get $brkOut) (i32.sub (global.get $out) (local.get $n))))))
                (then (call $markBreak (global.get $out) (global.get $ansiCol) (i32.const 0))))
              ;; The character after a placed one, in a word of UTF-8, is the next
              ;; run of its own: the scan would stop at it at once, with no space.
              (if (i32.and (local.get $exact) (i32.eq (local.get $char) (i32.const 2)))
                (then
                  (if (i32.lt_u (local.get $p) (local.get $e))
                    (then
                      (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
                      (if (i32.ge_u (local.get $c) (i32.const 0x80))
                        (then
                          (local.set $room (i32.sub (local.get $room) (local.get $w)))
                          (local.set $sp (i32.const 0))
                          (local.set $w (i32.const 0))
                          (br $next))))))))))
        (br $l))))

  ;; Bytes input may hold invalid UTF-8, and a stray 0x9B is CSI on a terminal
  ;; with 8-bit controls. Each bad byte becomes SUB, a control that every output
  ;; path writes as U+FFFD. The input is our copy, and strings are always valid.
  (func $ansiScrubInput
    (local $p i32) (local $q i32) (local $c i32) (local $n i32) (local $lo i32) (local $hi i32)
    (local.set $p (i32.const $mem.input))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $eof)))
        ;; Skip ASCII eight bytes at a time: no byte has its high bit set. The
        ;; slack after the input is NUL.
        (if (i64.eqz (i64.and (i64.load (local.get $p)) (i64.const 0x8080808080808080)))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 8)))
            (br $l)))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $l (i32.lt_u (local.get $c) (i32.const 0x80)))
        ;; one sequence after the other, while they follow each other
        (loop $seq
          (block $next
            (block $bad
              (br_if $bad (i32.ge_u (i32.sub (local.get $c) (i32.const 0xc2)) (i32.const 0x33)))
              ;; The first continuation byte has a narrower range after these leads,
              ;; which excludes overlong forms, surrogates and values above U+10FFFF.
              (local.set $lo (select (i32.const 0xa0) (select (i32.const 0x90) (i32.const 0x80)
                (i32.eq (local.get $c) (i32.const 0xf0))) (i32.eq (local.get $c) (i32.const 0xe0))))
              (local.set $hi (select (i32.const 0x9f) (select (i32.const 0x8f) (i32.const 0xbf)
                (i32.eq (local.get $c) (i32.const 0xf4))) (i32.eq (local.get $c) (i32.const 0xed))))
              (local.set $n (i32.add (i32.add (i32.const 1) (i32.ge_u (local.get $c) (i32.const 0xe0)))
                (i32.ge_u (local.get $c) (i32.const 0xf0))))
              (local.set $q (local.get $p))
              ;; The NUL sentinel after the input ends a truncated sequence.
              (loop $cont
                (br_if $bad (i32.gt_u (i32.sub (i32.load8_u (local.get $q)) (local.get $lo))
                  (i32.sub (local.get $hi) (local.get $lo))))
                (local.set $lo (i32.const 0x80))
                (local.set $hi (i32.const 0xbf))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br_if $cont (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))
              (local.set $p (local.get $q))
              (br $next))
            (i32.store8 (i32.sub (local.get $p) (i32.const 1)) (i32.const 0x1a)))
          (local.set $c (i32.load8_u (local.get $p)))
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (br_if $seq (i32.ge_u (local.get $c) (i32.const 0x80))))
        ;; that byte is ASCII, or the sentinel
        (br $l))))

  ;; Hold back a space until the next word is placed. A line never starts
  ;; with one.
  (func $ansiSpace
    (if (i32.eqz (global.get $atLineStart))
      (then (global.set $pendingSpace (i32.const 1)))))

  ;; commit the space a previous word held back, before anything that would
  ;; otherwise be written on the far side of it; the line can end at that space
  (func $ansiFlushSpace
    (call $ansiIndent)
    (if (global.get $pendingSpace)
      (then
        (call $markBreak (global.get $out) (global.get $ansiCol) (i32.const 1))
        (call $outByte (i32.const 32))
        (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 1)))
        (global.set $pendingSpace (i32.const 0))))
    (call $sgrSync))

  (func $ansiAutolink
    (call $sgrOn (i32.const $S.linkText))
    (call $ansiRaw (global.get $linkUrlBeg) (global.get $linkUrlEnd) (global.get $linkInContent))
    (call $sgrOff (i32.const $S.linkText)))

  (func $ansiFootnotesOpen
    (global.set $needBlank (i32.const 1))
    (call $ansiBlank)
    (call $ansiHr)
    (global.set $needBlank (i32.const 1)))

  (func $ansiFootnoteOpen (param $n i32)
    (local $w i32)
    (call $ansiBlank)
    (call $ansiEol)
    (call $ansiIndent)
    (call $sgrOn (i32.const $S.link))
    ;; "[n] " is ASCII: its width is its length
    (local.set $w (global.get $out))
    (call $outByte (i32.const "["))
    (call $outNum (local.get $n))
    (out.str "] ")
    (local.set $w (i32.sub (global.get $out) (local.get $w)))
    (call $sgrOff (i32.const $S.link))
    (global.set $ansiCol (i32.add (global.get $ansiCol) (local.get $w)))
    (call $prefixPush (i32.const $mem.spaces) (local.get $w) (local.get $w))
    (i32.store8 offset=$mem.itemIndent (i32.const 255) (local.get $w))
    (global.set $needBlank (i32.const 0)))

  (func $ansiFootnoteClose
    (local $w i32)
    (call $ansiEol)
    (local.set $w (i32.load8_u offset=$mem.itemIndent (i32.const 255)))
    (call $prefixPop (local.get $w) (local.get $w))
    (global.set $needBlank (i32.const 0)))

  ;; static prefix and marker fragments
  (data (i32.const $mem.quoteBar)
    "\1b[38;5;240m\e2\94\82\1b[0m "
    "\e2\80\a2 "  ;; level 1
    "\e2\97\a6 "  ;; level 2
    "\e2\96\aa "  ;; level 3
    "                "  ;; indents are at most 13 wide
    "\01\02\04\08\10\20\40\80"
    "\09\7f\c2\ff"
    "\ef\bf\bd")
)
