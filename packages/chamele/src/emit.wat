(module
  (import "./memory.wat")
  (import "./token.wat")
  (import "./scan.wat")

  ;; Emitter HTML fragments, packed into the reserved static region.
  (data (i32.const $mem.emitterHtml)
    "0123456789abcdef"                   ;; 16
    "<pre class=\22chamele\22 style=\22" ;; 28
    "<span style=\22color:"              ;; 19
    "background-color:"                  ;; 17
    ";font-style:italic"                 ;; 18
    ";font-weight:"                      ;; 13
    "var(--cha-"                         ;; 10
    "\22><code>"                         ;; 8
    "</code></pre>"                      ;; 13
  )

  (global $out (mut i32) (i32.const 0))     ;; write cursor
  (global $cap (mut i32) (i32.const 0))     ;; highest safe write position (16 bytes of slack below memory end)
  (global $spanHl (mut i32) (i32.const -1)) ;; $Token of the currently open span, -1 when none
  (global $spanVal (mut i64) (i64.const 0)) ;; style value of the open span, 0 when none
  (global $cssVariables (mut i32) (i32.const 0))
  (global $tokens (mut i32) (i32.const 0))  ;; token-record mode: emit (end:u32, hl:u32) records instead of HTML
  (global $tokenLines (mut i32) (i32.const 0)) ;; line-record mode: UTF-16 ends plus -1 newline markers
  (global $recByte (mut i32) (i32.const 0))
  (global $recChar (mut i32) (i32.const 0))
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
  ;; live bytes in the shared stack for lexers that keep their stack depth in
  ;; a local (json/toml publish it at exit); the live tokenizer captures the
  ;; active stack prefix through it
  (global $liveSharedBytes (mut i32) (i32.const 0))

  ;; write one byte as two lowercase hex digits
  (func $hexByte (param $b i32)
    (i32.store8 (global.get $out)
      (i32.load8_u (i32.add (i32.const $mem.emitterHtml) (i32.shr_u (local.get $b) (i32.const 4)))))
    (i32.store8 offset=1 (global.get $out)
      (i32.load8_u (i32.add (i32.const $mem.emitterHtml) (i32.and (local.get $b) (i32.const 15)))))
    (global.set $out (i32.add (global.get $out) (i32.const 2))))

  ;; write the record's color as CSS hex text: `#rrggbb`, or `#rrggbbaa` when
  ;; the alpha is not opaque - 9 bytes max
  (func $emitColor (param $rec i32)
    (local $a i32)
    (i32.store8 (global.get $out) (i32.const "#"))
    (global.set $out (i32.add (global.get $out) (i32.const 1)))
    (call $hexByte (i32.load8_u (local.get $rec)))
    (call $hexByte (i32.load8_u offset=1 (local.get $rec)))
    (call $hexByte (i32.load8_u offset=2 (local.get $rec)))
    (local.set $a (i32.load8_u offset=3 (local.get $rec)))
    (if (i32.ne (local.get $a) (i32.const 0xff))
      (then (call $hexByte (local.get $a)))))

  ;; Write `var(--cha-SUFFIX)` for $hl using the generated token table.
  (func $emitCssVariable (param $hl i32)
    (local $entry i32)
    (local $n i32)
    (memory.copy
      (global.get $out) (i32.const $mem.emitterHtml+111) (i32.const 10))
    (global.set $out (i32.add (global.get $out) (i32.const 10)))
    (local.set $entry
      (i32.add (i32.const $mem.tokenCssTable)
        (i32.mul (local.get $hl) (i32.const 3))))
    (local.set $n (i32.load8_u offset=2 (local.get $entry)))
    (memory.copy
      (global.get $out)
      (i32.load16_u (local.get $entry))
      (local.get $n))
    (global.set $out (i32.add (global.get $out) (local.get $n)))
    (i32.store8 (global.get $out) (i32.const ")"))
    (global.set $out (i32.add (global.get $out) (i32.const 1))))

  ;; write the record's font attributes: `;font-style:italic` and/or
  ;; `;font-weight:N00` - 34 bytes max
  (func $emitFont (param $style i32)
    (local $w i32)
    (if (i32.and (local.get $style) (i32.const 0x10))
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+80) (i32.const 18))
        (global.set $out (i32.add (global.get $out) (i32.const 18)))))
    (local.set $w (i32.and (local.get $style) (i32.const 15)))
    (if (local.get $w)
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+98) (i32.const 13))
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
    (if (i32.eq (memory.grow
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

  ;; write `<span style="...">` for $hl at $out. The bytes come from a per-run
  ;; cache at $mem.spanCache (73 slots of [len:u8, fragment:u8*65]) rendered on
  ;; first use, so a style's colors are hex-formatted once per run, not per
  ;; span. $hlBegin clears the cache; the theme table is fixed within a run.
  (func $emitSpanOpen (param $hl i32)
    (local $slot i32)
    (local $len i32)
    (local $save i32)
    (local $rec i32)
    (local.set $slot
      (i32.add (i32.const $mem.spanCache)
        (i32.mul (local.get $hl) (i32.const 66))))
    (local.set $len (i32.load8_u (local.get $slot)))
    (if (i32.eqz (local.get $len))
      (then
        ;; render into the slot through the shared $out-based writers
        (local.set $save (global.get $out))
        (global.set $out (i32.add (local.get $slot) (i32.const 1)))
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+44) (i32.const 19))
        (global.set $out (i32.add (global.get $out) (i32.const 19)))
        (if (global.get $cssVariables)
          (then (call $emitCssVariable (local.get $hl)))
          (else
            (local.set $rec (call $themeRec (local.get $hl)))
            (call $emitColor (local.get $rec))
            (call $emitFont (i32.load8_u offset=4 (local.get $rec)))))
        (i32.store16 (global.get $out) (i32.const 0x3e22)) ;; `">`
        (global.set $out (i32.add (global.get $out) (i32.const 2)))
        (local.set $len (i32.sub (global.get $out) (i32.add (local.get $slot) (i32.const 1))))
        (i32.store8 (local.get $slot) (local.get $len))
        (global.set $out (local.get $save))))
    (memory.copy (global.get $out)
      (i32.add (local.get $slot) (i32.const 1)) (local.get $len))
    (global.set $out (i32.add (global.get $out) (local.get $len))))

  ;; switch the open span to $hl's color/font. adjacent tokens whose records
  ;; hold identical bytes share one span (a 40-bit compare), so runs of
  ;; same-styled tokens and the whitespace between them do not churn spans.
  ;; caller has ensured capacity for close (7) + open (19 + 9 + 34 + 2).
  (func $setSpan (param $hl i32)
    (local $val i64)
    (if (i32.eq (local.get $hl) (global.get $spanHl)) (then (return)))
    (global.set $spanHl (local.get $hl))
    ;; Token identity is the style in CSS-variable mode; otherwise compare the
    ;; whole packed five-byte theme record.
    (local.set $val
      (if (result i64) (global.get $cssVariables)
        (then (i64.extend_i32_u (local.get $hl)))
        (else
          (i64.and
            (i64.load (call $themeRec (local.get $hl)))
            (i64.const 0xFFFFFFFFFF)))))
    (if (i64.eq (local.get $val) (global.get $spanVal)) (then (return)))
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
  ;; caller has ensured capacity for 5*($rhs-$lhs) + 16.
  (func $escCopy (param $lhs i32) (param $rhs i32)
    (local $c i32)
    (local $mask i32)
    (local $k i32)
    (local $rem i32)
    (local $w v128)
    (block $done
      (loop $outer
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (block $special
          (loop $wide
            (local.set $w (v128.load (local.get $lhs)))
            (local.set $mask (i8x16.bitmask (v128.or
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "&")))
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const "<"))))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const ">"))))))
            (local.set $rem (i32.sub (local.get $rhs) (local.get $lhs)))
            ;; ignore specials past $rhs
            (if (i32.lt_u (local.get $rem) (i32.const 16))
              (then (local.set $mask (i32.and (local.get $mask)
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
    (call $ensureCap (i32.const 16))
    (if (i32.and
          (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
          (i32.eq (i32.load (i32.sub (global.get $out) (i32.const 4))) (local.get $hl)))
      (then
        (i32.store (i32.sub (global.get $out) (i32.const 8))
          (i32.sub (local.get $rhs) (global.get $srcBase)))
        (return)))
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
      (then
        (global.set $recCarryHl
          (i32.load (i32.sub (global.get $out) (i32.const 4)))))))

  ;; Append a line-aware `(endUtf16:u32, hl:u32)` record. Token id -1 marks a
  ;; line terminator and ends after it. Other equal neighbors merge.
  (func $recLineWrite (param $hl i32) (param $end i32)
    (local $start i32)
    (call $ensureCap (i32.const 16))
    (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
      (then
        (local.set $start (i32.load (i32.sub (global.get $out) (i32.const 8))))))
    (if (i32.le_u (local.get $end) (local.get $start)) (then (return)))
    (if (i32.and
          (i32.ne (local.get $hl) (i32.const -1))
          (i32.and
            (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
            (i32.eq (i32.load (i32.sub (global.get $out) (i32.const 4))) (local.get $hl))))
      (then
        (i32.store (i32.sub (global.get $out) (i32.const 8)) (local.get $end))
        (return)))
    (i32.store (global.get $out) (local.get $end))
    (i32.store offset=4 (global.get $out) (local.get $hl))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  ;; Remove a trailing CR from the preceding content record before a CRLF
  ;; marker. The CR and LF are both covered by the marker.
  (func $recLineTrim (param $end i32)
    (local $last i32)
    (local $prev i32)
    (if (i32.le_u (global.get $out) (i32.load (i32.const 6))) (then (return)))
    (local.set $last (i32.sub (global.get $out) (i32.const 8)))
    (if (i32.eq (i32.load offset=4 (local.get $last)) (i32.const -1)) (then (return)))
    (if (i32.le_u (i32.load (local.get $last)) (local.get $end)) (then (return)))
    (if (i32.gt_u (local.get $last) (i32.load (i32.const 6)))
      (then (local.set $prev (i32.load (i32.sub (local.get $last) (i32.const 8))))))
    (if (i32.le_u (local.get $end) (local.get $prev))
      (then (global.set $out (local.get $last)))
      (else (i32.store (local.get $last) (local.get $end)))))

  ;; Scan newly emitted input bytes once, converting ends to UTF-16 and
  ;; splitting token records at LF/CRLF boundaries.
  (func $recLineTok (param $hl i32) (param $rhs i32)
    (local $p i32)
    (local $char i32)
    (local $b i32)
    (local $cut i32)
    (local $step i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    (local.set $p (global.get $recByte))
    (local.set $char (global.get $recChar))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $rhs)))
        ;; hop over plain ASCII - anything except LF and non-ASCII counts as
        ;; one UTF-16 unit, CR included - 16 bytes per step. Wide loads may
        ;; pass $rhs into the following record or the buffer slack; matches
        ;; there are masked off.
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (i8x16.lt_s (local.get $w) (i8x16.splat (i32.const 0)))
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10))))))
        (local.set $rem (i32.sub (local.get $rhs) (local.get $p)))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then (local.set $mask (i32.and (local.get $mask)
            (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (if (i32.eqz (local.get $mask))
          (then
            (local.set $step (select
              (local.get $rem) (i32.const 16)
              (i32.lt_u (local.get $rem) (i32.const 16))))
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
            (if (i32.and
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
            (local.set $step (i32.const 1))
            (if (i32.ge_u (local.get $b) (i32.const 0x80))
              (then
                (local.set $step (i32.const 2))
                (if (i32.ge_u (local.get $b) (i32.const 0xe0))
                  (then (local.set $step (i32.const 3))))
                (if (i32.ge_u (local.get $b) (i32.const 0xf0))
                  (then
                    (local.set $step (i32.const 4))
                    (local.set $char (i32.add (local.get $char) (i32.const 1)))))))
            (local.set $p (i32.add (local.get $p) (local.get $step)))
            (local.set $char (i32.add (local.get $char) (i32.const 1)))))
        (br $scan)))
    (call $recLineWrite (local.get $hl) (local.get $char))
    (global.set $recByte (local.get $rhs))
    (global.set $recChar (local.get $char)))

  ;; Convert byte-end token records to line-aware UTF-16 records after lexing.
  ;; Keeping the original emission order first preserves malformed-input cases
  ;; where a lexer temporarily emits a non-forward range.
  (func $recLinesPost
    (local $rec i32)
    (local $oldEnd i32)
    (local $rhs i32)
    (local.set $rec (i32.load (i32.const 6)))
    (local.set $oldEnd (global.get $out))
    (global.set $out
      (i32.and (i32.add (local.get $oldEnd) (i32.const 15)) (i32.const -16)))
    (i32.store (i32.const 6) (global.get $out))
    (global.set $recByte (global.get $srcBase))
    (global.set $recChar (i32.const 0))
    (block $done
      (loop $records
        (br_if $done (i32.ge_u (local.get $rec) (local.get $oldEnd)))
        (local.set $rhs (i32.load (local.get $rec)))
        (if (i32.gt_u
              (local.get $rhs)
              (i32.sub (global.get $recByte) (global.get $srcBase)))
          (then
            (call $recLineTok
              (i32.load offset=4 (local.get $rec))
              (i32.add (global.get $srcBase) (local.get $rhs)))))
        (local.set $rec (i32.add (local.get $rec) (i32.const 8)))
        (br $records))))

  ;; emit the token bytes [$lhs,$rhs) styled as $hl
  (func $emitTok (param $hl i32) (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs)) (then (return)))
    (if (global.get $tokens)
      (then
        (call $recTok (local.get $hl) (local.get $rhs))
        (return)))
    (call $ensureCap (i32.add
      (i32.mul (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
      (i32.const 96)))
    (call $setSpan (local.get $hl))
    (call $escCopy (local.get $lhs) (local.get $rhs)))

  ;; emit inter-token bytes [$lhs,$rhs) (whitespace) without touching the open
  ;; span, so same-colored neighbors merge across the gap
  (func $emitGap (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs)) (then (return)))
    (if (global.get $tokens)
      (then
        ;; a gap keeps the open record's style, mirroring HTML span merging
        (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
          (then (i32.store (i32.sub (global.get $out) (i32.const 8))
            (i32.sub (local.get $rhs) (global.get $srcBase))))
          (else (call $recTok (enum.get $Token.none) (local.get $rhs))))
        (return)))
    (call $ensureCap (i32.add
      (i32.mul (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
      (i32.const 16)))
    (call $escCopy (local.get $lhs) (local.get $rhs)))

  ;; Keep a span open when a bounded range resumes inside a UTF-8 code point.
  ;; Lives here rather than in common.wat so the lexers that import only
  ;; token/scan/emit can reach it too.
  (func $lexEmitLeadingContinuation
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
    (call $emitGap (local.get $lhs) (global.get $ptr)))

  ;; `<pre class="chamele" style="background-color:BG;color:FG"><code>`
  (func $prologue
    (local $rec i32)
    (call $ensureCap (i32.const 128))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+16) (i32.const 28))
    (global.set $out (i32.add (global.get $out) (i32.const 28)))
    (local.set $rec (call $themeRec (enum.get $Token.background)))
    (if (i32.or (global.get $cssVariables) (i32.load (local.get $rec)))
      (then
        (memory.copy (global.get $out) (i32.const $mem.emitterHtml+63) (i32.const 17))
        (global.set $out (i32.add (global.get $out) (i32.const 17)))
        (if (global.get $cssVariables)
          (then (call $emitCssVariable (enum.get $Token.background)))
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
            (call $emitCssVariable (enum.get $Token.foreground))
            (i32.store8 (global.get $out) (i32.const ";"))
            (global.set $out (i32.add (global.get $out) (i32.const 1))))
          (else (call $emitColor (local.get $rec))))))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+121) (i32.const 8))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  ;; `</code></pre>`
  (func $epilogue
    (call $closeSpan)
    (call $ensureCap (i32.const 32))
    (memory.copy (global.get $out) (i32.const $mem.emitterHtml+129) (i32.const 13))
    (global.set $out (i32.add (global.get $out) (i32.const 13))))

  ;; driver prologue shared by chamele.wat and the per-language test harnesses:
  ;; read the control block ([1]: 0 inline colors, 1 CSS variables, 2 byte-end
  ;; token records, 3 UTF-16 line records), place the output, emit the wrapper
  (func $hlBegin
    (global.set $cssVariables (i32.eq (i32.load8_u (i32.const 1)) (i32.const 1)))
    (global.set $tokens (i32.ge_u (i32.load8_u (i32.const 1)) (i32.const 2)))
    (global.set $tokenLines (i32.eq (i32.load8_u (i32.const 1)) (i32.const 3)))
    (global.set $eof (i32.add (global.get $srcBase) (i32.load (i32.const 2))))
    (global.set $end (global.get $eof))
    (global.set $ptr (global.get $srcBase))
    (global.set $out (i32.and (i32.add (global.get $eof) (i32.const 47)) (i32.const -16)))
    (i32.store (i32.const 6) (global.get $out))
    (global.set $cap (i32.sub (i32.mul (memory.size) (i32.const 65536)) (i32.const 16)))
    (global.set $spanHl (i32.const -1))
    (global.set $spanVal (i64.const 0))
    (if (i32.eqz (global.get $tokens))
      (then
        ;; invalidate the span-open fragment cache: the theme table may have
        ;; changed since the previous run (73 slots x 66 bytes)
        (memory.fill (i32.const $mem.spanCache) (i32.const 0) (i32.const 4818))
        (call $prologue))))

  ;; driver epilogue: emit the wrapper closing and publish the result
  (func $hlEnd
    (if (i32.eqz (global.get $tokens)) (then (call $epilogue)))
    (if (global.get $tokenLines) (then (call $recLinesPost)))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (i32.load (i32.const 6)))))
)
