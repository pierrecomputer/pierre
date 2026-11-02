(module
  (;;
    memory structure
    [] page 1 (control block and static tables)
      [0]             render mode (u8): 0 = html, 1 = ansi
      [1]             option flags (u8): bit 0 = frontmatter, bit 1 = skip raw HTML,
                      bit 2 = repair a delivery-ending closed link label,
                      bit 3 = measure the boundary in UTF-16 units
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:18)         frontmatter JSON start (u32 LE, 0 when absent)
      [18:22)         frontmatter JSON length (u32 LE)
      [22:26)         ansi wrap width (u32 LE, 0 = no wrapping)
      [26:30)         safe append boundary (input byte offset)
      [30]            document contains global definitions
      [32:36)         output byte offset of the safe append boundary
      [36:40)         UTF-16 length of the input before the boundary (option bit 3)
      [40:44)         UTF-16 length of the output before the boundary (option bit 3)
      [48:64)         decimal conversion scratch
      [64:80)         hex digits
      [80:1088)       pooled output string literals
      [1088:27712)    HTML5 named character references
      [27712:29248)   Unicode P|S code point ranges
      [29248:32576)   Unicode case folding
      [32576:33344)   HTML block tag names and the GFM tag filter list
      [33344:36672)   Unicode display width ranges
      [36672:36744)   ansi marker fragments and SGR depth counters
      [36744:42744)   block analysis container stack; render reuses it as the
                      type/tightness stack, then opener bottoms, tick memo, and
                      the bracket stack
      [42744:44024)   table column widths and alignments
      [44024:45048)   ansi line prefix and pending marker
      [45048:46584)   ansi list state
      [46584:65536)   cached ansi table-cell widths
    [] pages 2..N (text buffer)
      [65536:EOF)     input, a NUL sentinel, then at least 32 bytes of slack
      [meta:rec)      frontmatter JSON
      [rec:out)       block records, the reference hash table, the footnote order
      [out:…)         rendered output
      [scratch:end)   rebuilt block content when needed, and inline marks
  ;;)
  (memory (export "memory") 2)

  (import "./out.wat")
  (import "./scan.wat")
  (import "./entity.wat")
  (import "./link.wat")
  (import "./block.wat")
  (import "./inline.wat")
  (import "./render.wat")
  (import "./frontmatter.wat")
  (import "./complete.wat")

  (entity-table $mem.entities $mem.entitiesEnd)
  (string-pool $mem.strings $mem.stringsEnd)

  ;; The first record after the safe append boundary, and the output position
  ;; the renderer reached there.
  (global $boundaryRec (mut i32) (i32.const 0))
  (global $boundaryOut (mut i32) (i32.const 0))

  ;; Count the UTF-16 code units of the UTF-8 text in [$p, $end): one per byte
  ;; that does not continue a sequence, and one more per four-byte sequence.
  ;; The final vector may read up to 15 bytes past $end.
  (func $utf16Length (param $p i32) (param $end i32) (result i32)
    (local $n i32)
    (local $w v128)
    (local $keep i32)
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $keep (select (i32.const 0xffff)
          (i32.sub (i32.shl (i32.const 1) (i32.sub (local.get $end) (local.get $p))) (i32.const 1))
          (i32.ge_u (i32.sub (local.get $end) (local.get $p)) (i32.const 16))))
        (local.set $n (i32.add (local.get $n) (i32.add
          (i32.popcnt (i32.and (local.get $keep)
            (i8x16.bitmask (i8x16.gt_s (local.get $w) (i8x16.splat (i32.const -65))))))
          (i32.popcnt (i32.and (local.get $keep)
            (i8x16.bitmask (i8x16.ge_u (local.get $w) (i8x16.splat (i32.const 0xf0)))))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (local.get $n))

  ;; Render the input in [$mem.input, $mem.input + length) and publish the result.
  (func (export "render")
    (local $start i32)
    (local $fmClose i32)
    (local $fmMeta i32)
    (local $blockStart i32)
    (local $blockEnd i32)
    (local $fastText i32)
    (local $matched i32)
    (local $fenceBlank i32)
    ;; complete() runs right before this render, so its note belongs to this input
    (local.set $fenceBlank (global.get $completeFenceBlank))
    (global.set $completeFenceBlank (i32.const 0))
    (global.set $boundaryRec (i32.const 0))
    (i32.store (i32.const 26) (i32.const 0))
    (i32.store8 (i32.const 30) (i32.const 0))
    (global.set $mode (i32.load8_u (i32.const 0)))
    (global.set $eof (i32.add (i32.const $mem.input) (i32.load (i32.const 2))))
    (global.set $src (i32.const $mem.input))
    ;; a UTF-8 byte order mark is not content
    (if (i32.eq (i32.and (i32.load (i32.const $mem.input)) (i32.const 0xffffff)) (i32.const "\ef\bb\bf"))
      (then (global.set $src (i32.const $mem.input+3))))
    (global.set $wrap (i32.load (i32.const 22)))
    (i64.store (i32.const 14) (i64.const 0))
    (local.set $start (i32.and (i32.add (global.get $eof) (i32.const 47)) (i32.const -16)))
    (global.set $out (local.get $start))
    (global.set $scratchCap (i32.const 0))
    (global.set $scratchUsed (i32.const 0))
    (global.set $scratchTailUsed (i32.const 0))
    (call $setOutCap)
    ;; the frontmatter JSON is written first and stays below the block records
    (if (i32.and (i32.load8_u (i32.const 1)) (i32.const 1))
      (then
        (local.set $fmClose (call $frontmatterClose (global.get $src)))
        (if (local.get $fmClose)
          (then
            (global.set $yEnd (local.get $fmClose))
            (global.set $yNext (call $lineAfter (call $findLineEnd (global.get $src))))
            (global.set $yDepth (i32.const 0))
            (local.set $fmMeta (global.get $out))
            (call $yTakeLine)
            (call $yParseNode (i32.const -1))
            (i32.store (i32.const 14) (local.get $fmMeta))
            (i32.store (i32.const 18)
              (i32.sub (global.get $out) (local.get $fmMeta)))
            (global.set $src (call $lineAfter (call $findLineEnd (local.get $fmClose))))))))
    (global.set $rec (i32.and (i32.add (global.get $out) (i32.const 15)) (i32.const -16)))
    (global.set $recBase (global.get $rec))
    (global.set $sp (i32.const 0))
    (global.set $leaf (enum.get $Blk.none))
    (global.set $plainRunLiteral (i32.const 0))
    (global.set $linkHash (i32.const 0))
    (global.set $linkMask (i32.const 0))
    (global.set $defHead (i32.const 0))
    (global.set $defTail (i32.const 0))
    (global.set $defCount (i32.const 0))
    (global.set $fnOrder (i32.const 0))
    (global.set $fnTotal (i32.const 0))
    (global.set $fnUsed (i32.const 0))
    (global.set $hrKill (i32.const 0))
    (global.set $idleBlank (i32.const 0))
    (local.set $blockStart (global.get $src))
    (block $blocksDone
      (loop $blockLine
        (br_if $blocksDone (i32.ge_u (local.get $blockStart) (global.get $eof)))
        ;; A document-level empty LF line closes ordinary leaves immediately;
        ;; no indentation scan or container state is needed for this boundary.
        (if (i32.and
              (i32.and (i32.eqz (global.get $sp))
                (i32.eq (i32.load8_u (local.get $blockStart)) (i32.const 10)))
              (i32.and (i32.ne (global.get $leaf) (enum.get $Blk.code))
                (i32.or (i32.ne (global.get $leaf) (enum.get $Blk.html))
                  (i32.gt_u (global.get $htmlKind) (i32.const 5)))))
          (then
            (call $closeLeaf)
            (local.set $blockStart (i32.add (local.get $blockStart) (i32.const 1)))
            (if (i32.gt_u (local.get $blockStart) (local.get $fenceBlank))
              (then
                (i32.store (i32.const 26)
                  (i32.sub (local.get $blockStart) (i32.const $mem.input)))
                (global.set $boundaryRec (global.get $rec))))
            (br $blockLine)))
        (if (i32.eqz (i32.or (global.get $mode)
              (i32.or (global.get $sp) (global.get $leaf))))
          (then
            (if (i32.eqz (call $mayStartBlock (i32.load8_u (local.get $blockStart))))
              (then
                (local.set $blockStart (call $startPlainParagraphRun (local.get $blockStart)))
                (br $blockLine)))))
        (local.set $blockEnd (call $findLineEnd (local.get $blockStart)))
        (global.set $lineEnd (local.get $blockEnd))
        (global.set $pos (local.get $blockStart))
        (global.set $col (i32.const 0))
        (global.set $ptab (i32.const 0))
        (global.set $fns (i32.const 0))
        (global.set $allMatched (i32.const 1))
        (global.set $lastMatched (i32.const 0))
        (global.set $closed (i32.const 0))
        (global.set $skipLine (i32.const 0))
        (local.set $fastText (i32.const 0))
        (local.set $matched (i32.const 0))
        (if (i32.eq (global.get $leaf) (enum.get $Blk.code))
          (then
            (local.set $fastText (call $tryCodeRun))
            (if (local.get $fastText)
              (then (local.set $blockEnd (global.get $lineEnd))))))
        (if (i32.and (i32.eqz (local.get $fastText)) (i32.eqz (global.get $sp)))
          (then
            (call $findFirstNonspace)
            (if (global.get $blank)
              (then
                (if (i32.and
                      (i32.ne (global.get $leaf) (enum.get $Blk.code))
                      (i32.or
                        (i32.ne (global.get $leaf) (enum.get $Blk.html))
                        (i32.gt_u (global.get $htmlKind) (i32.const 5))))
                  (then
                    (call $closeLeaf)
                    (local.set $fastText (i32.const 1)))))
              (else
                (if (i32.eq (global.get $leaf) (enum.get $Blk.p))
                  (then
                    ;; At document depth the open paragraph is the matched leaf.
                    (global.set $lastMatched (i32.const 1))
                    (local.set $fastText (call $tryParagraphContinuation))
                    (if (local.get $fastText)
                      (then (local.set $blockEnd (global.get $lineEnd))))))))))
        ;; Nested paragraphs still match their container prefixes first. The
        ;; ordinary-text case can then skip block-start scanning and generic
        ;; looseness dispatch, including when the line is a lazy continuation.
        (if (i32.and
              (i32.eqz (local.get $fastText))
              (i32.and (global.get $sp)
                (i32.eq (global.get $leaf) (enum.get $Blk.p))))
          (then
            (local.set $matched (i32.const 1))
            (local.set $fastText (call $matchOpenBlocks))
            (if (i32.eqz (local.get $fastText))
              (then (local.set $fastText (call $tryParagraphContinuation))))))
        (if (i32.eqz (local.get $fastText))
          (then
            (if (i32.eqz (local.get $matched))
              (then (local.set $fastText (call $matchOpenBlocks))))
            (if (i32.eqz (local.get $fastText))
              (then
                (global.set $curLevel (global.get $lastMatched))
                (call $openNewBlocks)
                (call $addTextToContainer)))))
        ;; Freeze only newline-terminated blank lines at document depth. EOF
        ;; closures and open lists/code remain mutable; inline repair resets at
        ;; a blank line, so it cannot carry delimiters across this boundary.
        ;; $blank also holds after a thematic break or an empty heading, so the
        ;; line itself must be blank. Repair keeps its state at blank lines
        ;; inside what it takes for a fence, up to $fenceBlank.
        (if (i32.and (i32.and (global.get $blank) (i32.eqz (global.get $sp)))
              (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.none))
                (i32.lt_u (local.get $blockEnd) (global.get $eof))))
          (then
            (if (i32.ge_u (call $skipSpace (local.get $blockStart) (local.get $blockEnd))
                  (local.get $blockEnd))
              (then
                (local.set $blockStart (call $lineAfter (local.get $blockEnd)))
                (if (i32.gt_u (local.get $blockStart) (local.get $fenceBlank))
                  (then
                    (i32.store (i32.const 26)
                      (i32.sub (local.get $blockStart) (i32.const $mem.input)))
                    (global.set $boundaryRec (global.get $rec))))
                (br $blockLine)))))
        (local.set $blockStart (call $lineAfter (local.get $blockEnd)))
        (br $blockLine)))
    ;; Preserve the specific leaf closed by EOF so nested/footnote code blocks
    ;; can expose their incomplete state without guessing from output order.
    (global.set $incompleteCodeRec (i32.const 0))
    (if (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.code))
          (i32.ne (global.get $codeFenceCh) (i32.const 0)))
      (then (global.set $incompleteCodeRec (global.get $leafRec))))
    (call $closeLeaf)
    (block $containersDone
      (loop $closeContainers
        (br_if $containersDone (i32.eqz (global.get $sp)))
        (call $closeContainer)
        (br $closeContainers)))
    (call $linkIndex)
    (i32.store8 (i32.const 30) (i32.ne (global.get $linkHash) (i32.const 0)))
    (global.set $out (i32.and (i32.add (global.get $rec) (i32.const 15)) (i32.const -16)))
    (global.set $outBase (global.get $out))
    (call $setOutCap)
    (global.set $boundaryOut (global.get $outBase))
    (call $renderBlocks)
    (i32.store (i32.const 6) (global.get $outBase))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (global.get $outBase)))
    (i32.store (i32.const 32) (i32.sub (global.get $boundaryOut) (global.get $outBase)))
    ;; Sessions measure the boundary in UTF-16 units instead of decoding prefixes.
    ;; With global definitions they render whole documents and need no boundary.
    (if (i32.and (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 8)) (i32.const 0))
          (i32.eqz (global.get $linkHash)))
      (then
        (i32.store (i32.const 36) (call $utf16Length (i32.const $mem.input)
          (i32.add (i32.const $mem.input) (i32.load (i32.const 26)))))
        (i32.store (i32.const 40) (call $utf16Length (global.get $outBase) (global.get $boundaryOut))))))
)
