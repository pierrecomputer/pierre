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
  (global $defHead (mut i32) (i32.const 0))
  (global $defTail (mut i32) (i32.const 0))
  (global $defCount (mut i32) (i32.const 0))
  (global $fnOrder (mut i32) (i32.const 0)) ;; definitions in order of first reference
  (global $fnTotal (mut i32) (i32.const 0))
  (global $fnUsed (mut i32) (i32.const 0))

  ;; The FNV-1a offset basis of label hashes. The host sets a random one so
  ;; crafted labels cannot be made to share a slot of the reference table.
  (global $hashSeed (mut i32) (i32.const 0x811c9dc5))
  (func (export "seed") (param $seed i32)
    (global.set $hashSeed (local.get $seed)))

  ;; The last of $n sorted u32 fold entries at $at whose low 17 bits are at
  ;; most $cp, or the entry before $at when there is none.
  (func $foldFind (param $at i32) (param $n i32) (param $cp i32) (result i32)
    (local $lo i32)
    (local $mid i32)
    (block $done
      (loop $search
        (br_if $done (i32.ge_u (local.get $lo) (local.get $n)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $n)) (i32.const 1)))
        ;; entry key <= $cp
        (if (i32.ge_u (local.get $cp) (i32.and (i32.const 0x1ffff)
              (i32.load (i32.add (local.get $at) (i32.shl (local.get $mid) (i32.const 2))))))
          (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
          (else (local.set $n (local.get $mid))))
        (br $search)))
    (i32.add (local.get $at) (i32.shl (i32.sub (local.get $lo) (i32.const 1)) (i32.const 2))))

  ;; Case fold [$src,$end), trim it, and collapse internal whitespace runs to a
  ;; single space. A $prefix of 1 goes first in a footnote label, which keeps
  ;; most of them apart from link labels in the reference table.
  ;; Returns hash in the high word and normalized length in the low word.
  (func $normalizeLabel
    (param $src i32) (param $end i32) (param $dst i32) (param $prefix i32) (result i64)
    (local $p i32)
    (local $out i32)
    (local $c i32)
    (local $space i32)
    (local $h i32)
    (local $cp i32)
    (local $n i32)
    (local $at i32)
    (local $range i32)
    (local $packed i32)
    (local $header i32)
    (local.set $p (local.get $src))
    (local.set $out (local.get $dst))
    (if (local.get $prefix)
      (then
        (i32.store8 (local.get $out) (local.get $prefix))
        (local.set $out (i32.add (local.get $out) (i32.const 1)))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (call $isWhiteByte (local.get $c))
          (then
            (local.set $space (i32.const 1))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if (i32.and (local.get $space)
              (i32.gt_u (local.get $out) (i32.add (local.get $dst) (local.get $prefix))))
          (then
            (i32.store8 (local.get $out) (i32.const 32))
            (local.set $out (i32.add (local.get $out) (i32.const 1)))))
        (local.set $space (i32.const 0))
        (if (i32.lt_u (i32.sub (local.get $c) (i32.const 1)) (i32.const 0x7f))
          (then
            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
              (then (local.set $c (i32.add (local.get $c) (i32.const 32)))))
            (i32.store8 (local.get $out) (local.get $c))
            (local.set $out (i32.add (local.get $out) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        ;; NUL and ill-formed bytes become U+FFFD, so the output is at most
        ;; three times the input (the fold of U+0390 is six bytes).
        (local.set $cp (call $utf8At (local.get $p) (local.get $end)))
        (local.set $p (global.get $utf8Next))
        ;; Most non-ASCII folds map to one code point: find the run that may
        ;; hold $cp. Runs start at U+0041, so one always precedes it. A run is
        ;; start:17, span:8, and the index of its delta:24 and stride:8.
        (local.set $header (i32.load (i32.const $mem.fold)))
        (local.set $at (call $foldFind (i32.const $mem.fold+8)
          (i32.and (local.get $header) (i32.const 0xffff)) (local.get $cp)))
        (local.set $range (i32.load (local.get $at)))
        (local.set $n (i32.sub (local.get $cp) (i32.and (local.get $range) (i32.const 0x1ffff))))
        (local.set $packed (i32.load (i32.add (i32.load16_u (i32.const $mem.fold+4))
          (i32.shl (i32.shr_u (local.get $range) (i32.const 25)) (i32.const 2)))))
        (if (i32.and
              (i32.le_u (local.get $n)
                (i32.and (i32.shr_u (local.get $range) (i32.const 17)) (i32.const 0xff)))
              (i32.eqz (i32.and (local.get $n)
                (i32.sub (i32.shr_u (local.get $packed) (i32.const 24)) (i32.const 1)))))
          (then (local.set $cp (i32.add (local.get $cp)
            (i32.shr_s (i32.shl (local.get $packed) (i32.const 8)) (i32.const 8)))))
          (else
            ;; The remaining folds expand to multiple code points: code
            ;; point:17, then the offset:9 and length:3 of their UTF-8 text.
            (local.set $range (i32.load (call $foldFind
              (i32.add (i32.const $mem.fold+8)
                (i32.shl (i32.and (local.get $header) (i32.const 0xffff)) (i32.const 2)))
              (i32.shr_u (local.get $header) (i32.const 16)) (local.get $cp))))
            (if (i32.eq (i32.and (local.get $range) (i32.const 0x1ffff)) (local.get $cp))
              (then
                (local.set $n (i32.shr_u (local.get $range) (i32.const 26)))
                (memory.copy (local.get $out)
                  (i32.add (i32.load16_u (i32.const $mem.fold+6))
                    (i32.and (i32.shr_u (local.get $range) (i32.const 17)) (i32.const 0x1ff)))
                  (local.get $n))
                (local.set $out (i32.add (local.get $out) (local.get $n)))
                (br $l)))))
        (local.set $out (i32.add (local.get $out) (call $utf8Encode (local.get $out) (local.get $cp))))
        (br $l)))
    ;; FNV-1a over the normalized bytes
    (local.set $h (global.get $hashSeed))
    (local.set $p (local.get $dst))
    (block $hashed
      (loop $hash
        (br_if $hashed (i32.ge_u (local.get $p) (local.get $out)))
        (local.set $h (i32.mul
          (i32.xor (local.get $h) (i32.load8_u (local.get $p)))
          (i32.const 16777619)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $hash)))
    (i64.or
      (i64.extend_i32_u (i32.sub (local.get $out) (local.get $dst)))
      (i64.shl (i64.extend_i32_u (local.get $h)) (i64.const 32))))

  ;; A link label starting at `[`; returns the position past `]`, or 0. The
  ;; label holds at most 999 characters, counted as a UTF-8 decoder would.
  (func $scanLinkLabel (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $n i32)
    (if (i32.ge_u (local.get $p) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "[")) (then (return (i32.const 0))))
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.eq (local.get $c) (i32.const "[")) (then (return (i32.const 0))))
        (br_if $done (i32.eq (local.get $c) (i32.const "]")))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "\5c"))
          (then
            (if (i32.and (i32.lt_u (local.get $q) (local.get $end))
                  (call $isAsciiPunct (i32.load8_u (local.get $q))))
              (then
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (local.set $n (i32.add (local.get $n) (i32.const 1))))))
          (else
            (if (i32.ge_u (local.get $c) (i32.const 0x80))
              (then
                (drop (call $utf8At (i32.sub (local.get $q) (i32.const 1)) (local.get $end)))
                (local.set $q (global.get $utf8Next))))))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (if (i32.gt_u (local.get $n) (i32.const 999)) (then (return (i32.const 0))))
        (br $l)))
    (i32.add (local.get $q) (i32.const 1)))

  ;; Set when a destination scan failed only because the input ended. Completion
  ;; clears and reads this.
  (global $linkDestAtEnd (mut i32) (i32.const 0))

  ;; a link destination; returns the position after it, or -1
  (func $scanLinkDest (param $p i32) (param $end i32) (result i32)
    (local $i i32)
    (local $c i32)
    (local $depth i32)
    (local $w v128)
    (block $fail
      (br_if $fail (i32.ge_u (local.get $p) (local.get $end)))
      (local.set $i (local.get $p))
      (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
        (then
          ;; `<...>`: no line ending or unescaped `<`; `\` skips the next byte
          (loop $l
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (if (i32.ge_u (local.get $i) (local.get $end))
              (then
                (global.set $linkDestAtEnd (i32.const 1))
                (br $fail)))
            (local.set $c (i32.load8_u (local.get $i)))
            (if (i32.eq (local.get $c) (i32.const "\5c"))
              (then
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $l)))
            (br_if $fail
              (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const "<"))))
            (br_if $l (i32.ne (local.get $c) (i32.const ">"))))
          (return (i32.add (local.get $i) (i32.const 1)))))
      (block $done
        (loop $l
          ;; Most bytes are past `)` and are neither `\` nor DEL: skip 16 of
          ;; them at a time. Bytes past $end may stop the skip, never extend it.
          (loop $wide
            (local.set $w (v128.load (local.get $i)))
            (if (i32.eqz (v128.any_true (v128.or
                  (i8x16.le_u (local.get $w) (i8x16.splat (i32.const ")")))
                  (v128.or
                    (i8x16.eq (local.get $w) (i8x16.splat (i32.const "\5c")))
                    (i8x16.eq (local.get $w) (i8x16.splat (i32.const 127)))))))
              (then
                (local.set $i (i32.add (local.get $i) (i32.const 16)))
                (br_if $wide (i32.lt_u (local.get $i) (local.get $end)))
                (local.set $i (local.get $end)))))
          (br_if $done (i32.ge_u (local.get $i) (local.get $end)))
          (local.set $c (i32.load8_u (local.get $i)))
          (if (i32.and (i32.gt_u (local.get $c) (i32.const ")"))
                (i32.and (i32.ne (local.get $c) (i32.const "\5c")) (i32.ne (local.get $c) (i32.const 127))))
            (then
              (local.set $i (i32.add (local.get $i) (i32.const 1)))
              (br $l)))
          (if (i32.eq (local.get $c) (i32.const "\5c"))
            (then
              ;; an escaped punctuation character
              (local.set $i (i32.add (local.get $i) (i32.and
                (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $end))
                (call $isAsciiPunct (i32.load8_u offset=1 (local.get $i)))))))
            (else
              (if (i32.eq (local.get $c) (i32.const "("))
                (then
                  (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                  (br_if $fail (i32.gt_u (local.get $depth) (i32.const 32))))
                (else
                  (if (i32.eq (local.get $c) (i32.const ")"))
                    (then
                      (br_if $done (i32.eqz (local.get $depth)))
                      (local.set $depth (i32.sub (local.get $depth) (i32.const 1))))
                    ;; ASCII controls and space end it; NUL stands for U+FFFD
                    (else (if (i32.or (i32.lt_u (i32.sub (local.get $c) (i32.const 1)) (i32.const 32))
                          (i32.eq (local.get $c) (i32.const 127)))
                      (then
                        (br_if $fail (i32.eq (local.get $i) (local.get $p)))
                        (br $done)))))))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $l)))
      (if (local.get $depth)
        (then
          (global.set $linkDestAtEnd (i32.ge_u (local.get $i) (local.get $end)))
          (br $fail)))
      (return (local.get $i)))
    (i32.const -1))

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

  ;; skip spaces and tabs, at most one line ending, then spaces and tabs again
  (func $skipLineSpace (param $p i32) (param $end i32) (result i32)
    (local.set $p (call $skipSpace (local.get $p) (local.get $end)))
    (if (i32.and (i32.lt_u (local.get $p) (local.get $end))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 10)))
      (then (local.set $p (call $skipSpace
        (i32.add (local.get $p) (i32.const 1)) (local.get $end)))))
    (local.get $p))

  ;; Parse link reference definitions off the front of a paragraph and drop the
  ;; text they consumed. Definitions may span lines, so this works on the
  ;; paragraph's contiguous content buffer.
  (func $resolveLinkDefs (param $r i32)
    (local $len i32)
    (local $off i32)
    (local $line i32)
    (local $blank i32)
    (local $base i32)
    (local $end i32)
    (local $pos i32)
    (local $q i32)
    (local $t i32)
    (local $labelOff i32)
    (local $labelLen i32)
    (local $destOff i32)
    (local $destLen i32)
    (local $titleOff i32)
    (local $titleLen i32)
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
    ;; Every paragraph comes here: only a first line that starts with `[` can
    ;; hold a definition. Paragraph lines never carry tab padding.
    (if (i32.eqz (i32.load offset=$R.nLines (local.get $r))) (then (return)))
    (local.set $line (call $lineAt (local.get $r) (i32.const 0)))
    (if (i32.ne (i32.load8_u (call $lineBeg (local.get $line))) (i32.const "["))
      (then (return)))
    ;; A label closed on the first line must be followed by `:`. Rejecting
    ;; `[text](...)` here avoids rebuilding the paragraph content.
    (local.set $end (call $lineEndOf (local.get $line)))
    (local.set $pos (call $scanLinkLabel (call $lineBeg (local.get $line)) (local.get $end)))
    (if (i32.and (i32.ne (local.get $pos) (i32.const 0))
          (i32.or (i32.ge_u (local.get $pos) (local.get $end))
            (i32.ne (i32.load8_u (local.get $pos)) (i32.const ":"))))
      (then (return)))
    (local.set $len (call $blockContent (local.get $r)))
    ;; Parse one definition per iteration; the first failure ends the scan.
    (loop $defs
      (local.set $base (call $contentAt (i32.const 0)))
      (local.set $end (i32.add (local.get $base) (local.get $len)))
      (local.set $pos (call $scanLinkLabel
        (i32.add (local.get $base) (local.get $off)) (local.get $end)))
      (if (local.get $pos)
        (then
          (local.set $labelOff (i32.add (local.get $off) (i32.const 1)))
          (local.set $labelLen (i32.sub
            (i32.sub (local.get $pos) (i32.add (local.get $base) (local.get $off)))
            (i32.const 2)))
          (block $parsed
            (br_if $parsed (i32.ge_u
              (call $skipWs (i32.add (local.get $base) (local.get $labelOff))
                (i32.sub (local.get $pos) (i32.const 1)))
              (i32.sub (local.get $pos) (i32.const 1))))
            (br_if $parsed (i32.ge_u (local.get $pos) (local.get $end)))
            (br_if $parsed (i32.ne (i32.load8_u (local.get $pos)) (i32.const ":")))
            (local.set $pos (call $skipLineSpace
              (i32.add (local.get $pos) (i32.const 1)) (local.get $end)))
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
            ;; An optional title ends at $t. Only spaces may follow on its line;
            ;; otherwise the title is dropped and the destination must end it.
            (local.set $titleLen (i32.const 0))
            (local.set $t (local.get $q))
            (local.set $pos (call $skipLineSpace (local.get $q) (local.get $end)))
            (if (i32.ne (local.get $pos) (local.get $q))
              (then
                (local.set $t (call $scanLinkTitle (local.get $pos) (local.get $end)))
                (if (local.get $t)
                  (then
                    (local.set $titleOff (i32.add
                      (i32.sub (local.get $pos) (local.get $base)) (i32.const 1)))
                    (local.set $titleLen (i32.sub
                      (i32.sub (local.get $t) (local.get $pos)) (i32.const 2))))
                  (else (local.set $t (local.get $q))))))
            (loop $eol
              (local.set $pos (call $skipSpace (local.get $t) (local.get $end)))
              (if (i32.and (i32.lt_u (local.get $pos) (local.get $end))
                    (i32.ne (i32.load8_u (local.get $pos)) (i32.const 10)))
                (then
                  (br_if $parsed (i32.eq (local.get $t) (local.get $q)))
                  (local.set $t (local.get $q))
                  (local.set $titleLen (i32.const 0))
                  (br $eol))))
            (local.set $n (i32.sub
              (i32.add (local.get $pos) (i32.lt_u (local.get $pos) (local.get $end)))
              (i32.add (local.get $base) (local.get $off))))
            ;; Reserving first means the scratch can move safely.
            (call $ensureRec (i32.add (i32.const 64) (i32.add
              (i32.mul (local.get $labelLen) (i32.const 3))
              (i32.add (local.get $destLen) (local.get $titleLen)))))
            (local.set $base (call $contentAt (i32.const 0)))
            (local.set $def (call $recNew (enum.get $Blk.linkdef)))
            (call $noteDefinition (local.get $def))
            (local.set $dst (i32.add (local.get $def) (i32.const $R.labelBytes)))
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
            (local.set $off (i32.add (local.get $off) (local.get $n)))
            (br $defs)))))
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
            (local.set $lineLen (i32.sub
              (call $lineEndOf (local.get $trimLine))
              (call $lineBeg (local.get $trimLine))))
            (if (i32.le_u (local.get $off)
                  (i32.add (local.get $acc) (local.get $lineLen)))
              (then
                (i32.store (local.get $trimLine)
                  (i32.add (call $lineBeg (local.get $trimLine))
                    (i32.sub (local.get $off) (local.get $acc))))
                (br $trimmed)))
            (local.set $acc
              (i32.add
                (i32.add (local.get $acc) (local.get $lineLen)) (i32.const 1)))
            (local.set $lineIndex (i32.add (local.get $lineIndex) (i32.const 1)))
            (br $trimLines)))
        (local.set $lineCount (i32.sub (local.get $lineCount) (local.get $lineIndex)))
        (memory.copy
          (call $lineAt (local.get $r) (i32.const 0))
          (call $lineAt (local.get $r) (local.get $lineIndex))
          (i32.mul (local.get $lineCount) (i32.const $R.line)))
        ;; a paragraph made of nothing but definitions leaves no content
        (i32.store offset=$R.nLines (local.get $r)
          (select (i32.const 0) (local.get $lineCount) (local.get $blank))))))

  ;; Link definitions as they are appended so indexing need not walk unrelated
  ;; blocks twice. Record addresses do not move when scratch or memory grows.
  (func $noteDefinition (param $r i32)
    (if (global.get $defTail)
      (then (i32.store offset=$R.defNext (global.get $defTail) (local.get $r)))
      (else (global.set $defHead (local.get $r))))
    (global.set $defTail (local.get $r))
    (global.set $defCount (i32.add (global.get $defCount) (i32.const 1))))

  ;; Build the open-addressed table from the source-ordered definition chain.
  ;; The table lives at the end of the record region; first definitions win.
  (func $linkIndex
    (local $r i32)
    (local $slots i32)
    (local $table i32)
    (local $slot i32)
    (global.set $recEnd (global.get $rec))
    (if (i32.eqz (global.get $defCount)) (then (return)))
    (local.set $slots (i32.const 16))
    (block $sized
      (loop $l
        (br_if $sized (i32.ge_u (local.get $slots) (i32.mul (global.get $defCount) (i32.const 2))))
        (local.set $slots (i32.shl (local.get $slots) (i32.const 1)))
        (br $l)))
    (call $ensureRec (i32.add (i32.mul (local.get $slots) (i32.const 4)) (i32.const 16)))
    (local.set $table (i32.and (i32.add (global.get $rec) (i32.const 7)) (i32.const -8)))
    (memory.fill (local.get $table) (i32.const 0) (i32.mul (local.get $slots) (i32.const 4)))
    (global.set $linkHash (local.get $table))
    (global.set $linkMask (i32.sub (local.get $slots) (i32.const 1)))
    (local.set $r (global.get $defHead))
    (block $filled
      (loop $l
        (br_if $filled (i32.eqz (local.get $r)))
        ;; the first definition of a type wins
        (local.set $slot (call $linkSlot
          (i32.add (local.get $r) (i32.const $R.labelBytes))
          (i32.load offset=$R.labelLen (local.get $r))
          (i32.load offset=$R.hash (local.get $r))
          (i32.load8_u (local.get $r))))
        (if (i32.eqz (i32.load (local.get $slot)))
          (then (i32.store (local.get $slot) (local.get $r))))
        (local.set $r (i32.load offset=$R.defNext (local.get $r)))
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

  ;; The table entry for a normalized label of $type: the entry holding its
  ;; first definition, or the empty entry where that would go. Footnote labels
  ;; carry a 0x01 prefix, which a link label can also start with.
  (func $linkSlot (param $p i32) (param $len i32) (param $hash i32) (param $type i32) (result i32)
    (local $i i32)
    (local $at i32)
    (local $slot i32)
    ;; the high bits of a multiplicative mix pick the first entry
    (local.set $i (i32.shr_u (i32.mul (local.get $hash) (i32.const 0x9e3779b1))
      (i32.clz (global.get $linkMask))))
    (block $found
      (loop $probe
        (local.set $at (i32.add (global.get $linkHash) (i32.shl (local.get $i) (i32.const 2))))
        (local.set $slot (i32.load (local.get $at)))
        (br_if $found (i32.eqz (local.get $slot)))
        (br_if $found (i32.and (i32.eq (i32.load8_u (local.get $slot)) (local.get $type))
          (call $defLabelEq (local.get $slot) (local.get $p) (local.get $len))))
        (local.set $i (i32.and (i32.add (local.get $i) (i32.const 1)) (global.get $linkMask)))
        (br $probe)))
    (local.get $at))
)
