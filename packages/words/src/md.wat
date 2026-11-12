(module
  (;;
    memory structure
    [] page 1 (control block and static tables)
      [0]             render mode (u8): 0 = html, 1 = ansi
      [1]             option flags (u8): bit 0 = frontmatter, bit 1 = skip raw HTML,
                      bit 2 = repair a delivery-ending closed link label,
                      bit 3 = session render: measure the boundary in UTF-16
                      units and mark an open fence,
                      bit 4 = completion appended a pending link destination,
                      bit 5 = ansi input is bytes and may hold invalid UTF-8,
                      bit 6 = complete unfinished inline syntax
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:18)         frontmatter JSON start (u32 LE, 0 when absent)
      [18:22)         frontmatter JSON length (u32 LE)
      [22:26)         ansi wrap width (u32 LE, 0 = no wrapping)
      [30]            document contains global definitions
      [36:40)         UTF-16 length of the input before the boundary (option bit 3)
      [40:44)         UTF-16 length of the output before the boundary (option bit 3)
      [48:64)         decimal conversion scratch
      [64:80)         hex digits
      [80:$mem.input) static tables and fixed work areas, in this order (see
                      memory.wat for the addresses): pooled output string
                      literals, scanner byte tables, HTML5 named character
                      references and their immutable index, Unicode P|S ranges,
                      Unicode case folding, HTML block tag names and the GFM
                      tag filter list, Unicode display width ranges, ansi marker
                      fragments and SGR depth counters, the block analysis
                      container stack (render reuses it as the type/tightness
                      stack, then opener bottoms, tick memo, and the bracket
                      stack; completion uses it for its two stacks), table
                      column widths, the ansi line prefix and pending marker,
                      ansi list state, and the packed Unicode range tables
    [] pages 2..N (text buffer)
      [$mem.input:EOF) input, a NUL sentinel, then at least 32 bytes of slack
      [meta:rec)      frontmatter JSON
      [rec:out)       block records, the reference hash table, the footnote order,
                      and temporary ANSI table measurements when needed
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

  ;; Analyze the blocks of the input in [$mem.input, $mem.input + length).
  ;; Returns the input length before the last safe append boundary. Bit 31 is
  ;; set when completion is on and the last block is the first one in a list
  ;; item. $render calls this twice, which also keeps the hot line loop in a
  ;; function of its own.
  (func $analyze (result i32)
    (local $start i32)
    (local $fmClose i32)
    (local $fmMeta i32)
    (local $blockStart i32)
    (local $blockEnd i32)
    (local $safeEnd i32)
    (global.set $boundaryRec (i32.const 0))
    (i32.store8 (i32.const 30) (i32.const 0))
    (global.set $mode (i32.load8_u (i32.const 0)))
    (global.set $tableHead (i32.const 0))
    (global.set $eof (i32.add (i32.const $mem.input) (i32.load (i32.const 2))))
    (global.set $src (i32.const $mem.input))
    ;; a UTF-8 byte order mark is not content
    (if (i32.eq (i32.and (i32.load (i32.const $mem.input)) (i32.const 0xffffff)) (i32.const "\ef\bb\bf"))
      (then (global.set $src (i32.const $mem.input+3))))
    (global.set $wrap (i32.load (i32.const 22)))
    (if (i32.and (i32.load8_u (i32.const 1)) (i32.const 32))
      (then (call $ansiScrubInput)))
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
    (global.set $leafRec (i32.const 0))
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
    ;; each later line starts past the first-nonspace memo of the line before
    (global.set $fns (i32.const 0))
    (global.set $idleBlank (i32.const 0))
    (local.set $blockStart (global.get $src))
    (block $blocksDone
      (loop $blockLine
        (block $boundary
          (br_if $blocksDone (i32.ge_u (local.get $blockStart) (global.get $eof)))
          (if (i32.eqz (global.get $sp))
            (then
              ;; A document-level empty LF line closes ordinary leaves at once;
              ;; this boundary needs no indentation scan or container state.
              (if (i32.and (i32.eq (i32.load8_u (local.get $blockStart)) (i32.const 10))
                    (call $blankEndsLeaf))
                (then
                  (call $closeLeaf)
                  (local.set $blockStart (i32.add (local.get $blockStart) (i32.const 1)))
                  (br $boundary)))
              (if (i32.eqz (i32.or (global.get $mode) (global.get $leaf)))
                (then
                  (if (i32.eqz (call $mayStartBlock (i32.load8_u (local.get $blockStart))))
                    (then
                      (local.set $blockStart (call $startPlainParagraphRun (local.get $blockStart)))
                      (br $blockLine)))))))
          (local.set $blockEnd (call $findLineEnd (local.get $blockStart)))
          (global.set $lineEnd (local.get $blockEnd))
          (global.set $pos (local.get $blockStart))
          (global.set $col (i32.const 0))
          (global.set $ptab (i32.const 0))
          (global.set $allMatched (i32.const 1))
          (global.set $lastMatched (i32.const 0))
          (global.set $closed (i32.const 0))
          (global.set $skipLine (i32.const 0))
          ;; Two or more call sites keep the line phases out of this loop, which
          ;; leaves the engine budget to inline their small helpers.
          (block $lineDone
            (if (i32.eq (global.get $leaf) (enum.get $Blk.code))
              (then
                (if (call $tryCodeRun)
                  (then
                    (local.set $blockEnd (global.get $lineEnd))
                    (br $lineDone)))))
            (if (i32.eqz (global.get $sp))
              (then
                (call $findFirstNonspace)
                (if (global.get $blank)
                  (then
                    (if (call $blankEndsLeaf)
                      (then
                        (call $closeLeaf)
                        (br $lineDone))))
                  (else
                    ;; At document depth phase 1 only confirms an open paragraph.
                    (if (i32.eq (global.get $leaf) (enum.get $Blk.p))
                      (then
                        (global.set $lastMatched (i32.const 1))
                        (if (call $tryParagraphContinuation)
                          (then (local.set $blockEnd (global.get $lineEnd)))
                          (else (call $addBlockLine)))
                        (br $lineDone)))
                    (if (i32.eqz (global.get $leaf))
                      (then
                        (call $addBlockLine)
                        (br $lineDone)))))))
            ;; Nested paragraphs still match their container prefixes first.
            ;; The ordinary-text case can then skip block-start scanning and
            ;; generic looseness dispatch, also when the line is a lazy
            ;; continuation.
            (br_if $lineDone (call $matchOpenBlocks))
            (br_if $lineDone (if (result i32)
              (i32.and (global.get $sp) (i32.eq (global.get $leaf) (enum.get $Blk.p)))
              (then (call $tryParagraphContinuation))
              (else (i32.const 0))))
            (call $addBlockLine))
          ;; Freeze only newline-terminated blank lines at document depth. EOF
          ;; closures and open lists/code remain mutable; inline repair touches
          ;; only the last block, so it cannot reach across this boundary.
          ;; $blank also holds after a thematic break or a heading, so the
          ;; line itself must be blank.
          (if (i32.and (i32.and (global.get $blank) (i32.eqz (global.get $sp)))
                (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.none))
                  (i32.lt_u (local.get $blockEnd) (global.get $eof))))
            (then
              (if (i32.ge_u (call $skipSpace (local.get $blockStart) (local.get $blockEnd))
                    (local.get $blockEnd))
                (then
                  (local.set $blockStart (call $lineAfter (local.get $blockEnd)))
                  (br $boundary)))))
          (local.set $blockStart (call $lineAfter (local.get $blockEnd)))
          (br $blockLine))
        ;; a blank line at document depth is a safe append boundary
        (local.set $safeEnd (i32.sub (local.get $blockStart) (i32.const $mem.input)))
        (global.set $boundaryRec (global.get $rec))
        (br $blockLine)))
    ;; Preserve the specific leaf closed by EOF so nested/footnote code blocks
    ;; can expose their incomplete state without guessing from output order.
    (global.set $incompleteCodeRec (i32.const 0))
    (if (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.code))
          (i32.ne (global.get $codeFenceCh) (i32.const 0)))
      (then (global.set $incompleteCodeRec (global.get $leafRec))))
    (call $closeLeaf)
    (if (i32.and (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 64)) (i32.const 0))
          (i32.ne (global.get $sp) (i32.const 0)))
      (then
        (local.set $blockEnd (call $containerAt (global.get $sp)))
        (local.set $safeEnd (i32.or (local.get $safeEnd) (i32.shl
          (i32.and
            (i32.eq (i32.load8_u (local.get $blockEnd)) (enum.get $Blk.li))
            (i32.eq (i32.load offset=$CS.children (local.get $blockEnd)) (i32.const 1)))
          (i32.const 31))))))
    (block $containersDone
      (loop $closeContainers
        (br_if $containersDone (i32.eqz (global.get $sp)))
        (call $closeContainer)
        (br $closeContainers)))
    (call $linkIndex)
    (i32.store8 (i32.const 30) (i32.ne (global.get $linkHash) (i32.const 0)))
    (local.get $safeEnd))

  ;; Expand the immutable lookup tables once, at instantiation.
  (func $init
    (call $unpackEntities)
    (drop (call $unpackRanges
      (call $unpackRanges
        (call $unpackRanges (i32.const $mem.packed) (i32.const $mem.punct))
        (i32.const $mem.width))
      (i32.const $mem.wide))))
  (start $init)

  ;; Render the input in [$mem.input, $mem.input + length) and publish the result.
  (func $render (export "render")
    (local $safeEnd i32)
    (local.set $safeEnd (call $analyze))
    ;; Completion reads the finished block structure and definitions. When it
    ;; changes the input, those are stale, so analyze the repaired input.
    (if (i32.and (i32.load8_u (i32.const 1)) (i32.const 64))
      (then
        (i32.store8 (i32.const 1) (i32.and (i32.load8_u (i32.const 1)) (i32.const 191)))
        (if (call $complete (i32.shr_u (local.get $safeEnd) (i32.const 31)))
          (then (local.set $safeEnd (call $analyze))))))
    (global.set $out (i32.and (i32.add (global.get $rec) (i32.const 15)) (i32.const -16)))
    (call $setOutCap)
    (if (global.get $mode) (then (call $ansiTableSpace)))
    (global.set $outBase (global.get $out))
    (global.set $boundaryOut (global.get $outBase))
    (call $renderBlocks)
    (i32.store (i32.const 6) (global.get $outBase))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (global.get $outBase)))
    ;; Sessions measure the boundary in UTF-16 units instead of decoding prefixes.
    ;; With global definitions they render whole documents and need no boundary.
    (if (i32.and (i32.ne (i32.and (i32.load8_u (i32.const 1)) (i32.const 8)) (i32.const 0))
          (i32.eqz (global.get $linkHash)))
      (then
        (i32.store (i32.const 36) (call $utf16Length (i32.const $mem.input)
          (i32.add (i32.const $mem.input) (i32.and (local.get $safeEnd) (i32.const 0x7fffffff)))))
        (i32.store (i32.const 40) (call $utf16Length (global.get $outBase) (global.get $boundaryOut))))))
)
