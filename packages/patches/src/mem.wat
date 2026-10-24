(module
  (;;
    memory
    [] page 1         (control + static data)
      [0]             op (u8): 1 = diffChars, 2 = diffWordsWithSpace,
                      3 = unified-patch hunks (line tokens), 4 = diffLines
      [1]             output flag (u8): 0 = error, 1 = success
      [2]             patch header flags (op 3 input): includeIndex, includeUnderline,
                      includeFileHeaders, oldFileName/newFileName defined
      [3]             input flags: bit 0/1 old/new text is pure ASCII (op 1/2/4),
                      bit 2 ignoreWhitespace (op 3/4)
      [4:8)           old text length (u32 LE)
      [8:12)          new text length (u32 LE)
      [12:16)         change-record count (op 1/2/4) / error message length
      [16:20)         result pointer: change records, patch text, or error message
      [20:24)         patch text length (op 3)
      [24:28)         context line count (op 3 input)
      [28:44)         filename/header byte lengths (4 × u32, op 3 input)
      [64:192)        ASCII word/space class table for the word tokenizer
      [1016:1024)     $hashToken multiplier (u64 LE, odd); the host sets a random
                      one per instance so crafted tokens cannot force collisions
      [1024:1073)     static strings, packed gap-free (error message, the
                      no-newline marker, C escape letters)
      [1073:1083)     $itoa digit scratch
    [] page 2..N      (text buffer)
      [65536:oldEnd)  old text (WTF-8)
      [oldEnd:newEnd) new text
      [newEnd:EOF)    op 3: oldFileName, newFileName, oldHeader, newHeader
      [EOF:EOF+32)    pad so SIMD scans (<= 32 bytes) may overread safely
      [EOF+32:...)    bump-allocated workspace
  ;;)
  (memory (export "memory") 2)

  (global $err    (mut i32) (i32.const 0))
  (global $heap   (mut i32) (i32.const 0))
  ;; addressable bytes as of the last $ensure; may lag a host grow (only costs a slow path).
  ;; Warning: 4 GiB wraps to 0, so every $alloc then takes the (still correct) slow path.
  (global $memEnd (mut i32) (i32.const 0))

  ;; page-1 statics, one gap-free segment so one copy of the framing ships (layout above)
  (data (i32.const 1016)
    "\15\7c\4a\7f\b9\79\37\9e"         ;; 1016: 0x9E3779B97F4A7C15
    "out of memory"                    ;; 1024, len 13
    "\n\\ No newline at end of file\n" ;; 1037, len 29
    "abtnvfr")                         ;; 1066: C escape letters for bytes 07..0D

  ;; the only error: [12:16)=message length, [16:20)=message pointer; the driver
  ;; writes ok=0 at exit
  (func $oom
    (global.set $err (i32.const 1))
    (i32.store (i32.const 12) (i32.const 13))
    (i32.store (i32.const 16) (i32.const 1024))
  )

  ;; grow until [0, $end) is addressable; 1=ok, 0=cannot grow
  (func $ensure (param $end i32) (result i32)
    (local $delta i32)
    ;; missing pages; sizes stay << 2^31 so signed <= is safe
    (local.set $delta (i32.sub
      (i32.add (i32.shr_u (i32.sub (local.get $end) (i32.const 1)) (i32.const 16)) (i32.const 1))
      (memory.size)))
    (if (i32.gt_s (local.get $delta) (i32.const 0))
      (then
        ;; +25% slack so small allocs don't grow a page at a time
        (if (i32.eq
              (memory.grow (i32.add (local.get $delta) (i32.shr_u (memory.size) (i32.const 2))))
              (i32.const -1))
          (then
            (if (i32.eq (memory.grow (local.get $delta)) (i32.const -1))
              (then (return (i32.const 0))))))))
    (global.set $memEnd (i32.shl (memory.size) (i32.const 16)))
    (i32.const 1)
  )

  ;; bump $size bytes, 8-aligned; 0 = OOM ($err set)
  (func $alloc (param $size i32) (result i32)
    (local $base i32) (local $end i32)
    (local.set $base (i32.and (i32.add (global.get $heap) (i32.const 7)) (i32.const -8)))
    (local.set $end (i32.add (local.get $base) (local.get $size)))
    ;; two separate ifs: merging (i32.or / shared-oom) costs ~7-10% on every bench
    ;; via binaryen inlining this into the Myers component allocator
    (if (i32.lt_u (local.get $end) (local.get $base))
      (then
        (call $oom)
        (return (i32.const 0))))
    ;; fast path: one compare against the cached size instead of $ensure's memory.size math
    (if (i32.gt_u (local.get $end) (global.get $memEnd))
      (then
        (if (i32.eqz (call $ensure (local.get $end)))
          (then
            (call $oom)
            (return (i32.const 0))))))
    (global.set $heap (local.get $end))
    (local.get $base)
  )

  ;; write unsigned $n as decimal at $ptr; returns end. Digits build backwards in
  ;; [1073:1083) (10 bytes fit any u32) then one memory.copy — smaller than a count loop.
  (func $itoa (param $ptr i32) (param $n i32) (result i32)
    (local $p i32)
    (local.set $p (i32.const 1083))
    (loop $write
      (local.set $p (i32.sub (local.get $p) (i32.const 1)))
      (i32.store8 (local.get $p) (i32.add (i32.const 48) (i32.rem_u (local.get $n) (i32.const 10))))
      (local.set $n (i32.div_u (local.get $n) (i32.const 10)))
      (br_if $write (local.get $n)))
    (memory.copy (local.get $ptr) (local.get $p) (i32.sub (i32.const 1083) (local.get $p)))
    (i32.add (local.get $ptr) (i32.sub (i32.const 1083) (local.get $p)))
  )

  ;; 1 if [$a,$a+$len)==[$b,$b+$len). 8 bytes/step; last chunk re-reads the last 8 so
  ;; nothing past either range is read. Sub-8: masked i64 load per side; <=7-byte
  ;; overread stays in the string-area pad (token/filename callers). $len=0 only when
  ;; $a==$b (equal-length filenames, adjacent), so any mask still answers 1.
  (func $memcmp (param $a i32) (param $b i32) (param $len i32) (result i32)
    (local $end i32)
    (if (i32.lt_u (local.get $len) (i32.const 8))
      (then
        (return (i64.eqz (i64.and
          (i64.xor (i64.load (local.get $a)) (i64.load (local.get $b)))
          (i64.shr_u
            (i64.const -1)
            (i64.extend_i32_u
              (i32.shl (i32.sub (i32.const 8) (local.get $len)) (i32.const 3)))))))))
    (local.set $end (i32.sub (i32.add (local.get $a) (local.get $len)) (i32.const 8)))
    (block $ne (loop $words
      (br_if $ne (i64.ne (i64.load (local.get $a)) (i64.load (local.get $b))))
      (local.set $a (i32.add (local.get $a) (i32.const 8)))
      (local.set $b (i32.add (local.get $b) (i32.const 8)))
      (if (i32.ge_u (local.get $a) (local.get $end))
        (then
          (return (i64.eq
            (i64.load (local.get $end))
            (i64.load (i32.add (local.get $b) (i32.sub (local.get $end) (local.get $a))))))))
      (br $words)))
    (i32.const 0)
  )

  ;; multiply-mix hash of $len bytes at $ptr, 8 bytes/step + one masked i64 tail.
  ;; Tail may overread <=7 bytes (string-area pad); the mask drops them. Equal bytes
  ;; hash equal; the value never affects output (intern confirms with len+$memcmp).
  (func $hashToken (param $ptr i32) (param $len i32) (result i32)
    (local $h i64) (local $g i64) (local $t i64) (local $k i64) (local $tail i32) (local $x i32)
    (local.set $h (i64.extend_i32_u (local.get $len)))
    ;; a load, not a const: JITs then keep it in a register across the loop
    ;; instead of rebuilding it per chunk
    (local.set $k (i64.load (i32.const 1016)))
    ;; $tail = start of the final 1..8-byte piece ($len is never 0 here)
    (local.set $tail (i32.add
      (local.get $ptr)
      (i32.and (i32.sub (local.get $len) (i32.const 1)) (i32.const -8))))
    (block $chunked (loop $chunks
      (br_if $chunked (i32.ge_u (local.get $ptr) (local.get $tail)))
      ;; rotate so the multiply's high (well-mixed) bits feed the next chunk. Two
      ;; accumulators take turns, so consecutive multiplies overlap.
      (local.set $t (i64.rotr
        (i64.mul (i64.xor (local.get $h) (i64.load (local.get $ptr))) (local.get $k))
        (i64.const 32)))
      (local.set $h (local.get $g))
      (local.set $g (local.get $t))
      (local.set $ptr (i32.add (local.get $ptr) (i32.const 8)))
      (br $chunks)))
    ;; final piece: (-1 >> 8*(-len & 7)) keeps exactly the remaining bytes
    (local.set $h (i64.xor
      (i64.mul
        (i64.xor
          (local.get $h)
          (i64.and
            (i64.load (local.get $tail))
            (i64.shr_u
              (i64.const -1)
              (i64.extend_i32_u (i32.shl
                (i32.and (i32.sub (i32.const 0) (local.get $len)) (i32.const 7))
                (i32.const 3))))))
        (local.get $k))
      (local.get $g)))
    ;; fold high half, then once more in 32 bits so any difference reaches hash&mask bits
    (local.set $x (i32.wrap_i64 (i64.xor (local.get $h) (i64.shr_u (local.get $h) (i64.const 32)))))
    (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 16)))
  )
)
