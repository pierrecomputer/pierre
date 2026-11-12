(module
  (import "./memory.wat")
  (import "./scan.wat")
  (import "./htmlscan.wat")

  ;; The last successful $entityMatch: its value code (see $entityEncode) and
  ;; its UTF-8 text in the conversion scratch.
  (global $entVal (mut i32) (i32.const 0))
  (global $entLen (mut i32) (i32.const 0))
  (global $entCp (mut i32) (i32.const 0))

  ;; Resolve HTML escape spellings directly from their packed bytes. The low
  ;; word is the name plus semicolon's length, and the high word its code point.
  (func $entityEscape (param $p i32) (result i64)
    (local $word i32)
    (local.set $word (i32.load (local.get $p)))
    (if (i32.or (i32.eq (local.get $word) (i32.const "amp;"))
          (i32.eq (local.get $word) (i32.const "AMP;")))
      (then (return (i64.const 0x2600000004))))
    (if (i32.or (i32.eq (local.get $word) (i32.const "quot"))
          (i32.eq (local.get $word) (i32.const "QUOT")))
      (then
        (if (i32.eq (i32.load8_u offset=4 (local.get $p)) (i32.const ";"))
          (then (return (i64.const 0x2200000005))))
        (return (i64.const 0))))
    (if (i32.eq (local.get $word) (i32.const "apos"))
      (then
        (if (i32.eq (i32.load8_u offset=4 (local.get $p)) (i32.const ";"))
          (then (return (i64.const 0x2700000005))))
        (return (i64.const 0))))
    (local.set $word (i32.and (local.get $word) (i32.const 0xffffff)))
    (if (i32.or (i32.eq (local.get $word) (i32.const "lt;"))
          (i32.eq (local.get $word) (i32.const "LT;")))
      (then (return (i64.const 0x3c00000003))))
    (if (i32.or (i32.eq (local.get $word) (i32.const "gt;"))
          (i32.eq (local.get $word) (i32.const "GT;")))
      (then (return (i64.const 0x3e00000003))))
    (i64.const 0))

  ;; Selected words distinguish the fixed vocabulary; lookup still verifies
  ;; every input byte, so collisions from unknown names are harmless.
  (func $entityHash (param $p i32) (param $length i32) (result i32)
    (local $head i32)
    (local $hash i32)
    (local.set $head (i32.load (local.get $p)))
    (if (i32.lt_u (local.get $length) (i32.const 4))
      (then (local.set $head (i32.and (local.get $head)
        (i32.sub (i32.shl (i32.const 1) (i32.shl (local.get $length) (i32.const 3))) (i32.const 1))))))
    (if (i32.le_u (local.get $length) (i32.const 4))
      (then
        (local.set $hash (i32.mul (i32.xor (local.get $head) (local.get $length)) (i32.const 2444265211)))
        (return (i32.xor (local.get $hash) (i32.shr_u (local.get $hash) (i32.const 16))))))
    (local.set $hash (i32.mul (i32.xor (local.get $head) (local.get $length)) (i32.const 0x9e3779b1)))
    (local.set $hash (i32.mul (i32.xor (local.get $hash)
      (i32.load (i32.sub (i32.add (local.get $p) (local.get $length)) (i32.const 4)))) (i32.const 0x85ebca6b)))
    (if (i32.gt_u (local.get $length) (i32.const 8))
      (then (local.set $hash (i32.mul
        (i32.xor (i32.xor (local.get $hash)
          (i32.load (i32.sub (i32.add (local.get $p) (i32.shr_u (local.get $length) (i32.const 1))) (i32.const 2))))
          (i32.shl (i32.load8_u offset=4 (local.get $p)) (i32.const 24)))
        (i32.const 0xc2b2ae35)))))
    (i32.xor (local.get $hash) (i32.shr_u (local.get $hash) (i32.const 16))))

  ;; The generated displacement table selects one immutable name/value record.
  (func $entitySlot (param $hash i32) (result i32)
    (local $seed i32)
    (local.set $seed (i32.load16_u offset=$mem.entities
      (i32.shl (i32.and (local.get $hash) (i32.const 511)) (i32.const 1))))
    (i32.add (i32.const $mem.entitySlots)
      (i32.shl
        (if (result i32) (i32.and (local.get $seed) (i32.const 32768))
          (then (i32.and (local.get $seed) (i32.const 32767)))
          (else (i32.and
            (i32.add (i32.shr_u (local.get $hash) (i32.const 9))
              (i32.mul (local.get $seed)
                (i32.or (i32.shr_u (local.get $hash) (i32.const 16)) (i32.const 1))))
            (i32.const 4095))))
        (i32.const 2))))

  ;; Expand front-coded names once into flat records. The input page is free
  ;; during instantiation and holds the packed source while its area is reused.
  (func $unpackEntities
    (local $n i32)
    (local $values i32)
    (local $src i32)
    (local $dst i32)
    (local $previous i32)
    (local $i i32)
    (local $length i32)
    (local $c i32)
    (memory.copy (i32.const $mem.input) (i32.const $mem.entitySlots)
      (i32.const 32976))
    (memory.fill (i32.const $mem.entitySlots) (i32.const 0) (i32.const 16384))
    (local.set $n (i32.load16_u (i32.const $mem.input+2)))
    (local.set $values (i32.add (i32.sub (i32.const $mem.input) (i32.const $mem.entitySlots))
      (i32.load16_u (i32.const $mem.input))))
    (local.set $src (i32.add (i32.const $mem.input+4)
      (i32.shl (i32.shr_u (i32.add (local.get $n) (i32.const 63)) (i32.const 6)) (i32.const 1))))
    (local.set $dst (i32.const $mem.entityNames+1))
    (loop $entry
      (local.set $length (i32.load8_u (local.get $src)))
      (local.set $src (i32.add (local.get $src) (i32.const 1)))
      ;; Names are at most 31 bytes. Excess prefix bytes are overwritten by
      ;; the suffix and subsequent names; the generated table reserves slack.
      (v128.store (local.get $dst) (v128.load (local.get $previous)))
      (if (i32.gt_u (local.get $length) (i32.const 16)) (then
        (v128.store offset=16 (local.get $dst) (v128.load offset=16 (local.get $previous)))))
      (block $nameDone
        (loop $name
          (local.set $c (i32.load8_u (local.get $src)))
          (br_if $nameDone (i32.lt_u (local.get $c) (i32.const 48)))
          (i32.store8 (i32.add (local.get $dst) (local.get $length)) (local.get $c))
          (local.set $length (i32.add (local.get $length) (i32.const 1)))
          (local.set $src (i32.add (local.get $src) (i32.const 1)))
          (br $name)))
      (i32.store8 (i32.sub (local.get $dst) (i32.const 1)) (local.get $length))
      (local.set $c (i32.or (i32.load8_u (i32.add (local.get $values) (local.get $i)))
        (i32.shl (i32.load8_u (i32.add (i32.add (local.get $values) (local.get $n)) (local.get $i))) (i32.const 8))))
      (i32.store (call $entitySlot (call $entityHash (local.get $dst) (local.get $length)))
        (i32.or (local.get $dst) (i32.shl (local.get $c) (i32.const 16))))
      (local.set $previous (local.get $dst))
      (local.set $dst (i32.add (local.get $dst) (i32.add (local.get $length) (i32.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $entry (i32.lt_u (local.get $i) (local.get $n)))))

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
    (local $s i32)
    (local $i i32)
    (local $word i64)
    (local $mask i64)
    (block $resolved
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
          ;; Exact name validation below also rejects non-alphanumeric bytes.
          (if (i32.eqz (call $isAlpha (i32.load8_u (local.get $q))))
            (then (return (i32.const 0))))
          (local.set $word (call $entityEscape (local.get $q)))
          (if (i64.ne (local.get $word) (i64.const 0))
            (then
              (if (i32.le_u (i32.add (local.get $q) (i32.wrap_i64 (local.get $word))) (local.get $end))
                (then
                  (local.set $cp (i32.wrap_i64 (i64.shr_u (local.get $word) (i64.const 32))))
                  (local.set $q (i32.sub (i32.add (local.get $q) (i32.wrap_i64 (local.get $word))) (i32.const 1)))
                  (br $resolved)))))
          (if (i32.gt_u (local.get $end) (i32.add (local.get $p) (i32.const 33)))
            (then (local.set $end (i32.add (local.get $p) (i32.const 33)))))
          (local.set $word (i64.xor (i64.load (local.get $q)) (i64.const 0x3b3b3b3b3b3b3b3b)))
          (local.set $mask (i64.and
            (i64.and (i64.sub (local.get $word) (i64.const 0x0101010101010101))
              (i64.xor (local.get $word) (i64.const -1)))
            (i64.const 0x8080808080808080)))
          (local.set $q (if (result i32) (i64.ne (local.get $mask) (i64.const 0))
            (then (i32.add (local.get $q) (i32.shr_u (i32.wrap_i64 (i64.ctz (local.get $mask))) (i32.const 3))))
            (else (call $findByte (i32.add (local.get $q) (i32.const 8)) (local.get $end) (i32.const ";")))))))
      (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
      (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ";")) (then (return (i32.const 0))))
      ;; Verify the selected name so unknown inputs cannot alias a known entity.
      (if (i32.eqz (local.get $digits))
        (then
          (local.set $len (i32.sub (i32.sub (local.get $q) (local.get $p)) (i32.const 1)))
          (local.set $d (i32.load (call $entitySlot
            (call $entityHash (i32.add (local.get $p) (i32.const 1)) (local.get $len)))))
          (local.set $s (i32.and (local.get $d) (i32.const 65535)))
          (if (i32.eqz (local.get $s)) (then (return (i32.const 0))))
          (if (i32.ne (i32.load8_u (i32.sub (local.get $s) (i32.const 1))) (local.get $len))
            (then (return (i32.const 0))))
          (if (i32.le_u (local.get $len) (i32.const 8))
            (then
              (if (i64.ne
                    (i64.shl (i64.xor (i64.load (local.get $s)) (i64.load offset=1 (local.get $p)))
                      (i64.extend_i32_u (i32.sub (i32.const 64) (i32.shl (local.get $len) (i32.const 3)))))
                    (i64.const 0))
                (then (return (i32.const 0)))))
            (else
              (local.set $i (select (local.get $len) (i32.const 16) (i32.lt_u (local.get $len) (i32.const 16))))
              (if (i32.and
                    (i8x16.bitmask (i8x16.ne (v128.load (local.get $s)) (v128.load offset=1 (local.get $p))))
                    (i32.sub (i32.shl (i32.const 1) (local.get $i)) (i32.const 1)))
                (then (return (i32.const 0))))
              (if (i32.gt_u (local.get $len) (i32.const 16))
                (then
                  (if (i32.and
                        (i8x16.bitmask (i8x16.ne (v128.load offset=16 (local.get $s)) (v128.load offset=17 (local.get $p))))
                        (i32.sub (i32.shl (i32.const 1) (i32.sub (local.get $len) (i32.const 16))) (i32.const 1)))
                    (then (return (i32.const 0))))))))
          (local.set $cp (i32.shr_u (local.get $d) (i32.const 16)))
          (local.set $c (i32.sub (local.get $cp) (i32.const 0xd800)))
          (if (i32.lt_u (local.get $c) (i32.const 0x400))
            (then (local.set $cp (i32.add (local.get $c) (i32.const 0x1d400))))
            (else
              (local.set $c (i32.sub (local.get $c) (i32.const 0x400)))
              (if (i32.lt_u (local.get $c) (i32.const 0x400))
                (then (local.set $cp (i32.or
                  (i32.load16_u (i32.sub (i32.const $mem.entitiesEnd) (i32.shl (local.get $c) (i32.const 2))))
                  (i32.shl (local.get $c) (i32.const 24))))))))))
    )
    (global.set $entCp (local.get $cp))
    (global.set $entVal (i32.const $mem.numbuf))
    (global.set $entLen (call $entityEncode (i32.const $mem.numbuf) (local.get $cp)))
    (i32.sub (i32.add (local.get $q) (i32.const 1)) (local.get $p)))
)
