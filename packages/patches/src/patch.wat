(module
  (import "./mem.wat")
  (import "./tokenize.wat")
  (import "./myers.wat")

  ;; C-quote a filename like Git/GNU diffutils iff it has a non-printable, quote,
  ;; or `\`; else copy it raw. One pass writes the quoted form after $p; a name
  ;; that needed no escape is copied raw over it.
  (func $quoteName (param $p i32) (param $s i32) (param $len i32) (result i32)
    (local $i i32) (local $b i32) (local $q i32) (local $raw i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (local.set $raw (i32.const 1))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
      (local.set $b (i32.load8_u (i32.add (local.get $s) (local.get $i))))
      (block $next
        (block $pair ;; lands with $b = the letter after the backslash
          (if (i32.le_u (i32.sub (local.get $b) (i32.const 0x07)) (i32.const 6))
            (then ;; \a \b \t \n \v \f \r
              (local.set $b (i32.load8_u
                (i32.add (i32.const 1066) (i32.sub (local.get $b) (i32.const 0x07)))))
              (br $pair)))
          (br_if $pair (i32.or
            (i32.eq (local.get $b) (i32.const 0x22))
            (i32.eq (local.get $b) (i32.const 0x5C))))
          (if (i32.le_u (i32.sub (local.get $b) (i32.const 0x20)) (i32.const 0x5E))
            (then
              (i32.store8 (local.get $q) (local.get $b))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $next)))
          (local.set $raw (i32.const 0))
          ;; WTF-8 lone surrogate (ED A0..BF xx): quoted as U+FFFD, like jsdiff
          (if (i32.and
                (i32.eq (local.get $b) (i32.const 0xED))
                (i32.ge_u
                  (i32.load8_u offset=1 (i32.add (local.get $s) (local.get $i)))
                  (i32.const 0xA0)))
            (then
              (i64.store (local.get $q) (i64.const "\\357\\277"))
              (i32.store offset=8 (local.get $q) (i32.const "\\275"))
              (local.set $q (i32.add (local.get $q) (i32.const 12)))
              (local.set $i (i32.add (local.get $i) (i32.const 2)))
              (br $next)))
          ;; anything else (UTF-8 bytes, control chars): 3-digit octal escape
          (i32.store8 (local.get $q) (i32.const 0x5C))
          (i32.store8 offset=1 (local.get $q)
            (i32.add (i32.const 48) (i32.shr_u (local.get $b) (i32.const 6))))
          (i32.store8 offset=2 (local.get $q) (i32.add
            (i32.const 48)
            (i32.and (i32.shr_u (local.get $b) (i32.const 3)) (i32.const 7))))
          (i32.store8 offset=3 (local.get $q)
            (i32.add (i32.const 48) (i32.and (local.get $b) (i32.const 7))))
          (local.set $q (i32.add (local.get $q) (i32.const 4)))
          (br $next))
        (local.set $raw (i32.const 0))
        (i32.store16 (local.get $q)
          (i32.or (i32.shl (local.get $b) (i32.const 8)) (i32.const 0x5C)))
        (local.set $q (i32.add (local.get $q) (i32.const 2))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (if (local.get $raw)
      (then
        (memory.copy (local.get $p) (local.get $s) (local.get $len))
        (return (i32.add (local.get $p) (local.get $len)))))
    (i32.store8 (local.get $p) (i32.const 0x22))
    (i32.store8 (local.get $q) (i32.const 0x22))
    (i32.add (local.get $q) (i32.const 1))
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

  ;; "<start>,<lines>"; unified quirk: 0-length side reports start one lower
  (func $emitRange (param $p i32) (param $start i32) (param $lines i32) (result i32)
    (local.set $p (call $itoa (local.get $p)
      (i32.sub (local.get $start) (i32.eqz (local.get $lines)))))
    (i32.store8 (local.get $p) (i32.const 0x2C))
    (call $itoa (i32.add (local.get $p) (i32.const 1)) (local.get $lines))
  )

  ;; jsdiff structuredPatch + formatPatch over $compArr and a trailing empty common
  ;; sentinel. A change opens a hunk with up to $context lines of the previous
  ;; common run; a common run longer than 2*$context (or the last) closes it with
  ;; up to $context lines, and the hunk is written then. The 1-based line counters
  ;; are token cursors + 1 (a line advances iff its side's token does).
  ;; [16:20) = pointer, [20:24) = length.
  (func $emitPatch (param $context i32)
    (local $n i32) (local $i i32) (local $cf i32) (local $L i32) (local $prevL i32)
    (local $oldLine i32) (local $newLine i32) (local $open i32)
    (local $oldStart i32) (local $newStart i32) (local $spanComp i32) (local $spanOff i32)
    (local $ctxN i32) (local $out i32) (local $p i32)
    (local $j i32) (local $from i32) (local $to i32) (local $cj i32) (local $rm i32)
    (local $oldTok i32) (local $newTok i32) (local $offs i32) (local $src i32) (local $len i32)
    (local.set $n (global.get $compN))
    ;; worst case: every token once + per-line prefix + no-newline marker + hunk
    ;; headers (<= 64 bytes, <= one per component) + file headers (each filename
    ;; byte <= 4x quoted, plus once raw in "Index:"); text lengths from [4]/[8]
    (local.set $out (call $alloc (i32.add
      (i32.add
        (i32.add
          (i32.shl (i32.add (local.get $n) (i32.const 4)) (i32.const 6))
          (i32.shl (i32.add (global.get $oldN) (global.get $newN)) (i32.const 5)))
        (i32.add (i32.load (i32.const 4)) (i32.load (i32.const 8))))
      (i32.add
        (i32.mul (i32.add (i32.load (i32.const 28)) (i32.load (i32.const 32))) (i32.const 5))
        (i32.add (i32.load (i32.const 36)) (i32.load (i32.const 40)))))))
    (if (i32.eqz (local.get $out)) (then (return)))
    (local.set $p (call $emitHeaders (local.get $out)))
    (local.set $oldLine (i32.const 1))
    (local.set $newLine (i32.const 1))
    (block $done (loop $each
      (br_if $done (i32.gt_s (local.get $i) (local.get $n)))
      ;; component $i, or 0 for the sentinel at $i = $n
      (local.set $cf (i32.const 0))
      (if (i32.lt_s (local.get $i) (local.get $n))
        (then
          (local.set $cf
            (i32.load (i32.add (global.get $compArr) (i32.shl (local.get $i) (i32.const 2)))))))
      ;; shift/sign bit-30/31 tests encode smaller than 5-byte LEB masks
      (local.set $L (i32.shr_u (i32.shl (local.get $cf) (i32.const 2)) (i32.const 2)))
      (if (i32.shr_u (local.get $cf) (i32.const 30))
        (then ;; added or removed
          (if (i32.eqz (local.get $open))
            (then ;; the previous component is common; $prevL is 0 at $i = 0
              (local.set $open (i32.const 1))
              (local.set $ctxN (select
                (local.get $context)
                (local.get $prevL)
                (i32.lt_s (local.get $context) (local.get $prevL))))
              ;; -1 at $i = 0 reads as the empty sentinel below
              (local.set $spanComp (i32.sub (local.get $i) (i32.const 1)))
              (local.set $spanOff (i32.sub (local.get $prevL) (local.get $ctxN)))
              (local.set $oldStart (i32.sub (local.get $oldLine) (local.get $ctxN)))
              (local.set $newStart (i32.sub (local.get $newLine) (local.get $ctxN)))))
          ;; bit 31: added
          (if (i32.lt_s (local.get $cf) (i32.const 0))
            (then (local.set $newLine (i32.add (local.get $newLine) (local.get $L))))
            (else (local.set $oldLine (i32.add (local.get $oldLine) (local.get $L))))))
        (else
          ;; a short interior common run keeps the hunk open (overlap)
          (if (i32.and
                (local.get $open)
                (i32.eqz (i32.and
                  (i32.le_s (local.get $L) (i32.shl (local.get $context) (i32.const 1)))
                  (i32.lt_s (local.get $i) (i32.sub (local.get $n) (i32.const 1))))))
            (then ;; close the hunk with up to $context trailing lines and write it
              (local.set $open (i32.const 0))
              (local.set $ctxN (select
                (local.get $context)
                (local.get $L)
                (i32.lt_s (local.get $context) (local.get $L))))
              ;; "@@ -a,b +c,d @@\n" via multi-byte literal stores
              (i32.store (local.get $p) (i32.const "@@ -"))
              (local.set $p (call $emitRange
                (i32.add (local.get $p) (i32.const 4))
                (local.get $oldStart)
                (i32.add (i32.sub (local.get $oldLine) (local.get $oldStart)) (local.get $ctxN))))
              (i32.store16 (local.get $p) (i32.const " +"))
              (local.set $p (call $emitRange
                (i32.add (local.get $p) (i32.const 2))
                (local.get $newStart)
                (i32.add (i32.sub (local.get $newLine) (local.get $newStart)) (local.get $ctxN))))
              (i32.store (local.get $p) (i32.const " @@\n"))
              (local.set $p (i32.add (local.get $p) (i32.const 4)))
              ;; lines from $spanOff of $spanComp up to $ctxN of $i
              (local.set $j (local.get $spanComp))
              (local.set $from (local.get $spanOff))
              (local.set $oldTok (i32.sub (local.get $oldStart) (i32.const 1)))
              (local.set $newTok (i32.sub (local.get $newStart) (i32.const 1)))
              (block $hunkDone (loop $comps
                (local.set $cj (i32.const 0))
                (if (i32.lt_u (local.get $j) (local.get $n))
                  (then
                    (local.set $cj (i32.load
                      (i32.add (global.get $compArr) (i32.shl (local.get $j) (i32.const 2)))))))
                (local.set $to (select
                  (local.get $ctxN)
                  (i32.shr_u (i32.shl (local.get $cj) (i32.const 2)) (i32.const 2))
                  (i32.eq (local.get $j) (local.get $i))))
                ;; bit 30: removed, a line of the old text
                (local.set $rm (i32.lt_s (i32.shl (local.get $cj) (i32.const 1)) (i32.const 0)))
                (local.set $src (select (global.get $oldSrc) (global.get $newSrc) (local.get $rm)))
                (block $linesDone (loop $lines
                  (br_if $linesDone (i32.ge_s (local.get $from) (local.get $to)))
                  ;; token [start,end) offsets at $offs
                  (local.set $offs (select
                    (i32.add (global.get $oldOffsB) (i32.shl (local.get $oldTok) (i32.const 2)))
                    (i32.add (global.get $newOffsB) (i32.shl (local.get $newTok) (i32.const 2)))
                    (local.get $rm)))
                  (i32.store8 (local.get $p) (select
                    (i32.const 0x2D)
                    (select (i32.const 0x2B) (i32.const 0x20) (i32.lt_s (local.get $cj) (i32.const 0)))
                    (local.get $rm)))
                  (local.set $len (i32.sub
                    (i32.load offset=4 (local.get $offs))
                    (i32.load (local.get $offs))))
                  (memory.copy
                    (i32.add (local.get $p) (i32.const 1))
                    (i32.add (local.get $src) (i32.load (local.get $offs)))
                    (local.get $len))
                  (local.set $p (i32.add (i32.add (local.get $p) (i32.const 1)) (local.get $len)))
                  (if (i32.ne
                        (i32.load8_u (i32.sub
                          (i32.add (local.get $src) (i32.load offset=4 (local.get $offs)))
                          (i32.const 1)))
                        (i32.const 0x0A))
                    (then ;; the file's unterminated last line
                      (memory.copy (local.get $p) (i32.const 1037) (i32.const 29))
                      (local.set $p (i32.add (local.get $p) (i32.const 29)))))
                  ;; removed and common lines consume an old token, added and common a new one
                  (local.set $oldTok
                    (i32.add (local.get $oldTok) (i32.ge_s (local.get $cj) (i32.const 0))))
                  (local.set $newTok (i32.add (local.get $newTok) (i32.eqz (local.get $rm))))
                  (local.set $from (i32.add (local.get $from) (i32.const 1)))
                  (br $lines)))
                (br_if $hunkDone (i32.eq (local.get $j) (local.get $i)))
                (local.set $from (i32.const 0))
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (br $comps)))))
          (local.set $oldLine (i32.add (local.get $oldLine) (local.get $L)))
          (local.set $newLine (i32.add (local.get $newLine) (local.get $L)))))
      (local.set $prevL (local.get $L))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
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
    (global.set $heap (i32.add (i32.add (local.get $newEnd) (local.get $strLen)) (i32.const 32)))
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
          ;; equal tokens get equal ids, so the diff loop compares one i32
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
            (global.get $newOffsB) (global.get $newN) (global.get $newIdsB) (local.get $trim))
          (br_if $abort (global.get $err))))

      ;; on error $myers returns 0 and $buildComps stores nothing that could
      ;; clobber the error words, so one err check covers both
      (call $buildComps (call $myers))
      (br_if $abort (global.get $err))
      (if (i32.eq (local.get $op) (i32.const 3))
        (then (call $emitPatch (i32.load (i32.const 24)))) ;; context line count
        (else (call $emitRecords)))
    )
    ;; success flag
    (i32.store8 (i32.const 1) (i32.eqz (global.get $err)))
  )
)
