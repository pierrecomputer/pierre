(module
  (import "./memory.wat")

  (global $src (mut i32) (i32.const $mem.input)) ;; start of the markdown, past any frontmatter
  (global $eof (mut i32) (i32.const 0)) ;; end of the input text (the NUL sentinel sits there)

  ;; Code point ranges >= U+0080 in the Unicode P and S general categories.
  (unicode-punct-table $mem.punct $mem.punctEnd)

  ;; space or tab
  (func $isSpaceByte (param $c i32) (result i32)
    (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9))))

  ;; CommonMark whitespace: space, tab, newline, line tabulation, form feed, carriage return
  (func $isWhiteByte (param $c i32) (result i32)
    (i32.or
      (i32.eq (local.get $c) (i32.const 32))
      (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))

  (func $isDigit (param $c i32) (result i32)
    (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))

  (func $isAlpha (param $c i32) (result i32)
    (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))

  (func $isAlnum (param $c i32) (result i32)
    (i32.or (call $isAlpha (local.get $c)) (call $isDigit (local.get $c))))

  ;; the 32 ASCII punctuation characters, i.e. every printable byte that is
  ;; neither alphanumeric nor a space
  (func $isAsciiPunct (param $c i32) (result i32)
    (if (i32.gt_u (i32.sub (local.get $c) (i32.const 33)) (i32.const 93))
      (then (return (i32.const 0))))
    (i32.eqz (call $isAlnum (local.get $c))))

  ;; a Unicode punctuation character (general category P or S), ASCII fast path
  ;; then a binary search over the generated range table
  (func $isPunctCp (param $cp i32) (result i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $at i32)
    (local $first i32)
    (local $range i32)
    (if (i32.lt_u (local.get $cp) (i32.const 128))
      (then (return (call $isAsciiPunct (local.get $cp)))))
    (local.set $hi (i32.load (i32.const $mem.punct)))
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $at (i32.add (i32.const $mem.punct+4) (i32.mul (local.get $mid) (i32.const 4))))
        (local.set $range (i32.load (local.get $at)))
        (local.set $first (i32.and (local.get $range) (i32.const 0x1fffff)))
        (if (i32.lt_u (local.get $cp) (local.get $first))
          (then (local.set $hi (local.get $mid)))
          (else
            (if (i32.le_u (i32.sub (local.get $cp) (local.get $first))
                  (i32.shr_u (local.get $range) (i32.const 21)))
              (then (return (i32.const 1))))
            (local.set $lo (i32.add (local.get $mid) (i32.const 1)))))
        (br $search)))
    (i32.const 0))

  ;; a Unicode whitespace character: the Zs category plus tab, LF, FF and CR
  (func $isWhiteCp (param $cp i32) (result i32)
    (if (i32.lt_u (local.get $cp) (i32.const 128))
      (then (return (call $isWhiteByte (local.get $cp)))))
    (i32.or
      (i32.or
        (i32.eq (local.get $cp) (i32.const 0xa0))
        (i32.eq (local.get $cp) (i32.const 0x1680)))
      (i32.or
        (i32.le_u (i32.sub (local.get $cp) (i32.const 0x2000)) (i32.const 10))
        (i32.or
          (i32.eq (local.get $cp) (i32.const 0x202f))
          (i32.or
            (i32.eq (local.get $cp) (i32.const 0x205f))
            (i32.eq (local.get $cp) (i32.const 0x3000)))))))

  ;; decode the UTF-8 sequence at $p, which must be inside [.., $end).
  ;; Malformed bytes decode to themselves, which only matters for the flanking
  ;; rules, where any such byte behaves like an ordinary character.
  (func $utf8At (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local $cp i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.lt_u (local.get $c) (i32.const 0x80)) (then (return (local.get $c))))
    (if (i32.lt_u (local.get $c) (i32.const 0xe0))
      (then
        (local.set $n (i32.const 1))
        (local.set $cp (i32.and (local.get $c) (i32.const 0x1f))))
      (else (if (i32.lt_u (local.get $c) (i32.const 0xf0))
        (then
          (local.set $n (i32.const 2))
          (local.set $cp (i32.and (local.get $c) (i32.const 0x0f))))
        (else
          (local.set $n (i32.const 3))
          (local.set $cp (i32.and (local.get $c) (i32.const 0x07)))))))
    (if (i32.ge_u (i32.add (local.get $p) (local.get $n)) (local.get $end))
      (then (return (local.get $c))))
    (loop $tail
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (local.set $c (i32.load8_u (local.get $p)))
      (if (i32.ne (i32.and (local.get $c) (i32.const 0xc0)) (i32.const 0x80))
        (then (return (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))))
      (local.set $cp (i32.or (i32.shl (local.get $cp) (i32.const 6))
        (i32.and (local.get $c) (i32.const 0x3f))))
      (local.set $n (i32.sub (local.get $n) (i32.const 1)))
      (br_if $tail (local.get $n)))
    (local.get $cp))

  ;; decode the UTF-8 sequence that ends at $p, i.e. the character before it
  (func $utf8Before (param $p i32) (param $start i32) (result i32)
    (local $q i32)
    (local $c i32)
    (if (i32.le_u (local.get $p) (local.get $start)) (then (return (i32.const 0))))
    (local.set $q (i32.sub (local.get $p) (i32.const 1)))
    (block $found
      (loop $back
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $found (i32.lt_u (local.get $c) (i32.const 0x80)))
        (br_if $found (i32.ne (i32.and (local.get $c) (i32.const 0xc0)) (i32.const 0x80)))
        (br_if $found (i32.le_u (local.get $q) (local.get $start)))
        (br_if $found (i32.ge_u (i32.sub (local.get $p) (local.get $q)) (i32.const 4)))
        (local.set $q (i32.sub (local.get $q) (i32.const 1)))
        (br $back)))
    (call $utf8At (local.get $q) (local.get $p)))

  ;; the next mark candidate in [$p,$end), or $end. Sixteen bytes per step,
  ;; classified by the two nibble tables. Wide loads may cross $end into the
  ;; buffer slack; matches at or past $end are discarded.
  (func $findMark (param $p i32) (param $end i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (local $lo v128)
    (local $hi v128)
    (local.set $lo (v128.const i8x16
      0x50 0x02 0 0 0 0 0x02 0 0 0 0x07 0x08 0x0c 0x08 0x22 0x08))
    (local.set $hi (v128.const i8x16
      0x01 0 0x02 0x04 0x40 0x08 0x10 0x20 0 0 0 0 0 0 0 0))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (i8x16.ne
          (v128.and
            (i8x16.swizzle (local.get $lo) (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
            (i8x16.swizzle (local.get $hi) (i8x16.shr_u (local.get $w) (i32.const 4))))
          (i8x16.splat (i32.const 0)))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (local.get $end)) (then (local.set $p (local.get $end))))
    (local.get $p))

  ;; the next $c in [$p,$end), or $end - 16 bytes per step
  (func $findByte (param $p i32) (param $end i32) (param $c i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (local $cv v128)
    (local.set $cv (i8x16.splat (local.get $c)))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (i8x16.eq (local.get $w) (local.get $cv))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (local.get $end)) (then (local.set $p (local.get $end))))
    (local.get $p))

  ;; the end of the line starting at $p: the position of the first CR or LF,
  ;; or $eof - 16 bytes per step
  (func $findLineEnd (param $p i32) (result i32)
    (local $mask i32)
    (local $end i32)
    (local $w v128)
    (local.set $end (global.get $eof))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 13))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (local.get $end)) (then (local.set $p (local.get $end))))
    (local.get $p))

  ;; skip spaces and tabs
  (func $skipSpace (param $p i32) (param $end i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (br_if $done (i32.eqz (call $isSpaceByte (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; skip CommonMark whitespace: space, tab, LF, VT, FF, CR
  (func $skipWs (param $p i32) (param $end i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (br_if $done (i32.eqz (call $isWhiteByte (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; trim spaces and tabs from the right of [$start,$p)
  (func $trimSpaceBack (param $p i32) (param $start i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.le_u (local.get $p) (local.get $start)))
        (br_if $done (i32.eqz (call $isSpaceByte (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

)
