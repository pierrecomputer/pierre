(module
  (import "./mem.wat")
  (import "./tokenize.wat")
  (import "./myers.wat")

  (global $hunkBase (mut i32) (i32.const 0))

  ;; jsdiff structuredPatch grouping over $compArr + trailing empty sentinel.
  ;; 32-byte descriptors: oldStart, oldLines, newStart, newLines, startComp,
  ;; startOff, endComp, endOff. No token-cursor fields: 1-based line counters
  ;; ARE token cursors+1 (a line advances iff its side's token cursor does), so
  ;; a hunk's old/new cursors start at oldStart-1 / newStart-1.
  ;; Returns hunk count; alloc failure sets $err.
  (func $patchHunks (param $context i32) (result i32)
    (local $i i32) (local $n i32) (local $cf i32) (local $L i32) (local $prevL i32)
    (local $oldLine i32) (local $newLine i32)
    (local $rangeOpen i32) (local $oldRangeStart i32) (local $newRangeStart i32)
    (local $spanComp i32) (local $spanOff i32)
    (local $ctxN i32) (local $hb i32) (local $hc i32) (local $h i32)
    (local.set $n (global.get $compN))
    (local.set $hb (call $alloc (i32.shl (i32.add (local.get $n) (i32.const 1)) (i32.const 5))))
    (if (i32.eqz (local.get $hb)) (then (return (i32.const 0))))
    (global.set $hunkBase (local.get $hb))
    (local.set $oldLine (i32.const 1))
    (local.set $newLine (i32.const 1))
    (block $done (loop $each
      (br_if $done (i32.gt_s (local.get $i) (local.get $n)))
      ;; component $i, or 0 for the appended empty common sentinel at $i = $n
      (local.set $cf (i32.const 0))
      (if (i32.lt_s (local.get $i) (local.get $n))
        (then
          (local.set $cf
            (i32.load (i32.add (global.get $compArr) (i32.shl (local.get $i) (i32.const 2)))))))
      ;; shift/sign bit-30/31 tests encode smaller than 5-byte LEB masks
      (local.set $L (i32.shr_u (i32.shl (local.get $cf) (i32.const 2)) (i32.const 2)))
      ;; added or removed
      (if (i32.shr_u (local.get $cf) (i32.const 30))
        (then
          (if (i32.eqz (local.get $rangeOpen))
            (then ;; open a range, seeded with up to $context prior context lines
              (local.set $rangeOpen (i32.const 1))
              (local.set $ctxN (i32.const 0))
              (local.set $spanComp (local.get $i))
              (local.set $spanOff (i32.const 0))
              ;; start in previous component (always common, $prevL >= 1);
              ;; $ctxN=0 span head contributes 0 lines = start at $i
              (if (i32.gt_s (local.get $i) (i32.const 0))
                (then
                  (local.set $ctxN (select
                    (local.get $context)
                    (local.get $prevL)
                    (i32.lt_s (local.get $context) (local.get $prevL))))
                  (local.set $spanComp (i32.sub (local.get $i) (i32.const 1)))
                  (local.set $spanOff (i32.sub (local.get $prevL) (local.get $ctxN)))))
              (local.set $oldRangeStart (i32.sub (local.get $oldLine) (local.get $ctxN)))
              (local.set $newRangeStart (i32.sub (local.get $newLine) (local.get $ctxN)))))
          ;; bit 31: added
          (if (i32.lt_s (local.get $cf) (i32.const 0))
            (then (local.set $newLine (i32.add (local.get $newLine) (local.get $L))))
            (else (local.set $oldLine (i32.add (local.get $oldLine) (local.get $L))))))
        (else
          (if (local.get $rangeOpen)
            (then
              ;; a short interior common run keeps the hunk open (overlap)
              (if (i32.eqz (i32.and
                    (i32.le_s (local.get $L) (i32.shl (local.get $context) (i32.const 1)))
                    (i32.lt_s (local.get $i) (i32.sub (local.get $n) (i32.const 1)))))
                (then ;; close the hunk with up to $context trailing lines
                  (local.set $ctxN (select
                    (local.get $context)
                    (local.get $L)
                    (i32.lt_s (local.get $context) (local.get $L))))
                  (local.set $h
                    (i32.add (local.get $hb) (i32.shl (local.get $hc) (i32.const 5))))
                  (i32.store (local.get $h) (local.get $oldRangeStart))
                  (i32.store offset=4 (local.get $h) (i32.add
                    (i32.sub (local.get $oldLine) (local.get $oldRangeStart))
                    (local.get $ctxN)))
                  (i32.store offset=8 (local.get $h) (local.get $newRangeStart))
                  (i32.store offset=12 (local.get $h) (i32.add
                    (i32.sub (local.get $newLine) (local.get $newRangeStart))
                    (local.get $ctxN)))
                  (i32.store offset=16 (local.get $h) (local.get $spanComp))
                  (i32.store offset=20 (local.get $h) (local.get $spanOff))
                  (i32.store offset=24 (local.get $h) (local.get $i))
                  (i32.store offset=28 (local.get $h) (local.get $ctxN))
                  (local.set $hc (i32.add (local.get $hc) (i32.const 1)))
                  (local.set $rangeOpen (i32.const 0))))))
          (local.set $oldLine (i32.add (local.get $oldLine) (local.get $L)))
          (local.set $newLine (i32.add (local.get $newLine) (local.get $L)))))
      (local.set $prevL (local.get $L))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (local.get $hc)
  )

  ;; C-quote a filename like Git/GNU diffutils iff it has a non-printable, quote,
  ;; or `\`; else copy it raw
  (func $quoteName (param $p i32) (param $s i32) (param $len i32) (result i32)
    (local $i i32) (local $b i32) (local $need i32)
    (block $scanned (loop $scan
      (br_if $scanned (i32.ge_u (local.get $i) (local.get $len)))
      (local.set $b (i32.load8_u (i32.add (local.get $s) (local.get $i))))
      ;; (b - 0x20) >u 0x5E covers both b < 0x20 and b > 0x7E
      (if (i32.or
            (i32.gt_u (i32.sub (local.get $b) (i32.const 0x20)) (i32.const 0x5E))
            (i32.or
              (i32.eq (local.get $b) (i32.const 0x22))
              (i32.eq (local.get $b) (i32.const 0x5C))))
        (then
          (local.set $need (i32.const 1))
          (br $scanned)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $scan)))
    (if (i32.eqz (local.get $need))
      (then
        (memory.copy (local.get $p) (local.get $s) (local.get $len))
        (return (i32.add (local.get $p) (local.get $len)))))
    (i32.store8 (local.get $p) (i32.const 0x22))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (local.set $i (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
      (local.set $b (i32.load8_u (i32.add (local.get $s) (local.get $i))))
      (block $next
        (block $pair ;; lands with $b = the letter after the backslash
          (if (i32.le_u (i32.sub (local.get $b) (i32.const 0x07)) (i32.const 6))
            (then ;; \a \b \t \n \v \f \r
              (local.set $b (i32.load8_u
                (i32.add (i32.const 1076) (i32.sub (local.get $b) (i32.const 0x07)))))
              (br $pair)))
          (br_if $pair (i32.or
            (i32.eq (local.get $b) (i32.const 0x22))
            (i32.eq (local.get $b) (i32.const 0x5C))))
          (if (i32.le_u (i32.sub (local.get $b) (i32.const 0x20)) (i32.const 0x5E))
            (then
              (i32.store8 (local.get $p) (local.get $b))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $next)))
          ;; WTF-8 lone surrogate (ED A0..BF xx): quoted as U+FFFD, like jsdiff
          (if (i32.and
                (i32.eq (local.get $b) (i32.const 0xED))
                (i32.ge_u
                  (i32.load8_u offset=1 (i32.add (local.get $s) (local.get $i)))
                  (i32.const 0xA0)))
            (then
              (i64.store (local.get $p) (i64.const "\\357\\277"))
              (i32.store offset=8 (local.get $p) (i32.const "\\275"))
              (local.set $p (i32.add (local.get $p) (i32.const 12)))
              (local.set $i (i32.add (local.get $i) (i32.const 2)))
              (br $next)))
          ;; anything else (UTF-8 bytes, control chars): 3-digit octal escape
          (i32.store8 (local.get $p) (i32.const 0x5C))
          (i32.store8 offset=1 (local.get $p)
            (i32.add (i32.const 48) (i32.shr_u (local.get $b) (i32.const 6))))
          (i32.store8 offset=2 (local.get $p) (i32.add
            (i32.const 48)
            (i32.and (i32.shr_u (local.get $b) (i32.const 3)) (i32.const 7))))
          (i32.store8 offset=3 (local.get $p)
            (i32.add (i32.const 48) (i32.and (local.get $b) (i32.const 7))))
          (local.set $p (i32.add (local.get $p) (i32.const 4)))
          (br $next))
        (i32.store16 (local.get $p)
          (i32.or (i32.shl (local.get $b) (i32.const 8)) (i32.const 0x5C)))
        (local.set $p (i32.add (local.get $p) (i32.const 2))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store8 (local.get $p) (i32.const 0x22))
    (i32.add (local.get $p) (i32.const 1))
  )

  ;; one ---/+++ line: 4-byte $prefix, quoted name, optional \t<header>, newline
  (func $emitFileLine
    (param $p i32) (param $prefix i32) (param $name i32) (param $nameLen i32)
    (param $hdr i32) (param $hdrLen i32) (result i32)
    (i32.store (local.get $p) (local.get $prefix))
    (local.set $p (call $quoteName
      (i32.add (local.get $p) (i32.const 4)) (local.get $name) (local.get $nameLen)))
    (if (local.get $hdrLen)
      (then
        (i32.store8 (local.get $p) (i32.const 0x09))
        (memory.copy (i32.add (local.get $p) (i32.const 1)) (local.get $hdr) (local.get $hdrLen))
        (local.set $p (i32.add (i32.add (local.get $p) (i32.const 1)) (local.get $hdrLen)))))
    (i32.store8 (local.get $p) (i32.const 0x0A))
    (i32.add (local.get $p) (i32.const 1))
  )

  ;; jsdiff formatPatch headers: Index: iff both names defined and byte-equal;
  ;; === underline; ---/+++ with optional \t<header>. Which lines: flags at [2]
  ;; (layout in mem.wat).
  (func $emitHeaders (param $p i32) (result i32)
    (local $flags i32)
    (local $onPtr i32) (local $onLen i32) (local $nnPtr i32) (local $nnLen i32)
    (local $ohPtr i32) (local $ohLen i32) (local $nhPtr i32) (local $nhLen i32)
    (local.set $flags (i32.load8_u (i32.const 2)))
    (local.set $onLen (i32.load (i32.const 28)))
    (local.set $nnLen (i32.load (i32.const 32)))
    (local.set $ohLen (i32.load (i32.const 36)))
    (local.set $nhLen (i32.load (i32.const 40)))
    (local.set $onPtr (i32.add (global.get $newSrc) (i32.load (i32.const 8))))
    (local.set $nnPtr (i32.add (local.get $onPtr) (local.get $onLen)))
    (local.set $ohPtr (i32.add (local.get $nnPtr) (local.get $nnLen)))
    (local.set $nhPtr (i32.add (local.get $ohPtr) (local.get $ohLen)))
    ;; Index: <oldFileName> raw (jsdiff does too), when includeIndex (bit 0) and both
    ;; names defined (bits 3+4)
    (if (i32.eq (i32.and (local.get $flags) (i32.const 25)) (i32.const 25))
      (then
        (if (i32.and
              (i32.eq (local.get $onLen) (local.get $nnLen))
              (call $memcmp (local.get $onPtr) (local.get $nnPtr) (local.get $onLen)))
          (then
            ;; literal's 8th byte at $p+7, immediately overwritten by the name (or \n if empty)
            (i64.store (local.get $p) (i64.const "Index:  "))
            (memory.copy
              (i32.add (local.get $p) (i32.const 7)) (local.get $onPtr) (local.get $onLen))
            (local.set $p (i32.add (i32.add (local.get $p) (i32.const 7)) (local.get $onLen)))
            (i32.store8 (local.get $p) (i32.const 0x0A))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
    (if (i32.and (local.get $flags) (i32.const 2))
      (then
        (memory.fill (local.get $p) (i32.const 0x3D) (i32.const 67))
        (i32.store8 offset=67 (local.get $p) (i32.const 0x0A))
        (local.set $p (i32.add (local.get $p) (i32.const 68)))))
    ;; includeFileHeaders (bit 2) and both filenames defined (bits 3+4)
    (if (i32.eq (i32.and (local.get $flags) (i32.const 28)) (i32.const 28))
      (then
        (local.set $p (call $emitFileLine (local.get $p) (i32.const "--- ")
          (local.get $onPtr) (local.get $onLen) (local.get $ohPtr) (local.get $ohLen)))
        (local.set $p (call $emitFileLine (local.get $p) (i32.const "+++ ")
          (local.get $nnPtr) (local.get $nnLen) (local.get $nhPtr) (local.get $nhLen)))))
    (local.get $p)
  )

  ;; one +/-/space line for the token whose [start,end) byte offs sit at $offsAddr
  ;; (two adjacent u32s of an offset array) into $src
  (func $emitLine
    (param $p i32) (param $prefix i32) (param $src i32) (param $offsAddr i32) (result i32)
    (local $len i32) (local $end i32)
    (i32.store8 (local.get $p) (local.get $prefix))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (local.set $end (i32.load offset=4 (local.get $offsAddr)))
    (local.set $len (i32.sub (local.get $end) (i32.load (local.get $offsAddr))))
    (memory.copy
      (local.get $p)
      (i32.sub (i32.add (local.get $src) (local.get $end)) (local.get $len))
      (local.get $len))
    (local.set $p (i32.add (local.get $p) (local.get $len)))
    (if (i32.ne
          (i32.load8_u (i32.sub (i32.add (local.get $src) (local.get $end)) (i32.const 1)))
          (i32.const 0x0A))
      (then ;; the file's unterminated last line
        (memory.copy (local.get $p) (i32.const 1047) (i32.const 29))
        (local.set $p (i32.add (local.get $p) (i32.const 29)))))
    (local.get $p)
  )

  ;; "<start>,<lines>"; unified quirk: 0-length side reports start one lower
  (func $emitRange (param $p i32) (param $start i32) (param $lines i32) (result i32)
    (local.set $p (call $itoa (local.get $p)
      (i32.sub (local.get $start) (i32.eqz (local.get $lines)))))
    (i32.store8 (local.get $p) (i32.const 0x2C))
    (call $itoa (i32.add (local.get $p) (i32.const 1)) (local.get $lines))
  )

  ;; render every hunk as unified-diff text; [16:20)=pointer, [20:24)=length
  (func $emitPatch (param $context i32)
    (local $hc i32) (local $h i32) (local $out i32) (local $p i32)
    (local $bound i32) (local $endComp i32) (local $endOff i32)
    (local $oldTok i32) (local $newTok i32) (local $j i32) (local $cf i32) (local $L i32)
    (local $lineFrom i32) (local $lineTo i32)
    (local.set $hc (call $patchHunks (local.get $context)))
    (if (global.get $err) (then (return)))
    ;; worst case: every token once + per-line prefix + no-newline marker + headers
    ;; (quoted filename byte <=4x); text lengths from [4]/[8]
    (local.set $bound (i32.add
      (i32.add
        (i32.shl (i32.add (local.get $hc) (i32.const 4)) (i32.const 6))
        (i32.shl (i32.add (global.get $oldN) (global.get $newN)) (i32.const 5)))
      (i32.add (i32.load (i32.const 4)) (i32.load (i32.const 8)))))
    ;; each filename byte appears quoted (<= 4x) plus once raw in "Index:"
    (local.set $bound (i32.add (local.get $bound) (i32.add
      (i32.mul (i32.add (i32.load (i32.const 28)) (i32.load (i32.const 32))) (i32.const 5))
      (i32.add (i32.load (i32.const 36)) (i32.load (i32.const 40))))))
    (local.set $out (call $alloc (local.get $bound)))
    (if (i32.eqz (local.get $out)) (then (return)))
    (local.set $p (call $emitHeaders (local.get $out)))
    (local.set $h (global.get $hunkBase))
    ;; $hc is now the end
    (local.set $hc (i32.add (local.get $h) (i32.shl (local.get $hc) (i32.const 5))))
    (block $done (loop $hunks
      (br_if $done (i32.ge_u (local.get $h) (local.get $hc)))
      ;; "@@ -a,b +c,d @@\n" via multi-byte literal stores
      (i32.store (local.get $p) (i32.const "@@ -"))
      (local.set $p (call $emitRange
        (i32.add (local.get $p) (i32.const 4))
        (i32.load (local.get $h))
        (i32.load offset=4 (local.get $h))))
      (i32.store16 (local.get $p) (i32.const " +"))
      (local.set $p (call $emitRange
        (i32.add (local.get $p) (i32.const 2))
        (i32.load offset=8 (local.get $h))
        (i32.load offset=12 (local.get $h))))
      (i32.store (local.get $p) (i32.const " @@\n"))
      (local.set $p (i32.add (local.get $p) (i32.const 4)))

      (local.set $j (i32.load offset=16 (local.get $h)))
      ;; startOff; 0 after comp $j
      (local.set $lineFrom (i32.load offset=20 (local.get $h)))
      (local.set $endComp (i32.load offset=24 (local.get $h)))
      (local.set $endOff (i32.load offset=28 (local.get $h)))
      ;; the 1-based hunk starts double as the span-start token cursors
      (local.set $oldTok (i32.sub (i32.load (local.get $h)) (i32.const 1)))
      (local.set $newTok (i32.sub (i32.load offset=8 (local.get $h)) (i32.const 1)))
      (block $hunkDone (loop $comps
        ;; the sentinel contributes no lines
        (local.set $cf (i32.const 0))
        (if (i32.lt_s (local.get $j) (global.get $compN))
          (then
            (local.set $cf
              (i32.load (i32.add (global.get $compArr) (i32.shl (local.get $j) (i32.const 2)))))))
        (local.set $L (i32.shr_u (i32.shl (local.get $cf) (i32.const 2)) (i32.const 2)))
        (local.set $lineTo (select
          (local.get $endOff)
          (local.get $L)
          (i32.eq (local.get $j) (local.get $endComp))))
        (block $linesDone (loop $lines
          (br_if $linesDone (i32.ge_s (local.get $lineFrom) (local.get $lineTo)))
          ;; bit 30: removed
          (if (i32.lt_s (i32.shl (local.get $cf) (i32.const 1)) (i32.const 0))
            (then ;; removed line from the old text
              (local.set $p (call $emitLine
                (local.get $p)
                (i32.const 0x2D)
                (global.get $oldSrc)
                (i32.add (global.get $oldOffsB) (i32.shl (local.get $oldTok) (i32.const 2)))))
              (local.set $oldTok (i32.add (local.get $oldTok) (i32.const 1))))
            (else
              (local.set $p (call $emitLine
                (local.get $p)
                (select (i32.const 0x2B) (i32.const 0x20) (i32.lt_s (local.get $cf) (i32.const 0)))
                (global.get $newSrc)
                (i32.add (global.get $newOffsB) (i32.shl (local.get $newTok) (i32.const 2)))))
              (local.set $newTok (i32.add (local.get $newTok) (i32.const 1)))
              ;; a common (not added) line consumes an old token too
              (local.set $oldTok
                (i32.add (local.get $oldTok) (i32.ge_s (local.get $cf) (i32.const 0))))))
          (local.set $lineFrom (i32.add (local.get $lineFrom) (i32.const 1)))
          (br $lines)))
        (br_if $hunkDone (i32.eq (local.get $j) (local.get $endComp)))
        (local.set $lineFrom (i32.const 0))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $comps)))
      (local.set $h (i32.add (local.get $h) (i32.const 32)))
      (br $hunks)))
    ;; jsdiff joins lines with \n and appends one more, so a patch with no lines is "\n"
    (if (i32.eq (local.get $p) (local.get $out))
      (then
        (i32.store8 (local.get $p) (i32.const 0x0A))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (i32.store (i32.const 16) (local.get $out))
    (i32.store (i32.const 20) (i32.sub (local.get $p) (local.get $out)))
  )

  ;; entry: run the op at [0] over the inputs on page 1 (layout in mem.wat)
  (func (export "diff")
    (local $op i32) (local $oldLen i32) (local $newLen i32)
    (local $oldPtr i32) (local $newPtr i32) (local $newEnd i32)
    (local $strLen i32) (local $trim i32)
    (global.set $err (i32.const 0))
    (local.set $op (i32.load8_u (i32.const 0)))
    (local.set $oldLen (i32.load (i32.const 4)))
    (local.set $newLen (i32.load (i32.const 8)))
    (local.set $oldPtr (i32.const 65536))
    (local.set $newPtr (i32.add (local.get $oldPtr) (local.get $oldLen)))
    (local.set $newEnd (i32.add (local.get $newPtr) (local.get $newLen)))
    ;; op 3 carries the filename/header strings right after the new text
    (if (i32.eq (local.get $op) (i32.const 3))
      (then
        (local.set $strLen (i32.add
          (i32.add (i32.load (i32.const 28)) (i32.load (i32.const 32)))
          (i32.add (i32.load (i32.const 36)) (i32.load (i32.const 40)))))))
    (global.set $heap (i32.add (i32.add (local.get $newEnd) (local.get $strLen)) (i32.const 16)))
    (global.set $newSrc (local.get $newPtr))

    (block $abort
      ;; the byte cap keeps text and offset sizes in i32 (over-limit may leave $heap
      ;; garbage, but we abort); token-count tables check themselves ($internInit, $myers)
      (if (i32.or
            (i32.ge_u
              (i32.or (i32.or (local.get $oldLen) (local.get $newLen)) (local.get $strLen))
              (i32.const 0x10000000))
            (i32.eqz (call $ensure (global.get $heap))))
        (then
          (call $oom)
          (br $abort)))
      (if (i32.gt_u (i32.sub (local.get $op) (i32.const 1)) (i32.const 3))
        (then
          (call $error (i32.const 1037) (i32.const 10))
          (br $abort)))
      ;; every op tokenizes into an offset array (worst case one token per byte)
      (global.set $oldOffsB (call $alloc
        (i32.shl (i32.add (local.get $oldLen) (i32.const 2)) (i32.const 2))))
      (global.set $newOffsB (call $alloc
        (i32.shl (i32.add (local.get $newLen) (i32.const 2)) (i32.const 2))))
      (if (i32.eq (local.get $op) (i32.const 1))
        (then ;; chars: ids are the code points, no interning needed
          (global.set $oldIdsB (call $alloc
            (i32.shl (i32.add (local.get $oldLen) (i32.const 1)) (i32.const 2))))
          (global.set $newIdsB (call $alloc
            (i32.shl (i32.add (local.get $newLen) (i32.const 1)) (i32.const 2))))
          (br_if $abort (global.get $err))
          (global.set $oldN (call $tokenizeChars
            (local.get $oldPtr) (local.get $newPtr) (global.get $oldOffsB) (global.get $oldIdsB)))
          (global.set $newN (call $tokenizeChars
            (local.get $newPtr) (local.get $newEnd) (global.get $newOffsB) (global.get $newIdsB))))
        (else
          (br_if $abort (global.get $err))
          (if (i32.eq (local.get $op) (i32.const 2))
            (then
              (global.set $oldN (call $tokenizeWords
                (local.get $oldPtr) (local.get $newPtr) (global.get $oldOffsB)))
              (global.set $newN (call $tokenizeWords
                (local.get $newPtr) (local.get $newEnd) (global.get $newOffsB))))
            (else ;; ops 3 and 4 both diff line tokens
              (global.set $oldN (call $tokenizeLines
                (local.get $oldPtr) (local.get $newPtr) (global.get $oldOffsB)))
              (global.set $newN (call $tokenizeLines
                (local.get $newPtr) (local.get $newEnd) (global.get $newOffsB)))))
          ;; equal tokens get equal dense ids, so the diff loop compares one i32
          (br_if $abort (i32.eqz
            (call $internInit (i32.add (global.get $oldN) (global.get $newN)))))
          (global.set $oldIdsB (call $alloc (i32.shl (global.get $oldN) (i32.const 2))))
          (global.set $newIdsB (call $alloc (i32.shl (global.get $newN) (i32.const 2))))
          (br_if $abort (global.get $err))
          ;; [3] bit 2: ignoreWhitespace (the host sets it for line ops only)
          (local.set $trim (i32.and (i32.load8_u (i32.const 3)) (i32.const 4)))
          (call $internAll (local.get $oldPtr)
            (global.get $oldOffsB) (global.get $oldN) (global.get $oldIdsB) (local.get $trim))
          (call $internAll (local.get $newPtr)
            (global.get $newOffsB) (global.get $newN) (global.get $newIdsB) (local.get $trim))))

      ;; on error $myers returns 0 and $buildComps stores nothing that could
      ;; clobber the error words, so one err check covers both
      (call $buildComps (call $myers))
      (br_if $abort (global.get $err))
      (if (i32.eq (local.get $op) (i32.const 3))
        (then (call $emitPatch (i32.load (i32.const 24)))) ;; context line count
        (else (call $emitRecords)))
    )
    ;; success flag, written last: an OOM'd $newNode stores into [0:8) after $error ran
    (i32.store8 (i32.const 1) (i32.eqz (global.get $err)))
  )
)
