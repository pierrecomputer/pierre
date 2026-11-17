(module
  (import "./memory.wat")
  (import "./segments.wat")

  ;; Host comparator for non-ASCII names: JS lower-casing and natural tokens
  ;; over the raw bytes of two names.
  (import "env" "compareSegmentBytes" (func $hostCompareSegmentBytes (param i32 i32 i32 i32) (result i32)))

  ;; --- natural segment compare (sort.ts semantics for ASCII) ----------------

  (func $isDigit (param $c i32) (result i32)
    (i32.lt_u (i32.sub (local.get $c) (i32.const 48)) (i32.const 10)))

  (func $lower (param $c i32) (result i32)
    (select (i32.add (local.get $c) (i32.const 32)) (local.get $c)
      (i32.lt_u (i32.sub (local.get $c) (i32.const 65)) (i32.const 26))))

  (func $hasDigit (param $p i32) (param $len i32) (result i32)
    (local $end i32)
    (local.set $end (i32.add (local.get $p) (local.get $len)))
    (block $no
      (loop $scan
        (br_if $no (i32.ge_u (local.get $p) (local.get $end)))
        (if (call $isDigit (i32.load8_u (local.get $p))) (then (return (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (i32.const 0))

  ;; lexicographic compare of two lower-cased byte runs
  (func $lowerCmp (param $a i32) (param $alen i32) (param $b i32) (param $blen i32) (result i32)
    (local $n i32) (local $i i32) (local $ca i32) (local $cb i32)
    (local.set $n (select (local.get $alen) (local.get $blen) (i32.lt_u (local.get $alen) (local.get $blen))))
    (block $done
      (loop $bytes
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $ca (call $lower (i32.load8_u (i32.add (local.get $a) (local.get $i)))))
        (local.set $cb (call $lower (i32.load8_u (i32.add (local.get $b) (local.get $i)))))
        (if (i32.ne (local.get $ca) (local.get $cb))
          (then (return (select (i32.const -1) (i32.const 1) (i32.lt_u (local.get $ca) (local.get $cb))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $bytes)))
    (i32.sub (i32.gt_u (local.get $alen) (local.get $blen)) (i32.lt_u (local.get $alen) (local.get $blen))))

  ;; end of the token starting at $p (digit run or non-digit run)
  (func $tokenEnd (param $p i32) (param $end i32) (result i32)
    (local $digit i32)
    (local.set $digit (call $isDigit (i32.load8_u (local.get $p))))
    (loop $scan
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (if (i32.lt_u (local.get $p) (local.get $end))
        (then (br_if $scan (i32.eq (call $isDigit (i32.load8_u (local.get $p))) (local.get $digit))))))
    (local.get $p))

  ;; digit run as the double JS accumulates (n * 10 + d)
  (func $digitsToF64 (param $p i32) (param $end i32) (result f64)
    (local $n f64)
    (loop $each
      (local.set $n (f64.add (f64.mul (local.get $n) (f64.const 10))
        (f64.convert_i32_u (i32.sub (i32.load8_u (local.get $p)) (i32.const 48)))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $p) (local.get $end))))
    (local.get $n))

  ;; the first character of String(number) as JS would compare it
  (func $numberFirstChar (param $n f64) (result i32)
    (select (i32.const 73) (i32.const 49) (f64.eq (local.get $n) (f64.const inf))))

  ;; compareSegmentSortKeys for two ASCII byte ranges
  (func $natCompare (param $a i32) (param $alen i32) (param $b i32) (param $blen i32) (result i32)
    (local $aEnd i32) (local $bEnd i32) (local $pa i32) (local $pb i32) (local $ta i32) (local $tb i32)
    (local $na f64) (local $nb f64) (local $r i32) (local $ca i32) (local $cb i32) (local $aMore i32) (local $bMore i32)
    (if (i32.eqz (i32.or (call $hasDigit (local.get $a) (local.get $alen)) (call $hasDigit (local.get $b) (local.get $blen))))
      (then (return (call $lowerCmp (local.get $a) (local.get $alen) (local.get $b) (local.get $blen)))))
    (local.set $aEnd (i32.add (local.get $a) (local.get $alen)))
    (local.set $bEnd (i32.add (local.get $b) (local.get $blen)))
    (local.set $pa (local.get $a))
    (local.set $pb (local.get $b))
    ;; an empty name is one empty string token
    (local.set $aMore (i32.or (i32.lt_u (local.get $pa) (local.get $aEnd)) (i32.eqz (local.get $alen))))
    (local.set $bMore (i32.or (i32.lt_u (local.get $pb) (local.get $bEnd)) (i32.eqz (local.get $blen))))
    (block $tokensDone
      (loop $tokens
        (br_if $tokensDone (i32.eqz (i32.and (local.get $aMore) (local.get $bMore))))
        (local.set $ta (select (call $tokenEnd (local.get $pa) (local.get $aEnd)) (local.get $pa) (i32.lt_u (local.get $pa) (local.get $aEnd))))
        (local.set $tb (select (call $tokenEnd (local.get $pb) (local.get $bEnd)) (local.get $pb) (i32.lt_u (local.get $pb) (local.get $bEnd))))
        (local.set $ca (select (call $isDigit (i32.load8_u (local.get $pa))) (i32.const 0) (i32.lt_u (local.get $pa) (local.get $aEnd))))
        (local.set $cb (select (call $isDigit (i32.load8_u (local.get $pb))) (i32.const 0) (i32.lt_u (local.get $pb) (local.get $bEnd))))
        (if (i32.and (local.get $ca) (local.get $cb))
          (then
            (local.set $na (call $digitsToF64 (local.get $pa) (local.get $ta)))
            (local.set $nb (call $digitsToF64 (local.get $pb) (local.get $tb)))
            (if (f64.ne (local.get $na) (local.get $nb))
              (then (return (select (i32.const -1) (i32.const 1) (f64.lt (local.get $na) (local.get $nb)))))))
          (else
            (if (i32.or (local.get $ca) (local.get $cb))
              (then
                ;; number against string: decided by the first characters
                (if (local.get $ca)
                  (then
                    (local.set $ca (call $numberFirstChar (call $digitsToF64 (local.get $pa) (local.get $ta))))
                    (local.set $cb (select (call $lower (i32.load8_u (local.get $pb))) (i32.const 0) (i32.lt_u (local.get $pb) (local.get $bEnd)))))
                  (else
                    (local.set $ca (select (call $lower (i32.load8_u (local.get $pa))) (i32.const 0) (i32.lt_u (local.get $pa) (local.get $aEnd))))
                    (local.set $cb (call $numberFirstChar (call $digitsToF64 (local.get $pb) (local.get $tb))))))
                (return (select (i32.const -1) (i32.const 1) (i32.lt_u (local.get $ca) (local.get $cb)))))
              (else
                (local.set $r (call $lowerCmp (local.get $pa) (i32.sub (local.get $ta) (local.get $pa)) (local.get $pb) (i32.sub (local.get $tb) (local.get $pb))))
                (if (local.get $r) (then (return (local.get $r))))))))
        (local.set $pa (local.get $ta))
        (local.set $pb (local.get $tb))
        (local.set $aMore (i32.lt_u (local.get $pa) (local.get $aEnd)))
        (local.set $bMore (i32.lt_u (local.get $pb) (local.get $bEnd)))
        (br $tokens)))
    (if (i32.ne (local.get $aMore) (local.get $bMore))
      (then (return (select (i32.const 1) (i32.const -1) (local.get $aMore)))))
    (call $lowerCmp (local.get $a) (local.get $alen) (local.get $b) (local.get $blen)))

  ;; Whole-path order of two newline-free canonical paths (a trailing '/'
  ;; marks a directory), as comparePreparedPaths: first differing segment
  ;; decides, directories before files at that depth, then natural order,
  ;; then raw bytes; a prefix sorts first, directories before files on ties.
  (func $comparePaths (param $a i32) (param $aEnd i32) (param $b i32) (param $bEnd i32) (result i32)
    (local $aDir i32) (local $bDir i32) (local $pa i32) (local $pb i32) (local $sa i32) (local $sb i32)
    (local $aLast i32) (local $bLast i32) (local $r i32) (local $aKind i32) (local $bKind i32) (local $nonAscii i32)
    (local.set $aDir (i32.and (i32.gt_u (local.get $aEnd) (local.get $a)) (i32.eq (i32.load8_u (i32.sub (local.get $aEnd) (i32.const 1))) (i32.const 47))))
    (local.set $bDir (i32.and (i32.gt_u (local.get $bEnd) (local.get $b)) (i32.eq (i32.load8_u (i32.sub (local.get $bEnd) (i32.const 1))) (i32.const 47))))
    (if (local.get $aDir) (then (local.set $aEnd (i32.sub (local.get $aEnd) (i32.const 1)))))
    (if (local.get $bDir) (then (local.set $bEnd (i32.sub (local.get $bEnd) (i32.const 1)))))
    (local.set $pa (local.get $a))
    (local.set $pb (local.get $b))
    (loop $segments
      ;; segment bounds
      (local.set $sa (local.get $pa))
      (block $ea (loop $fa
        (br_if $ea (i32.ge_u (local.get $sa) (local.get $aEnd)))
        (br_if $ea (i32.eq (i32.load8_u (local.get $sa)) (i32.const 47)))
        (local.set $sa (i32.add (local.get $sa) (i32.const 1)))
        (br $fa)))
      (local.set $sb (local.get $pb))
      (block $eb (loop $fb
        (br_if $eb (i32.ge_u (local.get $sb) (local.get $bEnd)))
        (br_if $eb (i32.eq (i32.load8_u (local.get $sb)) (i32.const 47)))
        (local.set $sb (i32.add (local.get $sb) (i32.const 1)))
        (br $fb)))
      (local.set $aLast (i32.ge_u (local.get $sa) (local.get $aEnd)))
      (local.set $bLast (i32.ge_u (local.get $sb) (local.get $bEnd)))
      (if (i32.or (i32.ne (i32.sub (local.get $sa) (local.get $pa)) (i32.sub (local.get $sb) (local.get $pb)))
                  (i32.eqz (call $memeq (local.get $pa) (local.get $pb) (i32.sub (local.get $sa) (local.get $pa)))))
        (then
          ;; first differing segment: intermediate segments are directories
          (local.set $aKind (i32.or (i32.eqz (local.get $aLast)) (local.get $aDir)))
          (local.set $bKind (i32.or (i32.eqz (local.get $bLast)) (local.get $bDir)))
          (if (i32.ne (local.get $aKind) (local.get $bKind))
            (then (return (select (i32.const -1) (i32.const 1) (local.get $aKind)))))
          (drop (call $hashBytes (local.get $pa) (i32.sub (local.get $sa) (local.get $pa))))
          (local.set $nonAscii (i32.load offset=$mem.result+56 (i32.const 0)))
          (drop (call $hashBytes (local.get $pb) (i32.sub (local.get $sb) (local.get $pb))))
          (local.set $nonAscii (i32.or (local.get $nonAscii) (i32.load offset=$mem.result+56 (i32.const 0))))
          (if (local.get $nonAscii)
            (then (local.set $r (call $hostCompareSegmentBytes (local.get $pa) (i32.sub (local.get $sa) (local.get $pa)) (local.get $pb) (i32.sub (local.get $sb) (local.get $pb)))))
            (else (local.set $r (call $natCompare (local.get $pa) (i32.sub (local.get $sa) (local.get $pa)) (local.get $pb) (i32.sub (local.get $sb) (local.get $pb))))))
          (if (local.get $r) (then (return (local.get $r))))
          (return (call $memcmp (local.get $pa) (i32.sub (local.get $sa) (local.get $pa)) (local.get $pb) (i32.sub (local.get $sb) (local.get $pb))))))
      (if (i32.and (local.get $aLast) (local.get $bLast))
        (then
          (if (i32.eq (local.get $aDir) (local.get $bDir)) (then (return (i32.const 0))))
          (return (select (i32.const -1) (i32.const 1) (local.get $aDir)))))
      (if (local.get $aLast) (then (return (i32.const -1))))
      (if (local.get $bLast) (then (return (i32.const 1))))
      (local.set $pa (i32.add (local.get $sa) (i32.const 1)))
      (local.set $pb (i32.add (local.get $sb) (i32.const 1)))
      (br $segments))
    (unreachable))
)
