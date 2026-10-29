(module
  (import "./memory.wat")

  (global $src (mut i32) (i32.const $mem.input)) ;; start of the markdown, past any frontmatter
  (global $eof (mut i32) (i32.const 0)) ;; end of the input text (the NUL sentinel sits there)

  ;; Code point ranges >= U+0080 in the Unicode P and S general categories.
  (unicode-punct-table $mem.punct $mem.punctEnd)

  ;; Return the lowest set-bit index, or -1 for zero. Callers either guard a
  ;; nonzero mask or select a separate zero-mask result. This clz identity stays
  ;; inline on runtimes that lower Wasm ctz to an external helper call.
  (func $firstBit (param $bits i32) (result i32)
    (i32.sub (i32.const 31) (i32.clz
      (i32.and (local.get $bits) (i32.sub (i32.const 0) (local.get $bits))))))

  ;; Load and splat once for code scans; immediate vectors may be rebuilt in
  ;; every iteration by the Wasm backend.
  (data (i32.const $mem.crByte) "\0d")

  ;; CR and LF fit in one byte-indexed swizzle table. Full-byte indices make
  ;; every other control byte and all bytes >=16 produce zero, including UTF-8.
  ;; Matching bytes carry only their high nibble, ready for hit-only packing.
  (data (i32.const $mem.lineEnds)
    "\00\00\00\00\00\00\00\00\00\00\f0\00\00\f0\00\00")

  (data (i32.const $mem.lanePack)
    "\0e\0c\0a\08\06\04\02\00\0e\0c\0a\08\06\04\02\00")

  ;; Find the first true byte of a comparison vector, or 16 when none match.
  ;; Pack four bits per lane with the first byte in the highest nibble, so clz
  ;; directly gives its position. Callers load the packing table once to avoid
  ;; rebuilding shuffle constants inside their scan loops.
  (func $firstLane (param $flags v128) (param $pack v128) (result i32)
    (i32.wrap_i64 (i64.shr_u (i64.clz (i64x2.extract_lane 0
      (i8x16.swizzle (v128.or
        (i16x8.shl (local.get $flags) (i32.const 4))
        (i16x8.shr_u (local.get $flags) (i32.const 12))) (local.get $pack))))
      (i64.const 2))))

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

  ;; Classify syntax and literal HTML-escaping bytes together so inline analysis
  ;; can prove whether its unmarked gaps need escaping. Reuse candidates after
  ;; each mark; the caller discards matches beyond its content end.
  (data (i32.const $mem.markLo)
    "\51\02\02\00\00\00\02\00\00\00\07\08\0c\08\26\08")
  (data (i32.const $mem.markHi)
    "\01\00\02\04\40\08\10\20\00\00\00\00\00\00\00\00")
  (data (i32.const $mem.syntaxLo)
    "\50\02\00\00\00\00\02\00\00\00\07\08\0c\08\22\08")

  ;; Return raw per-byte class bits. The caller loads both tables once and only
  ;; builds a dense lane mask when at least one byte has a nonzero class.
  (func $markFlags (param $p i32) (param $lo v128) (param $hi v128) (result v128)
    (local $w v128)
    (local.set $w (v128.load (local.get $p)))
    (v128.and
      (i8x16.swizzle (local.get $lo) (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
      (i8x16.swizzle (local.get $hi) (i8x16.shr_u (local.get $w) (i32.const 4)))))

  ;; Add CR to the syntax/escaping table, which already recognizes LF.
  (data (i32.const $mem.paragraphLo)
    "\51\02\02\00\00\00\02\00\00\00\07\08\0c\09\26\08")
  (global $plainRunJoined (mut i32) (i32.const 0))

  ;; Scan ordinary root-paragraph lines with one table load and cached masks
  ;; across line feeds. Consume each mask with a fixed vector base, advancing
  ;; only between masks. Stop before a possible block start, or after the first
  ;; line needing general inline processing. Return the final physical line's
  ;; begin/end so its predecessors can share one descriptor without losing the
  ;; line needed for table conversion. The caller has checked the first byte.
  (func $findPlainParagraphRun (param $start i32) (result i64)
    (local $beg i32)
    (local $p i32)
    (local $base i32)
    (local $mask i32)
    (local $next i32)
    (local $lines i32)
    (local $c i32)
    (local $flags v128)
    (local $lo v128)
    (local $hi v128)
    (local.set $beg (local.get $start))
    (local.set $base (local.get $start))
    (local.set $lo (v128.load (i32.const $mem.paragraphLo)))
    (local.set $hi (v128.load (i32.const $mem.markHi)))
    (block $done
      (loop $vectors
        (block $haveMask
          (loop $scan
            (if (i32.ge_u (local.get $base) (global.get $eof))
              (then (local.set $p (global.get $eof)) (br $done)))
            (local.set $flags (call $markFlags
              (local.get $base) (local.get $lo) (local.get $hi)))
            (if (i64.ne (i64.or
                  (i64x2.extract_lane 0 (local.get $flags))
                  (i64x2.extract_lane 1 (local.get $flags))) (i64.const 0))
              (then
                (local.set $mask (i8x16.bitmask
                  (i8x16.ne (local.get $flags) (i8x16.splat (i32.const 0)))))
                (br $haveMask)))
            (local.set $base (i32.add (local.get $base) (i32.const 16)))
            (br $scan)))
        (loop $candidate
          (block $nextCandidate
            (local.set $p (i32.add (local.get $base) (call $firstBit (local.get $mask))))
            (if (i32.ge_u (local.get $p) (global.get $eof))
              (then (local.set $p (global.get $eof)) (br $done)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if (i32.eq (local.get $c) (i32.const 10))
              (then
                ;; Interior trailing whitespace may create a hard break. EOF
                ;; whitespace is instead removed when the leaf is finalized.
                (if (call $isSpaceByte (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
                  (then (global.set $plainRunLiteral (i32.const 0)) (br $done)))
                (local.set $next (i32.add (local.get $p) (i32.const 1)))
                (br_if $done (i32.ge_u (local.get $next) (global.get $eof)))
                (br_if $done (call $mayStartBlock (i32.load8_u (local.get $next))))
                (local.set $beg (local.get $next))
                (local.set $lines (i32.add (local.get $lines) (i32.const 1)))
                (br $nextCandidate)))
            (if (i32.eq (local.get $c) (i32.const 13))
              (then (global.set $plainRunLiteral (i32.const 0)) (br $done)))
            (if (i32.eq (local.get $c) (i32.const "."))
              (then
                (br_if $nextCandidate (i32.ne (i32.or
                  (i32.and (i32.load (i32.sub (local.get $p) (i32.const 3)))
                    (i32.const 0xffffff)) (i32.const 0x202020)) (i32.const "www")))))
            (global.set $plainRunLiteral (i32.const 0))
            (local.set $p (call $findLineEnd (local.get $p)))
            (br $done))
          (local.set $mask (i32.and (local.get $mask)
            (i32.sub (local.get $mask) (i32.const 1))))
          (br_if $candidate (local.get $mask)))
        (local.set $base (i32.add (local.get $base) (i32.const 16)))
        (br $vectors)))
    (global.set $plainRunJoined (i32.ge_u (local.get $lines) (i32.const 2)))
    (i64.or (i64.extend_i32_u (local.get $beg))
      (i64.shl (i64.extend_i32_u (local.get $p)) (i64.const 32))))

  ;; Skip text after escaping is already required. Return the classified
  ;; vector's base in the low word and its syntax mask in the high word so the
  ;; inline scanner can resume without loading and classifying that vector again.
  (func $scanInlineSyntax (param $p i32) (param $end i32) (result i64)
    (local $w v128)
    (local $mask i32)
    (local $lo v128)
    (local $hi v128)
    (local.set $lo (v128.load (i32.const $mem.syntaxLo)))
    (local.set $hi (v128.load (i32.const $mem.markHi)))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (i8x16.ne
          (v128.and
            (i8x16.swizzle (local.get $lo)
              (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
            (i8x16.swizzle (local.get $hi)
              (i8x16.shr_u (local.get $w) (i32.const 4))))
          (i8x16.splat (i32.const 0)))))
        (br_if $done (local.get $mask))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $scan)))
    (i64.or (i64.extend_i32_u (local.get $p))
      (i64.shl (i64.extend_i32_u (local.get $mask)) (i64.const 32))))

  ;; the next $c in [$p,$end), or $end - 16 bytes per step
  (func $findByte (param $p i32) (param $end i32) (param $c i32) (result i32)
    (local $lane i32)
    (local $w v128)
    (local $cv v128)
    (local $pack v128)
    (local.set $pack (v128.load (i32.const $mem.lanePack)))
    (local.set $cv (i8x16.splat (local.get $c)))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $lane (call $firstLane
          (i8x16.eq (local.get $w) (local.get $cv)) (local.get $pack)))
        (if (i32.lt_u (local.get $lane) (i32.const 16))
          (then
            (local.set $p (i32.add (local.get $p) (local.get $lane)))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (local.get $end)) (then (local.set $p (local.get $end))))
    (local.get $p))

  ;; Find the first CR/LF or EOF. Check one vector first so short lines avoid
  ;; the wider loop; longer spans share a presence reduction across two vectors.
  ;; Input has 32 bytes of slack for the final paired load.
  (func $findLineEnd (param $p i32) (result i32)
    (local $end i32)
    (local $matches v128)
    (local $more v128)
    (local $combined v128)
    (local $endChars v128)
    (local $pack v128)
    (local.set $endChars (v128.load (i32.const $mem.lineEnds)))
    (local.set $pack (v128.load (i32.const $mem.lanePack)))
    (local.set $end (global.get $eof))
    (block $done
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (block $found
        (local.set $matches (i8x16.swizzle (local.get $endChars) (v128.load (local.get $p))))
        (br_if $found (i64.ne (i64.or
          (i64x2.extract_lane 0 (local.get $matches))
          (i64x2.extract_lane 1 (local.get $matches))) (i64.const 0)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (loop $wide
          (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
          (local.set $matches (i8x16.swizzle (local.get $endChars) (v128.load (local.get $p))))
          (local.set $more (i8x16.swizzle (local.get $endChars) (v128.load offset=16 (local.get $p))))
          (local.set $combined (v128.or (local.get $matches) (local.get $more)))
          (if (i64.ne (i64.or
                (i64x2.extract_lane 0 (local.get $combined))
                (i64x2.extract_lane 1 (local.get $combined))) (i64.const 0))
            (then
              (if (i64.eqz (i64.or
                    (i64x2.extract_lane 0 (local.get $matches))
                    (i64x2.extract_lane 1 (local.get $matches))))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 16)))
                  (local.set $matches (local.get $more))))
              (br $found)))
          (local.set $p (i32.add (local.get $p) (i32.const 32)))
          (br $wide)))
      ;; High-nibble flags need only one shift to pack adjacent byte pairs.
      (local.set $p (i32.add (local.get $p)
        (i32.wrap_i64 (i64.shr_u (i64.clz (i64x2.extract_lane 0
          (i8x16.swizzle (v128.or (local.get $matches)
            (i16x8.shr_u (local.get $matches) (i32.const 12))) (local.get $pack))))
          (i64.const 2))))))
    (if (i32.gt_u (local.get $p) (local.get $end)) (then (local.set $p (local.get $end))))
    (local.get $p))

  ;; Find the next table separator or escape introducer without scanning
  ;; ordinary cell text byte by byte. These two bytes differ only by bit 5,
  ;; so folding that bit lets one comparison identify both. Clip to the row.
  (func $findCellBoundary (param $p i32) (param $end i32) (result i32)
    (local $lane i32)
    (local $w v128)
    (local $pack v128)
    (local.set $pack (v128.load (i32.const $mem.lanePack)))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $lane (call $firstLane (i8x16.eq
          (v128.or (local.get $w) (i8x16.splat (i32.const 32)))
          (i8x16.splat (i32.const "|"))) (local.get $pack)))
        (if (i32.lt_u (local.get $lane) (i32.const 16))
          (then
            (local.set $p (i32.add (local.get $p) (local.get $lane)))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (select (local.get $end) (local.get $p) (i32.gt_u (local.get $p) (local.get $end))))

  ;; Find a possible fence byte or CR in one pass. Separate searches could
  ;; repeatedly scan a long code block when only one of the bytes is present.
  ;; Ordinary code vectors need only a presence test, not lane packing.
  (func $findCodeRunEnd (param $p i32) (param $end i32) (param $fence i32) (result i32)
    (local $matches v128)
    (local $w v128)
    (local $fv v128)
    (local $crv v128)
    (local $pack v128)
    (local.set $pack (v128.load (i32.const $mem.lanePack)))
    (local.set $fv (i8x16.splat (local.get $fence)))
    (local.set $crv (i8x16.splat (i32.load8_u (i32.const $mem.crByte))))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $matches (v128.or
          (i8x16.eq (local.get $w) (local.get $fv))
          (i8x16.eq (local.get $w) (local.get $crv))))
        (if (i64.ne (i64.or
              (i64x2.extract_lane 0 (local.get $matches))
              (i64x2.extract_lane 1 (local.get $matches))) (i64.const 0))
          (then
            (local.set $p (i32.add (local.get $p)
              (call $firstLane (local.get $matches) (local.get $pack))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (select (local.get $end) (local.get $p) (i32.gt_u (local.get $p) (local.get $end))))

  ;; Find the start of the LF-separated line containing p without reading
  ;; before start. Used to stop a bulk code span before a possible fence.
  (func $lineStartBefore (param $p i32) (param $start i32) (result i32)
    (local $mask i32)
    (block $tail
      (loop $wide
        (br_if $tail (i32.lt_u (i32.sub (local.get $p) (local.get $start)) (i32.const 16)))
        (local.set $p (i32.sub (local.get $p) (i32.const 16)))
        (local.set $mask (i8x16.bitmask (i8x16.eq
          (v128.load (local.get $p)) (i8x16.splat (i32.const 10)))))
        (if (local.get $mask)
          (then (return (i32.add (local.get $p)
            (i32.sub (i32.const 32) (i32.clz (local.get $mask)))))))
        (br $wide)))
    (block $done
      (loop $byte
        (br_if $done (i32.le_u (local.get $p) (local.get $start)))
        (br_if $done (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 10)))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $byte)))
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
