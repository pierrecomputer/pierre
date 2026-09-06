(module
  (import "../common.wat")

  (func $xmlNameChar (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.ge_u (local.get $c) (i32.const 0x80))
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25)))
      (i32.or
        (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "_"))
                  (i32.eq (local.get $c) (i32.const "-")))
          (i32.or (i32.eq (local.get $c) (i32.const "."))
                  (i32.eq (local.get $c) (i32.const ":")))))))

  (func $xmlNameStart (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25))
        (i32.or (i32.eq (local.get $c) (i32.const "_"))
                (i32.eq (local.get $c) (i32.const ":"))))))

  ;; advance $ptr over an XML name: the shared 16-byte identifier scan takes
  ;; letters, digits, `_`, non-ASCII, and `-`; the rarer `.` and `:` restart
  ;; it
  (func $xmlScanName
    (local $c i32)
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "-"))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (i32.and
          (i32.ne (local.get $c) (i32.const "."))
          (i32.ne (local.get $c) (i32.const ":"))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; the rest of a quoted attribute value: scan from $ptr to the closing
  ;; $quote and emit [$lhs, after the quote) as one string. Returns $quote
  ;; when the value is still open at $end, 0 once it closed.
  (func $xmlQuotedBody (param $quote i32) (param $lhs i32) (result i32)
    (local $p i32)
    (local.set $p (call $lexFindByte (global.get $ptr) (local.get $quote)))
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (local.set $quote (i32.const 0)))
      (else (global.set $ptr (global.get $end))))
    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
    (local.get $quote))

  ;; Scan a comment, CDATA section, or processing instruction. $kind is
  ;; 1=`-->`, 2=`]]>`, 3=`?>`; the opener has already been recognized.
  (func $xmlSection (param $lhs i32) (param $skip i32) (param $kind i32) (param $hl i32)
    (local $closed i32)
    (local $closeMask i32)
    (local $closeOff i32)
    (local $closeWord i32)
    (local $hit i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    ;; hoist the packed close delimiter: each `>` candidate then costs one
    ;; masked load and compare, whatever the kind
    (if (i32.eq (local.get $kind) (i32.const 3))
      (then
        (local.set $closeWord (i32.const "?>"))
        (local.set $closeMask (i32.const 0xffff))
        (local.set $closeOff (i32.const 1)))
      (else
        (local.set $closeWord (select (i32.const "-->") (i32.const "]]>")
          (i32.eq (local.get $kind) (i32.const 1))))
        (local.set $closeMask (i32.const 0xffffff))
        (local.set $closeOff (i32.const 2))))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (block $done
      (loop $wide
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i8x16.bitmask
          (i8x16.eq (local.get $w) (i8x16.splat (i32.const ">")))))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then
            (local.set $mask (i32.and (local.get $mask)
              (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (block $chunkDone
          (loop $hits
            (br_if $chunkDone (i32.eqz (local.get $mask)))
            (local.set $hit (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
            (if (i32.eq
                  (i32.and
                    (i32.load (i32.sub (local.get $hit) (local.get $closeOff)))
                    (local.get $closeMask))
                  (local.get $closeWord))
              (then
                (global.set $ptr (i32.add (local.get $hit) (i32.const 1)))
                (local.set $closed (i32.const 1))
                (br $done)))
            (local.set $mask (i32.and (local.get $mask)
              (i32.sub (local.get $mask) (i32.const 1))))
            (br $hits)))
        (if (i32.le_u (local.get $rem) (i32.const 16))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (if (i32.eqz (local.get $closed))
      (then
        (call $streamSetFixed32
          (local.get $closeWord)
          (i32.add (local.get $closeOff) (i32.const 1))
          (local.get $hl)))))

  ;; XML declarations may contain an internal subset. Only a `>` outside
  ;; quotes and square brackets ends the declaration. Scans from $ptr with
  ;; the bracket $depth and open $quote of a declaration cut by a chunk end
  ;; (both 0 for a fresh one), emitting [$lhs, cursor) as one doctype token,
  ;; and returns 1 once the declaration closed. At a real chunk end an open
  ;; declaration is checkpointed as stream region 10 with $streamC = 1,
  ;; $streamA = depth, $streamB = quote; $xmlStreamResumeTag continues it.
  ;; Hops between the bytes that matter with the 16-byte finders.
  (func $xmlDoctypeBody (param $lhs i32) (param $depth i32) (param $quote i32) (result i32)
    (local $c i32)
    (local $closed i32)
    (local $p i32)
    (local $q i32)
    (local.set $p (global.get $ptr))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (local.get $quote)
          (then
            (local.set $p (call $lexFindByte (local.get $p) (local.get $quote)))
            (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
            (local.set $quote (i32.const 0))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (local.set $q (call $scanFind3
          (local.get $p) (i32.const "[") (i32.const "]") (i32.const ">")))
        (local.set $p (call $lexFindEither (local.get $p) (i32.const 34) (i32.const 39)))
        (if (i32.lt_u (local.get $q) (local.get $p))
          (then (local.set $p (local.get $q))))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $quote (local.get $c))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "]"))
          (then
            (if (i32.gt_u (local.get $depth) (i32.const 0))
              (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (br $l)))
        ;; `>` closes only outside the internal subset
        (if (i32.eqz (local.get $depth))
          (then
            (local.set $closed (i32.const 1))
            (br $done)))
        (br $l)))
    (global.set $ptr (select (local.get $p) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end))))
    (call $emitTok (enum.get $Token.tag.doctype) (local.get $lhs) (global.get $ptr))
    (if (i32.and
          (i32.eqz (local.get $closed))
          (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof))))
      (then
        (call $streamSetRegion (i32.const 10))
        (global.set $streamA (local.get $depth))
        (global.set $streamB (local.get $quote))
        (global.set $streamC (i32.const 1))))
    (local.get $closed))

  (func $xmlDoctype (param $lhs i32)
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (drop (call $xmlDoctypeBody (local.get $lhs) (i32.const 0) (i32.const 0))))

  (func $xmlEntity (result i32)
    (local $lhs i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $bad
      (loop $l
        (br_if $bad (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $bad (i32.gt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 32)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (if (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
              (then (br $bad)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (return (i32.const 1))))
        (br_if $bad (i32.eqz (i32.or
          (call $lexIsIdentContinue (local.get $c))
          (i32.eq (local.get $c) (i32.const "#")))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (global.set $ptr (local.get $lhs))
    (i32.const 0))

  ;; Attributes after a tag name until `>` / `/>`. Returns 1 when the tag was
  ;; closed by a plain `>`, 2 for `/>`, 0 for a stray `<` (the caller
  ;; reparses it as markup) or input end. $quote is the open quote of a
  ;; value left unterminated by the previous chunk, so the loop resumes
  ;; inside it. At a real chunk end the open tag is checkpointed as stream
  ;; region 10 with $streamB = open quote and $streamC = 0 (a tag, not a
  ;; doctype); $xmlStreamResumeTag calls back in with them.
  (func $xmlAttrs (param $quote i32) (result i32)
    (local $c i32)
    (local $lhs i32)
    (if (local.get $quote)
      (then (local.set $quote (call $xmlQuotedBody (local.get $quote) (global.get $ptr)))))
    (block $done (result i32)
      (loop $next
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then
            (if (i32.and
                  (global.get $streaming)
                  (i32.eq (global.get $ptr) (global.get $eof)))
              (then
                (call $streamSetRegion (i32.const 10))
                (global.set $streamA (i32.const 0))
                (global.set $streamB (local.get $quote))
                (global.set $streamC (i32.const 0))))
            (br $done (i32.const 0))))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (call $lexIsSpace (local.get $c))
          (then
            (call $scanWhitespace)
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done (i32.const 1))))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (br $done (i32.const 2))))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter.html) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $quote (call $xmlQuotedBody (local.get $c) (local.get $lhs)))
            (br $next)))
        (if (call $xmlNameStart (local.get $c))
          (then
            (call $xmlScanName)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; a stray `<` starts the next tag: a tag that never closed ends here
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then (br $done (i32.const 0))))
        ;; Malformed unquoted attribute value or stray punctuation.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $valueDone
          (loop $value
            (br_if $valueDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $valueDone (call $lexIsSpace (local.get $c)))
            (br_if $valueDone (i32.or (i32.eq (local.get $c) (i32.const ">"))
                                      (i32.eq (local.get $c) (i32.const "<"))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $value)))
        (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
        (br $next))
      (unreachable)))

  (func $hlXml
    (local $c i32)
    (local $lhs i32)
    (local $name i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexFindEither
          (global.get $ptr) (i32.const "<") (i32.const "&")))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (if (i32.eqz (call $xmlEntity))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; Exact, case-sensitive XML openers.
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 4)) (global.get $end))
              (i32.eq (i32.load (global.get $ptr)) (i32.const "<!--")))
          (then
            (call $xmlSection (local.get $lhs) (i32.const 4) (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 9)) (global.get $end))
              (i32.and
                (i64.eq (i64.load (global.get $ptr)) (i64.const "<![CDATA"))
                (i32.eq (i32.load8_u offset=8 (global.get $ptr)) (i32.const "["))))
          (then
            (call $xmlSection (local.get $lhs) (i32.const 9) (i32.const 2) (enum.get $Token.text.literal))
            (br $next)))
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
              (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffff)) (i32.const "<?")))
          (then
            (call $xmlSection (local.get $lhs) (i32.const 2) (i32.const 3) (enum.get $Token.preproc))
            (br $next)))
        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 9)) (global.get $end))
              (i32.and
                (i64.eq (i64.load (global.get $ptr)) (i64.const "<!DOCTYP"))
                (i32.eq (i32.load8_u offset=8 (global.get $ptr)) (i32.const "E"))))
          (then (call $xmlDoctype (local.get $lhs)) (br $next)))

        ;; Ordinary tags. XML names are emitted verbatim and compared nowhere,
        ;; so `<Foo>` and `<foo>` remain distinct and raw-text HTML rules never apply.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.and
              (i32.lt_u (global.get $ptr) (global.get $end))
              (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/")))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $name (global.get $ptr))
        (if (i32.and
              (i32.lt_u (global.get $ptr) (global.get $end))
              (call $xmlNameStart (i32.load8_u (global.get $ptr))))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (local.get $name))
            (call $xmlScanName)
            (call $emitTok (enum.get $Token.tag) (local.get $name) (global.get $ptr))
            (drop (call $xmlAttrs (i32.const 0)))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))

  ;; Resume stream region 10: a start tag whose attributes continue past
  ;; the previous chunk end, or ($streamC = 1) a doctype whose internal
  ;; subset does. Returns 1 when the region consumed the whole chunk, 0 when
  ;; the language lexer should continue from $ptr. A tag ending at the chunk
  ;; end checkpoints itself again; one abandoned at a stray `<` hands the
  ;; `<` back to the lexer.
  (func $xmlStreamResumeTag (result i32)
    (local $status i32)
    (if (global.get $streamC)
      (then
        (local.set $status
          (call $xmlDoctypeBody (global.get $ptr) (global.get $streamA) (global.get $streamB))))
      (else
        (local.set $status (call $xmlAttrs (global.get $streamB)))))
    (if (i32.and
          (i32.eqz (local.get $status))
          (i32.eq (global.get $ptr) (global.get $eof)))
      (then (return (i32.const 1))))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))
)
