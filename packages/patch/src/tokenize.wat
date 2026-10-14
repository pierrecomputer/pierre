(module
  (import "./mem.wat")

  ;; last decoded code point + its byte length (set by $decodeCp)
  (global $cp      (mut i32) (i32.const 0))
  (global $cpLen   (mut i32) (i32.const 0))
  ;; byte length of the last $trimKey key
  (global $keyLen  (mut i32) (i32.const 0))

  ;; intern table: 12-byte slots (ptr, len, id), open addressing;
  ;; hash is a bucket index; matches compare len+bytes
  (global $tabBase (mut i32) (i32.const 0))
  (global $tabMask (mut i32) (i32.const 0))
  (global $nextId  (mut i32) (i32.const 0))

  ;; UTF-8 at $p (< $end) -> $cp/$cpLen. Callers pass leads >= 0x80 only (ASCII is
  ;; inline at every site). Malformed/truncated: 1-byte token, id = 0x110000+byte
  ;; so it never collides with a real char.
  (func $decodeCp (param $p i32) (param $end i32)
    (local $b0 i32) (local $n i32) (local $w i32)
    (local.set $b0 (i32.load8_u (local.get $p)))
    (block $invalid
      ;; valid leads are exactly C2..F4 (C0/C1 are overlong, F5.. > U+10FFFF)
      (br_if $invalid (i32.gt_u (i32.sub (local.get $b0) (i32.const 0xC2)) (i32.const 0x32)))
      ;; length = count of leading 1-bits: C2..DF 2, E0..EF 3, F0..F4 4
      (local.set $n (i32.clz (i32.xor (i32.shl (local.get $b0) (i32.const 24)) (i32.const -1))))
      (br_if $invalid (i32.gt_u (i32.add (local.get $p) (local.get $n)) (local.get $end)))
      ;; i32 load may overread $end into the 16-byte pad
      (local.set $w (i32.load (local.get $p)))
      (global.set $cpLen (local.get $n))
      (local.set $b0 (i32.and (local.get $b0) (i32.shr_u (i32.const 0x7F) (local.get $n))))
      (loop $acc ;; validate + accumulate the n-1 continuation bytes
        (local.set $w (i32.shr_u (local.get $w) (i32.const 8)))
        (br_if $invalid (i32.ne (i32.and (local.get $w) (i32.const 0xC0)) (i32.const 0x80)))
        (local.set $b0 (i32.or
          (i32.shl (local.get $b0) (i32.const 6))
          (i32.and (local.get $w) (i32.const 0x3F))))
        (br_if $acc (i32.gt_u
          (local.tee $n (i32.sub (local.get $n) (i32.const 1)))
          (i32.const 1))))
      (global.set $cp (local.get $b0))
      (return))
    ;; $b0 may hold partial accumulator bits here; reload the lead byte
    (global.set $cp (i32.add (i32.const 0x110000) (i32.load8_u (local.get $p))))
    (global.set $cpLen (i32.const 1))
  )

  ;; UTF-16 units of UTF-8 [$p,$end): +1 per non-continuation, +1 more per 4-byte
  ;; lead (>=0xF0, astral -> surrogate pair). SIMD 16 bytes/step; load may overread
  ;; $end (old text runs into new, new into the pad); tail mask drops overread bytes
  ;; from both bitmask counts.
  (func $utf16Units (param $p i32) (param $end i32) (result i32)
    (local $n i32) (local $mask i32) (local $v v128)
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      ;; ((1 << rem) - 1) keeps the low rem bits; a full chunk keeps all 16
      (local.set $mask (i32.const 0xFFFF))
      (if (i32.lt_u (i32.sub (local.get $end) (local.get $p)) (i32.const 16))
        (then
          (local.set $mask (i32.sub
            (i32.shl (i32.const 1) (i32.sub (local.get $end) (local.get $p)))
            (i32.const 1)))))
      (local.set $v (v128.load (local.get $p)))
      (local.set $n (i32.add (local.get $n) (i32.add
        ;; non-continuation: (b & 0xC0) != 0x80
        (i32.popcnt (i32.and
          (i32.xor
            (i8x16.bitmask (i8x16.eq
              (v128.and (local.get $v) (i8x16.splat (i32.const 0xC0)))
              (i8x16.splat (i32.const 0x80))))
            (i32.const 0xFFFF))
          (local.get $mask)))
        (i32.popcnt (i32.and
          (i8x16.bitmask (i8x16.ge_u (local.get $v) (i8x16.splat (i32.const 0xF0))))
          (local.get $mask))))))
      (local.set $p (i32.add (local.get $p) (i32.const 16)))
      (br $l)))
    (local.get $n)
  )

  ;; jsdiff extendedWordChars: a-z A-Z 0-9 _ U+00AD U+00C0-D6 U+00D8-F6
  ;; U+00F8-2C6 U+02C8-2D7 U+02DE-2FF U+1E00-1EFF. ASCII (<0x80) is inline in
  ;; $tokenizeWords; here $c >= 0x80. Encoded as C0..2D7 minus {D7,F7,2C7};
  ;; D7 and F7 differ only in bit 5, so (c|0x20)==0xF7 tests both.
  (func $isWordCp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.eq (local.get $c) (i32.const 0xAD))
        (i32.and
          (i32.and
            (i32.le_u (i32.sub (local.get $c) (i32.const 0xC0)) (i32.const 0x217))
            (i32.ne (i32.or (local.get $c) (i32.const 0x20)) (i32.const 0xF7)))
          (i32.ne (local.get $c) (i32.const 0x2C7))))
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const 0x2DE)) (i32.const 0x21))
        (i32.le_u (i32.sub (local.get $c) (i32.const 0x1E00)) (i32.const 0xFF))))
  )

  ;; JS `\s` minus `\n` `\r` (`[^\S\n\r]`): TAB VT FF SP NBSP U+1680 U+2000-200A
  ;; U+2028 U+2029 U+202F U+205F U+3000 U+FEFF. ASCII (TAB VT FF SP) is inline in
  ;; $tokenizeWords; here $c >= 0x80.
  (func $isSpaceNotNl (param $c i32) (result i32)
    (local $d i32)
    ;; U+20xx via (c-0x2000) so constants stay small; wrap of c<0x2000 is far above every test
    (local.set $d (i32.sub (local.get $c) (i32.const 0x2000)))
    (i32.or
      (i32.or
        (i32.or
          (i32.eq (local.get $c) (i32.const 0xA0))
          (i32.eq (local.get $c) (i32.const 0x1680)))
        (i32.or
          (i32.le_u (local.get $d) (i32.const 0x0A))
          (i32.le_u (i32.sub (local.get $d) (i32.const 0x28)) (i32.const 1))))
      (i32.or
        (i32.or
          (i32.eq (local.get $d) (i32.const 0x2F))
          (i32.eq (local.get $d) (i32.const 0x5F)))
        (i32.or
          (i32.eq (local.get $c) (i32.const 0x3000))
          (i32.eq (local.get $c) (i32.const 0xFEFF)))))
  )

  ;; 1 if the code point at $p (< $end) is JS `trim()` whitespace: $isSpaceNotNl
  ;; plus \n \r. Sets $cpLen.
  (func $isTrimSpace (param $p i32) (param $end i32) (result i32)
    (local $c i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.lt_u (local.get $c) (i32.const 0x80))
      (then
        (global.set $cpLen (i32.const 1))
        ;; TAB LF VT FF CR, SP
        (return (i32.or
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))
          (i32.eq (local.get $c) (i32.const 0x20))))))
    (call $decodeCp (local.get $p) (local.get $end))
    (call $isSpaceNotNl (global.get $cp))
  )

  ;; one token per code point; ids are the code points themselves
  (func $tokenizeChars
    (param $src i32) (param $end i32) (param $offs i32) (param $ids i32) (result i32)
    (local $p i32) (local $n i32) (local $q i32) (local $e i32)
    (local $v v128) (local $w v128) (local $o v128)
    (local.set $p (local.get $src))
    (block $done (loop $l
      ;; ASCII SIMD: 16 cps/step (ids=bytes, consecutive offs) while a 16-byte load
      ;; stays in-range. Stores fit: offs/ids hold len+2/len+1 entries; $n <= 1 per byte.
      (block $scalar (loop $simd
        (br_if $scalar (i32.gt_u (i32.add (local.get $p) (i32.const 16)) (local.get $end)))
        (local.set $v (v128.load (local.get $p)))
        (br_if $scalar (i8x16.bitmask (local.get $v)))
        (local.set $q (i32.add (local.get $ids) (i32.shl (local.get $n) (i32.const 2))))
        (local.set $w (i16x8.extend_low_i8x16_u (local.get $v)))
        (v128.store (local.get $q) (i32x4.extend_low_i16x8_u (local.get $w)))
        (v128.store offset=16 (local.get $q) (i32x4.extend_high_i16x8_u (local.get $w)))
        (local.set $w (i16x8.extend_high_i8x16_u (local.get $v)))
        (v128.store offset=32 (local.get $q) (i32x4.extend_low_i16x8_u (local.get $w)))
        (v128.store offset=48 (local.get $q) (i32x4.extend_high_i16x8_u (local.get $w)))
        ;; loop, not unrolled stores: binaryen folds i32x4.splat(const) into an
        ;; 18-byte v128.const and rematerializes per use, so each vector const once
        (local.set $q (i32.add (local.get $offs) (i32.shl (local.get $n) (i32.const 2))))
        (local.set $e (i32.add (local.get $q) (i32.const 64)))
        (local.set $o (i32x4.add
          (i32x4.splat (i32.sub (local.get $p) (local.get $src)))
          (v128.const i32x4 0 1 2 3)))
        (loop $off
          (v128.store (local.get $q) (local.get $o))
          (local.set $o (i32x4.add (local.get $o) (i32x4.splat (i32.const 4))))
          (local.set $q (i32.add (local.get $q) (i32.const 16)))
          (br_if $off (i32.lt_u (local.get $q) (local.get $e))))
        (local.set $n (i32.add (local.get $n) (i32.const 16)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $simd)))
      ;; also the end sentinel: $p==$end stores end-src and exits; else the same
      ;; slot is rewritten by the next SIMD round, or is this token's offset
      (i32.store
        (i32.add (local.get $offs) (i32.shl (local.get $n) (i32.const 2)))
        (i32.sub (local.get $p) (local.get $src)))
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      ;; one scalar cp (non-ASCII or tail), then retry SIMD; $decodeCp needs lead >= 0x80
      (local.set $q (i32.load8_u (local.get $p)))
      (if (i32.lt_u (local.get $q) (i32.const 0x80))
        (then
          (global.set $cp (local.get $q))
          (global.set $cpLen (i32.const 1)))
        (else (call $decodeCp (local.get $p) (local.get $end))))
      (i32.store (i32.add (local.get $ids) (i32.shl (local.get $n) (i32.const 2))) (global.get $cp))
      (local.set $n (i32.add (local.get $n) (i32.const 1)))
      (local.set $p (i32.add (local.get $p) (global.get $cpLen)))
      (br $l)))
    (local.get $n)
  )

  ;; non-ASCII class: 1 word, 2 space, 0 else (disjoint, bits never combine)
  (func $clsCp (param $c i32) (result i32)
    (i32.or
      (call $isWordCp (local.get $c))
      (i32.shl (call $isSpaceNotNl (local.get $c)) (i32.const 1)))
  )

  ;; ASCII class table [73:187) (layout in mem.wat): page-1 byte 64+$c is the
  ;; class of ASCII $c, same encoding as $clsCp. 0..8 and 123..127 stay zero-init.
  (data (i32.const 73)
    "\02\00\02\02\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00"           ;; TAB VT FF
    "\02\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00"                                ;; SP
    "\01\01\01\01\01\01\01\01\01\01\00\00\00\00\00\00\00"                             ;; 0-9
    "\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01"  ;; A-Z
    "\00\00\00\00\01\00"                                                              ;; _
    "\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01\01") ;; a-z

  ;; jsdiff wordsWithSpaceDiff.tokenize: (\r?\n) | [word]+ | [^\S\n\r]+ | [^word]
  ;; first match wins; testing word before (\r?\n) is safe — alternatives are
  ;; disjoint on the first cp. ASCII class from table at 64; leads >= 0x80 pay
  ;; $decodeCp+$clsCp.
  (func $tokenizeWords (param $src i32) (param $end i32) (param $offs i32) (result i32)
    (local $p i32) (local $c i32) (local $b i32) (local $k i32) (local $o0 i32)
    (local.set $p (local.get $src))
    (local.set $o0 (local.get $offs))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (i32.store (local.get $offs) (i32.sub (local.get $p) (local.get $src)))
      (local.set $offs (i32.add (local.get $offs) (i32.const 4)))
      (local.set $c (i32.load8_u (local.get $p)))
      (if (i32.lt_u (local.get $c) (i32.const 0x80))
        (then
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (local.set $k (i32.load8_u offset=64 (local.get $c))))
        (else ;; $c keeps the lead byte: >= 0x80, so it never matches 0x0D below
          (call $decodeCp (local.get $p) (local.get $end))
          (local.set $p (i32.add (local.get $p) (global.get $cpLen)))
          (local.set $k (call $clsCp (global.get $cp)))))
      (if (local.get $k)
        (then ;; word or space run: extend while the class stays the same
          (block $rEnd (loop $r
            (br_if $rEnd (i32.ge_u (local.get $p) (local.get $end)))
            (local.set $b (i32.load8_u (local.get $p)))
            (if (i32.lt_u (local.get $b) (i32.const 0x80))
              (then
                (br_if $rEnd (i32.ne (i32.load8_u offset=64 (local.get $b)) (local.get $k)))
                (local.set $p (i32.add (local.get $p) (i32.const 1))))
              (else
                (call $decodeCp (local.get $p) (local.get $end))
                (br_if $rEnd (i32.ne (call $clsCp (global.get $cp)) (local.get $k)))
                (local.set $p (i32.add (local.get $p) (global.get $cpLen)))))
            (br $r))))
        ;; class 0: one cp; "\r\n" pairs. Peek may overread $end into the pad (or
        ;; next text); a match overshoots $p by 1 into the loop exit. Token bounds
        ;; come from the offset array either way.
        (else
          (local.set $p (i32.add
            (local.get $p)
            (i32.and
              (i32.eq (local.get $c) (i32.const 0x0D))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 0x0A)))))))
      (br $l)))
    (i32.store (local.get $offs) (i32.sub (local.get $end) (local.get $src)))
    (i32.shr_u (i32.sub (local.get $offs) (local.get $o0)) (i32.const 2))
  )

  ;; jsdiff lines: content + its \n/\r\n; split after every \n (a trailing piece
  ;; without \n is a token too)
  (func $tokenizeLines (param $src i32) (param $end i32) (param $offs i32) (result i32)
    (local $p i32) (local $q i32) (local $o0 i32)
    (local.set $p (local.get $src))
    (local.set $o0 (local.get $offs))
    (block $done (loop $l
      (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
      (i32.store (local.get $offs) (i32.sub (local.get $p) (local.get $src)))
      (local.set $offs (i32.add (local.get $offs) (i32.const 4)))
      (local.set $q (call $memchr (local.get $p) (local.get $end) (i32.const 0x0A)))
      (local.set $p (select
        (i32.add (local.get $q) (i32.const 1))
        (local.get $end)
        (local.get $q)))
      (br $l)))
    (i32.store (local.get $offs) (i32.sub (local.get $end) (local.get $src)))
    (i32.shr_u (i32.sub (local.get $offs) (local.get $o0)) (i32.const 2))
  )

  ;; allocate + clear the intern table for $total tokens (load factor <= 1/2)
  (func $internInit (param $total i32) (result i32)
    (local $cap i32) (local $bytes i32)
    ;; Warning: above 2^27 tokens cap*12 (and the probe's idx*12) wraps i32; that
    ;; table needs >= 6 GiB, so it is OOM anyway
    (if (i32.gt_u (local.get $total) (i32.const 0x08000000))
      (then
        (call $oom)
        (return (i32.const 0))))
    ;; smallest 2^n >= max(16, 2*total); $total=0 -> 1-slot (shift wraps to 0); never probed
    (local.set $cap (i32.shl (i32.const 1)
      (i32.sub (i32.const 32) (i32.clz (i32.or
        (i32.sub (i32.shl (local.get $total) (i32.const 1)) (i32.const 1))
        (i32.const 15))))))
    (local.set $bytes (i32.mul (local.get $cap) (i32.const 12)))
    (global.set $tabBase (call $alloc (local.get $bytes)))
    (if (i32.eqz (global.get $tabBase)) (then (return (i32.const 0))))
    (memory.fill (global.get $tabBase) (i32.const 0) (local.get $bytes))
    (global.set $tabMask (i32.sub (local.get $cap) (i32.const 1)))
    (global.set $nextId (i32.const 0))
    (i32.const 1)
  )

  ;; jsdiff ignoreWhitespace key: [$p,$end) without its leading and trailing JS
  ;; `trim()` whitespace. Returns the key start and sets $keyLen. A separate
  ;; function: inlined into $internAll's loop it slows the default path ~3%.
  (func $trimKey (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (loop $lead
      (if (i32.lt_u (local.get $p) (local.get $end))
        (then
          (if (call $isTrimSpace (local.get $p) (local.get $end))
            (then
              (local.set $p (i32.add (local.get $p) (global.get $cpLen)))
              (br $lead))))))
    (block $trail (loop $back
      (br_if $trail (i32.le_u (local.get $end) (local.get $p)))
      ;; step back over 10xxxxxx bytes to the last code point's lead (input is WTF-8)
      (local.set $q (local.get $end))
      (loop $cont
        (local.set $q (i32.sub (local.get $q) (i32.const 1)))
        (br_if $cont (i32.eq
          (i32.and (i32.load8_u (local.get $q)) (i32.const 0xC0))
          (i32.const 0x80))))
      (br_if $trail (i32.eqz (call $isTrimSpace (local.get $q) (local.get $end))))
      (local.set $end (local.get $q))
      (br $back)))
    (global.set $keyLen (i32.sub (local.get $end) (local.get $p)))
    ;; Warning: $hashToken and $memcmp need $len > 0 or one shared pointer, so
    ;; every all-space token keys at the old text base
    (select (local.get $p) (i32.const 65536) (global.get $keyLen))
  )

  ;; map every token in $offs to a dense integer id (equal bytes = equal id).
  ;; $trim (jsdiff ignoreWhitespace): the key is the token without its leading
  ;; and trailing JS `trim()` whitespace.
  (func $internAll (param $src i32) (param $offs i32) (param $count i32) (param $ids i32) (param $trim i32)
    (local $ptr i32) (local $len i32)
    (local $idx i32) (local $slot i32) (local $next i32)
    (local $base i32) (local $mask i32)
    (local.set $base (global.get $tabBase))
    (local.set $mask (global.get $tabMask))
    ;; offs[0] exists even when $count is 0 (the tokenizers store a sentinel)
    (local.set $ptr (i32.add (local.get $src) (i32.load (local.get $offs))))
    (block $done (loop $each
      (br_if $done (i32.eqz (local.get $count)))
      (local.set $count (i32.sub (local.get $count) (i32.const 1)))
      (local.set $next (i32.add (local.get $src) (i32.load offset=4 (local.get $offs))))
      (local.set $len (i32.sub (local.get $next) (local.get $ptr)))
      (if (local.get $trim)
        (then
          (local.set $ptr (call $trimKey (local.get $ptr) (local.get $next)))
          (local.set $len (global.get $keyLen))))
      (local.set $idx
        (i32.and (call $hashToken (local.get $ptr) (local.get $len)) (local.get $mask)))
      (block $stored (loop $probe
        (local.set $slot (i32.add (local.get $base) (i32.mul (local.get $idx) (i32.const 12))))
        (if (i32.eqz (i32.load (local.get $slot)))
          (then ;; empty slot: insert ($ptr is never 0, the text starts on page 2)
            (i32.store (local.get $slot) (local.get $ptr))
            (i32.store offset=4 (local.get $slot) (local.get $len))
            (i32.store offset=8 (local.get $slot) (global.get $nextId))
            (i32.store (local.get $ids) (global.get $nextId))
            (global.set $nextId (i32.add (global.get $nextId) (i32.const 1)))
            (br $stored)))
        (if (i32.eq (i32.load offset=4 (local.get $slot)) (local.get $len))
          (then
            (if (call $memcmp (i32.load (local.get $slot)) (local.get $ptr) (local.get $len))
              (then
                (i32.store (local.get $ids) (i32.load offset=8 (local.get $slot)))
                (br $stored)))))
        (local.set $idx (i32.and (i32.add (local.get $idx) (i32.const 1)) (local.get $mask)))
        (br $probe)))
      (local.set $ptr (local.get $next))
      (local.set $offs (i32.add (local.get $offs) (i32.const 4)))
      (local.set $ids (i32.add (local.get $ids) (i32.const 4)))
      (br $each)))
  )
)
