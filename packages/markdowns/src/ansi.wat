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

  ;; the zero-width and double-width code point ranges
  (unicode-width-table $mem.width $mem.widthEnd)

  (global $prefixLen (mut i32) (i32.const 0))
  (global $prefixCols (mut i32) (i32.const 0))
  (global $needBlank (mut i32) (i32.const 0))
  (global $atLineStart (mut i32) (i32.const 1))
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

  ;; A style that opens or closes on a byte that has not been written yet is
  ;; left to whoever writes it: $ansiIndent re-applies $sgr after every prefix,
  ;; and $ansiFlushSpace syncs once the space it held back is out. Emitting
  ;; here instead would put the escape sequence before that space, which is
  ;; what underlines the leading space of a link.
  (func $sgrSet (param $mask i32)
    (global.set $sgr (local.get $mask))
    (if (i32.eq (global.get $sgr) (global.get $sgrLive)) (then (return)))
    (if (i32.or (global.get $atLineStart) (global.get $pendingSpace)) (then (return)))
    (call $sgrEmit (local.get $mask)))

  (func $sgrSync
    (if (i32.ne (global.get $sgr) (global.get $sgrLive))
      (then (call $sgrEmit (global.get $sgr)))))

  (func $sgrEmit (param $mask i32)
    ;; the reset only has to clear what is actually on
    (if (global.get $sgrLive) (then (out.str "\1b[0m")))
    (global.set $sgrLive (local.get $mask))
    (if (i32.and (local.get $mask) (i32.const $S.bold)) (then (out.str "\1b[1m")))
    (if (i32.and (local.get $mask) (i32.const $S.italic)) (then (out.str "\1b[3m")))
    (if (i32.and (local.get $mask) (i32.const $S.strike)) (then (out.str "\1b[9m")))
    (if (i32.and (local.get $mask) (i32.const $S.underline)) (then (out.str "\1b[4m")))
    (if (i32.and (local.get $mask) (i32.const $S.dim)) (then (out.str "\1b[2m")))
    (if (i32.and (local.get $mask) (i32.const $S.code)) (then (out.str "\1b[38;5;203m")))
    (if (i32.and (local.get $mask) (i32.const $S.link)) (then (out.str "\1b[38;5;39m")))
    (if (i32.and (local.get $mask) (i32.const $S.heading)) (then (out.str "\1b[38;5;39m"))))

  ;; A style can nest inside itself and inside another that shares a bit, so
  ;; each bit is a depth counter: the style only ends when the last opener does.
  (func $sgrAdjust (param $bits i32) (param $delta i32)
    (local $i i32)
    (local $bit i32)
    (local $v i32)
    (local $m i32)
    (local.set $m (global.get $sgr))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $bits)))
        (local.set $i (i32.ctz (local.get $bits)))
        (local.set $bit (i32.shl (i32.const 1) (local.get $i)))
        (local.set $v (i32.add
          (i32.load8_u offset=$mem.sgr (local.get $i)) (local.get $delta)))
        (if (i32.lt_s (local.get $v) (i32.const 0))
          (then (local.set $v (i32.const 0))))
        ;; Match the stored byte if an adversarial nesting depth wraps it.
        (local.set $v (i32.and (local.get $v) (i32.const 255)))
        (i32.store8 offset=$mem.sgr (local.get $i) (local.get $v))
        (if (local.get $v)
          (then (local.set $m (i32.or (local.get $m) (local.get $bit))))
          (else (local.set $m (i32.and (local.get $m)
            (i32.xor (local.get $bit) (i32.const -1))))))
        (local.set $bits
          (i32.and (local.get $bits) (i32.sub (local.get $bits) (i32.const 1))))
        (br $l)))
    (call $sgrSet (local.get $m)))

  (func $sgrOn (param $bits i32)
    (call $sgrAdjust (local.get $bits) (i32.const 1)))

  (func $sgrOff (param $bits i32)
    (call $sgrAdjust (local.get $bits) (i32.const -1)))

  (func $ansiEol
    (if (global.get $atLineStart) (then (return)))
    (if (global.get $sgrLive)
      (then
        (out.str "\1b[0m")
        (global.set $sgrLive (i32.const 0))))
    (call $outByte (i32.const 10))
    (global.set $atLineStart (i32.const 1))
    (global.set $pendingSpace (i32.const 0))
    (global.set $ansiCol (i32.const 0)))

  ;; open a line: the prefix first, then whatever style was active
  (func $ansiIndent
    (local $at i32)
    (if (i32.eqz (global.get $atLineStart)) (then (return)))
    (global.set $atLineStart (i32.const 0))
    (if (global.get $pendingLen)
      (then
        ;; The marker takes the place of its own indent, which is plain spaces.
        ;; That indent is not always last: a block quote inside the item pushes
        ;; its bar after it.
        (local.set $at (global.get $pendingAt))
        (if (i32.gt_u (local.get $at) (global.get $prefixLen))
          (then (local.set $at (global.get $prefixLen))))
        (call $outCopy (i32.const $mem.prefix)
          (i32.add (i32.const $mem.prefix) (local.get $at)))
        ;; The marker belongs to the content, not to the prefix: a bullet in a
        ;; block quote is dim like the quote around it. What precedes it has
        ;; left the terminal in its default state, so the mask is written whole.
        (global.set $sgrLive (i32.const 0))
        (call $sgrEmit (global.get $markerSgr))
        (call $outCopy (i32.const $mem.pending)
          (i32.add (i32.const $mem.pending) (global.get $pendingLen)))
        (local.set $at (i32.add (local.get $at) (global.get $pendingCols)))
        ;; prefix bytes assume the default state, so anything still on has to
        ;; go off before the rest of the prefix follows the marker
        (if (i32.lt_u (local.get $at) (global.get $prefixLen))
          (then
            (if (global.get $sgrLive) (then (out.str "\1b[0m")))
            (global.set $sgrLive (i32.const 0))
            (call $outCopy (i32.add (i32.const $mem.prefix) (local.get $at))
              (i32.add (i32.const $mem.prefix) (global.get $prefixLen)))))
        (global.set $pendingLen (i32.const 0)))
      (else
        (call $outCopy (i32.const $mem.prefix)
          (i32.add (i32.const $mem.prefix) (global.get $prefixLen)))
        ;; a prefix ends with the terminal in its default state, so the style
        ;; around the line has to be written again from scratch
        (global.set $sgrLive (i32.const 0))))
    (global.set $ansiCol (global.get $prefixCols))
    (if (i32.eqz (global.get $pendingSpace)) (then (call $sgrSync))))

  (func $ansiBlank
    (if (i32.eqz (global.get $needBlank)) (then (return)))
    (call $ansiEol)
    (call $outCopy (i32.const $mem.prefix)
      (i32.add (i32.const $mem.prefix) (global.get $prefixLen)))
    (call $outByte (i32.const 10))
    (global.set $needBlank (i32.const 0)))

  (func $prefixPush (param $ptr i32) (param $len i32) (param $cols i32)
    (if (i32.gt_u (i32.add (global.get $prefixLen) (local.get $len)) (i32.const 700)) (then (return)))
    (memory.copy (i32.add (i32.const $mem.prefix) (global.get $prefixLen))
      (local.get $ptr) (local.get $len))
    (global.set $prefixLen (i32.add (global.get $prefixLen) (local.get $len)))
    (global.set $prefixCols (i32.add (global.get $prefixCols) (local.get $cols))))

  (func $prefixPop (param $len i32) (param $cols i32)
    (if (i32.ge_u (global.get $prefixLen) (local.get $len))
      (then
        (global.set $prefixLen (i32.sub (global.get $prefixLen) (local.get $len)))
        (global.set $prefixCols (i32.sub (global.get $prefixCols) (local.get $cols))))))

  (func $inRanges (param $table i32) (param $count i32) (param $cp i32) (result i32)
    (local $lo i32)
    (local $mid i32)
    (local $at i32)
    (local $first i32)
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $count)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $count)) (i32.const 1)))
        (local.set $at (i32.add (local.get $table) (i32.mul (local.get $mid) (i32.const 6))))
        (local.set $first (i32.load (local.get $at)))
        (if (i32.lt_u (local.get $cp) (local.get $first))
          (then (local.set $count (local.get $mid)))
          (else
            (if (i32.le_u (i32.sub (local.get $cp) (local.get $first))
                  (i32.load16_u offset=4 (local.get $at)))
              (then (return (i32.const 1))))
            (local.set $lo (i32.add (local.get $mid) (i32.const 1)))))
        (br $search)))
    (i32.const 0))

  (func $inRanges4 (param $table i32) (param $count i32) (param $cp i32) (result i32)
    (local $lo i32)
    (local $mid i32)
    (local $range i32)
    (local $first i32)
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $count)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $count)) (i32.const 1)))
        (local.set $range
          (i32.load (i32.add (local.get $table) (i32.shl (local.get $mid) (i32.const 2)))))
        (local.set $first (i32.and (local.get $range) (i32.const 0x1fffff)))
        (if (i32.lt_u (local.get $cp) (local.get $first))
          (then (local.set $count (local.get $mid)))
          (else
            (if (i32.le_u (i32.sub (local.get $cp) (local.get $first))
                  (i32.shr_u (local.get $range) (i32.const 21)))
              (then (return (i32.const 1))))
            (local.set $lo (i32.add (local.get $mid) (i32.const 1)))))
        (br $search)))
    (i32.const 0))

  ;; the number of terminal cells [$p,$e) occupies, ignoring escape sequences
  (func $displayWidth (param $p i32) (param $e i32) (result i32)
    (local $w i32)
    (local $c i32)
    (local $cp i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const 27))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (if (i32.lt_u (local.get $p) (local.get $e))
              (then
                (local.set $c (i32.load8_u (local.get $p)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (if (i32.eq (local.get $c) (i32.const "["))
                  (then
                    (block $escapeDone
                      (loop $escape
                        (br_if $escapeDone (i32.ge_u (local.get $p) (local.get $e)))
                        (local.set $c (i32.load8_u (local.get $p)))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (br_if $escapeDone
                          (i32.le_u (i32.sub (local.get $c) (i32.const 64)) (i32.const 62)))
                        (br $escape)))))))
            (br $l)))
        (if (i32.lt_u (local.get $c) (i32.const 0x80))
          (then
            (if (i32.ge_u (local.get $c) (i32.const 32))
              (then (local.set $w (i32.add (local.get $w) (i32.const 1)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (local.set $cp (call $utf8At (local.get $p) (local.get $e)))
        (if (i32.lt_u (local.get $cp) (i32.const 0x300))
          (then (local.set $w (i32.add (local.get $w) (i32.const 1))))
          (else
            (if (i32.eqz (call $inRanges4
                  (i32.load (i32.const $mem.width+8)) (i32.load (i32.const $mem.width))
                  (local.get $cp)))
              (then (local.set $w (i32.add (local.get $w)
                (select (i32.const 2) (i32.const 1)
                  (call $inRanges
                    (i32.load (i32.const $mem.width+12))
                    (i32.load (i32.const $mem.width+4)) (local.get $cp)))))))))
        (local.set $p (i32.add (local.get $p) (call $utf8Width (local.get $c))))
        (br $l)))
    (local.get $w))

  (func $ansiBlockOpen (param $t i32) (param $r i32)
    (local $n i32)
    (local $num i32)
    (local $p i32)
    (local $q i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then
        (call $ansiBlank)
        (call $ansiEol)
        (call $prefixPush (i32.const $mem.quoteBar) (i32.const 19) (i32.const 2))
        (call $sgrOn (i32.const $S.dim))
        (global.set $needBlank (i32.const 0))
        (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.ul)) (i32.eq (local.get $t) (enum.get $Blk.ol)))
      (then
        (call $ansiEol)
        (if (i32.eqz (global.get $listDepth)) (then (call $ansiBlank)))
        (global.set $needBlank (i32.const 0))
        (global.set $listDepth (i32.add (global.get $listDepth) (i32.const 1)))
        (i32.store offset=$mem.listNum (i32.mul (global.get $listDepth) (i32.const 4))
          (i32.load offset=8 (local.get $r)))
        (i32.store8 offset=$mem.listKind (global.get $listDepth) (local.get $t))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then
        (call $ansiEol)
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
            (local.set $q (i32.const $mem.numbufEnd))
            (loop $digit
              (local.set $q (i32.sub (local.get $q) (i32.const 1)))
              (i32.store8 (local.get $q)
                (i32.add (i32.const "0") (i32.rem_u (local.get $num) (i32.const 10))))
              (local.set $num (i32.div_u (local.get $num) (i32.const 10)))
              (br_if $digit (local.get $num)))
            (local.set $n (i32.sub (i32.const $mem.numbufEnd) (local.get $q)))
            (memory.copy (local.get $p) (local.get $q) (local.get $n))
            (i32.store8 (i32.add (local.get $p) (local.get $n)) (i32.const "."))
            (i32.store8 (i32.add (local.get $p) (i32.add (local.get $n) (i32.const 1)))
              (i32.const 32))
            (local.set $n (i32.add (local.get $n) (i32.const 2)))
            (global.set $markerSgr (global.get $sgr))
            (global.set $pendingLen (local.get $n))
            (global.set $pendingCols (local.get $n)))
          (else
            ;; Bullets cycle with nesting depth.
            (memory.copy (local.get $p)
              (i32.add (i32.const $mem.bullet)
                (i32.mul
                  (i32.rem_u (i32.sub (global.get $listDepth) (i32.const 1)) (i32.const 3))
                  (i32.const 4)))
              (i32.const 4))
            (global.set $markerSgr (i32.or (global.get $sgr) (i32.const $S.bold)))
            (global.set $pendingLen (i32.const 4))
            (global.set $pendingCols (i32.const 2))
            (local.set $n (i32.const 2))))
        (i32.store8 offset=$mem.itemIndent (global.get $listDepth) (local.get $n))
        (global.set $pendingAt (global.get $prefixLen))
        (call $prefixPush (i32.const $mem.spaces) (local.get $n) (local.get $n))
        (global.set $needBlank (i32.const 0))
        (return))))

  (func $ansiBlockClose (param $t i32)
    (local $n i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.quote))
      (then
        (call $ansiEol)
        (call $sgrOff (i32.const $S.dim))
        (call $prefixPop (i32.const 19) (i32.const 2))
        (global.set $needBlank (i32.const 1))
        (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.ul)) (i32.eq (local.get $t) (enum.get $Blk.ol)))
      (then
        (call $ansiEol)
        (global.set $listDepth (i32.sub (global.get $listDepth) (i32.const 1)))
        (global.set $needBlank (i32.const 1))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then
        (call $ansiEol)
        (local.set $n (i32.load8_u offset=$mem.itemIndent (global.get $listDepth)))
        (call $prefixPop (local.get $n) (local.get $n))
        ;; a loose list keeps its items apart
        (global.set $needBlank (i32.and (i32.gt_u (global.get $rsp) (i32.const 0))
          (i32.eqz (i32.load8_u offset=1
            (call $rsAt (i32.sub (global.get $rsp) (i32.const 1)))))))
        (return))))

  (func $ansiLeaf (param $t i32) (param $r i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
    (if (i32.eq (local.get $t) (enum.get $Blk.hr))
      (then
        (call $ansiBlank)
        (call $ansiIndent)
        (call $sgrOn (i32.const $S.dim))
        (call $ansiRule (i32.sub (call $lineWidth) (global.get $prefixCols)))
        (call $sgrOff (i32.const $S.dim))
        (call $ansiEol)
        (global.set $needBlank (i32.const 1))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.p))
      (then
        (call $ansiBlank)
        (call $ansiIndent)
        (if (global.get $pendingTask)
          (then
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
            (global.set $pendingTask (i32.const 0))))
        (call $renderInline (local.get $r))
        (call $ansiEol)
        (global.set $needBlank (i32.eqz (call $tightParagraph)))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.heading))
      (then
        (call $ansiBlank)
        (call $ansiIndent)
        (local.set $n (select (i32.const $S.h1) (i32.const $S.hN)
          (i32.eq (i32.load offset=8 (local.get $r)) (i32.const 1))))
        (call $sgrOn (local.get $n))
        (call $renderInline (local.get $r))
        (call $sgrOff (local.get $n))
        (call $ansiEol)
        (global.set $needBlank (i32.const 1))
        (return)))
    (if (i32.or (i32.eq (local.get $t) (enum.get $Blk.code)) (i32.eq (local.get $t) (enum.get $Blk.html)))
      (then
        (call $ansiBlank)
        (local.set $n (i32.load offset=$R.nLines (local.get $r)))
        (block $done
          (loop $l
            (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
            (local.set $line (call $lineAt (local.get $r) (local.get $i)))
            (call $ansiIndent)
            (call $sgrOn (i32.const $S.dim))
            (out.str "  ")
            (call $outCopy (call $lineBeg (local.get $line)) (call $lineEndOf (local.get $line)))
            (call $sgrOff (i32.const $S.dim))
            (call $ansiEol)
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (global.set $needBlank (i32.const 1))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.table))
      (then (call $ansiTable (local.get $r)) (return))))

  (func $lineWidth (result i32)
    (select (global.get $wrap) (i32.const 76) (global.get $wrap)))

  (func $ansiRule (param $cols i32)
    (if (i32.lt_s (local.get $cols) (i32.const 1)) (then (return)))
    (if (i32.gt_u (local.get $cols) (i32.const 200)) (then (local.set $cols (i32.const 200))))
    (block $done
      (loop $l
        (br_if $done (i32.le_s (local.get $cols) (i32.const 0)))
        (out.str "\e2\94\80")
        (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 1)))
        (local.set $cols (i32.sub (local.get $cols) (i32.const 1)))
        (br $l))))

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
    (call $ansiBlank)
    (local.set $cols (i32.load offset=8 (local.get $r)))
    (if (i32.gt_u (local.get $cols) (i32.const 256)) (then (local.set $cols (i32.const 256))))
    (local.set $rows (i32.load offset=$R.nLines (local.get $r)))
    ;; measure every cell first, so the columns can be aligned
    (block $measured
      (loop $rl
        (br_if $measured (i32.ge_u (local.get $row) (local.get $rows)))
        (local.set $line (call $lineAt (local.get $r) (local.get $row)))
        (local.set $p (call $lineBeg (local.get $line)))
        (local.set $end (call $lineEndOf (local.get $line)))
        (if (i32.lt_u (local.get $p) (local.get $end))
          (then
            (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "|"))
              (then
                (local.set $p
                  (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))))
        (local.set $i (i32.const 0))
        (block $cells
          (loop $cl
            (br_if $cells (i32.ge_u (local.get $i) (local.get $cols)))
            (local.set $w (i32.const 0))
            (local.set $has (call $cellRange (local.get $p) (local.get $end)))
            (local.set $p (global.get $cellNext))
            (if (local.get $has)
              (then
                (local.set $w
                  (call $measureCell (global.get $cellBeg) (global.get $cellEnd)))))
            (if (i32.lt_u (local.get $cell) (i32.const $mem.cellWidthSlots))
              (then
                (i32.store offset=$mem.cellWidth
                  (i32.mul (local.get $cell) (i32.const 4))
                  (local.get $w))))
            (if (i32.eqz (local.get $row))
              (then (i32.store offset=$mem.column (i32.mul (local.get $i) (i32.const 4))
                (local.get $w)))
              (else
                (if (i32.gt_u (local.get $w)
                      (i32.load offset=$mem.column (i32.mul (local.get $i) (i32.const 4))))
                  (then (i32.store offset=$mem.column (i32.mul (local.get $i) (i32.const 4))
                    (local.get $w))))))
            (local.set $cell (i32.add (local.get $cell) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $cl)))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br $rl)))
    (local.set $row (i32.const 0))
    (block $emitted
      (loop $rl
        (br_if $emitted (i32.ge_u (local.get $row) (local.get $rows)))
        (call $ansiTableRow (local.get $r) (local.get $row) (local.get $cols))
        (if (i32.eqz (local.get $row))
          (then (call $ansiTableRule (local.get $cols))))
        (local.set $row (i32.add (local.get $row) (i32.const 1)))
        (br $rl)))
    (global.set $needBlank (i32.const 1)))

  ;; render a cell, measure it, and rewind the output. Style state is snapshotted
  ;; because a held-back space defers $sgrSet: emitting into a buffer that is
  ;; then discarded would leave $sgrLive claiming bytes that are no longer there.
  (func $measureCell (param $beg i32) (param $end i32) (result i32)
    (local $save i32)
    (local $w i32)
    (local $saveCol i32)
    (local $saveStart i32)
    (local $saveSpace i32)
    (local $saveSgr i32)
    (local $saveLive i32)
    (local $saveDepth i64)
    (local.set $save (global.get $out))
    (local.set $saveCol (global.get $ansiCol))
    (local.set $saveStart (global.get $atLineStart))
    (local.set $saveSpace (global.get $pendingSpace))
    (local.set $saveSgr (global.get $sgr))
    (local.set $saveLive (global.get $sgrLive))
    (local.set $saveDepth (i64.load (i32.const $mem.sgr)))
    (global.set $atLineStart (i32.const 0))
    (global.set $noWrap (i32.const 1))
    (call $renderCell (local.get $beg) (local.get $end))
    (global.set $noWrap (i32.const 0))
    ;; a trailing space held back by $ansiRaw is still a column
    (local.set $w (i32.add (call $displayWidth (local.get $save) (global.get $out))
      (global.get $pendingSpace)))
    (global.set $out (local.get $save))
    (global.set $ansiCol (local.get $saveCol))
    (global.set $atLineStart (local.get $saveStart))
    (global.set $pendingSpace (local.get $saveSpace))
    (global.set $sgr (local.get $saveSgr))
    (global.set $sgrLive (local.get $saveLive))
    (i64.store (i32.const $mem.sgr) (local.get $saveDepth))
    (local.get $w))

  (func $ansiTableRow (param $r i32) (param $row i32) (param $cols i32)
    (local $line i32)
    (local $i i32)
    (local $w i32)
    (local $want i32)
    (local $align i32)
    (local $pad i32)
    (local $p i32)
    (local $end i32)
    (local $has i32)
    (local $beg i32)
    (local $cellTo i32)
    (local $cell i32)
    (local.set $cell (i32.mul (local.get $row) (local.get $cols)))
    (local.set $line (call $lineAt (local.get $r) (local.get $row)))
    (local.set $p (call $lineBeg (local.get $line)))
    (local.set $end (call $lineEndOf (local.get $line)))
    (if (i32.lt_u (local.get $p) (local.get $end))
      (then
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "|"))
          (then
            (local.set $p
              (call $skipSpace (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))))
    (call $ansiIndent)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $cols)))
        (if (local.get $i)
          (then
            (call $sgrOn (i32.const $S.dim))
            (out.str " \e2\94\82 ")
            (call $sgrOff (i32.const $S.dim))
            (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 3)))))
        (local.set $has (call $cellRange (local.get $p) (local.get $end)))
        (local.set $p (global.get $cellNext))
        (local.set $beg (global.get $cellBeg))
        (local.set $cellTo (global.get $cellEnd))
        (local.set $want (i32.load offset=$mem.column (i32.mul (local.get $i) (i32.const 4))))
        (local.set $w (i32.const 0))
        (if (local.get $has)
          (then
            (if (i32.lt_u (local.get $cell) (i32.const $mem.cellWidthSlots))
              (then
                (local.set $w (i32.load offset=$mem.cellWidth
                  (i32.mul (local.get $cell) (i32.const 4)))))
              (else
                (local.set $w (call $measureCell (local.get $beg) (local.get $cellTo)))))))
        (local.set $align (i32.load8_u
          (i32.add (i32.add (local.get $r) (i32.const $R.header)) (local.get $i))))
        (local.set $pad (i32.sub (local.get $want) (local.get $w)))
        (if (i32.lt_s (local.get $pad) (i32.const 0)) (then (local.set $pad (i32.const 0))))
        (if (i32.eq (local.get $align) (i32.const $A.right))
          (then (call $ansiSpaces (local.get $pad)) (local.set $pad (i32.const 0))))
        (if (i32.eq (local.get $align) (i32.const $A.center))
          (then
            (call $ansiSpaces (i32.shr_u (local.get $pad) (i32.const 1)))
            (local.set $pad (i32.sub (local.get $pad) (i32.shr_u (local.get $pad) (i32.const 1))))))
        (if (i32.eqz (local.get $row)) (then (call $sgrOn (i32.const $S.bold))))
        (global.set $noWrap (i32.const 1))
        (if (local.get $has)
          (then (call $renderCell (local.get $beg) (local.get $cellTo))))
        (global.set $noWrap (i32.const 0))
        ;; commit a held-back space (it belongs to this cell) and the style that
        ;; was waiting on it, so the separator does not inherit a deferred close
        (call $ansiFlushSpace)
        (if (i32.eqz (local.get $row)) (then (call $sgrOff (i32.const $S.bold))))
        ;; the last column needs no trailing padding
        (if (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $cols))
          (then (call $ansiSpaces (local.get $pad))))
        (local.set $cell (i32.add (local.get $cell) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (call $ansiEol))

  (func $ansiTableRule (param $cols i32)
    (local $i i32)
    (call $ansiIndent)
    (call $sgrOn (i32.const $S.dim))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $cols)))
        (if (local.get $i) (then (out.str "\e2\94\80\e2\94\bc\e2\94\80")))
        (call $ansiRule (i32.load offset=$mem.column (i32.mul (local.get $i) (i32.const 4))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (call $sgrOff (i32.const $S.dim))
    (call $ansiEol))

  (func $ansiSpaces (param $n i32)
    (if (i32.le_s (local.get $n) (i32.const 0)) (then (return)))
    (if (i32.gt_u (local.get $n) (i32.const 256)) (then (local.set $n (i32.const 256))))
    (call $ensureOut (i32.add (local.get $n) (i32.const 16)))
    (memory.fill (global.get $out) (i32.const 32) (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n)))
    (global.set $ansiCol (i32.add (global.get $ansiCol) (local.get $n))))

  ;; Write text a word at a time, wrapping at the configured width. When
  ;; $content is set the range is an offset into the current content. Its base
  ;; is re-read on every step because copied content can move with scratch.
  (func $ansiRaw (param $p i32) (param $e i32) (param $content i32)
    (local $q i32)
    (local $w i32)
    (local $c i32)
    (local $base i32)
    (local $ascii i32)
    (block $done
      (loop $l
        (local.set $base
          (select (call $contentAt (i32.const 0)) (i32.const 0) (local.get $content)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $p))))
        (if (i32.eq (local.get $c) (i32.const 10))
          (then
            (call $ansiEol)
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if (call $isSpaceByte (local.get $c))
          (then
            ;; a space is only committed once the next word is placed, so a
            ;; wrapped line never ends in one
            (if (i32.or (i32.eqz (global.get $atLineStart))
                  (i32.gt_u (global.get $ansiCol) (global.get $prefixCols)))
              (then (global.set $pendingSpace (i32.const 1))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        ;; one word
        (local.set $q (local.get $p))
        (local.set $ascii (i32.const 1))
        (block $word
          (loop $b
            (br_if $word (i32.ge_u (local.get $q) (local.get $e)))
            (local.set $c (i32.load8_u (i32.add (local.get $base) (local.get $q))))
            (br_if $word (i32.eq (local.get $c) (i32.const 10)))
            (br_if $word (call $isSpaceByte (local.get $c)))
            ;; Printable ASCII is one column per byte. Controls and UTF-8 keep
            ;; the full width path, but do not stop the word scan.
            (if (i32.ge_u (i32.sub (local.get $c) (i32.const 32)) (i32.const 96))
              (then (local.set $ascii (i32.const 0))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $b)))
        (if (local.get $ascii)
          (then (local.set $w (i32.sub (local.get $q) (local.get $p))))
          (else
            (local.set $w (call $displayWidth
              (i32.add (local.get $base) (local.get $p))
              (i32.add (local.get $base) (local.get $q))))))
        (if (i32.and
              (i32.and (i32.gt_u (global.get $wrap) (i32.const 0)) (i32.eqz (global.get $noWrap)))
              (i32.and
                (i32.eqz (global.get $atLineStart))
                (i32.gt_u
                  (i32.add (i32.add (global.get $ansiCol) (global.get $pendingSpace)) (local.get $w))
                  (global.get $wrap))))
          (then (call $ansiEol)))
        (call $ansiFlushSpace)
        (call $ensureOut (i32.add (i32.sub (local.get $q) (local.get $p)) (i32.const 32)))
        (local.set $base
          (select (call $contentAt (i32.const 0)) (i32.const 0) (local.get $content)))
        (call $outCopy (i32.add (local.get $base) (local.get $p))
          (i32.add (local.get $base) (local.get $q)))
        (global.set $ansiCol (i32.add (global.get $ansiCol) (local.get $w)))
        (local.set $p (local.get $q))
        (br $l))))

  ;; commit the space a previous word held back, before anything that would
  ;; otherwise be written on the far side of it
  (func $ansiFlushSpace
    (call $ansiIndent)
    (if (global.get $pendingSpace)
      (then
        (call $outByte (i32.const 32))
        (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 1)))
        (global.set $pendingSpace (i32.const 0))))
    (call $sgrSync))

  (func $ansiRawSpace
    (call $ansiIndent)
    (if (i32.gt_u (global.get $ansiCol) (global.get $prefixCols))
      (then
        (call $outByte (i32.const 32))
        (global.set $ansiCol (i32.add (global.get $ansiCol) (i32.const 1)))))
    (global.set $pendingSpace (i32.const 0))
    (call $sgrSync))

  (func $ansiAutolink
    (call $sgrOn (i32.const $S.linkText))
    (call $ansiRaw (global.get $linkUrlBeg) (global.get $linkUrlEnd) (global.get $linkInContent))
    (call $sgrOff (i32.const $S.linkText)))

  (func $ansiFootnotesOpen
    (global.set $needBlank (i32.const 1))
    (call $ansiBlank)
    (call $ansiIndent)
    (call $sgrOn (i32.const $S.dim))
    (call $ansiRule (i32.sub (call $lineWidth) (global.get $prefixCols)))
    (call $sgrOff (i32.const $S.dim))
    (call $ansiEol)
    (global.set $needBlank (i32.const 1)))

  (func $ansiFootnoteOpen (param $n i32)
    (local $w i32)
    (call $ansiBlank)
    (call $ansiEol)
    (call $ansiIndent)
    (call $sgrOn (i32.const $S.link))
    (call $outByte (i32.const "["))
    (call $outNum (local.get $n))
    (out.str "] ")
    (call $sgrOff (i32.const $S.link))
    (local.set $w (i32.add (i32.const 3) (select (i32.const 1) (i32.const 2)
      (i32.lt_u (local.get $n) (i32.const 10)))))
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
    "                                ")
)
