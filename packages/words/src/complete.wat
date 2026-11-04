(module
  (import "./memory.wat")
  (import "./scan.wat")
  (import "./frontmatter.wat")
  (import "./blockscan.wat")

  ;; The original EOF locates a pending label even in rebuilt inline content.
  (global $completeClosedLabelEnd (mut i32) (i32.const 0))
  ;; The line after the last blank line that completion scanned inside a fence,
  ;; or 0. Completion keeps its state there, but the parser may have closed that
  ;; fence already, so the render that follows reports no safe append boundary
  ;; at or before this line.
  (global $completeFenceBlank (mut i32) (i32.const 0))

  ;; Write the closers of delimiter stack entries [$bottom, $top) at $at,
  ;; innermost first, and return the position after them.
  (func $completeClosers (param $at i32) (param $stack i32) (param $bottom i32) (param $top i32) (result i32)
    (local $e i32)
    (local $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.le_u (local.get $top) (local.get $bottom)))
        (local.set $top (i32.sub (local.get $top) (i32.const 1)))
        (local.set $e (i32.add (local.get $stack) (i32.shl (local.get $top) (i32.const 3))))
        (local.set $n (i32.load offset=4 (local.get $e)))
        (memory.fill (local.get $at) (i32.load (local.get $e)) (local.get $n))
        (local.set $at (i32.add (local.get $at) (local.get $n)))
        (br $l)))
    (local.get $at))

  ;; Whether inline state cannot continue from the line at $line to the line
  ;; at $next, because a block ends or starts between them. A wrong yes leaves
  ;; an opener literal until the stream closes it. A wrong no writes closers
  ;; into a block that cannot use them, so unclear cases answer yes.
  (func $completeBlockEnds (param $line i32) (param $next i32) (result i32)
    (local $q i32) (local $end i32) (local $n i32) (local $quotes i32) (local $pipe i32)
    ;; The ended line, after its markers: empty, or a heading.
    (local.set $end (call $findLineEnd (local.get $line)))
    (global.set $lineEnd (local.get $end))
    (local.set $q (local.get $line))
    (loop $prefix
      (local.set $q (call $skipSpace (local.get $q) (local.get $end)))
      (if (i32.lt_u (local.get $q) (local.get $end))
        (then
          (if (i32.eq (i32.load8_u (local.get $q)) (i32.const ">"))
            (then
              (local.set $quotes (i32.add (local.get $quotes) (i32.const 1)))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $prefix)))
          (local.set $n (call $parseListMarker (local.get $q) (i32.const 0)))
          (if (local.get $n)
            (then
              (local.set $q (i32.add (local.get $q) (local.get $n)))
              (br $prefix))))))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 1))))
    (if (call $scanAtxStart (local.get $q)) (then (return (i32.const 1))))
    (local.set $pipe (i32.lt_u (call $findByte (local.get $q) (local.get $end) (i32.const "|")) (local.get $end)))
    ;; The next line: a deeper quote, a block that interrupts a paragraph, or a table row.
    (local.set $end (call $findLineEnd (local.get $next)))
    (global.set $lineEnd (local.get $end))
    (local.set $q (local.get $next))
    (loop $quote
      (local.set $q (call $skipSpace (local.get $q) (local.get $end)))
      (if (i32.lt_u (local.get $q) (local.get $end))
        (then
          (if (i32.eq (i32.load8_u (local.get $q)) (i32.const ">"))
            (then
              (local.set $quotes (i32.sub (local.get $quotes) (i32.const 1)))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $quote))))))
    (if (i32.lt_s (local.get $quotes) (i32.const 0)) (then (return (i32.const 1))))
    (if (i32.ge_u (local.get $q) (local.get $end)) (then (return (i32.const 0))))
    (if (i32.or (i32.or (call $parseListMarker (local.get $q) (i32.const 0))
            (call $scanAtxStart (local.get $q)))
          (i32.or (call $scanThematicBreak (local.get $q))
            (call $scanHtmlStart (local.get $q) (i32.const 0))))
      (then (return (i32.const 1))))
    ;; A setext underline.
    (local.set $n (i32.load8_u (local.get $q)))
    (if (i32.or (i32.eq (local.get $n) (i32.const "=")) (i32.eq (local.get $n) (i32.const "-")))
      (then
        (if (i32.ge_u (call $skipSpace (call $runEnd (local.get $q) (local.get $end) (local.get $n)) (local.get $end))
              (local.get $end))
          (then (return (i32.const 1))))))
    (i32.and (local.get $pipe)
      (i32.lt_u (call $findByte (local.get $q) (local.get $end) (i32.const "|")) (local.get $end))))

  ;; Complete the display copy of a streaming input. Fences and inline code
  ;; protect their contents; a bounded delimiter stack supplies only missing
  ;; closing markers. This does not alter the caller's original Markdown.
  (func (export "complete") (result i32)
    (local $p i32) (local $start i32) (local $end i32) (local $stack i32) (local $depth i32)
    (local $c i32) (local $n i32) (local $q i32) (local $prev i32) (local $next i32)
    (local $fence i32) (local $fenceLen i32) (local $fenceCtx i32) (local $fenceCol i32)
    (local $tick i32) (local $line i32) (local $ctx i32) (local $open i32) (local $openDepth i32)
    (local $url i32) (local $image i32) (local $html i32) (local $canOpen i32)
    (local $top i32) (local $remaining i32) (local $closeAt i32) (local $openEnd i32)
    (local $m i32) (local $blk i32) (local $bits i64) (local $hits i64) (local $mm i64)
    (local $w v128) (local $lo v128) (local $hi v128) (local $sel v128) (local $pack v128)
    (local.set $p (i32.const $mem.input))
    (local.set $end (i32.add (local.get $p) (i32.load (i32.const 2))))
    (global.set $eof (local.get $end))
    (global.set $completeFenceBlank (i32.const 0))
    (global.set $hrKill (i32.const 0))
    ;; Repair starts where the parser's markdown starts: after a byte order
    ;; mark and, when that option is on, after the frontmatter block.
    (if (i32.and (i32.ge_u (i32.sub (local.get $end) (local.get $p)) (i32.const 3))
          (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)) (i32.const "\ef\bb\bf")))
      (then (local.set $p (i32.add (local.get $p) (i32.const 3)))))
    (if (i32.and (i32.load8_u (i32.const 1)) (i32.const 1))
      (then
        (local.set $q (call $frontmatterClose (local.get $p)))
        (if (local.get $q)
          (then (local.set $p (call $lineAfter (call $findLineEnd (local.get $q))))))))
    (local.set $start (local.get $p))
    (local.set $line (local.get $p))
    (local.set $stack (i32.add (local.get $end) (i32.const 4096)))
    ;; The scan tables go through memory, so the backend keeps them in registers
    ;; instead of rebuilding the constants in every step. They are loaded
    ;; before the delimiter stack reuses these bytes.
    (v128.store (local.get $stack) (v128.const i8x16 0x10 0 0 0 0 0 0 0 0 0x02 0x03 0x08 0x0c 0x09 0x24 0x08))
    (v128.store offset=16 (local.get $stack) (v128.const i8x16 0x01 0 0x02 0x04 0 0x08 0x10 0x20 0 0 0 0 0 0 0 0))
    (local.set $lo (v128.load (local.get $stack)))
    (local.set $hi (v128.load offset=16 (local.get $stack)))
    (local.set $pack (v128.load (i32.const $mem.lanePack)))
    (block $done
      (loop $scan
        ;; Find the next byte that can change the state. Nibble tables give
        ;; each byte a group bit: 0 = LF CR, 1 = ) *, 2 = < >, 3 = [ \ ] _,
        ;; 4 = `, 5 = ~. Code spans and fences only need groups 0, 4 and 5.
        ;; $hits keeps four bits per byte of the last loaded block, first byte
        ;; highest: bits 3-2 mark any group and bits 1-0 a code group. Stops in
        ;; the same 16 bytes need no new vector work, even when a code span
        ;; opens or closes.
        (local.set $m (i32.or (local.get $fence) (local.get $tick)))
        (local.set $mm (select (i64.const 0x3333333333333333) (i64.const -1) (local.get $m)))
        (block $found
          (if (i32.lt_u (i32.sub (local.get $p) (local.get $blk)) (i32.const 16))
            (then
              (local.set $bits (i64.and (i64.and (local.get $hits) (local.get $mm))
                (i64.shr_u (i64.const -1) (i64.extend_i32_u (i32.shl (i32.sub (local.get $p) (local.get $blk)) (i32.const 2))))))
              (br_if $found (i64.ne (local.get $bits) (i64.const 0)))
              (local.set $p (i32.add (local.get $blk) (i32.const 16)))))
          (local.set $sel (i8x16.splat (select (i32.const 0x31) (i32.const 0x3f) (local.get $m))))
          (loop $wide
            (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
            (local.set $w (v128.load (local.get $p)))
            (local.set $w (v128.and
              (i8x16.swizzle (local.get $lo) (v128.and (local.get $w) (i8x16.splat (i32.const 15))))
              (i8x16.swizzle (local.get $hi) (i8x16.shr_u (local.get $w) (i32.const 4)))))
            (if (i32.eqz (v128.any_true (v128.and (local.get $w) (local.get $sel))))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 16)))
                (br $wide))))
          (local.set $blk (local.get $p))
          (local.set $w (v128.bitselect
            (i8x16.gt_u (local.get $w) (v128.const i64x2 0 0))
            (i8x16.gt_u (v128.and (local.get $w) (i8x16.splat (i32.const 0x31))) (v128.const i64x2 0 0))
            (i8x16.splat (i32.const 0xcc))))
          (local.set $hits (i64x2.extract_lane 0 (i8x16.swizzle (v128.or
            (i16x8.shl (local.get $w) (i32.const 4))
            (i16x8.shr_u (local.get $w) (i32.const 12))) (local.get $pack))))
          (local.set $bits (i64.and (local.get $hits) (local.get $mm))))
        (local.set $p (i32.add (local.get $blk) (i32.wrap_i64 (i64.shr_u (i64.clz (local.get $bits)) (i64.const 2)))))
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (block $next
          (block $newline
            (local.set $c (i32.load8_u (local.get $p)))
            ;; A line ends at LF, or at a CR that no LF follows.
            (br_if $newline (i32.eq (local.get $c) (i32.const 10)))
            (if (i32.eq (local.get $c) (i32.const 13))
              (then
                (br_if $newline (i32.or (i32.eq (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                  (i32.ne (i32.load8_u offset=1 (local.get $p)) (i32.const 10))))
                (br $next)))
            ;; Only a link destination's closing parenthesis matters, and a
            ;; destination never holds a code span or fence.
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (local.get $url)
                  (then
                    ;; Emphasis opened in a link's text cannot close outside it.
                    (if (i32.lt_u (local.get $openDepth) (local.get $depth))
                      (then (local.set $depth (local.get $openDepth))))
                    (local.set $open (i32.const 0)) (local.set $url (i32.const 0))))
                (br $next)))
            ;; Only ASCII punctuation is escaped; `\` before a line end is a hard break.
            (if (i32.and (i32.eqz (i32.or (local.get $fence) (local.get $tick)))
                  (i32.and (i32.eq (local.get $c) (i32.const "\5c"))
                    (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))))
              (then
                (if (call $isAsciiPunct (i32.load8_u offset=1 (local.get $p)))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 2))) (br $scan)))))
            ;; [$p, $q) is the run of $c bytes, used by code and emphasis markers
            (local.set $q (local.get $p))
            (loop $run
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br_if $run (i32.and (i32.lt_u (local.get $q) (local.get $end))
                (i32.eq (i32.load8_u (local.get $q)) (local.get $c)))))
            (local.set $n (i32.sub (local.get $q) (local.get $p)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $c) (i32.const "~")))
              (then
                (if (i32.ge_u (local.get $n) (i32.const 3))
                  (then
                    ;; A fence starts its line after optional quote and list markers.
                    ;; $ctx is 1 after a quote marker, 2 after list markers only, and
                    ;; -1 when other text precedes the run.
                    (local.set $prev (local.get $line))
                    (local.set $ctx (i32.const 0))
                    (block $prefixDone
                      ;; most fences start their line
                      (br_if $prefixDone (i32.eq (local.get $p) (local.get $line)))
                      (loop $prefix
                        (local.set $prev (call $skipSpace (local.get $prev) (local.get $p)))
                        (br_if $prefixDone (i32.ge_u (local.get $prev) (local.get $p)))
                        (local.set $next (i32.load8_u (local.get $prev)))
                        (if (i32.eq (local.get $next) (i32.const ">"))
                          (then
                            (local.set $ctx (i32.const 1))
                            (local.set $prev (i32.add (local.get $prev) (i32.const 1)))
                            (br $prefix)))
                        (local.set $next (local.get $prev))
                        (block $marker
                          (loop $digits
                            (br_if $marker (i32.eqz (call $isDigit (i32.load8_u (local.get $next)))))
                            (local.set $next (i32.add (local.get $next) (i32.const 1)))
                            (br $digits)))
                        (local.set $top (i32.load8_u (local.get $next)))
                        (if (if (result i32) (i32.eq (local.get $next) (local.get $prev))
                              (then (i32.or (i32.eq (local.get $top) (i32.const "-"))
                                (i32.or (i32.eq (local.get $top) (i32.const "+")) (i32.eq (local.get $top) (i32.const "*")))))
                              (else (i32.and (i32.le_u (i32.sub (local.get $next) (local.get $prev)) (i32.const 9))
                                (i32.or (i32.eq (local.get $top) (i32.const ".")) (i32.eq (local.get $top) (i32.const ")"))))))
                          (then
                            (if (call $isSpaceByte (i32.load8_u offset=1 (local.get $next)))
                              (then
                                (if (i32.eqz (local.get $ctx)) (then (local.set $ctx (i32.const 2))))
                                (local.set $prev (i32.add (local.get $next) (i32.const 1)))
                                (br $prefix)))))
                        (local.set $ctx (i32.const -1))))
                    (if (i32.ge_s (local.get $ctx) (i32.const 0))
                      (then
                        (if (local.get $fence)
                          (then
                            ;; A closer has the fence byte and length, then only
                            ;; spaces; it cannot follow markers the opener lacked.
                            (if (i32.and
                                  (i32.and (i32.eq (local.get $c) (local.get $fence))
                                    (i32.ge_u (local.get $n) (local.get $fenceLen)))
                                  (i32.or (i32.eqz (local.get $ctx))
                                    (i32.and (i32.eq (local.get $ctx) (i32.const 1))
                                      (i32.eq (local.get $fenceCtx) (i32.const 1)))))
                              (then
                                (local.set $prev (call $skipSpace (local.get $q) (local.get $end)))
                                (if (i32.or (i32.ge_u (local.get $prev) (local.get $end))
                                      (i32.or (i32.eq (i32.load8_u (local.get $prev)) (i32.const 10))
                                        (i32.eq (i32.load8_u (local.get $prev)) (i32.const 13))))
                                  (then
                                    (local.set $fence (i32.const 0)) (local.set $fenceCtx (i32.const 0))
                                    (local.set $p (local.get $q))
                                    (br $scan))))))
                          (else
                            ;; A backtick fence's info string has no backtick.
                            (local.set $prev (call $findLineEnd (local.get $q)))
                            (if (i32.or (i32.eq (local.get $c) (i32.const "~"))
                                  (i32.ge_u (call $findByte (local.get $q) (local.get $prev) (i32.const "`"))
                                    (local.get $prev)))
                              (then
                                (local.set $fence (local.get $c))
                                (local.set $fenceLen (select (i32.const 255) (local.get $n)
                                  (i32.gt_u (local.get $n) (i32.const 255))))
                                (local.set $fenceCtx (local.get $ctx))
                                (local.set $fenceCol (i32.sub (local.get $p) (local.get $line)))
                                (local.set $depth (i32.const 0)) (local.set $open (i32.const 0))
                                (local.set $url (i32.const 0)) (local.set $tick (i32.const 0))
                                (local.set $p (local.get $q))
                                (br $scan)))))))))
                (if (local.get $fence)
                  (then (local.set $p (local.get $q)) (br $scan)))
                (if (i32.eq (local.get $c) (i32.const "`"))
                  (then
                    ;; Backticks are literal inside a link destination.
                    (if (i32.eqz (local.get $url))
                      (then
                        (if (i32.eqz (local.get $tick))
                          (then (local.set $tick (local.get $n)))
                          (else (if (i32.eq (local.get $tick) (local.get $n))
                            (then (local.set $tick (i32.const 0))))))))
                    (local.set $p (local.get $q)) (br $scan)))))
            (br_if $next (i32.or (local.get $fence) (local.get $tick)))
            (br_if $next (local.get $url))
            (if (i32.and (i32.eq (local.get $c) (i32.const "<"))
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
              (then
                (local.set $next (i32.load8_u offset=1 (local.get $p)))
                (if (i32.or (call $isAlpha (local.get $next)) (i32.eq (local.get $next) (i32.const "/")))
                  (then (local.set $html (local.get $p))))))
            (if (i32.eq (local.get $c) (i32.const ">")) (then (local.set $html (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then
                (local.set $open (local.get $p))
                (local.set $openDepth (local.get $depth))
                (local.set $image (i32.and (i32.gt_u (local.get $p) (local.get $start))
                  (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "!"))))))
            (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $c) (i32.const "]")))
              (then
                (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "(")))
                  (then (local.set $url (i32.add (local.get $p) (i32.const 2))))
                  (else
                    ;; A delivery can stop between a label's `]` and its `(`.
                    ;; Defer repair until inline analysis has ruled out references;
                    ;; changing the input here could corrupt code or definition URLs.
                    (if (i32.and (i32.eqz (local.get $image))
                          (i32.eq (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
                      (then
                        (global.set $completeClosedLabelEnd (local.get $end))
                        ;; The host resets option flags before every render.
                        (i32.store8 (i32.const 1)
                          (i32.or (i32.load8_u (i32.const 1)) (i32.const 4)))))
                    (local.set $open (i32.const 0))))))
            ;; An unfinished HTML tag is discarded below. Its attributes must not
            ;; leave emphasis closers behind in the visible text before that tag.
            (if (i32.and (i32.eqz (local.get $html))
                  (i32.or (i32.eq (local.get $c) (i32.const "*"))
                    (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "~")))))
              (then
                ;; Only `~~` is repaired; a lone `~` is usually "about".
                (if (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.ne (local.get $n) (i32.const 2)))
                  (then (local.set $p (local.get $q)) (br $scan)))
                ;; the input edges count as spaces
                (local.set $prev (if (result i32) (i32.gt_u (local.get $p) (local.get $start))
                  (then (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))) (else (i32.const 32))))
                (local.set $next (if (result i32) (i32.lt_u (local.get $q) (local.get $end))
                  (then (i32.load8_u (local.get $q))) (else (i32.const 32))))
                ;; Intraword underscores and arithmetic asterisks stay literal.
                (local.set $canOpen (i32.and (call $isAlnum (local.get $prev)) (call $isAlnum (local.get $next))))
                (if (i32.and (i32.ne (local.get $depth) (i32.const 0))
                      (i32.eqz (i32.or (local.get $canOpen) (call $isWhiteByte (local.get $prev)))))
                  (then
                    (local.set $top (i32.add (local.get $stack) (i32.shl (i32.sub (local.get $depth) (i32.const 1)) (i32.const 3))))
                    (if (i32.eq (i32.load (local.get $top)) (local.get $c))
                      (then
                        (local.set $remaining (i32.load offset=4 (local.get $top)))
                        (if (i32.ge_u (local.get $n) (local.get $remaining))
                          (then
                            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                            (if (i32.lt_u (local.get $depth) (local.get $openDepth))
                              (then (local.set $openDepth (local.get $depth)))))
                          (else (i32.store offset=4 (local.get $top) (i32.sub (local.get $remaining) (local.get $n)))))
                        (local.set $p (local.get $q)) (br $scan)))))
                (if (i32.eqz (i32.or (i32.or (local.get $canOpen) (call $isWhiteByte (local.get $next)))
                      (i32.or (i32.ge_u (local.get $depth) (i32.const 64)) (i32.gt_u (local.get $n) (i32.const 3)))))
                  (then
                    (local.set $top (i32.add (local.get $stack) (i32.shl (local.get $depth) (i32.const 3))))
                    (i32.store (local.get $top) (local.get $c))
                    (i32.store offset=4 (local.get $top) (local.get $n))
                    (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                    (local.set $openEnd (local.get $q))))
                (local.set $p (local.get $q)) (br $scan)))
            (br $next))
          ;; A blank line ends inline state outside a fence. The line end stops
          ;; this space scan.
          (local.set $q (local.get $line))
          (loop $spaces
            (local.set $c (i32.load8_u (local.get $q)))
            (if (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9)))
              (then (local.set $q (i32.add (local.get $q) (i32.const 1))) (br $spaces))))
          (if (i32.or (i32.eq (local.get $q) (local.get $p))
                (i32.and (i32.eq (i32.add (local.get $q) (i32.const 1)) (local.get $p))
                  (i32.eq (local.get $c) (i32.const 13))))
            (then
              (if (local.get $fence)
                (then (global.set $completeFenceBlank (i32.add (local.get $p) (i32.const 1))))
                (else
                  (local.set $depth (i32.const 0)) (local.set $open (i32.const 0))
                  (local.set $url (i32.const 0)) (local.set $tick (i32.const 0))))))
          ;; Inline state also ends where a block ends without a blank line.
          (if (i32.or (i32.or (local.get $depth) (local.get $tick)) (i32.or (local.get $open) (local.get $url)))
            (then
              (if (call $completeBlockEnds (local.get $line) (i32.add (local.get $p) (i32.const 1)))
                (then
                  (local.set $depth (i32.const 0)) (local.set $open (i32.const 0))
                  (local.set $url (i32.const 0)) (local.set $tick (i32.const 0))))))
          (local.set $line (i32.add (local.get $p) (i32.const 1)))
          (local.set $html (i32.const 0))
          ;; A fence in a quote ends at a line without `>`; one in a list item
          ;; ends at a nonblank line indented less than the fence.
          (if (local.get $fenceCtx)
            (then
              (local.set $q (call $skipSpace (local.get $line) (local.get $end)))
              (if (i32.lt_u (local.get $q) (local.get $end))
                (then
                  (local.set $c (i32.load8_u (local.get $q)))
                  (if (if (result i32) (i32.eq (local.get $fenceCtx) (i32.const 1))
                        (then (i32.ne (local.get $c) (i32.const ">")))
                        (else (i32.and
                          (i32.lt_u (i32.sub (local.get $q) (local.get $line)) (local.get $fenceCol))
                          (i32.and (i32.ne (local.get $c) (i32.const 10)) (i32.ne (local.get $c) (i32.const 13))))))
                    (then (local.set $fence (i32.const 0)) (local.set $fenceCtx (i32.const 0))))))))
        )
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (if (local.get $fence) (then (return (i32.sub (local.get $end) (i32.const $mem.input)))))
    ;; An unfinished HTML tag is dropped with everything that started after it.
    (if (local.get $html)
      (then
        (local.set $end (local.get $html))
        (local.set $tick (i32.const 0))
        (local.set $url (i32.const 0))
        (if (i32.gt_u (local.get $open) (local.get $html)) (then (local.set $open (i32.const 0))))))
    ;; An unfinished image is dropped with what opened in its text. A link keeps
    ;; its text and gets a placeholder destination in place of a partial one.
    (if (local.get $open)
      (then
        (if (local.get $image)
          (then
            (local.set $end (i32.sub (local.get $open) (i32.const 1)))
            (if (i32.lt_u (local.get $openDepth) (local.get $depth))
              (then (local.set $depth (local.get $openDepth))))
            (local.set $tick (i32.const 0))
            (local.set $open (i32.const 0)))
          (else
            (if (local.get $url) (then (local.set $end (i32.sub (local.get $url) (i32.const 2)))))))))
    ;; Code ticks and the closers opened inside a pending link text go before
    ;; trailing whitespace, so spaces between streamed words cannot remove and
    ;; recreate their formatting. Ticks stay on the last line: after a line
    ;; break they could start a fence.
    (if (i32.gt_u (local.get $tick) (i32.const 255)) (then (local.set $tick (i32.const 0))))
    (local.set $prev (select (local.get $openDepth) (i32.const 0) (local.get $open)))
    (local.set $remaining (local.get $tick))
    (local.set $q (local.get $depth))
    (block $sized
      (loop $size
        (br_if $sized (i32.le_u (local.get $q) (local.get $prev)))
        (local.set $q (i32.sub (local.get $q) (i32.const 1)))
        (local.set $remaining (i32.add (local.get $remaining)
          (i32.load offset=4 (i32.add (local.get $stack) (i32.shl (local.get $q) (i32.const 3))))))
        (br $size)))
    (if (i32.or (local.get $remaining) (local.get $open))
      (then
        (local.set $closeAt (local.get $end))
        (block $contentEnd
          (loop $trailingWhite
            (br_if $contentEnd (i32.le_u (local.get $closeAt) (local.get $start)))
            (local.set $c (call $utf8Before (local.get $closeAt) (local.get $start)))
            (br_if $contentEnd (i32.eqz (call $isWhiteCp (local.get $c))))
            (local.set $closeAt (i32.sub (local.get $closeAt)
              (if (result i32) (i32.lt_u (local.get $c) (i32.const 0x80)) (then (i32.const 1))
                (else (if (result i32) (i32.lt_u (local.get $c) (i32.const 0x800))
                  (then (i32.const 2)) (else (i32.const 3)))))))
            (br $trailingWhite)))
        ;; A closing tick run would join a run that ends the content.
        (if (i32.and (i32.ne (local.get $tick) (i32.const 0))
              (i32.eq (i32.load8_u (i32.sub (local.get $closeAt) (i32.const 1))) (i32.const "`")))
          (then
            (local.set $remaining (i32.sub (local.get $remaining) (local.get $tick)))
            (local.set $tick (i32.const 0))))
        (if (local.get $tick)
          (then
            (block $lineEnd
              (loop $sameLine
                (br_if $lineEnd (i32.ge_u (local.get $closeAt) (local.get $end)))
                (local.set $c (i32.load8_u (local.get $closeAt)))
                (br_if $lineEnd (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
                (local.set $closeAt (i32.add (local.get $closeAt) (i32.const 1)))
                (br $sameLine))))
          (else
            ;; An unescaped final `\` would escape what follows it, and it has
            ;; nothing to escape yet. $n is 1 for it, and the closers replace it.
            (local.set $q (local.get $closeAt))
            (loop $slashes
              (if (i32.and (i32.gt_u (local.get $q) (local.get $start))
                    (i32.eq (i32.load8_u (i32.sub (local.get $q) (i32.const 1))) (i32.const "\5c")))
                (then
                  (local.set $q (i32.sub (local.get $q) (i32.const 1)))
                  (br $slashes))))
            (local.set $n (i32.and (i32.sub (local.get $closeAt) (local.get $q)) (i32.const 1)))))
        (if (i32.eqz (local.get $tick))
          (then
            ;; Closers right after their opener would only double it as text.
            (if (i32.eq (i32.sub (local.get $closeAt) (local.get $n)) (local.get $openEnd))
              (then
                (local.set $depth (local.get $prev))
                (local.set $remaining (i32.const 0))))
            ;; A lone `~` is not a closer, but one that ends the content joins the next.
            (if (i32.gt_u (local.get $depth) (local.get $prev))
              (then
                (local.set $top (i32.add (local.get $stack) (i32.shl (i32.sub (local.get $depth) (i32.const 1)) (i32.const 3))))
                (if (i32.and (i32.eq (i32.load (local.get $top)) (i32.const "~"))
                      (i32.eq (i32.load8_u (i32.sub (local.get $closeAt) (i32.const 1))) (i32.const "~")))
                  (then
                    (i32.store offset=4 (local.get $top) (i32.const 1))
                    (local.set $remaining (i32.sub (local.get $remaining) (i32.const 1))))))))
          (else (local.set $n (i32.const 0))))
        ;; With nothing after it to protect, the `\` stays as text.
        (if (i32.eqz (i32.or (local.get $remaining) (local.get $open)))
          (then (local.set $n (i32.const 0))))
        ;; Move the whitespace once, however long it is.
        (memory.copy (i32.sub (i32.add (local.get $closeAt) (local.get $remaining)) (local.get $n))
          (local.get $closeAt) (i32.sub (local.get $end) (local.get $closeAt)))
        (local.set $end (i32.sub (i32.add (local.get $end) (local.get $remaining)) (local.get $n)))
        (local.set $closeAt (i32.sub (local.get $closeAt) (local.get $n)))
        (memory.fill (local.get $closeAt) (i32.const "`") (local.get $tick))
        (drop (call $completeClosers (i32.add (local.get $closeAt) (local.get $tick))
          (local.get $stack) (local.get $prev) (local.get $depth)))))
    (if (local.get $open)
      (then
        ;; $htmlLinkOpen recognizes this destination and writes no URL. Bit 4 says
        ;; that this input holds it; the host resets option flags before every render.
        (i32.store8 (i32.const 1) (i32.or (i32.load8_u (i32.const 1)) (i32.const 16)))
        (i64.store (local.get $end) (i64.const "](stream"))
        (i64.store offset=8 (local.get $end) (i64.const "down:inc"))
        (i64.store offset=16 (local.get $end) (i64.const "omplete-"))
        (i64.store offset=24 (local.get $end) (i64.const "link)"))
        (local.set $end (call $completeClosers (i32.add (local.get $end) (i32.const 29))
          (local.get $stack) (i32.const 0) (local.get $prev)))))
    (i32.sub (local.get $end) (i32.const $mem.input)))
)
