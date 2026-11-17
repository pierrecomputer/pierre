(module
  (import "./memory.wat")

  ;; segLen packs the byte length with a flag for non-ASCII names, which the
  ;; host compares (JS lower-casing) instead of the ASCII comparator here
  (const $SEG.nonAscii 2147483648)
  (const $SEG.lenMask 2147483647)

  ;; set once any interned name holds a byte >= 0x80; the host slices names
  ;; out of one decoded arena string while this stays clear
  (global $segArenaNonAscii (mut i32) (i32.const 0))

  (func $segPtr (param $id i32) (result i32)
    (i32.add (call $base (i32.const $A.segBytes)) (call $get (i32.const $A.segOff) (local.get $id))))

  (func $segLength (param $id i32) (result i32)
    (i32.and (call $get (i32.const $A.segLen) (local.get $id)) (i32.const $SEG.lenMask)))

  (func $segNonAscii (param $id i32) (result i32)
    (i32.shr_u (call $get (i32.const $A.segLen) (local.get $id)) (i32.const 31)))

  ;; 8-bytes-at-a-time hash of [$ptr, $ptr+$len); reads up to 7 bytes past
  ;; the end, which every byte region here pads for. The high-bit OR of all
  ;; words lands in $mem.result+56 so interning learns about non-ASCII names
  ;; from the same pass.
  (func $hashBytes (param $ptr i32) (param $len i32) (result i32)
    (local $h i64) (local $end i32) (local $rem i32) (local $w i64) (local $hi i64)
    (local.set $h (i64.xor (i64.const 0x243f6a8885a308d3) (i64.extend_i32_u (local.get $len))))
    (local.set $end (i32.add (local.get $ptr) (i32.and (local.get $len) (i32.const -8))))
    (block $done
      (loop $words
        (br_if $done (i32.ge_u (local.get $ptr) (local.get $end)))
        (local.set $w (i64.load (local.get $ptr)))
        (local.set $hi (i64.or (local.get $hi) (local.get $w)))
        (local.set $h (i64.mul (i64.xor (local.get $h) (local.get $w)) (i64.const 0x9e3779b97f4a7c15)))
        (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 29))))
        (local.set $ptr (i32.add (local.get $ptr) (i32.const 8)))
        (br $words)))
    (local.set $rem (i32.and (local.get $len) (i32.const 7)))
    (if (local.get $rem)
      (then
        (local.set $w (i64.and (i64.load (local.get $ptr))
          (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3)))) (i64.const 1))))
        (local.set $hi (i64.or (local.get $hi) (local.get $w)))
        (local.set $h (i64.mul (i64.xor (local.get $h) (local.get $w)) (i64.const 0x9e3779b97f4a7c15)))
        (local.set $h (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 29))))))
    (i32.store offset=$mem.result+56 (i32.const 0)
      (i64.ne (i64.and (local.get $hi) (i64.const 0x8080808080808080)) (i64.const 0)))
    (i32.wrap_i64 (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 32)))))

  ;; byte equality of two ranges of equal length, 8 bytes at a time
  (func $memeq (param $a i32) (param $b i32) (param $len i32) (result i32)
    (local $end i32) (local $rem i32) (local $mask i64)
    (local.set $end (i32.add (local.get $a) (i32.and (local.get $len) (i32.const -8))))
    (block $ne
      (block $done
        (loop $words
          (br_if $done (i32.ge_u (local.get $a) (local.get $end)))
          (br_if $ne (i64.ne (i64.load (local.get $a)) (i64.load (local.get $b))))
          (local.set $a (i32.add (local.get $a) (i32.const 8)))
          (local.set $b (i32.add (local.get $b) (i32.const 8)))
          (br $words)))
      (local.set $rem (i32.and (local.get $len) (i32.const 7)))
      (if (local.get $rem)
        (then
          (local.set $mask (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3)))) (i64.const 1)))
          (br_if $ne (i64.ne
            (i64.and (i64.load (local.get $a)) (local.get $mask))
            (i64.and (i64.load (local.get $b)) (local.get $mask))))))
      (return (i32.const 1)))
    (i32.const 0))

  ;; lexicographic byte compare, like JS `<` on ASCII strings
  (func $memcmp (param $a i32) (param $alen i32) (param $b i32) (param $blen i32) (result i32)
    (local $n i32) (local $i i32) (local $ca i32) (local $cb i32)
    (local.set $n (select (local.get $alen) (local.get $blen) (i32.lt_u (local.get $alen) (local.get $blen))))
    (block $done
      (loop $bytes
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $ca (i32.load8_u (i32.add (local.get $a) (local.get $i))))
        (local.set $cb (i32.load8_u (i32.add (local.get $b) (local.get $i))))
        (if (i32.ne (local.get $ca) (local.get $cb))
          (then (return (select (i32.const -1) (i32.const 1) (i32.lt_u (local.get $ca) (local.get $cb))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $bytes)))
    (i32.sub (i32.gt_u (local.get $alen) (local.get $blen)) (i32.lt_u (local.get $alen) (local.get $blen))))

  ;; create the segment tables; id 0 is the root's empty name
  (func $segInit (param $expected i32)
    (local $size i32)
    (global.set $segArenaNonAscii (i32.const 0))
    (call $arrInit (i32.const $A.segOff) (i32.const 2) (i32.add (local.get $expected) (i32.const 64)))
    (call $arrInit (i32.const $A.segLen) (i32.const 2) (i32.add (local.get $expected) (i32.const 64)))
    (call $arrInit (i32.const $A.segBytes) (i32.const 0) (i32.add (i32.shl (local.get $expected) (i32.const 4)) (i32.const 1024)))
    (local.set $size (i32.const 256))
    (loop $grow
      (if (i32.lt_u (local.get $size) (i32.shl (i32.add (local.get $expected) (i32.const 64)) (i32.const 1)))
        (then
          (local.set $size (i32.shl (local.get $size) (i32.const 1)))
          (br $grow))))
    (call $segHashInit (local.get $size))
    (drop (call $arrPush (i32.const $A.segOff) (i32.const 0)))
    (drop (call $arrPush (i32.const $A.segLen) (i32.const 0)))
    ;; "" interns to the root segment, like the JS table
    (i32.store
      (i32.add (call $base (i32.const $A.segHash))
        (i32.shl (i32.and (call $hashBytes (i32.const 0) (i32.const 0)) (i32.sub (local.get $size) (i32.const 1))) (i32.const 2)))
      (i32.const 1)))

  (func $segHashInit (param $size i32)
    (local $d i32)
    (local.set $d (call $descAddr (i32.const $A.segHash)))
    (i32.store offset=$D.shift (local.get $d) (i32.const 2))
    (i32.store offset=$D.len (local.get $d) (i32.const 0))
    (i32.store offset=$D.cap (local.get $d) (local.get $size))
    (i32.store offset=$D.base (local.get $d) (call $allocZeroed (i32.shl (local.get $size) (i32.const 2)))))

  ;; rebuild the hash at twice the size once it is half full
  (func $segHashGrow
    (local $size i32) (local $id i32) (local $n i32) (local $mask i32) (local $slot i32) (local $table i32)
    (local.set $size (i32.shl (call $cap (i32.const $A.segHash)) (i32.const 1)))
    (call $segHashInit (local.get $size))
    (local.set $table (call $base (i32.const $A.segHash)))
    (local.set $mask (i32.sub (local.get $size) (i32.const 1)))
    (local.set $n (call $len (i32.const $A.segOff)))
    (local.set $id (i32.const 1))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $id) (local.get $n)))
        (local.set $slot (i32.and (call $hashBytes (call $segPtr (local.get $id)) (call $segLength (local.get $id))) (local.get $mask)))
        (loop $probe
          (if (i32.load (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2))))
            (then
              (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
              (br $probe))))
        (i32.store (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2))) (i32.add (local.get $id) (i32.const 1)))
        (local.set $id (i32.add (local.get $id) (i32.const 1)))
        (br $each))))

  ;; id of the segment equal to [$ptr, $ptr+$len), or -1; never inserts
  (func $findSegment (param $ptr i32) (param $len i32) (result i32)
    (local $slot i32) (local $id i32) (local $mask i32) (local $table i32)
    (local.set $table (call $base (i32.const $A.segHash)))
    (local.set $mask (i32.sub (call $cap (i32.const $A.segHash)) (i32.const 1)))
    (local.set $slot (i32.and (call $hashBytes (local.get $ptr) (local.get $len)) (local.get $mask)))
    (loop $probe
      (local.set $id (i32.load (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2)))))
      (if (i32.eqz (local.get $id)) (then (return (i32.const -1))))
      (local.set $id (i32.sub (local.get $id) (i32.const 1)))
      (if (i32.eq (call $segLength (local.get $id)) (local.get $len))
        (then
          (if (call $memeq (call $segPtr (local.get $id)) (local.get $ptr) (local.get $len))
            (then (return (local.get $id))))))
      (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
      (br $probe))
    (unreachable))

  ;; intern [$ptr, $ptr+$len): the existing id, or a new one whose bytes are
  ;; copied into the arena (with 8 bytes of slack after the arena end)
  (func $internBytes (param $ptr i32) (param $len i32) (result i32)
    (local $slot i32) (local $id i32) (local $mask i32) (local $table i32) (local $slotPtr i32)
    (local $nonAscii i32) (local $off i32)
    (if (i32.ge_u (i32.shl (call $len (i32.const $A.segOff)) (i32.const 1)) (call $cap (i32.const $A.segHash)))
      (then (call $segHashGrow)))
    (local.set $table (call $base (i32.const $A.segHash)))
    (local.set $mask (i32.sub (call $cap (i32.const $A.segHash)) (i32.const 1)))
    (local.set $slot (i32.and (call $hashBytes (local.get $ptr) (local.get $len)) (local.get $mask)))
    (local.set $nonAscii (i32.load offset=$mem.result+56 (i32.const 0)))
    (loop $probe
      (local.set $slotPtr (i32.add (local.get $table) (i32.shl (local.get $slot) (i32.const 2))))
      (local.set $id (i32.load (local.get $slotPtr)))
      (if (i32.eqz (local.get $id))
        (then
          ;; new segment: copy the bytes into the arena
          (local.set $off (call $len (i32.const $A.segBytes)))
          (call $arrReserve (i32.const $A.segBytes) (i32.add (i32.add (local.get $off) (local.get $len)) (i32.const 8)))
          (memory.copy (i32.add (call $base (i32.const $A.segBytes)) (local.get $off)) (local.get $ptr) (local.get $len))
          (call $setLen (i32.const $A.segBytes) (i32.add (local.get $off) (local.get $len)))
          (local.set $id (call $arrPush (i32.const $A.segOff) (local.get $off)))
          (drop (call $arrPush (i32.const $A.segLen)
            (i32.or (local.get $len) (select (i32.const $SEG.nonAscii) (i32.const 0) (local.get $nonAscii)))))
          (global.set $segArenaNonAscii (i32.or (global.get $segArenaNonAscii) (local.get $nonAscii)))
          (i32.store (local.get $slotPtr) (i32.add (local.get $id) (i32.const 1)))
          (return (local.get $id))))
      (local.set $id (i32.sub (local.get $id) (i32.const 1)))
      (if (i32.eq (call $segLength (local.get $id)) (local.get $len))
        (then
          (if (call $memeq (call $segPtr (local.get $id)) (local.get $ptr) (local.get $len))
            (then (return (local.get $id))))))
      (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
      (br $probe))
    (unreachable))
)
