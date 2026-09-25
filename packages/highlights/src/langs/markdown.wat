(module
  (import "../common.wat")
  (import "../languages.wat")

  ;; A fence can name `markdown` (or `mdx`, which re-enters markdown), so the
  ;; nesting depth is chosen by the input. The counter is raised and lowered
  ;; around each delegation and so returns to zero on its own; never reset it
  ;; in `$hlMarkdown`, which is itself one of the recursive entry points.
  (global $markdownDepth (mut i32) (i32.const 0))
  ;; The fence left open at the end of a stream chunk, so the next chunk
  ;; resumes its body: the fence byte, its run length with the block-quote
  ;; depth packed above, and the body language. The globals hold the
  ;; document's own fence. A fence opened inside a `markdown` or `mdx` fence
  ;; body keeps its registers in $mem.markdownFenceStack at its nesting
  ;; depth, so an inner fence survives the chunk boundary alongside the outer
  ;; one instead of being overwritten by it. The live tokenizer captures both
  ;; and $streamResetGlobals clears both. MDX records an open ESM block here
  ;; too, under the pseudo fence byte 1 (see $mdxEsmRange).
  (global $markdownStreamFence (mut i32) (i32.const 0))
  (global $markdownStreamFenceLen (mut i32) (i32.const 0))
  (global $markdownStreamLang (mut i32) (i32.const 0))

  ;; Address of the 12-byte fence register record for nesting depth $depth
  ;; (1..8); depth 0 lives in the globals above.
  (func $markdownFenceSlot (param $depth i32) (result i32)
    (i32.add
      (i32.const $mem.markdownFenceStack)
      (i32.mul (i32.sub (local.get $depth) (i32.const 1)) (i32.const 12))))

  ;; Fence byte of the fence left open at the current depth, 0 when none.
  (func $markdownFenceReg (result i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then (return (global.get $markdownStreamFence))))
    (i32.load (call $markdownFenceSlot (global.get $markdownDepth))))

  (func $markdownFenceLenReg (result i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then (return (global.get $markdownStreamFenceLen))))
    (i32.load offset=4 (call $markdownFenceSlot (global.get $markdownDepth))))

  (func $markdownFenceLangReg (result i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then (return (global.get $markdownStreamLang))))
    (i32.load offset=8 (call $markdownFenceSlot (global.get $markdownDepth))))

  ;; Record the fence left open at the current depth; a zero $fence clears it.
  (func $markdownFenceSet (param $fence i32) (param $len i32) (param $lang i32)
    (local $slot i32)
    (if (i32.eqz (global.get $markdownDepth))
      (then
        (global.set $markdownStreamFence (local.get $fence))
        (global.set $markdownStreamFenceLen (local.get $len))
        (global.set $markdownStreamLang (local.get $lang))
        (return)))
    (local.set $slot (call $markdownFenceSlot (global.get $markdownDepth)))
    (i32.store (local.get $slot) (local.get $fence))
    (i32.store offset=4 (local.get $slot) (local.get $len))
    (i32.store offset=8 (local.get $slot) (local.get $lang)))

  ;; Forget the fences recorded by bodies nested below the current depth.
  ;; Once the fence at this depth closes, whatever its body left open is
  ;; text of a finished block and must not resume in a later chunk.
  (func $markdownFenceClearDeeper
    (local $from i32)
    (local.set $from (call $markdownFenceSlot (i32.add (global.get $markdownDepth) (i32.const 1))))
    (if (i32.lt_u (local.get $from) (i32.const $mem.markdownFenceStack+96))
      (then
        (memory.fill
          (local.get $from)
          (i32.const 0)
          (i32.sub (i32.const $mem.markdownFenceStack+96) (local.get $from))))))

  ;; Transient: did the last $markdownCodeRange call run a body lexer? The
  ;; caller folds it into the fence registers (bit 8 of the language slot) so
  ;; a later chunk knows whether the body's lexer already checkpointed state
  ;; for this fence.
  (global $markdownBodyRan (mut i32) (i32.const 0))

  ;; Highlight the fence body [$from,$to) as $lang. A whole-buffer run and
  ;; the first chunk of a streamed body start the body's lexer fresh; a later
  ;; chunk of a streamed body ($resume) continues it the way the top-level
  ;; driver continues a document: the shared comment/string modes and the
  ;; language's own resume hooks run first, bounded by the fence closer, and
  ;; checkpoint lexers run at stream depth 0 so their locals carry over. A
  ;; nested markdown or mdx body stays a bounded call one nesting depth down;
  ;; its state lives in the per-depth fence registers.
  (func $markdownCodeRange (param $lang i32) (param $from i32) (param $to i32) (param $resume i32)
    (local $save i32)
    (local $saveDoc i32)
    (local $saveDepth i32)
    (local $saveReset i32)
    (global.set $markdownBodyRan (i32.const 0))
    (if (i32.ge_u (local.get $from) (local.get $to))
      (then
        (global.set $ptr (local.get $to))
        (return)))
    ;; Past the limit the body stays literal text rather than growing the stack:
    ;; the contract says a lexer is total, and a trap would break that.
    (if (i32.ge_u (global.get $markdownDepth) (i32.const 8))
      (then
        (call $emitTok (enum.get $Token.text.literal) (local.get $from) (local.get $to))
        (global.set $ptr (local.get $to))
        (return)))
    (global.set $markdownBodyRan (i32.const 1))
    (global.set $markdownDepth (i32.add (global.get $markdownDepth) (i32.const 1)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    ;; the body is a document of its own, starting here unless it resumes
    (local.set $saveDoc (global.get $docStart))
    (global.set $docStart
      (select
        (local.get $from)
        (i32.const 0)
        (i32.eqz (i32.and (global.get $streaming) (local.get $resume)))))
    (block $codeDone
      (if
        (i32.or
          (i32.eq (local.get $lang) (enum.get $Language.markdown))
          (i32.eq (local.get $lang) (enum.get $Language.mdx)))
        (then
          ;; A `markdown` or `mdx` body first resumes the fence its previous
          ;; chunk left open at this depth, as the document does at top level;
          ;; the lexer then continues after the closer, or the range is spent.
          (if (i32.and (global.get $streaming) (i32.ne (call $markdownFenceReg) (i32.const 0)))
            (then
              (br_if $codeDone (call $markdownStreamResume))
              (br_if $codeDone (i32.ge_u (global.get $ptr) (global.get $end)))))
          (if (i32.eq (local.get $lang) (enum.get $Language.markdown))
            (then (call $hlMarkdown))
            (else (call $hlMdx)))
          (br $codeDone)))
      ;; a fresh body is a fresh sub-document for the shared parameter-machine
      ;; globals; a resumed one keeps them
      (if (i32.or (i32.eqz (global.get $streaming)) (i32.eqz (local.get $resume)))
        (then (call $sigReset)))
      (local.set $saveDepth (global.get $streamDepth))
      (local.set $saveReset (global.get $streamReset))
      (if (global.get $streaming)
        (then
          (global.set $streamDepth (i32.const 0))
          (global.set $streamReset (i32.eqz (local.get $resume)))))
      (block $bodyDone
        ;; the ECMAScript family keeps its own resumable machine
        (if
          (i32.and
            (i32.and (global.get $streaming) (local.get $resume))
            (i32.eqz (call $isEcmaLang (local.get $lang))))
          (then
            (if (global.get $streamRegionKind)
              (then (br_if $bodyDone (call $streamResumeLang (local.get $lang)))))
            (br_if $bodyDone (call $streamResumeCommon))
            (br_if $bodyDone (call $streamResumeLang (local.get $lang)))))
        (call $markdownFenceLexer (local.get $lang) (local.get $resume)))
      (if (global.get $streaming)
        (then
          (global.set $streamDepth (local.get $saveDepth))
          (global.set $streamReset (local.get $saveReset)))))
    (global.set $markdownDepth (i32.sub (global.get $markdownDepth) (i32.const 1)))
    (global.set $docStart (local.get $saveDoc))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  ;; Emit the block-quote prefix of the line at $p - up to $quotes levels of
  ;; at most three spaces, `>`, and one optional blank, as the fence closer
  ;; scan accepts them - and return where the line's content starts. A lazy
  ;; line that lacks some of the markers keeps the rest as content.
  (func $markdownQuotePrefix (param $p i32) (param $lineEnd i32) (param $quotes i32) (result i32)
    (local $q i32)
    (block $done
      (loop $level
        (br_if $done (i32.eqz (local.get $quotes)))
        (local.set $q (call $markdownSkipIndent (local.get $p) (local.get $lineEnd)))
        (br_if $done (i32.ge_u (local.get $q) (local.get $lineEnd)))
        (br_if $done (i32.ne (i32.load8_u (local.get $q)) (i32.const ">")))
        (call $emitGap (local.get $p) (local.get $q))
        (local.set $p (i32.add (local.get $q) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.markup) (local.get $q) (local.get $p))
        (if
          (i32.and
            (i32.lt_u (local.get $p) (local.get $lineEnd))
            (i32.eq (i32.load8_u (local.get $p)) (i32.const 32)))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (call $emitGap (i32.sub (local.get $p) (i32.const 1)) (local.get $p))))
        (local.set $quotes (i32.sub (local.get $quotes) (i32.const 1)))
        (br $level)))
    (local.get $p))

  ;; Highlight the fence body [$from,$to): line by line behind block-quote
  ;; markers, else with its language's lexer, else as literal text.
  (func $markdownFenceBody
    (param $lang i32) (param $from i32) (param $to i32) (param $quotes i32) (param $resume i32)
    (if (call $markdownQuotedLines (local.get $quotes) (local.get $lang))
      (then
        (call $markdownQuotedBody
          (local.get $lang)
          (local.get $from)
          (local.get $to)
          (local.get $quotes)
          (local.get $resume))
        (return)))
    (if (local.get $lang)
      (then
        (call $markdownCodeRange (local.get $lang) (local.get $from) (local.get $to) (local.get $resume))
        (return)))
    (call $emitTok (enum.get $Token.text.literal) (local.get $from) (local.get $to)))

  ;; Emit the closing fence line at $ptr - its block-quote prefix as markup,
  ;; then the fence through the line break - and move $ptr past it.
  (func $markdownFenceCloser (param $quotes i32)
    (local $after i32)
    (local $lineEnd i32)
    (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
    (local.set $after (call $markdownAfterLine (local.get $lineEnd)))
    (call $emitTok
      (enum.get $Token.punctuation.delimiter)
      (call $markdownQuotePrefix (global.get $ptr) (local.get $lineEnd) (local.get $quotes))
      (local.get $after))
    (global.set $ptr (local.get $after)))

  ;; Is the body of a fence opened behind $quotes block-quote markers lexed
  ;; line by line ($markdownQuotedBody)? Not for nested markdown and MDX,
  ;; which read the `>` prefixes as their own block quotes.
  (func $markdownQuotedLines (param $quotes i32) (param $lang i32) (result i32)
    (i32.and
      (i32.ne (local.get $quotes) (i32.const 0))
      (i32.and
        (i32.ne (local.get $lang) (enum.get $Language.markdown))
        (i32.ne (local.get $lang) (enum.get $Language.mdx)))))

  ;; Highlight the body [$from,$to) of a fence opened behind $quotes
  ;; block-quote markers. Each line's `>` prefix is markup, not code, so the
  ;; body lexer runs on each line's content through its stream entry, even
  ;; for whole input. Keep its state across lines and actual stream chunks.
  (func $markdownQuotedBody
    (param $lang i32) (param $from i32) (param $to i32) (param $quotes i32) (param $resume i32)
    (local $after i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $saveEof i32)
    (local $saveStreaming i32)
    (local.set $saveEof (global.get $eof))
    (local.set $saveStreaming (global.get $streaming))
    (global.set $streaming (i32.const 1))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (local.get $from) (local.get $to)))
        (local.set $lineEnd (call $markdownLineEnd (local.get $from)))
        (if (i32.gt_u (local.get $lineEnd) (local.get $to))
          (then (local.set $lineEnd (local.get $to))))
        (local.set $p
          (call $markdownQuotePrefix (local.get $from) (local.get $lineEnd) (local.get $quotes)))
        (local.set $after (call $markdownAfterLine (local.get $lineEnd)))
        (if (i32.gt_u (local.get $after) (local.get $to))
          (then (local.set $after (local.get $to))))
        (if (local.get $lang)
          (then
            (global.set $eof (local.get $after))
            (call $markdownCodeRange (local.get $lang) (local.get $p) (local.get $after) (local.get $resume))
            (local.set $resume (i32.or (local.get $resume) (global.get $markdownBodyRan))))
          (else (call $emitTok (enum.get $Token.text.literal) (local.get $p) (local.get $after))))
        (local.set $from (local.get $after))
        (br $lines)))
    (global.set $eof (local.get $saveEof))
    (global.set $streaming (local.get $saveStreaming))
    (if (i32.eqz (local.get $saveStreaming))
      (then (call $markdownClearEmbeddedStream)))
    (global.set $markdownBodyRan (local.get $resume))
    (global.set $ptr (local.get $to)))

  ;; Dispatch a fence body to its language's lexer; $ptr, $end, and the
  ;; stream globals are already set up by $markdownCodeRange. While
  ;; streaming, the ECMAScript family runs its resumable entry so an open
  ;; template or comment carries to the next chunk of the fence.
  (func $markdownFenceLexer (param $lang i32) (param $resume i32)
    (if (global.get $streaming)
      (then
        (if (call $ecmaStreamLang (local.get $lang) (i32.eqz (local.get $resume)))
          (then (return)))))
    (call $highlightLang (local.get $lang)))

  ;; First CR or LF at or after $p, or $end - one SIMD compare per 16 bytes.
  ;; Every caller passes $p <= $end, so the shared finder's clamp to $end
  ;; matches the old scalar walk exactly.
  (func $markdownLineEnd (param $p i32) (result i32)
    (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))

  ;; ASCII letter or digit, or any byte of a non-ASCII code point: the
  ;; "alphanumeric" of CommonMark's flanking rules, approximated per byte.
  (func $markdownIsAlnum (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (call $lexIsDigit (local.get $c))
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25)))))

  ;; ASCII punctuation, the only bytes a backslash may escape.
  (func $markdownIsPunct (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const "!")) (i32.const 14))
        (i32.le_u (i32.sub (local.get $c) (i32.const ":")) (i32.const 6)))
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const "[")) (i32.const 5))
        (i32.le_u (i32.sub (local.get $c) (i32.const "{")) (i32.const 3)))))

  ;; End of the code span whose opening backtick run starts at $lhs: just
  ;; past the first later run of exactly the same length before $lineEnd, or
  ;; 0 when the line has none. $hlMarkdown's inline-code branch pairs spans
  ;; with it, and the emphasis closer scan uses it so it never pairs a marker
  ;; inside a code span.
  (func $markdownCodeSpanEnd (param $lhs i32) (param $lineEnd i32) (result i32)
    (local $count i32)
    (local $p i32)
    (local $q i32)
    (local.set $p (call $markdownTickRunEnd (local.get $lhs) (local.get $lineEnd)))
    (local.set $count (i32.sub (local.get $p) (local.get $lhs)))
    (block $none
      (loop $code
        ;; hop backtick to backtick with SIMD, bounded to the line
        (local.set $p
          (call $scanFindSpecial
            (local.get $p)
            (local.get $lineEnd)
            (i32.const "`")
            (i32.const 0)
            (i32.const 0)))
        (br_if $none (i32.ge_u (local.get $p) (local.get $lineEnd)))
        (local.set $q (call $markdownTickRunEnd (local.get $p) (local.get $lineEnd)))
        (if (i32.eq (i32.sub (local.get $q) (local.get $p)) (local.get $count))
          (then (return (local.get $q))))
        (local.set $p (local.get $q))
        (br $code)))
    (i32.const 0))

  ;; End of the backtick run starting at $p, bounded by $stop.
  (func $markdownTickRunEnd (param $p i32) (param $stop i32) (result i32)
    (block $done
      (loop $run
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (i32.const "`")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $run)))
    (local.get $p))

  (func $markdownAfterLine (param $p i32) (result i32)
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (if
          (i32.and
            (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
            (i32.and
              (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
              (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 10))))
          (then (return (i32.add (local.get $p) (i32.const 2)))))
        (return (i32.add (local.get $p) (i32.const 1)))))
    (local.get $p))

  ;; End of a list marker at $p (below $end) - `-`, `+`, `*`, or digits then
  ;; `.` or `)` - or $p when none starts there. The blank that must follow
  ;; is the caller's check. Shared with the MDX fence pre-scan so both read
  ;; list items alike.
  (func $markdownListMarkerEnd (param $p i32) (result i32)
    (local $c i32)
    (local $q i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (if
      (i32.or
        (i32.eq (local.get $c) (i32.const "-"))
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "*"))))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (local.set $q (local.get $p))
    (block $digitsDone
      (loop $digits
        (br_if $digitsDone (i32.ge_u (local.get $q) (global.get $end)))
        (br_if $digitsDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $q)))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $digits)))
    (if
      (i32.and
        (i32.gt_u (local.get $q) (local.get $p))
        (i32.and
          (i32.lt_u (local.get $q) (global.get $end))
          (i32.or
            (i32.eq (i32.load8_u (local.get $q)) (i32.const "."))
            (i32.eq (i32.load8_u (local.get $q)) (i32.const ")")))))
      (then (return (i32.add (local.get $q) (i32.const 1)))))
    (local.get $p))

  ;; Skip up to three spaces from $p, bounded by $stop: the indentation a
  ;; block construct may carry without becoming indented code.
  (func $markdownSkipIndent (param $p i32) (param $stop i32) (result i32)
    (local $n i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $n) (i32.const 3)))
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (i32.const 32)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Start of the first line at or after $p that closes a fence: $quotes
  ;; block-quote markers, at most three spaces, a run of at least $len $fence
  ;; bytes, then only blanks. The indent and quote prefixes mirror what the
  ;; opener accepts, so fences inside list items and block quotes close.
  ;; Returns $end when the fence never closes. Shared with the MDX pre-scan
  ;; so the two lexers agree on where a fenced body ends.
  (func $markdownFenceClose
    (param $p i32)
    (param $fence i32)
    (param $len i32)
    (param $quotes i32)
    (result i32)
    (local $c i32)
    (local $lineEnd i32)
    (local $n i32)
    (local $q i32)
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $lineEnd (call $markdownLineEnd (local.get $p)))
        (local.set $q (local.get $p))
        (block $skip
          ;; each block-quote level: up to three spaces, `>`, one optional blank
          (local.set $n (local.get $quotes))
          (block $quotesDone
            (loop $quoteLevel
              (br_if $quotesDone (i32.eqz (local.get $n)))
              (local.set $q (call $markdownSkipIndent (local.get $q) (local.get $lineEnd)))
              (br_if $skip (i32.ge_u (local.get $q) (local.get $lineEnd)))
              (br_if $skip (i32.ne (i32.load8_u (local.get $q)) (i32.const ">")))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (if
                (i32.and
                  (i32.lt_u (local.get $q) (local.get $lineEnd))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const 32)))
                (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
              (local.set $n (i32.sub (local.get $n) (i32.const 1)))
              (br $quoteLevel)))
          (local.set $q (call $markdownSkipIndent (local.get $q) (local.get $lineEnd)))
          (local.set $n (local.get $q))
          (block $runDone
            (loop $run
              (br_if $runDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
              (br_if $runDone (i32.ne (i32.load8_u (local.get $q)) (local.get $fence)))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $run)))
          (br_if $skip (i32.lt_u (i32.sub (local.get $q) (local.get $n)) (local.get $len)))
          (block $spaceDone
            (loop $space
              (br_if $spaceDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
              (local.set $c (i32.load8_u (local.get $q)))
              (br_if $spaceDone
                (i32.and
                  (i32.ne (local.get $c) (i32.const 32))
                  (i32.ne (local.get $c) (i32.const 9))))
              (local.set $q (i32.add (local.get $q) (i32.const 1)))
              (br $space)))
          (if (i32.eq (local.get $q) (local.get $lineEnd))
            (then (return (local.get $p)))))
        (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
        (br $lines)))
    (global.get $end))

  ;; Drop stream state left behind by an embedded range that finished inside
  ;; this chunk. A fence body or an inline HTML range hands its bytes to
  ;; another lexer over an $end swap; at that inner end the lexer may
  ;; checkpoint an open comment, string, or script/style region as if the
  ;; chunk ended there. When the range really continues in the next chunk
  ;; (a fence body cut by the chunk end) that state is kept and resumed by
  ;; $markdownCodeRange; otherwise markdown continues and it must not leak.
  (func $markdownClearEmbeddedStream
    (global.set $streamMode (i32.const 0))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamRegionStarted (i32.const 0)))

  ;; Continue a fenced block whose closing delimiter is in a later stream
  ;; chunk. Returns one while the whole chunk belongs to the fence body.
  ;; The fence length register packs the block-quote depth of the opener
  ;; into its upper half so the closer scan can demand the same `>` prefix;
  ;; the language register carries bit 8 once the body's lexer has run, so
  ;; the next chunk resumes that lexer instead of starting it fresh.
  ;; Runs at the current nesting depth: for the document itself from
  ;; $streamChunk, and for a nested markdown body from $markdownCodeRange,
  ;; which resumes a fence recorded one depth down.
  (func $markdownStreamResume (result i32)
    (local $after i32)
    (local $close i32)
    (local $fence i32)
    (local $lang i32)
    (local $len i32)
    (local $lineEnd i32)
    (local $quotes i32)
    (local $reg i32)
    (local.set $fence (call $markdownFenceReg))
    (if (i32.eqz (local.get $fence))
      (then (return (i32.const 0))))
    (local.set $len (call $markdownFenceLenReg))
    (local.set $reg (call $markdownFenceLangReg))
    ;; pseudo fence byte 1: an MDX ESM block, which a blank line ends
    (if (i32.eq (local.get $fence) (i32.const 1))
      (then (return (call $mdxEsmResume (local.get $reg)))))
    (local.set $lang (i32.and (local.get $reg) (i32.const 0xff)))
    (local.set $quotes (i32.shr_u (local.get $len) (i32.const 16)))
    (local.set $close
      (call $markdownFenceClose
        (global.get $ptr)
        (local.get $fence)
        (i32.and (local.get $len) (i32.const 0xffff))
        (local.get $quotes)))
    (call $markdownFenceBody
      (local.get $lang)
      (global.get $ptr)
      (local.get $close)
      (local.get $quotes)
      (i32.ne (i32.and (local.get $reg) (i32.const 0x100)) (i32.const 0)))
    (if (i32.eq (local.get $close) (global.get $end))
      (then
        ;; still open: the body's stream state stays live for the next chunk
        (if (i32.and (i32.ne (local.get $lang) (i32.const 0)) (global.get $markdownBodyRan))
          (then
            (call $markdownFenceSet
              (local.get $fence)
              (local.get $len)
              (i32.or (local.get $lang) (i32.const 0x100)))))
        (return (i32.const 1))))
    ;; closed in this chunk: whatever the body left open is finished text
    (call $markdownClearEmbeddedStream)
    (global.set $ptr (local.get $close))
    (call $markdownFenceCloser (local.get $quotes))
    ;; a nested body records its own fences one depth down, so the registers
    ;; at this depth still describe the fence being closed
    (call $markdownFenceSet (i32.const 0) (i32.const 0) (i32.const 0))
    (call $markdownFenceClearDeeper)
    (i32.const 0))

  (func $markdownPlainEnd (param $p i32) (result i32)
    (local $hits v128)
    (local $mask i32)
    (local $w v128)
    (block $tail
      (loop $wide
        (br_if $tail (i32.lt_u (i32.sub (global.get $end) (local.get $p)) (i32.const 16)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $hits
          (v128.or
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 13)))))
        (local.set $hits
          (v128.or
            (local.get $hits)
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "<")))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "["))))))
        (local.set $hits
          (v128.or
            (local.get $hits)
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "`")))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const 92))))))
        (local.set $hits
          (v128.or
            (local.get $hits)
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "*")))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_"))))))
        (local.set $hits
          (v128.or (local.get $hits) (i8x16.eq (local.get $w) (i8x16.splat (i32.const "|")))))
        (local.set $mask (i8x16.bitmask (local.get $hits)))
        (if (local.get $mask)
          (then (return (i32.add (local.get $p) (i32.ctz (local.get $mask))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (block $done
      (loop $scalar
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $mask (i32.load8_u (local.get $p)))
        (br_if $done (byteset.get "\0a\0d*<[\5c_`|" (local.get $mask)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scalar)))
    (local.get $p))

  ;; End of one inline HTML construct starting at the `<` at $lhs, whose line
  ;; ends at $lineEnd. Returns lhs+1 when the byte after `<` rules a tag out,
  ;; and 0 when a tag could start but nothing closes it before the line end:
  ;; the caller then treats every later `<` on the line as plain text without
  ;; rescanning, which keeps a line of many `<` linear. Quoted attribute
  ;; values are bounded to the line too, so a tag never spans the chunk
  ;; boundary the line-fed engines cut at. A `<script` or `<style` open tag
  ;; extends through its matching close tag, or to $end, so the raw-text body
  ;; reaches the HTML lexer the same way whole-buffer and streamed.
  (func $markdownHtmlEnd (param $lhs i32) (param $lineEnd i32) (result i32)
    (local $p i32)
    (local $q i32)
    (local $c i32)
    (local $kind i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (local.get $p))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if
      (i32.eqz
        (i32.or
          (i32.eq (local.get $c) (i32.const "/"))
          (i32.or
            (i32.eq (local.get $c) (i32.const "!"))
            (i32.or
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.or
                (call $lexIsIdentStart (local.get $c))
                (i32.eq (local.get $c) (i32.const ":")))))))
      (then (return (local.get $p))))
    ;; HTML comments need their real terminator, not the first `>`.
    (if
      (i32.and
        (i32.le_u (i32.add (local.get $lhs) (i32.const 4)) (global.get $end))
        (i32.eq (i32.load (local.get $lhs)) (i32.const "<!--")))
      (then
        ;; hop dash to dash with SIMD; a terminator must start with `-`
        (local.set $p (i32.add (local.get $lhs) (i32.const 4)))
        (block $commentDone
          (loop $comment
            (local.set $p (call $lexFindByte (local.get $p) (i32.const "-")))
            (br_if $commentDone (i32.ge_u (local.get $p) (global.get $end)))
            (if
              (i32.and
                (i32.le_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
                (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)) (i32.const "-->")))
              (then (return (i32.add (local.get $p) (i32.const 3)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $comment)))
        (return (global.get $end))))
    ;; no `>` left on the line: nothing at or after $p can close a tag
    (if
      (i32.ge_u
        (call $scanFindSpecial
          (local.get $p)
          (local.get $lineEnd)
          (i32.const ">")
          (i32.const 0)
          (i32.const 0))
        (local.get $lineEnd))
      (then (return (i32.const 0))))
    (block $closed
      (loop $l
        (if (i32.ge_u (local.get $p) (local.get $lineEnd))
          (then (return (i32.const 0))))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $closed (i32.eq (local.get $c) (i32.const ">")))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            ;; hop to the closing quote with SIMD, bounded to the line
            (local.set $p
              (call $scanFindSpecial
                (local.get $p)
                (local.get $lineEnd)
                (local.get $c)
                (i32.const 0)
                (i32.const 0)))
            (if (i32.ge_u (local.get $p) (local.get $lineEnd))
              (then (return (i32.const 0))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (br $l)))
    ;; raw-text elements: run through the close tag the HTML lexer will stop at
    (if (call $lexIsIdentStart (i32.load8_u offset=1 (local.get $lhs)))
      (then
        (local.set $kind
          (call $rawTextKind
            (i32.add (local.get $lhs) (i32.const 1))
            (call $htmlNameEnd (i32.add (local.get $lhs) (i32.const 1)))))
        (if (local.get $kind)
          (then
            (local.set $q (local.get $p))
            (block $rawDone
              (loop $raw
                (local.set $q (call $lexFindByte (local.get $q) (i32.const "<")))
                (br_if $rawDone (i32.ge_u (local.get $q) (global.get $end)))
                (if (call $isRawTextClose (local.get $q) (local.get $kind))
                  (then
                    (local.set $q (call $lexFindByte (local.get $q) (i32.const ">")))
                    (if (i32.lt_u (local.get $q) (global.get $end))
                      (then (return (i32.add (local.get $q) (i32.const 1)))))
                    (return (global.get $end))))
                (local.set $q (i32.add (local.get $q) (i32.const 1)))
                (br $raw)))
            (return (global.get $end))))))
    (local.get $p))

  ;; End (just past `>`) of a CommonMark autolink opening at the `<` at $lhs,
  ;; or 0. A URI autolink is a scheme - a letter, then 1-31 letters, digits,
  ;; `+`, `.`, or `-` - a colon, and bytes other than blanks, controls, `<`,
  ;; and `>`; an email autolink is `local@domain`, approximated with the
  ;; usual address bytes. Both stay on one line, and both take precedence
  ;; over inline HTML, which cannot name a tag with `:` or `@`.
  (func $markdownAutolinkEnd (param $lhs i32) (param $lineEnd i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    ;; the scheme, or an email's local part: ASCII letters, the range `+`
    ;; through `9` (digits, `+`, `-`, `.`, and also `,` and `/`), `_`, and
    ;; non-ASCII bytes - one range test instead of four compares. A tag name
    ;; ends this loop within a few bytes, at a blank or `>`.
    (block $wordDone
      (loop $word
        (br_if $wordDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $wordDone
          (i32.eqz
            (i32.or
              (i32.or
                (i32.le_u
                  (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
                  (i32.const 25))
                (i32.le_u (i32.sub (local.get $c) (i32.const "+")) (i32.const 14)))
              (i32.or
                (i32.eq (local.get $c) (i32.const "_"))
                (i32.ge_u (local.get $c) (i32.const 0x80))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $word)))
    (if (i32.ge_u (local.get $p) (local.get $lineEnd))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if
      (i32.and
        (i32.eq (local.get $c) (i32.const ":"))
        (i32.and
          (i32.le_u
            (i32.sub (i32.sub (local.get $p) (local.get $lhs)) (i32.const 3))
            (i32.const 30))
          (i32.le_u
            (i32.sub
              (i32.or (i32.load8_u offset=1 (local.get $lhs)) (i32.const 32))
              (i32.const "a"))
            (i32.const 25))))
      (then
        (block $uriDone
          (loop $uri
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $uriDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then (return (i32.add (local.get $p) (i32.const 1)))))
            (br_if $uriDone
              (i32.or
                (i32.le_u (local.get $c) (i32.const 32))
                (i32.or
                  (i32.eq (local.get $c) (i32.const "<"))
                  (i32.eq (local.get $c) (i32.const 127)))))
            (br $uri)))
        (return (i32.const 0))))
    ;; email: a non-empty local part, `@`, a non-empty domain, then `>`
    (if
      (i32.or
        (i32.ne (local.get $c) (i32.const "@"))
        (i32.eq (local.get $p) (i32.add (local.get $lhs) (i32.const 1))))
      (then (return (i32.const 0))))
    (local.set $c (local.get $p))
    (block $domainDone
      (loop $domain
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $domainDone (i32.ge_u (local.get $p) (local.get $lineEnd)))
        (br_if $domainDone
          (i32.eqz
            (i32.or
              (call $markdownIsAlnum (i32.load8_u (local.get $p)))
              (i32.or
                (i32.eq (i32.load8_u (local.get $p)) (i32.const "."))
                (i32.eq (i32.load8_u (local.get $p)) (i32.const "-"))))))
        (br $domain)))
    (if
      (i32.and
        (i32.gt_u (local.get $p) (i32.add (local.get $c) (i32.const 1)))
        (i32.and
          (i32.lt_u (local.get $p) (local.get $lineEnd))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const ">"))))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (i32.const 0))

  ;; A link whose text is an image, `[![alt](src)](href)` - the badge rows
  ;; that open most READMEs. The generic link scan pairs the outer `[` with
  ;; the image's `]`, so this shape is matched first: when the whole of it
  ;; lies on the line, emit the image inside the outer link and return the
  ;; end past the final `)`; otherwise emit nothing and return 0.
  (func $markdownImageLink (param $lhs i32) (param $lineEnd i32) (result i32)
    (local $alt i32)
    (local $src i32)
    (local $href i32)
    (if
      (i32.or
        (i32.ge_u (i32.add (local.get $lhs) (i32.const 3)) (local.get $lineEnd))
        (i32.ne (i32.load16_u offset=1 (local.get $lhs)) (i32.const "![")))
      (then (return (i32.const 0))))
    ;; each of `](`, `)](`, and `)` must follow on the line
    (local.set $alt
      (call $scanFindSpecial
        (i32.add (local.get $lhs) (i32.const 3))
        (local.get $lineEnd)
        (i32.const "]")
        (i32.const 0)
        (i32.const 0)))
    (if
      (i32.or
        (i32.ge_u (i32.add (local.get $alt) (i32.const 1)) (local.get $lineEnd))
        (i32.ne (i32.load8_u offset=1 (local.get $alt)) (i32.const "(")))
      (then (return (i32.const 0))))
    (local.set $src
      (call $scanFindSpecial
        (i32.add (local.get $alt) (i32.const 2))
        (local.get $lineEnd)
        (i32.const ")")
        (i32.const 0)
        (i32.const 0)))
    (if
      (i32.or
        (i32.ge_u (i32.add (local.get $src) (i32.const 2)) (local.get $lineEnd))
        (i32.ne (i32.load16_u offset=1 (local.get $src)) (i32.const "](")))
      (then (return (i32.const 0))))
    (local.set $href
      (call $scanFindSpecial
        (i32.add (local.get $src) (i32.const 3))
        (local.get $lineEnd)
        (i32.const ")")
        (i32.const 0)
        (i32.const 0)))
    (if (i32.ge_u (local.get $href) (local.get $lineEnd))
      (then (return (i32.const 0))))
    (call $emitTok
      (enum.get $Token.punctuation.bracket)
      (local.get $lhs)
      (i32.add (local.get $lhs) (i32.const 1)))
    (call $emitTok
      (enum.get $Token.none)
      (i32.add (local.get $lhs) (i32.const 1))
      (i32.add (local.get $lhs) (i32.const 2)))
    (call $markdownLink (i32.add (local.get $lhs) (i32.const 2)) (local.get $alt) (local.get $src))
    (call $markdownLinkTail (i32.add (local.get $src) (i32.const 1)) (local.get $href))
    (i32.add (local.get $href) (i32.const 1)))

  ;; Emit the link `[text](uri)` whose `[` is at $lhs, `]` at $close, and
  ;; `)` at $rhs.
  (func $markdownLink (param $lhs i32) (param $close i32) (param $rhs i32)
    (call $emitTok
      (enum.get $Token.punctuation.bracket)
      (local.get $lhs)
      (i32.add (local.get $lhs) (i32.const 1)))
    (call $emitTok
      (enum.get $Token.link_text)
      (i32.add (local.get $lhs) (i32.const 1))
      (local.get $close))
    (call $markdownLinkTail (local.get $close) (local.get $rhs)))

  ;; Emit a link's `](uri)`: `]` at $close, `)` at $rhs.
  (func $markdownLinkTail (param $close i32) (param $rhs i32)
    (call $emitTok
      (enum.get $Token.punctuation.bracket)
      (local.get $close)
      (i32.add (local.get $close) (i32.const 2)))
    (call $emitTok
      (enum.get $Token.link_uri)
      (i32.add (local.get $close) (i32.const 2))
      (local.get $rhs))
    (call $emitTok
      (enum.get $Token.punctuation.bracket)
      (local.get $rhs)
      (i32.add (local.get $rhs) (i32.const 1))))

  ;; Failed-scan memo of the emphasis closer scan, reset by each $hlMarkdown
  ;; call: no closer for a `_` opener of width $markdownUnderNoCloseCount
  ;; exists before $markdownUnderNoClose. Closers glued to an alphanumeric
  ;; byte are skipped, so a line of such openers would otherwise rescan to
  ;; the line end from each one. Positions only grow within a call, so the
  ;; memo expires by itself; a nested markdown body resets it, which only
  ;; costs the outer lexer a rescan.
  (global $markdownUnderNoClose (mut i32) (i32.const 0))
  (global $markdownUnderNoCloseCount (mut i32) (i32.const 0))

  ;; The next $c or backtick in [$p,$stop), or $stop - one SIMD comparison
  ;; pair per 16 bytes. Wide loads may pass $stop into the buffer slack;
  ;; matches there are clamped away.
  (func $markdownFindEither (param $p i32) (param $stop i32) (param $c i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (if (i32.ge_u (local.get $p) (local.get $stop))
      (then (return (local.get $stop))))
    (block $done
      (loop $simd
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (local.get $c)))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "`"))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br_if $simd (i32.lt_u (local.get $p) (local.get $stop)))))
    (select (local.get $p) (local.get $stop) (i32.lt_u (local.get $p) (local.get $stop))))

  ;; End of the emphasis opened at $lhs by $count (1 or 2) `$c` markers
  ;; (`*` or `_`) and closed by an equal run on the line [.., $lineEnd), or
  ;; 0. A marker inside a code span never closes, and a `_` run neither opens
  ;; glued to a preceding alphanumeric byte nor closes before one.
  (func $markdownEmphasisEnd (param $lhs i32) (param $c i32) (param $count i32) (param $lineEnd i32) (result i32)
    (local $p i32)
    (local $q i32)
    (local.set $p (i32.add (local.get $lhs) (local.get $count)))
    (if (i32.eq (local.get $c) (i32.const "_"))
      (then
        ;; `_` opens only when left-flanking: not glued to a preceding
        ;; alphanumeric byte and not followed by a blank, so
        ;; `snake_case_name` stays plain. The byte before the chunk start is
        ;; a line break, which never flanks.
        (if
          (i32.or
            (i32.and
              (i32.gt_u (local.get $lhs) (global.get $srcBase))
              (call $markdownIsAlnum (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))
            (i32.or
              (i32.ge_u (local.get $p) (local.get $lineEnd))
              (call $lexIsSpace (i32.load8_u (local.get $p)))))
          (then (return (i32.const 0))))
        (if
          (i32.and
            (i32.lt_u (local.get $lhs) (global.get $markdownUnderNoClose))
            (i32.eq (local.get $count) (global.get $markdownUnderNoCloseCount)))
          (then (return (i32.const 0))))))
    (loop $em
      ;; hop to the next marker or backtick with SIMD, bounded to the line
      (local.set $p (call $markdownFindEither (local.get $p) (local.get $lineEnd) (local.get $c)))
      (if (i32.ge_u (local.get $p) (local.get $lineEnd))
        (then
          (if (i32.eq (local.get $c) (i32.const "_"))
            (then
              (global.set $markdownUnderNoClose (local.get $lineEnd))
              (global.set $markdownUnderNoCloseCount (local.get $count))))
          (return (i32.const 0))))
      ;; A code span hides the markers inside it: resume after the span, or
      ;; after an unmatched backtick run, which is literal text.
      (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "`"))
        (then
          (local.set $q (call $markdownCodeSpanEnd (local.get $p) (local.get $lineEnd)))
          (local.set $p
            (if (result i32) (local.get $q)
              (then (local.get $q))
              (else (call $markdownTickRunEnd (local.get $p) (local.get $lineEnd)))))
          (br $em)))
      ;; the candidate run's end, 0 when a `**`/`__` opener meets a single
      ;; marker
      (local.set $q (i32.add (local.get $p) (i32.const 1)))
      (if (i32.eq (local.get $count) (i32.const 2))
        (then
          (local.set $q
            (select
              (i32.add (local.get $p) (i32.const 2))
              (i32.const 0)
              (i32.and
                (i32.lt_u (local.get $q) (local.get $lineEnd))
                (i32.eq (i32.load8_u (local.get $q)) (local.get $c)))))))
      ;; `_` cannot close right before an ASCII letter or digit, so
      ;; `_private_method` stays plain. A non-ASCII byte after it is taken as
      ;; punctuation: `_word_—` and `_word_’s` are far more common than a
      ;; non-ASCII letter glued to the closer.
      (if
        (i32.and
          (i32.ne (local.get $q) (i32.const 0))
          (i32.or
            (i32.ne (local.get $c) (i32.const "_"))
            (i32.or
              (i32.ge_u (local.get $q) (local.get $lineEnd))
              (i32.or
                (i32.ge_u (i32.load8_u (local.get $q)) (i32.const 0x80))
                (i32.eqz (call $markdownIsAlnum (i32.load8_u (local.get $q))))))))
        (then (return (local.get $q))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $em))
    (i32.const 0))

  (func $markdownHtmlRange (param $from i32) (param $to i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlHtml)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $markdownYamlRange (param $from i32) (param $to i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlYaml)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $hlMarkdown
    (local $body i32)
    (local $c i32)
    (local $close i32)
    (local $count i32)
    (local $fence i32)
    (local $fenceLen i32)
    (local $htmlEnd i32)
    (local $info i32)
    (local $lang i32)
    (local $lhs i32)
    ;; End of the line the cursor is on, computed lazily. Valid only while
    ;; $ptr stays below it; every user re-derives it once $ptr reaches or
    ;; passes it. Within one call $ptr only moves forward and $end is restored
    ;; around embedded ranges, so a value below the cache never crosses CR/LF.
    (local $lineCache i32)
    (local $lineEnd i32)
    (local $lineStart i32)
    ;; Failed-scan memos, each a position on the current line: no inline tag
    ;; closes before $htmlNoClose, and no `[..](..)` link can complete from a
    ;; `[` before $linkNoClose. Positions only grow, so a memo expires by
    ;; itself once the cursor passes it. They keep a line of many `<` or `[`
    ;; linear instead of rescanning to the line end per byte.
    (local $htmlNoClose i32)
    (local $linkNoClose i32)
    (local $p i32)
    (local $q i32)
    ;; block-quote markers seen on the current line; a fence opened behind
    ;; them closes only behind the same prefix
    (local $quotes i32)
    (call $lexEmitLeadingContinuation)
    ;; Each stream chunk is rewritten at the same base address, so a line-end
    ;; cache restored from an earlier chunk points into unrelated bytes and
    ;; may exceed the new $end. Start every call with the cache invalid.
    (local.set $lineCache (i32.const 0))
    (local.set $htmlNoClose (i32.const 0))
    (local.set $linkNoClose (i32.const 0))
    (global.set $markdownUnderNoClose (i32.const 0))
    (global.set $markdownUnderNoCloseCount (i32.const 0))
    (local.set $quotes (i32.const 0))

    ;; YAML front matter is recognized only at the beginning of the source and
    ;; only when the opener occupies its own line. Every stream chunk starts
    ;; at $srcBase, so streaming also demands the first chunk: otherwise a
    ;; thematic break `---` mid-document would open front matter.
    (local.set $body (call $frontMatterOpen))
    (if (local.get $body)
      (then
        (call $emitTok
          (enum.get $Token.punctuation.special)
          (global.get $ptr)
          (local.get $body))
        (local.set $close (call $frontMatterClose (local.get $body)))
        (call $markdownYamlRange (local.get $body) (local.get $close))
        (if (i32.and (global.get $streaming) (i32.eq (local.get $close) (global.get $end)))
          (then
            (call $streamSetRegion (i32.const 4))
            (global.set $streamRegionStarted (i32.const 1)))
          (else
            (if (global.get $streaming)
              (then (call $markdownClearEmbeddedStream)))))
        (call $frontMatterCloser (local.get $close))))

    (local.set $lineStart
      (i32.or
        (i32.eq (global.get $ptr) (global.get $srcBase))
        (i32.and
          (i32.gt_u (global.get $ptr) (global.get $srcBase))
          (i32.or
            (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
            (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13))))))

    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        ;; Newline bytes are gaps and reset block-prefix recognition.
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then
            (global.set $ptr (call $markdownAfterLine (global.get $ptr)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $lineStart (i32.const 1))
            (local.set $quotes (i32.const 0))
            (br $next)))

        ;; Up to three leading spaces retain line-start meaning.
        (if (i32.and (local.get $lineStart) (i32.eq (local.get $c) (i32.const 32)))
          (then
            (local.set $count (i32.const 0))
            (block $indentDone
              (loop $indent
                (br_if $indentDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $indentDone (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 32)))
                (br_if $indentDone (i32.ge_u (local.get $count) (i32.const 3)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $count (i32.add (local.get $count) (i32.const 1)))
                (br $indent)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Block quote marker. Keeping line-start state accepts nested `> >`.
        (if (i32.and (local.get $lineStart) (i32.eq (local.get $c) (i32.const ">")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
            (local.set $quotes (i32.add (local.get $quotes) (i32.const 1)))
            (br $next)))

        ;; ATX heading.
        (if (i32.and (local.get $lineStart) (i32.eq (local.get $c) (i32.const "#")))
          (then
            (local.set $p (global.get $ptr))
            (block $hashDone
              (loop $hash
                (br_if $hashDone (i32.ge_u (local.get $p) (global.get $end)))
                (br_if $hashDone (i32.ne (i32.load8_u (local.get $p)) (i32.const "#")))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $hash)))
            (if
              (i32.and
                (i32.le_u (i32.sub (local.get $p) (global.get $ptr)) (i32.const 6))
                (i32.and
                  (i32.lt_u (local.get $p) (global.get $end))
                  (call $lexIsSpace (i32.load8_u (local.get $p)))))
              (then
                (call $emitTok
                  (enum.get $Token.title)
                  (global.get $ptr)
                  (local.get $p))
                (global.set $ptr (local.get $p))
                (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
                ;; The blanks after the marker are line-bounded: an empty
                ;; heading must not eat the newline and take the next line as
                ;; its title.
                (local.set $p (global.get $ptr))
                (block $blankDone
                  (loop $blank
                    (br_if $blankDone (i32.ge_u (global.get $ptr) (local.get $lineEnd)))
                    (br_if $blankDone (i32.eqz (call $lexIsSpace (i32.load8_u (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $blank)))
                (call $emitGap (local.get $p) (global.get $ptr))
                (call $emitTok (enum.get $Token.title) (global.get $ptr) (local.get $lineEnd))
                (global.set $ptr (local.get $lineEnd))
                (local.set $lineStart (i32.const 0))
                (br $next)))))

        ;; Fenced code block. A supported info-string language delegates the
        ;; bounded body to its lexer; unknown languages remain text.literal.
        ;; A closing fence starts a line and is at least the opener's length.
        (if
          (i32.and
            (local.get $lineStart)
            (i32.or
              (i32.eq (local.get $c) (i32.const "`"))
              (i32.eq (local.get $c) (i32.const "~"))))
          (then
            (local.set $fence (local.get $c))
            (local.set $p (global.get $ptr))
            (block $openRunDone
              (loop $openRun
                (br_if $openRunDone (i32.ge_u (local.get $p) (global.get $end)))
                (br_if $openRunDone (i32.ne (i32.load8_u (local.get $p)) (local.get $fence)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $openRun)))
            (local.set $fenceLen (i32.sub (local.get $p) (global.get $ptr)))
            (if (i32.ge_u (local.get $fenceLen) (i32.const 3))
              (then
                (local.set $lineEnd (call $markdownLineEnd (global.get $ptr)))
                (local.set $q (local.get $p))
                (block $infoStart
                  (loop $infoSpace
                    (br_if $infoStart (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (br_if $infoStart (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $q)))))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $infoSpace)))
                ;; Pandoc and Quarto brace the language: `{python}`, `{.rust}`,
                ;; `{r, echo=FALSE}`.
                (if
                  (i32.and
                    (i32.lt_u (local.get $q) (local.get $lineEnd))
                    (i32.eq (i32.load8_u (local.get $q)) (i32.const "{")))
                  (then
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (if
                      (i32.and
                        (i32.lt_u (local.get $q) (local.get $lineEnd))
                        (i32.eq (i32.load8_u (local.get $q)) (i32.const ".")))
                      (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))))
                (local.set $info (local.get $q))
                ;; The language word also ends at attributes glued to it:
                ;; rustdoc `rust,ignore`, VitePress `js{4}` and
                ;; `ts:line-numbers`. No alias contains these bytes.
                (block $infoDone
                  (loop $infoWord
                    (br_if $infoDone (i32.ge_u (local.get $q) (local.get $lineEnd)))
                    (local.set $c (i32.load8_u (local.get $q)))
                    (br_if $infoDone (call $lexIsSpace (local.get $c)))
                    (br_if $infoDone
                      (i32.or
                        (i32.or
                          (i32.eq (local.get $c) (i32.const ","))
                          (i32.eq (local.get $c) (i32.const ":")))
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "{"))
                          (i32.eq (local.get $c) (i32.const "}")))))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $infoWord)))
                (local.set $lang (call $languageByName (local.get $info) (local.get $q)))
                (local.set $body (call $markdownAfterLine (local.get $lineEnd)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (global.get $ptr)
                  (local.get $body))
                (local.set $close
                  (call $markdownFenceClose
                    (local.get $body)
                    (local.get $fence)
                    (local.get $fenceLen)
                    (local.get $quotes)))
                (call $markdownFenceBody
                  (local.get $lang)
                  (local.get $body)
                  (local.get $close)
                  (local.get $quotes)
                  (i32.const 0))
                (if (global.get $streaming)
                  (then
                    (if (i32.eq (local.get $close) (global.get $end))
                      (then
                        ;; the body continues in the next chunk: whatever its
                        ;; lexer left open stays live, and the registers
                        ;; record the fence - run length in the low half,
                        ;; block-quote depth above, and bit 8 of the language
                        ;; once the body's lexer has run
                        (call $markdownFenceSet
                          (local.get $fence)
                          (i32.or
                            (select
                              (i32.const 0xffff)
                              (local.get $fenceLen)
                              (i32.gt_u (local.get $fenceLen) (i32.const 0xffff)))
                            (i32.shl
                              (select
                                (i32.const 0x7fff)
                                (local.get $quotes)
                                (i32.gt_u (local.get $quotes) (i32.const 0x7fff)))
                              (i32.const 16)))
                          (i32.or
                            (local.get $lang)
                            (select
                              (i32.const 0x100)
                              (i32.const 0)
                              (i32.and
                                (i32.ne (local.get $lang) (i32.const 0))
                                (global.get $markdownBodyRan))))))
                      (else
                        ;; the block closed in this chunk: a construct its
                        ;; body left open, and fences left open at deeper
                        ;; depths, are finished text
                        (call $markdownClearEmbeddedStream)
                        (call $markdownFenceClearDeeper)))))
                (global.set $ptr (local.get $close))
                (if (i32.lt_u (local.get $close) (global.get $end))
                  (then (call $markdownFenceCloser (local.get $quotes))))
                ;; the closer consumed its line break: the next line starts
                ;; outside the block quote until it shows its own `>`
                (local.set $lineStart (i32.const 1))
                (local.set $quotes (i32.const 0))
                (br $next)))))

        ;; Unordered and ordered list markers.
        (if (local.get $lineStart)
          (then
            (local.set $p (call $markdownListMarkerEnd (global.get $ptr)))
            (if
              (i32.and
                (i32.gt_u (local.get $p) (global.get $ptr))
                (i32.and
                  (i32.lt_u (local.get $p) (global.get $end))
                  (call $lexIsSpace (i32.load8_u (local.get $p)))))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok
                  (enum.get $Token.punctuation.list_marker)
                  (local.get $lhs)
                  (global.get $ptr))
                ;; the item content keeps line-start meaning: `- ```js` opens
                ;; a fence and `- # title` is a heading
                (br $next)))))

        (local.set $lineStart (i32.const 0))

        ;; Pipe-table punctuation. A lightweight lexer also accepts a lone pipe
        ;; as markup rather than buffering table state.
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.markup) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Autolinks, else inline HTML: give exactly one bounded construct to
        ;; the HTML lexer.
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (local.set $q (call $markdownAutolinkEnd (global.get $ptr) (local.get $lineCache)))
            (if (local.get $q)
              (then
                (local.set $p (i32.sub (local.get $q) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.bracket)
                  (global.get $ptr)
                  (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.link_uri)
                  (i32.add (global.get $ptr) (i32.const 1))
                  (local.get $p))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (local.get $q))
                (global.set $ptr (local.get $q))
                (br $next)))
            (if (i32.ge_u (global.get $ptr) (local.get $htmlNoClose))
              (then
                (local.set $htmlEnd
                  (call $markdownHtmlEnd (global.get $ptr) (local.get $lineCache)))
                (if (i32.eqz (local.get $htmlEnd))
                  (then (local.set $htmlNoClose (local.get $lineCache))))
                (if (i32.gt_u (local.get $htmlEnd) (i32.add (global.get $ptr) (i32.const 1)))
                  (then
                    (call $markdownHtmlRange (global.get $ptr) (local.get $htmlEnd))
                    ;; the HTML lexer checkpoints an open script/style body at
                    ;; its range end; that is only the chunk end when the
                    ;; range reaches $eof, otherwise markdown continues here
                    (if
                      (i32.and
                        (global.get $streaming)
                        (i32.ne (local.get $htmlEnd) (global.get $eof)))
                      (then (call $markdownClearEmbeddedStream)))
                    (br $next)))))))

        ;; Inline code run. A missing closer consumes to the current line end.
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (global.set $ptr (call $markdownCodeSpanEnd (global.get $ptr) (local.get $lineCache)))
            (if (i32.eqz (global.get $ptr))
              (then (global.set $ptr (local.get $lineCache))))
            (call $emitTok (enum.get $Token.text.literal) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; `[label](uri)` links. A `[` whose `]` scan would start at or before
        ;; a memoised failure finds the same `]` again, or none: skip it.
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (if (i32.gt_u (i32.add (global.get $ptr) (i32.const 1)) (local.get $linkNoClose))
              (then
                (local.set $q (call $markdownImageLink (global.get $ptr) (local.get $lineCache)))
                (if (local.get $q)
                  (then
                    (global.set $ptr (local.get $q))
                    (br $next)))
                (local.set $p
                  (call $scanFindSpecial
                    (i32.add (global.get $ptr) (i32.const 1))
                    (local.get $lineCache)
                    (i32.const "]")
                    (i32.const 0)
                    (i32.const 0)))
                (if
                  (i32.and
                    (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $lineCache))
                    (i32.and
                      (i32.eq (i32.load8_u (local.get $p)) (i32.const "]"))
                      (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "("))))
                  (then
                    (local.set $q
                      (call $scanFindSpecial
                        (i32.add (local.get $p) (i32.const 2))
                        (local.get $lineCache)
                        (i32.const ")")
                        (i32.const 0)
                        (i32.const 0)))
                    (if (i32.lt_u (local.get $q) (local.get $lineCache))
                      (then
                        (call $markdownLink (global.get $ptr) (local.get $p) (local.get $q))
                        (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                        (br $next)))
                    ;; no `)` from here to the line end: every later `[` on
                    ;; the line needs one further right and fails too
                    (local.set $linkNoClose (local.get $lineCache)))
                  (else
                    ;; `]` missing, or not followed by `(`: later `[` up to
                    ;; that `]` would find the same one
                    (local.set $linkNoClose
                      (select
                        (local.get $lineCache)
                        (local.get $p)
                        (i32.ge_u (local.get $p) (local.get $lineCache))))))))))

        ;; Strong/emphasis spans. Delimiters share the style with their text;
        ;; this keeps the hot path compact and matches Zed's visual result.
        (if (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "_")))
          (then
            (local.set $count
              (select
                (i32.const 2)
                (i32.const 1)
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                  (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $c)))))
            (if (i32.ge_u (global.get $ptr) (local.get $lineCache))
              (then (local.set $lineCache (call $markdownLineEnd (global.get $ptr)))))
            (local.set $close
              (call $markdownEmphasisEnd
                (local.get $lhs)
                (local.get $c)
                (local.get $count)
                (local.get $lineCache)))
            (if (local.get $close)
              (then
                (global.set $ptr (local.get $close))
                (call $emitTok
                  (select
                    (enum.get $Token.emphasis.strong)
                    (enum.get $Token.emphasis)
                    (i32.eq (local.get $count) (i32.const 2)))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))
            ;; a `_` run that did not open emphasis is plain text as a whole:
            ;; its later bytes must not open emphasis from inside the run, or
            ;; `a__b__` would pair the second `_` with `_b_`
            (if (i32.eq (local.get $c) (i32.const "_"))
              (then
                (block $runDone
                  (loop $run
                    (br_if $runDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (br_if $runDone (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "_")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $run)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
                (br $next)))))

        ;; Backslash escape: only ASCII punctuation can be escaped. Any other
        ;; byte stays outside the token, so `\` before a line break is a hard
        ;; break and the next line keeps its line-start meaning.
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.lt_u (global.get $ptr) (global.get $end))
                (call $markdownIsPunct (i32.load8_u (global.get $ptr))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr)))
              (else (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; Batch ordinary text up to the next potentially meaningful byte.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (global.set $ptr (call $markdownPlainEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
