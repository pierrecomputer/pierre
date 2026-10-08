(module
  (import "./token.wat")
  (import "./scan.wat")
  (import "./emit.wat")
  (import "./sig.wat")

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
      (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 5))))

  (func $lexIsIdentStart (param $c i32) (result i32)
    (i32.or
      (i32.ge_u (local.get $c) (i32.const 0x80))
      (i32.or
        (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
        (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "$"))))))

  (func $lexIsIdentContinue (param $c i32) (result i32)
    (i32.or (call $lexIsIdentStart (local.get $c)) (call $lexIsDigit (local.get $c))))

  ;; the default identifier run: `$` is an identifier byte in every language
  ;; that uses it
  (func $lexScanIdent
    (call $scanIdentRun (i32.const "$")))

  ;; Scan a number with radix digits, separators, exponents, and type suffixes.
  ;; Include `.` only when a digit follows it. Start after any sign, at the
  ;; first digit or dot, so hex `e` digits cannot consume a following sign.
  (func $lexScanNumber
    (call $lexScanNumberBody
      (i32.and
        (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
        (i32.eq (i32.or (i32.load16_u (global.get $ptr)) (i32.const 0x2000)) (i32.const "0x")))))

  ;; Keep the radix when resuming after the dot of a hexadecimal fraction.
  (func $lexScanNumberBody (param $hex i32)
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
            (local.set $next
              (select
                (i32.load8_u offset=1 (global.get $ptr))
                (i32.const 0)
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (br_if $done (i32.eqz (call $lexIsDigit (local.get $next))))
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
            (i32.or
              (i32.and
                (i32.eqz (local.get $hex))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e")))
              (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "p"))))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br $done))))

  ;; Extend the shared numeric run for hexadecimal floats, whose fractional
  ;; part may begin with an a-f digit (`0x1.fp+3`) or be empty (`0x1.p2`).
  ;; Requiring an exponent preserves members such as Swift's `0xff.distance`.
  (func $lexScanHexNumber (param $requireExponent i32)
    (local $lhs i32)
    (local $next i32)
    (local $p i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (call $lexScanNumber)
    (if
      (i32.and
        (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end))
        (i32.and
          (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "0"))
          (i32.eq (i32.or (i32.load8_u offset=1 (local.get $lhs)) (i32.const 32)) (i32.const "x"))))
      (then
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (local.set $next
              (select
                (i32.load8_u offset=1 (global.get $ptr))
                (i32.const 0)
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (if
              (i32.and
                (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "."))
                (i32.or
                  (call $lexIsHex (local.get $next))
                  (i32.eq (i32.or (local.get $next) (i32.const 32)) (i32.const "p"))))
              (then
                (if
                  (i32.or
                    (local.get $requireExponent)
                    (i32.eq (i32.or (local.get $next) (i32.const 32)) (i32.const "p")))
                  (then
                    (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
                    (block $fractionDone
                      (loop $fraction
                        (br_if $fractionDone (i32.ge_u (local.get $p) (global.get $end)))
                        (local.set $c (i32.load8_u (local.get $p)))
                        (br_if $fractionDone
                          (i32.eqz
                            (i32.or
                              (call $lexIsHex (local.get $c))
                              (i32.eq (local.get $c) (i32.const "_")))))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (br $fraction)))
                    (if
                      (i32.or
                        (i32.ge_u (local.get $p) (global.get $end))
                        (i32.ne
                          (i32.or (i32.load8_u (local.get $p)) (i32.const 32))
                          (i32.const "p")))
                      (then (return)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (if (i32.lt_u (local.get $p) (global.get $end))
                      (then
                        (local.set $c (i32.load8_u (local.get $p)))
                        (if
                          (i32.or
                            (i32.eq (local.get $c) (i32.const "+"))
                            (i32.eq (local.get $c) (i32.const "-")))
                          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
                    (if
                      (i32.or
                        (i32.ge_u (local.get $p) (global.get $end))
                        (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                      (then (return)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanNumberBody (i32.const 1)))))))))

  ;; Find the end of the escape at backslash $p, bounded by $end.
  ;; Keep an escaped UTF-8 character whole. Include LF after an escaped CR
  ;; so a backslash before CRLF continues the line.
  (func $lexEscapeEnd (param $p i32) (result i32)
    (local $e i32)
    (local.set $e (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 2)) (global.get $end)))
    (if
      (i32.and
        (i32.eq (local.get $e) (i32.add (local.get $p) (i32.const 2)))
        (i32.and
          (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 13))
          (i32.and
            (i32.lt_u (local.get $e) (global.get $end))
            (i32.eq (i32.load8_u (local.get $e)) (i32.const 10)))))
      (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))
    (local.get $e))

  ;; Scan a quoted literal body. $seg includes the opening quote for a new
  ;; token and starts at $ptr when resuming a stream chunk. Returns 1 after a
  ;; closing quote, 2 after an escaped newline at EOF, or 0 otherwise.
  (func $lexStringBody
    (param $quote i32)
    (param $multiline i32)
    (param $hl i32)
    (param $seg i32)
    (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (block $done
      (loop $l
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $quote)
            (i32.const 1)
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
        (local.set $e (call $lexEscapeEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (if
          (i32.and
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

  ;; Scan the quoted literal at $ptr and emit escapes separately.
  ;; Keep UTF-8 characters whole, including malformed escapes.
  ;; Checkpoint only at $eof. An embedded region's earlier $end must not
  ;; continue into the next chunk.
  (func $lexString (param $quote i32) (param $multiline i32) (param $hl i32)
    (local $lhs i32)
    (local $status i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (local.set $status
      (call $lexStringBody
        (local.get $quote)
        (local.get $multiline)
        (local.get $hl)
        (local.get $lhs)))
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (i32.eq (global.get $ptr) (global.get $eof))
          (i32.and
            (i32.ne (local.get $status) (i32.const 1))
            (i32.or (local.get $multiline) (i32.eq (local.get $status) (i32.const 2))))))
      (then
        (global.set $streamMode (i32.const 2))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (local.get $multiline))
        (global.set $streamHl (local.get $hl)))))

  (func $lexRawStringBody
    (param $quote i32)
    (param $multiline i32)
    (param $hl i32)
    (param $lhs i32)
    (result i32)
    (global.set $ptr
      (call $scanFindSpecial
        (global.get $ptr)
        (global.get $end)
        (local.get $quote)
        (i32.const 0)
        (i32.eqz (local.get $multiline))))
    ;; the closing quote is consumed; a raw line break is left unconsumed
    (if
      (i32.and
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
        (local.get $quote)
        (local.get $multiline)
        (local.get $hl)
        (local.get $lhs)))
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (local.get $multiline)
          (i32.and (i32.eqz (local.get $closed)) (i32.eq (global.get $ptr) (global.get $eof)))))
      (then
        (global.set $streamMode (i32.const 3))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (local.get $multiline))
        (global.set $streamHl (local.get $hl)))))

  ;; Find the end of the C escape at backslash $p, bounded by $end.
  ;; Accept `\uXXXX`, `\UXXXXXXXX`, `\x` with at most 64 hex digits,
  ;; up to three octal digits, or `\N{...}`. Stop a named escape at `}`,
  ;; a quote, backslash, or line break. Otherwise use $lexEscapeEnd for
  ;; one escaped character or line continuation. Keep UTF-8 characters whole.
  (func $lexCEscapeEnd (param $p i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local.set $c
      (select
        (i32.load8_u offset=1 (local.get $p))
        (i32.const 0)
        (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))))
    (local.set $e (i32.add (local.get $p) (i32.const 2)))
    (block $done
      (if (i32.eq (local.get $c) (i32.const "u"))
        (then
          (local.set $e (call $scanHexRun (local.get $e) (i32.const 4)))
          (br $done)))
      (if (i32.eq (local.get $c) (i32.const "U"))
        (then
          (local.set $e (call $scanHexRun (local.get $e) (i32.const 8)))
          (br $done)))
      (if (i32.eq (local.get $c) (i32.const "x"))
        (then
          (local.set $e (call $scanHexRun (local.get $e) (i32.const 64)))
          (br $done)))
      (if
        (i32.and
          (i32.eq (local.get $c) (i32.const "N"))
          (i32.and
            (i32.lt_u (local.get $e) (global.get $end))
            (i32.eq (i32.load8_u (local.get $e)) (i32.const "{"))))
        (then
          (local.set $e (i32.add (local.get $e) (i32.const 1)))
          (loop $named
            (br_if $done (i32.ge_u (local.get $e) (global.get $end)))
            (local.set $c (i32.load8_u (local.get $e)))
            (br_if $done
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
                (i32.or
                  (i32.eq (local.get $c) (i32.const 34))
                  (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const 92))))))
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (br_if $done (i32.eq (local.get $c) (i32.const "}")))
            (br $named))))
      (if (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 7))
        (then
          ;; the first digit is already in; take up to two more
          (loop $oct
            (br_if $done
              (i32.or
                (i32.ge_u (local.get $e) (global.get $end))
                (i32.ge_u (i32.sub (local.get $e) (local.get $p)) (i32.const 4))))
            (br_if $done
              (i32.gt_u (i32.sub (i32.load8_u (local.get $e)) (i32.const "0")) (i32.const 7)))
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (br $oct))))
      (local.set $e (call $lexEscapeEnd (local.get $p))))
    (call $utf8SpanEnd (local.get $e) (global.get $end)))

  ;; Scan a C-family literal body from $ptr. Bytes from $seg are not yet
  ;; emitted. Emit the body as $hl and C escapes as string.escape.
  ;; A backslash before a line break continues the literal.
  ;; If $suffix is set, include a C++ identifier suffix after the quote.
  ;;
  ;; Return 1 after the closing quote, or 0 at a raw line break or $end.
  ;; Return 2 if $end follows an escaped line break. The caller must save
  ;; this state and resume with $lexCStringBody to preserve C escape rules.
  (func $lexCStringBody (param $q i32) (param $hl i32) (param $seg i32) (param $suffix i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (block $done
      (loop $scan
        ;; hop to the next quote, backslash, or line break, 16 bytes per step
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $q)
            (i32.const 1)
            (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $suffix)
              (then
                (if
                  (i32.and
                    (i32.lt_u (global.get $ptr) (global.get $end))
                    (call $lexIsIdentStart (i32.load8_u (global.get $ptr))))
                  (then (call $lexScanIdent)))))
            (local.set $status (i32.const 1))
            (br $done)))
        ;; a raw line break: unterminated, left unconsumed
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (call $lexCEscapeEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        ;; an escaped line break that ends the chunk leaves the literal open
        (if
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.or
              (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
              (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13))))
          (then
            (local.set $status (i32.const 2))
            (br $done)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; Scan a C-family literal from the opening quote at $ptr, without a suffix.
  ;; Any prefix is already emitted. Return the quote byte if the chunk ends
  ;; after an escaped line break, or 0 otherwise. The caller saves the quote
  ;; in a checkpointed local and resumes with $lexCStringBody.
  (func $lexCString (param $hl i32) (result i32)
    (local $lhs i32)
    (local $q i32)
    (local.set $lhs (global.get $ptr))
    (local.set $q (i32.load8_u (local.get $lhs)))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
    (select
      (local.get $q)
      (i32.const 0)
      (i32.eq
        (call $lexCStringBody (local.get $q) (local.get $hl) (local.get $lhs) (i32.const 0))
        (i32.const 2))))

  ;; Find the nearest byte before $p that is not a space or tab.
  ;; Stop at a line break or $srcBase. Return 0 if none is found.
  ;; This keeps lookbehind consistent between whole-buffer and line chunks.
  (func $lexLineByteBefore (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $back
        (br_if $done (i32.le_u (local.get $p) (global.get $srcBase)))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (br_if $back (i32.or (i32.eq (local.get $c) (i32.const 32)) (i32.eq (local.get $c) (i32.const 9))))
        (return (local.get $c))))
    (i32.const 0))

  ;; Resume at $ptr the string literal $lexCString left open with quote $q
  ;; (0: nothing open). Returns the quote again when this chunk also ends
  ;; right after an escaped line break inside it, and 0 otherwise.
  (func $lexCStringResume (param $q i32) (result i32)
    (if (result i32) (local.get $q)
      (then
        (select
          (local.get $q)
          (i32.const 0)
          (i32.eq
            (call $lexCStringBody
              (local.get $q)
              (enum.get $Token.string)
              (global.get $ptr)
              (i32.const 0))
            (i32.const 2))))
      (else (i32.const 0))))

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
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (i32.eq (global.get $ptr) (global.get $eof))
          (i32.or
            (i32.lt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
            (i32.ne (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2))) (i32.const 0x2f2a)))))
      (then
        (global.set $streamMode (i32.const 1))
        (global.set $streamHl (local.get $hl)))))

  ;; Save a delimiter for a multiline token with one highlight and no nesting.
  ;; The delimiter region holds 32 bytes. Longer delimiters would overwrite
  ;; lexer checkpoints, so those tokens end at the chunk boundary.
  (func $streamSetFixed (param $delimiter i32) (param $len i32) (param $hl i32)
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (i32.le_u (local.get $len) (i32.const 32))
          (i32.eq (global.get $ptr) (global.get $eof))))
      (then
        (memory.copy (i32.const $mem.streamDelimiter) (local.get $delimiter) (local.get $len))
        (global.set $streamMode (i32.const 20))
        (global.set $streamA (local.get $len))
        (global.set $streamHl (local.get $hl)))))

  (func $streamSetFixed32 (param $delimiter i32) (param $len i32) (param $hl i32)
    (i32.store (i32.const $mem.streamDelimiter) (local.get $delimiter))
    (call $streamSetFixed (i32.const $mem.streamDelimiter) (local.get $len) (local.get $hl)))

  ;; Save a two-byte nested delimiter pair. Packed constants use source byte
  ;; order, for example `/*` and `*/`.
  (func $streamSetNested (param $depth i32) (param $open i32) (param $close i32) (param $hl i32)
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (i32.ne (local.get $depth) (i32.const 0))
          (i32.eq (global.get $ptr) (global.get $eof))))
      (then
        (global.set $streamMode (i32.const 21))
        (global.set $streamA (local.get $depth))
        (global.set $streamB (local.get $open))
        (global.set $streamC (local.get $close))
        (global.set $streamHl (local.get $hl)))))

  ;; Perl and Ruby accept a bare heredoc argument after a filehandle or
  ;; method. An operator following its name instead makes `<<BITS | 1` a shift.
  (func $lexHeredocArgument (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
      (then (return (i32.const 1))))
    (block $nameDone
      (loop $name
        (br_if $nameDone (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $nameDone (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $name)))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.const 1))))
    (local.set $c (i32.load8_u (local.get $p)))
    (i32.or
      (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c) (i32.const ",")))
        (i32.or
          (i32.eq (local.get $c) (i32.const ")"))
          (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "#")))))))

  ;; Check whether the delimiter ending at $p closes the body.
  ;; Heredoc terminators require LF, CR, or $end after them.
  ;; For word closers, $trim bit 4 accepts a following blank (`=end # done`)
  ;; and bit 8 accepts any non-letter (`=cut`).
  (func $lineDelimiterEnds (param $p i32) (param $trim i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.const 1))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
      (then (return (i32.const 1))))
    (if (i32.and (local.get $trim) (i32.const 4))
      (then
        ;; space, or \t \n \v \f \r
        (return
          (i32.or
            (i32.eq (local.get $c) (i32.const 32))
            (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4))))))
    (if (i32.and (local.get $trim) (i32.const 8))
      (then
        (return
          (i32.gt_u
            (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
            (i32.const 25)))))
    (i32.const 0))

  ;; Save a whole-line delimiter for Bash or Terraform heredocs.
  ;; $trim 1 permits leading tabs, 2 also permits spaces. Bits 4 and 8
  ;; mark word closers (see $lineDelimiterEnds). Delimiters longer than
  ;; 32 bytes cannot be checkpointed (see $streamSetFixed).
  (func $streamSetLine (param $delimiter i32) (param $len i32) (param $trim i32) (param $hl i32)
    (if
      (i32.and
        (global.get $streaming)
        (i32.and
          (i32.le_u (local.get $len) (i32.const 32))
          (i32.eq (global.get $ptr) (global.get $eof))))
      (then
        (memory.copy (i32.const $mem.streamDelimiter) (local.get $delimiter) (local.get $len))
        (global.set $streamMode (i32.const 22))
        (global.set $streamA (local.get $len))
        (global.set $streamB (local.get $trim))
        (global.set $streamHl (local.get $hl)))))

  ;; Save the kind of embedded region that continues in the next chunk:
  ;; 1 script, 2 style, 3 TSX front matter, 4 YAML front matter, 5 MDX JSX,
  ;; 6-8 framework expressions, 9-13 unfinished HTML/XML/Vue/Svelte/Astro
  ;; start tags. The owning lexer resumes start tags through highlights.wat.
  (func $streamSetRegion (param $kind i32)
    (if (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof)))
      (then
        (global.set $streamRegionKind (local.get $kind))
        (global.set $streamRegionStarted (i32.const 0)))))

  ;; Resume a fixed-delimiter body: hop to each occurrence of the delimiter's
  ;; first byte with SIMD, then verify the rest.
  (func $streamResumeFixed (result i32)
    (local $i i32)
    (local $lhs i32)
    (local $matched i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $notFound
      (loop $search
        (local.set $p
          (call $lexFindByte (local.get $p) (i32.load8_u (i32.const $mem.streamDelimiter))))
        (br_if $notFound
          (i32.gt_u (i32.add (local.get $p) (global.get $streamA)) (global.get $end)))
        (local.set $i (i32.const 1))
        (local.set $matched (i32.const 1))
        (block $compareDone
          (loop $compare
            (br_if $compareDone (i32.ge_u (local.get $i) (global.get $streamA)))
            (if
              (i32.ne
                (i32.load8_u (i32.add (local.get $p) (local.get $i)))
                (i32.load8_u (i32.add (i32.const $mem.streamDelimiter) (local.get $i))))
              (then
                (local.set $matched (i32.const 0))
                (br $compareDone)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $compare)))
        (if (local.get $matched)
          (then
            (global.set $ptr (i32.add (local.get $p) (global.get $streamA)))
            (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
            (global.set $streamMode (i32.const 0))
            (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $search)))
    (global.set $ptr (global.get $end))
    (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  ;; Scan a nested region with two-byte delimiters. Return the remaining
  ;; depth at $end, or 0 if closed. $open and $close use source byte order.
  ;; SIMD compares whole pairs, such as `/*` and `*/`, so repeated first
  ;; bytes in `(* **** *)` or `{- ---- -}` do not stop each scan.
  (func $lexNestedScan (param $depth i32) (param $open i32) (param $close i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (local $w1 v128)
    (local $o0 v128)
    (local $o1 v128)
    (local $c0 v128)
    (local $c1 v128)
    (local.set $o0 (i8x16.splat (local.get $open)))
    (local.set $o1 (i8x16.splat (i32.shr_u (local.get $open) (i32.const 8))))
    (local.set $c0 (i8x16.splat (local.get $close)))
    (local.set $c1 (i8x16.splat (i32.shr_u (local.get $close) (i32.const 8))))
    (block $done
      (loop $scan
        ;; the earliest opener or closer at or after $ptr; wide loads may run
        ;; into the input slack, past $end
        (block $found
          (loop $wide
            (br_if $found (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $w (v128.load (global.get $ptr)))
            (local.set $w1 (v128.load offset=1 (global.get $ptr)))
            (local.set $mask
              (i8x16.bitmask
                (v128.or
                  (v128.and
                    (i8x16.eq (local.get $w) (local.get $o0))
                    (i8x16.eq (local.get $w1) (local.get $o1)))
                  (v128.and
                    (i8x16.eq (local.get $w) (local.get $c0))
                    (i8x16.eq (local.get $w1) (local.get $c1))))))
            (if (local.get $mask)
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
                (br $found)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
            (br $wide)))
        ;; a pair whose second byte is at or past $end lies partly in the
        ;; slack (or the enclosing region's bytes) and doesn't count
        (if (i32.ge_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (if (i32.eq (i32.load16_u (global.get $ptr)) (local.get $open))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (br $scan)))
        (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (br_if $done (i32.eqz (local.get $depth)))
        (br $scan)))
    (local.get $depth))

  ;; A nested block comment whose opening delimiter sits at $ptr. Consumes
  ;; through the balancing close (or to $end), emits $hl, and checkpoints the
  ;; remaining depth for streaming.
  (func $lexNestedBlockComment (param $open i32) (param $close i32) (param $hl i32)
    (local $lhs i32)
    (local $depth i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (local.set $depth (call $lexNestedScan (i32.const 1) (local.get $open) (local.get $close)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (call $streamSetNested (local.get $depth) (local.get $open) (local.get $close) (local.get $hl)))

  (func $streamResumeNested (result i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $streamA
      (call $lexNestedScan (global.get $streamA) (global.get $streamB) (global.get $streamC)))
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
        (if (i32.and (global.get $streamB) (i32.const 3))
          (then
            (block $trimDone
              (loop $trim
                (br_if $trimDone (i32.ge_u (local.get $candidate) (global.get $end)))
                (local.set $c (i32.load8_u (local.get $candidate)))
                (br_if $trimDone
                  (i32.eqz
                    (i32.or
                      (i32.eq (local.get $c) (i32.const 9))
                      (i32.and
                        (i32.eq (local.get $c) (i32.const 32))
                        (i32.eq (i32.and (global.get $streamB) (i32.const 3)) (i32.const 2))))))
                (local.set $candidate (i32.add (local.get $candidate) (i32.const 1)))
                (br $trim)))))
        (local.set $matched
          (i32.le_u (i32.add (local.get $candidate) (global.get $streamA)) (global.get $end)))
        (local.set $i (i32.const 0))
        (block $compareDone
          (loop $compare
            (br_if $compareDone (i32.eqz (local.get $matched)))
            (br_if $compareDone (i32.ge_u (local.get $i) (global.get $streamA)))
            (if
              (i32.ne
                (i32.load8_u (i32.add (local.get $candidate) (local.get $i)))
                (i32.load8_u (i32.add (i32.const $mem.streamDelimiter) (local.get $i))))
              (then
                (local.set $matched (i32.const 0))
                (br $compareDone)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $compare)))
        (if (local.get $matched)
          (then
            (global.set $ptr (i32.add (local.get $candidate) (global.get $streamA)))
            ;; the delimiter must occupy the whole line, or start it for a
            ;; word closer; consume the line and its LF/CRLF
            (if (i32.eqz (call $lineDelimiterEnds (global.get $ptr) (global.get $streamB)))
              (then (local.set $matched (i32.const 0))))
            (if (local.get $matched)
              (then
                (if (i32.and (global.get $streamB) (i32.const 12))
                  (then (call $scanToLineEnd)))
                (if (i32.lt_u (global.get $ptr) (global.get $end))
                  (then
                    (local.set $c (i32.load8_u (global.get $ptr)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const 13))
                        (i32.and
                          (i32.lt_u (global.get $ptr) (global.get $end))
                          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 10))))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                (call $emitTok (global.get $streamHl) (local.get $lhs) (global.get $ptr))
                (global.set $streamMode (i32.const 0))
                (return (i32.const 0))))))
        ;; Skip to the next line. Treat lone CR as a terminator and CRLF as one
        ;; terminator, as in whole-file scans and the live line table.
        ;; Stopping only at LF would skip a closer after a lone CR.
        (block $lineDone
          (loop $line
            (br_if $lineDone (i32.ge_u (local.get $p) (global.get $end)))
            (local.set $c (i32.load8_u (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $lineDone (i32.eq (local.get $c) (i32.const 10)))
            (if (i32.eq (local.get $c) (i32.const 13))
              (then
                (if
                  (i32.and
                    (i32.lt_u (local.get $p) (global.get $end))
                    (i32.eq (i32.load8_u (local.get $p)) (i32.const 10)))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (br $lineDone)))
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
        (if
          (i32.or
            (i32.lt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
            (i32.ne (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2))) (i32.const 0x2f2a)))
          (then (return (i32.const 1))))
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.eq (global.get $streamMode) (i32.const 2))
      (then
        (local.set $status
          (call $lexStringBody
            (global.get $streamA)
            (global.get $streamB)
            (global.get $streamHl)
            (local.get $lhs)))
        (if
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.ne (local.get $status) (i32.const 1)))
          (then (return (i32.const 1))))
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.eq (global.get $streamMode) (i32.const 3))
      (then
        (local.set $status
          (call $lexRawStringBody
            (global.get $streamA)
            (global.get $streamB)
            (global.get $streamHl)
            (local.get $lhs)))
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

  ;; Skip spaces and tabs on the current line. Stop at line breaks so
  ;; whole-buffer and line-fed scans classify `foo\n(` the same way.
  (func $lexSkipSpaceAt (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done
          (i32.and (i32.ne (local.get $c) (i32.const 32)) (i32.ne (local.get $c) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; Split a C-family `#include` or `#import` directive already bounded by
  ;; [lhs,rhs). Return one after emitting a quoted or angle-bracket header,
  ;; zero when the directive uses a macro or has another name.
  (func $lexEmitIncludeDirective (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local $word i32)
    (local $header i32)
    (local $close i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $name
      (loop $space
        (br_if $name (i32.ge_u (local.get $p) (local.get $rhs)))
        (br_if $name
          (i32.and
            (i32.ne (i32.load8_u (local.get $p)) (i32.const 32))
            (i32.ne (i32.load8_u (local.get $p)) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (local.set $word (local.get $p))
    (if (i32.gt_u (i32.add (local.get $word) (i32.const 6)) (local.get $rhs))
      (then (return (i32.const 0))))
    ;; the wide loads stay inside the input slack
    (if
      (i64.eq
        (i64.and (i64.load (local.get $word)) (i64.const 0x00ffffffffffffff))
        (i64.const "include"))
      (then (local.set $p (i32.add (local.get $word) (i32.const 7))))
      (else
        (if
          (i64.ne
            (i64.and (i64.load (local.get $word)) (i64.const 0x0000ffffffffffff))
            (i64.const "import"))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $word) (i32.const 6)))))
    (if (i32.gt_u (local.get $p) (local.get $rhs))
      (then (return (i32.const 0))))
    (if
      (i32.and
        (i32.lt_u (local.get $p) (local.get $rhs))
        (call $lexIsIdentContinue (i32.load8_u (local.get $p))))
      (then (return (i32.const 0))))
    (block $headerStart
      (loop $space
        (br_if $headerStart (i32.ge_u (local.get $p) (local.get $rhs)))
        (br_if $headerStart
          (i32.and
            (i32.ne (i32.load8_u (local.get $p)) (i32.const 32))
            (i32.ne (i32.load8_u (local.get $p)) (i32.const 9))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (if (i32.ge_u (local.get $p) (local.get $rhs))
      (then (return (i32.const 0))))
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

  ;; The word bytes of every keyword table, packed by the build; descriptors
  ;; address them with 13-bit offsets, so the pool holds at most 8191 bytes.
  (keyword-pool $mem.keywordPool $mem.jsonStack)

  ;; Look up a word with a perfect hash of its first two bytes, last byte,
  ;; and length. Return the 1-based group index, or 0 if absent.
  ;; The lookup uses one probe and one bounded comparison.
  ;; Call through keyword-table.get, which supplies the table constants.
  ;; See scripts/build.ts for the table format.
  (func $lexKeywordLookup
    (param $start i32)
    (param $end i32)
    (param $base i32)
    (param $bucketMask i32)
    (param $slots i32)
    (result i32)
    (local $len i32)
    (local $h i32)
    (local $entry i32)
    (local $rec i32)
    (local.set $len (i32.sub (local.get $end) (local.get $start)))
    (if (i32.gt_u (i32.sub (local.get $len) (i32.const 2)) (i32.const 29))
      (then (return (i32.const 0))))
    (local.set $h
      (i32.or
        (i32.or
          (i32.load16_u (local.get $start))
          (i32.shl (i32.load8_u (i32.sub (local.get $end) (i32.const 1))) (i32.const 16)))
        (i32.shl (local.get $len) (i32.const 24))))
    (local.set $h
      (i32.mul
        (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 16)))
        (i32.const 0xe51fac89)))
    (local.set $h (i32.xor (local.get $h) (i32.shr_u (local.get $h) (i32.const 24))))
    ;; Layout: displacement bytes at base, then 3-byte descriptors at
    ;; base+buckets: (len<<19 | group<<13 | pool offset).
    ;; Add the bucket displacement times an odd second hash, then rotate
    ;; and reduce to the slot count with a multiply and shift.
    ;; Any slot count is valid. The 4-byte load reads one extra descriptor
    ;; byte, which the mask discards.
    (local.set $entry
      (i32.and
        (i32.load
          (i32.add
            (i32.add (local.get $base) (i32.add (local.get $bucketMask) (i32.const 1)))
            (i32.mul
              (i32.wrap_i64
                (i64.shr_u
                  (i64.mul
                    (i64.extend_i32_u
                      (i32.rotl
                        (i32.add
                          (local.get $h)
                          (i32.mul
                            (i32.load8_u
                              (i32.add
                                (local.get $base)
                                (i32.and (local.get $h) (local.get $bucketMask))))
                            (i32.or (i32.shr_u (local.get $h) (i32.const 12)) (i32.const 1))))
                        (i32.const 16)))
                    (i64.extend_i32_u (local.get $slots)))
                  (i64.const 32)))
              (i32.const 3))))
        (i32.const 0xffffff)))
    ;; a length mismatch also rejects empty slots (their length field is 0)
    (if (i32.ne (local.get $len) (i32.shr_u (local.get $entry) (i32.const 19)))
      (then (return (i32.const 0))))
    ;; the exact word bytes sit in the shared pool
    (local.set $rec
      (i32.add (i32.const $mem.keywordPool) (i32.and (local.get $entry) (i32.const 8191))))
    ;; Ignore differing bytes after the word: ctz(0) is 32, beyond every
    ;; supported length. Longer words also compare an overlapping tail.
    (if
      (i32.lt_u
        (i32.ctz
          (i8x16.bitmask
            (i8x16.ne (v128.load (local.get $start)) (v128.load (local.get $rec)))))
        (local.get $len))
      (then (return (i32.const 0))))
    (if (i32.gt_u (local.get $len) (i32.const 16))
      (then
        (if
          (v128.any_true
            (v128.xor
              (v128.load (i32.sub (local.get $end) (i32.const 16)))
              (v128.load (i32.add (local.get $rec) (i32.sub (local.get $len) (i32.const 16))))))
          (then (return (i32.const 0))))))
    (i32.and (i32.shr_u (local.get $entry) (i32.const 13)) (i32.const 63)))

  ;; Return the word's group value, or -1 if the word or value is absent.
  ;; See keyword-table.value. Signed 16-bit group values follow the
  ;; displacement bytes and 3-byte descriptors.
  (func $lexKeywordValue
    (param $start i32)
    (param $end i32)
    (param $base i32)
    (param $bucketMask i32)
    (param $slots i32)
    (result i32)
    (local $g i32)
    (local.set $g
      (call $lexKeywordLookup
        (local.get $start)
        (local.get $end)
        (local.get $base)
        (local.get $bucketMask)
        (local.get $slots)))
    (if (i32.eqz (local.get $g))
      (then (return (i32.const -1))))
    (i32.load16_s
      (i32.add
        (i32.add (local.get $base) (i32.add (local.get $bucketMask) (i32.const 1)))
        (i32.add (i32.mul (local.get $slots) (i32.const 3)) (i32.shl (local.get $g) (i32.const 1))))))

  ;; Copy a word as lowercase ASCII for case-insensitive lookup.
  ;; Wide loads read input slack. Stores fit the 64-byte scratch buffer.
  ;; Return the copied length, or 0 if the word exceeds the table's limit.
  ;; A zero-length range cannot match a keyword.
  (func $lexLowerCopy (param $lhs i32) (param $rhs i32) (param $dst i32) (result i32)
    (local $n i32)
    (local $i i32)
    (local $w v128)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (local.get $n) (i32.const 31))
      (then (return (i32.const 0))))
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $w (v128.load (i32.add (local.get $lhs) (local.get $i))))
        (v128.store
          (i32.add (local.get $dst) (local.get $i))
          (v128.or
            (local.get $w)
            (v128.and
              (i8x16.le_u
                (i8x16.sub (local.get $w) (i8x16.splat (i32.const "A")))
                (i8x16.splat (i32.const 25)))
              (i8x16.splat (i32.const 32)))))
        (local.set $i (i32.add (local.get $i) (i32.const 16)))
        (br $wide)))
    (local.get $n))

  ;; Return the next occurrence of either byte, or $end. Long clean runs use
  ;; one SIMD comparison pair per 16 bytes; matches in slack clamp to $end.
  (func $lexFindEither (param $p i32) (param $a i32) (param $b i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (block $done
      (loop $simd
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (local.get $a)))
              (i8x16.eq (local.get $w) (i8x16.splat (local.get $b))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br_if $simd (i32.lt_u (local.get $p) (global.get $end)))))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Find byte $a, or return $end. Use one SIMD comparison per 16 bytes.
  ;; This needs fewer instructions than $lexFindEither with a repeated byte.
  ;; Clamp matches in input slack to $end.
  (func $lexFindByte (param $p i32) (param $a i32) (result i32)
    (local $mask i32)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (block $done
      (loop $simd
        (local.set $mask
          (i8x16.bitmask (i8x16.eq (v128.load (local.get $p)) (i8x16.splat (local.get $a)))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br_if $simd (i32.lt_u (local.get $p) (global.get $end)))))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Whether the operator [lhs,rhs) is made only of `<`, `>`, and `?` - the
  ;; bytes that glue a generic or nullable type together - so a C-family
  ;; lexer can keep a type pending across `List<Map<K, V>>` and `String?`.
  (func $lexIsTypeGlue (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if
          (i32.and
            (i32.ne (local.get $c) (i32.const "<"))
            (i32.and
              (i32.ne (local.get $c) (i32.const ">"))
              (i32.ne (local.get $c) (i32.const "?"))))
          (then (return (i32.const 0))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; Whether the gap [p, stop) between two tokens holds a CR or LF. A scalar
  ;; walk: gaps are short and usually break on their first byte, so this is
  ;; cheaper per token than a SIMD scan.
  (func $lexGapHasBreak (param $p i32) (param $stop i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $stop)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
          (then (return (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; SCREAMING_CASE test for a name: at least one uppercase letter and only
  ;; [A-Z0-9_]. Single letters are excluded - `T` is a type parameter, not a
  ;; constant.
  (func $lexIsConstCase (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $upper i32)
    (if (i32.lt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
      (then (return (i32.const 0))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
          (then (local.set $upper (i32.const 1)))
          (else
            (if
              (i32.eqz
                (i32.or (call $lexIsDigit (local.get $c)) (i32.eq (local.get $c) (i32.const "_"))))
              (then (return (i32.const 0))))))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (local.get $upper))

  ;; Shared string helpers for Java, Kotlin, Scala, Groovy, Dart, and Swift.
  ;; Keep each lexer's main string loop inline for speed. Share the less
  ;; frequent escape and `$` handling to reduce code size.

  (func $templateByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Emit [$seg,$ptr), then the backslash escape at $ptr. Advance past it.
  ;; Return 1 if the escape ends at $end with a line break, so the string
  ;; continues in the next chunk. Return 0 otherwise.
  (func $stringEscapeAt (param $seg i32) (result i32)
    (local $e i32)
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.set $e (call $lexEscapeEnd (global.get $ptr)))
    (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
    (global.set $ptr (local.get $e))
    (i32.and
      (i32.eq (global.get $ptr) (global.get $end))
      (i32.or
        (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
        (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13)))))

  ;; Handle `$` in a template whose bytes from $seg are not yet emitted.
  ;; Recognize `${`, `$name`, or a plain `$`. Inside a nested string
  ;; ($nested), keep `${` as text.
  ;; $dialect 8 escapes `$$` (Scala). Bit 16 allows `.name` segments
  ;; (Groovy). Neither permits `$` in names. Dialect 0 (Kotlin/Dart) does.
  ;; Return -1 after emitting `${` as punctuation.special. Otherwise return
  ;; the start of the body's bytes that are not yet emitted.
  (func $stringDollarAt (param $seg i32) (param $dialect i32) (param $nested i32) (result i32)
    (local $at i32)
    (local $c2 i32)
    (local.set $at (global.get $ptr))
    (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
    (if (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.eqz (local.get $nested)))
      (then
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        ;; the `{` was read below $end, so this cannot overshoot
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $at) (global.get $ptr))
        (return (i32.const -1))))
    (if (i32.and (i32.eq (local.get $c2) (i32.const "$")) (i32.ne (local.get $dialect) (i32.const 0)))
      (then
        (if (i32.eq (local.get $dialect) (i32.const 16))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (return (local.get $seg))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $at) (global.get $ptr))
        (return (global.get $ptr))))
    (if (call $lexIsIdentStart (local.get $c2))
      (then
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $nameDone
          (loop $name
            (call $scanIdentRun (select (i32.const "_") (i32.const "$") (local.get $dialect)))
            (br_if $nameDone
              (i32.eqz
                (i32.and
                  (i32.eq (local.get $dialect) (i32.const 16))
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                    (i32.and
                      (call $lexIsIdentStart
                        (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                      (i32.ne
                        (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                        (i32.const "$")))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $name)))
        (call $emitTok (enum.get $Token.variable) (local.get $at) (global.get $ptr))
        (return (global.get $ptr))))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (local.get $seg))
)
