(module
  (;;
    memory structure
    [] page 1 (control block and static tables)
      [0]             render mode (u8): 0 = html, 1 = ansi
      [1]             option flags (u8): bit 0 = frontmatter, bit 1 = skip raw HTML,
                      bit 2 = repair a delivery-ending closed link label
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:18)         frontmatter JSON start (u32 LE, 0 when absent)
      [18:22)         frontmatter JSON length (u32 LE)
      [22:26)         ansi wrap width (u32 LE, 0 = no wrapping)
      [26:30)         safe append boundary (input byte offset)
      [30]            document contains global definitions
      [32:48)         decimal conversion scratch
      [48:64)         hex digits
      [64:1088)       pooled output string literals
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
  (import "./elements.wat")
  (import "./complete.wat")

  (entity-table $mem.entities $mem.entitiesEnd)
  (string-pool $mem.strings $mem.stringsEnd)

  ;; Render the input in [$mem.input, $mem.input + length) and publish the result.
  (func (export "render")
    (local $start i32)
    (local $fmP i32)
    (local $fmBody i32)
    (local $fmE i32)
    (local $fmClose i32)
    (local $fmMeta i32)
    (local $blockStart i32)
    (local $blockEnd i32)
    (local $fastText i32)
    (local $matched i32)
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
        (block $frontDone
          (local.set $fmP (i32.const $mem.input))
          (br_if $frontDone
            (i32.gt_u (i32.add (local.get $fmP) (i32.const 3)) (global.get $eof)))
          (br_if $frontDone
            (i32.ne
              (i32.and (i32.load (local.get $fmP)) (i32.const 0xffffff))
              (i32.const "---")))
          (local.set $fmE (call $findLineEnd (local.get $fmP)))
          (br_if $frontDone
            (i32.lt_u
              (call $skipSpace (i32.add (local.get $fmP) (i32.const 3))
                (local.get $fmE))
              (local.get $fmE)))
          (local.set $fmP (call $lineAfter (local.get $fmE)))
          (local.set $fmBody (local.get $fmP))
          ;; Find a terminating `---` or `...` line.
          (block $foundFrontClose
            (loop $findFrontClose
              (br_if $foundFrontClose
                (i32.ge_u (local.get $fmP) (global.get $eof)))
              (local.set $fmE (call $findLineEnd (local.get $fmP)))
              (if (i32.eq
                    (i32.sub (local.get $fmE) (local.get $fmP)) (i32.const 3))
                (then
                  (if (i32.or
                        (i32.eq
                          (i32.and (i32.load (local.get $fmP)) (i32.const 0xffffff))
                          (i32.const "---"))
                        (i32.eq
                          (i32.and (i32.load (local.get $fmP)) (i32.const 0xffffff))
                          (i32.const "...")))
                    (then
                      (local.set $fmClose (local.get $fmP))
                      (br $foundFrontClose)))))
              (local.set $fmP (call $lineAfter (local.get $fmE)))
              (br $findFrontClose)))
          (br_if $frontDone (i32.eqz (local.get $fmClose)))
          (global.set $yEnd (local.get $fmClose))
          (global.set $yNext (local.get $fmBody))
          (global.set $yDepth (i32.const 0))
          (local.set $fmMeta (global.get $out))
          (call $yTakeLine)
          (call $yParseNode)
          (i32.store (i32.const 14) (local.get $fmMeta))
          (i32.store (i32.const 18)
            (i32.sub (global.get $out) (local.get $fmMeta)))
          (global.set $src
            (call $lineAfter (i32.add (local.get $fmClose) (i32.const 3)))))))
    (global.set $rec (i32.and (i32.add (global.get $out) (i32.const 15)) (i32.const -16)))
    (global.set $recBase (global.get $rec))
    (global.set $sp (i32.const 0))
    (global.set $leaf (enum.get $Blk.none))
    (global.set $linkHash (i32.const 0))
    (global.set $linkMask (i32.const 0))
    (global.set $fnOrder (i32.const 0))
    (global.set $fnTotal (i32.const 0))
    (global.set $fnUsed (i32.const 0))
    (local.set $blockStart (global.get $src))
    (block $blocksDone
      (loop $blockLine
        (br_if $blocksDone (i32.ge_u (local.get $blockStart) (global.get $eof)))
        (local.set $blockEnd (call $findLineEnd (local.get $blockStart)))
        (global.set $lineEnd (local.get $blockEnd))
        (global.set $pos (local.get $blockStart))
        (global.set $col (i32.const 0))
        (global.set $ptab (i32.const 0))
        (global.set $fns (local.get $blockStart))
        (global.set $allMatched (i32.const 1))
        (global.set $lastMatched (i32.const 0))
        (global.set $closed (i32.const 0))
        (global.set $skipLine (i32.const 0))
        (local.set $fastText (i32.const 0))
        (local.set $matched (i32.const 0))
        (if (i32.eqz (global.get $sp))
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
        (local.set $blockStart (call $lineAfter (local.get $blockEnd)))
        ;; Freeze only newline-terminated blank lines at document depth. EOF
        ;; closures and open lists/code remain mutable; inline repair resets at
        ;; a blank line, so it cannot carry delimiters across this boundary.
        (if (i32.and (global.get $blank)
              (i32.and (i32.eqz (global.get $sp))
                (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.none))
                  (i32.lt_u (local.get $blockEnd) (global.get $eof)))))
          (then (i32.store (i32.const 26)
            (i32.sub (local.get $blockStart) (i32.const $mem.input)))))
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
    (call $renderBlocks)
    (i32.store (i32.const 6) (global.get $outBase))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (global.get $outBase))))
)
