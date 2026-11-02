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
  ;; a code point in bits 0-23, plus a second code point from the entity table
  ;; when bits 24-27 hold its 1-based index
  (func $entityEncode (param $p i32) (param $v i32) (result i32)
    (local $n i32)
    (local.set $n (call $utf8Encode (local.get $p) (i32.and (local.get $v) (i32.const 0xffffff))))
    (if (i32.shr_u (local.get $v) (i32.const 24))
      (then (local.set $n (i32.add (local.get $n)
        (call $utf8Encode (i32.add (local.get $p) (local.get $n))
          (i32.load16_u offset=$mem.entities+2
            (i32.shr_u (local.get $v) (i32.const 23))))))))
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
    (local $group i32)
    (local $header i32)
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
            (br_if $nameDone (i32.eqz (call $isAlnum (i32.load8_u (local.get $q)))))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $name)))))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ";")) (then (return (i32.const 0))))
    ;; Named references are grouped by length and sorted in the generated table.
    ;; Their value code is the first code point, and the second one's index in
    ;; bits 24-27.
    (if (i32.eqz (local.get $digits))
      (then
        (local.set $len (i32.sub (i32.sub (local.get $q) (local.get $p)) (i32.const 1)))
        (local.set $group (i32.add (i32.const $mem.entities+20)
          (i32.shl (local.get $len) (i32.const 2))))
        (local.set $d (i32.load16_u offset=2 (local.get $group)))
        (local.set $c (call $findName (i32.load16_u (local.get $group))
          (i32.sub (i32.load16_u offset=6 (local.get $group)) (local.get $d)) (local.get $len)
          (i32.add (local.get $p) (i32.const 1)) (i32.const 0)))
        (if (i32.lt_s (local.get $c) (i32.const 0)) (then (return (i32.const 0))))
        (local.set $c (i32.add (local.get $d) (local.get $c)))
        (local.set $header (i32.load (i32.const $mem.entities)))
        (local.set $d (i32.load8_u (i32.add (i32.shr_u (local.get $header) (i32.const 16))
          (local.get $c))))
        (local.set $cp (i32.or
          (i32.load16_u (i32.add (i32.and (local.get $header) (i32.const 0xffff))
            (i32.shl (local.get $c) (i32.const 1))))
          (i32.or (i32.shl (i32.and (local.get $d) (i32.const 1)) (i32.const 16))
            (i32.shl (i32.shr_u (local.get $d) (i32.const 1)) (i32.const 24)))))))
    (global.set $entCp (local.get $cp))
    (global.set $entVal (i32.const $mem.numbuf))
    (global.set $entLen (call $entityEncode (i32.const $mem.numbuf) (local.get $cp)))
    (i32.sub (i32.add (local.get $q) (i32.const 1)) (local.get $p)))
)
