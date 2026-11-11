(module
  (import "./memory.wat")
  (import "./scan.wat")
  (import "./htmlscan.wat")

  ;; The last successful $entityMatch: its value code (see $entityEncode) and
  ;; its UTF-8 text in the conversion scratch.
  (global $entVal (mut i32) (i32.const 0))
  (global $entLen (mut i32) (i32.const 0))
  (global $entCp (mut i32) (i32.const 0))

  ;; encode $cp as UTF-8 at $p, replacing what HTML calls a disallowed code
  ;; point (NUL, a surrogate, or a value past U+10FFFF) with U+FFFD
  (func $utf8Encode (param $p i32) (param $cp i32) (result i32)
    (local $n i32)
    (local $i i32)
    (if (i32.or
          (i32.eqz (local.get $cp))
          (i32.or
            (i32.gt_u (local.get $cp) (i32.const 0x10ffff))
            (i32.le_u (i32.sub (local.get $cp) (i32.const 0xd800)) (i32.const 0x7ff))))
      (then (local.set $cp (i32.const 0xfffd))))
    (if (i32.lt_u (local.get $cp) (i32.const 0x80))
      (then
        (i32.store8 (local.get $p) (local.get $cp))
        (return (i32.const 1))))
    (local.set $n (select (i32.const 2)
      (select (i32.const 3) (i32.const 4) (i32.lt_u (local.get $cp) (i32.const 0x10000)))
      (i32.lt_u (local.get $cp) (i32.const 0x800))))
    ;; continuation bytes from the end, then the lead byte's length marker
    (local.set $i (local.get $n))
    (loop $tail
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (i32.store8 (i32.add (local.get $p) (local.get $i))
        (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3f))))
      (local.set $cp (i32.shr_u (local.get $cp) (i32.const 6)))
      (br_if $tail (i32.gt_u (local.get $i) (i32.const 1))))
    (i32.store8 (local.get $p) (i32.or (local.get $cp) (i32.shr_u (i32.const 0xf00) (local.get $n))))
    (local.get $n))

  ;; write the UTF-8 text of an entity value code at $p and return its length:
  ;; a code point in bits 0-21, plus the second code point of a pair from the
  ;; entity table when bits 24-30 hold the pair's 1-based index
  (func $entityEncode (param $p i32) (param $v i32) (result i32)
    (local $n i32)
    (local.set $n (call $utf8Encode (local.get $p) (i32.and (local.get $v) (i32.const 0xffffff))))
    (if (i32.shr_u (local.get $v) (i32.const 24))
      (then (local.set $n (i32.add (local.get $n)
        (call $utf8Encode (i32.add (local.get $p) (local.get $n))
          (i32.load16_u offset=2 (i32.sub (i32.const $mem.entitiesEnd)
            (i32.shr_u (local.get $v) (i32.const 22)))))))))
    (local.get $n))

  ;; match an entity or numeric character reference at $p (which points at `&`).
  ;; Returns the number of input bytes consumed, or 0. On success $entVal and
  ;; $entLen hold the UTF-8 replacement text.
  (func $entityMatch (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $d i32)
    (local $cp i32)
    (local $hex i32)
    (local $digits i32)
    (local $len i32)
    (local $n i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $s i32)
    (local $i i32)
    (local $m i32)
    (local $slot i32)
    (local $key i64)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u (local.get $q)) (i32.const "#"))
      (then
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        ;; at most six hexadecimal or seven decimal digits
        (local.set $hex (i32.eq (i32.or (i32.load8_u (local.get $q)) (i32.const 32)) (i32.const "x")))
        (local.set $q (i32.add (local.get $q) (local.get $hex)))
        (block $digitsDone
          (loop $digit
            (br_if $digitsDone (i32.ge_u (local.get $q) (local.get $end)))
            (local.set $c (i32.load8_u (local.get $q)))
            (local.set $d (i32.sub (local.get $c) (i32.const "0")))
            (if (i32.gt_u (local.get $d) (i32.const 9))
              (then
                (local.set $d (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const 87)))
                (br_if $digitsDone (i32.or (i32.eqz (local.get $hex))
                  (i32.gt_u (i32.sub (local.get $d) (i32.const 10)) (i32.const 5))))))
            (local.set $cp (i32.add (local.get $d)
              (i32.mul (local.get $cp) (select (i32.const 16) (i32.const 10) (local.get $hex)))))
            (local.set $digits (i32.add (local.get $digits) (i32.const 1)))
            (br_if $digitsDone (i32.gt_u (local.get $digits) (i32.sub (i32.const 7) (local.get $hex))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $digit)))
        (if (i32.eqz (local.get $digits)) (then (return (i32.const 0)))))
      (else
        ;; a named reference: letters and digits up to the semicolon
        (if (i32.gt_u (local.get $end) (i32.add (local.get $p) (i32.const 33)))
          (then (local.set $end (i32.add (local.get $p) (i32.const 33)))))
        (block $nameDone
          (loop $name
            (br_if $nameDone (i32.ge_u (local.get $q) (local.get $end)))
            (local.set $c (i32.load8_u (local.get $q)))
            (br_if $nameDone (i32.eqz (call $isAlnum (local.get $c))))
            (local.set $key (i64.or (i64.shl (local.get $key) (i64.const 8))
              (i64.extend_i32_u (local.get $c))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $name)))))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ";")) (then (return (i32.const 0))))
    ;; Named references: a 2-way cache of 128 sets keeps recent names of up
    ;; to 8 bytes (as a big-endian i64, then the value code or 0 for no match),
    ;; most recent way first. Otherwise binary search the 64-name blocks of the
    ;; generated table for the last one whose first name is <= the key, and
    ;; walk its front-coded names: $m counts the key bytes the current name
    ;; matches, a name sharing fewer than $m bytes with the previous one sorts
    ;; after the key, and one sharing more sorts before it. The value code is
    ;; the first code point, and the second one's index in bits 24-27.
    (if (i32.eqz (local.get $digits))
      (then
        (local.set $len (i32.sub (i32.sub (local.get $q) (local.get $p)) (i32.const 1)))
        (local.set $slot (i32.add (i32.const $mem.entityCache)
          (i32.shl (i32.wrap_i64 (i64.shr_u (i64.mul (local.get $key) (i64.const 0x9e3779b97f4a7c15))
            (i64.const 57))) (i32.const 5))))
        (block $cached
          (if (i32.le_u (local.get $len) (i32.const 8))
            (then
              (local.set $cp (i32.load offset=8 (local.get $slot)))
              (br_if $cached (i64.eq (i64.load (local.get $slot)) (local.get $key)))
              (local.set $cp (i32.load offset=24 (local.get $slot)))
              (br_if $cached (i64.eq (i64.load offset=16 (local.get $slot)) (local.get $key)))))
            (local.set $cp (block $named (result i32)
              (local.set $n (i32.load16_u (i32.const $mem.entities+2)))
              (local.set $hi (i32.shr_u (i32.add (local.get $n) (i32.const 63)) (i32.const 6)))
              (loop $search
                (if (i32.gt_u (i32.sub (local.get $hi) (local.get $lo)) (i32.const 1))
                  (then
                    (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
                    (local.set $s (i32.load16_u offset=$mem.entities+4 (i32.shl (local.get $mid) (i32.const 1))))
                    (local.set $m (i32.const 0))
                    ;; 0x2f past the key's end sorts above a name's end byte
                    ;; and below its letters and digits
                    (loop $cmp
                      (local.set $c (i32.load8_u offset=1 (i32.add (local.get $s) (local.get $m))))
                      (local.set $d (select (i32.load8_u offset=1 (i32.add (local.get $p) (local.get $m)))
                        (i32.const 0x2f) (i32.lt_u (local.get $m) (local.get $len))))
                      (local.set $m (i32.add (local.get $m) (i32.const 1)))
                      (br_if $cmp (i32.eq (local.get $c) (local.get $d))))
                    (if (i32.le_u (local.get $c) (local.get $d))
                      (then (local.set $lo (local.get $mid)))
                      (else (local.set $hi (local.get $mid))))
                    (br $search))))
              (local.set $s (i32.load16_u offset=$mem.entities+4 (i32.shl (local.get $lo) (i32.const 1))))
              (local.set $i (i32.sub (i32.shl (local.get $lo) (i32.const 6)) (i32.const 1)))
              (local.set $m (i32.const 0))
              (block $found
                (loop $entry
                  (local.set $d (i32.load8_u (local.get $s)))
                  (local.set $s (i32.add (local.get $s) (i32.const 1)))
                  (local.set $i (i32.add (local.get $i) (i32.const 1)))
                  (if (i32.lt_u (local.get $d) (local.get $m)) (then (br $named (i32.const 0))))
                  (if (i32.eq (local.get $d) (local.get $m))
                    (then
                      (loop $byte
                        (local.set $c (i32.load8_u (local.get $s)))
                        (if (i32.lt_u (local.get $c) (i32.const 0x30))
                          (then
                            (br_if $found (i32.eq (local.get $m) (local.get $len)))
                            (br $entry)))
                        (if (i32.eq (local.get $m) (local.get $len)) (then (br $named (i32.const 0))))
                        (local.set $d (i32.load8_u offset=1 (i32.add (local.get $p) (local.get $m))))
                        (if (i32.gt_u (local.get $c) (local.get $d)) (then (br $named (i32.const 0))))
                        (if (i32.eq (local.get $c) (local.get $d))
                          (then
                            (local.set $m (i32.add (local.get $m) (i32.const 1)))
                            (local.set $s (i32.add (local.get $s) (i32.const 1)))
                            (br $byte))))))
                  ;; skip the rest of a name that sorts before the key
                  (loop $skip
                    (local.set $s (i32.add (local.get $s) (i32.const 1)))
                    (br_if $skip (i32.ge_u (i32.load8_u (local.get $s)) (i32.const 0x30))))
                  (br $entry)))
              ;; Two value planes after the names give a u16. A surrogate is
              ;; an escape: a high one is a letter from U+1D400, a low one is
              ;; the 1-based index of a pair, counted down from the table end.
              (local.set $s (i32.add (i32.load16_u (i32.const $mem.entities)) (local.get $i)))
              (local.set $d (i32.or (i32.load8_u (local.get $s))
                (i32.shl (i32.load8_u (i32.add (local.get $s) (local.get $n))) (i32.const 8))))
              (local.set $c (i32.sub (local.get $d) (i32.const 0xd800)))
              (if (result i32) (i32.lt_u (local.get $c) (i32.const 0x400))
                (then (i32.add (local.get $c) (i32.const 0x1d400)))
                (else
                  (if (result i32) (i32.lt_u (local.tee $c (i32.sub (local.get $c) (i32.const 0x400))) (i32.const 0x400))
                    (then (i32.or
                      (i32.load16_u (i32.sub (i32.const $mem.entitiesEnd) (i32.shl (local.get $c) (i32.const 2))))
                      (i32.shl (local.get $c) (i32.const 24))))
                    (else (local.get $d)))))))
          (if (i32.le_u (local.get $len) (i32.const 8))
            (then
              (v128.store offset=16 (local.get $slot) (v128.load (local.get $slot)))
              (i64.store (local.get $slot) (local.get $key))
              (i32.store offset=8 (local.get $slot) (local.get $cp)))))
        (if (i32.eqz (local.get $cp)) (then (return (i32.const 0))))))
    (global.set $entCp (local.get $cp))
    (global.set $entVal (i32.const $mem.numbuf))
    (global.set $entLen (call $entityEncode (i32.const $mem.numbuf) (local.get $cp)))
    (i32.sub (i32.add (local.get $q) (i32.const 1)) (local.get $p)))
)
