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
  (global $leaf (mut i32) (i32.const 0))     ;; $Blk of the open leaf, or none
  (global $leafRec (mut i32) (i32.const 0))
  (global $leafBlank (mut i32) (i32.const 0))
  (global $allMatched (mut i32) (i32.const 0))
  (global $lastMatched (mut i32) (i32.const 0))
  (global $curLevel (mut i32) (i32.const 0))
  (global $closed (mut i32) (i32.const 0))   ;; unmatched blocks already finalized
  (global $skipLine (mut i32) (i32.const 0)) ;; the line was fully consumed by a block start
  ;; open fenced code block
  (global $codeFenceCh (mut i32) (i32.const 0))
  (global $codeFenceN (mut i32) (i32.const 0))
  (global $codeFenceOff (mut i32) (i32.const 0))
  (global $htmlKind (mut i32) (i32.const 0))

  (func $containerAt (param $i i32) (result i32)
    (i32.add (i32.const $mem.container)
      (i32.mul (i32.sub (local.get $i) (i32.const 1)) (i32.const $CS.size))))

  ;; append the remainder of the current line to the open leaf
  (func $addLine
    (local $beg i32)
    (local $end i32)
    (local $line i32)
    (local $pad i32)
    (local.set $beg (global.get $pos))
    (if (global.get $ptab)
      (then
        (local.set $pad (i32.sub (i32.const 4) (i32.and (global.get $col) (i32.const 3))))
        (local.set $beg (i32.add (local.get $beg) (i32.const 1)))))
    ;; HTML can retain an unindented LF-separated fenced block as one input
    ;; span. ANSI keeps individual lines so it can reapply their prefixes.
    (if (i32.and
          (i32.and (i32.eqz (global.get $mode))
            (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.code))
              (i32.ne (global.get $codeFenceCh) (i32.const 0))))
          (i32.and (i32.eqz (local.get $pad))
            (i32.load offset=$R.nLines (global.get $leafRec))))
      (then
        (local.set $line (i32.sub (global.get $rec) (i32.const $R.line)))
        (local.set $end (call $lineEndOf (local.get $line)))
        (if (i32.and
              (i32.eq (local.get $beg) (i32.add (local.get $end) (i32.const 1)))
              (i32.eq (i32.load8_u (local.get $end)) (i32.const 10)))
          (then
            (i32.store offset=4 (local.get $line) (global.get $lineEnd))
            (return)))))
    (call $ensureRec (i32.const $R.line))
    (i32.store (global.get $rec) (local.get $beg))
    (i32.store offset=4 (global.get $rec)
      (i32.or (global.get $lineEnd) (i32.shl (local.get $pad) (i32.const 30))))
    (global.set $rec (i32.add (global.get $rec) (i32.const $R.line)))
    (i32.store offset=$R.nLines (global.get $leafRec)
      (i32.add (i32.load offset=$R.nLines (global.get $leafRec)) (i32.const 1)))
    (call $recGrow (global.get $leafRec) (i32.const $R.line)))

  ;; Append an ordinary paragraph continuation after phase 1 has established
  ;; $lastMatched and $findFirstNonspace has populated $fns/$blank. Returns 0
  ;; when phase 2 must still check a possible interrupting block start.
  (func $tryParagraphContinuation (result i32)
    (local $ch i32)
    (local $mask i64)
    (if (i32.or
          (i32.ne (global.get $leaf) (enum.get $Blk.p))
          (global.get $blank))
      (then (return (i32.const 0))))
    (local.set $ch (i32.load8_u (global.get $fns)))
    ;; Block markers, table delimiters, and ordered-list digits retain the
    ;; full phase-2 precedence. Everything else can only continue the open p.
    (local.set $mask (i64.and
      (i64.shl (i64.const 1) (i64.extend_i32_u (local.get $ch)))
      (select
        (i64.const 0x5000000188000000)
        (i64.const 0x77ff2c0900002600)
        (i32.ge_u (local.get $ch) (i32.const 64)))))
    (if (i32.and
          (i32.lt_u (local.get $ch) (i32.const 128))
          (i64.ne (local.get $mask) (i64.const 0)))
      (then (return (i32.const 0))))
    (global.set $curLevel (global.get $lastMatched))
    (if (i32.gt_u (global.get $lastMatched) (global.get $sp))
      (then
        (global.set $leafBlank (i32.const 0))
        (call $advanceToFns)))
    (call $addLine)
    (if (i32.and
          (i32.eqz (global.get $sp))
          (i32.and
            (i32.lt_u (global.get $lineEnd) (global.get $eof))
            (i32.eq (i32.load8_u (global.get $lineEnd)) (i32.const 10))))
      (then
        (drop (call $appendParagraphRun
          (i32.add (global.get $lineEnd) (i32.const 1))))))
    (i32.const 1))

  ;; Consume further unindented LF-separated lines that cannot interrupt the
  ;; current top-level paragraph without rebuilding the phase state.
  (func $appendParagraphRun (param $p i32) (result i32)
    (local $end i32)
    (local $next i32)
    (local $ch i32)
    (local $mask i64)
    (loop $line
      (if (i32.ge_u (local.get $p) (global.get $eof))
        (then (return (local.get $p))))
      (local.set $ch (i32.load8_u (local.get $p)))
      (local.set $mask (i64.and
        (i64.shl (i64.const 1) (i64.extend_i32_u (local.get $ch)))
        (select
          (i64.const 0x5000000188000000)
          (i64.const 0x77ff2c0900002600)
          (i32.ge_u (local.get $ch) (i32.const 64)))))
      (if (i32.and
            (i32.lt_u (local.get $ch) (i32.const 128))
            (i64.ne (local.get $mask) (i64.const 0)))
        (then (return (local.get $p))))
      (local.set $end (call $findLineEnd (local.get $p)))
      (global.set $pos (local.get $p))
      (global.set $lineEnd (local.get $end))
      (global.set $ptab (i32.const 0))
      (call $addLine)
      (local.set $next (call $lineAfter (local.get $end)))
      (if (i32.or
            (i32.ge_u (local.get $end) (global.get $eof))
            (i32.ne (i32.load8_u (local.get $end)) (i32.const 10)))
        (then (return (local.get $next))))
      (local.set $p (local.get $next))
      (br $line))
    (unreachable))

  ;; a block was added directly inside level $parent
  (func $noteChildAdded (param $parent i32)
    (local $e i32)
    (local $list i32)
    (local $t i32)
    (if (i32.eqz (local.get $parent)) (then (return)))
    (local.set $e (call $containerAt (local.get $parent)))
    (local.set $t (i32.load8_u (local.get $e)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then (local.set $list (call $containerAt (i32.sub (local.get $parent) (i32.const 1)))))
      (else (if (i32.le_u
          (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 1))
        (then (local.set $list (local.get $e))))))
    (if (local.get $list)
      (then
        (if (i32.and (i32.load8_u offset=$CS.flags (local.get $list)) (i32.const $C.blankPending))
          (then (i32.store8 offset=$CS.flags (local.get $list)
            (i32.or (i32.load8_u offset=$CS.flags (local.get $list)) (i32.const $C.loose)))))))
    (i32.store offset=$CS.children (local.get $e)
      (i32.add (i32.load offset=$CS.children (local.get $e)) (i32.const 1))))

  ;; a block inside level $parent was finalized; $endsBlank is the recursive
  ;; "ends with a blank line" predicate for it
  (func $noteChildClosed (param $parent i32) (param $endsBlank i32)
    (local $e i32)
    (local $t i32)
    (local $list i32)
    (if (i32.eqz (local.get $parent)) (then (return)))
    (local.set $e (call $containerAt (local.get $parent)))
    (i32.store8 offset=$CS.flags (local.get $e)
      (select
        (i32.or (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.lastChildEndsBlank))
        (i32.and (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.clearLastChildEndsBlank))
        (local.get $endsBlank)))
    (if (i32.eqz (local.get $endsBlank)) (then (return)))
    (local.set $t (i32.load8_u (local.get $e)))
    (if (i32.eq (local.get $t) (enum.get $Blk.li))
      (then (local.set $list (call $containerAt (i32.sub (local.get $parent) (i32.const 1)))))
      (else (if (i32.le_u
          (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 1))
        (then (local.set $list (local.get $e))))))
    (if (local.get $list)
      (then (i32.store8 offset=$CS.flags (local.get $list)
        (i32.or (i32.load8_u offset=$CS.flags (local.get $list)) (i32.const $C.blankPending))))))

  (func $openLeaf (param $type i32)
    (global.set $leafRec (call $recNew (local.get $type)))
    (global.set $leaf (local.get $type))
    (global.set $leafBlank (i32.const 0))
    (call $noteChildAdded (global.get $sp))
    (global.set $curLevel (i32.add (global.get $sp) (i32.const 1))))

  (func $closeLeaf
    (local $t i32)
    (local $n i32)
    (local $line i32)
    (local $end i32)
    (if (i32.eqz (global.get $leaf)) (then (return)))
    (local.set $t (global.get $leaf))
    (global.set $leaf (enum.get $Blk.none))
    (if (i32.or
          (i32.eq (local.get $t) (enum.get $Blk.heading))
          (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.p)) (i32.const 1)))
      (then (call $rtrimLines (global.get $leafRec))))
    (if (i32.eq (local.get $t) (enum.get $Blk.p))
      (then
        (call $resolveLinkDefs (global.get $leafRec))
        (if (i32.eqz (i32.load offset=$R.nLines (global.get $leafRec)))
          (then (i32.store8 (global.get $leafRec) (enum.get $Blk.none))))))
    (if (i32.and (i32.eq (local.get $t) (enum.get $Blk.code)) (i32.eqz (global.get $codeFenceCh)))
      (then
        ;; indented code keeps interior blank lines but not trailing ones
        (local.set $n (i32.load offset=$R.nLines (global.get $leafRec)))
        (local.set $line (i32.add (call $recLines (global.get $leafRec))
          (i32.mul (local.get $n) (i32.const $R.line))))
        (block $trimmed
          (loop $trim
            (br_if $trimmed (i32.eqz (local.get $n)))
            (local.set $line (i32.sub (local.get $line) (i32.const $R.line)))
            (local.set $end (call $lineEndOf (local.get $line)))
            (br_if $trimmed (i32.lt_u
              (call $skipSpace (call $lineBeg (local.get $line)) (local.get $end))
              (local.get $end)))
            (local.set $n (i32.sub (local.get $n) (i32.const 1)))
            (i32.store offset=$R.nLines (global.get $leafRec) (local.get $n))
            (br $trim)))))
    (call $noteChildClosed (global.get $sp) (global.get $leafBlank)))

  ;; close containers until one that can hold a leaf block is on top
  (func $prepareLeafParent
    (local $t i32)
    (block $done
      (loop $l
        (br_if $done (i32.eqz (global.get $sp)))
        (local.set $t (i32.load8_u (call $containerAt (global.get $sp))))
        (br_if $done (i32.gt_u
          (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 1)))
        (call $closeContainer)
        (br $l))))

  (func $pushContainer (param $type i32) (param $ch i32) (param $indent i32) (param $start i32)
    (local $e i32)
    (local $r i32)
    (if (i32.ge_u (global.get $sp) (i32.const $Nest)) (then (return)))
    (local.set $r (call $recNew (local.get $type)))
    (call $recFlag (local.get $r) (i32.const $F.opener))
    (i32.store offset=8 (local.get $r) (local.get $start))
    (i32.store offset=12 (local.get $r) (local.get $ch))
    (call $noteChildAdded (global.get $sp))
    (global.set $sp (i32.add (global.get $sp) (i32.const 1)))
    (local.set $e (call $containerAt (global.get $sp)))
    (i32.store (local.get $e) (i32.or
      (local.get $type) (i32.shl (local.get $ch) (i32.const 8))))
    (i32.store offset=$CS.indent (local.get $e) (local.get $indent))
    (i32.store offset=$CS.rec (local.get $e) (local.get $r))
    (i64.store offset=$CS.line (local.get $e)
      (i64.extend_i32_u (global.get $lineEnd)))
    (global.set $curLevel (global.get $sp)))

  (func $closeContainer
    (local $e i32)
    (local $r i32)
    (local $t i32)
    (local $endsBlank i32)
    (if (i32.eqz (global.get $sp)) (then (return)))
    (if (global.get $leaf) (then (call $closeLeaf)))
    (local.set $e (call $containerAt (global.get $sp)))
    (local.set $t (i32.load8_u (local.get $e)))
    (local.set $r (i32.load offset=$CS.rec (local.get $e)))
    ;; ends_with_blank_line descends through lists and items to the last child
    (if (i32.and
          (i32.ne (i32.load offset=$CS.children (local.get $e)) (i32.const 0))
          (i32.le_u
            (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 2)))
      (then (local.set $endsBlank (i32.and
        (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.lastChildEndsBlank))))
      (else (local.set $endsBlank (i32.and
        (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.lastLineBlank)))))
    ;; publish the list's looseness on its opening record
    (if (i32.and (i32.load8_u offset=$CS.flags (local.get $e)) (i32.const $C.loose))
      (then (call $recFlag (local.get $r) (i32.const $F.loose))))
    (call $recFlag (call $recNew (local.get $t)) (i32.const $F.closer))
    (global.set $sp (i32.sub (global.get $sp) (i32.const 1)))
    (call $noteChildClosed (global.get $sp) (local.get $endsBlank)))

  ;; finalize every block the current line did not match. A leaf that did match
  ;; stays open; only phase 2 closes one, through $startNewBlock.
  (func $closeUnmatched
    (local $n i32)
    (if (global.get $closed) (then (return)))
    (global.set $closed (i32.const 1))
    (if (i32.le_u (global.get $lastMatched) (global.get $sp))
      (then (if (global.get $leaf) (then (call $closeLeaf)))))
    (local.set $n (global.get $lastMatched))
    (if (i32.gt_u (local.get $n) (global.get $sp)) (then (local.set $n (global.get $sp))))
    (block $done
      (loop $l
        (br_if $done (i32.le_u (global.get $sp) (local.get $n)))
        (call $closeContainer)
        (br $l))))

  ;; a new block is starting here, so nothing that was open can stay open
  (func $startNewBlock
    (call $closeUnmatched)
    (call $closeLeaf))

  ;; drop trailing whitespace from the last line and remove trailing blank
  ;; lines, so a hard line break can never sit at the end of a block
  (func $rtrimLines (param $r i32)
    (local $n i32)
    (local $line i32)
    (local $beg i32)
    (local $end i32)
    (local.set $n (i32.load offset=$R.nLines (local.get $r)))
    (block $done
      (loop $l
        (br_if $done (i32.eqz (local.get $n)))
        (local.set $line (call $lineAt (local.get $r) (i32.sub (local.get $n) (i32.const 1))))
        (local.set $beg (call $lineBeg (local.get $line)))
        (local.set $end (call $trimSpaceBack (call $lineEndOf (local.get $line)) (local.get $beg)))
        (i32.store offset=4 (local.get $line)
          (i32.or (local.get $end)
            (i32.and (i32.load offset=4 (local.get $line)) (i32.const $R.padMask))))
        (br_if $done (i32.gt_u (local.get $end) (local.get $beg)))
        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
        (i32.store offset=$R.nLines (local.get $r) (local.get $n))
        (br $l))))

  ;; phase 1: walk the spine, matching each open block's continuation.
  ;; Returns 1 when the line was fully consumed (a closing code fence).
  (func $matchOpenBlocks (result i32)
    (local $i i32)
    (local $e i32)
    (local $t i32)
    (local $n i32)
    (local $closeI i32)
    (local $closeK i32)
    (local.set $i (i32.const 1))
    (local.set $e (i32.const $mem.container))
    (block $stop
      (loop $l
        (br_if $stop (i32.gt_u (local.get $i) (global.get $sp)))
        (local.set $t (i32.load8_u (local.get $e)))
        ;; List wrappers have no continuation marker of their own.
        (if (i32.gt_u (i32.sub (local.get $t) (enum.get $Blk.ul)) (i32.const 1))
          (then (call $findFirstNonspace)))
        (if (i32.eq (local.get $t) (enum.get $Blk.quote))
          (then
            (if (i32.and
                  (i32.le_u (global.get $indent) (i32.const 3))
                  (i32.and (i32.lt_u (global.get $fns) (global.get $lineEnd))
                    (i32.eq (i32.load8_u (global.get $fns)) (i32.const ">"))))
              (then
                (call $advance (i32.add (global.get $indent) (i32.const 1)) (i32.const 1))
                (if (i32.and (i32.lt_u (global.get $pos) (global.get $lineEnd))
                      (call $isSpaceByte (i32.load8_u (global.get $pos))))
                  (then (call $advance (i32.const 1) (i32.const 1)))))
              (else
                (global.set $allMatched (i32.const 0))
                (br $stop)))))
        (if (i32.eq (local.get $t) (enum.get $Blk.footnote))
          (then
            (if (i32.ge_u (global.get $indent) (i32.const 4))
              (then (call $advance (i32.const 4) (i32.const 1)))
              (else
                (if (global.get $blank)
                  (then (call $advanceToFns))
                  (else
                    (global.set $allMatched (i32.const 0))
                    (br $stop)))))))
        (if (i32.eq (local.get $t) (enum.get $Blk.li))
          (then
            (if (i32.ge_u (global.get $indent) (i32.load offset=$CS.indent (local.get $e)))
              (then (call $advance (i32.load offset=$CS.indent (local.get $e)) (i32.const 1)))
              (else
                (if (i32.and (global.get $blank)
                      (i32.ne (i32.load offset=$CS.children (local.get $e)) (i32.const 0)))
                  (then (call $advanceToFns))
                  (else
                    (global.set $allMatched (i32.const 0))
                    (br $stop)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (local.set $e (i32.add (local.get $e) (i32.const $CS.size)))
        (br $l)))
    (global.set $lastMatched (i32.sub (local.get $i) (i32.const 1)))
    ;; the open leaf is the deepest block in the spine
    (if (i32.and (global.get $allMatched) (i32.ne (global.get $leaf) (i32.const 0)))
      (then
        (call $findFirstNonspace)
        (local.set $t (global.get $leaf))
        (if (i32.eq (local.get $t) (enum.get $Blk.code))
          (then
            (if (global.get $codeFenceCh)
              (then
                (if (i32.and
                      (i32.le_u (global.get $indent) (i32.const 3))
                      (i32.and (i32.lt_u (global.get $fns) (global.get $lineEnd))
                        (i32.eq (i32.load8_u (global.get $fns)) (global.get $codeFenceCh))))
                  (then
                    (local.set $closeI (global.get $fns))
                    (block $closeRunDone
                      (loop $closeRun
                        (br_if $closeRunDone
                          (i32.ge_u (local.get $closeI) (global.get $lineEnd)))
                        (br_if $closeRunDone
                          (i32.ne (i32.load8_u (local.get $closeI))
                            (global.get $codeFenceCh)))
                        (local.set $closeI
                          (i32.add (local.get $closeI) (i32.const 1)))
                        (br $closeRun)))
                    (local.set $closeK
                      (i32.sub (local.get $closeI) (global.get $fns)))
                    (if (i32.and
                          (i32.ge_u (local.get $closeK) (global.get $codeFenceN))
                          (i32.ge_u
                            (call $skipSpace (local.get $closeI) (global.get $lineEnd))
                            (global.get $lineEnd)))
                      (then
                        (call $closeLeaf)
                        (return (i32.const 1))))))
                ;; strip up to the opening fence's own indentation
                (local.set $n (global.get $codeFenceOff))
                (block $stripped
                  (loop $strip
                    (br_if $stripped (i32.eqz (local.get $n)))
                    (br_if $stripped (i32.ge_u (global.get $pos) (global.get $lineEnd)))
                    (br_if $stripped (i32.eqz (call $isSpaceByte (i32.load8_u (global.get $pos)))))
                    (call $advance (i32.const 1) (i32.const 1))
                    (local.set $n (i32.sub (local.get $n) (i32.const 1)))
                    (br $strip)))
                (global.set $lastMatched (i32.add (global.get $sp) (i32.const 1)))
                (return (i32.const 0)))
              (else
                (if (i32.ge_u (global.get $indent) (i32.const 4))
                  (then
                    (call $advance (i32.const 4) (i32.const 1))
                    (global.set $lastMatched (i32.add (global.get $sp) (i32.const 1))))
                  (else (if (global.get $blank)
                    (then
                      (call $advanceToFns)
                      (global.set $lastMatched (i32.add (global.get $sp) (i32.const 1))))
                    (else (global.set $allMatched (i32.const 0))))))
                (return (i32.const 0))))))
        (if (i32.eq (local.get $t) (enum.get $Blk.html))
          (then
            (if (i32.or (i32.le_u (global.get $htmlKind) (i32.const 5)) (i32.eqz (global.get $blank)))
              (then (global.set $lastMatched (i32.add (global.get $sp) (i32.const 1))))
              (else (global.set $allMatched (i32.const 0))))
            (return (i32.const 0))))
        (if (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.p)) (i32.const 1))
          (then
            (if (global.get $blank)
              (then (global.set $allMatched (i32.const 0)))
              (else (global.set $lastMatched (i32.add (global.get $sp) (i32.const 1)))))
            (return (i32.const 0))))
        ;; headings never continue
        (global.set $allMatched (i32.const 0))))
    (i32.const 0))

  ;; phase 2: try the block start conditions, in the order the spec requires
  (func $openNewBlocks
    (local $contType i32)
    (local $list i32)
    (local $maybeLazy i32)
    (local $indented i32)
    (local $m i32)
    (local $lev i32)
    (local $save i32)
    (local $saveCol i32)
    (local $savePtab i32)
    (local $i i32)
    (local $padding i32)
    (local $markerOff i32)
    (local $tableCols i32)
    (local $tableN i32)
    (local $tableLine i32)
    (local $tableBeg i32)
    (local $tableEnd i32)
    (local $tableExtra i32)
    (local $footR i32)
    (local $footE i32)
    (local $footLen i32)
    (local $footDst i32)
    (local $footNormalized i64)
    (local $setextC i32)
    (local $setextI i32)
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
        (local.set $indented (i32.ge_u (global.get $indent) (i32.const 4)))

        ;; block quote
        (if (i32.and (i32.eqz (local.get $indented))
              (i32.and (i32.lt_u (global.get $fns) (global.get $lineEnd))
                (i32.eq (i32.load8_u (global.get $fns)) (i32.const ">"))))
          (then
            (call $startNewBlock)
            (call $advance (i32.add (global.get $indent) (i32.const 1)) (i32.const 1))
            (if (i32.and (i32.lt_u (global.get $pos) (global.get $lineEnd))
                  (call $isSpaceByte (i32.load8_u (global.get $pos))))
              (then (call $advance (i32.const 1) (i32.const 1))))
            (call $prepareLeafParent)
            (call $pushContainer (enum.get $Blk.quote) (i32.const 0) (i32.const 0) (i32.const 0))
            (local.set $contType (enum.get $Blk.quote))
            (local.set $maybeLazy (i32.const 0))
            (br $try)))

        ;; ATX heading
        (if (i32.eqz (local.get $indented))
          (then
            (local.set $m (call $scanAtxStart (global.get $fns)))
            (if (local.get $m)
              (then
                (call $startNewBlock)
                (call $advance
                  (i32.sub (i32.add (global.get $fns) (local.get $m)) (global.get $pos)) (i32.const 0))
                (call $prepareLeafParent)
                (call $openLeaf (enum.get $Blk.heading))
                (i32.store offset=8 (global.get $leafRec) (global.get $atxLevel))
                (br $stop)))))

        ;; fenced code block
        (if (i32.eqz (local.get $indented))
          (then
            (local.set $m (call $scanOpenFence (global.get $fns)))
            (if (local.get $m)
              (then
                (call $startNewBlock)
                (local.set $markerOff (global.get $indent))
                (call $advance
                  (i32.sub (i32.add (global.get $fns) (local.get $m)) (global.get $pos)) (i32.const 0))
                (call $prepareLeafParent)
                (call $openLeaf (enum.get $Blk.code))
                (call $recFlag (global.get $leafRec) (i32.const $F.fenced))
                (global.set $codeFenceCh (i32.load8_u (global.get $fns)))
                (global.set $codeFenceN
                  (select (i32.const 255) (local.get $m) (i32.gt_u (local.get $m) (i32.const 255))))
                (global.set $codeFenceOff (local.get $markerOff))
                (local.set $save (call $skipSpace (global.get $pos) (global.get $lineEnd)))
                (i32.store offset=8 (global.get $leafRec) (local.get $save))
                (i32.store offset=12 (global.get $leafRec)
                  (call $trimSpaceBack (global.get $lineEnd) (local.get $save)))
                (global.set $pos (global.get $lineEnd))
                (global.set $skipLine (i32.const 1))
                (br $stop)))))

        ;; HTML block
        (if (i32.eqz (local.get $indented))
          (then
            (local.set $m (call $scanHtmlStart (global.get $fns)
              (i32.and
                (i32.ne (local.get $contType) (enum.get $Blk.p))
                (i32.eqz (local.get $maybeLazy)))))
            (if (local.get $m)
              (then
                (call $startNewBlock)
                (call $prepareLeafParent)
                (call $openLeaf (enum.get $Blk.html))
                (global.set $htmlKind (local.get $m))
                (br $stop)))))

        ;; setext heading underline
        (if (i32.and (i32.eqz (local.get $indented)) (i32.eq (local.get $contType) (enum.get $Blk.p)))
          (then
            (local.set $lev (i32.const 0))
            (block $setextDone
              (br_if $setextDone
                (i32.ge_u (global.get $fns) (global.get $lineEnd)))
              (local.set $setextC (i32.load8_u (global.get $fns)))
              (br_if $setextDone (i32.eqz (i32.or
                (i32.eq (local.get $setextC) (i32.const "="))
                (i32.eq (local.get $setextC) (i32.const "-")))))
              (local.set $setextI (global.get $fns))
              (block $setextRunDone
                (loop $setextRun
                  (br_if $setextRunDone
                    (i32.ge_u (local.get $setextI) (global.get $lineEnd)))
                  (br_if $setextRunDone
                    (i32.ne (i32.load8_u (local.get $setextI))
                      (local.get $setextC)))
                  (local.set $setextI
                    (i32.add (local.get $setextI) (i32.const 1)))
                  (br $setextRun)))
              (br_if $setextDone
                (i32.lt_u
                  (call $skipSpace (local.get $setextI) (global.get $lineEnd))
                  (global.get $lineEnd)))
              (local.set $lev
                (select (i32.const 1) (i32.const 2)
                  (i32.eq (local.get $setextC) (i32.const "=")))))
            (if (local.get $lev)
              (then
                (call $rtrimLines (global.get $leafRec))
                (call $resolveLinkDefs (global.get $leafRec))
                (if (i32.eqz (i32.load offset=$R.nLines (global.get $leafRec)))
                  (then (call $closeLeaf)))
                (if (i32.load offset=$R.nLines (global.get $leafRec))
                  (then
                    (i32.store8 (global.get $leafRec) (enum.get $Blk.heading))
                    (i32.store offset=8 (global.get $leafRec) (local.get $lev))
                    (global.set $leaf (enum.get $Blk.heading))
                    (global.set $pos (global.get $lineEnd))
                    (global.set $skipLine (i32.const 1))
                    (br $stop)))))))

        ;; GFM table
        (if (i32.and (i32.eqz (local.get $indented)) (i32.eq (local.get $contType) (enum.get $Blk.p)))
          (then
            (block $notTable
              (br_if $notTable (i32.ne (global.get $leaf) (enum.get $Blk.p)))
              (local.set $tableCols (call $scanTableDelimRow (global.get $fns)))
              (br_if $notTable (i32.eqz (local.get $tableCols)))
              (call $rtrimLines (global.get $leafRec))
              (local.set $tableN (i32.load offset=$R.nLines (global.get $leafRec)))
              (br_if $notTable (i32.eqz (local.get $tableN)))
              (local.set $tableLine (call $lineAt (global.get $leafRec)
                (i32.sub (local.get $tableN) (i32.const 1))))
              (local.set $tableBeg (call $lineBeg (local.get $tableLine)))
              (local.set $tableEnd (call $lineEndOf (local.get $tableLine)))
              (br_if $notTable (i32.ne
                (call $countRowCells (local.get $tableBeg) (local.get $tableEnd))
                (local.get $tableCols)))
              ;; The header leaves the paragraph, which may disappear entirely.
              (local.set $tableN (i32.sub (local.get $tableN) (i32.const 1)))
              (i32.store offset=$R.nLines (global.get $leafRec) (local.get $tableN))
              (if (i32.eqz (local.get $tableN))
                (then (i32.store8 (global.get $leafRec) (enum.get $Blk.none)))
                (else (call $rtrimLines (global.get $leafRec))))
              (call $openLeaf (enum.get $Blk.table))
              (i32.store offset=8 (global.get $leafRec) (local.get $tableCols))
              ;; Alignment bytes sit between the header and line array.
              (local.set $tableExtra
                (i32.and (i32.add (local.get $tableCols) (i32.const 7)) (i32.const -8)))
              (i32.store16 offset=2 (global.get $leafRec)
                (i32.add (i32.const $R.header) (local.get $tableExtra)))
              (call $ensureRec (i32.add (local.get $tableExtra) (i32.const $R.line)))
              (memory.copy (global.get $rec) (i32.const $mem.align) (local.get $tableCols))
              (global.set $rec (i32.add (global.get $rec) (local.get $tableExtra)))
              (i32.store (global.get $rec) (local.get $tableBeg))
              (i32.store offset=4 (global.get $rec) (local.get $tableEnd))
              (global.set $rec (i32.add (global.get $rec) (i32.const $R.line)))
              (i32.store offset=$R.nLines (global.get $leafRec) (i32.const 1))
              (call $recGrow (global.get $leafRec)
                (i32.add (local.get $tableExtra) (i32.const $R.line)))
              (global.set $pos (global.get $lineEnd))
              (global.set $skipLine (i32.const 1))
              (br $stop))))

        ;; thematic break
        (if (i32.and (i32.eqz (local.get $indented))
              (i32.eqz (i32.and
                (i32.eq (local.get $contType) (enum.get $Blk.p))
                (i32.eqz (global.get $allMatched)))))
          (then
            (local.set $m (call $scanThematicBreak (global.get $fns)))
            (if (local.get $m)
              (then
                (call $startNewBlock)
                (call $prepareLeafParent)
                (drop (call $recNew (enum.get $Blk.hr)))
                (call $noteChildAdded (global.get $sp))
                (global.set $pos (global.get $lineEnd))
                (global.set $curLevel (global.get $sp))
                (global.set $skipLine (i32.const 1))
                (br $stop)))))

        ;; GFM footnote definition
        (if (i32.eqz (local.get $indented))
          (then
            (local.set $m (call $scanFootnoteDef (global.get $fns)))
            (if (local.get $m)
              (then
                (call $startNewBlock)
                (call $advance
                  (i32.sub (i32.add (global.get $fns) (local.get $m)) (global.get $pos))
                  (i32.const 0))
                (if (i32.and (i32.lt_u (global.get $pos) (global.get $lineEnd))
                      (call $isSpaceByte (i32.load8_u (global.get $pos))))
                  (then (call $advance (i32.const 1) (i32.const 1))))
                (call $prepareLeafParent)
                ;; A footnote container record doubles as its normalized label.
                (block $footDone
                  (br_if $footDone (i32.ge_u (global.get $sp) (i32.const $Nest)))
                  (call $ensureRec (i32.add (i32.const 96)
                    (i32.mul (i32.sub (local.get $m) (i32.const 4)) (i32.const 3))))
                  (local.set $footR (call $recNew (enum.get $Blk.footnote)))
                  (call $recFlag (local.get $footR) (i32.const $F.opener))
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
                  (global.set $rec (local.get $footDst))
                  (call $noteChildAdded (global.get $sp))
                  (global.set $sp (i32.add (global.get $sp) (i32.const 1)))
                  (local.set $footE (call $containerAt (global.get $sp)))
                  (i32.store (local.get $footE) (enum.get $Blk.footnote))
                  (i32.store offset=$CS.indent (local.get $footE) (i32.const 4))
                  (i32.store offset=$CS.rec (local.get $footE) (local.get $footR))
                  (i64.store offset=$CS.line (local.get $footE)
                    (i64.extend_i32_u (global.get $lineEnd)))
                  (global.set $curLevel (global.get $sp)))
                (local.set $contType (enum.get $Blk.footnote))
                (local.set $maybeLazy (i32.const 0))
                (br $try)))))

        ;; list item
        (if (i32.lt_u (global.get $indent) (i32.const 4))
          (then
            (local.set $m (call $parseListMarker (global.get $fns)
              (i32.eq (local.get $contType) (enum.get $Blk.p))))
            (if (local.get $m)
              (then
                (call $startNewBlock)
                (local.set $markerOff (global.get $indent))
                (call $advance
                  (i32.sub (i32.add (global.get $fns) (local.get $m)) (global.get $pos)) (i32.const 0))
                (local.set $save (global.get $pos))
                (local.set $saveCol (global.get $col))
                (local.set $savePtab (global.get $ptab))
                (block $padDone
                  (loop $pad
                    (br_if $padDone (i32.ge_u
                      (i32.sub (global.get $col) (local.get $saveCol)) (i32.const 5)))
                    (br_if $padDone (i32.ge_u (global.get $pos) (global.get $lineEnd)))
                    (br_if $padDone (i32.eqz (call $isSpaceByte (i32.load8_u (global.get $pos)))))
                    (call $advance (i32.const 1) (i32.const 1))
                    (br $pad)))
                (local.set $i (i32.sub (global.get $col) (local.get $saveCol)))
                (if (i32.or
                      (i32.or (i32.ge_u (local.get $i) (i32.const 5))
                        (i32.lt_u (local.get $i) (i32.const 1)))
                      (i32.ge_u (global.get $pos) (global.get $lineEnd)))
                  (then
                    (local.set $padding (i32.add (local.get $m) (i32.const 1)))
                    (global.set $pos (local.get $save))
                    (global.set $col (local.get $saveCol))
                    (global.set $ptab (local.get $savePtab))
                    (if (i32.gt_u (local.get $i) (i32.const 0))
                      (then (call $advance (i32.const 1) (i32.const 1)))))
                  (else (local.set $padding (i32.add (local.get $m) (local.get $i)))))
                ;; reuse the enclosing list when the markers are of the same type
                (local.set $list (i32.const 0))
                (if (global.get $sp)
                  (then
                    (local.set $list (call $containerAt (global.get $sp)))
                    (local.set $list (i32.and
                      (i32.eq (i32.load8_u (local.get $list))
                        (i32.add (enum.get $Blk.ul) (global.get $lmOrdered)))
                      (i32.eq (i32.load8_u offset=$CS.ch (local.get $list))
                        (global.get $lmChar))))))
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
                (br $try)))))

        ;; indented code block
        (if (i32.and (local.get $indented)
              (i32.and (i32.eqz (local.get $maybeLazy)) (i32.eqz (global.get $blank))))
          (then
            (call $startNewBlock)
            (call $advance (i32.const 4) (i32.const 1))
            (call $prepareLeafParent)
            (call $openLeaf (enum.get $Blk.code))
            (global.set $codeFenceCh (i32.const 0))
            (br $stop)))
        (br $stop))))

  ;; phase 3: attach the rest of the line to the deepest open block
  (func $addTextToContainer
    (local $t i32)
    (local $hashN i32)
    (local $hashOrig i32)
    (local $bookI i32)
    (local $bookE i32)
    (local $excluded i32)
    (local $level i32)
    (local $isBlank i32)
    (local $taskE i32)
    (local $taskC i32)
    (call $findFirstNonspace)
    ;; last_line_blank bookkeeping, which decides list looseness
    (local.set $level (global.get $curLevel))
    ;; A consumed thematic break, table row, or fence is not a blank line.
    (local.set $isBlank (i32.and (global.get $blank) (i32.eqz (global.get $skipLine))))
    (if (local.get $isBlank)
      (then
        ;; The last child of the current container ends with a blank line.
        (if (i32.eq (local.get $level) (global.get $sp))
          (then
            (if (global.get $leaf)
              (then (global.set $leafBlank (i32.const 1)))
              (else
                (if (i32.and (i32.gt_u (local.get $level) (i32.const 0))
                      (i32.ne (i32.load offset=$CS.children
                        (call $containerAt (local.get $level))) (i32.const 0)))
                  (then (call $noteChildClosed (local.get $level) (i32.const 1)))))))
          (else
            (if (i32.lt_u (local.get $level) (global.get $sp))
              (then
                (local.set $bookE (call $containerAt
                  (i32.add (local.get $level) (i32.const 1))))
                (i32.store8 offset=$CS.flags (local.get $bookE)
                  (i32.or (i32.load8_u offset=$CS.flags (local.get $bookE))
                    (i32.const $C.lastLineBlank)))))))))
    ;; Then update the current container itself, with the exclusions that keep
    ;; quotes, headings, breaks, fenced code, and fresh items from counting.
    (if (i32.gt_u (local.get $level) (global.get $sp))
      (then
        (local.set $excluded (i32.or
          (i32.le_u (i32.sub (global.get $leaf) (enum.get $Blk.hr)) (i32.const 1))
          (i32.and (i32.eq (global.get $leaf) (enum.get $Blk.code))
            (i32.ne (global.get $codeFenceCh) (i32.const 0)))))
        (global.set $leafBlank
          (i32.and (local.get $isBlank) (i32.eqz (local.get $excluded)))))
      (else
        (if (local.get $level)
          (then
            (local.set $bookE (call $containerAt (local.get $level)))
            (local.set $excluded (i32.or
              (i32.eq (i32.load8_u (local.get $bookE)) (enum.get $Blk.quote))
              (i32.and
                (i32.eq (i32.load8_u (local.get $bookE)) (enum.get $Blk.li))
                (i32.and
                  (i32.eqz (i32.load offset=$CS.children (local.get $bookE)))
                  (i32.eq (i32.load offset=$CS.line (local.get $bookE))
                    (global.get $lineEnd))))))
            (if (i32.and (local.get $isBlank) (i32.eqz (local.get $excluded)))
              (then
                (i32.store8 offset=$CS.flags (local.get $bookE)
                  (i32.or (i32.load8_u offset=$CS.flags (local.get $bookE))
                    (i32.const $C.lastLineBlank))))
              (else
                (i32.store8 offset=$CS.flags (local.get $bookE)
                  (i32.and (i32.load8_u offset=$CS.flags (local.get $bookE))
                    (i32.const $C.clearLastLineBlank)))))))))
    ;; Ancestors are never blank-terminated by this line.
    (local.set $bookI (i32.const 1))
    (local.set $bookE (i32.const $mem.container))
    (block $bookDone
      (loop $book
        (br_if $bookDone (i32.ge_u (local.get $bookI) (local.get $level)))
        (i32.store8 offset=$CS.flags (local.get $bookE)
          (i32.and (i32.load8_u offset=$CS.flags (local.get $bookE))
            (i32.const $C.clearLastLineBlank)))
        (local.set $bookI (i32.add (local.get $bookI) (i32.const 1)))
        (local.set $bookE (i32.add (local.get $bookE) (i32.const $CS.size)))
        (br $book)))
    (if (global.get $skipLine) (then (return)))
    ;; a lazy continuation line joins the open paragraph
    (if (i32.and
          (i32.and
            (i32.eq (global.get $leaf) (enum.get $Blk.p))
            (i32.le_u (global.get $lastMatched) (global.get $sp)))
          (i32.and
            (i32.eq (global.get $curLevel) (global.get $lastMatched))
            (i32.and (i32.eqz (global.get $blank)) (i32.eqz (global.get $closed)))))
      (then
        (call $addLine)
        (return)))
    (call $closeUnmatched)
    (local.set $t (global.get $leaf))
    (if (i32.eq (local.get $t) (enum.get $Blk.code))
      (then
        (call $addLine)
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Blk.html))
      (then
        (call $addLine)
        (if (call $scanHtmlBlockEnd (global.get $htmlKind) (global.get $fns))
          (then (call $closeLeaf)))
        (return)))
    (if (global.get $blank) (then (return)))
    (if (i32.or
          (i32.eq (local.get $t) (enum.get $Blk.heading))
          (i32.le_u (i32.sub (local.get $t) (enum.get $Blk.p)) (i32.const 1)))
      (then
        (if (i32.eq (local.get $t) (enum.get $Blk.heading))
          (then
            ;; drop a trailing run of `#`, when preceded by a space or tab
            (block $hashDone
              (local.set $hashN (call $trimSpaceBack (global.get $lineEnd) (global.get $pos)))
              (global.set $lineEnd (local.get $hashN))
              (local.set $hashOrig (local.get $hashN))
              (block $hashesDone
                (loop $hashes
                  (br_if $hashesDone (i32.le_u (local.get $hashN) (global.get $pos)))
                  (br_if $hashesDone (i32.ne
                    (i32.load8_u (i32.sub (local.get $hashN) (i32.const 1))) (i32.const "#")))
                  (local.set $hashN (i32.sub (local.get $hashN) (i32.const 1)))
                  (br $hashes)))
              (br_if $hashDone (i32.eq (local.get $hashN) (local.get $hashOrig)))
              (if (i32.le_u (local.get $hashN) (global.get $pos))
                (then
                  (global.set $lineEnd (local.get $hashN))
                  (br $hashDone)))
              (br_if $hashDone (i32.eqz
                (call $isSpaceByte
                  (i32.load8_u (i32.sub (local.get $hashN) (i32.const 1))))))
              (global.set $lineEnd (call $trimSpaceBack
                (i32.sub (local.get $hashN) (i32.const 1)) (global.get $pos))))))
        (call $advanceToFns)
        (call $addLine)
        (return)))
    (call $prepareLeafParent)
    (call $openLeaf (enum.get $Blk.p))
    (call $advanceToFns)
    ;; GFM task list item: `[ ]` or `[x]` at the first paragraph of an item.
    (block $taskDone
      (br_if $taskDone (i32.eqz (global.get $sp)))
      (local.set $taskE (call $containerAt (global.get $sp)))
      (br_if $taskDone
        (i32.ne (i32.load8_u (local.get $taskE)) (enum.get $Blk.li)))
      (br_if $taskDone
        (i32.ne (i32.load offset=$CS.children (local.get $taskE)) (i32.const 1)))
      (br_if $taskDone
        (i32.gt_u (i32.add (global.get $pos) (i32.const 3)) (global.get $lineEnd)))
      (br_if $taskDone
        (i32.ne (i32.load8_u (global.get $pos)) (i32.const "[")))
      (local.set $taskC (i32.load8_u offset=1 (global.get $pos)))
      (br_if $taskDone (i32.eqz (i32.or
        (i32.eq (local.get $taskC) (i32.const 32))
        (i32.eq (i32.or (local.get $taskC) (i32.const 32)) (i32.const "x")))))
      (br_if $taskDone
        (i32.ne (i32.load8_u offset=2 (global.get $pos)) (i32.const "]")))
      (if (i32.lt_u (i32.add (global.get $pos) (i32.const 3)) (global.get $lineEnd))
        (then
          (br_if $taskDone (i32.eqz
            (call $isSpaceByte (i32.load8_u offset=3 (global.get $pos)))))))
      (call $recFlag (i32.load offset=$CS.rec (local.get $taskE))
        (i32.or (i32.const $F.task)
          (i32.mul (i32.ne (local.get $taskC) (i32.const 32))
            (i32.const $F.taskDone))))
      (global.set $pos (i32.add (global.get $pos) (i32.const 3)))
      (global.set $col (i32.add (global.get $col) (i32.const 3))))
    (call $addLine))

)
