(module
  (import "./memory.wat")
  (import "./scan.wat")
  (import "./out.wat")

  ;; TeX math to SVG. Lays out boxes while parsing a copy of the source at
  ;; $mem.mathSrc, as in TeX's appendix G: atoms collect on a stack until their
  ;; list ends, then scripts attach and inter-atom spaces apply. Lengths are
  ;; thousandths of the surrounding em. Metrics come from STIX Two Math
  ;; (tables/math-metrics.txt); glyphs print as Unicode math alphanumerics.
  ;; glyph metrics in five columns of $MG.stride bytes, then the runs
  (const $MG.stride 1400)
  (const $MG.h $mem.mathGlyphs+1400)
  (const $MG.ic $mem.mathGlyphs+2800)
  (const $MG.w $mem.mathGlyphs+4200)
  (const $MG.acc $mem.mathGlyphs+5600)
  (const $mem.mathRuns $mem.mathGlyphs+7000)
  (math-glyphs $mem.mathGlyphs $mem.mathGlyphsEnd $MG.stride)
  ;; atoms use the first half of their area; command groups that do not fit
  ;; their area and the macro bodies take the second
  (const $m.atomsEnd $mem.mathAtoms+8192)
  (math-commands $mem.mathCmds $mem.mathCmdsEnd $mem.mathNodes $mem.mathNodesEnd $m.atomsEnd $mem.mathAtomsEnd)

  (data (i32.const $mem.mathStatic) "mod\00#c00")
  (const $mem.mathEnvs $mem.mathStatic+8)
  (data (i32.const $mem.mathEnvs)
    "\06matrix\00\00\07pmatrix\20\01\07bmatrix\40\02\07Bmatrix\60\03\07vmatrix\80\04\07Vmatrix\a0\05\0bsmallmatrix\10\00\05cases\61\00\06dcases\69\00\06rcases\01\03\07aligned\0a\00\05align\0a\00\06align*\0a\00\05split\0a\00\07flalign\0a\00\08flalign*\0a\00\07alignat\0a\08\08alignat*\0a\08\09alignedat\0a\08\08gathered\0b\00\06gather\0b\00\07gather*\0b\00\08equation\0b\00\09equation*\0b\00\08multline\0b\00\09multline*\0b\00\05array\04\00\06darray\0c\00\08subarray\14\00\02CD\00\00\00")

  ;; Spacing between atom classes (ord op bin rel open close punct inner),
  ;; left class times eight plus right class: 1 thin, 2 medium, 3 thick, plus
  ;; 4 when script styles drop it.
  (const $mem.mathSpacing $mem.mathStatic+664)
  (data (i32.const $mem.mathSpacing)
    "\00\01\06\07\00\00\00\05"
    "\01\01\00\07\00\00\00\05"
    "\06\06\00\00\06\00\00\06"
    "\07\07\00\00\07\00\00\07"
    "\00\00\00\00\00\00\00\00"
    "\00\01\06\07\00\00\00\05"
    "\05\05\00\05\05\05\05\05"
    "\05\01\06\07\05\00\05\05")

  ;; Layout constants from the MATH table of STIX Two Math, in thousandths of an em.
  (const $MC.axis 258)
  (const $MC.rule 68)
  (const $MC.accentBase 480)
  (const $MC.subShift 210)
  (const $MC.subTopMax 368)
  (const $MC.subDrop 160)
  (const $MC.supShift 360)
  (const $MC.supShiftCramped 252)
  (const $MC.supBottomMin 120)
  (const $MC.supDrop 230)
  (const $MC.subSupGap 150)
  (const $MC.supBottomMaxWithSub 380)
  (const $MC.spaceAfterScript 40)
  (const $MC.upperGap 135)
  (const $MC.upperRise 300)
  (const $MC.lowerGap 135)
  (const $MC.lowerDrop 670)
  (const $MC.stackTop 470)
  (const $MC.stackTopDisplay 780)
  (const $MC.stackBottom 385)
  (const $MC.stackBottomDisplay 690)
  (const $MC.stackGap 150)
  (const $MC.stackGapDisplay 300)
  (const $MC.numShift 585)
  (const $MC.numShiftDisplay 640)
  (const $MC.denomShift 585)
  (const $MC.denomShiftDisplay 640)
  (const $MC.fracGap 68)
  (const $MC.fracGapDisplay 150)
  (const $MC.overbarGap 175)
  (const $MC.radicalGap 85)
  (const $MC.radicalGapDisplay 170)
  (const $MC.radicalAscender 78)
  (const $MC.radicalKernBefore 65)
  (const $MC.radicalKernAfter 335) ;; subtracted
  (const $MC.radicalRaise 55)

  (const $N.size 48)
  (const $N.max 2730)
  (const $N.kind 0)   ;; u8 $NK
  (const $N.class 1)  ;; u8 atom class of a glyph; 1 on an accent over one glyph
  (const $N.scale 2)  ;; u16 font size, thousandths
  (const $N.x 4)
  (const $N.y 8)      ;; down is positive
  (const $N.w 12)
  (const $N.h 16)
  (const $N.d 20)
  (const $N.a 24)     ;; glyph code point, first child, path shape, text start
  (const $N.next 28)
  (const $N.ic 32)    ;; italic correction
  (const $N.e 36)     ;; glyph flags, list color, path parameter, text length and flags
  (const $N.tail 40)
  (const $N.acc 44)   ;; glyph top accent position less half its width

  (const $NK.kern 0)
  (const $NK.glyph 1)
  (const $NK.list 2)
  (const $NK.rule 3)
  (const $NK.path 4)
  (const $NK.text 5)

  ;; node indexes of the nucleus and scripts (u16), class, flags; a \left
  ;; delimiter keeps its code point in place of the scripts
  (const $A.size 8)
  (const $A.sup 2)
  (const $A.sub 4)
  (const $A.class 6)
  (const $A.flags 7)
  (const $AF.limits 1)
  (const $AF.nolimits 2)
  (const $AF.displayLimits 4)
  (const $AF.op 8)
  (const $AF.middle 16)

  (const $P.brace 1)
  (const $P.single 2)
  (const $P.leadOrd 4)
  (const $P.cell 8)
  (const $P.dollar 16)
  (const $P.right 32)
  (const $P.bracket 64)
  ;; a macro body: its atoms join the list that is reading the command
  (const $P.inline 128)

  ;; command kinds of tables/math.txt
  (const $K.frac 8)
  (const $K.left 10)
  (const $K.font 12)
  (const $K.text 13)
  (const $K.space 14)
  (const $K.end 18)
  (const $K.kern 27)
  (const $K.cr 28)
  (const $K.macro 31)

  (global $mN (mut i32) (i32.const 0))
  (global $mA (mut i32) (i32.const 0))
  (global $mC (mut i32) (i32.const 0))
  (global $mFail (mut i32) (i32.const 0))
  (global $mp (mut i32) (i32.const 0))
  (global $me (mut i32) (i32.const 0))
  (global $mDepth (mut i32) (i32.const 0))
  ;; 0 display, 1 text, 2 script, 3 scriptscript; 4 = cramped
  (global $mStyle (mut i32) (i32.const 0))
  (global $mS (mut i32) (i32.const 1000))
  ;; font of letters: -1 default, else the font command's value
  (global $mVariant (mut i32) (i32.const -1))
  (global $mNot (mut i32) (i32.const 0))
  ;; the formula is an open block that may still grow: unknown commands are gray
  (global $mOpen (mut i32) (i32.const 0))
  (global $mLastClass (mut i32) (i32.const 0))
  (global $mHline (mut i32) (i32.const 0))
  (global $cmdP (mut i32) (i32.const 0))
  (global $cmdLen (mut i32) (i32.const 0))
  ;; where the next macro expansion with an argument goes, past the source
  (global $mTop (mut i32) (i32.const 0))
  ;; end of the last copied macro byte a node points to: text and colors
  (global $mPin (mut i32) (i32.const 0))
  ;; end of the pairs at $mem.mathInfix
  (global $mInfix (mut i32) (i32.const 0))
  (global $gD (mut i32) (i32.const 0))
  (global $gH (mut i32) (i32.const 0))
  (global $gI (mut i32) (i32.const 0))
  (global $gW (mut i32) (i32.const 0))
  (global $gA (mut i32) (i32.const 0))

  (func $m.max (param $a i32) (param $b i32) (result i32)
    (select (local.get $a) (local.get $b) (i32.gt_s (local.get $a) (local.get $b))))
  (func $m.min (param $a i32) (param $b i32) (result i32)
    (select (local.get $a) (local.get $b) (i32.lt_s (local.get $a) (local.get $b))))
  ;; $v at the current size
  (func $m.sc (param $v i32) (result i32)
    (i32.div_s (i32.mul (local.get $v) (global.get $mS)) (i32.const 1000)))

  (func $m.setStyle (param $s i32)
    (global.set $mStyle (local.get $s))
    (global.set $mS (i32.load16_u offset=$mem.mathStatic+656
      (i32.shl (i32.and (local.get $s) (i32.const 3)) (i32.const 1)))))
  (data (i32.const $mem.mathStatic+656) "\e8\03\e8\03\bc\02\26\02")

  ;; the style of scripts, fractions, and subscripts of style $s
  (func $m.supStyle (param $s i32) (result i32)
    (i32.or (i32.and (local.get $s) (i32.const 4))
      (select (i32.const 2) (i32.const 3) (i32.lt_u (i32.and (local.get $s) (i32.const 3)) (i32.const 2)))))
  (func $m.fracStyle (param $s i32) (result i32)
    (i32.or (i32.and (local.get $s) (i32.const 4))
      (call $m.min (i32.add (i32.and (local.get $s) (i32.const 3)) (i32.const 1)) (i32.const 3))))

  ;; ---- nodes

  (func $m.nAt (param $i i32) (result i32)
    (i32.add (i32.const $mem.mathNodes) (i32.mul (local.get $i) (i32.const $N.size))))

  ;; A new zeroed node at the current size. On overflow the parse fails and
  ;; this returns node 0, which nothing reads back.
  (func $m.node (param $kind i32) (result i32)
    (local $i i32)
    (local $p i32)
    (local.set $i (i32.add (global.get $mN) (i32.const 1)))
    (if (i32.ge_u (local.get $i) (i32.const $N.max))
      (then
        (global.set $mFail (i32.const 1))
        (local.set $i (i32.const 0)))
      (else (global.set $mN (local.get $i))))
    (local.set $p (call $m.nAt (local.get $i)))
    ;; plain stores: V8 calls out of line for a small memory.fill
    (i64.store (local.get $p) (i64.or (i64.extend_i32_u (local.get $kind))
      (i64.shl (i64.extend_i32_u (global.get $mS)) (i64.const 16))))
    (i64.store offset=8 (local.get $p) (i64.const 0))
    (i64.store offset=16 (local.get $p) (i64.const 0))
    (i64.store offset=24 (local.get $p) (i64.const 0))
    (i64.store offset=32 (local.get $p) (i64.const 0))
    (i64.store offset=40 (local.get $p) (i64.const 0))
    (local.get $i))

  (func $m.W (param $n i32) (result i32) (i32.load offset=$N.w (call $m.nAt (local.get $n))))
  (func $m.H (param $n i32) (result i32) (i32.load offset=$N.h (call $m.nAt (local.get $n))))
  (func $m.D (param $n i32) (result i32) (i32.load offset=$N.d (call $m.nAt (local.get $n))))
  (func $m.IC (param $n i32) (result i32) (i32.load offset=$N.ic (call $m.nAt (local.get $n))))
  (func $m.setBox (param $n i32) (param $w i32) (param $h i32) (param $d i32)
    (local $p i32)
    (local.set $p (call $m.nAt (local.get $n)))
    (i32.store offset=$N.w (local.get $p) (local.get $w))
    (i32.store offset=$N.h (local.get $p) (local.get $h))
    (i32.store offset=$N.d (local.get $p) (local.get $d)))
  (func $m.setW (param $n i32) (param $v i32) (i32.store offset=$N.w (call $m.nAt (local.get $n)) (local.get $v)))
  (func $m.setH (param $n i32) (param $v i32) (i32.store offset=$N.h (call $m.nAt (local.get $n)) (local.get $v)))
  (func $m.setD (param $n i32) (param $v i32) (i32.store offset=$N.d (call $m.nAt (local.get $n)) (local.get $v)))

  (func $m.list (result i32) (call $m.node (i32.const $NK.list)))

  (func $m.kern (param $w i32) (result i32)
    (local $n i32)
    (local.set $n (call $m.node (i32.const $NK.kern)))
    (call $m.setW (local.get $n) (local.get $w))
    (local.get $n))

  ;; Put child $c into list $l at ($x, $y) and grow the list's box over it.
  (func $m.append (param $l i32) (param $c i32) (param $x i32) (param $y i32)
    (local $lp i32)
    (local $cp i32)
    (if (i32.or (i32.eqz (local.get $c)) (i32.eqz (local.get $l))) (then (return)))
    (local.set $lp (call $m.nAt (local.get $l)))
    (local.set $cp (call $m.nAt (local.get $c)))
    (i32.store offset=$N.x (local.get $cp) (local.get $x))
    (i32.store offset=$N.y (local.get $cp) (local.get $y))
    (i32.store offset=$N.next (local.get $cp) (i32.const 0))
    (if (i32.load offset=$N.a (local.get $lp))
      (then (i32.store offset=$N.next (call $m.nAt (i32.load offset=$N.tail (local.get $lp))) (local.get $c)))
      (else (i32.store offset=$N.a (local.get $lp) (local.get $c))))
    (i32.store offset=$N.tail (local.get $lp) (local.get $c))
    (i32.store offset=$N.w (local.get $lp) (call $m.max (i32.load offset=$N.w (local.get $lp))
      (i32.add (local.get $x) (i32.load offset=$N.w (local.get $cp)))))
    (i32.store offset=$N.h (local.get $lp) (call $m.max (i32.load offset=$N.h (local.get $lp))
      (i32.sub (i32.load offset=$N.h (local.get $cp)) (local.get $y))))
    (i32.store offset=$N.d (local.get $lp) (call $m.max (i32.load offset=$N.d (local.get $lp))
      (i32.add (i32.load offset=$N.d (local.get $cp)) (local.get $y)))))

  ;; a list that holds $c at its origin
  (func $m.wrap (param $c i32) (result i32)
    (local $l i32)
    (local.set $l (call $m.list))
    (call $m.append (local.get $l) (local.get $c) (i32.const 0) (i32.const 0))
    (local.get $l))

  ;; ---- glyph metrics

  ;; Look up code point $cp; set $gD $gH $gI $gW $gA (unscaled).
  (func $m.metrics (param $cp i32) (result i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $run i32)
    (local $p i32)
    (local.set $hi (i32.load (i32.const $mem.mathRuns)))
    (block $none
      (loop $search
        (br_if $none (i32.ge_u (local.get $lo) (local.get $hi)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $run (i32.load offset=$mem.mathRuns+4 (i32.mul (local.get $mid) (i32.const 6))))
        (if (i32.lt_u (local.get $cp) (i32.and (local.get $run) (i32.const 0x1fffff)))
          (then
            (local.set $hi (local.get $mid))
            (br $search)))
        (if (i32.gt_u (i32.sub (local.get $cp) (i32.and (local.get $run) (i32.const 0x1fffff)))
              (i32.shr_u (local.get $run) (i32.const 21)))
          (then
            (local.set $lo (i32.add (local.get $mid) (i32.const 1)))
            (br $search)))
        (local.set $p (i32.add
          (i32.load16_u offset=$mem.mathRuns+8 (i32.mul (local.get $mid) (i32.const 6)))
          (i32.sub (local.get $cp) (i32.and (local.get $run) (i32.const 0x1fffff)))))
        (global.set $gD (i32.mul (i32.load8_s offset=$mem.mathGlyphs (local.get $p)) (i32.const 10)))
        (global.set $gH (i32.mul (i32.load8_u offset=$MG.h (local.get $p)) (i32.const 10)))
        (global.set $gI (i32.mul (i32.load8_u offset=$MG.ic (local.get $p)) (i32.const 10)))
        (global.set $gW (i32.mul (i32.load8_u offset=$MG.w (local.get $p)) (i32.const 10)))
        (global.set $gA (i32.mul (i32.load8_s offset=$MG.acc (local.get $p)) (i32.const 10)))
        (return (i32.const 1))))
    (i32.const 0))

  ;; Metrics of $cp, or a guess for a character the table lacks.
  (func $m.metricsAny (param $cp i32)
    (if (call $m.metrics (local.get $cp)) (then (return)))
    (global.set $gI (i32.const 0))
    (global.set $gA (i32.const 0))
    (if (call $isCjkCp (local.get $cp))
      (then
        (global.set $gW (i32.const 1000))
        (global.set $gH (i32.const 880))
        (global.set $gD (i32.const 120)))
      (else
        (global.set $gW (i32.const 600))
        (global.set $gH (i32.const 700))
        (global.set $gD (i32.const 0)))))

  (func $m.glyph (param $cp i32) (param $class i32) (result i32)
    (local $n i32)
    (local $p i32)

    (call $m.metricsAny (local.get $cp))
    (local.set $n (call $m.node (i32.const $NK.glyph)))
    (local.set $p (call $m.nAt (local.get $n)))
    (i32.store8 offset=$N.class (local.get $p) (local.get $class))
    (i32.store offset=$N.a (local.get $p) (local.get $cp))
    (i32.store offset=$N.w (local.get $p) (call $m.sc (global.get $gW)))
    (i32.store offset=$N.h (local.get $p) (call $m.sc (global.get $gH)))
    (i32.store offset=$N.d (local.get $p) (call $m.sc (global.get $gD)))
    (i32.store offset=$N.ic (local.get $p) (call $m.sc (global.get $gI)))
    (i32.store offset=$N.acc (local.get $p) (call $m.sc (global.get $gA)))
    (local.get $n))

  ;; ---- characters and fonts

  ;; Unicode math alphanumerics: the letter at $cp - $from in the block that
  ;; starts at $base, with the reserved holes that the BMP letterlike block
  ;; fills (pairs of code point and replacement at $holes).
  (func $m.alpha (param $cp i32) (param $from i32) (param $base i32) (param $holes i32) (result i32)
    (local $c i32)
    (if (local.get $holes)
      (then
        (loop $h
          (local.set $c (i32.load (local.get $holes)))
          (if (local.get $c)
            (then
              (if (i32.eq (i32.and (local.get $c) (i32.const 0xff)) (local.get $cp))
                (then (return (i32.shr_u (local.get $c) (i32.const 8)))))
              (local.set $holes (i32.add (local.get $holes) (i32.const 4)))
              (br $h))))))
    (i32.add (local.get $base) (i32.sub (local.get $cp) (local.get $from))))
  ;; letter holes: italic, script, fraktur, double-struck (letter | code << 8)
  (const $holes.it $mem.mathStatic+520)
  (data (i32.const $holes.it) "\68\0e\21\00\00\00\00\00")
  (const $holes.scr $mem.mathStatic+528)
  (data (i32.const $holes.scr)
    "\42\2c\21\00\45\30\21\00\46\31\21\00\48\0b\21\00\49\10\21\00\4c\12\21\00\4d\33\21\00\52\1b\21\00\65\2f\21\00\67\0a\21\00\6f\34\21\00\00\00\00\00")
  (const $holes.frak $mem.mathStatic+576)
  (data (i32.const $holes.frak)
    "\43\2d\21\00\48\0c\21\00\49\11\21\00\52\1c\21\00\5a\28\21\00\00\00\00\00")
  (const $holes.bb $mem.mathStatic+600)
  (data (i32.const $holes.bb)
    "\43\02\21\00\48\0d\21\00\4e\15\21\00\50\19\21\00\51\1a\21\00\52\1d\21\00\5a\24\21\00\00\00\00\00")

  ;; the u16 paired with $cp in a list of u16 pairs that ends with a 0 key, or 0
  (func $m.pair (param $p i32) (param $cp i32) (result i32)
    (loop $l
      (if (i32.eq (i32.load16_u (local.get $p)) (local.get $cp))
        (then (return (i32.load16_u offset=2 (local.get $p)))))
      (local.set $p (i32.add (local.get $p) (i32.const 4)))
      (br_if $l (i32.load16_u (local.get $p))))
    (i32.const 0))

  ;; Greek variant letters (ϵ ϑ ϰ ϕ ϱ ϖ) and their index plus one
  (const $pairs.greek $mem.mathStatic+728)
  (data (i32.const $pairs.greek) "\f5\03\01\00\d1\03\02\00\f0\03\03\00\d5\03\04\00\f1\03\05\00\d6\03\06\00\00\00")

  ;; A Greek letter in the block whose capital alpha is at $upper; lowercase
  ;; letters follow 26 later, and the variants 26 after the lowercase.
  (func $m.greek (param $cp i32) (param $upper i32) (result i32)
    (local $v i32)
    (if (i32.le_u (i32.sub (local.get $cp) (i32.const 0x391)) (i32.const 0x18))
      (then (return (i32.add (local.get $upper) (i32.sub (local.get $cp) (i32.const 0x391))))))
    (if (i32.le_u (i32.sub (local.get $cp) (i32.const 0x3b1)) (i32.const 0x18))
      (then (return (i32.add (local.get $upper) (i32.sub (local.get $cp) (i32.const 0x397))))))
    (local.set $v (call $m.pair (i32.const $pairs.greek) (local.get $cp)))
    (if (local.get $v)
      (then (return (i32.add (local.get $upper) (i32.add (local.get $v) (i32.const 0x33))))))
    (local.get $cp))

  ;; The code point that prints letter, digit or Greek letter $cp in the
  ;; current font ($mVariant, the value of the font command).
  (func $m.styled (param $cp i32) (result i32)
    (local $v i32)
    (local $upper i32)
    (local $lower i32)
    (local $greek i32)
    (local $lowGreek i32)
    (local.set $v (global.get $mVariant))
    (local.set $upper (i32.le_u (i32.sub (local.get $cp) (i32.const "A")) (i32.const 25)))
    (local.set $lower (i32.le_u (i32.sub (local.get $cp) (i32.const "a")) (i32.const 25)))
    (local.set $lowGreek (i32.le_u (i32.sub (local.get $cp) (i32.const 0x3b1)) (i32.const 0x18)))
    (if (i32.gt_u (local.get $cp) (i32.const 0x3c9))
      (then (local.set $lowGreek (call $m.pair (i32.const $pairs.greek) (local.get $cp)))))
    (local.set $greek (i32.or (local.get $lowGreek)
      (i32.le_u (i32.sub (local.get $cp) (i32.const 0x391)) (i32.const 0x18))))
    (if (call $isDigit (local.get $cp))
      (then
        ;; bold, double-struck, sans-serif, monospace digits
        (if (i32.or (i32.eq (local.get $v) (i32.const 2)) (i32.eq (local.get $v) (i32.const 9)))
          (then (return (i32.add (local.get $cp) (i32.const 0x1d79e)))))
        (if (i32.eq (local.get $v) (i32.const 3)) (then (return (i32.add (local.get $cp) (i32.const 0x1d7a8)))))
        (if (i32.eq (local.get $v) (i32.const 7)) (then (return (i32.add (local.get $cp) (i32.const 0x1d7b2)))))
        (if (i32.eq (local.get $v) (i32.const 8)) (then (return (i32.add (local.get $cp) (i32.const 0x1d7c6)))))
        (return (local.get $cp))))
    (if (local.get $greek)
      (then
        (if (i32.eq (local.get $v) (i32.const 2)) (then (return (call $m.greek (local.get $cp) (i32.const 0x1d6a8)))))
        (if (i32.eq (local.get $v) (i32.const 9)) (then (return (call $m.greek (local.get $cp) (i32.const 0x1d71c)))))
        ;; capitals are upright unless \mathit; \mathrm makes all upright
        (if (i32.or (i32.eqz (local.get $v))
              (i32.and (i32.eqz (local.get $lowGreek)) (i32.ne (local.get $v) (i32.const 1))))
          (then (return (local.get $cp))))
        (return (call $m.greek (local.get $cp) (i32.const 0x1d6e2)))))
    (if (i32.eqz (i32.or (local.get $upper) (local.get $lower))) (then (return (local.get $cp))))
    (block $style
      (block $mono
        (block $sans
          (block $frak
            (block $script
              (block $bb
                (block $bold
                  (block $rm
                    (br_table $rm $style $bold $bb $script $script $frak $sans $mono $style $style
                      (local.get $v)))
                  (return (local.get $cp)))
                (return (select (i32.add (local.get $cp) (i32.const 0x1d3bf)) (i32.add (local.get $cp) (i32.const 0x1d3b9))
                  (local.get $upper))))
              (return (select (call $m.alpha (local.get $cp) (i32.const "A") (i32.const 0x1d538) (i32.const $holes.bb))
                (call $m.alpha (local.get $cp) (i32.const "a") (i32.const 0x1d552) (i32.const 0))
                (local.get $upper))))
            (return (select (call $m.alpha (local.get $cp) (i32.const "A") (i32.const 0x1d49c) (i32.const $holes.scr))
              (call $m.alpha (local.get $cp) (i32.const "a") (i32.const 0x1d4b6) (i32.const $holes.scr))
              (local.get $upper))))
          (return (select (call $m.alpha (local.get $cp) (i32.const "A") (i32.const 0x1d504) (i32.const $holes.frak))
            (call $m.alpha (local.get $cp) (i32.const "a") (i32.const 0x1d51e) (i32.const 0))
            (local.get $upper))))
        (return (i32.add (local.get $cp) (select (i32.const 0x1d55f) (i32.const 0x1d559) (local.get $upper)))))
      (return (i32.add (local.get $cp) (select (i32.const 0x1d62f) (i32.const 0x1d629) (local.get $upper)))))
    ;; italic, or bold italic for \boldsymbol
    (if (i32.eq (local.get $v) (i32.const 9))
      (then (return (select (i32.add (local.get $cp) (i32.const 0x1d427)) (i32.add (local.get $cp) (i32.const 0x1d421))
        (local.get $upper)))))
    (select (call $m.alpha (local.get $cp) (i32.const "A") (i32.const 0x1d434) (i32.const 0))
      (call $m.alpha (local.get $cp) (i32.const "a") (i32.const 0x1d44e) (i32.const $holes.it))
      (local.get $upper)))

  (func $m.letter (param $cp i32) (result i32)
    (call $m.glyph (call $m.styled (local.get $cp)) (i32.const 0)))

  ;; relations and their negated forms after \not
  (const $pairs.not $mem.mathStatic+320)
  (data (i32.const $pairs.not)
    "\3d\00\60\22\08\22\09\22\3c\00\6e\22\3e\00\6f\22\61\22\62\22\82\22\84\22\83\22\85\22\86\22\88\22\87\22\89\22\3c\22\41\22\48\22\49\22\64\22\70\22\65\22\71\22\45\22\47\22\23\22\24\22\25\22\26\22\0b\22\0c\22\03\22\04\22\00\00")

  ;; A symbol glyph from the command table or the input, negated after \not.
  (func $m.symbol (param $cp i32) (param $class i32) (result i32)
    (local $n i32)
    (local $neg i32)
    (if (i32.or (i32.le_u (i32.sub (local.get $cp) (i32.const 0x391)) (i32.const 0x64))
          (i32.lt_u (local.get $cp) (i32.const 128)))
      (then
        (if (i32.or (call $isAlnum (local.get $cp))
              (i32.ge_u (local.get $cp) (i32.const 0x391)))
          (then (return (call $m.letter (local.get $cp)))))))
    (if (global.get $mNot)
      (then
        (local.set $neg (call $m.pair (i32.const $pairs.not) (local.get $cp)))
        (if (local.get $neg)
          (then
            (local.set $cp (local.get $neg))
            (global.set $mNot (i32.const 0))))))
    (local.set $n (call $m.glyph (local.get $cp) (local.get $class)))
    (if (global.get $mNot)
      (then
        (i32.store offset=$N.e (call $m.nAt (local.get $n)) (i32.const 2))
        (global.set $mNot (i32.const 0))))
    (local.get $n))

  ;; ---- the atom stack

  (func $m.push (param $nuc i32) (param $class i32) (param $flags i32)
    (local $a i32)
    (local.set $a (global.get $mA))
    (if (i32.ge_u (local.get $a) (i32.const $m.atomsEnd))
      (then (global.set $mFail (i32.const 1)) (return)))
    (i64.store (local.get $a) (i64.or (i64.extend_i32_u (local.get $nuc))
      (i64.shl (i64.extend_i32_u (i32.or (local.get $class) (i32.shl (local.get $flags) (i32.const 8))))
        (i64.const 48))))
    (global.set $mNot (i32.const 0))
    (global.set $mA (i32.add (local.get $a) (i32.const $A.size))))

  ;; Attach scripts: TeX's rule 18, or limits above and below.
  (func $m.atomBox (param $a i32) (result i32)
    (local $nuc i32)
    (local $sup i32)
    (local $sub i32)
    (local $flags i32)
    (local $l i32)
    (local $u i32)
    (local $v i32)
    (local $gap i32)
    (local $w i32)
    (local $x i32)
    (local $ic i32)
    (local.set $nuc (i32.load16_u (local.get $a)))
    (local.set $sup (i32.load16_u offset=$A.sup (local.get $a)))
    (local.set $sub (i32.load16_u offset=$A.sub (local.get $a)))
    (local.set $flags (i32.load8_u offset=$A.flags (local.get $a)))
    (if (i32.eqz (i32.or (local.get $sup) (local.get $sub))) (then (return (local.get $nuc))))
    (local.set $ic (call $m.IC (local.get $nuc)))
    (local.set $l (call $m.list))
    (if (i32.or (i32.and (local.get $flags) (i32.const $AF.limits))
          (i32.and (i32.ne (i32.and (local.get $flags) (i32.const $AF.displayLimits)) (i32.const 0))
            (i32.and (i32.eqz (i32.and (global.get $mStyle) (i32.const 3)))
              (i32.eqz (i32.and (local.get $flags) (i32.const $AF.nolimits))))))
      (then
        (local.set $w (call $m.max (call $m.W (local.get $nuc))
          (call $m.max (call $m.W (local.get $sup)) (call $m.W (local.get $sub)))))
        (call $m.append (local.get $l) (local.get $nuc)
          (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $nuc))) (i32.const 1)) (i32.const 0))
        (if (local.get $sup)
          (then
            (call $m.append (local.get $l) (local.get $sup)
              (i32.add (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $sup))) (i32.const 1))
                (i32.shr_s (local.get $ic) (i32.const 1)))
              (i32.sub (i32.const 0) (i32.add (i32.add (call $m.H (local.get $nuc)) (call $m.D (local.get $sup)))
                (call $m.max (call $m.sc (i32.const $MC.upperGap))
                  (i32.sub (call $m.sc (i32.const $MC.upperRise)) (call $m.D (local.get $sup)))))))))
        (if (local.get $sub)
          (then
            (call $m.append (local.get $l) (local.get $sub)
              (i32.sub (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $sub))) (i32.const 1))
                (i32.shr_s (local.get $ic) (i32.const 1)))
              (i32.add (i32.add (call $m.D (local.get $nuc)) (call $m.H (local.get $sub)))
                (call $m.max (call $m.sc (i32.const $MC.lowerGap))
                  (i32.sub (call $m.sc (i32.const $MC.lowerDrop)) (call $m.H (local.get $sub))))))))
        (call $m.setW (local.get $l) (local.get $w))
        (return (local.get $l))))
    (if (i32.and (i32.ne (i32.load8_u (call $m.nAt (local.get $nuc))) (i32.const $NK.glyph))
          (i32.eqz (i32.load8_u offset=$N.class (call $m.nAt (local.get $nuc)))))
      (then
        (local.set $u (i32.sub (call $m.H (local.get $nuc)) (call $m.sc (i32.const $MC.supDrop))))
        (local.set $v (i32.add (call $m.D (local.get $nuc)) (call $m.sc (i32.const $MC.subDrop))))))
    (if (local.get $sup)
      (then
        (local.set $u (call $m.max (local.get $u) (call $m.max
          (call $m.sc (select (i32.const $MC.supShiftCramped) (i32.const $MC.supShift)
            (i32.and (global.get $mStyle) (i32.const 4))))
          (i32.add (call $m.D (local.get $sup)) (call $m.sc (i32.const $MC.supBottomMin))))))
        (if (local.get $sub)
          (then
            (local.set $v (call $m.max (local.get $v) (call $m.sc (i32.const $MC.subShift))))
            (local.set $gap (i32.sub (i32.sub (local.get $u) (call $m.D (local.get $sup)))
              (i32.sub (call $m.H (local.get $sub)) (local.get $v))))
            (if (i32.lt_s (local.get $gap) (call $m.sc (i32.const $MC.subSupGap)))
              (then
                (local.set $v (i32.add (local.get $v) (i32.sub (call $m.sc (i32.const $MC.subSupGap)) (local.get $gap))))
                (local.set $gap (i32.sub (call $m.sc (i32.const $MC.supBottomMaxWithSub))
                  (i32.sub (local.get $u) (call $m.D (local.get $sup)))))
                (if (i32.gt_s (local.get $gap) (i32.const 0))
                  (then
                    (local.set $u (i32.add (local.get $u) (local.get $gap)))
                    (local.set $v (i32.sub (local.get $v) (local.get $gap))))))))))
      (else
        (local.set $v (call $m.max (local.get $v) (call $m.max (call $m.sc (i32.const $MC.subShift))
          (i32.sub (call $m.H (local.get $sub)) (call $m.sc (i32.const $MC.subTopMax))))))))
    (call $m.append (local.get $l) (local.get $nuc) (i32.const 0) (i32.const 0))
    (local.set $w (call $m.W (local.get $nuc)))
    (local.set $x (local.get $w))
    (if (local.get $sup)
      (then
        ;; an operator's width already holds its italic correction
        (local.set $x (select (local.get $w) (i32.add (local.get $w) (local.get $ic))
          (i32.and (local.get $flags) (i32.const $AF.op))))
        (call $m.append (local.get $l) (local.get $sup) (local.get $x) (i32.sub (i32.const 0) (local.get $u)))
        (local.set $x (i32.add (local.get $x) (call $m.W (local.get $sup))))))
    (if (local.get $sub)
      (then
        (local.set $gap (select (i32.sub (local.get $w) (local.get $ic)) (local.get $w)
          (i32.and (local.get $flags) (i32.const $AF.op))))
        (call $m.append (local.get $l) (local.get $sub) (local.get $gap) (local.get $v))
        (local.set $x (call $m.max (local.get $x) (i32.add (local.get $gap) (call $m.W (local.get $sub)))))))
    (call $m.setW (local.get $l) (i32.add (local.get $x) (call $m.sc (i32.const $MC.spaceAfterScript))))
    (local.get $l))

  ;; Lay out the atoms above $base as one horizontal list and pop them.
  (func $m.finish (param $base i32) (result i32)
    (local $a i32)
    (local $c i32)
    (local $prev i32)
    (local $prevAt i32)
    (local $l i32)
    (local $x i32)
    (local $box i32)
    (local $k i32)
    (local $n i32)
    ;; A binary operator without operands on both sides is ordinary.
    (local.set $prev (i32.const 1))
    (local.set $a (local.get $base))
    (block $done
      (loop $l1
        (br_if $done (i32.ge_u (local.get $a) (global.get $mA)))
        (local.set $c (i32.load8_u offset=$A.class (local.get $a)))
        (if (i32.ne (local.get $c) (i32.const 8))
          (then
            (if (i32.and (i32.eq (local.get $c) (i32.const 2))
                  (i32.and (i32.shr_u (i32.const 0x5e) (local.get $prev)) (i32.const 1)))
              (then
                (local.set $c (i32.const 0))
                (i32.store8 offset=$A.class (local.get $a) (i32.const 0))))
            (if (i32.and (i32.and (i32.shr_u (i32.const 0x68) (local.get $c)) (i32.const 1))
                  (i32.eq (local.get $prev) (i32.const 2)))
              (then (i32.store8 offset=$A.class (local.get $prevAt) (i32.const 0))))
            (local.set $prev (local.get $c))
            (local.set $prevAt (local.get $a))
            (local.set $n (i32.add (local.get $n) (i32.const 1)))))
        (local.set $a (i32.add (local.get $a) (i32.const $A.size)))
        (br $l1)))
    (if (i32.eq (local.get $prev) (i32.const 2))
      (then (i32.store8 offset=$A.class (local.get $prevAt) (i32.const 0))))
    (global.set $mLastClass (select
      (i32.load8_u offset=$A.class (local.get $prevAt)) (i32.const 0)
      (i32.eq (local.get $n) (i32.const 1))))
    (local.set $l (call $m.list))
    (local.set $prev (i32.const -1))
    (local.set $a (local.get $base))
    (block $done
      (loop $l2
        (br_if $done (i32.ge_u (local.get $a) (global.get $mA)))
        (local.set $c (i32.load8_u offset=$A.class (local.get $a)))
        (local.set $box (call $m.atomBox (local.get $a)))
        (if (i32.ne (local.get $c) (i32.const 8))
          (then
            (if (i32.ge_s (local.get $prev) (i32.const 0))
              (then
                (local.set $k (i32.load8_u offset=$mem.mathSpacing
                  (i32.add (i32.shl (local.get $prev) (i32.const 3)) (local.get $c))))
                (if (i32.and (i32.ne (local.get $k) (i32.const 0))
                      (i32.or (i32.lt_u (i32.and (global.get $mStyle) (i32.const 3)) (i32.const 2))
                        (i32.eqz (i32.and (local.get $k) (i32.const 4)))))
                  (then (local.set $x (i32.add (local.get $x)
                    (call $m.sc (i32.add (i32.const 111) (i32.mul (i32.and (local.get $k) (i32.const 3)) (i32.const 56))))))))))
            (local.set $prev (local.get $c))))
        (call $m.append (local.get $l) (local.get $box) (local.get $x) (i32.const 0))
        (local.set $x (i32.add (local.get $x) (call $m.W (local.get $box))))
        (local.set $a (i32.add (local.get $a) (i32.const $A.size)))
        (br $l2)))
    (call $m.setW (local.get $l) (local.get $x))
    ;; a single italic letter keeps its correction for scripts on the group
    (if (i32.eq (local.get $n) (i32.const 1))
      (then (i32.store offset=$N.ic (call $m.nAt (local.get $l)) (call $m.IC (local.get $box)))))
    (global.set $mA (local.get $base))
    (local.get $l))

  ;; ---- reading the source

  ;; the byte at $mp, 0 at the end. A NUL byte also reads 0: the list and
  ;; text loops check $mp against $me and read it as U+FFFD.
  (func $m.peek (result i32)
    (if (i32.ge_u (global.get $mp) (global.get $me)) (then (return (i32.const 0))))
    (i32.load8_u (global.get $mp)))

  (func $m.skipSpace
    (local $c i32)
    (loop $l
      (local.set $c (call $m.peek))
      (if (i32.or (call $isWhiteByte (local.get $c)) (i32.eq (local.get $c) (i32.const "%")))
        (then
          (if (i32.eq (local.get $c) (i32.const "%"))
            (then
              (loop $comment
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (br_if $comment (i32.and (i32.ne (call $m.peek) (i32.const 10)) (i32.ne (call $m.peek) (i32.const 0))))))
            (else (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
          (br $l)))))

  ;; Expand the packed commands at $mem.mathNodes into their name length
  ;; groups (see math-commands in scripts/build.ts). The previous name stays
  ;; in $mem.mathSrc for the shared prefix; group cursors are at $mem.mathAtoms.
  (func $m.unpackCmds
    (local $n i32)
    (local $i i32)
    (local $src i32)
    (local $len i32)
    (local $c i32)
    (local $at i32)
    (local $dst i32)
    (loop $cursor
      (local.set $len (i32.add (local.get $len) (i32.const 4)))
      (i32.store offset=$mem.mathAtoms (local.get $len)
        (i32.add (i32.const $mem.mathCmds) (i32.load16_u offset=$mem.mathCmds (local.get $len))))
      (br_if $cursor (i32.lt_u (local.get $len) (i32.const 124))))
    (local.set $n (i32.load16_u (i32.const $mem.mathNodes)))
    (local.set $src (i32.add (i32.const $mem.mathNodes+2) (i32.mul (local.get $n) (i32.const 3))))
    (loop $name
      (local.set $len (i32.load8_u (local.get $src)))
      (loop $byte
        (local.set $src (i32.add (local.get $src) (i32.const 1)))
        (local.set $c (i32.load8_u (local.get $src)))
        (if (i32.gt_u (local.get $c) (i32.const 0x20))
          (then
            (i32.store8 offset=$mem.mathSrc (local.get $len) (local.get $c))
            (local.set $len (i32.add (local.get $len) (i32.const 1)))
            (br $byte))))
      (local.set $at (i32.add (i32.const $mem.mathAtoms) (i32.shl (local.get $len) (i32.const 2))))
      (local.set $dst (i32.load (local.get $at)))
      (memory.copy (local.get $dst) (i32.const $mem.mathSrc) (local.get $len))
      (local.set $c (i32.add (i32.const $mem.mathNodes+2) (local.get $i)))
      (local.set $c (i32.or (i32.load8_u (local.get $c))
        (i32.or (i32.shl (i32.load8_u (i32.add (local.get $c) (local.get $n))) (i32.const 8))
          (i32.shl (i32.load8_u (i32.add (local.get $c) (i32.shl (local.get $n) (i32.const 1)))) (i32.const 21)))))
      (i32.store (i32.add (local.get $dst) (local.get $len)) (local.get $c))
      (i32.store (local.get $at) (i32.add (i32.add (local.get $dst) (local.get $len)) (i32.const 4)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $name (i32.lt_u (local.get $i) (local.get $n)))))

  ;; Look up the command name [$p, $p + $len): its value, or -1. Each name
  ;; length group is sorted, so this is a binary search.
  (func $m.lookup (param $p i32) (param $len i32) (result i32)
    (local $g i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $at i32)
    (local $i i32)
    (local $d i32)
    (if (i32.or (i32.eqz (local.get $len)) (i32.gt_u (local.get $len) (i32.const 31)))
      (then (return (i32.const -1))))
    (local.set $g (i32.load offset=$mem.mathCmds (i32.shl (local.get $len) (i32.const 2))))
    (local.set $hi (i32.shr_u (local.get $g) (i32.const 16)))
    (block $none
      (loop $search
        (br_if $none (i32.ge_u (local.get $lo) (local.get $hi)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $at (i32.add (i32.add (i32.const $mem.mathCmds) (i32.and (local.get $g) (i32.const 0xffff)))
          (i32.mul (local.get $mid) (i32.add (local.get $len) (i32.const 4)))))
        (local.set $i (i32.const 0))
        (loop $byte
          (local.set $d (i32.sub (i32.load8_u (i32.add (local.get $p) (local.get $i)))
            (i32.load8_u (i32.add (local.get $at) (local.get $i)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $byte (i32.and (i32.eqz (local.get $d)) (i32.lt_u (local.get $i) (local.get $len)))))
        (if (i32.eqz (local.get $d)) (then (return (i32.load (i32.add (local.get $at) (local.get $len))))))
        (if (i32.lt_s (local.get $d) (i32.const 0))
          (then (local.set $hi (local.get $mid)))
          (else (local.set $lo (i32.add (local.get $mid) (i32.const 1)))))
        (br $search)))
    (i32.const -1))

  ;; The value of the first symbol command that prints $cp, or -1.
  (func $m.lookupCp (param $cp i32) (result i32)
    (local $len i32)
    (local $at i32)
    (local $n i32)
    (local $v i32)
    (loop $group
      (local.set $len (i32.add (local.get $len) (i32.const 1)))
      (local.set $at (i32.add (i32.const $mem.mathCmds)
        (i32.load16_u offset=$mem.mathCmds (i32.shl (local.get $len) (i32.const 2)))))
      (local.set $n (i32.load16_u offset=$mem.mathCmds+2 (i32.shl (local.get $len) (i32.const 2))))
      (block $next
        (loop $entry
          (br_if $next (i32.eqz (local.get $n)))
          (local.set $v (i32.load (i32.add (local.get $at) (local.get $len))))
          (if (i32.and (i32.lt_u (local.get $v) (i32.const 0x04000000))
                (i32.eq (i32.and (local.get $v) (i32.const 0x1fffff)) (local.get $cp)))
            (then (return (local.get $v))))
          (local.set $at (i32.add (local.get $at) (i32.add (local.get $len) (i32.const 4))))
          (local.set $n (i32.sub (local.get $n) (i32.const 1)))
          (br $entry)))
      (br_if $group (i32.lt_u (local.get $len) (i32.const 31))))
    (i32.const -1))

  ;; Read the command after a backslash at $mp; returns its value or -1 and
  ;; leaves its name in $cmdP and $cmdLen.
  (func $m.readCmd (result i32)
    (local $p i32)
    (local $v i32)
    (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
    (local.set $p (global.get $mp))
    (global.set $cmdP (local.get $p))
    (if (call $isAlpha (call $m.peek))
      (then
        (loop $name
          (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
          (br_if $name (call $isAlpha (call $m.peek))))
        (global.set $cmdLen (i32.sub (global.get $mp) (local.get $p)))
        (if (i32.eq (call $m.peek) (i32.const "*"))
          (then
            (local.set $v (call $m.lookup (local.get $p) (i32.add (global.get $cmdLen) (i32.const 1))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (global.set $cmdLen (i32.add (global.get $cmdLen) (i32.const 1)))
                (call $m.skipSpace)
                (return (local.get $v))))))
        (call $m.skipSpace)
        (return (call $m.lookup (local.get $p) (global.get $cmdLen)))))
    (if (i32.ge_u (global.get $mp) (global.get $me))
      (then
        (global.set $cmdLen (i32.const 0))
        (return (i32.const -1))))
    ;; a whole code point, so `\é` stays valid UTF-8
    (drop (call $m.readCp))
    (global.set $cmdLen (i32.sub (global.get $mp) (local.get $p)))
    (call $m.lookup (local.get $p) (global.get $cmdLen)))

  ;; the UTF-8 code point at $mp, advancing past it
  (func $m.readCp (result i32)
    (local $cp i32)
    (local.set $cp (call $utf8At (global.get $mp) (global.get $me)))
    (global.set $mp (global.get $utf8Next))
    (local.get $cp))

  ;; Read a brace group's raw text: returns its start and sets $mp past the
  ;; closing brace; $cmdLen gets its length.
  (func $m.rawArg (result i32)
    (local $p i32)
    (local $depth i32)
    (call $m.skipSpace)
    (if (i32.ne (call $m.peek) (i32.const "{"))
      (then
        ;; one token: a character or a command
        (local.set $p (global.get $mp))
        (if (i32.eq (call $m.peek) (i32.const "\5c"))
          (then
            (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
            (if (call $isAlpha (call $m.peek))
              (then
                (loop $name
                  (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                  (br_if $name (call $isAlpha (call $m.peek))))
                (global.set $cmdLen (i32.sub (global.get $mp) (local.get $p)))
                (return (local.get $p))))))
        (if (call $m.peek) (then (drop (call $m.readCp))))
        (global.set $cmdLen (i32.sub (global.get $mp) (local.get $p)))
        (return (local.get $p))))
    (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
    (local.set $p (global.get $mp))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (call $m.peek)))
        (if (i32.eq (call $m.peek) (i32.const "}"))
          (then
            (br_if $done (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
        (if (i32.eq (call $m.peek) (i32.const "{"))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (call $m.peek) (i32.const "\5c"))
          (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
        (if (call $m.peek) (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
        (br $l)))
    (global.set $cmdLen (i32.sub (global.get $mp) (local.get $p)))
    (if (call $m.peek) (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
    (local.get $p))

  ;; units and their size in thousandths of a point (mu: of an em)
  (const $pairs.units $mem.mathStatic+846)
  (data (i32.const $pairs.units) "\65\6d\e8\03\65\78\af\01\70\74\64\00\6d\75\38\00\70\78\3f\00\63\6d\1d\0b\6d\6d\1d\01\69\6e\3b\1c\62\70\64\00\70\63\b0\04\00\00")

  ;; A dimension such as `2em`, `-3mu` or `{0.5cm}` in thousandths of an em.
  ;; Bare numbers are in mu when $mu is set, else in points.
  (func $m.dimen (param $mu i32) (result i32)
    (local $neg i32)
    (local $v i32)
    (local $m.frac i32)
    (local $c i32)
    (local $u i32)
    (local $brace i32)
    (call $m.skipSpace)
    (if (i32.eq (call $m.peek) (i32.const "{"))
      (then
        (local.set $brace (i32.const 1))
        (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
        (call $m.skipSpace)))
    (if (i32.eq (call $m.peek) (i32.const "-"))
      (then
        (local.set $neg (i32.const 1))
        (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
    (local.set $m.frac (i32.const 1000))
    (block $num
      (loop $l
        (local.set $c (call $m.peek))
        (if (call $isDigit (local.get $c))
          (then
            (if (i32.lt_u (local.get $v) (i32.const 10000000))
              (then
                (if (i32.lt_u (local.get $m.frac) (i32.const 1000))
                  (then
                    (local.set $v (i32.add (local.get $v)
                      (i32.mul (i32.sub (local.get $c) (i32.const "0")) (local.get $m.frac))))
                    (local.set $m.frac (i32.div_u (local.get $m.frac) (i32.const 10))))
                  (else (local.set $v (i32.add (i32.mul (local.get $v) (i32.const 10))
                    (i32.mul (i32.sub (local.get $c) (i32.const "0")) (i32.const 1000))))))))
            (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
            (br $l)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $m.frac) (i32.const 1000)))
          (then
            (local.set $m.frac (i32.const 100))
            (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
            (br $l)))))
    ;; $v holds thousandths of the unit
    (call $m.skipSpace)
    (local.set $u (i32.or (call $m.peek) (i32.shl (i32.load8_u offset=1 (global.get $mp)) (i32.const 8))))
    (local.set $c (call $m.pair (i32.const $pairs.units) (local.get $u)))
    (if (i32.eqz (local.get $c))
      (then (local.set $c (select (i32.const 56) (i32.const 100) (local.get $mu)))))
    (if (i32.and (call $isAlpha (i32.and (local.get $u) (i32.const 0xff)))
          (call $isAlpha (i32.shr_u (local.get $u) (i32.const 8))))
      (then (global.set $mp (i32.add (global.get $mp) (i32.const 2)))))
    (if (local.get $brace)
      (then
        (loop $close
          (if (i32.and (i32.ne (call $m.peek) (i32.const "}")) (i32.ne (call $m.peek) (i32.const 0)))
            (then
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (br $close))))
        (if (call $m.peek) (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))))
    ;; at most 1000em, so sums of many kerns stay far from i32 overflow
    (local.set $v (call $m.sc (call $m.min (i32.wrap_i64 (i64.div_u
      (i64.mul (i64.extend_i32_u (local.get $v)) (i64.extend_i32_u (local.get $c))) (i64.const 1000)))
      (i32.const 1000000))))
    (select (i32.sub (i32.const 0) (local.get $v)) (local.get $v) (local.get $neg)))

  ;; ---- parsing

  ;; An argument: a brace group, or one token.
  (func $m.arg (result i32)
    (local $n i32)
    (call $m.skipSpace)
    (if (i32.eq (call $m.peek) (i32.const "{"))
      (then
        (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
        (local.set $n (call $m.parseList (i32.const $P.brace)))
        (if (i32.eq (call $m.peek) (i32.const "}"))
          (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
        (return (local.get $n))))
    (call $m.parseList (i32.const $P.single)))

  ;; an argument in style $s
  (func $m.argIn (param $s i32) (result i32)
    (local $old i32)
    (local $n i32)
    (local.set $old (global.get $mStyle))
    (call $m.setStyle (local.get $s))
    (local.set $n (call $m.arg))
    (call $m.setStyle (local.get $old))
    (local.get $n))

  ;; An optional `[...]` argument in style $s, or 0.
  (func $m.optArg (param $s i32) (result i32)
    (local $old i32)
    (local $n i32)
    (call $m.skipSpace)
    (if (i32.ne (call $m.peek) (i32.const "[")) (then (return (i32.const 0))))
    (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
    (local.set $old (global.get $mStyle))
    (call $m.setStyle (local.get $s))
    (local.set $n (call $m.parseList (i32.const $P.bracket)))
    (call $m.setStyle (local.get $old))
    (if (i32.eq (call $m.peek) (i32.const "]"))
      (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
    (local.get $n))

  ;; Attach a script to the last atom since $base, or to a new empty one.
  (func $m.script (param $sup i32) (param $base i32)
    (local $a i32)
    (local $n i32)
    (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
    (local.set $a (i32.sub (global.get $mA) (i32.const $A.size)))
    (if (i32.or (i32.lt_u (local.get $a) (local.get $base))
          (i32.load16_u (i32.add (local.get $a) (select (i32.const $A.sup) (i32.const $A.sub) (local.get $sup)))))
      (then
        (call $m.push (call $m.list) (i32.const 0) (i32.const 0))
        (local.set $a (i32.sub (global.get $mA) (i32.const $A.size)))))
    (local.set $n (call $m.argIn (i32.or (call $m.supStyle (global.get $mStyle))
      (select (i32.const 0) (i32.const 4) (local.get $sup)))))
    (if (i32.ge_u (local.get $a) (i32.const $m.atomsEnd)) (then (return)))
    (i32.store16 (i32.add (local.get $a) (select (i32.const $A.sup) (i32.const $A.sub) (local.get $sup)))
      (local.get $n)))

  ;; Read a delimiter after \left, \right, \middle or \big: its code point,
  ;; or `.` for none.
  (func $m.readDelim (result i32)
    (local $c i32)
    (local $v i32)
    (call $m.skipSpace)
    (local.set $c (call $m.peek))
    (if (i32.eqz (local.get $c)) (then (return (i32.const "."))))
    (if (i32.eq (local.get $c) (i32.const "\5c"))
      (then
        (local.set $v (call $m.readCmd))
        (if (i32.and (i32.ge_s (local.get $v) (i32.const 0))
              (i32.eqz (i32.shr_u (local.get $v) (i32.const 24))))
          (then (return (i32.and (local.get $v) (i32.const 0x1fffff)))))
        (return (i32.const "."))))
    (local.set $c (call $m.readCp))
    (if (i32.eq (local.get $c) (i32.const "<")) (then (return (i32.const 0x27e8))))
    (if (i32.eq (local.get $c) (i32.const ">")) (then (return (i32.const 0x27e9))))
    (local.get $c))

  ;; delimiters drawn as paths: shape id | mirrored << 8
  (const $pairs.delim $mem.mathStatic+756)
  (data (i32.const $pairs.delim) "\28\00\01\00\ee\27\01\00\29\00\01\01\ef\27\01\01\5b\00\02\00\5d\00\02\01\7b\00\03\00\7d\00\03\01\7c\00\04\00\23\22\04\00\16\20\05\00\25\22\05\00\e8\27\06\00\29\23\06\00\e9\27\06\01\2a\23\06\01\0a\23\07\00\0b\23\07\01\08\23\08\00\09\23\08\01\2f\00\09\00\5c\00\0a\00\00\00")

  ;; A delimiter at least $size tall (total height, base units), centered on
  ;; the axis when it has to grow.
  (func $m.delim (param $cp i32) (param $size i32) (param $class i32) (result i32)
    (local $shape i32)
    (local $n i32)
    (local $w i32)
    (local $p i32)
    (local $axis i32)
    (if (i32.eq (local.get $cp) (i32.const "."))
      (then (return (call $m.kern (call $m.sc (i32.const 120))))))
    (local.set $n (call $m.symbol (local.get $cp) (local.get $class)))
    (if (i32.le_s (local.get $size)
          (i32.add (i32.add (call $m.H (local.get $n)) (call $m.D (local.get $n))) (call $m.sc (i32.const 20))))
      (then (return (local.get $n))))
    (local.set $shape (call $m.pair (i32.const $pairs.delim) (local.get $cp)))
    (local.set $axis (call $m.sc (i32.const $MC.axis)))
    (local.set $p (call $m.nAt (local.get $n)))
    (if (i32.eqz (local.get $shape))
      (then
        ;; no drawn shape: scale the glyph itself, centered on the axis
        (local.set $w (i32.div_s (i32.mul (local.get $size) (i32.const 1000))
          (call $m.max (i32.add (call $m.H (local.get $n)) (call $m.D (local.get $n))) (i32.const 1))))
        (i32.store16 offset=$N.scale (local.get $p)
          (call $m.min (i32.div_s (i32.mul (global.get $mS) (local.get $w)) (i32.const 1000)) (i32.const 60000)))
        (i32.store offset=$N.w (local.get $p) (i32.div_s (i32.mul (call $m.W (local.get $n)) (local.get $w)) (i32.const 1000)))
        (local.set $shape (call $m.list))
        (call $m.append (local.get $shape) (local.get $n) (i32.const 0)
          (i32.sub (i32.div_s (i32.mul (i32.sub (call $m.H (local.get $n)) (call $m.D (local.get $n))) (local.get $w)) (i32.const 2000))
            (local.get $axis)))
        (call $m.setBox (local.get $shape) (i32.load offset=$N.w (local.get $p))
          (i32.add (i32.shr_s (local.get $size) (i32.const 1)) (local.get $axis))
          (i32.sub (i32.shr_s (local.get $size) (i32.const 1)) (local.get $axis)))
        (return (local.get $shape))))
    (i32.store8 (local.get $p) (i32.const $NK.path))
    (i32.store offset=$N.a (local.get $p) (local.get $shape))
    (local.set $shape (i32.and (local.get $shape) (i32.const 0xff)))
    (local.set $w (i32.const 300))
    (if (i32.eq (local.get $shape) (i32.const 1))
      (then (local.set $w (call $m.min (i32.add (i32.const 420) (i32.div_s (local.get $size) (i32.const 20))) (i32.const 750)))))
    (if (i32.or (i32.eq (local.get $shape) (i32.const 2)) (i32.ge_u (local.get $shape) (i32.const 7)))
      (then (local.set $w (call $m.min (i32.add (i32.const 400) (i32.div_s (local.get $size) (i32.const 40))) (i32.const 600)))))
    (if (i32.eq (local.get $shape) (i32.const 3))
      (then (local.set $w (call $m.min (i32.add (i32.const 480) (i32.div_s (local.get $size) (i32.const 30))) (i32.const 750)))))
    (if (i32.eq (local.get $shape) (i32.const 5)) (then (local.set $w (i32.const 480))))
    (if (i32.eq (local.get $shape) (i32.const 6))
      (then (local.set $w (call $m.min (i32.add (i32.const 400) (i32.div_s (local.get $size) (i32.const 30))) (i32.const 700)))))
    (if (i32.ge_u (local.get $shape) (i32.const 9))
      (then (local.set $w (i32.add (i32.const 100) (i32.div_s (local.get $size) (i32.const 3))))))
    (call $m.setBox (local.get $n) (call $m.sc (local.get $w))
      (i32.add (i32.shr_s (local.get $size) (i32.const 1)) (local.get $axis))
      (i32.sub (i32.shr_s (local.get $size) (i32.const 1)) (local.get $axis)))
    (i32.store offset=$N.ic (local.get $p) (i32.const 0))
    (local.get $n))

  ;; the size that \left and \right need around a box of height $h, depth $d
  (func $m.fence (param $h i32) (param $d i32) (result i32)
    (local $delta i32)
    (local.set $delta (call $m.max (i32.sub (local.get $h) (call $m.sc (i32.const $MC.axis)))
      (i32.add (local.get $d) (call $m.sc (i32.const $MC.axis)))))
    (call $m.max (i32.div_s (i32.mul (local.get $delta) (i32.const 1802)) (i32.const 1000))
      (i32.sub (i32.shl (local.get $delta) (i32.const 1)) (call $m.sc (i32.const 500)))))

  ;; a delimiter of \left ... \right, sized when the list is complete
  (func $m.pushDelim (param $cp i32)
    (call $m.push (i32.const 0) (i32.const 0) (i32.const $AF.middle))
    (if (i32.eqz (global.get $mFail))
      (then (i32.store offset=$A.sup (i32.sub (global.get $mA) (i32.const $A.size)) (local.get $cp)))))

  ;; \left ... \middle ... \right
  (func $m.leftRight (result i32)
    (local $base i32)
    (local $l i32)
    (local $a i32)
    (local $h i32)
    (local $d i32)
    (local $size i32)
    (local $x i32)
    (local $n i32)
    (local $right i32)
    (local $v i32)
    (local.set $base (global.get $mA))
    (call $m.pushDelim (call $m.readDelim))
    (block $done
      (loop $segment
        (local.set $n (call $m.parseList (i32.const $P.right)))
        (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
        (local.set $h (call $m.max (local.get $h) (call $m.H (local.get $n))))
        (local.set $d (call $m.max (local.get $d) (call $m.D (local.get $n))))
        (local.set $right (i32.const "."))
        (br_if $done (i32.ne (call $m.peek) (i32.const "\5c")))
        (local.set $v (call $m.readCmd))
        (local.set $right (call $m.readDelim))
        (br_if $done (i32.ne (local.get $v) (i32.const 0x0a000002)))
        (call $m.pushDelim (local.get $right))
        (br_if $done (global.get $mFail))
        (br $segment)))
    (call $m.pushDelim (local.get $right))
    (local.set $size (call $m.fence (local.get $h) (local.get $d)))
    (local.set $l (call $m.list))
    (local.set $a (local.get $base))
    (block $built
      (loop $each
        (br_if $built (i32.ge_u (local.get $a) (global.get $mA)))
        (local.set $n (i32.load16_u (local.get $a)))
        (if (i32.and (i32.load8_u offset=$A.flags (local.get $a)) (i32.const $AF.middle))
          (then (local.set $n (call $m.delim (i32.load offset=$A.sup (local.get $a))
            (local.get $size) (i32.const 0)))))
        (call $m.append (local.get $l) (local.get $n) (local.get $x) (i32.const 0))
        (local.set $x (i32.add (local.get $x) (call $m.W (local.get $n))))
        (local.set $a (i32.add (local.get $a) (i32.const $A.size)))
        (br $each)))
    (call $m.setW (local.get $l) (local.get $x))
    (global.set $mA (local.get $base))
    (local.get $l))

  ;; Text in \text{...}: a brace group, or one character.
  (func $m.textArg (param $flags i32) (result i32)
    (local $start i32)
    (call $m.skipSpace)
    (if (i32.ne (call $m.peek) (i32.const "{"))
      (then
        (local.set $start (global.get $mp))
        (if (call $m.peek) (then (drop (call $m.readCp))))
        (return (call $m.textNode (local.get $start) (i32.sub (global.get $mp) (local.get $start)) (local.get $flags)))))
    (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
    (call $m.textRun (local.get $flags)))

  ;; The text of a group up to its closing brace: runs of literal bytes,
  ;; escapes, spaces, $...$, symbols, spaces and kerns, and nested text
  ;; commands. A font switch such as \bf sets the rest of the group.
  (func $m.textRun (param $flags i32) (result i32)
    (local $base i32)
    (local $start i32)
    (local $c i32)
    (local $depth i32)
    (local $n i32)
    (local $old i32)
    (local.set $base (global.get $mA))
    (global.set $mDepth (i32.add (global.get $mDepth) (i32.const 1)))
    (if (i32.gt_u (global.get $mDepth) (i32.const 48))
      (then (global.set $mFail (i32.const 1))))
    (local.set $start (global.get $mp))
    (block $done
      (loop $l
        (br_if $done (global.get $mFail))
        (local.set $c (call $m.peek))
        (if (i32.or (i32.ge_u (global.get $mp) (global.get $me))
              (i32.or (i32.eq (local.get $c) (i32.const "\5c"))
                (i32.or (i32.eq (local.get $c) (i32.const "$"))
                  (i32.or (i32.eq (local.get $c) (i32.const "{"))
                    (i32.or (i32.eq (local.get $c) (i32.const "}")) (i32.eq (local.get $c) (i32.const "~")))))))
          (then
            (if (i32.gt_u (global.get $mp) (local.get $start))
              (then (call $m.push (call $m.textNode (local.get $start)
                (i32.sub (global.get $mp) (local.get $start)) (local.get $flags)) (i32.const 0) (i32.const 0))))
            (br_if $done (i32.ge_u (global.get $mp) (global.get $me)))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (br_if $done (i32.eqz (local.get $depth)))
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "~"))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (call $m.push (call $m.kern (call $m.sc (i32.const 333))) (i32.const 0) (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (local.set $old (global.get $mStyle))
                (call $m.setStyle (i32.or (i32.and (local.get $old) (i32.const 4))
                  (call $m.max (i32.and (local.get $old) (i32.const 3)) (i32.const 1))))
                (call $m.push (call $m.parseList (i32.const $P.dollar)) (i32.const 0) (i32.const 0))
                (call $m.setStyle (local.get $old))
                (if (i32.eq (call $m.peek) (i32.const "$"))
                  (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))))
            (if (i32.eq (local.get $c) (i32.const "\5c"))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (local.set $c (call $m.peek))
                (if (call $isAlpha (local.get $c))
                  (then
                    (global.set $mp (i32.sub (global.get $mp) (i32.const 1)))
                    (local.set $n (call $m.readCmd))
                    (local.set $c (i32.shr_u (local.get $n) (i32.const 24)))
                    (block $cmd
                      ;; a font switch: the rest of the group in its style
                      (if (i32.and (i32.eq (local.get $c) (i32.const $K.font)) (i32.ne (i32.and (local.get $n) (i32.const 0x40)) (i32.const 0)))
                        (then
                          (call $m.push (call $m.textRun (call $m.textFlags (local.get $n))) (i32.const 0) (i32.const 0))
                          (br_if $done (i32.eqz (local.get $depth)))
                          (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                          (br $cmd)))
                      ;; text and font commands nest, adding their style
                      (if (i32.or (i32.eq (local.get $c) (i32.const $K.text)) (i32.eq (local.get $c) (i32.const $K.font)))
                        (then
                          (call $m.push (call $m.textArg (i32.or (local.get $flags) (call $m.textFlags (local.get $n))))
                            (i32.const 0) (i32.const 0))
                          (br $cmd)))
                      ;; symbols print as glyphs; spaces, kerns, boxes and macros run
                      (if (i32.le_u (local.get $c) (i32.const 1))
                        (then
                          (call $m.push (call $m.glyph (i32.and (local.get $n) (i32.const 0x1fffff)) (i32.const 0)) (i32.const 0) (i32.const 0))
                          (br $cmd)))
                      (if (i32.or (i32.or (i32.eq (local.get $c) (i32.const $K.space)) (i32.eq (local.get $c) (i32.const $K.kern)))
                            (i32.eq (local.get $c) (i32.const $K.macro)))
                        (then
                          (call $m.command (local.get $n) (local.get $base) (i32.const 0))
                          (br $cmd)))
                      ;; others print their name
                      (call $m.push (call $m.textNode (i32.sub (global.get $cmdP) (i32.const 1))
                        (i32.add (global.get $cmdLen) (i32.const 1)) (local.get $flags)) (i32.const 0) (i32.const 0))))
                  (else
                    ;; a whole code point, so `\é` stays valid UTF-8
                    (local.set $start (global.get $mp))
                    (if (local.get $c) (then (drop (call $m.readCp))))
                    (if (i32.or (i32.eq (local.get $c) (i32.const " ")) (i32.eq (local.get $c) (i32.const ",")))
                      (then (call $m.push (call $m.kern (call $m.sc (select (i32.const 333) (i32.const 167)
                        (i32.eq (local.get $c) (i32.const " "))))) (i32.const 0) (i32.const 0)))
                      (else
                        (if (i32.and (i32.ne (local.get $c) (i32.const "\5c")) (i32.ne (local.get $c) (i32.const 0)))
                          (then (call $m.push (call $m.textNode (local.get $start)
                            (i32.sub (global.get $mp) (local.get $start)) (local.get $flags))
                            (i32.const 0) (i32.const 0))))))))))
            (local.set $start (global.get $mp))
            (br $l)))
        (drop (call $m.readCp))
        (br $l)))
    (global.set $mDepth (i32.sub (global.get $mDepth) (i32.const 1)))
    (call $m.finish (local.get $base)))

  ;; the text flags of a \text command's value: 1 bold, 2 italic, 4 monospace
  (func $m.textFlags (param $v i32) (result i32)
    (local.set $v (i32.and (local.get $v) (i32.const 0xf)))
    (select (i32.const 1)
      (select (i32.const 2) (select (i32.const 4) (i32.const 0) (i32.eq (local.get $v) (i32.const 8)))
        (i32.eq (local.get $v) (i32.const 1)))
      (i32.eq (local.get $v) (i32.const 2))))

  ;; The code point that prints $cp in text of $flags. STIX Two Math has no
  ;; bold face and Chromium fakes none, so bold letters, digits and Greek
  ;; print as math bold ones.
  (func $m.textCp (param $cp i32) (param $flags i32) (result i32)
    (local $it i32)
    (if (i32.ne (i32.and (local.get $flags) (i32.const 5)) (i32.const 1)) (then (return (local.get $cp))))
    (local.set $it (i32.and (local.get $flags) (i32.const 2)))
    (if (i32.le_u (i32.sub (local.get $cp) (i32.const "A")) (i32.const 25))
      (then (return (i32.add (local.get $cp) (select (i32.const 0x1d427) (i32.const 0x1d3bf) (local.get $it))))))
    (if (i32.le_u (i32.sub (local.get $cp) (i32.const "a")) (i32.const 25))
      (then (return (i32.add (local.get $cp) (select (i32.const 0x1d421) (i32.const 0x1d3b9) (local.get $it))))))
    (if (call $isDigit (local.get $cp)) (then (return (i32.add (local.get $cp) (i32.const 0x1d79e)))))
    (call $m.greek (local.get $cp) (select (i32.const 0x1d71c) (i32.const 0x1d6a8) (local.get $it))))

  ;; A text run [$p, $p + $len) measured with the main fonts.
  (func $m.textNode (param $p i32) (param $len i32) (param $flags i32) (result i32)
    (local $n i32)
    (local $end i32)
    (local $cp i32)
    (local $w i32)
    (local $h i32)
    (local $d i32)
    (local.set $end (i32.add (local.get $p) (local.get $len)))
    (if (i32.lt_u (local.get $p) (i32.const $mem.mathSrcEnd))
      (then (global.set $mPin (call $m.max (global.get $mPin) (local.get $end)))))
    (local.set $n (call $m.node (i32.const $NK.text)))
    (i32.store offset=$N.a (call $m.nAt (local.get $n)) (local.get $p))
    (i32.store offset=$N.e (call $m.nAt (local.get $n))
      (i32.or (local.get $len) (i32.shl (local.get $flags) (i32.const 24))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $cp (call $utf8At (local.get $p) (local.get $end)))
        (local.set $p (global.get $utf8Next))
        (if (i32.eq (local.get $cp) (i32.const 32))
          (then
            (local.set $w (i32.add (local.get $w) (i32.const 333)))
            (br $l)))
        (call $m.metricsAny (call $m.textCp (local.get $cp) (local.get $flags)))
        (local.set $w (i32.add (local.get $w)
          (select (i32.const 525) (global.get $gW) (i32.and (local.get $flags) (i32.const 4)))))
        (local.set $h (call $m.max (local.get $h) (global.get $gH)))
        (local.set $d (call $m.max (local.get $d) (global.get $gD)))
        (br $l)))
    (call $m.setBox (local.get $n) (call $m.sc (local.get $w)) (call $m.sc (local.get $h)) (call $m.sc (local.get $d)))
    (local.get $n))

  ;; A big operator: in display style the text glyph grows to the display
  ;; size (integrals to the font's minimum display height), centered on the axis.
  (func $m.bigOp (param $cp i32) (result i32)
    (local $f i32)
    (local $g i32)
    (local $l i32)
    (local $half i32)
    (local.set $g (call $m.glyph (local.get $cp) (i32.const 1)))
    (local.set $f (i32.const 1000))
    (if (i32.eqz (i32.and (global.get $mStyle) (i32.const 3)))
      (then (local.set $f (select (i32.const 1800) (i32.const 1300)
        (i32.le_u (i32.sub (local.get $cp) (i32.const 0x222b)) (i32.const 8))))))
    (i32.store16 offset=$N.scale (call $m.nAt (local.get $g)) (i32.div_s (i32.mul (global.get $mS) (local.get $f)) (i32.const 1000)))
    (local.set $half (i32.div_s (i32.mul (i32.add (call $m.H (local.get $g)) (call $m.D (local.get $g))) (local.get $f)) (i32.const 2000)))
    (local.set $l (call $m.list))
    (call $m.append (local.get $l) (local.get $g) (i32.const 0)
      (i32.sub (i32.div_s (i32.mul (i32.sub (call $m.H (local.get $g)) (call $m.D (local.get $g))) (local.get $f)) (i32.const 2000))
        (call $m.sc (i32.const $MC.axis))))
    ;; the italic correction widens the operator; a subscript tucks under it
    (local.set $f (i32.div_s (i32.mul (call $m.IC (local.get $g)) (local.get $f)) (i32.const 1000)))
    (call $m.setBox (local.get $l)
      (i32.add (i32.div_s (i32.mul (call $m.W (local.get $g)) (i32.load16_u offset=$N.scale (call $m.nAt (local.get $g))))
        (global.get $mS)) (local.get $f))
      (i32.add (local.get $half) (call $m.sc (i32.const $MC.axis)))
      (i32.sub (local.get $half) (call $m.sc (i32.const $MC.axis))))
    (i32.store offset=$N.ic (call $m.nAt (local.get $l)) (local.get $f))
    (local.get $l))

  ;; An operator name such as `lim`; $split puts a thin space after that many letters.
  (func $m.opName (param $p i32) (param $len i32) (param $split i32) (result i32)
    (local $l i32)
    (local $n i32)
    (if (i32.eqz (local.get $split))
      (then (return (call $m.textNode (local.get $p) (local.get $len) (i32.const 0)))))
    (local.set $l (call $m.list))
    (local.set $n (call $m.textNode (local.get $p) (local.get $split) (i32.const 0)))
    (call $m.append (local.get $l) (local.get $n) (i32.const 0) (i32.const 0))
    (call $m.append (local.get $l)
      (call $m.textNode (i32.add (local.get $p) (local.get $split)) (i32.sub (local.get $len) (local.get $split)) (i32.const 0))
      (i32.add (call $m.W (local.get $n)) (call $m.sc (i32.const 167))) (i32.const 0))
    (local.get $l))

  ;; A delimiter in braces, as \genfrac takes them: its code point, or `.`.
  (func $m.braceDelim (result i32)
    (local $p i32)
    (local $end i32)
    (local.set $p (call $m.rawArg))
    (if (i32.eqz (global.get $cmdLen)) (then (return (i32.const "."))))
    (local.set $end (global.get $mp))
    (global.set $mp (local.get $p))
    (local.set $p (call $m.readDelim))
    (global.set $mp (local.get $end))
    (local.get $p))

  ;; \frac, \binom, \genfrac and their kin. $x: style (0 the current one, 1
  ;; display, 2 text) | an $m.envDelim pair << 2 | 16 without a rule | 32 for
  ;; \genfrac, which reads its delimiters, rule and style first. A $num of -1
  ;; reads both parts as arguments (`\over` passes the parts it parsed); a $t
  ;; of -1 is the default rule.
  (func $m.frac (param $x i32) (param $num i32) (param $den i32) (param $t i32) (result i32)
    (local $old i32)
    (local $fs i32)
    (local $binom i32)
    (local $disp i32)
    (local $u i32)
    (local $v i32)
    (local $ld i32)
    (local $rd i32)
    (local $clr i32)
    (local $axis i32)
    (local $w i32)
    (local $nds i32)
    (local $l i32)
    (local $r i32)
    (local $o i32)
    (local $size i32)
    (local.set $old (global.get $mStyle))
    (local.set $fs (local.get $old))
    (local.set $v (i32.and (local.get $x) (i32.const 3)))
    (if (local.get $v)
      (then (local.set $fs (i32.or (i32.and (local.get $old) (i32.const 4)) (i32.sub (local.get $v) (i32.const 1))))))
    (local.set $v (i32.and (i32.shr_u (local.get $x) (i32.const 2)) (i32.const 3)))
    (local.set $ld (call $m.envDelim (local.get $v) (i32.const 0)))
    (local.set $rd (call $m.envDelim (local.get $v) (i32.const 1)))
    (if (i32.and (local.get $x) (i32.const 16)) (then (local.set $t (i32.const 0))))
    (if (i32.and (local.get $x) (i32.const 32))
      (then
        (local.set $ld (call $m.braceDelim))
        (local.set $rd (call $m.braceDelim))
        ;; an empty rule argument is the default rule
        (call $m.skipSpace)
        (if (i32.eq (i32.load16_u (global.get $mp)) (i32.const 0x7d7b))
          (then (global.set $mp (i32.add (global.get $mp) (i32.const 2))))
          (else (local.set $t (call $m.dimen (i32.const 0)))))
        (local.set $u (call $m.rawArg))
        (if (global.get $cmdLen)
          (then (local.set $fs (i32.or (i32.and (local.get $old) (i32.const 4))
            (i32.and (i32.sub (i32.load8_u (local.get $u)) (i32.const "0")) (i32.const 3))))))))
    (if (i32.lt_s (local.get $num) (i32.const 0))
      (then
        (local.set $num (call $m.argIn (call $m.fracStyle (local.get $fs))))
        (local.set $den (call $m.argIn (i32.or (call $m.fracStyle (local.get $fs)) (i32.const 4))))))
    (call $m.setStyle (local.get $fs))
    (local.set $disp (i32.eqz (i32.and (local.get $fs) (i32.const 3))))
    (if (i32.lt_s (local.get $t) (i32.const 0)) (then (local.set $t (call $m.sc (i32.const $MC.rule)))))
    (local.set $binom (i32.eqz (local.get $t)))
    (local.set $axis (call $m.sc (i32.const $MC.axis)))
    ;; a fraction without delimiters has null delimiter spaces
    (local.set $o (i32.or (i32.ne (local.get $ld) (i32.const ".")) (i32.ne (local.get $rd) (i32.const "."))))
    (if (i32.eqz (local.get $o)) (then (local.set $nds (call $m.sc (i32.const 120)))))
    (if (local.get $binom)
      (then
        (local.set $u (call $m.sc (select (i32.const $MC.stackTopDisplay) (i32.const $MC.stackTop) (local.get $disp))))
        (local.set $v (call $m.sc (select (i32.const $MC.stackBottomDisplay) (i32.const $MC.stackBottom) (local.get $disp))))
        (local.set $clr (call $m.sc (select (i32.const $MC.stackGapDisplay) (i32.const $MC.stackGap) (local.get $disp))))
        (local.set $w (i32.sub (i32.sub (local.get $u) (call $m.D (local.get $num)))
          (i32.sub (call $m.H (local.get $den)) (local.get $v))))
        (if (i32.lt_s (local.get $w) (local.get $clr))
          (then
            (local.set $w (i32.shr_s (i32.sub (local.get $clr) (local.get $w)) (i32.const 1)))
            (local.set $u (i32.add (local.get $u) (local.get $w)))
            (local.set $v (i32.add (local.get $v) (local.get $w))))))
      (else
        (local.set $u (call $m.sc (select (i32.const $MC.numShiftDisplay) (i32.const $MC.numShift) (local.get $disp))))
        (local.set $v (call $m.sc (select (i32.const $MC.denomShiftDisplay) (i32.const $MC.denomShift) (local.get $disp))))
        (local.set $clr (call $m.sc (select (i32.const $MC.fracGapDisplay) (i32.const $MC.fracGap) (local.get $disp))))
        (local.set $w (i32.sub (i32.sub (local.get $u) (call $m.D (local.get $num)))
          (i32.add (local.get $axis) (i32.shr_s (local.get $t) (i32.const 1)))))
        (if (i32.lt_s (local.get $w) (local.get $clr))
          (then (local.set $u (i32.add (local.get $u) (i32.sub (local.get $clr) (local.get $w))))))
        (local.set $w (i32.sub (i32.sub (local.get $axis) (i32.shr_s (local.get $t) (i32.const 1)))
          (i32.sub (call $m.H (local.get $den)) (local.get $v))))
        (if (i32.lt_s (local.get $w) (local.get $clr))
          (then (local.set $v (i32.add (local.get $v) (i32.sub (local.get $clr) (local.get $w))))))))
    (local.set $w (call $m.max (call $m.W (local.get $num)) (call $m.W (local.get $den))))
    (local.set $l (call $m.list))
    (call $m.append (local.get $l) (local.get $num)
      (i32.add (local.get $nds) (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $num))) (i32.const 1)))
      (i32.sub (i32.const 0) (local.get $u)))
    (call $m.append (local.get $l) (local.get $den)
      (i32.add (local.get $nds) (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $den))) (i32.const 1)))
      (local.get $v))
    (if (i32.eqz (local.get $binom))
      (then
        (local.set $r (call $m.node (i32.const $NK.rule)))
        (call $m.setBox (local.get $r) (local.get $w) (i32.shr_s (local.get $t) (i32.const 1))
          (i32.sub (local.get $t) (i32.shr_s (local.get $t) (i32.const 1))))
        (call $m.append (local.get $l) (local.get $r) (local.get $nds) (i32.sub (i32.const 0) (local.get $axis)))))
    (call $m.setW (local.get $l) (i32.add (local.get $w) (i32.shl (local.get $nds) (i32.const 1))))
    (if (local.get $o)
      (then
        (local.set $size (call $m.sc (select (i32.const 2390) (i32.const 1010) (local.get $disp))))
        (local.set $o (call $m.list))
        (local.set $r (call $m.delim (local.get $ld) (local.get $size) (i32.const 4)))
        (call $m.append (local.get $o) (local.get $r) (i32.const 0) (i32.const 0))
        (local.set $w (call $m.W (local.get $r)))
        (call $m.append (local.get $o) (local.get $l) (local.get $w) (i32.const 0))
        (local.set $w (i32.add (local.get $w) (call $m.W (local.get $l))))
        (local.set $r (call $m.delim (local.get $rd) (local.get $size) (i32.const 5)))
        (call $m.append (local.get $o) (local.get $r) (local.get $w) (i32.const 0))
        (call $m.setW (local.get $o) (i32.add (local.get $w) (call $m.W (local.get $r))))
        (local.set $l (local.get $o))))
    (call $m.setStyle (local.get $old))
    (local.get $l))

  ;; \sqrt[index]{body}: a drawn radical sign whose bar runs over the body
  (func $m.sqrt (result i32)
    (local $index i32)
    (local $body i32)
    (local $t i32)
    (local $gap i32)
    (local $inner i32)
    (local $size i32)
    (local $sw i32)
    (local $path i32)
    (local $l i32)
    (local $h i32)
    (local $x i32)
    (local $ix i32)
    (local.set $index (call $m.optArg (i32.const 3)))
    (local.set $body (call $m.argIn (i32.or (global.get $mStyle) (i32.const 4))))
    (local.set $t (call $m.sc (i32.const $MC.rule)))
    (local.set $gap (call $m.sc (select (i32.const $MC.radicalGapDisplay) (i32.const $MC.radicalGap)
      (i32.eqz (i32.and (global.get $mStyle) (i32.const 3))))))
    (local.set $inner (i32.add (i32.add (call $m.H (local.get $body)) (call $m.D (local.get $body)))
      (i32.add (local.get $gap) (local.get $t))))
    (local.set $size (call $m.max (local.get $inner) (call $m.sc (i32.const 1100))))
    (local.set $gap (i32.add (local.get $gap) (i32.shr_s (i32.sub (local.get $size) (local.get $inner)) (i32.const 1))))
    (local.set $sw (i32.add (call $m.sc (i32.const 640)) (call $m.min (i32.div_s (local.get $size) (i32.const 12)) (i32.const 300))))
    (local.set $h (i32.add (i32.add (call $m.H (local.get $body)) (local.get $gap)) (local.get $t)))
    (local.set $path (call $m.node (i32.const $NK.path)))
    (i32.store offset=$N.a (call $m.nAt (local.get $path)) (i32.const 11))
    (i32.store offset=$N.e (call $m.nAt (local.get $path)) (local.get $sw))
    (call $m.setBox (local.get $path) (i32.add (i32.add (local.get $sw) (call $m.W (local.get $body))) (call $m.sc (i32.const 60)))
      (local.get $h) (i32.sub (local.get $size) (local.get $h)))
    (local.set $l (call $m.list))
    (if (local.get $index)
      (then
        ;; the degree sits over the sign's tick, and the sign moves right when
        ;; the degree is wide
        (local.set $ix (call $m.sc (i32.const $MC.radicalKernBefore)))
        (local.set $x (i32.sub (i32.add (local.get $ix) (call $m.W (local.get $index))) (call $m.sc (i32.const $MC.radicalKernAfter))))
        (if (i32.lt_s (local.get $x) (i32.const 0))
          (then
            (local.set $ix (i32.sub (local.get $ix) (local.get $x)))
            (local.set $x (i32.const 0))))
        (call $m.append (local.get $l) (local.get $index) (local.get $ix)
          (i32.sub (i32.sub (local.get $size) (local.get $h))
            (i32.div_s (i32.mul (local.get $size) (i32.const $MC.radicalRaise)) (i32.const 100))))))
    (call $m.append (local.get $l) (local.get $path) (local.get $x) (i32.const 0))
    (call $m.append (local.get $l) (local.get $body) (i32.add (local.get $x) (local.get $sw)) (i32.const 0))
    (call $m.setH (local.get $l) (i32.add (call $m.H (local.get $l)) (call $m.sc (i32.const $MC.radicalAscender))))
    (local.get $l))

  ;; A path node above or below a box: hats, tildes, arrows, braces.
  (func $m.pathNode (param $shape i32) (param $w i32) (param $h i32) (param $e i32) (result i32)
    (local $n i32)
    (local.set $n (call $m.node (i32.const $NK.path)))
    (i32.store offset=$N.a (call $m.nAt (local.get $n)) (local.get $shape))
    (i32.store offset=$N.e (call $m.nAt (local.get $n)) (local.get $e))
    (call $m.setBox (local.get $n) (local.get $w) (local.get $h) (i32.const 0))
    (local.get $n))

  ;; \overline, \widehat, \overbrace and the other wide accents. $x: the
  ;; shape (1 and 2 are rules, 17 to 23 arrows, others path 20 + shape) | 32
  ;; below the body | 64 limits.
  (func $m.wide (param $x i32) (param $body i32) (result i32)
    (local $shape i32)
    (local $l i32)
    (local $t i32)
    (local $n i32)
    (local $w i32)
    (local $h i32)
    (local.set $shape (i32.and (local.get $x) (i32.const 31)))
    (local.set $t (call $m.sc (i32.const $MC.rule)))
    (local.set $l (call $m.wrap (local.get $body)))
    (local.set $w (call $m.W (local.get $body)))
    (if (i32.le_u (local.get $shape) (i32.const 2))
      (then
        (local.set $n (call $m.node (i32.const $NK.rule)))
        (call $m.setBox (local.get $n) (local.get $w) (local.get $t) (i32.const 0))
        (if (i32.eq (local.get $shape) (i32.const 1))
          (then
            (call $m.append (local.get $l) (local.get $n) (i32.const 0)
              (i32.sub (i32.const 0) (i32.add (call $m.H (local.get $body)) (call $m.sc (i32.const $MC.overbarGap)))))
            (call $m.setH (local.get $l) (i32.add (call $m.H (local.get $l)) (local.get $t))))
          (else
            (call $m.append (local.get $l) (local.get $n) (i32.const 0)
              (i32.add (i32.add (call $m.D (local.get $body)) (call $m.sc (i32.const $MC.overbarGap))) (local.get $t)))
            (call $m.setD (local.get $l) (i32.add (call $m.D (local.get $l)) (local.get $t)))))
        (i32.store offset=$N.ic (call $m.nAt (local.get $l)) (call $m.IC (local.get $body)))
        (return (local.get $l))))
    (local.set $w (call $m.max (local.get $w) (call $m.sc (i32.const 450))))
    (local.set $h (call $m.sc (select (i32.const 250)
      (call $m.min (i32.add (i32.const 160) (i32.div_s (local.get $w) (i32.const 25))) (i32.const 320))
      (i32.ge_u (local.get $shape) (i32.const 5)))))
    (local.set $t (call $m.sc (i32.const 50)))
    (if (i32.ge_u (local.get $shape) (i32.const 17))
      (then
        (local.set $t (i32.or (i32.load8_u offset=$m.wideArrows-17 (local.get $shape)) (i32.shl (local.get $t) (i32.const 10))))
        (local.set $shape (i32.const 5))))
    (local.set $n (call $m.pathNode (i32.add (local.get $shape) (i32.const 20)) (local.get $w) (local.get $h) (local.get $t)))
    (if (i32.and (local.get $x) (i32.const 32))
      (then
        (call $m.append (local.get $l) (local.get $n)
          (i32.shr_s (i32.sub (call $m.W (local.get $body)) (local.get $w)) (i32.const 1))
          (i32.add (i32.add (call $m.D (local.get $body)) (local.get $h)) (call $m.sc (i32.const 100))))
        (call $m.setD (local.get $l) (i32.add (call $m.D (local.get $l)) (call $m.sc (i32.const 60)))))
      (else
        (call $m.append (local.get $l) (local.get $n)
          (i32.shr_s (i32.sub (call $m.W (local.get $body)) (local.get $w)) (i32.const 1))
          (i32.sub (i32.const 0) (i32.add (call $m.H (local.get $body)) (call $m.sc (i32.const 100)))))
        (call $m.setH (local.get $l) (i32.add (call $m.H (local.get $l)) (call $m.sc (i32.const 40))))))
    (call $m.setW (local.get $l) (call $m.W (local.get $body)))
    (local.get $l))

  ;; \hat and the other accents over one box
  (func $m.accent (param $cp i32) (param $body i32) (result i32)
    (local $l i32)
    (local $a i32)
    (local $raise i32)
    (local $skew i32)
    (local $i i32)
    (local.set $raise (i32.sub (call $m.H (local.get $body))
      (call $m.min (call $m.H (local.get $body)) (call $m.sc (i32.const $MC.accentBase)))))
    ;; the accent's attachment point goes over the base's
    (local.set $skew (i32.load offset=$N.acc (call $m.nAt (local.get $body))))
    (if (i32.eq (local.get $cp) (i32.const 0x20d7))
      (then
        (local.set $a (call $m.pathNode (i32.const 25)
          (call $m.min (call $m.max (call $m.W (local.get $body)) (call $m.sc (i32.const 380))) (call $m.sc (i32.const 560)))
          (call $m.sc (i32.const 180)) (i32.or (i32.const 1) (i32.shl (call $m.sc (i32.const 36)) (i32.const 10)))))
        (local.set $raise (i32.add (i32.add (local.get $raise) (call $m.sc (i32.const $MC.accentBase))) (call $m.sc (i32.const 60)))))
      (else
        (local.set $a (call $m.glyph (local.get $cp) (i32.const 0)))
        ;; \dddot and \ddddot: three or four dot accents in a row
        (if (i32.le_u (i32.sub (local.get $cp) (i32.const 0x20db)) (i32.const 1))
          (then
            (local.set $a (call $m.list))
            (local.set $i (i32.sub (local.get $cp) (i32.const 0x20d8)))
            (loop $dot
              (local.set $i (i32.sub (local.get $i) (i32.const 1)))
              (call $m.append (local.get $a) (call $m.glyph (i32.const 0x2d9) (i32.const 0))
                (i32.mul (local.get $i) (call $m.sc (i32.const 210))) (i32.const 0))
              (br_if $dot (local.get $i)))))))
    (local.set $l (call $m.wrap (local.get $body)))
    (call $m.append (local.get $l) (local.get $a)
      (i32.sub (i32.add (i32.shr_s (i32.sub (call $m.W (local.get $body)) (call $m.W (local.get $a))) (i32.const 1)) (local.get $skew))
        (i32.load offset=$N.acc (call $m.nAt (local.get $a))))
      (i32.sub (i32.const 0) (local.get $raise)))
    (call $m.setW (local.get $l) (call $m.W (local.get $body)))
    (i32.store offset=$N.ic (call $m.nAt (local.get $l)) (call $m.IC (local.get $body)))
    ;; An accent over one glyph takes scripts as the glyph does, as in KaTeX
    ;; and MathJax: \hat{y}_c sets c as high as in y_c.
    (if (i32.eq (i32.load8_u (call $m.nAt (call $m.core (local.get $body)))) (i32.const $NK.glyph))
      (then (i32.store8 offset=$N.class (call $m.nAt (local.get $l)) (i32.const 1))))
    (local.get $l))

  ;; the node inside lists that hold only one child each
  (func $m.core (param $n i32) (result i32)
    (local $p i32)
    (loop $in
      (local.set $p (call $m.nAt (local.get $n)))
      (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const $NK.list))
            (i32.and (i32.ne (i32.load offset=$N.a (local.get $p)) (i32.const 0))
              (i32.eq (i32.load offset=$N.a (local.get $p)) (i32.load offset=$N.tail (local.get $p)))))
        (then
          (local.set $n (i32.load offset=$N.a (local.get $p)))
          (br $in))))
    (local.get $n))

  ;; heads of the wide arrows 17 to 23 (see the arrow path)
  (const $m.wideArrows $mem.mathStatic+989)
  (data (i32.const $m.wideArrows) "\01\02\03\05\11\12\28")

  ;; arrow heads of the extensible arrows other than right (see the arrow path)
  (const $pairs.arrows $mem.mathStatic+888)
  (data (i32.const $pairs.arrows) "\90\21\02\00\a9\21\02\00\d0\21\06\00\d2\21\05\00\94\21\03\00\cc\21\93\00\d4\21\07\00\a6\21\09\00"
    "\c0\21\11\00\c1\21\41\00\bc\21\12\00\bd\21\42\00\cb\21\93\01\c4\21\83\00\9e\21\02\00\3d\00\04\00\00\00")

  ;; \xrightarrow[below]{above} and the other extensible arrows
  (func $m.xarrow (param $cp i32) (result i32)
    (local $below i32)
    (local $above i32)
    (local $w i32)
    (local $l i32)
    (local $n i32)
    (local $e i32)
    (local $axis i32)
    (local.set $below (call $m.optArg (call $m.supStyle (global.get $mStyle))))
    (local.set $above (call $m.argIn (call $m.supStyle (global.get $mStyle))))
    (local.set $w (i32.add (call $m.max (call $m.W (local.get $above)) (call $m.W (local.get $below))) (call $m.sc (i32.const 560))))
    (local.set $w (call $m.max (local.get $w) (call $m.sc (i32.const 1000))))
    (local.set $e (call $m.pair (i32.const $pairs.arrows) (local.get $cp)))
    (local.set $e (select (local.get $e) (i32.const 1) (local.get $e)))
    (local.set $axis (call $m.sc (i32.const $MC.axis)))
    (local.set $n (call $m.pathNode (i32.const 31) (local.get $w) (i32.add (local.get $axis) (call $m.sc (i32.const 130)))
      (i32.or (local.get $e) (i32.shl (call $m.sc (i32.const 40)) (i32.const 10)))))
    (call $m.setD (local.get $n) (i32.const 0))
    (local.set $l (call $m.wrap (local.get $n)))
    (call $m.append (local.get $l) (local.get $above) (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $above))) (i32.const 1))
      (i32.sub (i32.const 0) (i32.add (i32.add (local.get $axis) (call $m.sc (i32.const 220))) (call $m.D (local.get $above)))))
    (call $m.append (local.get $l) (local.get $below) (i32.shr_s (i32.sub (local.get $w) (call $m.W (local.get $below))) (i32.const 1))
      (i32.add (i32.sub (call $m.sc (i32.const 220)) (local.get $axis)) (call $m.H (local.get $below))))
    (call $m.setW (local.get $l) (local.get $w))
    (local.get $l))

  ;; ---- environments

  ;; The parameters of environment [$p, $p + $len): kind | style << 3 |
  ;; left delimiter << 5 | right delimiter << 8 | takes an argument << 11.
  (func $m.envParams (param $p i32) (param $len i32) (result i32)
    (local $at i32)
    (local $n i32)
    (local $i i32)
    (local.set $at (i32.const $mem.mathEnvs))
    (block $none
      (loop $entry
        (local.set $n (i32.load8_u (local.get $at)))
        (br_if $none (i32.eqz (local.get $n)))
        (if (i32.eq (local.get $n) (local.get $len))
          (then
            (local.set $i (i32.const 0))
            (block $differ
              (loop $byte
                (br_if $differ (i32.ne (i32.load8_u offset=1 (i32.add (local.get $at) (local.get $i)))
                  (i32.load8_u (i32.add (local.get $p) (local.get $i)))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br_if $byte (i32.lt_u (local.get $i) (local.get $len))))
              (return (i32.load16_u offset=1 (i32.add (local.get $at) (local.get $n)))))))
        (local.set $at (i32.add (local.get $at) (i32.add (local.get $n) (i32.const 3))))
        (br $entry)))
    (i32.const 0))

  ;; the code point of delimiter code $k, the left one unless $right
  (func $m.envDelim (param $k i32) (param $right i32) (result i32)
    (i32.load16_u offset=$mem.mathStatic+632
      (i32.shl (i32.add (i32.shl (local.get $k) (i32.const 1)) (local.get $right)) (i32.const 1))))
  (data (i32.const $mem.mathStatic+632) "\2e\00\2e\00\28\00\29\00\5b\00\5d\00\7b\00\7d\00\7c\00\7c\00\16\20\16\20")

  ;; Rows and columns separated by `&` and `\\`: an environment, or the whole
  ;; formula when $params is -1. Cells are 16-byte entries on the cell stack:
  ;; node, column, row, a rule above the row, extra space below the row.
  (func $m.grid (param $params i32) (result i32)
    (local $root i32)
    (local $kind i32)
    (local $base i32)
    (local $cells i32)
    (local $col i32)
    (local $row i32)
    (local $n i32)
    (local $v i32)
    (local $c i32)
    (local $ncols i32)
    (local $nrows i32)
    (local $cellStyle i32)
    (local $old i32)
    (local $aligns i32)
    (local $bars i64)
    (local $widths i32)
    (local $at i32)
    (local $x i32)
    (local $y i32)
    (local $w i32)
    (local $gap i32)
    (local $total i32)
    (local $l i32)
    (local $top i32)
    (local $rh i32)
    (local $rd i32)
    (local $extra i32)
    (local $a i32)
    (local $o i32)
    (local $size i32)
    (local $rule i32)
    (local $hline i32)
    (local $half i32)
    (local $pad i32)
    (local.set $root (i32.lt_s (local.get $params) (i32.const 0)))
    (local.set $kind (select (i32.const 2) (i32.and (local.get $params) (i32.const 7)) (local.get $root)))
    (local.set $old (global.get $mStyle))
    (local.set $cellStyle (local.get $old))
    (if (i32.eqz (local.get $root))
      (then
        (local.set $v (i32.and (i32.shr_u (local.get $params) (i32.const 3)) (i32.const 3)))
        (local.set $cellStyle (select (i32.const 0) (select (i32.const 2) (i32.const 1) (i32.eq (local.get $v) (i32.const 2)))
          (i32.eq (local.get $v) (i32.const 1))))))
    (local.set $base (global.get $mC))
    ;; 64 column alignments (l, c, r), then the cells
    (local.set $aligns (local.get $base))
    (local.set $cells (i32.add (local.get $base) (i32.const 64)))
    (if (i32.ge_u (local.get $cells) (i32.const $mem.mathCellsEnd))
      (then (global.set $mFail (i32.const 1)) (return (call $m.list))))
    (memory.fill (local.get $aligns) (i32.const "c") (i32.const 64))
    (if (i32.eq (local.get $kind) (i32.const 4))
      (then
        ;; the column spec of an array
        (local.set $at (call $m.rawArg))
        (local.set $n (i32.add (local.get $at) (global.get $cmdLen)))
        (block $spec
          (loop $s
            (br_if $spec (i32.ge_u (local.get $at) (local.get $n)))
            (local.set $c (i32.load8_u (local.get $at)))
            (local.set $at (i32.add (local.get $at) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const ":")))
              (then (local.set $bars (i64.or (local.get $bars)
                (i64.shl (i64.const 1) (i64.extend_i32_u (local.get $col)))))))
            (if (i32.and (i32.or (i32.eq (local.get $c) (i32.const "l"))
                  (i32.or (i32.eq (local.get $c) (i32.const "c")) (i32.eq (local.get $c) (i32.const "r"))))
                  (i32.lt_u (local.get $col) (i32.const 63)))
              (then
                (i32.store8 (i32.add (local.get $aligns) (local.get $col)) (local.get $c))
                (local.set $col (i32.add (local.get $col) (i32.const 1)))))
            ;; skip the braces of @{...}, p{...} and the like
            (if (i32.and (i32.eq (i32.load8_u (local.get $at)) (i32.const "{"))
                  (i32.eqz (i32.or (i32.eq (local.get $c) (i32.const "l"))
                    (i32.or (i32.eq (local.get $c) (i32.const "c")) (i32.eq (local.get $c) (i32.const "r"))))))
              (then
                (loop $skip
                  (local.set $at (i32.add (local.get $at) (i32.const 1)))
                  (br_if $skip (i32.and (i32.lt_u (local.get $at) (local.get $n))
                    (i32.ne (i32.load8_u (local.get $at)) (i32.const "}")))))
                (local.set $at (i32.add (local.get $at) (i32.const 1)))))
            (br $s)))
        (local.set $col (i32.const 0))))
    (if (i32.and (i32.eqz (local.get $root)) (i32.ne (i32.and (local.get $params) (i32.const 2048)) (i32.const 0)))
      (then (drop (call $m.rawArg))))
    (global.set $mC (local.get $cells))
    ;; parse the cells
    (block $done
      (loop $cell
        (if (i32.ge_u (i32.add (global.get $mC) (i32.const 16)) (i32.const $mem.mathCellsEnd))
          (then (global.set $mFail (i32.const 1)) (br $done)))
        (global.set $mHline (i32.const 0))
        (call $m.setStyle (local.get $cellStyle))
        (local.set $n (call $m.parseList (i32.or (i32.const $P.cell)
          (select (i32.const $P.leadOrd) (i32.const 0)
            (i32.and (i32.eq (local.get $kind) (i32.const 2)) (i32.and (local.get $col) (i32.const 1)))))))
        (call $m.setStyle (local.get $old))
        (local.set $at (global.get $mC))
        (i32.store (local.get $at) (local.get $n))
        (i32.store offset=4 (local.get $at) (local.get $col))
        (i32.store offset=8 (local.get $at) (local.get $row))
        (i32.store offset=12 (local.get $at) (i32.const 0))
        (if (global.get $mHline)
          (then (local.set $hline (i32.or (local.get $hline)
            (select (i32.shl (i32.const 1) (local.get $row)) (i32.const 0) (i32.lt_u (local.get $row) (i32.const 32)))))))
        (global.set $mC (i32.add (local.get $at) (i32.const 16)))
        (br_if $done (global.get $mFail))
        (local.set $c (call $m.peek))
        (br_if $done (i32.eqz (local.get $c)))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
            (local.set $col (i32.add (local.get $col) (i32.const 1)))
            (br $cell)))
        (local.set $v (call $m.readCmd))
        (if (i32.eq (i32.shr_u (local.get $v) (i32.const 24)) (i32.const $K.cr))
          (then
            (if (i32.eq (call $m.peek) (i32.const "["))
              (then
                (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
                (i32.store offset=12 (local.get $at) (call $m.dimen (i32.const 0)))
                (if (i32.eq (call $m.peek) (i32.const "]"))
                  (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))))
            (local.set $row (i32.add (local.get $row) (i32.const 1)))
            (local.set $col (i32.const 0))
            (br $cell)))
        ;; \end closes an environment; the formula itself has none
        (drop (call $m.rawArg))
        (br_if $done (i32.eqz (local.get $root)))
        (local.set $col (i32.add (local.get $col) (i32.const 1)))
        (br $cell)))
    ;; a final row that holds one empty cell is dropped
    (local.set $at (i32.sub (global.get $mC) (i32.const 16)))
    (if (i32.and (i32.gt_u (local.get $at) (local.get $cells))
          (i32.and (i32.eqz (i32.load offset=4 (local.get $at)))
            (i32.eqz (call $m.W (i32.load (local.get $at))))))
      (then
        (if (i32.eqz (i32.load offset=$N.a (call $m.nAt (i32.load (local.get $at)))))
          (then (global.set $mC (local.get $at))))))
    ;; one cell: the formula itself
    (if (i32.and (local.get $root) (i32.eq (global.get $mC) (i32.add (local.get $cells) (i32.const 16))))
      (then
        (local.set $n (i32.load (local.get $cells)))
        (global.set $mC (local.get $base))
        (return (local.get $n))))
    (call $m.setStyle (local.get $cellStyle))
    ;; script-style grids (smallmatrix, subarray) have half the row struts of
    ;; others, and a subarray no padding, as in KaTeX
    (local.set $half (i32.eq (i32.and (local.get $cellStyle) (i32.const 3)) (i32.const 2)))
    (local.set $pad (i32.and (i32.eq (local.get $kind) (i32.const 4)) (i32.eqz (local.get $half))))
    ;; column widths, then row heights and depths, after the cells
    (local.set $at (local.get $cells))
    (block $sized
      (loop $count
        (br_if $sized (i32.ge_u (local.get $at) (global.get $mC)))
        (local.set $ncols (call $m.max (local.get $ncols) (i32.add (i32.load offset=4 (local.get $at)) (i32.const 1))))
        (local.set $nrows (call $m.max (local.get $nrows) (i32.add (i32.load offset=8 (local.get $at)) (i32.const 1))))
        (local.set $at (i32.add (local.get $at) (i32.const 16)))
        (br $count)))
    (local.set $widths (global.get $mC))
    (local.set $n (i32.shl (i32.add (local.get $ncols) (i32.mul (local.get $nrows) (i32.const 3))) (i32.const 2)))
    (if (i32.ge_u (i32.add (local.get $widths) (local.get $n)) (i32.const $mem.mathCellsEnd))
      (then
        (global.set $mFail (i32.const 1))
        (global.set $mC (local.get $base))
        (call $m.setStyle (local.get $old))
        (return (call $m.list))))
    (memory.fill (local.get $widths) (i32.const 0) (local.get $n))
    ;; per row: height, depth, extra space
    (local.set $rh (i32.add (local.get $widths) (i32.shl (local.get $ncols) (i32.const 2))))
    (local.set $at (local.get $cells))
    (block $measured
      (loop $m
        (br_if $measured (i32.ge_u (local.get $at) (local.get $widths)))
        (local.set $n (i32.load (local.get $at)))
        (local.set $col (i32.load offset=4 (local.get $at)))
        (local.set $row (i32.load offset=8 (local.get $at)))
        (local.set $a (i32.add (local.get $widths) (i32.shl (local.get $col) (i32.const 2))))
        (i32.store (local.get $a) (call $m.max (i32.load (local.get $a)) (call $m.W (local.get $n))))
        (local.set $a (i32.add (local.get $rh) (i32.mul (local.get $row) (i32.const 12))))
        (i32.store (local.get $a) (call $m.max (i32.load (local.get $a)) (call $m.H (local.get $n))))
        (i32.store offset=4 (local.get $a) (call $m.max (i32.load offset=4 (local.get $a)) (call $m.D (local.get $n))))
        (i32.store offset=8 (local.get $a) (call $m.max (i32.load offset=8 (local.get $a)) (i32.load offset=12 (local.get $at))))
        (local.set $at (i32.add (local.get $at) (i32.const 16)))
        (br $m)))
    ;; struts and row gaps; aligned and gathered rows add \jot
    (local.set $row (i32.const 0))
    (loop $r
      (local.set $a (i32.add (local.get $rh) (i32.mul (local.get $row) (i32.const 12))))
      (i32.store (local.get $a) (call $m.max (i32.load (local.get $a)) (call $m.sc (select (i32.const 600) (i32.const 840) (local.get $half)))))
      (i32.store offset=4 (local.get $a) (i32.add (call $m.max (i32.load offset=4 (local.get $a))
          (call $m.sc (select (i32.const 257) (i32.const 360) (local.get $half))))
        (i32.add (i32.load offset=8 (local.get $a))
          (select (call $m.sc (i32.const 300)) (i32.const 0)
            (i32.and (i32.le_u (i32.sub (local.get $kind) (i32.const 2)) (i32.const 1))
              (i32.lt_u (i32.add (local.get $row) (i32.const 1)) (local.get $nrows)))))))
      (local.set $total (i32.add (local.get $total)
        (i32.add (i32.load (local.get $a)) (i32.load offset=4 (local.get $a)))))
      (local.set $row (i32.add (local.get $row) (i32.const 1)))
      (br_if $r (i32.lt_u (local.get $row) (local.get $nrows))))
    ;; column positions replace the widths' slots in a second array
    (local.set $l (call $m.list))
    (local.set $x (select (call $m.sc (i32.const 500)) (i32.const 0) (local.get $pad)))
    (local.set $top (i32.sub (i32.const 0) (i32.add (i32.shr_s (local.get $total) (i32.const 1)) (call $m.sc (i32.const $MC.axis)))))
    (local.set $at (local.get $cells))
    (local.set $col (i32.const 0))
    (local.set $gap (i32.const 0))
    ;; x of each column, written over the cell stack past the row data
    (local.set $o (i32.add (local.get $rh) (i32.mul (local.get $nrows) (i32.const 12))))
    (if (i32.ge_u (i32.add (local.get $o) (i32.shl (local.get $ncols) (i32.const 2))) (i32.const $mem.mathCellsEnd))
      (then
        (global.set $mFail (i32.const 1))
        (global.set $mC (local.get $base))
        (call $m.setStyle (local.get $old))
        (return (local.get $l))))
    (loop $cx
      (i32.store (i32.add (local.get $o) (i32.shl (local.get $col) (i32.const 2))) (local.get $x))
      (if (i64.ne (i64.and (local.get $bars) (i64.shl (i64.const 1) (i64.extend_i32_u (local.get $col)))) (i64.const 0))
        (then
          (local.set $rule (call $m.node (i32.const $NK.rule)))
          (call $m.setBox (local.get $rule) (call $m.sc (i32.const 50)) (i32.const 0) (local.get $total))
          (call $m.append (local.get $l) (local.get $rule)
            (i32.sub (local.get $x) (select (call $m.sc (i32.const 500)) (i32.const 0) (i32.ne (local.get $col) (i32.const 0))))
            (local.get $top))))
      (local.set $x (i32.add (local.get $x) (i32.load (i32.add (local.get $widths) (i32.shl (local.get $col) (i32.const 2))))))
      (local.set $gap (call $m.sc
        (if (result i32) (i32.eq (local.get $kind) (i32.const 2))
          (then (select (i32.const 0) (i32.const 1000) (i32.eqz (i32.and (local.get $col) (i32.const 1)))))
          (else (select (i32.const 333) (i32.const 1000) (i32.eq (i32.and (local.get $cellStyle) (i32.const 3)) (i32.const 2)))))))
      (local.set $col (i32.add (local.get $col) (i32.const 1)))
      (if (i32.lt_u (local.get $col) (local.get $ncols))
        (then (local.set $x (i32.add (local.get $x) (local.get $gap)))))
      (br_if $cx (i32.lt_u (local.get $col) (local.get $ncols))))
    (if (local.get $pad)
      (then (local.set $x (i32.add (local.get $x) (call $m.sc (i32.const 500))))))
    (if (i64.ne (i64.and (local.get $bars) (i64.shl (i64.const 1) (i64.extend_i32_u (local.get $ncols)))) (i64.const 0))
      (then
        (local.set $rule (call $m.node (i32.const $NK.rule)))
        (call $m.setBox (local.get $rule) (call $m.sc (i32.const 50)) (i32.const 0) (local.get $total))
        (call $m.append (local.get $l) (local.get $rule) (i32.sub (local.get $x) (call $m.sc (i32.const 50))) (local.get $top))))
    (local.set $w (local.get $x))
    ;; place the cells
    (block $placed
      (loop $p
        (br_if $placed (i32.ge_u (local.get $at) (local.get $widths)))
        (local.set $n (i32.load (local.get $at)))
        (local.set $col (i32.load offset=4 (local.get $at)))
        (local.set $row (i32.load offset=8 (local.get $at)))
        (local.set $y (local.get $top))
        (local.set $a (i32.const 0))
        (loop $above
          (if (i32.lt_u (local.get $a) (local.get $row))
            (then
              (local.set $y (i32.add (local.get $y) (i32.add
                (i32.load (i32.add (local.get $rh) (i32.mul (local.get $a) (i32.const 12))))
                (i32.load offset=4 (i32.add (local.get $rh) (i32.mul (local.get $a) (i32.const 12)))))))
              (local.set $a (i32.add (local.get $a) (i32.const 1)))
              (br $above))))
        (local.set $y (i32.add (local.get $y) (i32.load (i32.add (local.get $rh) (i32.mul (local.get $row) (i32.const 12))))))
        (local.set $c (select (i32.load8_u (i32.add (local.get $aligns) (local.get $col))) (i32.const "c")
          (i32.lt_u (local.get $col) (i32.const 64))))
        (if (i32.eq (local.get $kind) (i32.const 1)) (then (local.set $c (i32.const "l"))))
        (if (i32.and (i32.eq (local.get $kind) (i32.const 2)) (i32.gt_u (local.get $ncols) (i32.const 1)))
          (then (local.set $c (select (i32.const "l") (i32.const "r") (i32.and (local.get $col) (i32.const 1))))))
        (local.set $x (i32.load (i32.add (local.get $o) (i32.shl (local.get $col) (i32.const 2)))))
        (local.set $gap (i32.sub (i32.load (i32.add (local.get $widths) (i32.shl (local.get $col) (i32.const 2))))
          (call $m.W (local.get $n))))
        (if (i32.eq (local.get $c) (i32.const "c")) (then (local.set $x (i32.add (local.get $x) (i32.shr_s (local.get $gap) (i32.const 1))))))
        (if (i32.eq (local.get $c) (i32.const "r")) (then (local.set $x (i32.add (local.get $x) (local.get $gap)))))
        (call $m.append (local.get $l) (local.get $n) (local.get $x) (local.get $y))
        (local.set $at (i32.add (local.get $at) (i32.const 16)))
        (br $p)))
    ;; rules from \hline, above their rows
    (local.set $y (local.get $top))
    (local.set $row (i32.const 0))
    (loop $hl
      (if (i32.and (i32.lt_u (local.get $row) (i32.const 32))
            (i32.and (i32.shr_u (local.get $hline) (local.get $row)) (i32.const 1)))
        (then
          (local.set $rule (call $m.node (i32.const $NK.rule)))
          (call $m.setBox (local.get $rule) (local.get $w) (i32.const 0) (call $m.sc (i32.const 50)))
          (call $m.append (local.get $l) (local.get $rule) (i32.const 0) (local.get $y))))
      (local.set $a (i32.add (local.get $rh) (i32.mul (local.get $row) (i32.const 12))))
      (local.set $y (i32.add (local.get $y) (i32.add (i32.load (local.get $a)) (i32.load offset=4 (local.get $a)))))
      (local.set $row (i32.add (local.get $row) (i32.const 1)))
      (br_if $hl (i32.le_u (local.get $row) (local.get $nrows))))
    (call $m.setStyle (local.get $old))
    (call $m.setBox (local.get $l) (local.get $w)
      (i32.sub (i32.const 0) (local.get $top)) (i32.add (local.get $top) (local.get $total)))
    (global.set $mC (local.get $base))
    ;; delimiters around the grid
    (local.set $v (i32.and (i32.shr_u (local.get $params) (i32.const 5)) (i32.const 7)))
    (local.set $c (i32.and (i32.shr_u (local.get $params) (i32.const 8)) (i32.const 7)))
    (if (i32.or (local.get $root) (i32.eqz (i32.or (local.get $v) (local.get $c))))
      (then (return (local.get $l))))
    (local.set $size (call $m.fence (call $m.H (local.get $l)) (call $m.D (local.get $l))))
    (local.set $o (call $m.list))
    (local.set $n (call $m.delim (call $m.envDelim (local.get $v) (i32.const 0)) (local.get $size) (i32.const 4)))
    (call $m.append (local.get $o) (local.get $n) (i32.const 0) (i32.const 0))
    (local.set $x (i32.add (call $m.W (local.get $n)) (call $m.sc (select (i32.const 0) (i32.const 120) (local.get $v)))))
    (call $m.append (local.get $o) (local.get $l) (local.get $x) (i32.const 0))
    (local.set $x (i32.add (local.get $x) (local.get $w)))
    (local.set $n (call $m.delim (call $m.envDelim (local.get $c) (i32.const 1)) (local.get $size) (i32.const 5)))
    (call $m.append (local.get $o) (local.get $n) (local.get $x) (i32.const 0))
    (call $m.setW (local.get $o) (i32.add (local.get $x) (call $m.W (local.get $n))))
    (local.get $o))

  ;; ---- commands

  ;; Run command value $v, which a list since $base is reading.
  (func $m.command (param $v i32) (param $base i32) (param $flags i32)
    (local $k i32)
    (local $x i32)
    (local $n i32)
    (local $m i32)
    (local $old i32)
    (local $class i32)
    (local $l i32)
    (local $p i32)
    (local $i i32)
    (local $c i32)
    (local $d i32)
    (local $dst i32)
    (local $depth i32)
    (local.set $k (i32.shr_u (local.get $v) (i32.const 24)))
    (local.set $class (i32.and (i32.shr_u (local.get $v) (i32.const 21)) (i32.const 7)))
    (local.set $x (i32.and (local.get $v) (i32.const 0x1fffff)))
    (block $k31 (block $k30 (block $k29 (block $k28 (block $k27 (block $k26 (block $k25 (block $k24
    (block $k23 (block $k22 (block $k21 (block $k20 (block $k19 (block $k18 (block $k17
    (block $k16 (block $k15 (block $k14 (block $k13 (block $k12 (block $k11 (block $k10
    (block $k9 (block $k8 (block $k7 (block $k6 (block $k4 (block $k2 (block $k1 (block $k0
      (br_table $k0 $k1 $k2 $k2 $k4 $k4 $k6 $k7 $k8 $k9 $k10 $k11 $k12 $k13 $k14 $k15
        $k16 $k17 $k18 $k19 $k20 $k21 $k22 $k23 $k24 $k25 $k26 $k27 $k28 $k29 $k30 $k31 $k31
        (local.get $k)))
      ;; sym
      (call $m.push (call $m.symbol (local.get $x) (local.get $class)) (local.get $class) (i32.const 0))
      (return))
      ;; ital: Greek in the current letter font
      (call $m.push (call $m.letter (local.get $x)) (i32.const 0) (i32.const 0))
      (return))
      ;; op, opl
      (call $m.push (call $m.bigOp (local.get $x)) (i32.const 1)
        (i32.or (i32.const $AF.op) (select (i32.const $AF.displayLimits) (i32.const 0) (i32.eq (local.get $k) (i32.const 3)))))
      (return))
      ;; fn, fnl
      (call $m.push (call $m.opName (global.get $cmdP) (global.get $cmdLen) (local.get $x)) (i32.const 1)
        (select (i32.const $AF.displayLimits) (i32.const 0) (i32.eq (local.get $k) (i32.const 5))))
      (return))
      ;; accent
      (call $m.push (call $m.accent (local.get $x) (call $m.arg)) (i32.const 0) (i32.const 0))
      (return))
      ;; wide accents; braces take limits like operators
      (local.set $n (call $m.wide (local.get $x) (call $m.arg)))
      (if (i32.and (local.get $x) (i32.const 0x40))
        (then (call $m.push (local.get $n) (i32.const 1) (i32.const $AF.limits)))
        (else (call $m.push (local.get $n) (i32.const 0) (i32.const 0))))
      (return))
      ;; frac: an ordinary atom, as in KaTeX and MathJax, not TeX's inner
      (call $m.push (call $m.frac (local.get $x) (i32.const -1) (i32.const 0) (i32.const -1)) (i32.const 0) (i32.const 0))
      (return))
      ;; sqrt
      (call $m.push (call $m.sqrt) (i32.const 0) (i32.const 0))
      (return))
      ;; \left; a stray \right or \middle drops its delimiter
      (if (local.get $x)
        (then (drop (call $m.readDelim)) (return)))
      (call $m.push (call $m.leftRight) (i32.const 7) (i32.const 0))
      (return))
      ;; \big and friends
      (local.set $n (call $m.readDelim))
      (call $m.push (call $m.delim (local.get $n)
        (call $m.sc (i32.add (i32.const 600) (i32.mul (local.get $x) (i32.const 600)))) (local.get $class))
        (local.get $class) (i32.const 0))
      (return))
      ;; letter fonts; \bf and the other old switches set the rest of the list
      (if (i32.and (local.get $x) (i32.const 0x40))
        (then
          (global.set $mVariant (i32.and (local.get $x) (i32.const 0xf)))
          (return)))
      ;; \mathsfit (11) sets sans-serif, then slants it
      (local.set $old (global.get $mVariant))
      (global.set $mVariant (select (i32.const 7) (local.get $x) (i32.eq (local.get $x) (i32.const 11))))
      (local.set $n (call $m.arg))
      (global.set $mVariant (local.get $old))
      (if (i32.eq (local.get $x) (i32.const 11)) (then (call $m.slant (local.get $n))))
      (call $m.push (local.get $n) (global.get $mLastClass) (i32.const 0))
      (return))
      ;; text
      (call $m.push (call $m.textArg (call $m.textFlags (local.get $x))) (i32.const 0) (i32.const 0))
      (return))
      ;; spaces, in mu
      (call $m.push (call $m.kern (call $m.sc (i32.div_s (i32.mul (i32.sub (local.get $x) (i32.const 0x40)) (i32.const 1000)) (i32.const 18))))
        (i32.const 8) (i32.const 0))
      (return))
      ;; style switches set the rest of the list
      (local.set $old (global.get $mStyle))
      (call $m.setStyle (local.get $x))
      (local.set $n (call $m.parseList (i32.and (local.get $flags) (i32.const 0x79))))
      (call $m.setStyle (local.get $old))
      (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
      (return))
      ;; \color{c} sets the rest of the list, \textcolor{c}{x} its argument
      (local.set $m (call $m.colorArg))
      (local.set $n (if (result i32) (local.get $x)
        (then (call $m.arg))
        (else (call $m.parseList (i32.and (local.get $flags) (i32.const 0x79))))))
      (if (local.get $m) (then (i32.store offset=$N.e (call $m.nAt (local.get $n)) (local.get $m))))
      (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
      (return))
      ;; \begin{name}
      (local.set $m (call $m.rawArg))
      (call $m.push (call $m.grid (call $m.envParams (local.get $m) (global.get $cmdLen))) (i32.const 0) (i32.const 0))
      (return))
      ;; a stray \end{name}
      (drop (call $m.rawArg))
      (return))
      ;; \overset, \underset, \stackrel
      (local.set $m (call $m.argIn (call $m.supStyle (global.get $mStyle))))
      (local.set $n (call $m.arg))
      (local.set $class (select (i32.const 3) (global.get $mLastClass) (i32.eq (local.get $x) (i32.const 2))))
      (call $m.push (local.get $n) (local.get $class) (i32.const $AF.limits))
      (i32.store16 (i32.add (i32.sub (global.get $mA) (i32.const $A.size))
        (select (i32.const $A.sub) (i32.const $A.sup) (i32.eq (local.get $x) (i32.const 1)))) (local.get $m))
      (return))
      ;; extensible arrows
      (call $m.push (call $m.xarrow (local.get $x)) (i32.const 3) (i32.const 0))
      (return))
      ;; \phantom, \hphantom, \vphantom, \smash, \mathstrut
      (if (i32.eq (local.get $x) (i32.const 4))
        (then
          (local.set $n (call $m.kern (i32.const 0)))
          (call $m.setBox (local.get $n) (i32.const 0) (call $m.sc (i32.const 750)) (call $m.sc (i32.const $MC.axis)))
          (call $m.push (local.get $n) (i32.const 8) (i32.const 0))
          (return)))
      ;; \mathllap, \mathrlap, \mathclap; \llap and the others take text
      (if (i32.ge_u (local.get $x) (i32.const 5))
        (then
          (local.set $m (if (result i32) (i32.and (local.get $x) (i32.const 8))
            (then (call $m.textArg (i32.const 0))) (else (call $m.arg))))
          (local.set $x (i32.and (local.get $x) (i32.const 7)))
          (local.set $n (call $m.list))
          (call $m.append (local.get $n) (local.get $m)
            (select (i32.sub (i32.const 0) (call $m.W (local.get $m)))
              (select (i32.const 0) (i32.div_s (call $m.W (local.get $m)) (i32.const -2)) (i32.eq (local.get $x) (i32.const 6)))
              (i32.eq (local.get $x) (i32.const 5)))
            (i32.const 0))
          (call $m.setW (local.get $n) (i32.const 0))
          (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
          (return)))
      (local.set $m (call $m.arg))
      (if (i32.eq (local.get $x) (i32.const 3))
        (then
          (local.set $n (call $m.wrap (local.get $m)))
          (call $m.setH (local.get $n) (i32.const 0))
          (call $m.setD (local.get $n) (i32.const 0)))
        (else
          (local.set $n (call $m.kern (select (i32.const 0) (call $m.W (local.get $m)) (i32.eq (local.get $x) (i32.const 2)))))
          (if (i32.ne (local.get $x) (i32.const 1))
            (then
              (call $m.setH (local.get $n) (call $m.H (local.get $m)))
              (call $m.setD (local.get $n) (call $m.D (local.get $m)))))))
      (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
      (return))
      ;; \cancel, \bcancel, \xcancel: lines across the box that add no size,
      ;; padded as KaTeX pads them; \sout: a rule at the axis
      (if (i32.ge_u (local.get $x) (i32.const 4))
        (then
          (local.set $m (call $m.arg))
          (local.set $n (call $m.wrap (local.get $m)))
          (if (i32.eq (local.get $x) (i32.const 7))
            (then
              (local.set $l (call $m.node (i32.const $NK.rule)))
              (local.set $old (call $m.sc (i32.const $MC.rule)))
              (local.set $d (call $m.sc (i32.const $MC.axis)))
              (call $m.setBox (local.get $l) (call $m.W (local.get $m))
                (i32.add (local.get $d) (i32.shr_s (local.get $old) (i32.const 1)))
                (i32.sub (i32.shr_s (local.get $old) (i32.const 1)) (local.get $d)))
              (call $m.append (local.get $n) (local.get $l) (i32.const 0) (i32.const 0)))
            (else
              ;; one glyph gets vertical padding, anything else horizontal
              (local.set $i (i32.eq (i32.load8_u (call $m.nAt (call $m.core (local.get $m)))) (i32.const $NK.glyph)))
              (local.set $old (call $m.sc (i32.const 200)))
              (local.set $p (select (i32.const 0) (local.get $old) (local.get $i)))
              (local.set $d (select (local.get $old) (i32.const 0) (local.get $i)))
              ;; path 9 is a slash, 10 a backslash
              (local.set $c (i32.const 9))
              (loop $line
                (if (i32.or (i32.eq (local.get $x) (i32.const 6)) (i32.eq (i32.add (local.get $x) (i32.const 5)) (local.get $c)))
                  (then
                    (local.set $l (call $m.node (i32.const $NK.path)))
                    (i32.store offset=$N.a (call $m.nAt (local.get $l)) (local.get $c))
                    (call $m.setBox (local.get $l) (i32.add (call $m.W (local.get $m)) (i32.shl (local.get $p) (i32.const 1)))
                      (i32.add (call $m.H (local.get $m)) (local.get $d)) (i32.add (call $m.D (local.get $m)) (local.get $d)))
                    (call $m.append (local.get $n) (local.get $l) (i32.sub (i32.const 0) (local.get $p)) (i32.const 0))))
                (local.set $c (i32.add (local.get $c) (i32.const 1)))
                (br_if $line (i32.le_u (local.get $c) (i32.const 10))))))
          (call $m.setBox (local.get $n) (call $m.W (local.get $m)) (call $m.H (local.get $m)) (call $m.D (local.get $m)))
          (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
          (return)))
      ;; \boxed sets its argument in display style, as amsmath does; \fbox,
      ;; \colorbox{bg} and \fcolorbox{frame}{bg} take text
      (if (i32.ge_u (local.get $x) (i32.const 2)) (then (local.set $c (call $m.colorArg))))
      (if (i32.eq (local.get $x) (i32.const 3)) (then (local.set $d (call $m.colorArg))))
      (if (i32.eq (local.get $x) (i32.const 2))
        (then
          (local.set $d (local.get $c))
          (local.set $c (i32.const 0))))
      (local.set $m (if (result i32) (local.get $x) (then (call $m.textArg (i32.const 0))) (else (call $m.argIn (i32.const 0)))))
      (local.set $old (call $m.sc (i32.const 300)))
      (local.set $n (call $m.list))
      (if (local.get $d)
        (then
          (local.set $l (call $m.node (i32.const $NK.rule)))
          (call $m.setBox (local.get $l) (i32.add (call $m.W (local.get $m)) (i32.shl (local.get $old) (i32.const 1)))
            (i32.add (call $m.H (local.get $m)) (local.get $old)) (i32.add (call $m.D (local.get $m)) (local.get $old)))
          (local.set $l (call $m.wrap (local.get $l)))
          (i32.store offset=$N.e (call $m.nAt (local.get $l)) (local.get $d))
          (call $m.append (local.get $n) (local.get $l) (i32.const 0) (i32.const 0))))
      (if (i32.ne (local.get $x) (i32.const 2))
        (then
          (local.set $l (call $m.pathNode (i32.const 32) (i32.add (call $m.W (local.get $m)) (i32.shl (local.get $old) (i32.const 1)))
            (i32.add (call $m.H (local.get $m)) (local.get $old)) (call $m.sc (i32.const 40))))
          (call $m.setD (local.get $l) (i32.add (call $m.D (local.get $m)) (local.get $old)))
          (if (local.get $c)
            (then
              (local.set $l (call $m.wrap (local.get $l)))
              (i32.store offset=$N.e (call $m.nAt (local.get $l)) (local.get $c))))
          (call $m.append (local.get $n) (local.get $l) (i32.const 0) (i32.const 0))))
      (call $m.append (local.get $n) (local.get $m) (local.get $old) (i32.const 0))
      (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
      (return))
      ;; \not
      (global.set $mNot (i32.const 1))
      (return))
      ;; \operatorname
      (local.set $old (global.get $mVariant))
      (global.set $mVariant (i32.const 0))
      (local.set $n (call $m.arg))
      (global.set $mVariant (local.get $old))
      (call $m.push (local.get $n) (i32.const 1) (select (i32.const $AF.displayLimits) (i32.const 0) (local.get $x)))
      (return))
      ;; \limits, \nolimits, \displaylimits
      (local.set $m (i32.sub (global.get $mA) (i32.const $A.size)))
      (if (i32.ge_u (local.get $m) (local.get $base))
        (then (i32.store8 offset=$A.flags (local.get $m) (i32.or
          (i32.and (i32.load8_u offset=$A.flags (local.get $m)) (i32.const 0xf8))
          (i32.shl (i32.const 1) (local.get $x))))))
      (return))
      ;; \bmod, \pmod, \mod, \pod
      (if (i32.eqz (local.get $x))
        (then
          (call $m.push (call $m.textNode (i32.const $mem.mathStatic) (i32.const 3) (i32.const 0)) (i32.const 2) (i32.const 0))
          (return)))
      (call $m.push (call $m.kern (call $m.sc (select (i32.const 1000) (i32.const 444)
        (i32.lt_u (i32.and (global.get $mStyle) (i32.const 3)) (i32.const 2))))) (i32.const 8) (i32.const 0))
      (if (i32.ne (local.get $x) (i32.const 2))
        (then (call $m.push (call $m.symbol (i32.const "(") (i32.const 4)) (i32.const 4) (i32.const 0))))
      (if (i32.ne (local.get $x) (i32.const 3))
        (then
          (call $m.push (call $m.textNode (i32.const $mem.mathStatic) (i32.const 3) (i32.const 0)) (i32.const 0) (i32.const 0))
          (call $m.push (call $m.kern (call $m.sc (i32.const 333))) (i32.const 8) (i32.const 0))))
      (call $m.push (call $m.arg) (i32.const 0) (i32.const 0))
      (if (i32.ne (local.get $x) (i32.const 2))
        (then (call $m.push (call $m.symbol (i32.const ")") (i32.const 5)) (i32.const 5) (i32.const 0))))
      (return))
      ;; \rule[raise]{width}{height}
      (if (i32.eq (local.get $x) (i32.const 2))
        (then
          (call $m.skipSpace)
          (if (i32.eq (call $m.peek) (i32.const "["))
            (then
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (local.set $old (call $m.dimen (i32.const 0)))
              (if (i32.eq (call $m.peek) (i32.const "]"))
                (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))))
          (local.set $m (call $m.max (call $m.dimen (i32.const 0)) (i32.const 0)))
          (local.set $n (call $m.node (i32.const $NK.rule)))
          (call $m.setBox (local.get $n) (local.get $m)
            (i32.add (local.get $old) (call $m.max (call $m.dimen (i32.const 0)) (i32.const 0)))
            (i32.sub (i32.const 0) (local.get $old)))
          (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
          (return)))
      ;; \raisebox{lift}{text}; \vcenter{math} centers its box on the axis
      (if (i32.ge_u (local.get $x) (i32.const 3))
        (then
          (if (i32.eq (local.get $x) (i32.const 3))
            (then
              (local.set $old (i32.sub (i32.const 0) (call $m.dimen (i32.const 0))))
              (local.set $m (call $m.textArg (i32.const 0))))
            (else
              (local.set $m (call $m.arg))
              (local.set $old (i32.sub (i32.shr_s (i32.sub (call $m.H (local.get $m)) (call $m.D (local.get $m))) (i32.const 1))
                (call $m.sc (i32.const $MC.axis))))))
          (local.set $n (call $m.list))
          (call $m.append (local.get $n) (local.get $m) (i32.const 0) (local.get $old))
          (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
          (return)))
      ;; \hspace, \kern, \mkern
      (call $m.push (call $m.kern (call $m.dimen (local.get $x))) (i32.const 8) (i32.const 0))
      (return))
      ;; a stray \\
      (if (i32.eq (call $m.peek) (i32.const "["))
        (then
          (drop (call $m.dimen (i32.const 0)))
          (if (i32.eq (call $m.peek) (i32.const "]"))
            (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))))
      (return))
      ;; ignored: \label and \tag drop their argument, \hline marks the row
      (if (i32.le_u (i32.sub (local.get $x) (i32.const 1)) (i32.const 1))
        (then (drop (call $m.rawArg))))
      (if (i32.eq (local.get $x) (i32.const 3)) (then (global.set $mHline (i32.const 1))))
      (return))
      ;; \mathop, \mathbin and the other class commands
      (local.set $n (call $m.arg))
      (call $m.push (local.get $n)
        (select (i32.const 1) (select (i32.const 0) (local.get $x) (i32.eq (local.get $x) (i32.const 8)))
          (i32.eqz (local.get $x)))
        (select (i32.const $AF.displayLimits) (i32.const 0) (i32.eqz (local.get $x))))
      (return))
    ;; Macros: the body's TeX parses here as if it were the source. A body
    ;; with an argument is copied past the source first, with the argument's
    ;; source for #1 to #4 (see tables/math.txt).
    (local.set $m (i32.add (i32.const $mem.mathCmds+1) (local.get $x)))
    (local.set $n (i32.add (local.get $m) (i32.load8_u offset=$mem.mathCmds (local.get $x))))
    (if (local.get $class)
      (then
        (local.set $p (call $m.rawArg))
        (local.set $l (i32.add (local.get $p) (global.get $cmdLen)))
        (local.set $dst (global.get $mTop))
        (block $copied
          (loop $copy
            (br_if $copied (i32.ge_u (local.get $m) (local.get $n)))
            (local.set $c (i32.load8_u (local.get $m)))
            (local.set $m (i32.add (local.get $m) (i32.const 1)))
            (if (i32.ne (local.get $c) (i32.const "#"))
              (then
                (i32.store8 (local.get $dst) (local.get $c))
                (local.set $dst (i32.add (local.get $dst) (i32.const 1))))
              (else
                (local.set $d (i32.load8_u (local.get $m)))
                (local.set $m (i32.add (local.get $m) (i32.const 1)))
                (local.set $i (local.get $p))
                (local.set $depth (i32.const 0))
                (block $arg
                  (loop $a
                    (br_if $arg (i32.ge_u (local.get $i) (local.get $l)))
                    ;; a pass writes up to 12 bytes; the area's last 32 stay free
                    (if (i32.ge_u (local.get $dst) (i32.const $mem.mathSrcEnd-32))
                      (then (global.set $mFail (i32.const 1)) (return)))
                    (local.set $c (i32.load8_u (local.get $i)))
                    (local.set $i (i32.add (local.get $i) (i32.const 1)))
                    (if (i32.eq (local.get $c) (i32.const "\5c"))
                      (then
                        (i32.store8 (local.get $dst) (local.get $c))
                        (local.set $dst (i32.add (local.get $dst) (i32.const 1)))
                        (local.set $c (i32.load8_u (local.get $i)))
                        (local.set $i (i32.add (local.get $i) (i32.const 1))))
                      (else
                        (local.set $depth (i32.sub (i32.add (local.get $depth) (i32.eq (local.get $c) (i32.const "{")))
                          (i32.eq (local.get $c) (i32.const "}"))))
                        (if (i32.and (i32.eq (local.get $c) (i32.const "|"))
                              (i32.and (i32.eqz (local.get $depth)) (i32.ne (local.get $d) (i32.const "1"))))
                          (then
                            (memory.copy (local.get $dst)
                              (i32.add (i32.const $m.bars) (i32.mul (i32.sub (i32.const "4") (local.get $d)) (i32.const 12)))
                              (i32.const 12))
                            (local.set $dst (i32.add (local.get $dst)
                              (select (i32.const 5) (i32.const 12) (i32.eq (local.get $d) (i32.const "2")))))
                            (br $a)))))
                    (i32.store8 (local.get $dst) (local.get $c))
                    (local.set $dst (i32.add (local.get $dst) (i32.const 1)))
                    (br $a)))))
            (if (i32.ge_u (local.get $dst) (i32.const $mem.mathSrcEnd-32))
              (then (global.set $mFail (i32.const 1)) (return)))
            (br $copy)))
        (i64.store (local.get $dst) (i64.const 0))
        (local.set $m (global.get $mTop))
        (local.set $n (local.get $dst))
        (global.set $mTop (i32.add (local.get $dst) (i32.const 8)))))
    (local.set $old (global.get $mp))
    (local.set $l (global.get $me))
    (global.set $mp (local.get $m))
    (global.set $me (local.get $n))
    (local.set $i (global.get $mInfix))
    (drop (call $m.parseList (i32.const $P.inline)))
    (global.set $mp (local.get $old))
    (global.set $me (local.get $l))
    ;; No node points into the copied body, so its space and the splits found
    ;; in it are free again.
    (if (i32.and (i32.ne (local.get $class) (i32.const 0)) (i32.le_u (global.get $mPin) (local.get $m)))
      (then
        (global.set $mTop (local.get $m))
        (global.set $mInfix (local.get $i)))))

  ;; what #2, #4 and #3 of a macro put in place of a top-level |
  (const $m.bars $mem.mathStatic+960)
  (data (i32.const $m.bars) "\5c;\5cmiddle|\5c;\5c,\5cmiddle|\5c,\5cmid ")

  ;; Read a color argument: its source offset | length << 16, as a list's
  ;; color, or 0 when it is not a safe color name.
  (func $m.colorArg (result i32)
    (local $p i32)
    (local.set $p (call $m.rawArg))
    (global.set $mPin (call $m.max (global.get $mPin) (i32.add (local.get $p) (global.get $cmdLen))))
    (select (i32.or (i32.sub (local.get $p) (i32.const $mem.mathSrc)) (i32.shl (global.get $cmdLen) (i32.const 16)))
      (i32.const 0) (call $m.colorName (local.get $p) (global.get $cmdLen))))

  ;; Print the sans-serif letters in box $n as sans-serif italic ones. They
  ;; keep the upright metrics: the font table has no slanted ones.
  (func $m.slant (param $n i32)
    (local $p i32)
    (local.set $p (call $m.nAt (local.get $n)))
    (if (i32.and (i32.eq (i32.load8_u (local.get $p)) (i32.const $NK.glyph))
          (i32.lt_u (i32.sub (i32.load offset=$N.a (local.get $p)) (i32.const 0x1d5a0)) (i32.const 52)))
      (then (i32.store offset=$N.a (local.get $p) (i32.add (i32.load offset=$N.a (local.get $p)) (i32.const 0x68)))))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const $NK.list))
      (then
        (local.set $n (i32.load offset=$N.a (local.get $p)))
        (loop $child
          (if (local.get $n)
            (then
              (call $m.slant (local.get $n))
              (local.set $n (i32.load offset=$N.next (call $m.nAt (local.get $n))))
              (br $child)))))))

  ;; Whether [$p, $p + $len) can go in an attribute as a color: ASCII letters,
  ;; digits and `#`, up to 32 bytes.
  (func $m.colorName (param $p i32) (param $len i32) (result i32)
    (local $c i32)
    (if (i32.or (i32.eqz (local.get $len)) (i32.gt_u (local.get $len) (i32.const 32)))
      (then (return (i32.const 0))))
    (loop $l
      (local.set $c (i32.load8_u (local.get $p)))
      (if (i32.eqz (i32.or (call $isAlnum (local.get $c)) (i32.eq (local.get $c) (i32.const "#"))))
        (then (return (i32.const 0))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (local.set $len (i32.sub (local.get $len) (i32.const 1)))
      (br_if $l (local.get $len)))
    (i32.const 1))

  ;; The class of ASCII character $c in math: 0 ord, 2 bin, 3 rel, 4 open,
  ;; 5 close, 6 punct (see $mem.mathAscii).
  (const $mem.mathAscii $mem.mathStatic+420)
  (data (i32.const $mem.mathAscii)
    "\00\05\00\00\00\00\00\00\04\05\02\02\06\02\00\00\00\00\00\00\00\00\00\00\00\00\03\06\03\03\03\05"
    "\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\04\00\05\00\00"
    "\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00")

  ;; Parse atoms until the end or a terminator that $flags names, and lay them
  ;; out as a list. Terminators are left unread.
  (func $m.parseList (param $flags i32) (result i32)
    (local $base i32)
    (local $c i32)
    (local $v i32)
    (local $save i32)
    (local $k i32)
    (local $n i32)
    (local $old i32)
    (local $start i32)
    (local $style i32)
    (local $variant i32)
    (local $end i32)
    (local $t i32)
    (local.set $base (global.get $mA))
    (local.set $start (global.get $mp))
    (local.set $style (global.get $mStyle))
    (local.set $variant (global.get $mVariant))
    (global.set $mDepth (i32.add (global.get $mDepth) (i32.const 1)))
    (if (i32.gt_u (global.get $mDepth) (i32.const 48))
      (then (global.set $mFail (i32.const 1))))
    (if (i32.and (local.get $flags) (i32.const $P.leadOrd))
      (then (call $m.push (call $m.list) (i32.const 0) (i32.const 0))))
    (block $stop
     (block $infix
      ;; A list that a pass before found split by `\over` splits again at once,
      ;; so nested numerators are not searched once per enclosing split.
      (local.set $t (i32.const $mem.mathInfix))
      (block $search
        (loop $find
          (br_if $search (i32.ge_u (local.get $t) (global.get $mInfix)))
          (if (i32.and (i32.eq (i32.load (local.get $t)) (local.get $start))
                (i32.lt_u (i32.load offset=4 (local.get $t)) (global.get $me)))
            (then
              (global.set $mp (local.tee $save (i32.load offset=4 (local.get $t))))
              (local.set $v (call $m.readCmd))
              (br $infix)))
          (local.set $t (i32.add (local.get $t) (i32.const 8)))
          (br $find)))
      (loop $l
        (br_if $stop (global.get $mFail))
        (if (i32.and (local.get $flags) (i32.const $P.single))
          (then (br_if $stop (i32.gt_u (global.get $mA) (local.get $base)))))
        (local.set $c (call $m.peek))
        (br_if $stop (i32.ge_u (global.get $mp) (global.get $me)))
        (block $next
          (if (i32.or (call $isWhiteByte (local.get $c)) (i32.eq (local.get $c) (i32.const "%")))
            (then (call $m.skipSpace) (br $next)))
          (if (i32.eq (local.get $c) (i32.const "}"))
            (then
              (br_if $stop (i32.and (local.get $flags) (i32.const $P.brace)))
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "]"))
            (then (br_if $stop (i32.and (local.get $flags) (i32.const $P.bracket)))))
          (if (i32.eq (local.get $c) (i32.const "&"))
            (then
              (br_if $stop (i32.and (local.get $flags) (i32.const $P.cell)))
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "$"))
            (then
              (br_if $stop (i32.and (local.get $flags) (i32.const $P.dollar)))
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (br $next)))
          (if (i32.or (i32.eq (local.get $c) (i32.const "^")) (i32.eq (local.get $c) (i32.const "_")))
            (then
              (call $m.script (i32.eq (local.get $c) (i32.const "^")) (local.get $base))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "'"))
            (then
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (call $m.push (call $m.glyph (i32.const 0x2032) (i32.const 0))
                (i32.const 0) (i32.const 0))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "{"))
            (then
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (local.set $old (global.get $mStyle))
              (local.set $n (call $m.parseList (i32.const $P.brace)))
              (call $m.setStyle (local.get $old))
              (if (i32.eq (call $m.peek) (i32.const "}"))
                (then (global.set $mp (i32.add (global.get $mp) (i32.const 1)))))
              (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "~"))
            (then
              (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
              (call $m.push (call $m.kern (call $m.sc (i32.const 333))) (i32.const 8) (i32.const 0))
              (br $next)))
          (if (i32.eq (local.get $c) (i32.const "\5c"))
            (then
              (local.set $save (global.get $mp))
              (local.set $v (call $m.readCmd))
              (if (i32.lt_s (local.get $v) (i32.const 0))
                (then
                  (if (i32.eqz (global.get $cmdLen)) (then (br $next)))
                  ;; `\ ` is a space; an unknown command shows its name in red
                  (if (i32.and (i32.eq (global.get $cmdLen) (i32.const 1))
                        (call $isWhiteByte (i32.load8_u (global.get $cmdP))))
                    (then
                      (call $m.push (call $m.kern (call $m.sc (i32.const 333))) (i32.const 8) (i32.const 0))
                      (br $next)))
                  (local.set $n (call $m.wrap (call $m.textNode (i32.sub (global.get $cmdP) (i32.const 1))
                    (i32.add (global.get $cmdLen) (i32.const 1)) (i32.const 0))))
                  (i32.store offset=$N.e (call $m.nAt (local.get $n)) (i32.const -1))
                  (call $m.push (local.get $n) (i32.const 0) (i32.const 0))
                  (br $next)))
              (local.set $k (i32.shr_u (local.get $v) (i32.const 24)))
              ;; `\over` and the other infix fractions split the group
              (if (i32.and (i32.eq (local.get $k) (i32.const $K.frac)) (i32.ne (i32.and (local.get $v) (i32.const 0x40)) (i32.const 0)))
                (then
                  (if (i32.lt_u (global.get $mInfix) (i32.const $mem.mathInfixEnd))
                    (then
                      (i32.store (global.get $mInfix) (local.get $start))
                      (i32.store offset=4 (global.get $mInfix) (local.get $save))
                      (global.set $mInfix (i32.add (global.get $mInfix) (i32.const 8)))))
                  (br $infix)))
              (if (i32.and (i32.ne (i32.and (local.get $flags) (i32.const $P.cell)) (i32.const 0))
                    (i32.or (i32.eq (local.get $k) (i32.const $K.cr)) (i32.eq (local.get $k) (i32.const $K.end))))
                (then
                  (global.set $mp (local.get $save))
                  (br $stop)))
              (if (i32.and (i32.ne (i32.and (local.get $flags) (i32.const $P.right)) (i32.const 0))
                    (i32.and (i32.eq (local.get $k) (i32.const $K.left)) (i32.ne (i32.and (local.get $v) (i32.const 0xff)) (i32.const 0))))
                (then
                  (global.set $mp (local.get $save))
                  (br $stop)))
              (call $m.command (local.get $v) (local.get $base) (local.get $flags))
              (br $next)))
          ;; a character; $utf8At reads NUL as U+FFFD
          (if (i32.ge_u (i32.sub (local.get $c) (i32.const 1)) (i32.const 0x7f))
            (then
              (local.set $c (call $m.readCp))
              ;; Unicode symbols take the class their command has
              (local.set $v (call $m.lookupCp (local.get $c)))
              (if (i32.ge_s (local.get $v) (i32.const 0))
                (then
                  (call $m.command (local.get $v) (local.get $base) (local.get $flags))
                  (br $next)))
              (call $m.push (call $m.symbol (local.get $c) (i32.const 0)) (i32.const 0) (i32.const 0))
              (br $next)))
          (global.set $mp (i32.add (global.get $mp) (i32.const 1)))
          (if (call $isAlnum (local.get $c))
            (then
              (call $m.push (call $m.letter (local.get $c)) (i32.const 0) (i32.const 0))
              (br $next)))
          (local.set $k (select (i32.load8_u offset=$mem.mathAscii (i32.sub (local.get $c) (i32.const 32))) (i32.const 0)
            (i32.ge_u (local.get $c) (i32.const 32))))
          ;; a hyphen is a minus sign, an asterisk a centered one
          (if (i32.eq (local.get $c) (i32.const "-")) (then (local.set $c (i32.const 0x2212))))
          (if (i32.eq (local.get $c) (i32.const "*")) (then (local.set $c (i32.const 0x2217))))
          (call $m.push (call $m.symbol (local.get $c) (local.get $k)) (local.get $k) (i32.const 0)))
        (br $l)))
     ;; The atoms before the split were laid out in the wrong style, so they
     ;; are parsed again as the numerator. Each pass takes new nodes, so the
     ;; node limit bounds the work of numerators the pairs do not cover.
     (local.set $t (i32.const -1))
     (if (i32.and (local.get $v) (i32.const 0x20)) (then (local.set $t (call $m.dimen (i32.const 0)))))
     (local.set $end (global.get $me))
     (local.set $k (global.get $mp))
     (global.set $mA (local.get $base))
     (global.set $me (local.get $save))
     (global.set $mp (local.get $start))
     (global.set $mVariant (local.get $variant))
     (call $m.setStyle (call $m.fracStyle (local.get $style)))
     (local.set $n (call $m.parseList (i32.and (local.get $flags) (i32.const 0x7f))))
     (global.set $me (local.get $end))
     (global.set $mp (local.get $k))
     (call $m.setStyle (i32.or (call $m.fracStyle (local.get $style)) (i32.const 4)))
     (local.set $k (call $m.parseList (i32.and (local.get $flags) (i32.const 0x7f))))
     (call $m.setStyle (local.get $style))
     (global.set $mA (local.get $base))
     (call $m.push (call $m.frac (i32.and (local.get $v) (i32.const 0x1f)) (local.get $n) (local.get $k) (local.get $t))
       (i32.const 0) (i32.const 0)))
    (global.set $mDepth (i32.sub (global.get $mDepth) (i32.const 1)))
    ;; \bf and the other font switches end with the group
    (global.set $mVariant (local.get $variant))
    (if (i32.and (local.get $flags) (i32.const $P.inline)) (then (return (i32.const 0))))
    (call $m.finish (local.get $base)))

  ;; ---- SVG output

  ;; $v thousandths as a decimal number
  (func $m.outMilli (param $v i32)
    (local $o i32)
    (local $f i32)
    (call $ensureOut (i32.const 16))
    (local.set $o (call $m.signAt (global.get $out) (local.get $v)))
    (local.set $v (call $m.abs (local.get $v)))
    (local.set $o (call $numAt (local.get $o) (i32.div_u (local.get $v) (i32.const 1000))))
    (local.set $f (i32.rem_u (local.get $v) (i32.const 1000)))
    (if (local.get $f)
      (then
        ;; ".ddd" without its trailing zeros
        (i32.store8 offset=3 (local.get $o) (i32.add (i32.const "0") (i32.rem_u (local.get $f) (i32.const 10))))
        (i32.store8 offset=2 (local.get $o)
          (i32.add (i32.const "0") (i32.rem_u (i32.div_u (local.get $f) (i32.const 10)) (i32.const 10))))
        (i32.store8 offset=1 (local.get $o) (i32.add (i32.const "0") (i32.div_u (local.get $f) (i32.const 100))))
        (i32.store8 (local.get $o) (i32.const "."))
        (local.set $o (i32.add (local.get $o) (i32.const 4)))
        (loop $trim
          (if (i32.eq (i32.load8_u (i32.sub (local.get $o) (i32.const 1))) (i32.const "0"))
            (then
              (local.set $o (i32.sub (local.get $o) (i32.const 1)))
              (br $trim))))))
    (global.set $out (local.get $o)))

  ;; write "-" at $o when $v is negative; return the position after it
  (func $m.signAt (param $o i32) (param $v i32) (result i32)
    (i32.store8 (local.get $o) (i32.const "-"))
    (i32.add (local.get $o) (i32.shr_u (local.get $v) (i32.const 31))))

  (func $m.abs (param $v i32) (result i32)
    (select (i32.sub (i32.const 0) (local.get $v)) (local.get $v) (i32.lt_s (local.get $v) (i32.const 0))))

  ;; $v as a signed decimal at $o, which has room for eleven bytes; return the end
  (func $m.intAt (param $o i32) (param $v i32) (result i32)
    (call $numAt (call $m.signAt (local.get $o) (local.get $v)) (call $m.abs (local.get $v))))

  (func $m.outInt (param $v i32)
    (call $ensureOut (i32.const 11))
    (global.set $out (call $m.intAt (global.get $out) (local.get $v))))

  ;; a path command letter and a point
  (func $m.pt (param $cmd i32) (param $x i32) (param $y i32)
    (local $o i32)
    (call $ensureOut (i32.const 24))
    (i32.store8 (global.get $out) (local.get $cmd))
    (local.set $o (call $m.intAt (i32.add (global.get $out) (i32.const 1)) (local.get $x)))
    (i32.store8 (local.get $o) (i32.const " "))
    (global.set $out (call $m.intAt (i32.add (local.get $o) (i32.const 1)) (local.get $y))))

  ;; code point $cp as escaped UTF-8 text
  (func $m.outCp (param $cp i32)
    (if (i32.eq (local.get $cp) (i32.const "<")) (then (out.str "&lt;") (return)))
    (if (i32.eq (local.get $cp) (i32.const ">")) (then (out.str "&gt;") (return)))
    (if (i32.eq (local.get $cp) (i32.const "&")) (then (out.str "&amp;") (return)))
    (call $ensureOut (i32.const 4))
    (global.set $out (i32.add (global.get $out) (call $utf8Encode (global.get $out) (local.get $cp)))))

  ;; `<text x=".." y=".."` and a font size other than the formula's
  (func $m.textOpen (param $n i32) (param $x i32) (param $y i32)
    (local $s i32)
    (local $o i32)
    (call $ensureOut (i32.const 40))
    (local.set $o (global.get $out))
    (i64.store (local.get $o) (i64.const "<text x="))
    (i32.store8 offset=8 (local.get $o) (i32.const "\22"))
    (local.set $o (call $m.intAt (i32.add (local.get $o) (i32.const 9)) (local.get $x)))
    (i64.store (local.get $o) (i64.const "\22 y=\22"))
    (local.set $o (call $m.intAt (i32.add (local.get $o) (i32.const 5)) (local.get $y)))
    (i32.store8 (local.get $o) (i32.const "\22"))
    (global.set $out (i32.add (local.get $o) (i32.const 1)))
    (local.set $s (i32.load16_u offset=$N.scale (call $m.nAt (local.get $n))))
    (if (i32.ne (local.get $s) (i32.const 1000))
      (then
        (out.str " font-size=\22")
        (call $outNum (local.get $s))
        (out.str "\22"))))

  (func $m.strokeOpen (param $width i32)
    (out.str "<path fill=\22none\22 stroke=\22currentColor\22 stroke-width=\22")
    (call $m.outInt (local.get $width))
    (out.str "\22 d=\22"))

  ;; Draw path node $n with its origin at ($x, $y).
  (func $m.emitPath (param $n i32) (param $x i32) (param $y i32)
    (local $e2 i32)
    (local $p i32)
    (local $shape i32)
    (local $m i32)
    (local $w i32)
    (local $top i32)
    (local $bot i32)
    (local $mid i32)
    (local $size i32)
    (local $t i32)
    (local $ax i32)
    (local $cx i32)
    (local $k i32)
    (local $r i32)
    (local $e i32)
    (local $s i32)
    (local $i i32)
    (local $hy i32)
    (local.set $p (call $m.nAt (local.get $n)))
    (local.set $shape (i32.and (i32.load offset=$N.a (local.get $p)) (i32.const 0xff)))
    (local.set $m (i32.and (i32.load offset=$N.a (local.get $p)) (i32.const 0x100)))
    (local.set $w (i32.load offset=$N.w (local.get $p)))
    (local.set $e (i32.load offset=$N.e (local.get $p)))
    (local.set $s (i32.load16_u offset=$N.scale (local.get $p)))
    (local.set $top (i32.sub (local.get $y) (i32.load offset=$N.h (local.get $p))))
    (local.set $bot (i32.add (local.get $y) (i32.load offset=$N.d (local.get $p))))
    (local.set $mid (i32.shr_s (i32.add (local.get $top) (local.get $bot)) (i32.const 1)))
    (local.set $size (i32.sub (local.get $bot) (local.get $top)))
    (local.set $t (call $m.min (i32.add (i32.div_s (i32.mul (i32.const 45) (local.get $s)) (i32.const 1000))
      (i32.div_s (local.get $size) (i32.const 90))) (i32.const 90)))
    ;; mirror the left-hand shapes: draw in a flipped coordinate system
    (if (local.get $m)
      (then
        (out.str "<g transform=\22matrix(-1 0 0 1 ")
        (call $m.outInt (i32.add (i32.shl (local.get $x) (i32.const 1)) (local.get $w)))
        (out.str " 0)\22>")))
    (block $drawn
      (block $s32 (block $s31 (block $s30 (block $s28 (block $s27
      (block $s24 (block $s23 (block $s11 (block $s10 (block $s9 (block $s6
      (block $s5 (block $s4 (block $s3 (block $s2 (block $s1
        (br_table $drawn $s1 $s2 $s3 $s4 $s5 $s6 $s2 $s2 $s9 $s10 $s11 $drawn $drawn $drawn $drawn
          $drawn $drawn $drawn $drawn $drawn $drawn $drawn $s23 $s24 $s31 $drawn $s27 $s28 $drawn $s30 $s31 $s32
          $s27 $s28 $s27 $s28 $drawn
          (local.get $shape)))
        ;; parenthesis: two curves, thick in the middle
        (local.set $ax (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.div_s (local.get $w) (i32.const 6))))
        (local.set $cx (i32.add (local.get $x) (i32.div_s (local.get $w) (i32.const 5))))
        (local.set $k (call $m.min (i32.div_s (local.get $size) (i32.const 4)) (i32.mul (local.get $w) (i32.const 2))))
        ;; a cubic with equal controls reaches 3/4 of the way to them
        (local.set $cx (i32.sub (local.get $ax) (i32.div_s (i32.mul (i32.sub (local.get $ax) (local.get $cx)) (i32.const 4)) (i32.const 3))))
        (out.str "<path d=\22")
        (call $m.pt (i32.const "M") (local.get $ax) (local.get $top))
        (call $m.pt (i32.const "C") (local.get $cx) (i32.add (local.get $top) (local.get $k)))
        (call $m.pt (i32.const " ") (local.get $cx) (i32.sub (local.get $bot) (local.get $k)))
        (call $m.pt (i32.const " ") (local.get $ax) (local.get $bot))
        (call $m.pt (i32.const "L") (i32.add (local.get $ax) (i32.shr_s (local.get $t) (i32.const 2))) (local.get $bot))
        (local.set $cx (i32.add (local.get $cx) (i32.div_s (i32.mul (local.get $t) (i32.const 4)) (i32.const 3))))
        (call $m.pt (i32.const "C") (local.get $cx) (i32.sub (local.get $bot) (local.get $k)))
        (call $m.pt (i32.const " ") (local.get $cx) (i32.add (local.get $top) (local.get $k)))
        (call $m.pt (i32.const " ") (i32.add (local.get $ax) (i32.shr_s (local.get $t) (i32.const 2))) (local.get $top))
        (out.str "Z\22/>")
        (br $drawn))
        ;; bracket; a floor has no top arm and a ceiling no bottom arm
        (local.set $ax (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.div_s (local.get $w) (i32.const 8))))
        (local.set $cx (i32.add (local.get $x) (i32.div_s (local.get $w) (i32.const 3))))
        (local.set $k (call $m.max (i32.div_s (local.get $t) (i32.const 2)) (i32.const 36)))
        (local.set $r (i32.ne (local.get $shape) (i32.const 7)))
        (local.set $e2 (i32.ne (local.get $shape) (i32.const 8)))
        (out.str "<path d=\22")
        (call $m.pt (i32.const "M") (select (local.get $ax) (local.get $cx) (local.get $r)) (local.get $top))
        (if (local.get $r) (then (call $m.pt (i32.const "L") (local.get $cx) (local.get $top))))
        (call $m.pt (i32.const "L") (local.get $cx) (local.get $bot))
        (if (local.get $e2)
          (then
            (call $m.pt (i32.const "L") (local.get $ax) (local.get $bot))
            (call $m.pt (i32.const "L") (local.get $ax) (i32.sub (local.get $bot) (local.get $k)))))
        (call $m.pt (i32.const "L") (i32.add (local.get $cx) (local.get $t))
          (select (i32.sub (local.get $bot) (local.get $k)) (local.get $bot) (local.get $e2)))
        (call $m.pt (i32.const "L") (i32.add (local.get $cx) (local.get $t))
          (select (i32.add (local.get $top) (local.get $k)) (local.get $top) (local.get $r)))
        (if (local.get $r) (then (call $m.pt (i32.const "L") (local.get $ax) (i32.add (local.get $top) (local.get $k)))))
        (out.str "Z\22/>")
        (br $drawn))
        ;; brace
        (local.set $ax (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.div_s (local.get $w) (i32.const 8))))
        (local.set $cx (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))))
        (local.set $r (call $m.min (i32.sub (local.get $ax) (local.get $cx)) (i32.div_s (local.get $size) (i32.const 6))))
        (local.set $k (i32.add (local.get $x) (i32.div_s (local.get $w) (i32.const 8))))
        (call $m.strokeOpen (i32.shr_s (i32.mul (local.get $t) (i32.const 3)) (i32.const 2)))
        (call $m.pt (i32.const "M") (local.get $ax) (local.get $top))
        (call $m.pt (i32.const "Q") (local.get $cx) (local.get $top))
        (call $m.pt (i32.const " ") (local.get $cx) (i32.add (local.get $top) (local.get $r)))
        (call $m.pt (i32.const "L") (local.get $cx) (i32.sub (local.get $mid) (local.get $r)))
        (call $m.pt (i32.const "Q") (local.get $cx) (local.get $mid))
        (call $m.pt (i32.const " ") (local.get $k) (local.get $mid))
        (call $m.pt (i32.const "Q") (local.get $cx) (local.get $mid))
        (call $m.pt (i32.const " ") (local.get $cx) (i32.add (local.get $mid) (local.get $r)))
        (call $m.pt (i32.const "L") (local.get $cx) (i32.sub (local.get $bot) (local.get $r)))
        (call $m.pt (i32.const "Q") (local.get $cx) (local.get $bot))
        (call $m.pt (i32.const " ") (local.get $ax) (local.get $bot))
        (out.str "\22/>")
        (br $drawn))
        ;; vertical bar
        (call $m.rect (i32.sub (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (i32.const 25))
          (local.get $top) (i32.const 50) (local.get $size))
        (br $drawn))
        ;; double bar
        (call $m.rect (i32.sub (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (i32.const 115))
          (local.get $top) (i32.const 50) (local.get $size))
        (call $m.rect (i32.add (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (i32.const 65))
          (local.get $top) (i32.const 50) (local.get $size))
        (br $drawn))
        ;; angle bracket
        (call $m.strokeOpen (local.get $t))
        (call $m.pt (i32.const "M") (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.div_s (local.get $w) (i32.const 5))) (local.get $top))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (i32.div_s (local.get $w) (i32.const 5))) (local.get $mid))
        (call $m.pt (i32.const "L") (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.div_s (local.get $w) (i32.const 5))) (local.get $bot))
        (out.str "\22/>")
        (br $drawn))
        ;; slash
        (call $m.strokeOpen (i32.shr_s (local.get $t) (i32.const 1)))
        (call $m.pt (i32.const "M") (i32.add (local.get $x) (local.get $w)) (local.get $top))
        (call $m.pt (i32.const "L") (local.get $x) (local.get $bot))
        (out.str "\22/>")
        (br $drawn))
        ;; backslash
        (call $m.strokeOpen (i32.shr_s (local.get $t) (i32.const 1)))
        (call $m.pt (i32.const "M") (local.get $x) (local.get $top))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (local.get $bot))
        (out.str "\22/>")
        (br $drawn))
        ;; radical: a short tick, a heavy down stroke, a long up stroke, then the bar
        (local.set $k (call $m.min (local.get $size) (i32.div_s (i32.mul (i32.const 1000) (local.get $s)) (i32.const 1000))))
        (local.set $t (call $m.max (i32.div_s (i32.mul (i32.const $MC.rule) (local.get $s)) (i32.const 1000)) (i32.const 20)))
        (call $m.strokeOpen (local.get $t))
        (call $m.pt (i32.const "M") (i32.add (local.get $x) (i32.div_s (local.get $e) (i32.const 12)))
          (i32.sub (local.get $bot) (i32.div_s (i32.mul (local.get $k) (i32.const 9)) (i32.const 20))))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (i32.div_s (local.get $e) (i32.const 5)))
          (i32.sub (local.get $bot) (i32.div_s (i32.mul (local.get $k) (i32.const 11)) (i32.const 20))))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (i32.div_s (i32.mul (local.get $e) (i32.const 9)) (i32.const 20))) (local.get $bot))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $e)) (i32.add (local.get $top) (i32.shr_s (local.get $t) (i32.const 1))))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $top) (i32.shr_s (local.get $t) (i32.const 1))))
        (out.str "\22/>")
        (call $m.strokeOpen (i32.mul (local.get $t) (i32.const 2)))
        (call $m.pt (i32.const "M") (i32.add (local.get $x) (i32.div_s (local.get $e) (i32.const 5)))
          (i32.sub (local.get $bot) (i32.div_s (i32.mul (local.get $k) (i32.const 11)) (i32.const 20))))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (i32.div_s (i32.mul (local.get $e) (i32.const 9)) (i32.const 20))) (local.get $bot))
        (out.str "\22/>")
        (br $drawn))
        ;; widehat: from the bottom corners to a peak; widecheck is the reverse
        (call $m.strokeOpen (local.get $e))
        (call $m.pt (i32.const "M") (local.get $x) (local.get $y))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (local.get $top))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (local.get $y))
        (out.str "\22/>")
        (br $drawn))
        ;; widetilde
        (call $m.strokeOpen (local.get $e))
        (call $m.pt (i32.const "M") (local.get $x) (i32.sub (local.get $y) (i32.shr_s (local.get $size) (i32.const 3))))
        (call $m.pt (i32.const "C") (i32.add (local.get $x) (i32.div_s (local.get $w) (i32.const 3))) (local.get $top))
        (call $m.pt (i32.const " ") (i32.add (local.get $x) (i32.div_s (i32.mul (local.get $w) (i32.const 2)) (i32.const 3))) (local.get $y))
        (call $m.pt (i32.const " ") (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $top) (i32.shr_s (local.get $size) (i32.const 3))))
        (out.str "\22/>")
        (br $drawn))
        ;; overbrace, overbracket, overgroup
        (local.set $r (local.get $size))
        (local.set $k (local.get $y))
        (local.set $mid (local.get $top))
        (br $s28))
        ;; the shapes below the body: the same, upside down
        (if (i32.eqz (i32.and (local.get $shape) (i32.const 1)))
          (then
            (local.set $r (i32.sub (i32.const 0) (local.get $size)))
            (local.set $k (local.get $top))
            (local.set $mid (local.get $y))))
        (local.set $cx (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))))
        (local.set $ax (call $m.min (i32.div_s (local.get $w) (i32.const 8)) (local.get $size)))
        (local.set $e2 (i32.shr_s (i32.add (local.get $k) (local.get $mid)) (i32.const 1)))
        (call $m.strokeOpen (local.get $e))
        (call $m.pt (i32.const "M") (local.get $x) (local.get $k))
        ;; a bracket has square ends, a group round ones
        (if (i32.ge_u (local.get $shape) (i32.const 33))
          (then
            (if (i32.lt_u (local.get $shape) (i32.const 35))
              (then
                (call $m.pt (i32.const "L") (local.get $x) (local.get $mid))
                (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (local.get $mid)))
              (else
                (call $m.pt (i32.const "Q") (local.get $x) (local.get $mid))
                (call $m.pt (i32.const " ") (i32.add (local.get $x) (local.get $ax)) (local.get $mid))
                (call $m.pt (i32.const "L") (i32.sub (i32.add (local.get $x) (local.get $w)) (local.get $ax)) (local.get $mid))
                (call $m.pt (i32.const "Q") (i32.add (local.get $x) (local.get $w)) (local.get $mid))))
            (call $m.pt (select (i32.const " ") (i32.const "L") (i32.ge_u (local.get $shape) (i32.const 35)))
              (i32.add (local.get $x) (local.get $w)) (local.get $k))
            (out.str "\22/>")
            (br $drawn)))
        (call $m.pt (i32.const "Q") (local.get $x) (local.get $e2))
        (call $m.pt (i32.const " ") (i32.add (local.get $x) (local.get $ax)) (local.get $e2))
        (call $m.pt (i32.const "L") (i32.sub (local.get $cx) (local.get $ax)) (local.get $e2))
        (call $m.pt (i32.const "Q") (local.get $cx) (local.get $e2))
        (call $m.pt (i32.const " ") (local.get $cx) (local.get $mid))
        (call $m.pt (i32.const "Q") (local.get $cx) (local.get $e2))
        (call $m.pt (i32.const " ") (i32.add (local.get $cx) (local.get $ax)) (local.get $e2))
        (call $m.pt (i32.const "L") (i32.sub (i32.add (local.get $x) (local.get $w)) (local.get $ax)) (local.get $e2))
        (call $m.pt (i32.const "Q") (i32.add (local.get $x) (local.get $w)) (local.get $e2))
        (call $m.pt (i32.const " ") (i32.add (local.get $x) (local.get $w)) (local.get $k))
        (out.str "\22/>")
        (br $drawn))
        ;; widecheck
        (call $m.strokeOpen (local.get $e))
        (call $m.pt (i32.const "M") (local.get $x) (local.get $top))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (i32.shr_s (local.get $w) (i32.const 1))) (local.get $y))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (local.get $top))
        (out.str "\22/>")
        (br $drawn))
        ;; arrows: e = heads (1 right, 2 left) | 4 double | 8 bar at the left
        ;; end | 16 harpoon with the upper barb | 32 bar at the right end | 64
        ;; harpoon with the lower barb | 128 two arrows, the right one on top
        ;; (256: below), harpoons with the outer barb; the stroke width above
        ;; bit 10. The shaft of an extensible arrow (31) is at the axis.
        (local.set $t (i32.shr_u (local.get $e) (i32.const 10)))
        (local.set $mid (i32.add (local.get $top) (i32.shr_s (local.get $size) (i32.const 1))))
        (if (i32.eq (local.get $shape) (i32.const 31))
          (then (local.set $mid (i32.sub (local.get $y) (i32.div_s (i32.mul (i32.const $MC.axis) (local.get $s)) (i32.const 1000))))))
        (local.set $k (i32.div_s (i32.mul (i32.const 130) (local.get $s)) (i32.const 1000)))
        (local.set $r (select (i32.shr_s (local.get $k) (i32.const 1)) (i32.const 0) (i32.and (local.get $e) (i32.const 4))))
        (if (i32.and (local.get $e) (i32.const 128)) (then (local.set $r (local.get $k))))
        (call $m.strokeOpen (local.get $t))
        (call $m.pt (i32.const "M") (local.get $x) (i32.sub (local.get $mid) (local.get $r)))
        (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (i32.sub (local.get $mid) (local.get $r)))
        (if (local.get $r)
          (then
            (call $m.pt (i32.const "M") (local.get $x) (i32.add (local.get $mid) (local.get $r)))
            (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $mid) (local.get $r)))))
        ;; the right head, then the left one
        (loop $head
          (if (i32.and (i32.shr_u (local.get $e) (local.get $i)) (i32.const 1))
            (then
              (local.set $ax (select (local.get $x) (i32.add (local.get $x) (local.get $w)) (local.get $i)))
              (local.set $cx (select (i32.add (local.get $x) (local.get $k)) (i32.sub (i32.add (local.get $x) (local.get $w)) (local.get $k)) (local.get $i)))
              ;; $e2: the head's offset below the middle
              (local.set $e2 (i32.const 0))
              (if (i32.and (local.get $e) (i32.const 128))
                (then (local.set $e2 (select (local.get $r) (i32.sub (i32.const 0) (local.get $r))
                  (i32.xor (local.get $i) (i32.and (i32.shr_u (local.get $e) (i32.const 8)) (i32.const 1)))))))
              (local.set $hy (i32.add (local.get $mid) (local.get $e2)))
              (if (i32.or (i32.ne (i32.and (local.get $e) (i32.const 64)) (i32.const 0))
                    (i32.and (i32.ne (i32.and (local.get $e) (i32.const 16)) (i32.const 0)) (i32.gt_s (local.get $e2) (i32.const 0))))
                (then (call $m.pt (i32.const "M") (local.get $ax) (local.get $hy)))
                (else
                  (call $m.pt (i32.const "M") (local.get $cx) (i32.sub (local.get $hy) (local.get $k)))
                  (call $m.pt (i32.const "L") (local.get $ax) (local.get $hy))))
              (if (i32.eqz (i32.and (i32.ne (i32.and (local.get $e) (i32.const 16)) (i32.const 0)) (i32.le_s (local.get $e2) (i32.const 0))))
                (then (call $m.pt (i32.const "L") (local.get $cx) (i32.add (local.get $hy) (local.get $k)))))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $head (i32.lt_u (local.get $i) (i32.const 2))))
        ;; bars at the ends, as in \mapsto
        (if (i32.and (local.get $e) (i32.const 8))
          (then
            (call $m.pt (i32.const "M") (local.get $x) (i32.sub (local.get $mid) (local.get $k)))
            (call $m.pt (i32.const "L") (local.get $x) (i32.add (local.get $mid) (local.get $k)))))
        (if (i32.and (local.get $e) (i32.const 32))
          (then
            (call $m.pt (i32.const "M") (i32.add (local.get $x) (local.get $w)) (i32.sub (local.get $mid) (local.get $k)))
            (call $m.pt (i32.const "L") (i32.add (local.get $x) (local.get $w)) (i32.add (local.get $mid) (local.get $k)))))
        (out.str "\22/>")
        (br $drawn))
      ;; \boxed frame
      (call $m.strokeOpen (local.get $e))
      (call $m.pt (i32.const "M") (i32.add (local.get $x) (i32.shr_s (local.get $e) (i32.const 1))) (i32.add (local.get $top) (i32.shr_s (local.get $e) (i32.const 1))))
      (call $m.pt (i32.const "H") (i32.sub (i32.add (local.get $x) (local.get $w)) (i32.shr_s (local.get $e) (i32.const 1))) (i32.const 0))
      (global.set $out (i32.sub (global.get $out) (i32.const 2)))
      (call $m.pt (i32.const "V") (i32.sub (local.get $bot) (i32.shr_s (local.get $e) (i32.const 1))) (i32.const 0))
      (global.set $out (i32.sub (global.get $out) (i32.const 2)))
      (call $m.pt (i32.const "H") (i32.add (local.get $x) (i32.shr_s (local.get $e) (i32.const 1))) (i32.const 0))
      (global.set $out (i32.sub (global.get $out) (i32.const 2)))
      (out.str "Z\22/>"))
    (if (local.get $m) (then (out.str "</g>"))))

  (func $m.rect (param $x i32) (param $y i32) (param $w i32) (param $h i32)
    (out.str "<rect x=\22")
    (call $m.outInt (local.get $x))
    (out.str "\22 y=\22")
    (call $m.outInt (local.get $y))
    (out.str "\22 width=\22")
    (call $m.outInt (local.get $w))
    (out.str "\22 height=\22")
    (call $m.outInt (local.get $h))
    (out.str "\22/>"))

  ;; Write node $n with its origin at ($x, $y).
  (func $m.emit (param $n i32) (param $x i32) (param $y i32)
    (local $p i32)
    (local $c i32)
    (local $e i32)
    (local $cp i32)
    (local $f i32)
    (local $b i32)
    (local.set $p (call $m.nAt (local.get $n)))
    (block $done
      (block $text
        (block $path
          (block $rule
            (block $m.list
              (block $m.glyph
                (br_table $done $m.glyph $m.list $rule $path $text $done
                  (i32.load8_u (local.get $p))))
              (call $m.textOpen (local.get $n) (local.get $x) (local.get $y))
              (out.str ">")
              (call $m.outCp (i32.load offset=$N.a (local.get $p)))
              ;; a combining long solidus after \not
              (if (i32.and (i32.load offset=$N.e (local.get $p)) (i32.const 2))
                (then (call $m.outCp (i32.const 0x338))))
              (out.str "</text>")
              (br $done))
            (local.set $e (i32.load offset=$N.e (local.get $p)))
            (if (local.get $e)
              (then
                (out.str "<g color=\22")
                (call $m.outColor (local.get $e))
                (out.str "\22 fill=\22")
                (call $m.outColor (local.get $e))
                (out.str "\22>")))
            (local.set $c (i32.load offset=$N.a (local.get $p)))
            (block $end
              (loop $child
                (br_if $end (i32.eqz (local.get $c)))
                (local.set $p (call $m.nAt (local.get $c)))
                (call $m.emit (local.get $c)
                  (i32.add (local.get $x) (i32.load offset=$N.x (local.get $p)))
                  (i32.add (local.get $y) (i32.load offset=$N.y (local.get $p))))
                (local.set $c (i32.load offset=$N.next (local.get $p)))
                (br $child)))
            (if (local.get $e) (then (out.str "</g>")))
            (br $done))
          (call $m.rect (local.get $x) (i32.sub (local.get $y) (i32.load offset=$N.h (local.get $p)))
            (i32.load offset=$N.w (local.get $p))
            (i32.add (i32.load offset=$N.h (local.get $p)) (i32.load offset=$N.d (local.get $p))))
          (br $done))
        (call $m.emitPath (local.get $n) (local.get $x) (local.get $y))
        (br $done))
      (call $m.textOpen (local.get $n) (local.get $x) (local.get $y))
      (local.set $f (i32.shr_u (i32.load offset=$N.e (local.get $p)) (i32.const 24)))
      ;; monospace keeps the font's bold and italic; others print bold (and
      ;; bold italic) as $m.textCp does
      (if (i32.eq (i32.and (local.get $f) (i32.const 5)) (i32.const 5)) (then (out.str " font-weight=\22bold\22")))
      (if (i32.and (i32.ne (i32.and (local.get $f) (i32.const 2)) (i32.const 0)) (i32.ne (i32.and (local.get $f) (i32.const 5)) (i32.const 1)))
        (then (out.str " font-style=\22italic\22")))
      (if (i32.and (local.get $f) (i32.const 4)) (then (out.str " font-family=\22monospace\22")))
      (out.str " style=\22white-space:pre\22>")
      (local.set $c (i32.load offset=$N.a (local.get $p)))
      (local.set $e (i32.add (local.get $c) (i32.and (i32.load offset=$N.e (local.get $p)) (i32.const 0xffffff))))
      (local.set $b (i32.eq (i32.and (local.get $f) (i32.const 5)) (i32.const 1)))
      (block $end
        (loop $char
          (br_if $end (i32.ge_u (local.get $c) (local.get $e)))
          (local.set $cp (call $utf8At (local.get $c) (local.get $e)))
          (local.set $c (global.get $utf8Next))
          (if (local.get $b)
            (then
              (local.set $b (call $m.textCp (local.get $cp) (local.get $f)))
              ;; other characters in bold get a stroke
              (if (i32.and (i32.eq (local.get $b) (local.get $cp)) (i32.ne (local.get $cp) (i32.const 32)))
                (then
                  (out.str "<tspan stroke=\22currentColor\22 stroke-width=\2230\22>")
                  (call $m.outCp (local.get $cp))
                  (out.str "</tspan>"))
                (else (call $m.outCp (local.get $b))))
              (local.set $b (i32.const 1)))
            (else (call $m.outCp (local.get $cp))))
          (br $char)))
      (out.str "</text>")))

  ;; a color from the source, or red for unknown commands (gray while the block is open)
  (func $m.outColor (param $e i32)
    (if (i32.eq (local.get $e) (i32.const -1))
      (then
        (if (global.get $mOpen) (then (out.str "#888") (return)))
        (call $outRaw (i32.const $mem.mathStatic+4) (i32.const 4)) (return)))
    (call $outRaw (i32.add (i32.const $mem.mathSrc) (i32.and (local.get $e) (i32.const 0xffff)))
      (i32.shr_u (local.get $e) (i32.const 16))))

  ;; Render the $len bytes of TeX at $mem.mathSrc as SVG, in display style
  ;; when $display is set. The format flags add a data-markdown attribute.
  ;; Returns 0 when the formula is too complex, after writing nothing.
  (func $mathSvg (param $len i32) (param $display i32) (result i32)
    (local $root i32)
    (local $w i32)
    (local $h i32)
    (local $d i32)
    (global.set $mN (i32.const 0))
    ;; node 0 stands for "no box" (W, H, D read 0); an overflow writes it
    (memory.fill (i32.const $mem.mathNodes) (i32.const 0) (i32.const $N.size))
    (global.set $mA (i32.const $mem.mathAtoms))
    (global.set $mC (i32.const $mem.mathCells))
    (global.set $mFail (i32.const 0))
    (global.set $mDepth (i32.const 0))
    (global.set $mVariant (i32.const -1))
    (global.set $mNot (i32.const 0))
    (global.set $mp (i32.const $mem.mathSrc))
    (global.set $me (i32.add (i32.const $mem.mathSrc) (local.get $len)))
    ;; the decoders may read a few bytes past the end
    (i64.store (global.get $me) (i64.const 0))
    (call $m.setStyle (select (i32.const 0) (i32.const 1) (local.get $display)))
    (global.set $mTop (i32.add (global.get $me) (i32.const 8)))
    (global.set $mPin (i32.const 0))
    (global.set $mInfix (i32.const $mem.mathInfix))
    (local.set $root (call $m.grid (i32.const -1)))
    (if (global.get $mFail) (then (return (i32.const 0))))
    (local.set $w (call $m.max (call $m.W (local.get $root)) (i32.const 1)))
    (local.set $h (call $m.max (call $m.H (local.get $root)) (i32.const 0)))
    (local.set $d (call $m.max (call $m.D (local.get $root)) (i32.const 0)))
    (out.str "<svg xmlns=\22http://www.w3.org/2000/svg\22")
    (if (global.get $fmt)
      (then
        (if (local.get $display)
          (then (out.str " data-markdown=\22math-display\22"))
          (else (out.str " data-markdown=\22math\22")))))
    (out.str " width=\22")
    (call $m.outMilli (local.get $w))
    (out.str "em\22 height=\22")
    (call $m.outMilli (i32.add (local.get $h) (local.get $d)))
    (out.str "em\22 viewBox=\220 ")
    (call $m.outInt (i32.sub (i32.const 0) (local.get $h)))
    (call $outByte (i32.const " "))
    (call $m.outInt (local.get $w))
    (call $outByte (i32.const " "))
    (call $m.outInt (i32.add (local.get $h) (local.get $d)))
    (if (local.get $display)
      (then (out.str "\22 style=\22display:block;margin:1em auto;overflow:visible"))
      (else
        (out.str "\22 style=\22display:inline;vertical-align:")
        (call $m.outMilli (i32.sub (i32.const 0) (local.get $d)))
        (out.str "em;overflow:visible")))
    (out.str "\22 fill=\22currentColor\22 font-family=\22'STIX Two Math','Cambria Math','Latin Modern Math',math,serif\22 role=\22img\22 aria-label=\22")
    (call $outText (i32.const $mem.mathSrc) (global.get $me))
    ;; the root's own font size would change what its em width means
    (out.str "\22><g font-size=\221000\22>")
    (call $m.emit (local.get $root) (i32.const 0) (i32.const 0))
    (out.str "</g></svg>")
    (i32.const 1))

  ;; ---- entry points

  ;; Inline math with content [$b, $e) of the current leaf. Returns 0 for a
  ;; formula that does not fit, which the caller shows as a code span.
  (func $mathInline (param $b i32) (param $e i32) (param $display i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $e) (local.get $b)))
    (if (i32.ge_u (local.get $len) (i32.const 16000)) (then (return (i32.const 0))))
    (memory.copy (i32.const $mem.mathSrc) (call $contentAt (local.get $b)) (local.get $len))
    (global.set $mOpen (i32.const 0))
    (call $mathSvg (local.get $len) (local.get $display)))

  ;; Render a `$$` or `math` fence as display math. Returns 0 for other blocks
  ;; and for a formula that does not fit (it renders as code).
  ;; Warning: the code writers must keep their single caller to stay inlined.
  (func $mathBlock (param $r i32) (result i32)
    (local $p i32)
    (local $n i32)
    (local $i i32)
    (local $line i32)
    (local $len i32)
    (local $dst i32)
    (if (i32.eqz (i32.and (i32.load8_u offset=1 (local.get $r)) (i32.const $F.math)))
      (then
        (if (i32.eqz (i32.and (i32.load8_u offset=1 (local.get $r)) (i32.const $F.fenced))) (then (return (i32.const 0))))
        (local.set $p (i32.load offset=8 (local.get $r)))
        (local.set $n (i32.sub (i32.load offset=12 (local.get $r)) (local.get $p)))
        (if (i32.or (i32.lt_u (local.get $n) (i32.const 4))
              (i32.ne (i32.load (local.get $p)) (i32.const "math")))
          (then (return (i32.const 0))))
        (if (i32.and (i32.ne (local.get $n) (i32.const 4))
              (i32.eqz (call $isWhiteByte (i32.load8_u offset=4 (local.get $p)))))
          (then (return (i32.const 0))))))
    (local.set $dst (i32.const $mem.mathSrc))
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (block $copied
      (loop $l
        (br_if $copied (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $line (call $lineAt (local.get $r) (local.get $i)))
        (local.set $p (call $lineBeg (local.get $line)))
        (local.set $len (i32.sub (call $lineEndOf (local.get $line)) (local.get $p)))
        (if (i32.ge_u (i32.add (i32.sub (local.get $dst) (i32.const $mem.mathSrc)) (local.get $len)) (i32.const 16000))
          (then (return (i32.const 0))))
        (memory.copy (local.get $dst) (local.get $p) (local.get $len))
        (local.set $dst (i32.add (local.get $dst) (local.get $len)))
        (i32.store8 (local.get $dst) (i32.const 10))
        (local.set $dst (i32.add (local.get $dst) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (call $cr)
    (global.set $mOpen (i32.eq (local.get $r) (global.get $incompleteCodeRec)))
    (if (i32.eqz (call $mathSvg (i32.sub (local.get $dst) (i32.const $mem.mathSrc)) (i32.const 1)))
      (then (return (i32.const 0))))
    (call $outByte (i32.const 10))
    (i32.const 1))
)
