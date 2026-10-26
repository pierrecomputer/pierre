(module
  (import "./memory.wat")
  (import "./scan.wat")

  ;; The decoded replacement text of the last successful $entityMatch: for a
  ;; named reference it points into the generated table, for a numeric one into
  ;; the conversion scratch.
  (global $entVal (mut i32) (i32.const 0))
  (global $entLen (mut i32) (i32.const 0))
  (global $entCp (mut i32) (i32.const -1)) ;; the code point of a numeric reference

  ;; encode $cp as UTF-8 at $p, replacing what HTML calls a disallowed code
  ;; point (NUL, a surrogate, or a value past U+10FFFF) with U+FFFD
  (func $utf8Encode (param $p i32) (param $cp i32) (result i32)
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
    (if (i32.lt_u (local.get $cp) (i32.const 0x800))
      (then
        (i32.store8 (local.get $p)
          (i32.or (i32.const 0xc0) (i32.shr_u (local.get $cp) (i32.const 6))))
        (i32.store8 offset=1 (local.get $p)
          (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3f))))
        (return (i32.const 2))))
    (if (i32.lt_u (local.get $cp) (i32.const 0x10000))
      (then
        (i32.store8 (local.get $p)
          (i32.or (i32.const 0xe0) (i32.shr_u (local.get $cp) (i32.const 12))))
        (i32.store8 offset=1 (local.get $p)
          (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $cp) (i32.const 6)) (i32.const 0x3f))))
        (i32.store8 offset=2 (local.get $p)
          (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3f))))
        (return (i32.const 3))))
    (i32.store8 (local.get $p)
      (i32.or (i32.const 0xf0) (i32.shr_u (local.get $cp) (i32.const 18))))
    (i32.store8 offset=1 (local.get $p)
      (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $cp) (i32.const 12)) (i32.const 0x3f))))
    (i32.store8 offset=2 (local.get $p)
      (i32.or (i32.const 0x80) (i32.and (i32.shr_u (local.get $cp) (i32.const 6)) (i32.const 0x3f))))
    (i32.store8 offset=3 (local.get $p)
      (i32.or (i32.const 0x80) (i32.and (local.get $cp) (i32.const 0x3f))))
    (i32.const 4))

  ;; match an entity or numeric character reference at $p (which points at `&`).
  ;; Returns the number of input bytes consumed, or 0. On success $entVal and
  ;; $entLen hold the UTF-8 replacement text.
  (func $entityMatch (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $cp i32)
    (local $digits i32)
    (local $len i32)
    (local $group i32)
    (local $groupData i32)
    (local $names i32)
    (local $lo i32)
    (local $hi i32)
    (local $mid i32)
    (local $cmp i32)
    (local $i i32)
    (local $a i32)
    (local $b i32)
    (local $name i32)
    (local $rec i32)
    (local $header i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u (local.get $q)) (i32.const "#"))
      (then
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "x"))
          (then
            ;; hexadecimal: at most six digits
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (block $hexDone
              (loop $hex
                (br_if $hexDone (i32.ge_u (local.get $q) (local.get $end)))
                (local.set $c (i32.load8_u (local.get $q)))
                (if (call $isDigit (local.get $c))
                  (then (local.set $cp (i32.add (i32.shl (local.get $cp) (i32.const 4))
                    (i32.sub (local.get $c) (i32.const "0")))))
                  (else
                    (br_if $hexDone (i32.gt_u
                      (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
                      (i32.const 5)))
                    (local.set $cp (i32.add (i32.shl (local.get $cp) (i32.const 4))
                      (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const 87))))))
                (local.set $digits (i32.add (local.get $digits) (i32.const 1)))
                (br_if $hexDone (i32.gt_u (local.get $digits) (i32.const 6)))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $hex))))
          (else
            ;; decimal: at most seven digits
            (block $decDone
              (loop $dec
                (br_if $decDone (i32.ge_u (local.get $q) (local.get $end)))
                (local.set $c (i32.load8_u (local.get $q)))
                (br_if $decDone (i32.eqz (call $isDigit (local.get $c))))
                (local.set $cp (i32.add (i32.mul (local.get $cp) (i32.const 10))
                  (i32.sub (local.get $c) (i32.const "0"))))
                (local.set $digits (i32.add (local.get $digits) (i32.const 1)))
                (br_if $decDone (i32.gt_u (local.get $digits) (i32.const 7)))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $dec)))))
        (if (i32.eqz (local.get $digits)) (then (return (i32.const 0))))
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ";")) (then (return (i32.const 0))))
        (global.set $entCp (local.get $cp))
        (global.set $entVal (i32.const $mem.numbuf))
        (global.set $entLen (call $utf8Encode (i32.const $mem.numbuf) (local.get $cp)))
        (return (i32.sub (i32.add (local.get $q) (i32.const 1)) (local.get $p)))))
    ;; a named reference: letters and digits up to the semicolon
    (if (i32.gt_u (local.get $end) (i32.add (local.get $p) (i32.const 33)))
      (then (local.set $end (i32.add (local.get $p) (i32.const 33)))))
    (block $nameDone
      (loop $name
        (br_if $nameDone (i32.ge_u (local.get $q) (local.get $end)))
        (br_if $nameDone (i32.eqz (call $isAlnum (i32.load8_u (local.get $q)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $name)))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $q)) (i32.const ";")) (then (return (i32.const 0))))
    ;; Named references are grouped by length and sorted in the generated table.
    (local.set $len (i32.sub (i32.sub (local.get $q) (local.get $p)) (i32.const 1)))
    (local.set $group (i32.add (i32.const $mem.entities+4)
      (i32.mul (local.get $len) (i32.const 8))))
    (local.set $groupData (i32.load (local.get $group)))
    (local.set $names (i32.and (local.get $groupData) (i32.const 0xffff)))
    (local.set $hi (i32.load16_u offset=4 (local.get $group)))
    (block $found
      (loop $search
        (if (i32.ge_u (local.get $lo) (local.get $hi)) (then (return (i32.const 0))))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $name (i32.add (local.get $names)
          (i32.mul (local.get $mid) (local.get $len))))
        (local.set $i (i32.const 0))
        (local.set $cmp (i32.const 0))
        (block $cmpDone
          (loop $byte
            (br_if $cmpDone (i32.ge_u (local.get $i) (local.get $len)))
            (local.set $a (i32.load8_u (i32.add (local.get $name) (local.get $i))))
            (local.set $b (i32.load8_u
              (i32.add (i32.add (local.get $p) (i32.const 1)) (local.get $i))))
            (if (i32.ne (local.get $a) (local.get $b))
              (then
                (local.set $cmp (select (i32.const -1) (i32.const 1)
                  (i32.lt_u (local.get $a) (local.get $b))))
                (br $cmpDone)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $byte)))
        (if (i32.eqz (local.get $cmp))
          (then
            (local.set $header (i32.load (i32.const $mem.entities)))
            (local.set $rec (i32.add (i32.and (local.get $header) (i32.const 0xffff))
              (i32.shl (i32.add
                (i32.shr_u (local.get $groupData) (i32.const 16)) (local.get $mid))
                (i32.const 1))))
            (local.set $groupData (i32.load16_u (local.get $rec)))
            (global.set $entVal (i32.add (i32.shr_u (local.get $header) (i32.const 16))
              (i32.and (local.get $groupData) (i32.const 0x1fff))))
            (global.set $entLen (i32.shr_u (local.get $groupData) (i32.const 13)))
            (br $found)))
        (if (i32.lt_s (local.get $cmp) (i32.const 0))
          (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
          (else (local.set $hi (local.get $mid))))
        (br $search)))
    (global.set $entCp (i32.const -1))
    (i32.sub (i32.add (local.get $q) (i32.const 1)) (local.get $p)))
)
