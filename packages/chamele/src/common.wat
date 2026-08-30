(module
  (import "./token.wat")
  (import "./scan.wat")
  (import "./emit.wat")

  ;; Shared ASCII predicates. Bytes >= 0x80 stay identifier bytes so a lexer
  ;; never puts a span boundary inside a UTF-8 code point.
  (func $lexIsSpace (param $c i32) (result i32)
    (i32.or
      (i32.eq (local.get $c) (i32.const 32))
      (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))

  (func $lexIsDigit (param $c i32) (result i32)
    (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))

  (func $lexIsHex (param $c i32) (result i32)
    (i32.or
      (call $lexIsDigit (local.get $c))
      (i32.le_u
        (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
        (i32.const 5))))

  (func $lexIsIdentStart (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25))
        (i32.or
          (i32.eq (local.get $c) (i32.const "_"))
          (i32.eq (local.get $c) (i32.const "$"))))))

  (func $lexIsIdentContinue (param $c i32) (result i32)
    (i32.or (call $lexIsIdentStart (local.get $c)) (call $lexIsDigit (local.get $c))))

  (func $lexScanWhitespace
    (call $scanWhitespace))

  (func $lexScanIdent
    (call $scanIdentRun (i32.const "$")))

  ;; A language-neutral numeric run. It keeps radix digits, separators,
  ;; exponents, and type suffixes together, but leaves `.` for member access
  ;; unless a digit follows it.
  (func $lexScanNumber
    (local $c i32)
    (local $next i32)
    (local $prev i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (call $lexIsIdentContinue (local.get $c))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (local.set $next (select
              (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (br_if $done (i32.eqz (call $lexIsDigit (local.get $next))))
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "+"))
                      (i32.eq (local.get $c) (i32.const "-")))
              (i32.or
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e"))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "p"))))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br $done))))

  ;; Scan a quoted literal body. $seg includes the opening quote for a new
  ;; token and starts at $ptr when resuming a stream chunk. Returns 1 after a
  ;; closing quote, 2 after an escaped newline at EOF, or 0 otherwise.
  (func $lexStringBody
    (param $quote i32) (param $multiline i32) (param $hl i32) (param $seg i32)
    (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (block $done
      (loop $l
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $quote) (i32.const 1)
          (i32.eqz (local.get $multiline))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        ;; a raw line break: unterminated, left unconsumed
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (call $utf8SpanEnd
          (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (if (i32.and
              (i32.eq (global.get $ptr) (global.get $end))
              (i32.and
                (i32.gt_u (global.get $ptr) (local.get $seg))
                (i32.or
                  (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
                  (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13)))))
          (then (local.set $status (i32.const 2))))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; Quoted literal beginning at $ptr. Escapes are emitted separately, and a
  ;; malformed escape cannot split a multibyte UTF-8 character.
  (func $lexString (param $quote i32) (param $multiline i32) (param $hl i32)
    (local $lhs i32)
    (local $status i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (local.set $status
      (call $lexStringBody
        (local.get $quote) (local.get $multiline) (local.get $hl) (local.get $lhs)))
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.and
              (i32.ne (local.get $status) (i32.const 1))
              (i32.or (local.get $multiline) (i32.eq (local.get $status) (i32.const 2))))))
      (then
        (global.set $streamMode (i32.const 2))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (local.get $multiline))
        (global.set $streamHl (local.get $hl)))))

  (func $lexRawStringBody
    (param $quote i32) (param $multiline i32) (param $hl i32) (param $lhs i32)
    (result i32)
    (global.set $ptr (call $scanFindSpecial
      (global.get $ptr) (global.get $end)
      (local.get $quote) (i32.const 0) (i32.eqz (local.get $multiline))))
    ;; the closing quote is consumed; a raw line break is left unconsumed
    (if (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (i32.eq (i32.load8_u (global.get $ptr)) (local.get $quote)))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (return (i32.const 1))))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (i32.const 0))

  (func $lexRawString (param $quote i32) (param $multiline i32) (param $hl i32)
    (local $lhs i32)
    (local $closed i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (local.set $closed
      (call $lexRawStringBody
        (local.get $quote) (local.get $multiline) (local.get $hl) (local.get $lhs)))
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (local.get $multiline)
            (i32.and
              (i32.eqz (local.get $closed))
              (i32.eq (global.get $ptr) (global.get $end)))))
      (then
        (global.set $streamMode (i32.const 3))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (local.get $multiline))
        (global.set $streamHl (local.get $hl)))))

  (func $lexLineComment (param $skip i32) (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (call $scanToLineEnd)
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))

  (func $lexBlockComment (param $skip i32) (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (call $scanBlockCommentEnd)
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.or
              (i32.lt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
              (i32.ne
                (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2)))
                (i32.const 0x2f2a)))))
      (then
        (global.set $streamMode (i32.const 1))
        (global.set $streamHl (local.get $hl)))))

  ;; Save an arbitrary delimiter (up to 32 bytes) for a multiline token whose
  ;; body has one highlight and no nesting.
  (func $streamSetFixed (param $delimiter i32) (param $len i32) (param $hl i32)
    (if (i32.and
          (global.get $streaming)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (memory.copy
          (i32.const $mem.streamDelimiter) (local.get $delimiter) (local.get $len))
        (global.set $streamMode (i32.const 20))
        (global.set $streamA (local.get $len))
        (global.set $streamHl (local.get $hl)))))

  (func $streamSetFixed32 (param $delimiter i32) (param $len i32) (param $hl i32)
    (i32.store (i32.const $mem.streamDelimiter) (local.get $delimiter))
    (call $streamSetFixed
      (i32.const $mem.streamDelimiter) (local.get $len) (local.get $hl)))

  ;; Save a two-byte nested delimiter pair. Packed constants use source byte
  ;; order, for example `/*` and `*/`.
  (func $streamSetNested
    (param $depth i32) (param $open i32) (param $close i32) (param $hl i32)
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (local.get $depth)
            (i32.eq (global.get $ptr) (global.get $end))))
      (then
        (global.set $streamMode (i32.const 21))
        (global.set $streamA (local.get $depth))
        (global.set $streamB (local.get $open))
        (global.set $streamC (local.get $close))
        (global.set $streamHl (local.get $hl)))))

  ;; Save a delimiter that must begin a line. $trim is zero, one for leading
  ;; tabs, or two for leading spaces/tabs. $boundary accepts a non-identifier
  ;; suffix instead of requiring the delimiter to occupy the whole line.
  (func $streamSetLine
    (param $delimiter i32) (param $len i32) (param $trim i32)
    (param $boundary i32) (param $hl i32)
    (if (i32.and
          (global.get $streaming)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (memory.copy
          (i32.const $mem.streamDelimiter) (local.get $delimiter) (local.get $len))
        (global.set $streamMode (i32.const 22))
        (global.set $streamA (local.get $len))
        (global.set $streamB (local.get $trim))
        (global.set $streamC (local.get $boundary))
        (global.set $streamHl (local.get $hl)))))

  ;; Mark an embedded region whose body continues in another chunk: one is a
  ;; script tag, two a style tag, three TSX front matter, four YAML front matter,
  ;; five an MDX JSX tag, and six through eight framework expressions.
  (func $streamSetRegion (param $kind i32)
    (if (i32.and
          (global.get $streaming)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (global.set $streamRegionKind (local.get $kind))
        (global.set $streamRegionStarted (i32.const 0)))))

  (func $streamResumeFixed (result i32)
    (local $i i32)
    (local $lhs i32)
    (local $matched i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $notFound
      (loop $search
        (br_if $notFound
          (i32.gt_u
            (i32.add (local.get $p) (global.get $streamA))
            (global.get $end)))
        (local.set $i (i32.const 0))
        (local.set $matched (i32.const 1))
        (block $compareDone
          (loop $compare
            (br_if $compareDone (i32.ge_u (local.get $i) (global.get $streamA)))
            (if (i32.ne
                  (i32.load8_u (i32.add (local.get $p) (local.get $i)))
                  (i32.load8_u
                    (i32.add (i32.const $mem.streamDelimiter) (local.get $i))))
              (then
                (local.set $matched (i32.const 0))
                (br $compareDone)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $compare)))
        (if (local.get $matched)
          (then
            (global.set $ptr (i32.add (local.get $p) (global.get $streamA)))
            (call $emitTok
              (global.get $streamHl) (local.get $lhs) (global.get $ptr))
            (global.set $streamMode (i32.const 0))
            (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $search)))
    (global.set $ptr (global.get $end))
    (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  (func $streamResumeNested (result i32)
    (local $lhs i32)
    (local $pair i32)
    (local.set $lhs (global.get $ptr))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.lt_u
              (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (then
            (local.set $pair (i32.load16_u (global.get $ptr)))
            (if (i32.eq (local.get $pair) (global.get $streamB))
              (then
                (global.set $streamA (i32.add (global.get $streamA) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br $scan)))
            (if (i32.eq (local.get $pair) (global.get $streamC))
              (then
                (global.set $streamA (i32.sub (global.get $streamA) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br_if $done (i32.eqz (global.get $streamA)))
                (br $scan)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
    (if (i32.eqz (global.get $streamA))
      (then
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (i32.const 1))

  (func $streamResumeLine (result i32)
    (local $c i32)
    (local $candidate i32)
    (local $i i32)
    (local $lhs i32)
    (local $matched i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $notFound
      (loop $lines
        (br_if $notFound (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $candidate (local.get $p))
        (if (global.get $streamB)
          (then
            (block $trimDone
              (loop $trim
                (br_if $trimDone
                  (i32.ge_u (local.get $candidate) (global.get $end)))
                (local.set $c (i32.load8_u (local.get $candidate)))
                (br_if $trimDone
                  (i32.and
                    (i32.ne (local.get $c) (i32.const 9))
                    (i32.or
                      (i32.eq (global.get $streamB) (i32.const 1))
                      (i32.ne (local.get $c) (i32.const 32)))))
                (local.set $candidate
                  (i32.add (local.get $candidate) (i32.const 1)))
                (br $trim)))))
        (local.set $matched
          (i32.le_u
            (i32.add (local.get $candidate) (global.get $streamA))
            (global.get $end)))
        (local.set $i (i32.const 0))
        (block $compareDone
          (loop $compare
            (br_if $compareDone (i32.eqz (local.get $matched)))
            (br_if $compareDone (i32.ge_u (local.get $i) (global.get $streamA)))
            (if (i32.ne
                  (i32.load8_u (i32.add (local.get $candidate) (local.get $i)))
                  (i32.load8_u
                    (i32.add (i32.const $mem.streamDelimiter) (local.get $i))))
              (then
                (local.set $matched (i32.const 0))
                (br $compareDone)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $compare)))
        (if (local.get $matched)
          (then
            (global.set $ptr
              (i32.add (local.get $candidate) (global.get $streamA)))
            (if (global.get $streamC)
              (then
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (call $lexIsIdentContinue (i32.load8_u (global.get $ptr))))
                  (then (local.set $matched (i32.const 0)))))
              (else
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.and
                        (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 10))
                        (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 13))))
                  (then (local.set $matched (i32.const 0))))))
            (if (local.get $matched)
              (then
                (if (i32.eqz (global.get $streamC))
                  (then
                    (if (i32.lt_u (global.get $ptr) (global.get $end))
                      (then
                        (local.set $c (i32.load8_u (global.get $ptr)))
                        (global.set $ptr
                          (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.and
                              (i32.eq (local.get $c) (i32.const 13))
                              (i32.and
                                (i32.lt_u (global.get $ptr) (global.get $end))
                                (i32.eq
                                  (i32.load8_u (global.get $ptr))
                                  (i32.const 10))))
                          (then (global.set $ptr
                            (i32.add (global.get $ptr) (i32.const 1)))))))))
                (call $emitTok
                  (global.get $streamHl) (local.get $lhs) (global.get $ptr))
                (global.set $streamMode (i32.const 0))
                (return (i32.const 0))))))
        (block $lineDone
          (loop $line
            (br_if $lineDone (i32.ge_u (local.get $p) (global.get $end)))
            (local.set $c (i32.load8_u (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $lineDone (i32.eq (local.get $c) (i32.const 10)))
            (br $line)))
        (br $lines)))
    (global.set $ptr (global.get $end))
    (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  ;; Resume a shared comment/string mode. Returns 1 when the mode consumes the
  ;; whole chunk and the language driver should not run yet.
  (func $streamResumeCommon (result i32)
    (local $lhs i32)
    (local $status i32)
    (local.set $lhs (global.get $ptr))
    (if (i32.eq (global.get $streamMode) (i32.const 1))
      (then
        (call $scanBlockCommentEnd)
        (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
        (if (i32.or
              (i32.lt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
              (i32.ne
                (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2)))
                (i32.const 0x2f2a)))
          (then (return (i32.const 1))))
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.eq (global.get $streamMode) (i32.const 2))
      (then
        (local.set $status
          (call $lexStringBody
            (global.get $streamA) (global.get $streamB)
            (global.get $streamHl) (local.get $lhs)))
        (if (i32.and
              (i32.eq (global.get $ptr) (global.get $end))
              (i32.ne (local.get $status) (i32.const 1)))
          (then (return (i32.const 1))))
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.eq (global.get $streamMode) (i32.const 3))
      (then
        (local.set $status
          (call $lexRawStringBody
            (global.get $streamA) (global.get $streamB)
            (global.get $streamHl) (local.get $lhs)))
        (if (i32.eqz (local.get $status))
          (then (return (i32.const 1))))
        (global.set $streamMode (i32.const 0))))
    (if (i32.eq (global.get $streamMode) (i32.const 20))
      (then (return (call $streamResumeFixed))))
    (if (i32.eq (global.get $streamMode) (i32.const 21))
      (then (return (call $streamResumeNested))))
    (if (i32.eq (global.get $streamMode) (i32.const 22))
      (then (return (call $streamResumeLine))))
    (i32.const 0))

  (func $lexSkipSpaceAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Split a C-family `#include` directive already bounded by [lhs,rhs).
  ;; Return one after emitting a quoted or angle-bracket header, zero when the
  ;; directive uses a macro or has another name.
  (func $lexEmitIncludeDirective (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $word i32)
    (local $header i32)
    (local $close i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $name
      (loop $space
        (br_if $name (i32.ge_u (local.get $p) (local.get $rhs)))
        (br_if $name (i32.and
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (local.set $word (local.get $p))
    (if (i32.gt_u (i32.add (local.get $word) (i32.const 7)) (local.get $rhs))
      (then (return (i32.const 0))))
    (if (i64.ne
          (i64.and (i64.load (local.get $word)) (i64.const 0x00ffffffffffffff))
          (i64.const "include"))
      (then (return (i32.const 0))))
    (local.set $p (i32.add (local.get $word) (i32.const 7)))
    (if (i32.and (i32.lt_u (local.get $p) (local.get $rhs))
          (call $lexIsIdentContinue (i32.load8_u (local.get $p))))
      (then (return (i32.const 0))))
    (block $headerStart
      (loop $space
        (br_if $headerStart (i32.ge_u (local.get $p) (local.get $rhs)))
        (br_if $headerStart (i32.and
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.ne (i32.load8_u (local.get $p)) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (if (i32.ge_u (local.get $p) (local.get $rhs)) (then (return (i32.const 0))))
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "<"))
      (then (local.set $close (i32.const ">")))
      (else
        (if (i32.ne (i32.load8_u (local.get $p)) (i32.const 34))
          (then (return (i32.const 0))))
        (local.set $close (i32.const 34))))
    (local.set $header (local.get $p))
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $headerDone
      (loop $headerByte
        (br_if $headerDone (i32.ge_u (local.get $p) (local.get $rhs)))
        (if (i32.eq (i32.load8_u (local.get $p)) (local.get $close))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $headerDone)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $headerByte)))
    (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (local.get $header))
    (call $emitTok (enum.get $Token.string) (local.get $header) (local.get $p))
    (call $emitTok (enum.get $Token.preproc) (local.get $p) (local.get $rhs))
    (i32.const 1))

  ;; Return the next occurrence of either byte, or $end. Long clean runs use
  ;; one SIMD comparison pair per 16 bytes; the tail never reads past $end.
  (func $lexFindEither (param $p i32) (param $a i32) (param $b i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (block $scalar
      (loop $simd
        (br_if $scalar
          (i32.lt_u (i32.sub (global.get $end) (local.get $p)) (i32.const 16)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i8x16.bitmask (v128.or
          (i8x16.eq (local.get $w) (i8x16.splat (local.get $a)))
          (i8x16.eq (local.get $w) (i8x16.splat (local.get $b))))))
        (if (local.get $mask)
          (then (return (i32.add (local.get $p) (i32.ctz (local.get $mask))))))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $simd)))
    (block $done
      (loop $tail
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.or
              (i32.eq (i32.load8_u (local.get $p)) (local.get $a))
              (i32.eq (i32.load8_u (local.get $p)) (local.get $b)))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $tail)))
    (global.get $end))

  (func $lexIsConstCase (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $upper i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
          (then (local.set $upper (i32.const 1)))
          (else
            (if (i32.eqz (i32.or
                  (call $lexIsDigit (local.get $c))
                  (i32.eq (local.get $c) (i32.const "_"))))
              (then (return (i32.const 0))))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (local.get $upper))
)
