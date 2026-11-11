(module
  (import "./memory.wat")
  (import "./types.wat")
  (import "./scan.wat")
  (import "./out.wat")
  (import "./blockscan.wat")
  (import "./record.wat")
  (import "./link.wat")

  ;; The open container spine. Level 0 is the document; levels 1..$sp are the
  ;; entries in $mem.container; level $sp+1 is the open leaf, when there is one.
  (global $sp (mut i32) (i32.const 0))
  ;; The entry of level $sp. Every push sets it from $sp, so it is valid
  ;; whenever $sp is not zero and needs no reset between renders.
  (global $top (mut i32) (i32.const 0))
  (global $leaf (mut i32) (i32.const 0))     ;; $Blk of the open leaf, or none
  (global $leafRec (mut i32) (i32.const 0))
  (global $leafBlank (mut i32) (i32.const 0))
  (global $plainRunLiteral (mut i32) (i32.const 0)) ;; result of the current run scan
  (global $allMatched (mut i32) (i32.const 0))
  (global $lastMatched (mut i32) (i32.const 0))
  (global $curLevel (mut i32) (i32.const 0))
  (global $closed (mut i32) (i32.const 0))   ;; unmatched blocks already finalized
  (global $skipLine (mut i32) (i32.const 0)) ;; the line was fully consumed by a block start
  ;; The last line was blank from its start and left a deep spine but no leaf
  ;; open. Another blank line then changes no state.
  (global $idleBlank (mut i32) (i32.const 0))
  ;; open fenced code block
  (global $codeFenceCh (mut i32) (i32.const 0))
  (global $codeFenceN (mut i32) (i32.const 0))
  (global $codeFenceOff (mut i32) (i32.const 0))
  (global $htmlKind (mut i32) (i32.const 0))

  (func $containerAt (param $i i32) (result i32)
    (i32.add (i32.const $mem.container)
      (i32.mul (i32.sub (local.get $i) (i32.const 1)) (i32.const $CS.size))))

  ;; Append the current line to the open leaf, invalidating any literal proof
  ;; because this additional content has not passed the whole-run classifier.
  (func $addLine
    (local $beg i32)
    (local $end i32)
    (local $line i32)
    (local $pad i32)
    (local $r i32)
    (local $missing i32)
    (local.set $r (global.get $leafRec))
    (i32.store8 offset=1 (local.get $r)
      (i32.and (i32.load8_u offset=1 (local.get $r))
        (i32.xor (i32.const 255) (i32.const $F.plainInline))))
    (local.set $beg (global.get $pos))
    (if (global.get $ptab)
      (then
        (local.set $pad (i32.sub (i32.const 4) (i32.and (global.get $col) (i32.const 3))))
        (local.set $beg (i32.add (local.get $beg) (i32.const 1)))))
    (if (i32.eq (global.get $leaf) (enum.get $Blk.table))
      (then
        (local.set $missing (i32.sub (i32.load offset=8 (local.get $r))
          (call $countRowCells (local.get $beg) (global.get $lineEnd))))
        (if (i32.gt_s (local.get $missing) (i32.const 0))
          (then (i32.store offset=12 (local.get $r)
            (i32.add (i32.load offset=12 (local.get $r)) (local.get $missing)))))))
    ;; HTML can retain an unindented LF-separated fenced block as one input
    ;; span. ANSI keeps individual lines so it can reapply their prefixes.
    (if (i32.eq (global.get $leaf) (enum.get $Blk.code))
      (then
        (if (i32.and
              (i32.and (i32.eqz (global.get $mode)) (i32.ne (global.get $codeFenceCh) (i32.const 0)))
              (i32.and (i32.eqz (local.get $pad))
                (i32.ne (i32.load offset=$R.nLines (local.get $r)) (i32.const 0))))
          (then
            (local.set $line (i32.sub (global.get $rec) (i32.const $R.line)))
            (local.set $end (call $lineEndOf (local.get $line)))
            (if (i32.and
                  (i32.eq (local.get $beg) (i32.add (local.get $end) (i32.const 1)))
                  (i32.eq (i32.load8_u (local.get $end)) (i32.const 10)))
              (then
                (i32.store offset=4 (local.get $line)
                  (i32.or (global.get $lineEnd)
                    (i32.and (i32.load offset=4 (local.get $line)) (i32.const $R.padMask))))
                (return)))))))
    (if (i32.gt_u (i32.add (global.get $rec) (i32.const $R.line)) (global.get $outCap))
      (then (call $ensureRec (i32.const $R.line))))
    (i64.store (global.get $rec) (i64.or (i64.extend_i32_u (local.get $beg))
      (i64.shl (i64.extend_i32_u (i32.or (global.get $lineEnd)
        (i32.shl (local.get $pad) (i32.const 30)))) (i64.const 32))))
    (global.set $rec (i32.add (global.get $rec) (i32.const $R.line)))
    (i32.store offset=$R.nLines (local.get $r)
      (i32.add (i32.load offset=$R.nLines (local.get $r)) (i32.const 1)))
    (call $recGrow (local.get $r) (i32.const $R.line)))

  ;; Add the code lines from $p to $end. HTML keeps an LF-separated span as one
  ;; range; ANSI keeps each line so it can reapply prefixes.
  (func $addCodeLines (param $p i32) (param $end i32)
    (global.set $pos (local.get $p))
    (global.set $lineEnd (local.get $end))
    (if (global.get $mode)
      (then
        (loop $line
          (global.set $lineEnd (call $findLineEnd (global.get $pos)))
          (call $addLine)
          (global.set $pos (i32.add (global.get $lineEnd) (i32.const 1)))
          (br_if $line (i32.lt_u (global.get $lineEnd) (local.get $end)))))
      (else (call $addLine))))

  ;; Unindented top-level fences need no per-line container bookkeeping. Add
  ;; their body up to a line that may close the fence; a closing line is
  ;; consumed here too. A tab before a fence byte stops the body so ordinary
  ;; scanning measures it. A line ending in CR gets its own range, so
  ;; rendering still normalizes the line ending.
  (func $tryCodeRun (result i32)
    (local $start i32)
    (local $stop i32)
    (local $p i32)
    (local $line i32)
    (local $end i32)
    (local $q i32)
    (local $close i32)
    (if (i32.or (global.get $sp)
          (i32.or (i32.eqz (global.get $codeFenceCh)) (global.get $codeFenceOff)))
      (then (return (i32.const 0))))
    (local.set $start (global.get $pos))
    (local.set $p (local.get $start))
    (local.set $stop (local.get $p))
    (block $found
      (loop $scan
        (local.set $stop (call $findCodeRunEnd (local.get $stop) (global.get $eof) (global.get $codeFenceCh)))
        (local.set $line (local.get $stop))
        (br_if $found (i32.ge_u (local.get $stop) (global.get $eof)))
        (if (i32.eq (i32.load8_u (local.get $stop)) (i32.const 13))
          (then
            (call $addCodeLines (local.get $p) (local.get $stop))
            (local.set $p (call $lineAfter (local.get $stop)))
            (local.set $stop (local.get $p))
            (br_if $scan (i32.lt_u (local.get $p) (global.get $eof)))
            (return (i32.const 1))))
        (local.set $line (call $lineStartBefore (local.get $stop) (local.get $p)))
        (local.set $end (call $findLineEnd (local.get $stop)))
        (local.set $q (call $runEnd (local.get $line) (local.get $stop) (i32.const 32)))
        (if (i32.eq (local.get $q) (local.get $stop))
          (then
            (if (i32.le_u (i32.sub (local.get $stop) (local.get $line)) (i32.const 3))
              (then (br_if $found
                (local.tee $close (call $closesFence (local.get $stop) (local.get $end)))))))
          (else (br_if $found (i32.eq (i32.load8_u (local.get $q)) (i32.const 9)))))
        (local.set $stop (local.get $end))
        (br $scan)))
    ;; the body holds the lines before the stopping line or EOF, without the
    ;; last LF; it may be one empty line
    (if (i32.gt_u (local.get $line) (local.get $p))
      (then (call $addCodeLines (local.get $p) (i32.sub (local.get $line)
        (i32.eq (i32.load8_u (i32.sub (local.get $line) (i32.const 1))) (i32.const 10))))))
    (if (local.get $close)
      (then
        (call $closeLeaf)
        (global.set $lineEnd (local.get $end))
        (return (i32.const 1))))
    ;; zero only when no line was added
    (i32.or (i32.gt_u (local.get $line) (local.get $p)) (i32.ne (local.get $p) (local.get $start))))

  ;; Conservative first-byte filter shared by paragraph continuations and new
  ;; blocks. Indentation is checked separately; non-ASCII text cannot open one.
  (func $mayStartBlock (param $ch i32) (result i32)
    (i32.and (i32.lt_u (local.get $ch) (i32.const 128))
      (i64.ne (i64.and
        (i64.shl (i64.const 1) (i64.extend_i32_u (local.get $ch)))
        (select
          (i64.const 0x5000000188000000)
          (i64.const 0x77ff2c0900002600)
          (i32.ge_u (local.get $ch) (i32.const 64))))
        (i64.const 0))))

  ;; A non-block first byte at an empty document spine guarantees a paragraph.
  ;; Scan first, then reserve its header and one or two unpadded ranges together.
  ;; The final physical line stays separate for table conversion. No container
  ;; needs child bookkeeping; store the scan's literal proof on this record.
  (func $startPlainParagraphRun (param $start i32) (result i32)
    (local $bounds i64)
    (local $beg i32)
    (local $end i32)
    (local $n i32)
    (local $size i32)
    (local $r i32)
    (global.set $plainRunLiteral (i32.const 1))
    (local.set $bounds (call $findPlainParagraphRun (local.get $start)))
    (local.set $beg (i32.wrap_i64 (local.get $bounds)))
    (local.set $end (i32.wrap_i64 (i64.shr_u (local.get $bounds) (i64.const 32))))
    (local.set $n (i32.add (i32.const 1)
      (i32.gt_u (local.get $beg) (local.get $start))))
    (local.set $size (i32.add (i32.const $R.header)
      (i32.mul (local.get $n) (i32.const $R.line))))
    (call $ensureRec (local.get $size))
    (local.set $r (global.get $rec))
    (i64.store (local.get $r) (i64.or
      (i64.shl (i64.extend_i32_u (local.get $size)) (i64.const 32))
      (i64.or
        (i64.shl (i64.extend_i32_u (i32.const $R.header)) (i64.const 16))
        (i64.extend_i32_u (enum.get $Blk.p)))))
    (i64.store offset=8 (local.get $r) (i64.const 0))
    (i64.store offset=$R.nLines (local.get $r) (i64.extend_i32_u (local.get $n)))
    (i32.store8 offset=1 (local.get $r)
      (i32.or
        (select (i32.const $F.joinedLines) (i32.const 0) (global.get $plainRunJoined))
        (select (i32.const $F.plainInline) (i32.const 0) (global.get $plainRunLiteral))))
    (if (i32.gt_u (local.get $n) (i32.const 1))
      (then
        (i32.store offset=$R.header (local.get $r) (local.get $start))
        (i32.store offset=$R.header+4 (local.get $r)
          (i32.sub (local.get $beg) (i32.const 1)))))
    (global.set $rec (i32.add (local.get $r) (local.get $size)))
    (i64.store (i32.sub (global.get $rec) (i32.const $R.line)) (local.get $bounds))
    (global.set $leafRec (local.get $r))
    (global.set $leaf (enum.get $Blk.p))
    (global.set $leafBlank (i32.const 0))
    (call $lineAfter (local.get $end)))

  ;; Append an ordinary paragraph continuation after phase 1 has established
  ;; $lastMatched and $findFirstNonspace has populated $fns/$blank. Returns 0
  ;; when phase 2 must still check a possible interrupting block start.
  (func $tryParagraphContinuation (result i32)
    (if (i32.or
          (i32.ne (global.get $leaf) (enum.get $Blk.p))
          (global.get $blank))
      (then (return (i32.const 0))))
    ;; Block markers, table delimiters, and ordered-list digits retain the
    ;; full phase-2 precedence. Everything else can only continue the open p.
    (if (call $mayStartBlock (i32.load8_u (global.get $fns)))
      (then (return (i32.const 0))))
    ;; Lazy lines drop their indentation too.
    (call $advanceToFns (i32.const 0))
    (call $addLine)
    (if (i32.and
          (i32.eqz (global.get $sp))
          (i32.lt_u (global.get $lineEnd) (global.get $eof)))
      (then (call $appendParagraphRun (call $lineAfter (global.get $lineEnd)))))
    (i32.const 1))

  ;; Compact a whole eligible paragraph run, publishing its final two ranges
  ;; once. The newest physical line stays separate for possible table-header
  ;; conversion. No allocation occurs during scanning, so descriptor pointers
  ;; stay valid. Return zero when the lines need the general path.
  (func $tryCompactParagraphRun (param $p i32) (result i32)
    (local $n i32)
    (local $last i32)
    (local $prev i32)
    (local $lastBeg i32)
    (local $lastEnd i32)
    (local $prevEnd i32)
    (local $next i32)
    (local $bound i32)
    (block $separate
      (br_if $separate (global.get $mode))
      (local.set $bound (global.get $eof))
      (br_if $separate (i32.ge_u (local.get $p) (local.get $bound)))
      (br_if $separate (call $mayStartBlock (i32.load8_u (local.get $p))))
      (local.set $n (i32.load offset=$R.nLines (global.get $leafRec)))
      (br_if $separate (i32.lt_u (local.get $n) (i32.const 2)))
      (local.set $last (call $lineAt (global.get $leafRec)
        (i32.sub (local.get $n) (i32.const 1))))
      (local.set $prev (i32.sub (local.get $last) (i32.const $R.line)))
      (local.set $lastEnd (call $lineEndOf (local.get $last)))
      (local.set $prevEnd (call $lineEndOf (local.get $prev)))
      (br_if $separate (i32.ne (local.get $p)
        (i32.add (local.get $lastEnd) (i32.const 1))))
      (br_if $separate (i32.ne (call $lineBeg (local.get $last))
        (i32.add (local.get $prevEnd) (i32.const 1))))
      (br_if $separate (i32.or
        (i32.ne (i32.load8_u (local.get $lastEnd)) (i32.const 10))
        (i32.ne (i32.load8_u (local.get $prevEnd)) (i32.const 10))))
      (i32.store8 offset=1 (global.get $leafRec)
        (i32.and (i32.load8_u offset=1 (global.get $leafRec))
          (i32.xor (i32.const 255) (i32.const $F.plainInline))))
      (block $done
        (loop $line
          (local.set $prevEnd (local.get $lastEnd))
          (local.set $lastBeg (local.get $p))
          (local.set $lastEnd (call $findLineEnd (local.get $p)))
          (local.set $next (call $lineAfter (local.get $lastEnd)))
          (br_if $done (i32.or
            (i32.ge_u (local.get $lastEnd) (local.get $bound))
            (i32.ne (i32.load8_u (local.get $lastEnd)) (i32.const 10))))
          (br_if $done (i32.ge_u (local.get $next) (local.get $bound)))
          (br_if $done (call $mayStartBlock (i32.load8_u (local.get $next))))
          (local.set $p (local.get $next))
          (br $line)))
      (i32.store offset=4 (local.get $prev) (local.get $prevEnd))
      (i32.store (local.get $last) (local.get $lastBeg))
      (i32.store offset=4 (local.get $last) (local.get $lastEnd))
      (call $recFlag (global.get $leafRec) (i32.const $F.joinedLines))
      ;; the caller's line loop continues after this line
      (global.set $lineEnd (local.get $lastEnd))
      (return (local.get $next)))
    (i32.const 0))

  ;; Consume further unindented lines that cannot interrupt the current
  ;; top-level paragraph without rebuilding the phase state.
  (func $appendParagraphRun (param $p i32)
    (local $end i32)
    (if (call $tryCompactParagraphRun (local.get $p)) (then (return)))
    (block $done
      (loop $line
        (br_if $done (i32.ge_u (local.get $p) (global.get $eof)))
        (br_if $done (call $mayStartBlock (i32.load8_u (local.get $p))))
        (local.set $end (call $findLineEnd (local.get $p)))
        (global.set $pos (local.get $p))
        (global.set $lineEnd (local.get $end))
        (global.set $ptab (i32.const 0))
        (call $addLine)
        (local.set $p (call $lineAfter (local.get $end)))
        (br $line))))

  ;; a block was added directly inside the top container
  (func $noteChildAdded
    (local $e i32)
    (local $list i32)
    (local $t i32)
    (if (i32.eqz (global.get $sp)) (then (return)))
    (local.set $e (global.get $top))
    (local.set $t (i32.load8_u (local.get $e)))
    ;; in a list or an item: the list is the entry itself or the one below
    (if (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 2))
      (then
        (local.set $list (i32.sub (local.get $e)
          (i32.mul (i32.eq (local.get $t) (enum.get $Blk.li)) (i32.const $CS.size))))
        (if (i32.and (i32.load8_u offset=$CS.flags (local.get $list)) (i32.const $C.blankPending))
          (then (i32.store8 offset=$CS.flags (local.get $list)
            (i32.or (i32.load8_u offset=$CS.flags (local.get $list)) (i32.const $C.loose)))))))
    (i32.store offset=$CS.children (local.get $e)
      (i32.add (i32.load offset=$CS.children (local.get $e)) (i32.const 1))))

  ;; a block inside the top container was finalized; $endsBlank is the
  ;; recursive "ends with a blank line" predicate for it
  (func $noteChildClosed (param $endsBlank i32)
    (local $e i32)
    (local $t i32)
    (local $list i32)
    (if (i32.eqz (global.get $sp)) (then (return)))
    (local.set $e (global.get $top))
    (i32.store8 offset=$CS.flags (local.get $e)
      (select
        (i32.or (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.lastChildEndsBlank))
        (i32.and (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.clearLastChildEndsBlank))
        (local.get $endsBlank)))
    (if (i32.eqz (local.get $endsBlank)) (then (return)))
    (local.set $t (i32.load8_u (local.get $e)))
    (if (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 2))
      (then
        (local.set $list (i32.sub (local.get $e)
          (i32.mul (i32.eq (local.get $t) (enum.get $Blk.li)) (i32.const $CS.size))))
        (i32.store8 offset=$CS.flags (local.get $list)
          (i32.or (i32.load8_u offset=$CS.flags (local.get $list)) (i32.const $C.blankPending))))))

  (func $openLeaf (param $type i32)
    (global.set $leafRec (call $recNew (local.get $type)))
    (global.set $leaf (local.get $type))
    (global.set $leafBlank (i32.const 0))
    (call $noteChildAdded)
    (global.set $curLevel (i32.add (global.get $sp) (i32.const 1))))

  ;; Does a blank line close the open leaf? Code and HTML kinds 1 to 5 go on.
  (func $blankEndsLeaf (result i32)
    (i32.and (i32.ne (global.get $leaf) (enum.get $Blk.code))
      (i32.or (i32.ne (global.get $leaf) (enum.get $Blk.html))
        (i32.gt_u (global.get $htmlKind) (i32.const 5)))))

  (func $closeLeaf
    (local $t i32)
    (local $n i32)
    (local $line i32)
    (local $end i32)
    (local $beg i32)
    (local $e i32)
    (local $c i32)
    (if (i32.eqz (global.get $leaf)) (then (return)))
    (local.set $t (global.get $leaf))
    (global.set $leaf (enum.get $Blk.none))
    ;; Indented code keeps interior blank lines and trailing spaces, but not
    ;; trailing blank lines.
    (if (i32.or
          (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.p)) (i32.const 1))
          (i32.and (i32.eq (local.get $t) (enum.get $Blk.code)) (i32.eqz (global.get $codeFenceCh))))
      (then (call $rtrimLines (global.get $leafRec) (i32.eq (local.get $t) (enum.get $Blk.code)))))
    (if (i32.eq (local.get $t) (enum.get $Blk.p))
      (then
        (block $task
          ;; Definitions and task markers both start with `[`. Paragraph lines
          ;; never carry tab padding.
          (br_if $task (i32.eqz (i32.load offset=$R.nLines (global.get $leafRec))))
          (local.set $line (call $recLines (global.get $leafRec)))
          (br_if $task (i32.ne (i32.load8_u (call $lineBeg (local.get $line))) (i32.const "[")))
          (call $resolveLinkDefs (global.get $leafRec))
          ;; GFM task list item: the item's first block is a paragraph that
          ;; starts with `[ ]` or `[x]` and whitespace before more content. Drop
          ;; the marker and flag the item; `- [x]` alone stays text.
          (local.set $n (i32.load offset=$R.nLines (global.get $leafRec)))
          (br_if $task (i32.or (i32.eqz (local.get $n)) (i32.eqz (global.get $sp))))
          (local.set $e (global.get $top))
          (br_if $task (i32.ne (i32.load8_u (local.get $e)) (enum.get $Blk.li)))
          (br_if $task (i32.ne (i32.load offset=$CS.children (local.get $e)) (i32.const 1)))
          (local.set $beg (call $lineBeg (local.get $line)))
          (local.set $end (call $lineEndOf (local.get $line)))
          (br_if $task (i32.gt_u (i32.add (local.get $beg) (i32.const 3)) (local.get $end)))
          (br_if $task (i32.ne (i32.load8_u (local.get $beg)) (i32.const "[")))
          (local.set $c (i32.load8_u offset=1 (local.get $beg)))
          (br_if $task (i32.eqz (i32.or
            (i32.eq (local.get $c) (i32.const 32))
            (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "x")))))
          (br_if $task (i32.ne (i32.load8_u offset=2 (local.get $beg)) (i32.const "]")))
          ;; The trimmed first line may end at the marker only if more lines follow.
          (br_if $task (select
            (i32.lt_u (local.get $n) (i32.const 2))
            (i32.eqz (call $isSpaceByte (i32.load8_u offset=3 (local.get $beg))))
            (i32.eq (i32.add (local.get $beg) (i32.const 3)) (local.get $end))))
          (call $recFlag (i32.load offset=$CS.rec (local.get $e))
            (i32.or (i32.const $F.task)
              (i32.mul (i32.ne (local.get $c) (i32.const 32)) (i32.const $F.taskDone))))
          (i32.store (local.get $line) (i32.add (local.get $beg) (i32.const 3))))
        (if (i32.eqz (i32.load offset=$R.nLines (global.get $leafRec)))
          (then (i32.store8 (global.get $leafRec) (enum.get $Blk.none))))))
    (call $noteChildClosed (global.get $leafBlank)))

  ;; close containers until one that can hold a leaf block is on top
  (func $prepareLeafParent
    (local $t i32)
    (block $done
      (loop $l
        (br_if $done (i32.eqz (global.get $sp)))
        (local.set $t (i32.load8_u (global.get $top)))
        (br_if $done (i32.gt_u
          (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 1)))
        (call $closeContainer)
        (br $l))))

  (func $pushContainer (param $type i32) (param $ch i32) (param $indent i32) (param $start i32)
    (local $e i32)
    (local $r i32)
    (if (i32.ge_u (global.get $sp) (i32.const $Nest)) (then (return)))
    (local.set $r (call $recNew (i32.or (local.get $type) (i32.const $F.openerType))))
    (i64.store offset=8 (local.get $r) (i64.or (i64.extend_i32_u (local.get $start))
      (i64.shl (i64.extend_i32_u (local.get $ch)) (i64.const 32))))
    (call $noteChildAdded)
    (global.set $sp (i32.add (global.get $sp) (i32.const 1)))
    (global.set $top (local.tee $e (call $containerAt (global.get $sp))))
    (i32.store (local.get $e) (i32.or
      (local.get $type) (i32.shl (local.get $ch) (i32.const 8))))
    (i32.store offset=$CS.indent (local.get $e) (local.get $indent))
    (i32.store offset=$CS.rec (local.get $e) (local.get $r))
    (i64.store offset=$CS.line (local.get $e)
      (i64.extend_i32_u (global.get $lineEnd)))
    (global.set $curLevel (global.get $sp)))

  ;; Close the top container. Callers check that there is one, and that no
  ;; leaf is open.
  (func $closeContainer
    (local $e i32)
    (local $t i32)
    (local $f i32)
    (local.set $e (global.get $top))
    (local.set $t (i32.load8_u (local.get $e)))
    (local.set $f (i32.load8_u offset=$CS.flags (local.get $e)))
    ;; publish the list's looseness on its opening record
    (if (i32.and (local.get $f) (i32.const $C.loose))
      (then (call $recFlag (i32.load offset=$CS.rec (local.get $e)) (i32.const $F.loose))))
    (drop (call $recNew (i32.or (local.get $t) (i32.const $F.closerType))))
    (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
    (global.set $top (i32.sub (local.get $e) (i32.const $CS.size)))
    ;; ends_with_blank_line descends through lists and items to the last child
    (call $noteChildClosed (i32.and (local.get $f)
      (select (i32.const $C.lastChildEndsBlank) (i32.const $C.lastLineBlank)
        (i32.and
          (i32.ne (i32.load offset=$CS.children (local.get $e)) (i32.const 0))
          (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 2)))))))

  ;; Finalize every block the current line did not match. A leaf that did
  ;; match stays open, unless a new block starts here ($newBlock): then
  ;; nothing that was open can stay open.
  (func $closeUnmatched (param $newBlock i32)
    (local $n i32)
    (if (global.get $closed) (then (return)))
    (global.set $closed (i32.const 1))
    (if (i32.or (local.get $newBlock) (i32.le_u (global.get $lastMatched) (global.get $sp)))
      (then (call $closeLeaf)))
    (local.set $n (global.get $lastMatched))
    (if (i32.gt_u (local.get $n) (global.get $sp)) (then (local.set $n (global.get $sp))))
    (block $done
      (loop $l
        (br_if $done (i32.le_u (global.get $sp) (local.get $n)))
        (call $closeContainer)
        (br $l))))

  ;; remove trailing blank lines and, unless $keepSpace, trailing whitespace
  ;; from the last line, so a hard line break can never sit at the end of a
  ;; block
  (func $rtrimLines (param $r i32) (param $keepSpace i32)
    (local $n i32)
    (local $line i32)
    (local $beg i32)
    (local $end i32)
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (local.set $line (call $lineAt (local.get $r) (local.get $n)))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $n)))
        (local.set $line (i32.sub (local.get $line) (i32.const $R.line)))
        (local.set $beg (call $lineBeg (local.get $line)))
        (local.set $end (call $trimSpaceBack (call $lineEndOf (local.get $line)) (local.get $beg)))
        ;; only code lines carry tab padding, and they keep their spaces
        (if (i32.eqz (local.get $keepSpace))
          (then (i32.store offset=4 (local.get $line) (local.get $end))))
        (br_if $done (i32.gt_u (local.get $end) (local.get $beg)))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (i32.store offset=$R.nLines (local.get $r) (local.get $n))
        (br $l))))

  ;; Does [$p,$end) hold at least $codeFenceN fence bytes and then only
  ;; spaces and tabs, closing the open fence?
  (func $closesFence (param $p i32) (param $end i32) (result i32)
    (local $q i32)
    (local.set $q (call $runEnd (local.get $p) (local.get $end) (global.get $codeFenceCh)))
    (i32.and
      (i32.ge_u (i32.sub (local.get $q) (local.get $p)) (global.get $codeFenceN))
      (i32.ge_u (call $skipSpace (local.get $q) (local.get $end)) (local.get $end))))

  ;; Match a block that continues at $cols columns of indent, or across a
  ;; blank line unless $noBlank.
  (func $matchIndent (param $cols i32) (param $noBlank i32) (result i32)
    (if (i32.and (global.get $blank) (local.get $noBlank)) (then (return (i32.const 0))))
    (if (i32.ge_u (global.get $indent) (local.get $cols))
      (then
        (call $advance (local.get $cols))
        (return (i32.const 1))))
    (if (global.get $blank) (then (call $advanceToFns (i32.const 0))))
    (global.get $blank))

  ;; phase 1: walk the spine, matching each open block's continuation.
  ;; Returns 1 when the line was fully consumed (a closing code fence, a table
  ;; row, or a repeated blank line).
  (func $matchOpenBlocks (result i32)
    (local $i i32)
    (local $e i32)
    (local $t i32)
    (local $n i32)
    (local $start i32)
    (local.set $start (global.get $pos))
    ;; Consume a repeated blank line without the walk over every level.
    (if (global.get $idleBlank)
      (then
        (if (i32.ge_u (call $skipSpace (local.get $start) (global.get $lineEnd)) (global.get $lineEnd))
          (then (return (i32.const 1))))
        (global.set $idleBlank (i32.const 0))))
    (local.set $i (i32.const 1))
    (local.set $e (i32.const $mem.container))
    (block $stop
      (block $fail
        (loop $l
          (br_if $stop (i32.gt_u (local.get $i) (global.get $sp)))
          (local.set $t (i32.load8_u (local.get $e)))
          ;; List wrappers have no continuation marker of their own.
          (if (i32.gt_u (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 1))
            (then
              (call $findFirstNonspace)
              (if (i32.eq (local.get $t) (enum.get $Blk.quote))
                (then
                  (br_if $fail (i32.eqz (i32.and
                    (i32.le_u (global.get $indent) (i32.const 3))
                    (i32.and (i32.lt_u (global.get $fns) (global.get $lineEnd))
                      (i32.eq (i32.load8_u (global.get $fns)) (i32.const ">"))))))
                  (call $advanceToFns (i32.const 1))
                  (call $skipMarkerSpace))
                ;; Items need their content indent and footnotes four columns.
                ;; An item can begin with at most one blank line.
                (else (br_if $fail (i32.eqz (call $matchIndent
                  (i32.load offset=$CS.indent (local.get $e))
                  (i32.and (i32.eq (local.get $t) (enum.get $Blk.li))
                    (i32.eqz (i32.load offset=$CS.children (local.get $e)))))))))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (local.set $e (i32.add (local.get $e) (i32.const $CS.size)))
          (br $l)))
      (global.set $allMatched (i32.const 0)))
    (global.set $lastMatched (i32.sub (local.get $i) (i32.const 1)))
    ;; A line blank from its start closes any leaf but code or HTML and leaves
    ;; every matched level open. Below a deep spine, let the next blank line
    ;; skip the walk; shallow walks are cheap enough to repeat.
    (if (i32.and (global.get $blank) (i32.ge_u (global.get $lastMatched) (i32.const 8)))
      (then (global.set $idleBlank (i32.and
        (i32.gt_u (i32.sub (global.get $leaf) (enum.get $Blk.code)) (i32.const 1))
        (i32.ge_u (call $skipSpace (local.get $start) (global.get $lineEnd))
          (global.get $lineEnd))))))
    ;; the open leaf is the deepest block in the spine
    (if (i32.and (global.get $allMatched) (i32.ne (global.get $leaf) (i32.const 0)))
      (then
        (call $findFirstNonspace)
        (local.set $t (global.get $leaf))
        (block $unmatched
          (if (i32.eq (local.get $t) (enum.get $Blk.code))
            (then
              (if (global.get $codeFenceCh)
                (then
                  (if (i32.and
                        (i32.le_u (global.get $indent) (i32.const 3))
                        (i32.and (i32.lt_u (global.get $fns) (global.get $lineEnd))
                          (i32.eq (i32.load8_u (global.get $fns)) (global.get $codeFenceCh))))
                    (then
                      (if (call $closesFence (global.get $fns) (global.get $lineEnd))
                        (then
                          (call $closeLeaf)
                          (return (i32.const 1))))))
                  ;; strip up to the opening fence's own indentation
                  (if (local.tee $n (select (global.get $codeFenceOff) (global.get $indent)
                        (i32.lt_u (global.get $codeFenceOff) (global.get $indent))))
                    (then (call $advance (local.get $n)))))
                (else (br_if $unmatched (i32.eqz (call $matchIndent (i32.const 4) (i32.const 0)))))))
            ;; Paragraphs, tables, and HTML blocks of kinds 6 and 7 end at a
            ;; blank line.
            (else
              (br_if $unmatched (i32.and (global.get $blank)
                (i32.or (i32.ne (local.get $t) (enum.get $Blk.html))
                  (i32.gt_u (global.get $htmlKind) (i32.const 5)))))
              ;; Warning: sparse rows can amplify tiny input into gigabytes of
              ;; output. Match cmark-gfm's budget and close the table afterward.
              (br_if $unmatched (i32.and (i32.eq (local.get $t) (enum.get $Blk.table))
                (i32.gt_u (i32.load offset=12 (global.get $leafRec)) (i32.const $MaxTableAutoCells))))
              ;; A pipe starts no block, so the line is the next table row.
              (if (i32.and (i32.eq (local.get $t) (enum.get $Blk.table))
                    (i32.and (i32.lt_u (global.get $indent) (i32.const 4))
                      (i32.eq (i32.load8_u (global.get $fns)) (i32.const "|"))))
                (then
                  (call $advanceToFns (i32.const 0))
                  (call $addLine)
                  (return (i32.const 1))))))
          (global.set $lastMatched (i32.add (global.get $sp) (i32.const 1)))
          (return (i32.const 0)))
        (global.set $allMatched (i32.const 0))))
    (i32.const 0))

  ;; the spine depth once the containers this line left unmatched close
  (func $spineDepth (result i32)
    (select (global.get $sp) (global.get $lastMatched)
      (i32.or (global.get $closed)
        (i32.le_u (global.get $sp) (global.get $lastMatched)))))

  ;; phase 2: try the block start conditions, in the order the spec requires
  (func $openNewBlocks
    (local $contType i32)
    (local $list i32)
    (local $maybeLazy i32)
    (local $m i32)
    (local $save i32)
    (local $padding i32)
    (local $markerOff i32)
    (local $tableCols i32)
    (local $tableN i32)
    (local $tableLine i32)
    (local $tableBeg i32)
    (local $tableEnd i32)
    (local $tableExtra i32)
    (local $footR i32)
    (local $footLen i32)
    (local $footDst i32)
    (local $footNormalized i64)
    (local $headEnd i32)
    (local $hashN i32)
    (local $setextC i32)
    (local $setextI i32)
    (local $depth i32)
    (local.set $maybeLazy (i32.eq (global.get $leaf) (enum.get $Blk.p)))
    (local.set $contType
      (if (result i32) (i32.eqz (global.get $lastMatched))
        (then (enum.get $Blk.none))
        (else
          (if (result i32) (i32.gt_u (global.get $lastMatched) (global.get $sp))
            (then (global.get $leaf))
            (else (i32.load8_u (call $containerAt (global.get $lastMatched))))))))
    (block $stop
      (loop $try
        (br_if $stop (i32.le_u
          (i32.sub (local.get $contType) (enum.get $Blk.code)) (i32.const 1)))
        (call $findFirstNonspace)

        ;; indented code block; an indented line starts nothing else
        (if (i32.ge_u (global.get $indent) (i32.const 4))
          (then
            (br_if $stop (i32.or (local.get $maybeLazy) (global.get $blank)))
            (call $closeUnmatched (i32.const 1))
            (call $advance (i32.const 4))
            (call $prepareLeafParent)
            (call $openLeaf (enum.get $Blk.code))
            (global.set $codeFenceCh (i32.const 0))
            (br $stop)))

        ;; Jump to the first start the leading byte can begin. A start that
        ;; fails falls through to the later ones, which check their own bytes.
        (block $table
         (block $list
          (block $footnote
           (block $hr
            (block $setext
             (block $html
              (block $fence
               (block $atx
                (block $quote
                  (br_table
                    $atx $stop $stop $stop $stop $stop $stop $hr $list
                    $stop $setext $stop $stop $list $list $list $list $list
                    $list $list $list $list $list $table $stop $html $setext
                    $quote $stop $stop $stop $stop $stop $stop $stop $stop
                    $stop $stop $stop $stop $stop $stop $stop $stop $stop
                    $stop $stop $stop $stop $stop $stop $stop $stop $stop
                    $stop $stop $footnote $stop $stop $stop $hr $fence $stop
                    $stop $stop $stop $stop $stop $stop $stop $stop $stop
                    $stop $stop $stop $stop $stop $stop $stop $stop $stop
                    $stop $stop $stop $stop $stop $stop $stop $stop $table
                    $stop $fence
                    $stop
                    (i32.sub (i32.load8_u (global.get $fns)) (i32.const 35))))
                ;; block quote; past the nesting limit a container start stays
                ;; text, so every line treats it alike
                (br_if $stop (i32.ge_u (call $spineDepth) (i32.const $Nest)))
                (call $closeUnmatched (i32.const 1))
                (call $advanceToFns (i32.const 1))
                (call $skipMarkerSpace)
                (call $prepareLeafParent)
                (call $pushContainer (enum.get $Blk.quote) (i32.const 0) (i32.const 0) (i32.const 0))
                (local.set $contType (enum.get $Blk.quote))
                (local.set $maybeLazy (i32.const 0))
                (br $try))

               ;; ATX heading: the block is this line, so it never stays open
               (local.set $m (call $scanAtxStart (global.get $fns)))
               (br_if $stop (i32.eqz (local.get $m)))
               (call $closeUnmatched (i32.const 1))
               ;; a tab in the marker's trailing space leaves $col short, but
               ;; nothing reads it on a heading line
               (call $advanceToFns (local.get $m))
               (call $prepareLeafParent)
               ;; drop trailing spaces, then a closing run of `#` that follows
               ;; a space or tab
               (local.set $save (global.get $pos))
               (local.set $headEnd (call $trimSpaceBack (global.get $lineEnd) (local.get $save)))
               (local.set $hashN (local.get $headEnd))
               (block $hashesDone
                 (loop $hashes
                   (br_if $hashesDone (i32.le_u (local.get $hashN) (local.get $save)))
                   (br_if $hashesDone (i32.ne
                     (i32.load8_u (i32.sub (local.get $hashN) (i32.const 1))) (i32.const "#")))
                   (local.set $hashN (i32.sub (local.get $hashN) (i32.const 1)))
                   (br $hashes)))
               (if (i32.ne (local.get $hashN) (local.get $headEnd))
                 (then
                   (if (i32.or (i32.le_u (local.get $hashN) (local.get $save))
                         (call $isSpaceByte (i32.load8_u (i32.sub (local.get $hashN) (i32.const 1)))))
                     (then (local.set $headEnd
                       (call $trimSpaceBack (local.get $hashN) (local.get $save)))))))
               (call $openLeaf (enum.get $Blk.heading))
               (i32.store offset=8 (global.get $leafRec) (global.get $atxLevel))
               ;; nothing reads the true line end after a block start took the line
               (global.set $lineEnd (local.get $headEnd))
               (if (i32.gt_u (local.get $headEnd) (local.get $save))
                 (then (call $addLine)))
               (call $closeLeaf)
               (global.set $pos (local.get $headEnd))
               (global.set $curLevel (global.get $sp))
               (global.set $skipLine (i32.const 1))
               (br $stop))

              ;; fenced code block
              (local.set $m (call $scanOpenFence (global.get $fns)))
              (br_if $stop (i32.eqz (local.get $m)))
              (call $closeUnmatched (i32.const 1))
              (local.set $markerOff (global.get $indent))
              (call $advanceToFns (local.get $m))
              (call $prepareLeafParent)
              (call $openLeaf (enum.get $Blk.code))
              (call $recFlag (global.get $leafRec) (i32.const $F.fenced))
              (global.set $codeFenceCh (i32.load8_u (global.get $fns)))
              (global.set $codeFenceN (local.get $m))
              (global.set $codeFenceOff (local.get $markerOff))
              (local.set $save (call $skipSpace (global.get $pos) (global.get $lineEnd)))
              (i32.store offset=8 (global.get $leafRec) (local.get $save))
              (i32.store offset=12 (global.get $leafRec)
                (call $trimSpaceBack (global.get $lineEnd) (local.get $save)))
              (global.set $pos (global.get $lineEnd))
              (global.set $skipLine (i32.const 1))
              (br $stop))

             ;; HTML block
             (local.set $m (call $scanHtmlStart (global.get $fns)
               (i32.and
                 (i32.ne (local.get $contType) (enum.get $Blk.p))
                 (i32.eqz (local.get $maybeLazy)))))
             (br_if $stop (i32.eqz (local.get $m)))
             (call $closeUnmatched (i32.const 1))
             (call $prepareLeafParent)
             (call $openLeaf (enum.get $Blk.html))
             (global.set $htmlKind (local.get $m))
             (br $stop))

            ;; setext heading underline
            (if (i32.eq (local.get $contType) (enum.get $Blk.p))
              (then
                (block $setextDone
                  (local.set $setextC (i32.load8_u (global.get $fns)))
                  (local.set $setextI (call $runEnd (global.get $fns) (global.get $lineEnd)
                    (local.get $setextC)))
                  (br_if $setextDone
                    (i32.lt_u
                      (call $skipSpace (local.get $setextI) (global.get $lineEnd))
                      (global.get $lineEnd)))
                  (call $rtrimLines (global.get $leafRec) (i32.const 0))
                  (call $resolveLinkDefs (global.get $leafRec))
                  (if (i32.eqz (i32.load offset=$R.nLines (global.get $leafRec)))
                    (then (call $closeLeaf)))
                  (br_if $setextDone (i32.eqz (i32.load offset=$R.nLines (global.get $leafRec))))
                  (i32.store8 (global.get $leafRec) (enum.get $Blk.heading))
                  (i32.store offset=8 (global.get $leafRec)
                    (select (i32.const 1) (i32.const 2)
                      (i32.eq (local.get $setextC) (i32.const "="))))
                  ;; the heading is complete
                  (global.set $leaf (enum.get $Blk.none))
                  (call $noteChildClosed (i32.const 0))
                  (global.set $pos (global.get $lineEnd))
                  (global.set $skipLine (i32.const 1))
                  (br $stop)))))

           ;; thematic break; its bytes cannot start a footnote
           (if (call $scanThematicBreak (global.get $fns))
             (then
               (call $closeUnmatched (i32.const 1))
               (call $prepareLeafParent)
               (drop (call $recNew (enum.get $Blk.hr)))
               (call $noteChildAdded)
               (global.set $pos (global.get $lineEnd))
               (global.set $curLevel (global.get $sp))
               (global.set $skipLine (i32.const 1))
               (br $stop)))
           (br $list))

          ;; GFM footnote definition
          (local.set $m (call $scanFootnoteDef (global.get $fns)))
          (if (if (result i32) (local.get $m)
                (then (i32.lt_u (call $spineDepth) (i32.const $Nest)))
                (else (i32.const 0)))
            (then
              (call $closeUnmatched (i32.const 1))
              (call $advanceToFns (local.get $m))
              (call $skipMarkerSpace)
              (call $prepareLeafParent)
              ;; A footnote container record doubles as its normalized label.
              (block $footDone
                (br_if $footDone (i32.ge_u (global.get $sp) (i32.const $Nest)))
                (call $pushContainer (enum.get $Blk.footnote) (i32.const 0) (i32.const 4) (i32.const 0))
                (local.set $footR (i32.sub (global.get $rec) (i32.const $R.header)))
                (call $ensureRec (i32.add (i32.const 72)
                  (i32.mul (i32.sub (local.get $m) (i32.const 4)) (i32.const 3))))
                (call $noteDefinition (local.get $footR))
                (global.set $fnTotal (i32.add (global.get $fnTotal) (i32.const 1)))
                (local.set $footDst
                  (i32.add (local.get $footR) (i32.const $R.labelBytes)))
                (local.set $footNormalized (call $normalizeLabel
                  (i32.add (global.get $fns) (i32.const 2))
                  (i32.sub (i32.add (global.get $fns) (local.get $m)) (i32.const 2))
                  (local.get $footDst) (i32.const 1)))
                (local.set $footLen (i32.wrap_i64 (local.get $footNormalized)))
                (i32.store offset=$R.labelLen (local.get $footR) (local.get $footLen))
                (i32.store offset=$R.hash (local.get $footR)
                  (i32.wrap_i64 (i64.shr_u (local.get $footNormalized) (i64.const 32))))
                (local.set $footDst (i32.and
                  (i32.add (i32.add (local.get $footDst) (local.get $footLen)) (i32.const 7))
                  (i32.const -8)))
                (i32.store offset=4 (local.get $footR)
                  (i32.sub (local.get $footDst) (local.get $footR)))
                (global.set $rec (local.get $footDst)))
              (local.set $contType (enum.get $Blk.footnote))
              (local.set $maybeLazy (i32.const 0))
              (br $try))))

         ;; list item
         (local.set $m (call $parseListMarker (global.get $fns)
           (i32.eq (local.get $contType) (enum.get $Blk.p))))
         ;; Reuse the enclosing list when the markers are of the same type;
         ;; a new list needs a level for itself as well as the item.
         (local.set $list (i32.const 0))
         (if (local.get $m)
           (then
             (local.set $depth (call $spineDepth))
             (if (local.get $depth)
               (then
                 (local.set $list (call $containerAt (local.get $depth)))
                 (local.set $list (i32.and
                   (i32.eq (i32.load8_u (local.get $list))
                     (i32.add (enum.get $Blk.ul) (global.get $lmOrdered)))
                   (i32.eq (i32.load8_u offset=$CS.ch (local.get $list))
                     (global.get $lmChar))))))
             (if (i32.gt_u (i32.sub (i32.add (local.get $depth) (i32.const 2)) (local.get $list))
                   (i32.const $Nest))
               (then (local.set $m (i32.const 0))))))
         (if (local.get $m)
           (then
             (call $closeUnmatched (i32.const 1))
             (local.set $markerOff (global.get $indent))
             (call $advanceToFns (local.get $m))
             ;; One to four columns of space after the marker belong to it,
             ;; unless the line ends there; otherwise the marker takes one.
             (call $findFirstNonspace)
             (local.set $padding (i32.add (local.get $m) (global.get $indent)))
             (if (i32.or (global.get $blank)
                   (i32.ge_u (i32.sub (global.get $indent) (i32.const 1)) (i32.const 4)))
               (then
                 (local.set $padding (i32.add (local.get $m) (i32.const 1)))
                 (call $skipMarkerSpace))
               (else (call $advanceToFns (i32.const 0))))
             (if (i32.eqz (local.get $list))
               (then
                 (call $prepareLeafParent)
                 (call $pushContainer
                   (i32.add (enum.get $Blk.ul) (global.get $lmOrdered))
                   (global.get $lmChar) (i32.const 0) (global.get $lmStart))))
             (call $pushContainer (enum.get $Blk.li) (global.get $lmChar)
               (i32.add (local.get $markerOff) (local.get $padding)) (i32.const 0))
             (local.set $contType (enum.get $Blk.li))
             (local.set $maybeLazy (i32.const 0))
             (br $try))))

        ;; GFM table, tried after the core block starts as cmark-gfm does, so
        ;; `- | -` is a list item
        (br_if $stop (i32.ne (local.get $contType) (enum.get $Blk.p)))
        (br_if $stop (i32.ne (global.get $leaf) (enum.get $Blk.p)))
        (local.set $tableCols (call $scanTableDelimRow (global.get $fns)))
        (br_if $stop (i32.eqz (local.get $tableCols)))
        (local.set $tableN (i32.load offset=$R.nLines (global.get $leafRec)))
        (br_if $stop (i32.eqz (local.get $tableN)))
        (local.set $tableLine (call $lineAt (global.get $leafRec)
          (i32.sub (local.get $tableN) (i32.const 1))))
        (local.set $tableBeg (call $lineBeg (local.get $tableLine)))
        (local.set $tableEnd (call $trimSpaceBack
          (call $lineEndOf (local.get $tableLine)) (local.get $tableBeg)))
        (br_if $stop (i32.ne
          (call $countRowCells (local.get $tableBeg) (local.get $tableEnd))
          (local.get $tableCols)))
        ;; The header leaves the paragraph, which closes with what remains.
        (i32.store offset=$R.nLines (global.get $leafRec)
          (i32.sub (local.get $tableN) (i32.const 1)))
        (call $closeLeaf)
        (call $openLeaf (enum.get $Blk.table))
        (i32.store offset=8 (global.get $leafRec) (local.get $tableCols))
        ;; Alignment bytes sit between the header and line array.
        (local.set $tableExtra
          (i32.and (i32.add (local.get $tableCols) (i32.const 7)) (i32.const -8)))
        (i32.store16 offset=2 (global.get $leafRec)
          (i32.add (i32.const $R.header) (local.get $tableExtra)))
        (call $ensureRec (i32.add (local.get $tableExtra) (i32.const $R.line)))
        (memory.copy (global.get $rec) (i32.const $mem.column) (local.get $tableCols))
        (global.set $rec (i32.add (global.get $rec) (local.get $tableExtra)))
        (i32.store (global.get $rec) (local.get $tableBeg))
        (i32.store offset=4 (global.get $rec) (local.get $tableEnd))
        (global.set $rec (i32.add (global.get $rec) (i32.const $R.line)))
        (i32.store offset=$R.nLines (global.get $leafRec) (i32.const 1))
        (call $recGrow (global.get $leafRec)
          (i32.add (local.get $tableExtra) (i32.const $R.line)))
        (global.set $pos (global.get $lineEnd))
        (global.set $skipLine (i32.const 1)))))

  ;; phases 2 and 3 for a line that phase 1 did not consume
  (func $addBlockLine
    (global.set $curLevel (global.get $lastMatched))
    (call $openNewBlocks)
    (call $addTextToContainer))

  ;; phase 3: attach the rest of the line to the deepest open block
  (func $addTextToContainer
    (local $t i32)
    (local $bookI i32)
    (local $bookE i32)
    (local $level i32)
    (call $findFirstNonspace)
    ;; last_line_blank bookkeeping, which decides list looseness. First, no
    ;; matched container ends with a blank line.
    (local.set $level (global.get $curLevel))
    (local.set $bookI (select (local.get $level) (global.get $sp)
      (i32.lt_u (local.get $level) (global.get $sp))))
    (local.set $bookE (i32.const $mem.container))
    (block $bookDone
      (loop $book
        (br_if $bookDone (i32.eqz (local.get $bookI)))
        (i32.store8 offset=$CS.flags (local.get $bookE)
          (i32.and (i32.load8_u offset=$CS.flags (local.get $bookE))
            (i32.const $C.clearLastLineBlank)))
        (local.set $bookI (i32.sub (local.get $bookI) (i32.const 1)))
        (local.set $bookE (i32.add (local.get $bookE) (i32.const $CS.size)))
        (br $book)))
    ;; A consumed heading, thematic break, table row, or fence is not a blank
    ;; line.
    (if (i32.and (global.get $blank) (i32.eqz (global.get $skipLine)))
      (then
        (if (i32.gt_u (local.get $level) (global.get $sp))
          ;; blank lines inside fenced code do not count
          (then (global.set $leafBlank (i32.or
            (i32.ne (global.get $leaf) (enum.get $Blk.code))
            (i32.eqz (global.get $codeFenceCh)))))
          (else
            ;; The last child of the current container ends with a blank line:
            ;; an unmatched container, the open leaf, or a closed block.
            (if (i32.lt_u (local.get $level) (global.get $sp))
              (then (i32.store8 offset=$CS.flags (local.get $bookE)
                (i32.or (i32.load8_u offset=$CS.flags (local.get $bookE))
                  (i32.const $C.lastLineBlank))))
              (else
                (if (global.get $leaf)
                  (then (global.set $leafBlank (i32.const 1))))))
            ;; Then the current container itself, unless it is a quote or an
            ;; item on its opening line.
            (if (local.get $level)
              (then
                (local.set $bookE (call $containerAt (local.get $level)))
                (local.set $t (i32.load8_u (local.get $bookE)))
                (if (i32.and (i32.eqz (global.get $leaf))
                      (i32.and (i32.eq (local.get $level) (global.get $sp))
                        (i32.ne (i32.load offset=$CS.children (local.get $bookE)) (i32.const 0))))
                  (then (call $noteChildClosed (i32.const 1))))
                (if (i32.and (i32.ne (local.get $t) (enum.get $Blk.quote))
                      (i32.or (i32.ne (local.get $t) (enum.get $Blk.li))
                        (i32.or
                          (i32.ne (i32.load offset=$CS.children (local.get $bookE)) (i32.const 0))
                          (i32.ne (i32.load offset=$CS.line (local.get $bookE))
                            (global.get $lineEnd)))))
                  (then (i32.store8 offset=$CS.flags (local.get $bookE)
                    (i32.or (i32.load8_u offset=$CS.flags (local.get $bookE))
                      (i32.const $C.lastLineBlank))))))))))
      (else
        (if (i32.gt_u (local.get $level) (global.get $sp))
          (then (global.set $leafBlank (i32.const 0))))))
    (if (global.get $skipLine) (then (return)))
    (block $add
      ;; a lazy continuation line joins the open paragraph
      (br_if $add (i32.and
        (i32.and
          (i32.eq (global.get $leaf) (enum.get $Blk.p))
          (i32.le_u (global.get $lastMatched) (global.get $sp)))
        (i32.and
          (i32.eq (global.get $curLevel) (global.get $lastMatched))
          (i32.and (i32.eqz (global.get $blank)) (i32.eqz (global.get $closed))))))
      (call $closeUnmatched (i32.const 0))
      (local.set $t (global.get $leaf))
      ;; code and HTML keep every line as it is
      (if (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.code)) (i32.const 1))
        (then
          (call $addLine)
          (if (i32.eq (local.get $t) (enum.get $Blk.html))
            (then
              (if (call $scanHtmlBlockEnd (global.get $htmlKind) (global.get $fns))
                (then (call $closeLeaf)))))
          (return)))
      (if (global.get $blank) (then (return)))
      ;; other text starts a paragraph
      (if (i32.eqz (local.get $t))
        (then
          (call $prepareLeafParent)
          (call $openLeaf (enum.get $Blk.p)))))
    (call $advanceToFns (i32.const 0))
    (call $addLine))

)
