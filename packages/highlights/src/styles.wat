(module
  (import "./emit.wat")
  ;; Warning: styled records use end/kind/fg/bg words; hidden records only advance the source offset.
  (global $styledRecords (mut i32) (i32.const 0))
  (global $styledEnd (mut i32) (i32.const 0))
  (global $styledLast (mut i32) (i32.const 0))
  (global $styledFg (mut i32) (i32.const 0))
  (global $styledBg (mut i32) (i32.const 0))
  (global $styledFlags (mut i32) (i32.const 0))
  (func $emitHidden
    (param $rhs i32)
    (if
      (global.get $tokens)
      (then (global.set $styledRecords (i32.const 1)) (call $recTok (i32.const -2) (local.get $rhs)))))
  (func $emitStyled
    (param $fg i32)
    (param $bg i32)
    (param $flags i32)
    (param $lhs i32)
    (param $rhs i32)
    (local $kind i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs)) (then (return)))
    (if
      (i32.and
        (i32.eqz (local.get $flags))
        (i32.and
          (i32.eq (local.get $bg) (i32.const -1))
          (i32.lt_u (local.get $fg) (i32.const 0x1000000))))
      (then
        (call $emitTok
          (select
            (enum.get $Token.none)
            (local.get $fg)
            (i32.eq (local.get $fg) (enum.get $Token.foreground)))
          (local.get $lhs)
          (local.get $rhs))
        (return)))
    (if
      (global.get $tokens)
      (then
        (global.set $styledRecords (i32.const 1))
        (local.set $kind (i32.or (i32.const 0x80000000) (local.get $flags)))
        (if
          (i32.and
            (i32.ne (global.get $styledLast) (i32.const 0))
            (i32.eq (i32.add (global.get $styledLast) (i32.const 16)) (global.get $out)))
          (then
            (if
              (i32.and
                (i32.eq (i32.load offset=4 (global.get $styledLast)) (local.get $kind))
                (i32.and
                  (i32.eq (i32.load offset=8 (global.get $styledLast)) (local.get $fg))
                  (i32.eq (i32.load offset=12 (global.get $styledLast)) (local.get $bg))))
              (then
                (i32.store (global.get $styledLast) (i32.sub (local.get $rhs) (global.get $srcBase)))
                (return)))))
        (call $ensureCap (i32.const 16))
        (global.set $styledLast (global.get $out))
        (i32.store (global.get $out) (i32.sub (local.get $rhs) (global.get $srcBase)))
        (i32.store offset=4 (global.get $out) (local.get $kind))
        (i32.store offset=8 (global.get $out) (local.get $fg))
        (i32.store offset=12 (global.get $out) (local.get $bg))
        (global.set $out (i32.add (global.get $out) (i32.const 16)))
        (return)))
    (call $styledHtml
      (local.get $fg)
      (local.get $bg)
      (local.get $flags)
      (local.get $lhs)
      (local.get $rhs)))
  (func $styledRecord
    (param $end i32)
    (param $kind i32)
    (param $fg i32)
    (param $bg i32)
    (if (i32.le_u (local.get $end) (global.get $styledEnd)) (then (return)))
    (call $ensureCap (i32.const 16))
    (i32.store (global.get $out) (local.get $end))
    (i32.store offset=4 (global.get $out) (local.get $kind))
    (i32.store offset=8 (global.get $out) (local.get $fg))
    (i32.store offset=12 (global.get $out) (local.get $bg))
    (global.set $out (i32.add (global.get $out) (i32.const 16)))
    (global.set $styledEnd (local.get $end)))
  (func $recStyledLinesPost
    (local $rec i32)
    (local $oldEnd i32)
    (local $rhs i32)
    (local $kind i32)
    (local $fg i32)
    (local $bg i32)
    (local $p i32)
    (local $char i32)
    (local $next i32)
    (local $c i32)
    (local $cut i32)
    (local.set $rec (i32.load (i32.const 6)))
    (local.set $oldEnd (global.get $out))
    (global.set $out (i32.and (i32.add (local.get $oldEnd) (i32.const 15)) (i32.const -16)))
    (i32.store (i32.const 6) (global.get $out))
    (call $ensureCap (i32.const 16))
    (i32.store (global.get $out) (i32.const 0))
    (i32.store offset=4 (global.get $out) (i32.const -3))
    (global.set $out (i32.add (global.get $out) (i32.const 8)))
    (global.set $styledEnd (i32.const 0))
    (local.set $p (global.get $srcBase))
    (block $done
      (loop $records
        (br_if $done (i32.ge_u (local.get $rec) (local.get $oldEnd)))
        (local.set $rhs (i32.add (global.get $srcBase) (i32.load (local.get $rec))))
        (local.set $kind (i32.load offset=4 (local.get $rec)))
        (local.set $fg (i32.const 0))
        (local.set $bg (i32.const 0))
        (if
          (i32.eq (i32.and (local.get $kind) (i32.const 0xffffffc0)) (i32.const 0x80000000))
          (then
            (local.set $fg (i32.load offset=8 (local.get $rec)))
            (local.set $bg (i32.load offset=12 (local.get $rec)))
            (local.set $rec (i32.add (local.get $rec) (i32.const 8)))))
        (local.set $rec (i32.add (local.get $rec) (i32.const 8)))
        (block $converted
          (loop $bytes
            (br_if $converted (i32.ge_u (local.get $p) (local.get $rhs)))
            (local.set $next (call $recFindSpecial (local.get $p)))
            (if (i32.gt_u (local.get $next) (local.get $rhs)) (then (local.set $next (local.get $rhs))))
            (local.set $char (i32.add (local.get $char) (i32.sub (local.get $next) (local.get $p))))
            (local.set $p (local.get $next))
            (br_if $converted (i32.ge_u (local.get $p) (local.get $rhs)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if
              (i32.eq (local.get $c) (i32.const 10))
              (then
                (local.set $cut (local.get $char))
                (if
                  (i32.and
                    (i32.gt_u (local.get $p) (global.get $srcBase))
                    (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 13)))
                  (then (local.set $cut (i32.sub (local.get $cut) (i32.const 1)))))
                (if
                  (i32.lt_u (local.get $cut) (global.get $styledEnd))
                  (then
                    (i32.store (i32.sub (global.get $out) (i32.const 16)) (local.get $cut))
                    (global.set $styledEnd (local.get $cut))))
                (call $styledRecord (local.get $cut) (local.get $kind) (local.get $fg) (local.get $bg))
                (local.set $char (i32.add (local.get $char) (i32.const 1)))
                (call $styledRecord (local.get $char) (i32.const -1) (i32.const 0) (i32.const 0)))
              (else
                (local.set $char
                  (i32.add
                    (local.get $char)
                    (i32.add
                      (i32.ge_u (local.get $c) (i32.const 0xc0))
                      (i32.ge_u (local.get $c) (i32.const 0xf0)))))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $bytes)))
        (call $styledRecord (local.get $char) (local.get $kind) (local.get $fg) (local.get $bg))
        (br $records))))
  (data
    (i32.const $mem.styledHtml)
    "<span style=\22colorbackground-colorfont-stylefont-weighttext-decoration-bgitalicboldunderlineline-throughunderline line-throughcolor-mix(in srgb,  50%, transparent)inheritlight-dark(")
  (global $styleSep (mut i32) (i32.const 0))
  (func $styleCopy
    (param $p i32)
    (param $n i32)
    (call $ensureCap (i32.add (local.get $n) (i32.const 32)))
    (memory.copy (global.get $out) (local.get $p) (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n))))
  (func $styleEntry
    (param $i i32)
    (param $color i32)
    (result i32)
    (i32.add
      (global.get $htmlOpeners)
      (i32.add
        (i32.const 4)
        (i32.mul
          (i32.add (i32.const 90) (i32.add (i32.mul (local.get $i) (i32.const 90)) (local.get $color)))
          (i32.const 8)))))
  (func $styleHasColor
    (param $i i32)
    (param $color i32)
    (result i32)
    (if
      (i32.or (global.get $cssVariables) (i32.ge_u (local.get $color) (i32.const 0x1000000)))
      (then (return (i32.const 1))))
    (if
      (global.get $htmlOpeners)
      (then
        (return
          (i32.ne
            (i32.load offset=4
              (call $styleEntry (local.get $i) (i32.add (local.get $color) (i32.const 1))))
            (i32.const 0)))))
    (i32.ne
      (i32.load
        (if
          (result i32)
          (global.get $themeBlob)
          (then (call $multiRec (local.get $i) (local.get $color)))
          (else (call $themeRec (local.get $color)))))
      (i32.const 0)))
  (func $styleEmpty
    (param $empty i32)
    (if
      (local.get $empty)
      (then (call $emitLightDarkSide (i32.const 0) (i32.eq (local.get $empty) (i32.const 2))))
      (else (call $styleCopy (i32.const $mem.styledHtml+163) (i32.const 7)))))
  (func $styleColor
    (param $i i32)
    (param $color i32)
    (param $dim i32)
    (param $empty i32)
    (local $v i32)
    (local $p i32)
    (local $n i32)
    (local $j i32)
    (local $c i32)
    (local $rgb i32)
    (call $ensureCap (i32.const 128))
    (if
      (i32.ge_u (local.get $color) (i32.const 0x1000000))
      (then
        (local.set $v
          (i32.or
            (i32.const 0xff000000)
            (i32.or
              (i32.and (local.get $color) (i32.const 0xff00))
              (i32.or
                (i32.shl (i32.and (local.get $color) (i32.const 255)) (i32.const 16))
                (i32.and (i32.shr_u (local.get $color) (i32.const 16)) (i32.const 255)))))))
      (else
        (if
          (global.get $htmlOpeners)
          (then
            (local.set $p (call $styleEntry (local.get $i) (i32.add (local.get $color) (i32.const 1))))
            (local.set $n (i32.load offset=4 (local.get $p)))
            (if (i32.eqz (local.get $n)) (then (call $styleEmpty (local.get $empty)) (return)))
            (local.set $p (i32.add (global.get $htmlOpeners) (i32.load (local.get $p))))
            (if
              (i32.and
                (i32.eq (i32.load8_u (local.get $p)) (i32.const 35))
                (i32.or (i32.eq (local.get $n) (i32.const 7)) (i32.eq (local.get $n) (i32.const 9))))
              (then
                (local.set $j (i32.const 1))
                (loop $hex
                  (local.set $c (i32.load8_u (i32.add (local.get $p) (local.get $j))))
                  (local.set $c
                    (select
                      (i32.sub (local.get $c) (i32.const 48))
                      (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const 87))
                      (i32.le_u (local.get $c) (i32.const 57))))
                  (local.set $rgb (i32.or (i32.shl (local.get $rgb) (i32.const 4)) (local.get $c)))
                  (local.set $j (i32.add (local.get $j) (i32.const 1)))
                  (br_if $hex (i32.lt_u (local.get $j) (local.get $n))))
                (if
                  (i32.eq (local.get $n) (i32.const 7))
                  (then
                    (local.set $rgb (i32.or (i32.shl (local.get $rgb) (i32.const 8)) (i32.const 255)))))
                (local.set $v
                  (i32.or
                    (i32.or
                      (i32.shr_u (local.get $rgb) (i32.const 24))
                      (i32.shl
                        (i32.and (i32.shr_u (local.get $rgb) (i32.const 16)) (i32.const 255))
                        (i32.const 8)))
                    (i32.or
                      (i32.shl
                        (i32.and (i32.shr_u (local.get $rgb) (i32.const 8)) (i32.const 255))
                        (i32.const 16))
                      (i32.shl (local.get $rgb) (i32.const 24))))))
              (else
                (if
                  (local.get $dim)
                  (then (call $styleCopy (i32.const $mem.styledHtml+126) (i32.const 19))))
                (call $styleCopy (local.get $p) (local.get $n))
                (if
                  (local.get $dim)
                  (then (call $styleCopy (i32.const $mem.styledHtml+145) (i32.const 18))))
                (return))))
          (else
            (if
              (global.get $cssVariables)
              (then
                (call $ensureCap (i32.add (i32.load (i32.const 18)) (i32.const 128)))
                (if
                  (local.get $dim)
                  (then (call $styleCopy (i32.const $mem.styledHtml+126) (i32.const 19))))
                (call $emitCssVariable (local.get $color) (i32.load (i32.const 18)))
                (if
                  (local.get $dim)
                  (then (call $styleCopy (i32.const $mem.styledHtml+145) (i32.const 18))))
                (return)))
            (local.set $v
              (i32.load
                (if
                  (result i32)
                  (global.get $themeBlob)
                  (then (call $multiRec (local.get $i) (local.get $color)))
                  (else (call $themeRec (local.get $color))))))))))
    (if (i32.eqz (local.get $v)) (then (call $styleEmpty (local.get $empty)) (return)))
    (if
      (local.get $dim)
      (then
        (local.set $v
          (i32.or
            (i32.and (local.get $v) (i32.const 0xffffff))
            (i32.shl
              (i32.shr_u (i32.add (i32.shr_u (local.get $v) (i32.const 24)) (i32.const 1)) (i32.const 1))
              (i32.const 24))))))
    (call $emitRgba (local.get $v)))
  (func $styleProperty
    (param $i i32)
    (param $property i32)
    (local $slot i32)
    (local $variable i32)
    (call $ensureCap (i32.const 64))
    (if
      (global.get $styleSep)
      (then
        (i32.store8 (global.get $out) (i32.const 59))
        (global.set $out (i32.add (global.get $out) (i32.const 1)))))
    (global.set $styleSep (i32.const 1))
    (if
      (global.get $htmlOpeners)
      (then
        (local.set $slot (call $styleEntry (local.get $i) (i32.const 0)))
        (local.set $variable (i32.load offset=4 (local.get $slot)))
        (if
          (local.get $variable)
          (then
            (call $styleCopy
              (i32.add (global.get $htmlOpeners) (i32.load (local.get $slot)))
              (local.get $variable)))))
      (else
        (if
          (global.get $themeBlob)
          (then
            (local.set $variable (i32.eqz (i32.load offset=8 (call $multiSlot (local.get $i)))))
            (if
              (i32.load8_u offset=1 (global.get $multiBlob))
              (then (local.set $variable (i32.const 0))))
            (if
              (local.get $variable)
              (then
                (call $ensureCap
                  (i32.add (i32.load offset=4 (call $multiSlot (local.get $i))) (i32.const 64)))
                (call $multiName (local.get $i))))))))
    (local.set $variable (i32.ne (local.get $variable) (i32.const 0)))
    (if
      (i32.and (local.get $variable) (i32.eq (local.get $property) (i32.const 1)))
      (then (call $styleCopy (i32.const $mem.styledHtml+70) (i32.const 3)))
      (else
        (if
          (i32.or (i32.eqz (local.get $variable)) (i32.ge_u (local.get $property) (i32.const 2)))
          (then
            (if
              (local.get $variable)
              (then
                (i32.store8 (global.get $out) (i32.const 45))
                (global.set $out (i32.add (global.get $out) (i32.const 1)))))
            (if
              (i32.eq (local.get $property) (i32.const 0))
              (then (call $styleCopy (i32.const $mem.styledHtml+13) (i32.const 5)))
              (else
                (if
                  (i32.eq (local.get $property) (i32.const 1))
                  (then (call $styleCopy (i32.const $mem.styledHtml+18) (i32.const 16)))
                  (else
                    (if
                      (i32.eq (local.get $property) (i32.const 2))
                      (then (call $styleCopy (i32.const $mem.styledHtml+34) (i32.const 10)))
                      (else
                        (if
                          (i32.eq (local.get $property) (i32.const 3))
                          (then (call $styleCopy (i32.const $mem.styledHtml+44) (i32.const 11)))
                          (else (call $styleCopy (i32.const $mem.styledHtml+55) (i32.const 15))))))))))))))
    (i32.store8 (global.get $out) (i32.const 58))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))
  (func $stylePair
    (param $i i32)
    (param $color i32)
    (param $dim i32)
    (param $pair i32)
    (param $bg i32)
    (if (local.get $pair) (then (call $styleCopy (i32.const $mem.styledHtml+170) (i32.const 11))))
    (call $styleColor
      (local.get $i)
      (local.get $color)
      (local.get $dim)
      (select (i32.add (local.get $bg) (i32.const 1)) (i32.const 0) (local.get $pair)))
    (if
      (local.get $pair)
      (then
        (i32.store8 (global.get $out) (i32.const 44))
        (global.set $out (i32.add (global.get $out) (i32.const 1)))
        (i32.store8 (global.get $out) (i32.const 32))
        (global.set $out (i32.add (global.get $out) (i32.const 1)))
        (call $styleColor
          (i32.const 1)
          (local.get $color)
          (local.get $dim)
          (select (i32.add (local.get $bg) (i32.const 1)) (i32.const 0) (local.get $pair)))
        (i32.store8 (global.get $out) (i32.const 41))
        (global.set $out (i32.add (global.get $out) (i32.const 1))))))
  (func $styledHtml
    (param $fg i32)
    (param $bg i32)
    (param $flags i32)
    (param $lhs i32)
    (param $rhs i32)
    (local $i i32)
    (local $count i32)
    (local $pair i32)
    (local $tmp i32)
    (local $len i32)
    (if
      (i32.and
        (i32.eq (global.get $spanHl) (i32.const -2))
        (i32.and
          (i32.eq (global.get $styledFg) (local.get $fg))
          (i32.and
            (i32.eq (global.get $styledBg) (local.get $bg))
            (i32.eq (global.get $styledFlags) (local.get $flags)))))
      (then
        (call $ensureCap (i32.const 20608))
        (call $escCopy (local.get $lhs) (local.get $rhs))
        (return)))
    (call $closeSpan)
    (global.set $styledFg (local.get $fg))
    (global.set $styledBg (local.get $bg))
    (global.set $styledFlags (local.get $flags))
    (if
      (i32.and (local.get $flags) (i32.const 16))
      (then
        (local.set $tmp (local.get $fg))
        (local.set $fg
          (select (enum.get $Token.background) (local.get $bg) (i32.lt_s (local.get $bg) (i32.const 0))))
        (local.set $bg (local.get $tmp))))
    (local.set $count (i32.const 1))
    (if
      (global.get $htmlOpeners)
      (then
        (local.set $count (i32.load offset=716 (global.get $htmlOpeners)))
        (local.set $pair (i32.load offset=720 (global.get $htmlOpeners))))
      (else
        (if
          (global.get $themeBlob)
          (then
            (local.set $count (global.get $multiSlots))
            (local.set $pair (i32.load8_u offset=1 (global.get $multiBlob)))))))
    (if (local.get $pair) (then (local.set $count (i32.const 1))))
    (call $styleCopy (i32.const $mem.styledHtml+0) (i32.const 13))
    (global.set $styleSep (i32.const 0))
    (loop $slots
      (call $styleProperty (local.get $i) (i32.const 0))
      (call $stylePair
        (local.get $i)
        (local.get $fg)
        (i32.and (local.get $flags) (i32.const 2))
        (local.get $pair)
        (i32.const 0))
      (if
        (i32.and
          (i32.ge_s (local.get $bg) (i32.const 0))
          (i32.or
            (call $styleHasColor (local.get $i) (local.get $bg))
            (if
              (result i32)
              (local.get $pair)
              (then (call $styleHasColor (i32.const 1) (local.get $bg)))
              (else (i32.const 0)))))
        (then
          (call $styleProperty (local.get $i) (i32.const 1))
          (call $stylePair (local.get $i) (local.get $bg) (i32.const 0) (local.get $pair) (i32.const 1))))
      (if
        (i32.and (local.get $flags) (i32.const 4))
        (then
          (call $styleProperty (local.get $i) (i32.const 2))
          (call $styleCopy (i32.const $mem.styledHtml+73) (i32.const 6))))
      (if
        (i32.and (local.get $flags) (i32.const 1))
        (then
          (call $styleProperty (local.get $i) (i32.const 3))
          (call $styleCopy (i32.const $mem.styledHtml+79) (i32.const 4))))
      (if
        (i32.and (local.get $flags) (i32.const 40))
        (then
          (call $styleProperty (local.get $i) (i32.const 4))
          (if
            (i32.eq (i32.and (local.get $flags) (i32.const 40)) (i32.const 40))
            (then (call $styleCopy (i32.const $mem.styledHtml+104) (i32.const 22)))
            (else
              (if
                (i32.and (local.get $flags) (i32.const 8))
                (then (call $styleCopy (i32.const $mem.styledHtml+83) (i32.const 9)))
                (else (call $styleCopy (i32.const $mem.styledHtml+92) (i32.const 12))))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $slots (i32.lt_u (local.get $i) (local.get $count))))
    (i32.store8 (global.get $out) (i32.const 34))
    (global.set $out (i32.add (global.get $out) (i32.const 1)))
    (i32.store8 (global.get $out) (i32.const 62))
    (global.set $out (i32.add (global.get $out) (i32.const 1)))
    (global.set $spanHl (i32.const -2))
    (global.set $spanVal (i64.const -1))
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (call $ensureCap
      (i32.mul
        (select (local.get $len) (i32.const 4096) (i32.lt_u (local.get $len) (i32.const 4096)))
        (i32.const 5)))
    (call $escCopy (local.get $lhs) (local.get $rhs))))
