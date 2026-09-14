(module
  (import "./memory.wat")
  (import "./token.wat")
  (import "./scan.wat")

  ;; Emitter HTML fragments, packed into the reserved static region.
  (data (i32.const $mem.emitterHtml)
    "0123456789abcdef"                   ;; 16
    "<pre class=\22highlights\22 style=\22" ;; 31
    "<span style=\22color:"              ;; 19
    "background-color:"                  ;; 17
    ";font-style:italic"                 ;; 18
    ";font-weight:"                      ;; 13
    "var("                               ;; 4
    "\22><code>"                         ;; 8
    "</code></pre>"                      ;; 13
    "light-dark("                        ;; 11
  )

  (global $out (mut i32) (i32.const 0))     ;; write cursor
  (global $cap (mut i32) (i32.const 0))     ;; highest safe write position (16 bytes of slack below memory end)
  (global $spanHl (mut i32) (i32.const -1)) ;; $Token of the currently open span, -1 when none
  (global $spanVal (mut i64) (i64.const 0)) ;; style value of the open span, 0 when none
  (global $cssVariables (mut i32) (i32.const 0))
  ;; multi-theme HTML mode: the host packs a theme set into a blob placed
  ;; after the input (see $multiRec for the layout); output follows it
  (global $multi (mut i32) (i32.const 0))
  (global $multiBlob (mut i32) (i32.const 0))   ;; blob address
  (global $multiSlots (mut i32) (i32.const 0))  ;; theme count
  (global $multiTables (mut i32) (i32.const 0)) ;; first slot's theme table
  (global $spanCacheMode (mut i32) (i32.const -1)) ;; cached style mode (2: a theme set), unchanged by token calls
  (global $spanReserve (mut i32) (i32.const 96)) ;; output bytes a token may add beyond its escaped text
  (global $tokens (mut i32) (i32.const 0))  ;; token-record mode: emit (end:u32, hl:u32) records instead of HTML
  (global $recCarryHl (mut i32) (i32.const -1))
  (global $streaming (mut i32) (i32.const 0))
  (global $streamReset (mut i32) (i32.const 0))
  (global $streamDepth (mut i32) (i32.const 0))
  (global $streamMode (mut i32) (i32.const 0))
  (global $streamA (mut i32) (i32.const 0))
  (global $streamB (mut i32) (i32.const 0))
  (global $streamC (mut i32) (i32.const 0))
  (global $streamHl (mut i32) (i32.const 0))
  (global $streamRegionKind (mut i32) (i32.const 0))
  (global $streamRegionStarted (mut i32) (i32.const 0))
  ;; live bytes in the json or toml stack, which those lexers keep as a local
  ;; depth and publish at exit; the live tokenizer captures the active stack
  ;; prefix through it
  (global $liveStackBytes (mut i32) (i32.const 0))

  ;; write one byte as two lowercase hex digits
  (func $hexByte (param $b i32)
    (i32.store8
      (global.get $out)
      (i32.load8_u (i32.add (i32.const $mem.emitterHtml) (i32.shr_u (local.get $b) (i32.const 4)))))
    (i32.store8 offset=1
      (global.get $out)
      (i32.load8_u (i32.add (i32.const $mem.emitterHtml) (i32.and (local.get $b) (i32.const 15)))))
    (global.set $out (i32.add (global.get $out) (i32.const 2))))

  ;; write a packed little-endian `r g b a` value as CSS hex text: `#rrggbb`,
  ;; or `#rrggbbaa` when the alpha is not opaque - 9 bytes max
  (func $emitRgba (param $v i32)
    (local $a i32)
    (i32.store8 (global.get $out) (i32.const "#"))
    (global.set $out (i32.add (global.get $out) (i32.const 1)))
    (call $hexByte (i32.and (local.get $v) (i32.const 0xff)))
    (call $hexByte (i32.and (i32.shr_u (local.get $v) (i32.const 8)) (i32.const 0xff)))
    (call $hexByte (i32.and (i32.shr_u (local.get $v) (i32.const 16)) (i32.const 0xff)))
    (local.set $a (i32.shr_u (local.get $v) (i32.const 24)))
    (if (i32.ne (local.get $a) (i32.const 0xff))
      (then (call $hexByte (local.get $a)))))

  ;; write a theme record's color as CSS hex text
  (func $emitColor (param $rec i32)
    (call $emitRgba (i32.load (local.get $rec))))

  ;; Write `var(PREFIX-SUFFIX)` using the host prefix and generated token table.
  ;; Cached span fragments pass zero length; the prefix is inserted on output.
  (func $emitCssVariable (param $hl i32) (param $prefixLength i32)
    (local $entry i32)
    (local $n i32)
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+114) (i32.const 4))
    (global.set $out (i32.add (global.get $out) (i32.const 4)))
    (memory.copy (global.get $out) (i32.load (i32.const 14)) (local.get $prefixLength))
    (global.set $out (i32.add (global.get $out) (local.get $prefixLength)))
    (local.set $entry
      (i32.add (i32.const $mem.tokenCssTable) (i32.mul (local.get $hl) (i32.const 3))))
    (local.set $n (i32.load8_u offset=2 (local.get $entry)))
    (memory.copy (global.get $out) (i32.load16_u (local.get $entry)) (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n)))
    (i32.store8 (global.get $out) (i32.const ")"))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  ;; write the record's font attributes: `;font-style:italic` and/or
  ;; `;font-weight:N00` - 34 bytes max
  (func $emitFont (param $style i32)
    (local $w i32)
    (if (i32.and (local.get $style) (i32.const 0x10))
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+83) (i32.const 18))
        (global.set $out (i32.add (global.get $out) (i32.const 18)))))
    (local.set $w (i32.and (local.get $style) (i32.const 15)))
    (if (local.get $w)
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+101) (i32.const 13))
        (global.set $out (i32.add (global.get $out) (i32.const 13)))
        (i32.store8 (global.get $out) (i32.add (i32.const "0") (local.get $w)))
        (i32.store16 offset=1 (global.get $out) (i32.const 0x3030)) ;; `00`
        (global.set $out (i32.add (global.get $out) (i32.const 3))))))

  ;; make room for $n more output bytes, growing memory when needed.
  ;; every store to $out is gated by this, so wide stores never trap.
  (func $ensureCap (param $n i32)
    (if (i32.le_u (i32.add (global.get $out) (local.get $n)) (global.get $cap))
      (then (return)))
    ;; a failed grow (output would pass the wasm32 4 GB ceiling) traps here on
    ;; purpose: the host sees a RuntimeError and the instance stays reusable
    (if
      (i32.eq
        (memory.grow
          (i32.add
            (i32.shr_u
              (i32.sub
                (i32.add (i32.add (global.get $out) (local.get $n)) (i32.const 65551))
                (i32.mul (memory.size) (i32.const 65536)))
              (i32.const 16))
            (i32.const 4)))
        (i32.const -1))
      (then (unreachable)))
    (global.set $cap (i32.sub (i32.mul (memory.size) (i32.const 65536)) (i32.const 16))))

  ;; close the open span, if any
  (func $closeSpan
    (if (i64.ne (global.get $spanVal) (i64.const 0))
      (then
        (call $ensureCap (i32.const 16))
        (i64.store (global.get $out) (i64.const "</span>"))
        (global.set $out (i32.add (global.get $out) (i32.const 7)))))
    (global.set $spanVal (i64.const 0))
    (global.set $spanHl (i32.const -1)))

  ;; write `<span style="...">` for $hl at $out. The bytes come from a
  ;; cache at $mem.emitterSpanCache (73 slots of [len:u8, fragment:u8*65]) rendered on
  ;; first use and reused across runs. $hlBegin clears the cache when theme
  ;; bytes or the output mode change, including after a theme set borrowed
  ;; the region as its opener arena.
  (func $emitSpanOpen (param $hl i32)
    (local $slot i32)
    (local $len i32)
    (local $save i32)
    (local $rec i32)
    (local $prefixLength i32)
    (local.set $slot
      (i32.add (i32.const $mem.emitterSpanCache) (i32.mul (local.get $hl) (i32.const 66))))
    (local.set $len (i32.load8_u (local.get $slot)))
    (if (i32.eqz (local.get $len))
      (then
        ;; render into the slot through the shared $out-based writers
        (local.set $save (global.get $out))
        (global.set $out (i32.add (local.get $slot) (i32.const 1)))
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+47) (i32.const 19))
        (global.set $out (i32.add (global.get $out) (i32.const 19)))
        (if (global.get $cssVariables)
          (then (call $emitCssVariable (local.get $hl) (i32.const 0)))
          (else
            (local.set $rec (call $themeRec (local.get $hl)))
            ;; Font-only styles inherit the surrounding foreground.
            (if (i32.load (local.get $rec))
              (then (call $emitColor (local.get $rec)))
              (else
                (i64.store (global.get $out) (i64.const "inherit"))
                (global.set $out (i32.add (global.get $out) (i32.const 7)))))
            (call $emitFont (i32.load8_u offset=4 (local.get $rec)))))
        (i32.store16 (global.get $out) (i32.const 0x3e22)) ;; `">`
        (global.set $out (i32.add (global.get $out) (i32.const 2)))
        (local.set $len (i32.sub (global.get $out) (i32.add (local.get $slot) (i32.const 1))))
        (i32.store8 (local.get $slot) (local.get $len))
        (global.set $out (local.get $save))))
    (if (global.get $cssVariables)
      (then
        ;; Insert the prefix after `<span style="color:var(`. The cached
        ;; fragment stays reusable across prefixes of any byte length.
        (local.set $prefixLength (i32.load (i32.const 18)))
        (memory.copy (global.get $out) (i32.add (local.get $slot) (i32.const 1)) (i32.const 23))
        (global.set $out (i32.add (global.get $out) (i32.const 23)))
        (memory.copy (global.get $out) (i32.load (i32.const 14)) (local.get $prefixLength))
        (global.set $out (i32.add (global.get $out) (local.get $prefixLength)))
        (memory.copy (global.get $out) (i32.add (local.get $slot) (i32.const 24)) (i32.sub (local.get $len) (i32.const 23)))
        (global.set $out (i32.add (global.get $out) (i32.sub (local.get $len) (i32.const 23))))
        (return)))
    ;; copy the fragment as four 16-byte stores: an opener is at most 64
    ;; bytes, the slot holds 65, and the caller's capacity covers the
    ;; overshoot, which later output overwrites - cheaper than a bulk copy
    ;; of a few dozen bytes
    (v128.store (global.get $out) (v128.load offset=1 (local.get $slot)))
    (v128.store offset=16 (global.get $out) (v128.load offset=17 (local.get $slot)))
    (v128.store offset=32 (global.get $out) (v128.load offset=33 (local.get $slot)))
    (v128.store offset=48 (global.get $out) (v128.load offset=49 (local.get $slot)))
    (global.set $out (i32.add (global.get $out) (local.get $len))))

  ;; switch the open span to $hl's color/font. adjacent tokens whose records
  ;; hold identical bytes share one span (a 40-bit compare), so runs of
  ;; same-styled tokens and the whitespace between them do not churn spans.
  ;; caller has ensured capacity for close (7) + open (19 + 9 + 34 + 2) plus
  ;; the 64-byte wide copy $emitSpanOpen performs, or the CSS-variable prefix.
  (func $setSpan (param $hl i32)
    (local $val i64)
    (if (i32.eq (local.get $hl) (global.get $spanHl))
      (then (return)))
    (global.set $spanHl (local.get $hl))
    (if (global.get $multi)
      (then
        (call $multiSetSpan (local.get $hl))
        (return)))
    ;; Token identity is the style in CSS-variable mode; otherwise compare the
    ;; whole packed five-byte theme record.
    (local.set $val
      (if (result i64)
        (global.get $cssVariables)
        (then (i64.extend_i32_u (local.get $hl)))
        (else (i64.and (i64.load (call $themeRec (local.get $hl))) (i64.const 0xFFFFFFFFFF)))))
    (if (i64.eq (local.get $val) (global.get $spanVal))
      (then (return)))
    (if (i64.ne (global.get $spanVal) (i64.const 0))
      (then
        (i64.store (global.get $out) (i64.const "</span>"))
        (global.set $out (i32.add (global.get $out) (i32.const 7)))))
    (global.set $spanVal (local.get $val))
    (if (i64.ne (local.get $val) (i64.const 0))
      (then (call $emitSpanOpen (local.get $hl)))))

  ;; copy [$lhs,$rhs) to $out, escaping & < > - 16 bytes per step.
  ;; wide loads may read up to 15 bytes past $rhs: always inside the input
  ;; buffer or the 16-byte slack, never past $cap. wide stores may write up to
  ;; 15 bytes of garbage past the advanced cursor; later writes overwrite it.
  ;; $gap selects direct copying for whitespace or UTF-8 continuation bytes.
  ;; caller has ensured capacity for length + 16, or 5*length + 16 when escaping.
  (func $escCopy (param $lhs i32) (param $rhs i32) (param $gap i32)
    (local $c i32)
    (local $mask i32)
    (local $k i32)
    (local $rem i32)
    (local $w v128)
    (if (local.get $gap)
      (then
        (local.set $rem (i32.sub (local.get $rhs) (local.get $lhs)))
        ;; Later output overwrites lookahead copied by a short gap's store.
        (if (i32.le_u (local.get $rem) (i32.const 16))
          (then (v128.store (global.get $out) (v128.load (local.get $lhs))))
          (else (memory.copy (global.get $out) (local.get $lhs) (local.get $rem))))
        (global.set $out (i32.add (global.get $out) (local.get $rem)))
        (return)))
    (block $done
      (loop $outer
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (block $special
          (loop $wide
            (local.set $w (v128.load (local.get $lhs)))
            ;; `<` and `>` differ only in bit 1, so one masked compare finds both
            (local.set $mask
              (i8x16.bitmask
                (v128.or
                  (i8x16.eq
                    (v128.and (local.get $w) (i8x16.splat (i32.const 0xfd)))
                    (i8x16.splat (i32.const "<")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "&"))))))
            (local.set $rem (i32.sub (local.get $rhs) (local.get $lhs)))
            ;; ignore specials past $rhs
            (if (i32.lt_u (local.get $rem) (i32.const 16))
              (then
                (local.set $mask
                  (i32.and
                    (local.get $mask)
                    (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
            (if (local.get $mask)
              (then
                ;; copy the clean prefix, then leave to escape the special byte
                (local.set $k (i32.ctz (local.get $mask)))
                (v128.store (global.get $out) (local.get $w))
                (global.set $out (i32.add (global.get $out) (local.get $k)))
                (local.set $lhs (i32.add (local.get $lhs) (local.get $k)))
                (br $special)))
            (v128.store (global.get $out) (local.get $w))
            (if (i32.le_u (local.get $rem) (i32.const 16))
              (then
                (global.set $out (i32.add (global.get $out) (local.get $rem)))
                (br $done)))
            (global.set $out (i32.add (global.get $out) (i32.const 16)))
            (local.set $lhs (i32.add (local.get $lhs) (i32.const 16)))
            (br $wide)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (i64.store (global.get $out) (i64.const "&amp;"))
            (global.set $out (i32.add (global.get $out) (i32.const 5))))
          (else
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then
                (i32.store (global.get $out) (i32.const "&lt;"))
                (global.set $out (i32.add (global.get $out) (i32.const 4))))
              (else
                (i32.store (global.get $out) (i32.const "&gt;"))
                (global.set $out (i32.add (global.get $out) (i32.const 4)))))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $outer))))

  ;; token-record mode: append an (end:u32, hl:u32) record covering up to
  ;; input offset $rhs, or extend the previous record when its $hl matches -
  ;; the analog of span merging. Records tile the input; a record's start is
  ;; the previous record's end (0 for the first).
  (func $recTok (param $hl i32) (param $rhs i32)
    (if
      (i32.and
        (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
        (i32.eq (i32.load (i32.sub (global.get $out) (i32.const 4))) (local.get $hl)))
      (then
        (i32.store
          (i32.sub (global.get $out) (i32.const 8))
          (i32.sub (local.get $rhs) (global.get $srcBase)))
        (return)))
    (call $ensureCap (i32.const 16))
    (i32.store (global.get $out) (i32.sub (local.get $rhs) (global.get $srcBase)))
    (i32.store offset=4 (global.get $out) (local.get $hl))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  ;; Preserve the open token-record style between incremental lexer calls so
  ;; leading whitespace in the next chunk keeps the same span.
  (func $recStreamBegin (param $reset i32)
    (if (local.get $reset)
      (then
        (global.set $recCarryHl (i32.const -1))
        (return)))
    (if (i32.ge_s (global.get $recCarryHl) (i32.const 0))
      (then
        (call $ensureCap (i32.const 16))
        (i32.store (global.get $out) (i32.const 0))
        (i32.store offset=4 (global.get $out) (global.get $recCarryHl))
        (global.set $out (i32.add (global.get $out) (i32.const 8))))))

  (func $recStreamEnd
    (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
      (then (global.set $recCarryHl (i32.load (i32.sub (global.get $out) (i32.const 4)))))))

  ;; Append a line-aware `(endUtf16:u32, hl:u32)` record. Token id -1 marks a
  ;; line terminator and ends after it. Other equal neighbors merge.
  (func $recLineWrite (param $hl i32) (param $end i32)
    (local $start i32)
    (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
      (then (local.set $start (i32.load (i32.sub (global.get $out) (i32.const 8))))))
    (if (i32.le_u (local.get $end) (local.get $start))
      (then (return)))
    (if
      (i32.and
        (i32.ne (local.get $hl) (i32.const -1))
        (i32.and
          (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
          (i32.eq (i32.load (i32.sub (global.get $out) (i32.const 4))) (local.get $hl))))
      (then
        (i32.store (i32.sub (global.get $out) (i32.const 8)) (local.get $end))
        (return)))
    (call $ensureCap (i32.const 16))
    (i32.store (global.get $out) (local.get $end))
    (i32.store offset=4 (global.get $out) (local.get $hl))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  ;; Remove a trailing CR from the preceding content record before a CRLF
  ;; marker. The CR and LF are both covered by the marker.
  (func $recLineTrim (param $end i32)
    (local $last i32)
    (local $prev i32)
    (if (i32.le_u (global.get $out) (i32.load (i32.const 6)))
      (then (return)))
    (local.set $last (i32.sub (global.get $out) (i32.const 8)))
    (if (i32.eq (i32.load offset=4 (local.get $last)) (i32.const -1))
      (then (return)))
    (if (i32.le_u (i32.load (local.get $last)) (local.get $end))
      (then (return)))
    (if (i32.gt_u (local.get $last) (i32.load (i32.const 6)))
      (then (local.set $prev (i32.load (i32.sub (local.get $last) (i32.const 8))))))
    (if (i32.le_u (local.get $end) (local.get $prev))
      (then (global.set $out (local.get $last)))
      (else (i32.store (local.get $last) (local.get $end)))))

  ;; Scan newly emitted input bytes once, splitting records at LF/CRLF
  ;; boundaries and returning the UTF-16 cursor for the next record.
  (func $recLineTok (param $hl i32) (param $p i32) (param $rhs i32) (param $char i32) (result i32)
    (local $b i32)
    (local $cut i32)
    (local $step i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $rhs)))
        ;; hop over plain ASCII - anything except LF and non-ASCII counts as
        ;; one UTF-16 unit, CR included - 16 bytes per step. Wide loads may
        ;; pass $rhs into the following record or the buffer slack; matches
        ;; there are masked off. The bitmask reads non-ASCII high bits directly.
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or (local.get $w) (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10))))))
        (local.set $rem (i32.sub (local.get $rhs) (local.get $p)))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then
            (local.set $mask
              (i32.and
                (local.get $mask)
                (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (if (i32.eqz (local.get $mask))
          (then
            (local.set $step
              (select (local.get $rem) (i32.const 16) (i32.lt_u (local.get $rem) (i32.const 16))))
            (local.set $p (i32.add (local.get $p) (local.get $step)))
            (local.set $char (i32.add (local.get $char) (local.get $step)))
            (br $scan)))
        (local.set $step (i32.ctz (local.get $mask)))
        (local.set $p (i32.add (local.get $p) (local.get $step)))
        (local.set $char (i32.add (local.get $char) (local.get $step)))
        (local.set $b (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $b) (i32.const 10))
          (then
            (local.set $cut (local.get $char))
            (if
              (i32.and
                (i32.gt_u (local.get $p) (global.get $srcBase))
                (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 13)))
              (then
                (local.set $cut (i32.sub (local.get $cut) (i32.const 1)))
                (call $recLineTrim (local.get $cut))))
            (call $recLineWrite (local.get $hl) (local.get $cut))
            (local.set $char (i32.add (local.get $char) (i32.const 1)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (call $recLineWrite (i32.const -1) (local.get $char)))
          (else
            ;; The mask selects only LF or non-ASCII bytes.
            (local.set $step (i32.const 2))
            (if (i32.ge_u (local.get $b) (i32.const 0xe0))
              (then (local.set $step (i32.const 3))))
            (if (i32.ge_u (local.get $b) (i32.const 0xf0))
              (then
                (local.set $step (i32.const 4))
                (local.set $char (i32.add (local.get $char) (i32.const 1)))))
            (local.set $p (i32.add (local.get $p) (local.get $step)))
            (local.set $char (i32.add (local.get $char) (i32.const 1)))))
        (br $scan)))
    (call $recLineWrite (local.get $hl) (local.get $char))
    (local.get $char))

  ;; Convert byte-end token records to line-aware UTF-16 records after lexing.
  ;; Keeping the original emission order first preserves malformed-input cases
  ;; where a lexer temporarily emits a non-forward range.
  (func $recLinesPost
    (local $rec i32)
    (local $oldEnd i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $char i32)
    (local.set $rec (i32.load (i32.const 6)))
    (local.set $oldEnd (global.get $out))
    (global.set $out (i32.and (i32.add (local.get $oldEnd) (i32.const 15)) (i32.const -16)))
    (i32.store (i32.const 6) (global.get $out))
    (block $done
      (loop $records
        (br_if $done (i32.ge_u (local.get $rec) (local.get $oldEnd)))
        (local.set $rhs (i32.load (local.get $rec)))
        (if (i32.gt_u (local.get $rhs) (local.get $lhs))
          (then
            (local.set $char
              (call $recLineTok
                (i32.load offset=4 (local.get $rec))
                (i32.add (global.get $srcBase) (local.get $lhs))
                (i32.add (global.get $srcBase) (local.get $rhs))
                (local.get $char)))
            (local.set $lhs (local.get $rhs))))
        (local.set $rec (i32.add (local.get $rec) (i32.const 8)))
        (br $records))))

  ;; emit the token bytes [$lhs,$rhs) styled as $hl
  (func $emitTok (param $hl i32) (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs))
      (then (return)))
    (if (global.get $tokens)
      (then
        (call $recTok (local.get $hl) (local.get $rhs))
        (return)))
    (call $ensureCap
      (i32.add
        (i32.mul (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
        (global.get $spanReserve)))
    (call $setSpan (local.get $hl))
    (call $escCopy (local.get $lhs) (local.get $rhs) (i32.const 0)))

  ;; Copy whitespace or leading UTF-8 continuation bytes without changing
  ;; the open span. These bytes cannot contain HTML specials (& < >).
  (func $emitGap (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs))
      (then (return)))
    (if (global.get $tokens)
      (then
        ;; a gap keeps the open record's style, mirroring HTML span merging
        (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
          (then
            (i32.store
              (i32.sub (global.get $out) (i32.const 8))
              (i32.sub (local.get $rhs) (global.get $srcBase))))
          (else (call $recTok (enum.get $Token.none) (local.get $rhs))))
        (return)))
    (call $ensureCap (i32.add (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 16)))
    (call $escCopy (local.get $lhs) (local.get $rhs) (i32.const 1)))

  ;; Keep a span open when a bounded range resumes inside a UTF-8 code point.
  ;; Lives here rather than in common.wat so the lexers that import only
  ;; token/scan/emit can reach it too.
  (func $lexEmitLeadingContinuation
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
    (call $emitGap (local.get $lhs) (global.get $ptr)))

  ;; ---- multi-theme HTML ----
  ;; The host packs a theme set into a blob that sits where output would
  ;; start (control words 14 and 18 give its address and length):
  ;;   0   u8  slot count       1  u8  kind: 0 custom properties, 1 light-dark()
  ;;   4   u32 tables offset    8  u32 span reserve    12  u32 prologue reserve
  ;;   16  u32 set id, unique per packed set, keying the opener cache
  ;;   32  per slot, 16 bytes: u32 name offset, u32 name length, u32 inline
  ;;   then one 384-byte theme table per slot, then the name bytes
  ;; A slot's name is its escaped custom property (`--hls-dark`), used as
  ;; `NAME:#…`, `NAME-bg:#…`, `NAME-font-style:italic`, and
  ;; `NAME-font-weight:N00`. The inline slot (the `defaultColor` theme) has no
  ;; name and writes plain `color`, `background-color`, and font properties.
  ;; Under light-dark() the two slots are the light and dark themes: colors
  ;; merge into `light-dark(A, B)` and font settings both share stay plain.
  ;; Zero colors write nothing and inherit, like the single-theme emitter.

  ;; slot $i's theme record for $hl
  (func $multiRec (param $i i32) (param $hl i32) (result i32)
    (i32.add
      (i32.add (global.get $multiTables) (i32.mul (local.get $i) (i32.const 384)))
      (i32.mul (local.get $hl) (i32.const 5))))

  ;; slot $i's descriptor
  (func $multiSlot (param $i i32) (result i32)
    (i32.add
      (global.get $multiBlob)
      (i32.add (i32.const 32) (i32.shl (local.get $i) (i32.const 4)))))

  ;; write slot $i's custom property name
  (func $multiName (param $i i32)
    (local $slot i32)
    (local $n i32)
    (local.set $slot (call $multiSlot (local.get $i)))
    (local.set $n (i32.load offset=4 (local.get $slot)))
    (memory.copy
      (global.get $out)
      (i32.add (global.get $multiBlob) (i32.load (local.get $slot)))
      (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n))))

  ;; slot $i's color declaration for $rec: `color:#…;` inline, `NAME:#…;`
  ;; otherwise. A zero color inherits and writes nothing.
  (func $multiColorDecl (param $i i32) (param $rec i32)
    (local $v i32)
    (local.set $v (i32.load (local.get $rec)))
    (if (i32.eqz (local.get $v))
      (then (return)))
    (if (i32.load offset=8 (call $multiSlot (local.get $i)))
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+60) (i32.const 6))
        (global.set $out (i32.add (global.get $out) (i32.const 6))))
      (else
        (call $multiName (local.get $i))
        (i32.store8 (global.get $out) (i32.const ":"))
        (global.set $out (i32.add (global.get $out) (i32.const 1)))))
    (call $emitRgba (local.get $v))
    (i32.store8 (global.get $out) (i32.const ";"))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  ;; slot $i's font declarations for a style byte: `font-style:italic;` and
  ;; `font-weight:N00;`, each prefixed with `NAME-` when $named
  (func $multiFontDecls (param $i i32) (param $style i32) (param $named i32)
    (local $w i32)
    (if (i32.and (local.get $style) (i32.const 0x10))
      (then
        (if (local.get $named)
          (then
            (call $multiName (local.get $i))
            (i32.store8 (global.get $out) (i32.const "-"))
            (global.set $out (i32.add (global.get $out) (i32.const 1)))))
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+84) (i32.const 17))
        (i32.store8 offset=17 (global.get $out) (i32.const ";"))
        (global.set $out (i32.add (global.get $out) (i32.const 18)))))
    (local.set $w (i32.and (local.get $style) (i32.const 15)))
    (if (local.get $w)
      (then
        (if (local.get $named)
          (then
            (call $multiName (local.get $i))
            (i32.store8 (global.get $out) (i32.const "-"))
            (global.set $out (i32.add (global.get $out) (i32.const 1)))))
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+102) (i32.const 12))
        (i32.store8 offset=12 (global.get $out) (i32.add (i32.const "0") (local.get $w)))
        (i32.store16 offset=13 (global.get $out) (i32.const 0x3030)) ;; `00`
        (i32.store8 offset=15 (global.get $out) (i32.const ";"))
        (global.set $out (i32.add (global.get $out) (i32.const 16))))))

  ;; one side of `light-dark(A, B)`: a color, or for a missing side the
  ;; keyword $kw (0 `currentcolor`, 1 `transparent`) - 12 bytes max
  (func $emitLightDarkSide (param $v i32) (param $kw i32)
    (if (local.get $v)
      (then
        (call $emitRgba (local.get $v))
        (return)))
    (if (local.get $kw)
      (then
        (i64.store (global.get $out) (i64.const "transpar"))
        (i32.store offset=8 (global.get $out) (i32.const "ent"))
        (global.set $out (i32.add (global.get $out) (i32.const 11))))
      (else
        (i64.store (global.get $out) (i64.const "currentc"))
        (i32.store offset=8 (global.get $out) (i32.const "olor"))
        (global.set $out (i32.add (global.get $out) (i32.const 12))))))

  ;; the light-dark() value for a color pair, at least one of them set:
  ;; a shared color, or `light-dark(A, B)` - 38 bytes max
  (func $emitLightDark (param $a i32) (param $b i32) (param $kw i32)
    (if (i32.eq (local.get $a) (local.get $b))
      (then
        (call $emitRgba (local.get $a))
        (return)))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+139) (i32.const 11))
    (global.set $out (i32.add (global.get $out) (i32.const 11)))
    (call $emitLightDarkSide (local.get $a) (local.get $kw))
    (i32.store16 (global.get $out) (i32.const ", "))
    (global.set $out (i32.add (global.get $out) (i32.const 2)))
    (call $emitLightDarkSide (local.get $b) (local.get $kw))
    (i32.store8 (global.get $out) (i32.const ")"))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  ;; a span's declarations under light-dark(): the color pair merges, with a
  ;; side the theme leaves unset taking that theme's foreground; italic and a
  ;; weight both sides share stay plain, the rest become per-side properties
  (func $multiLightDarkDecls (param $hl i32)
    (local $recA i32)
    (local $recB i32)
    (local $a i32)
    (local $b i32)
    (local $sa i32)
    (local $sb i32)
    (local $common i32)
    (local.set $recA (call $multiRec (i32.const 0) (local.get $hl)))
    (local.set $recB (call $multiRec (i32.const 1) (local.get $hl)))
    (local.set $a (i32.load (local.get $recA)))
    (local.set $b (i32.load (local.get $recB)))
    (if (i32.or (local.get $a) (local.get $b))
      (then
        (if (i32.eqz (local.get $a))
          (then (local.set $a (i32.load (call $multiRec (i32.const 0) (enum.get $Token.foreground))))))
        (if (i32.eqz (local.get $b))
          (then (local.set $b (i32.load (call $multiRec (i32.const 1) (enum.get $Token.foreground))))))
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+60) (i32.const 6))
        (global.set $out (i32.add (global.get $out) (i32.const 6)))
        (call $emitLightDark (local.get $a) (local.get $b) (i32.const 0))
        (i32.store8 (global.get $out) (i32.const ";"))
        (global.set $out (i32.add (global.get $out) (i32.const 1)))))
    (local.set $sa (i32.load8_u offset=4 (local.get $recA)))
    (local.set $sb (i32.load8_u offset=4 (local.get $recB)))
    (local.set $common (i32.and (i32.and (local.get $sa) (local.get $sb)) (i32.const 0x10)))
    (if (i32.eq (i32.and (local.get $sa) (i32.const 15)) (i32.and (local.get $sb) (i32.const 15)))
      (then (local.set $common (i32.or (local.get $common) (i32.and (local.get $sa) (i32.const 15))))))
    (call $multiFontDecls (i32.const 0) (local.get $common) (i32.const 0))
    (call $multiFontDecls (i32.const 0) (i32.and (local.get $sa) (i32.xor (local.get $common) (i32.const -1))) (i32.const 1))
    (call $multiFontDecls (i32.const 1) (i32.and (local.get $sb) (i32.xor (local.get $common) (i32.const -1))) (i32.const 1)))

  ;; write `<span style="...">` for $hl. Openers hold host-sized property
  ;; names, so the fixed slots do not fit them; a set instead uses the span
  ;; cache region as an arena: [id:u32, used:u32, length:u16*73,
  ;; offset:u16*73, fragments:4520 bytes]. $hlBegin clears the arena when the
  ;; set id changes, and a single-theme call clears the region (the id with
  ;; it) since the mode changed. An opener is rendered into the arena on
  ;; first use and copied out in 16-byte steps (the reserve covers the
  ;; overshoot); one the arena cannot hold renders straight to $out on
  ;; every use.
  (func $multiSpanOpen (param $hl i32)
    (local $len i32)
    (local $at i32)
    (local $save i32)
    (local.set $len
      (i32.load16_u (i32.add (i32.const $mem.emitterSpanCache+8) (i32.shl (local.get $hl) (i32.const 1)))))
    (if (local.get $len)
      (then
        (call $copyWide
          (i32.add
            (i32.const $mem.emitterSpanCache+304)
            (i32.load16_u (i32.add (i32.const $mem.emitterSpanCache+154) (i32.shl (local.get $hl) (i32.const 1)))))
          (local.get $len))
        (return)))
    (local.set $at
      (i32.add (i32.const $mem.emitterSpanCache+304) (i32.load (i32.const $mem.emitterSpanCache+4))))
    (if
      (i32.le_u
        (i32.add (i32.load (i32.const $mem.emitterSpanCache+4)) (global.get $spanReserve))
        (i32.const 4520))
      (then
        (local.set $save (global.get $out))
        (global.set $out (local.get $at))))
    (call $multiRenderOpen (local.get $hl))
    (if (local.get $save)
      (then
        (local.set $len (i32.sub (global.get $out) (local.get $at)))
        (i32.store16
          (i32.add (i32.const $mem.emitterSpanCache+8) (i32.shl (local.get $hl) (i32.const 1)))
          (local.get $len))
        (i32.store16
          (i32.add (i32.const $mem.emitterSpanCache+154) (i32.shl (local.get $hl) (i32.const 1)))
          (i32.sub (local.get $at) (i32.const $mem.emitterSpanCache+304)))
        (i32.store
          (i32.const $mem.emitterSpanCache+4)
          (i32.add (i32.load (i32.const $mem.emitterSpanCache+4)) (local.get $len)))
        (global.set $out (local.get $save))
        (call $copyWide (local.get $at) (local.get $len)))))

  ;; copy $len bytes to $out in 16-byte steps; reads and writes may overshoot
  ;; by 15 bytes, which the caller's capacity and the arena's slack cover
  (func $copyWide (param $src i32) (param $len i32)
    (local $i i32)
    (loop $step
      (v128.store
        (i32.add (global.get $out) (local.get $i))
        (v128.load (i32.add (local.get $src) (local.get $i))))
      (local.set $i (i32.add (local.get $i) (i32.const 16)))
      (br_if $step (i32.lt_u (local.get $i) (local.get $len))))
    (global.set $out (i32.add (global.get $out) (local.get $len))))

  ;; render `<span style="...">` for $hl from every slot's record at $out.
  ;; The caller guarantees at least one declaration.
  (func $multiRenderOpen (param $hl i32)
    (local $i i32)
    (local $rec i32)
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+47) (i32.const 13))
    (global.set $out (i32.add (global.get $out) (i32.const 13)))
    (if (i32.load8_u offset=1 (global.get $multiBlob))
      (then (call $multiLightDarkDecls (local.get $hl)))
      (else
        (loop $slots
          (local.set $rec (call $multiRec (local.get $i) (local.get $hl)))
          (call $multiColorDecl (local.get $i) (local.get $rec))
          (call $multiFontDecls
            (local.get $i)
            (i32.load8_u offset=4 (local.get $rec))
            (i32.eqz (i32.load offset=8 (call $multiSlot (local.get $i)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $slots (i32.lt_u (local.get $i) (global.get $multiSlots))))))
    ;; the last declaration's `;` becomes the closing quote
    (i32.store16 (i32.sub (global.get $out) (i32.const 1)) (i32.const 0x3e22)) ;; `">`
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  ;; $setSpan for multi-theme mode. A token's style is its record in every
  ;; slot: neighbors whose records all agree share one span, and a token no
  ;; slot styles closes the span. $spanVal holds the id that opened the span.
  (func $multiSetSpan (param $hl i32)
    (local $i i32)
    (local $open i32)
    (local $rec i64)
    (local $any i64)
    (local $same i32)
    (local.set $open (i32.wrap_i64 (global.get $spanVal)))
    (local.set $same (i32.const 1))
    (loop $slots
      (local.set $rec
        (i64.and
          (i64.load (call $multiRec (local.get $i) (local.get $hl)))
          (i64.const 0xFFFFFFFFFF)))
      (local.set $any (i64.or (local.get $any) (local.get $rec)))
      (if (local.get $open)
        (then
          (local.set $same
            (i32.and
              (local.get $same)
              (i64.eq
                (local.get $rec)
                (i64.and
                  (i64.load (call $multiRec (local.get $i) (local.get $open)))
                  (i64.const 0xFFFFFFFFFF)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $slots (i32.lt_u (local.get $i) (global.get $multiSlots))))
    (if (local.get $open)
      (then
        (if (i32.and (local.get $same) (i64.ne (local.get $any) (i64.const 0)))
          (then (return)))
        (i64.store (global.get $out) (i64.const "</span>"))
        (global.set $out (i32.add (global.get $out) (i32.const 7)))))
    (if (i64.eqz (local.get $any))
      (then
        (global.set $spanVal (i64.const 0))
        (return)))
    (global.set $spanVal (i64.extend_i32_u (local.get $hl)))
    (call $multiSpanOpen (local.get $hl)))

  ;; every slot's background ($bg) or foreground declaration for the root
  (func $multiRootDecls (param $bg i32)
    (local $i i32)
    (local $rec i32)
    (loop $slots
      (if (local.get $bg)
        (then
          (local.set $rec (call $multiRec (local.get $i) (enum.get $Token.background)))
          (if (i32.load (local.get $rec))
            (then
              (if (i32.load offset=8 (call $multiSlot (local.get $i)))
                (then
                  (memory.copy (global.get $out) (i32.const $mem.emitterHtml+66) (i32.const 17))
                  (global.set $out (i32.add (global.get $out) (i32.const 17))))
                (else
                  (call $multiName (local.get $i))
                  (i32.store (global.get $out) (i32.const "-bg:"))
                  (global.set $out (i32.add (global.get $out) (i32.const 4)))))
              (call $emitColor (local.get $rec))
              (i32.store8 (global.get $out) (i32.const ";"))
              (global.set $out (i32.add (global.get $out) (i32.const 1))))))
        (else
          (call $multiColorDecl
            (local.get $i)
            (call $multiRec (local.get $i) (enum.get $Token.foreground)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $slots (i32.lt_u (local.get $i) (global.get $multiSlots)))))

  ;; `<pre class="highlights" style="...">` for a theme set. With an inline
  ;; slot the order is Shiki's `background-color:BG;color:FG` with each
  ;; list holding the other slots' properties; with custom properties only
  ;; it is Shiki's `rootStyle`, foregrounds then backgrounds.
  (func $multiPrologue
    (local $a i32)
    (local $b i32)
    (call $ensureCap (i32.load offset=12 (global.get $multiBlob)))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+16) (i32.const 31))
    (global.set $out (i32.add (global.get $out) (i32.const 31)))
    (if (i32.load8_u offset=1 (global.get $multiBlob))
      (then
        (local.set $a (i32.load (call $multiRec (i32.const 0) (enum.get $Token.background))))
        (local.set $b (i32.load (call $multiRec (i32.const 1) (enum.get $Token.background))))
        (if (i32.or (local.get $a) (local.get $b))
          (then
            (memory.copy (global.get $out) (i32.const $mem.emitterHtml+66) (i32.const 17))
            (global.set $out (i32.add (global.get $out) (i32.const 17)))
            (call $emitLightDark (local.get $a) (local.get $b) (i32.const 1))
            (i32.store8 (global.get $out) (i32.const ";"))
            (global.set $out (i32.add (global.get $out) (i32.const 1)))))
        (local.set $a (i32.load (call $multiRec (i32.const 0) (enum.get $Token.foreground))))
        (local.set $b (i32.load (call $multiRec (i32.const 1) (enum.get $Token.foreground))))
        (if (i32.or (local.get $a) (local.get $b))
          (then
            (memory.copy (global.get $out) (i32.const $mem.emitterHtml+60) (i32.const 6))
            (global.set $out (i32.add (global.get $out) (i32.const 6)))
            (call $emitLightDark (local.get $a) (local.get $b) (i32.const 0))
            (i32.store8 (global.get $out) (i32.const ";"))
            (global.set $out (i32.add (global.get $out) (i32.const 1))))))
      (else
        (if (i32.load offset=8 (call $multiSlot (i32.const 0)))
          (then
            (call $multiRootDecls (i32.const 1))
            (call $multiRootDecls (i32.const 0)))
          (else
            (call $multiRootDecls (i32.const 0))
            (call $multiRootDecls (i32.const 1))))))
    ;; drop the trailing `;`
    (if (i32.eq (i32.load8_u (i32.sub (global.get $out) (i32.const 1))) (i32.const ";"))
      (then (global.set $out (i32.sub (global.get $out) (i32.const 1)))))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+118) (i32.const 8))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  ;; `<pre class="highlights" style="background-color:BG;color:FG"><code>`
  (func $prologue
    (local $rec i32)
    (call $ensureCap (i32.const 128))
    (if (global.get $cssVariables)
      (then (call $ensureCap (i32.add (i32.const 128) (i32.mul (i32.load (i32.const 18)) (i32.const 2))))))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+16) (i32.const 31))
    (global.set $out (i32.add (global.get $out) (i32.const 31)))
    (local.set $rec (call $themeRec (enum.get $Token.background)))
    (if (i32.or (global.get $cssVariables) (i32.load (local.get $rec)))
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+66) (i32.const 17))
        (global.set $out (i32.add (global.get $out) (i32.const 17)))
        (if (global.get $cssVariables)
          (then (call $emitCssVariable (enum.get $Token.background) (i32.load (i32.const 18))))
          (else (call $emitColor (local.get $rec))))
        (i32.store8 (global.get $out) (i32.const ";"))
        (global.set $out (i32.add (global.get $out) (i32.const 1)))))
    (local.set $rec (call $themeRec (enum.get $Token.foreground)))
    (if (i32.or (global.get $cssVariables) (i32.load (local.get $rec)))
      (then
        (i64.store (global.get $out) (i64.const "color:"))
        (global.set $out (i32.add (global.get $out) (i32.const 6)))
        (if (global.get $cssVariables)
          (then
            (call $emitCssVariable (enum.get $Token.foreground) (i32.load (i32.const 18)))
            (i32.store8 (global.get $out) (i32.const ";"))
            (global.set $out (i32.add (global.get $out) (i32.const 1))))
          (else (call $emitColor (local.get $rec))))))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+118) (i32.const 8))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  ;; `</code></pre>`
  (func $epilogue
    (call $closeSpan)
    (call $ensureCap (i32.const 32))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+126) (i32.const 13))
    (global.set $out (i32.add (global.get $out) (i32.const 13))))

  ;; driver prologue shared by highlights.wat and the per-language test harnesses:
  ;; read the control block ([1]: 0 inline colors, 1 CSS variables, 2 a
  ;; multi-theme set, 3 UTF-16 line records), place the output, emit the wrapper
  (func $hlBegin
    (local $offset i32)
    (local $changed v128)
    (global.set $cssVariables (i32.eq (i32.load8_u (i32.const 1)) (i32.const 1)))
    (global.set $multi (i32.eq (i32.load8_u (i32.const 1)) (i32.const 2)))
    (global.set $tokens (i32.eq (i32.load8_u (i32.const 1)) (i32.const 3)))
    (global.set $eof (i32.add (global.get $srcBase) (i32.load (i32.const 2))))
    (global.set $end (global.get $eof))
    (global.set $ptr (global.get $srcBase))
    (global.set $out (i32.and (i32.add (global.get $eof) (i32.const 47)) (i32.const -16)))
    ;; the CSS-variable prefix or the theme-set blob sits at the output base
    (if (i32.or (global.get $cssVariables) (global.get $multi))
      (then
        (global.set $out (i32.add (global.get $out) (i32.load (i32.const 18))))))
    (i32.store (i32.const 6) (global.get $out))
    (global.set $cap (i32.sub (i32.mul (memory.size) (i32.const 65536)) (i32.const 16)))
    (global.set $spanHl (i32.const -1))
    (global.set $spanVal (i64.const 0))
    ;; per-token output reserve beyond the escaped bytes: close (7) + open
    ;; (19 + 9 + 34 + 2) and the 64-byte wide copy $emitSpanOpen performs,
    ;; plus the CSS-variable prefix when that mode inserts one
    (global.set $spanReserve
      (i32.add
        (i32.const 96)
        (select (i32.load (i32.const 18)) (i32.const 0) (global.get $cssVariables))))
    (if (global.get $multi)
      (then
        ;; the set's openers are rendered per span, leaving the single-theme
        ;; span cache and its theme copy untouched
        (global.set $multiBlob (i32.load (i32.const 14)))
        (global.set $multiSlots (i32.load8_u (global.get $multiBlob)))
        (global.set $multiTables
          (i32.add (global.get $multiBlob) (i32.load offset=4 (global.get $multiBlob))))
        (global.set $spanReserve (i32.load offset=8 (global.get $multiBlob)))
        ;; the span cache region is this set's opener arena; the mode marks it
        ;; foreign for the next single-theme call, and a different set
        ;; invalidates it
        (global.set $spanCacheMode (i32.const 2))
        (if
          (i32.ne
            (i32.load (i32.const $mem.emitterSpanCache))
            (i32.load offset=16 (global.get $multiBlob)))
          (then
            (memory.fill (i32.const $mem.emitterSpanCache) (i32.const 0) (i32.const 304))
            (i32.store
              (i32.const $mem.emitterSpanCache)
              (i32.load offset=16 (global.get $multiBlob)))))
        (call $multiPrologue)
        (return)))
    (if (i32.eqz (global.get $tokens))
      (then
        ;; Compare all 73 five-byte records, padded to 384 bytes, in twelve
        ;; pairs of vectors. Reading bytes also catches direct host writes.
        (loop $theme
          (local.set $changed
            (v128.or
              (local.get $changed)
              (v128.or
                (v128.xor
                  (v128.load (i32.add (i32.const $mem.themeTable) (local.get $offset)))
                  (v128.load (i32.add (i32.const $mem.emitterThemeCache) (local.get $offset))))
                (v128.xor
                  (v128.load offset=16 (i32.add (i32.const $mem.themeTable) (local.get $offset)))
                  (v128.load offset=16
                    (i32.add (i32.const $mem.emitterThemeCache) (local.get $offset)))))))
          (local.set $offset (i32.add (local.get $offset) (i32.const 32)))
          (br_if $theme (i32.lt_u (local.get $offset) (i32.const 384))))
        (if
          (i32.or
            (v128.any_true (local.get $changed))
            (i32.ne (global.get $spanCacheMode) (global.get $cssVariables)))
          (then
            (memory.fill (i32.const $mem.emitterSpanCache) (i32.const 0) (i32.const 4818))
            (memory.copy
              (i32.const $mem.emitterThemeCache)
              (i32.const $mem.themeTable)
              (i32.const 384))
            (global.set $spanCacheMode (global.get $cssVariables))))
        (call $prologue))))

  ;; driver epilogue: emit the wrapper closing and publish the result
  (func $hlEnd
    (if (i32.eqz (global.get $tokens))
      (then (call $epilogue)))
    (if (global.get $tokens)
      (then (call $recLinesPost)))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (i32.load (i32.const 6)))))
)
