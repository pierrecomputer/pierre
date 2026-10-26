(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./record.wat")
  (import "./entity.wat")

  ;; Full Unicode case folding, used to normalize link labels.
  (unicode-fold-table $mem.fold $mem.foldEnd)

  (global $linkHash (mut i32) (i32.const 0))
  (global $linkMask (mut i32) (i32.const 0))
  (global $fnOrder (mut i32) (i32.const 0)) ;; definitions in order of first reference
  (global $fnTotal (mut i32) (i32.const 0))
  (global $fnUsed (mut i32) (i32.const 0))

  ;; the number of bytes in the UTF-8 sequence starting with $c
  (func $utf8Width (param $c i32) (result i32)
    (if (i32.lt_u (local.get $c) (i32.const 0xc0)) (then (return (i32.const 1))))
    (if (i32.lt_u (local.get $c) (i32.const 0xe0)) (then (return (i32.const 2))))
    (if (i32.lt_u (local.get $c) (i32.const 0xf0)) (then (return (i32.const 3))))
    (i32.const 4))

  ;; Case fold [$src,$end), trim it, and collapse internal whitespace runs to a
  ;; single space. A nonzero prefix keeps footnotes in their own namespace.
  ;; Returns hash in the high word and normalized length in the low word.
  (func $normalizeLabel
    (param $src i32) (param $end i32) (param $dst i32) (param $prefix i32) (result i64)
    (local $p i32)
    (local $out i32)
    (local $q i32)
    (local $c i32)
    (local $space i32)
    (local $h i32)
    (local $foldCp i32)
    (local $foldLen i32)
    (local $foldLo i32)
    (local $foldHi i32)
    (local $foldMid i32)
    (local $foldAt i32)
    (local $foldRunLo i32)
    (local $foldRange i32)
    (local $foldPacked i32)
    (local $foldKey i32)
    (local $foldHeader i32)
    (local $foldMulti i32)
    (local.set $p (local.get $src))
    (local.set $out (local.get $dst))
    (local.set $h (i32.const 0x811c9dc5))
    (if (local.get $prefix)
      (then
        (i32.store8 (local.get $out) (local.get $prefix))
        (local.set $out (i32.add (local.get $out) (i32.const 1)))
        (local.set $h (i32.mul
          (i32.xor (local.get $h) (local.get $prefix)) (i32.const 16777619)))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (call $isWhiteByte (local.get $c))
          (then
            (local.set $space (i32.const 1))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if (i32.and (local.get $space) (i32.gt_u (local.get $out) (local.get $dst)))
          (then
            (i32.store8 (local.get $out) (i32.const 32))
            (local.set $out (i32.add (local.get $out) (i32.const 1)))
            (local.set $h (i32.mul
              (i32.xor (local.get $h) (i32.const 32)) (i32.const 16777619)))))
        (local.set $space (i32.const 0))
        (if (i32.lt_u (local.get $c) (i32.const 0x80))
          (then
            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
              (then (local.set $c (i32.add (local.get $c) (i32.const 32)))))
            (i32.store8 (local.get $out) (local.get $c))
            (local.set $out (i32.add (local.get $out) (i32.const 1)))
            (local.set $h (i32.mul
              (i32.xor (local.get $h) (local.get $c)) (i32.const 16777619)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (local.set $q (local.get $out))
        (local.set $foldCp (call $utf8At (local.get $p) (local.get $end)))
        (block $folded
          (if (i32.lt_u (local.get $foldCp) (i32.const 0x80))
            (then
              (if (i32.le_u (i32.sub (local.get $foldCp) (i32.const 0x41)) (i32.const 25))
                (then (local.set $foldCp (i32.add (local.get $foldCp) (i32.const 32)))))
              (i32.store8 (local.get $out) (local.get $foldCp))
              (local.set $foldLen (i32.const 1))
              (br $folded)))
          ;; Most non-ASCII folds map to one code point.
          (local.set $foldHeader (i32.load (i32.const $mem.fold)))
          (local.set $foldHi (i32.and (local.get $foldHeader) (i32.const 0xffff)))
          (local.set $foldLo (i32.const 0))
          (block $foldNoRun
            (loop $foldRunSearch
              (br_if $foldNoRun (i32.ge_u (local.get $foldLo) (local.get $foldHi)))
              (local.set $foldMid
                (i32.shr_u (i32.add (local.get $foldLo) (local.get $foldHi)) (i32.const 1)))
              (local.set $foldAt (i32.add (i32.const $mem.fold+4)
                (i32.mul (local.get $foldMid) (i32.const 8))))
              (local.set $foldRange (i32.load (local.get $foldAt)))
              (local.set $foldRunLo (i32.and (local.get $foldRange) (i32.const 0x1fffff)))
              (if (i32.lt_u (local.get $foldCp) (local.get $foldRunLo))
                (then (local.set $foldHi (local.get $foldMid)))
                (else
                  (if (i32.le_u (i32.sub (local.get $foldCp) (local.get $foldRunLo))
                        (i32.shr_u (local.get $foldRange) (i32.const 21)))
                    (then
                      (local.set $foldPacked (i32.load offset=4 (local.get $foldAt)))
                      (if (i32.eqz (i32.and
                            (i32.sub (local.get $foldCp) (local.get $foldRunLo))
                            (i32.sub
                              (i32.shr_u (local.get $foldPacked) (i32.const 24))
                              (i32.const 1))))
                        (then
                          (local.set $foldCp (i32.add (local.get $foldCp)
                            (i32.shr_s
                              (i32.shl (local.get $foldPacked) (i32.const 8))
                              (i32.const 8))))
                          (local.set $foldLen
                            (call $utf8Encode (local.get $out) (local.get $foldCp)))
                          (br $folded)))
                      (br $foldNoRun)))
                  (local.set $foldLo (i32.add (local.get $foldMid) (i32.const 1)))))
              (br $foldRunSearch)))
          ;; The remaining folds expand to multiple code points.
          (local.set $foldHi (i32.shr_u (local.get $foldHeader) (i32.const 16)))
          (local.set $foldLo (i32.const 0))
          (local.set $foldMulti (i32.add (i32.const $mem.fold+4)
            (i32.mul
              (i32.and (local.get $foldHeader) (i32.const 0xffff)) (i32.const 8))))
          (block $foldNoMulti
            (loop $foldMultiSearch
              (br_if $foldNoMulti (i32.ge_u (local.get $foldLo) (local.get $foldHi)))
              (local.set $foldMid
                (i32.shr_u (i32.add (local.get $foldLo) (local.get $foldHi)) (i32.const 1)))
              (local.set $foldAt (i32.add (local.get $foldMulti)
                (i32.mul (local.get $foldMid) (i32.const 8))))
              (local.set $foldKey (i32.load (local.get $foldAt)))
              (if (i32.eq (local.get $foldKey) (local.get $foldCp))
                (then
                  (local.set $foldLen (i32.load8_u offset=6 (local.get $foldAt)))
                  (memory.copy (local.get $out)
                    (i32.load16_u offset=4 (local.get $foldAt)) (local.get $foldLen))
                  (br $folded)))
              (if (i32.lt_u (local.get $foldKey) (local.get $foldCp))
                (then (local.set $foldLo (i32.add (local.get $foldMid) (i32.const 1))))
                (else (local.set $foldHi (local.get $foldMid))))
              (br $foldMultiSearch)))
          (local.set $foldLen (call $utf8Encode (local.get $out) (local.get $foldCp))))
        (local.set $out (i32.add (local.get $out) (local.get $foldLen)))
        (block $hashed
          (loop $hash
            (br_if $hashed (i32.ge_u (local.get $q) (local.get $out)))
            (local.set $h (i32.mul
              (i32.xor (local.get $h) (i32.load8_u (local.get $q)))
              (i32.const 16777619)))
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $hash)))
        (local.set $p (i32.add (local.get $p) (call $utf8Width (local.get $c))))
        (br $l)))
    (i64.or
      (i64.extend_i32_u (i32.sub (local.get $out) (local.get $dst)))
      (i64.shl (i64.extend_i32_u (local.get $h)) (i64.const 32))))

  ;; a link label starting at `[`; returns the position past `]`, or 0
  (func $scanLinkLabel (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "[")) (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.eq (local.get $c) (i32.const "[")) (then (return (i32.const 0))))
        (br_if $done (i32.eq (local.get $c) (i32.const "]")))
        (if (i32.eq (local.get $c) (i32.const "\5c"))
          (then
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
                  (call $isAsciiPunct (i32.load8_u (local.get $q))))
              (then (local.set $q (i32.add (local.get $q) (i32.const 1))))))
          (else (local.set $q (i32.add (local.get $q) (i32.const 1)))))
        (if (i32.gt_u (i32.sub (local.get $q) (local.get $p)) (i32.const 1001))
          (then (return (i32.const 0))))
        (br $l)))
    (i32.add (local.get $q) (i32.const 1)))

  ;; a link destination; returns the position after it, or -1
  (func $scanLinkDest (param $p i32) (param $end i32) (result i32)
    (local $i i32)
    (local $c i32)
    (local $depth i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const -1))))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
      (then
        (local.set $i (i32.add (local.get $p) (i32.const 1)))
        (block $found
          (loop $l
            (if (i32.ge_u (local.get $i) (local.get $end)) (then (return (i32.const -1))))
            (local.set $c (i32.load8_u (local.get $i)))
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $found)))
            (if (i32.eq (local.get $c) (i32.const "\5c"))
              (then
                (local.set $i (i32.add (local.get $i) (i32.const 2)))
                (br $l)))
            (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const "<")))
              (then (return (i32.const -1))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (return (local.get $i))))
    (local.set $i (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $i)))
        (if (i32.eq (local.get $c) (i32.const "\5c"))
          (then
            (if (i32.and (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $end))
                  (call $isAsciiPunct (i32.load8_u offset=1 (local.get $i))))
              (then
                (local.set $i (i32.add (local.get $i) (i32.const 2)))
                (br $l)))))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (if (i32.gt_u (local.get $depth) (i32.const 32)) (then (return (i32.const -1))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (br_if $done (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $l)))
        (if (i32.le_u (local.get $c) (i32.const 32))
          (then
            (if (i32.eq (local.get $i) (local.get $p)) (then (return (i32.const -1))))
            (br $done)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (if (local.get $depth) (then (return (i32.const -1))))
    (local.get $i))

  ;; a link title in double quotes, single quotes or parentheses
  (func $scanLinkTitle (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $close i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "\22")) (i32.eq (local.get $c) (i32.const "'")))
      (then (local.set $close (local.get $c)))
      (else
        (if (i32.ne (local.get $c) (i32.const "(")) (then (return (i32.const 0))))
        (local.set $close (i32.const ")"))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.eq (local.get $c) (i32.const "\5c"))
          (then
            (if (i32.and (i32.lt_u (i32.add (local.get $q) (i32.const 1)) (local.get $end))
                  (call $isAsciiPunct (i32.load8_u offset=1 (local.get $q))))
              (then
                (local.set $q (i32.add (local.get $q) (i32.const 2)))
                (br $l)))))
        (br_if $done (i32.eq (local.get $c) (local.get $close)))
        ;; the parenthesised form may not contain an unescaped `(`
        (if (i32.and (i32.eq (local.get $close) (i32.const ")"))
              (i32.eq (local.get $c) (i32.const "(")))
          (then (return (i32.const 0))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (i32.add (local.get $q) (i32.const 1)))

  ;; Parse link reference definitions off the front of a paragraph and drop the
  ;; text they consumed. Definitions may span lines, so this works on the
  ;; paragraph's contiguous content buffer.
  (func $resolveLinkDefs (param $r i32)
    (local $len i32)
    (local $off i32)
    (local $k i32)
    (local $line i32)
    (local $blank i32)
    (local $base i32)
    (local $end i32)
    (local $pos i32)
    (local $q i32)
    (local $labelOff i32)
    (local $labelLen i32)
    (local $destOff i32)
    (local $destLen i32)
    (local $titleOff i32)
    (local $titleLen i32)
    (local $hasTitle i32)
    (local $beforeTitle i32)
    (local $def i32)
    (local $dst i32)
    (local $n i32)
    (local $angle i32)
    (local $normalized i64)
    (local $lineCount i32)
    (local $lineIndex i32)
    (local $trimLine i32)
    (local $acc i32)
    (local $lineLen i32)
    (local $pad i32)
    (local $rel i32)
    (if (i32.eqz (i32.load offset=$R.nLines (local.get $r))) (then (return)))
    (local.set $line (call $lineAt (local.get $r) (i32.const 0)))
    (if (call $linePad (local.get $line)) (then (return)))
    (if (i32.ne (i32.load8_u (call $lineBeg (local.get $line))) (i32.const "[")) (then (return)))
    (local.set $len (call $blockContent (local.get $r)))
    (block $done
      (loop $defs
        (br_if $done (i32.ge_u (local.get $off) (local.get $len)))
        (br_if $done (i32.ne
          (i32.load8_u (call $contentAt (local.get $off)))
          (i32.const "[")))
        ;; Parse one definition. Failure leaves $k at zero and ends the scan.
        (local.set $k (i32.const 0))
        (local.set $hasTitle (i32.const 0))
        (local.set $titleOff (i32.const 0))
        (local.set $titleLen (i32.const 0))
        (block $parsed
          (local.set $base (call $contentAt (i32.const 0)))
          (local.set $end (i32.add (local.get $base) (local.get $len)))
          (local.set $pos (call $scanLinkLabel
            (i32.add (local.get $base) (local.get $off)) (local.get $end)))
          (br_if $parsed (i32.eqz (local.get $pos)))
          (local.set $labelOff (i32.add (local.get $off) (i32.const 1)))
          (local.set $labelLen (i32.sub
            (i32.sub (local.get $pos) (i32.add (local.get $base) (local.get $off)))
            (i32.const 2)))
          (br_if $parsed (i32.ge_u
            (call $skipWs (i32.add (local.get $base) (local.get $labelOff))
              (i32.sub (local.get $pos) (i32.const 1)))
            (i32.sub (local.get $pos) (i32.const 1))))
          (br_if $parsed (i32.ge_u (local.get $pos) (local.get $end)))
          (br_if $parsed (i32.ne (i32.load8_u (local.get $pos)) (i32.const ":")))
          ;; spaces/tabs, at most one newline, then spaces/tabs
          (local.set $pos
            (call $skipSpace (i32.add (local.get $pos) (i32.const 1)) (local.get $end)))
          (if (i32.and
                (i32.lt_u (local.get $pos) (local.get $end))
                (i32.eq (i32.load8_u (local.get $pos)) (i32.const 10)))
            (then (local.set $pos
              (call $skipSpace
                (i32.add (local.get $pos) (i32.const 1)) (local.get $end)))))
          (local.set $q (call $scanLinkDest (local.get $pos) (local.get $end)))
          (br_if $parsed (i32.or
            (i32.lt_s (local.get $q) (i32.const 0))
            (i32.eq (local.get $q) (local.get $pos))))
          (local.set $angle (i32.eq (i32.load8_u (local.get $pos)) (i32.const "<")))
          (local.set $destOff (i32.add
            (i32.sub (local.get $pos) (local.get $base)) (local.get $angle)))
          (local.set $destLen (i32.sub
            (i32.sub (local.get $q) (local.get $pos))
            (i32.shl (local.get $angle) (i32.const 1))))
          (local.set $beforeTitle (local.get $q))
          (local.set $pos (call $skipSpace (local.get $q) (local.get $end)))
          (if (i32.and
                (i32.lt_u (local.get $pos) (local.get $end))
                (i32.eq (i32.load8_u (local.get $pos)) (i32.const 10)))
            (then (local.set $pos
              (call $skipSpace
                (i32.add (local.get $pos) (i32.const 1)) (local.get $end)))))
          (if (i32.ne (local.get $pos) (local.get $beforeTitle))
            (then
              (local.set $q (call $scanLinkTitle (local.get $pos) (local.get $end)))
              (if (local.get $q)
                (then
                  (local.set $hasTitle (i32.const 1))
                  (local.set $titleOff (i32.add
                    (i32.sub (local.get $pos) (local.get $base)) (i32.const 1)))
                  (local.set $titleLen (i32.sub
                    (i32.sub (local.get $q) (local.get $pos)) (i32.const 2))))
                (else (local.set $q (local.get $beforeTitle)))))
            (else (local.set $q (local.get $beforeTitle))))
          (local.set $pos (call $skipSpace (local.get $q) (local.get $end)))
          (if (i32.eqz (i32.or
                (i32.ge_u (local.get $pos) (local.get $end))
                (i32.eq (i32.load8_u (local.get $pos)) (i32.const 10))))
            (then
              (br_if $parsed (i32.eqz (local.get $hasTitle)))
              ;; Retry without the title.
              (local.set $hasTitle (i32.const 0))
              (local.set $titleLen (i32.const 0))
              (local.set $pos (call $skipSpace (local.get $beforeTitle) (local.get $end)))
              (br_if $parsed (i32.eqz (i32.or
                (i32.ge_u (local.get $pos) (local.get $end))
                (i32.eq (i32.load8_u (local.get $pos)) (i32.const 10)))))))
          (if (i32.and
                (i32.lt_u (local.get $pos) (local.get $end))
                (i32.eq (i32.load8_u (local.get $pos)) (i32.const 10)))
            (then (local.set $pos (i32.add (local.get $pos) (i32.const 1)))))
          (local.set $n
            (i32.sub (local.get $pos) (i32.add (local.get $base) (local.get $off))))
          ;; Reserving first means the scratch can move safely.
          (call $ensureRec (i32.add (i32.const 64) (i32.add
            (i32.mul (local.get $labelLen) (i32.const 3))
            (i32.add (local.get $destLen) (local.get $titleLen)))))
          (local.set $base (call $contentAt (i32.const 0)))
          (local.set $def (call $recNew (enum.get $Blk.linkdef)))
          (global.set $rec (i32.add (local.get $def) (i32.const $R.labelBytes)))
          (local.set $dst (global.get $rec))
          (local.set $normalized (call $normalizeLabel
            (i32.add (local.get $base) (local.get $labelOff))
            (i32.add
              (i32.add (local.get $base) (local.get $labelOff)) (local.get $labelLen))
            (local.get $dst) (i32.const 0)))
          (local.set $labelLen (i32.wrap_i64 (local.get $normalized)))
          (local.set $dst (i32.add (local.get $dst) (local.get $labelLen)))
          (memory.copy
            (local.get $dst) (i32.add (local.get $base) (local.get $destOff))
            (local.get $destLen))
          (local.set $dst (i32.add (local.get $dst) (local.get $destLen)))
          (memory.copy
            (local.get $dst) (i32.add (local.get $base) (local.get $titleOff))
            (local.get $titleLen))
          (local.set $dst (i32.add (local.get $dst) (local.get $titleLen)))
          (i32.store offset=8 (local.get $def) (local.get $destLen))
          (i32.store offset=12 (local.get $def) (local.get $titleLen))
          (i32.store offset=$R.labelLen (local.get $def) (local.get $labelLen))
          (i32.store offset=$R.hash (local.get $def)
            (i32.wrap_i64 (i64.shr_u (local.get $normalized) (i64.const 32))))
          (local.set $dst
            (i32.and (i32.add (local.get $dst) (i32.const 7)) (i32.const -8)))
          (i32.store offset=4 (local.get $def) (i32.sub (local.get $dst) (local.get $def)))
          (global.set $rec (local.get $dst))
          (local.set $k (local.get $n)))
        (br_if $done (i32.eqz (local.get $k)))
        (local.set $off (i32.add (local.get $off) (local.get $k)))
        (br $defs)))
    (if (local.get $off)
      (then
        (local.set $blank (i32.ge_u
          (call $skipWs
            (call $contentAt (local.get $off))
            (call $contentAt (local.get $len)))
          (call $contentAt (local.get $len))))
        ;; Drop the consumed prefix and adjust the first remaining line.
        (local.set $lineCount (i32.load offset=$R.nLines (local.get $r)))
        (block $trimmed
          (loop $trimLines
            (br_if $trimmed (i32.ge_u (local.get $lineIndex) (local.get $lineCount)))
            (local.set $trimLine
              (call $lineAt (local.get $r) (local.get $lineIndex)))
            (local.set $pad (call $linePad (local.get $trimLine)))
            (local.set $lineLen (i32.add (local.get $pad)
              (i32.sub
                (call $lineEndOf (local.get $trimLine))
                (call $lineBeg (local.get $trimLine)))))
            (if (i32.le_u (local.get $off)
                  (i32.add (local.get $acc) (local.get $lineLen)))
              (then
                (local.set $rel (i32.sub (local.get $off) (local.get $acc)))
                (if (i32.lt_u (local.get $rel) (local.get $pad))
                  (then (i32.store offset=4 (local.get $trimLine) (i32.or
                    (call $lineEndOf (local.get $trimLine))
                    (i32.shl
                      (i32.sub (local.get $pad) (local.get $rel)) (i32.const 30)))))
                  (else
                    (i32.store (local.get $trimLine)
                      (i32.add (call $lineBeg (local.get $trimLine))
                        (i32.sub (local.get $rel) (local.get $pad))))
                    (i32.store offset=4 (local.get $trimLine)
                      (call $lineEndOf (local.get $trimLine)))))
                (br $trimmed)))
            (local.set $acc
              (i32.add
                (i32.add (local.get $acc) (local.get $lineLen)) (i32.const 1)))
            (local.set $lineIndex (i32.add (local.get $lineIndex) (i32.const 1)))
            (br $trimLines)))
        (if (i32.ge_u (local.get $lineIndex) (local.get $lineCount))
          (then (i32.store offset=$R.nLines (local.get $r) (i32.const 0)))
          (else
            (if (local.get $lineIndex)
              (then
                (memory.copy
                  (call $lineAt (local.get $r) (i32.const 0))
                  (call $lineAt (local.get $r) (local.get $lineIndex))
                  (i32.mul
                    (i32.sub (local.get $lineCount) (local.get $lineIndex))
                    (i32.const $R.line)))
                (i32.store offset=$R.nLines (local.get $r)
                  (i32.sub (local.get $lineCount) (local.get $lineIndex)))))))
        ;; a paragraph made of nothing but definitions leaves no content
        (if (local.get $blank)
          (then (i32.store offset=$R.nLines (local.get $r) (i32.const 0)))))))

  ;; build the open-addressed table that maps a normalized label to its first
  ;; definition; it lives at the end of the record region
  (func $linkIndex
    (local $r i32)
    (local $count i32)
    (local $slots i32)
    (local $table i32)
    (local $i i32)
    (local $slot i32)
    (local $type i32)
    (global.set $recEnd (global.get $rec))
    (local.set $r (global.get $recBase))
    (block $counted
      (loop $l
        (br_if $counted (i32.ge_u (local.get $r) (global.get $rec)))
        (local.set $type (i32.load8_u (local.get $r)))
        (if (i32.eq (local.get $type) (enum.get $Blk.linkdef))
          (then (local.set $count (i32.add (local.get $count) (i32.const 1))))
          (else
            (if (i32.and
                  (i32.eq (local.get $type) (enum.get $Blk.footnote))
                  (i32.ne (i32.and (i32.load8_u offset=1 (local.get $r))
                    (i32.const $F.opener)) (i32.const 0)))
              (then
                (local.set $count (i32.add (local.get $count) (i32.const 1)))
                (global.set $fnTotal (i32.add (global.get $fnTotal) (i32.const 1)))))))
        (local.set $r (i32.add (local.get $r) (i32.load offset=4 (local.get $r))))
        (br $l)))
    (if (i32.eqz (local.get $count)) (then (return)))
    (local.set $slots (i32.const 16))
    (block $sized
      (loop $l
        (br_if $sized (i32.ge_u (local.get $slots) (i32.mul (local.get $count) (i32.const 2))))
        (local.set $slots (i32.shl (local.get $slots) (i32.const 1)))
        (br $l)))
    (call $ensureRec (i32.add (i32.mul (local.get $slots) (i32.const 4)) (i32.const 16)))
    (local.set $table (i32.and (i32.add (global.get $rec) (i32.const 7)) (i32.const -8)))
    (memory.fill (local.get $table) (i32.const 0) (i32.mul (local.get $slots) (i32.const 4)))
    (global.set $linkHash (local.get $table))
    (global.set $linkMask (i32.sub (local.get $slots) (i32.const 1)))
    (local.set $r (global.get $recBase))
    (block $filled
      (loop $l
        (br_if $filled (i32.ge_u (local.get $r) (local.get $table)))
        (local.set $type (i32.load8_u (local.get $r)))
        (if (i32.or
              (i32.eq (local.get $type) (enum.get $Blk.linkdef))
              (i32.and
                (i32.eq (local.get $type) (enum.get $Blk.footnote))
                (i32.ne (i32.and (i32.load8_u offset=1 (local.get $r))
                  (i32.const $F.opener)) (i32.const 0))))
          (then
            (local.set $i (i32.and (i32.load offset=$R.hash (local.get $r)) (global.get $linkMask)))
            (block $placed
              (loop $probe
                (local.set $slot (i32.load
                  (i32.add (local.get $table) (i32.mul (local.get $i) (i32.const 4)))))
                (if (i32.eqz (local.get $slot))
                  (then
                    (i32.store (i32.add (local.get $table) (i32.mul (local.get $i) (i32.const 4)))
                      (local.get $r))
                    (br $placed)))
                ;; the first definition wins
                (br_if $placed (call $defLabelEq (local.get $slot)
                  (i32.add (local.get $r) (i32.const $R.labelBytes))
                  (i32.load offset=$R.labelLen (local.get $r))))
                (local.set $i (i32.and (i32.add (local.get $i) (i32.const 1)) (global.get $linkMask)))
                (br $probe)))))
        (local.set $r (i32.add (local.get $r) (i32.load offset=4 (local.get $r))))
        (br $l)))
    (global.set $rec (i32.add (local.get $table) (i32.mul (local.get $slots) (i32.const 4))))
    (global.set $recEnd (local.get $table))
    ;; the footnotes are numbered as they are first referenced, so the section
    ;; at the end needs a place to record that order
    (if (global.get $fnTotal)
      (then
        (call $ensureRec (i32.add (i32.mul (global.get $fnTotal) (i32.const 4)) (i32.const 16)))
        (global.set $fnOrder (i32.and (i32.add (global.get $rec) (i32.const 3)) (i32.const -4)))
        (global.set $rec
          (i32.add (global.get $fnOrder) (i32.mul (global.get $fnTotal) (i32.const 4)))))))

  (func $defLabelEq (param $def i32) (param $p i32) (param $len i32) (result i32)
    (local $i i32)
    (if (i32.ne (i32.load offset=$R.labelLen (local.get $def)) (local.get $len))
      (then (return (i32.const 0))))
    (local.set $def (i32.add (local.get $def) (i32.const $R.labelBytes)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (if (i32.ne
              (i32.load8_u (i32.add (local.get $def) (local.get $i)))
              (i32.load8_u (i32.add (local.get $p) (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; find the definition of $type for a normalized label, or 0
  (func $linkLookup
    (param $p i32) (param $len i32) (param $hash i32) (param $type i32) (result i32)
    (local $i i32)
    (local $slot i32)
    (if (i32.eqz (global.get $linkHash)) (then (return (i32.const 0))))
    (if (i32.eqz (local.get $len)) (then (return (i32.const 0))))
    (local.set $i (i32.and (local.get $hash) (global.get $linkMask)))
    (loop $probe
      (local.set $slot (i32.load
        (i32.add (global.get $linkHash) (i32.mul (local.get $i) (i32.const 4)))))
      (if (i32.eqz (local.get $slot)) (then (return (i32.const 0))))
      (if (i32.eq (i32.load8_u (local.get $slot)) (local.get $type))
        (then
          (if (call $defLabelEq (local.get $slot) (local.get $p) (local.get $len))
            (then (return (local.get $slot))))))
      (local.set $i (i32.and (i32.add (local.get $i) (i32.const 1)) (global.get $linkMask)))
      (br $probe))
    (i32.const 0))
)
