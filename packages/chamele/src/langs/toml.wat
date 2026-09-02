(module
  (import "../common.wat")

  ;; The container stack holds one kind byte per nesting level.

  (func $tomlByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $tomlIsBareKey (param $c i32) (result i32)
    (i32.or
      (call $lexIsDigit (local.get $c))
      (i32.or
        (i32.le_u
          (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a"))
          (i32.const 25))
        (i32.or
          (i32.eq (local.get $c) (i32.const "_"))
          (i32.eq (local.get $c) (i32.const "-"))))))

  ;; End of the bare-key run [A-Za-z0-9_-] starting at $p - 16 bytes per
  ;; step, clamped to $end. Bare keys are ASCII, so unlike $scanIdentRun this
  ;; stops at bytes >= 0x80 instead of absorbing a UTF-8 sequence.
  (func $tomlBareKeyEnd (param $p i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask (i32.xor
          (i8x16.bitmask (v128.or
            (v128.or
              (i8x16.le_u
                (i8x16.sub
                  (v128.or (local.get $w) (i8x16.splat (i32.const 32)))
                  (i8x16.splat (i32.const "a")))
                (i8x16.splat (i32.const 25)))
              (i8x16.le_u
                (i8x16.sub (local.get $w) (i8x16.splat (i32.const "0")))
                (i8x16.splat (i32.const 9))))
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "_")))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const "-"))))))
          (i32.const 65535)))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (if (i32.gt_u (local.get $p) (global.get $end))
      (then (local.set $p (global.get $end))))
    (local.get $p))

  ;; TOML digits may contain underscores only between digits. $base is 2, 8,
  ;; 10, or 16; the caller checks that at least one digit was consumed.
  (func $tomlScanDigits (param $p i32) (param $base i32) (result i32)
    (local $c i32)
    (local $next i32)
    (block $done
      (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
      (local.set $c (i32.load8_u (local.get $p)))
      (br_if $done (i32.eqz
        (select
          (call $lexIsHex (local.get $c))
          (i32.lt_u
            (i32.sub (local.get $c) (i32.const "0"))
            (local.get $base))
          (i32.eq (local.get $base) (i32.const 16)))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (loop $digit
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (select
              (call $lexIsHex (local.get $c))
              (i32.lt_u
                (i32.sub (local.get $c) (i32.const "0"))
                (local.get $base))
              (i32.eq (local.get $base) (i32.const 16)))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $digit)))
        (br_if $done (i32.ne (local.get $c) (i32.const "_")))
        (local.set $next (i32.add (local.get $p) (i32.const 1)))
        (br_if $done (i32.ge_u (local.get $next) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $next)))
        (br_if $done (i32.eqz
          (select
            (call $lexIsHex (local.get $c))
            (i32.lt_u
              (i32.sub (local.get $c) (i32.const "0"))
              (local.get $base))
            (i32.eq (local.get $base) (i32.const 16)))))
        (local.set $p (i32.add (local.get $p) (i32.const 2)))
        (br $digit)))
    (local.get $p))

  (func $tomlIsValueEnd (param $p i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.const 1))))
    (local.set $c (i32.load8_u (local.get $p)))
    (i32.or
      (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 1))
      (i32.or
        (i32.or
          (i32.eq (local.get $c) (i32.const 13))
          (i32.eq (local.get $c) (i32.const 32)))
        (i32.or
          (i32.eq (local.get $c) (i32.const "#"))
          (i32.or
            (i32.eq (local.get $c) (i32.const ","))
            (i32.or
              (i32.eq (local.get $c) (i32.const "]"))
              (i32.eq (local.get $c) (i32.const "}"))))))))

  (func $tomlTwoDigits
    (param $p i32) (param $min i32) (param $max i32) (result i32)
    (local $n i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 2)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.eqz (i32.and
          (call $lexIsDigit (i32.load8_u (local.get $p)))
          (call $lexIsDigit (i32.load8_u offset=1 (local.get $p)))))
      (then (return (i32.const 0))))
    (local.set $n
      (i32.add
        (i32.mul
          (i32.sub (i32.load8_u (local.get $p)) (i32.const "0"))
          (i32.const 10))
        (i32.sub (i32.load8_u offset=1 (local.get $p)) (i32.const "0"))))
    (i32.and
      (i32.ge_u (local.get $n) (local.get $min))
      (i32.le_u (local.get $n) (local.get $max))))

  ;; End of the whitespace a line-ending backslash trims: spaces, tabs, LFs,
  ;; and CRLFs from $q, clamped to $end.
  (func $tomlTrimEnd (param $q i32) (result i32)
    (local $c i32)
    (block $trimDone
      (loop $trim
        (br_if $trimDone (i32.ge_u (local.get $q) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const 9))
              (i32.or
                (i32.eq (local.get $c) (i32.const 10))
                (i32.eq (local.get $c) (i32.const 32))))
          (then
            (local.set $q (i32.add (local.get $q) (i32.const 1)))
            (br $trim)))
        (br_if $trimDone (i32.ne (local.get $c) (i32.const 13)))
        (br_if $trimDone
          (i32.ge_u (i32.add (local.get $q) (i32.const 1)) (global.get $end)))
        (br_if $trimDone
          (i32.ne (i32.load8_u offset=1 (local.get $q)) (i32.const 10)))
        (local.set $q (i32.add (local.get $q) (i32.const 2)))
        (br $trim)))
    (local.get $q))

  ;; Scan a basic string body from $ptr with TOML's escape productions and
  ;; the three-to-five-quote close. $seg starts the pending string token;
  ;; $trim is one when the previous chunk ended inside the whitespace a
  ;; line-ending backslash trims, so the leading whitespace here is still
  ;; escape text. Returns 1 after the closing quote(s), 2 when the body
  ;; reached $end inside such a trim run, and 0 when it reached $end - or,
  ;; single-line, an unconsumed raw line break - otherwise.
  (func $tomlBasicStringBody
    (param $multiline i32) (param $hl i32) (param $seg i32) (param $trim i32)
    (result i32)
    (local $c i32)
    (local $closed i32)
    (local $e i32)
    (local $escape i32)
    (local $line i32)
    (local $quotes i32)
    (local $q i32)
    (if (local.get $trim)
      (then
        (local.set $e (call $tomlTrimEnd (global.get $ptr)))
        (call $emitTok
          (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then (return (i32.const 2))))
        (local.set $trim (i32.const 0))))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; One pass stops on the closing quote, an escape, and - for a
        ;; single-line string - the raw line break that leaves it unterminated.
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1)
          (i32.eqz (local.get $multiline))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        ;; a raw line break: unterminated, left unconsumed
        (br_if $done (i32.and
          (i32.ne (local.get $c) (i32.const 34))
          (i32.ne (local.get $c) (i32.const 92))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (if (i32.eqz (local.get $multiline))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $closed (i32.const 1))
                (br $done)))
            (local.set $quotes (i32.const 0))
            (block $quoteDone
              (loop $quote
                (br_if $quoteDone
                  (i32.ge_u (local.get $quotes) (i32.const 5)))
                (br_if $quoteDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $quoteDone
                  (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 34)))
                (local.set $quotes (i32.add (local.get $quotes) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $quote)))
            (if (i32.ge_u (local.get $quotes) (i32.const 3))
              (then
                (local.set $closed (i32.const 1))
                (br $done)))
            (br $scan)))

        ;; Only TOML escape productions receive the escape capture.
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $escape (i32.const 0))
        (local.set $line (i32.const 0))
        (local.set $trim (i32.const 0))
        (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (then
            (local.set $c (i32.load8_u offset=1 (global.get $ptr)))
            (if (i32.or
                  (i32.or
                    (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 92)))
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "b"))
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "e"))
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "f"))
                        (i32.or
                          (i32.eq (local.get $c) (i32.const "n"))
                          (i32.or
                            (i32.eq (local.get $c) (i32.const "r"))
                            (i32.eq (local.get $c) (i32.const "t"))))))))
              (then
                (local.set $e (i32.add (global.get $ptr) (i32.const 2)))
                (local.set $escape (i32.const 1))))
            (if (i32.eq (local.get $c) (i32.const "x"))
              (then
                (local.set $q (call $scanHexRun
                  (i32.add (global.get $ptr) (i32.const 2)) (i32.const 2)))
                (if (i32.eq
                      (local.get $q)
                      (i32.add (global.get $ptr) (i32.const 4)))
                  (then
                    (local.set $e (local.get $q))
                    (local.set $escape (i32.const 1))))))
            (if (i32.eq (local.get $c) (i32.const "u"))
              (then
                (local.set $q (call $scanHexRun
                  (i32.add (global.get $ptr) (i32.const 2)) (i32.const 4)))
                (if (i32.eq
                      (local.get $q)
                      (i32.add (global.get $ptr) (i32.const 6)))
                  (then
                    (local.set $e (local.get $q))
                    (local.set $escape (i32.const 1))))))
            (if (i32.eq (local.get $c) (i32.const "U"))
              (then
                (local.set $q (call $scanHexRun
                  (i32.add (global.get $ptr) (i32.const 2)) (i32.const 8)))
                (if (i32.eq
                      (local.get $q)
                      (i32.add (global.get $ptr) (i32.const 10)))
                  (then
                    (local.set $e (local.get $q))
                    (local.set $escape (i32.const 1))))))
            ;; a line-ending backslash: the escape spans the line break and
            ;; every blank line and indentation up to the next content
            (if (local.get $multiline)
              (then
                (local.set $q (i32.add (global.get $ptr) (i32.const 1)))
                (block $indentDone
                  (loop $indent
                    (br_if $indentDone (i32.ge_u (local.get $q) (global.get $end)))
                    (local.set $c (i32.load8_u (local.get $q)))
                    (br_if $indentDone (i32.and
                      (i32.ne (local.get $c) (i32.const 9))
                      (i32.ne (local.get $c) (i32.const 32))))
                    (local.set $q (i32.add (local.get $q) (i32.const 1)))
                    (br $indent)))
                (if (i32.lt_u (local.get $q) (global.get $end))
                  (then
                    (local.set $c (i32.load8_u (local.get $q)))
                    (if (i32.eq (local.get $c) (i32.const 10))
                      (then
                        (local.set $q (i32.add (local.get $q) (i32.const 1)))
                        (local.set $line (i32.const 1))))
                    (if (i32.and
                          (i32.eq (local.get $c) (i32.const 13))
                          (i32.and
                            (i32.lt_u (i32.add (local.get $q) (i32.const 1)) (global.get $end))
                            (i32.eq (i32.load8_u offset=1 (local.get $q)) (i32.const 10))))
                      (then
                        (local.set $q (i32.add (local.get $q) (i32.const 2)))
                        (local.set $line (i32.const 1))))))
                (if (local.get $line)
                  (then
                    (local.set $e (call $tomlTrimEnd (local.get $q)))
                    (local.set $escape (i32.const 1))
                    ;; a trim run cut off by the chunk end continues in the
                    ;; next chunk
                    (local.set $trim
                      (i32.eq (local.get $e) (global.get $end)))))))))
        (call $emitTok
          (select
            (enum.get $Token.string.escape) (local.get $hl)
            (local.get $escape))
          (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (select
      (i32.const 1)
      (select (i32.const 2) (i32.const 0) (local.get $trim))
      (local.get $closed)))

  ;; Checkpoint a multi-line string left open at the chunk end as toml stream
  ;; mode 13: the quote byte in $streamA and, in $streamB, whether a
  ;; line-ending backslash is still trimming leading whitespace. The shared
  ;; fixed-delimiter mode cannot resume these bodies: it knows nothing about
  ;; escapes or the two extra quotes a closing delimiter may absorb.
  (func $tomlStreamOpen (param $quote i32) (param $trim i32) (param $hl i32)
    (if (i32.and
          (global.get $streaming)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (global.set $streamMode (i32.const 13))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (local.get $trim))
        (global.set $streamHl (local.get $hl)))))

  ;; A basic string at $ptr: `"` single-line or `"""` multi-line.
  (func $tomlBasicString (param $multiline i32) (param $hl i32)
    (local $seg i32)
    (local $status i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr)
      (select (i32.const 3) (i32.const 1) (local.get $multiline))))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (local.set $status
      (call $tomlBasicStringBody
        (local.get $multiline) (local.get $hl) (local.get $seg) (i32.const 0)))
    (if (i32.and (local.get $multiline) (i32.ne (local.get $status) (i32.const 1)))
      (then (call $tomlStreamOpen
        (i32.const 34) (i32.eq (local.get $status) (i32.const 2)) (local.get $hl)))))

  ;; Scan a multi-line literal string body from $ptr: hop between quotes with
  ;; SIMD and stop after a run of three to five, since up to two quotes may
  ;; precede the closing delimiter. $lhs starts the pending token. Returns 1
  ;; when the string closed, 0 when it ran to $end.
  (func $tomlLiteralStringBody (param $hl i32) (param $lhs i32) (result i32)
    (local $closed i32)
    (local $quotes i32)
    (block $rawDone
      (loop $raw
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 39)))
        (br_if $rawDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $quotes (i32.const 0))
        (block $quoteDone
          (loop $quote
            (br_if $quoteDone (i32.ge_u (local.get $quotes) (i32.const 5)))
            (br_if $quoteDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (br_if $quoteDone
              (i32.ne (i32.load8_u (global.get $ptr)) (i32.const 39)))
            (local.set $quotes (i32.add (local.get $quotes) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $quote)))
        (if (i32.ge_u (local.get $quotes) (i32.const 3))
          (then
            (local.set $closed (i32.const 1))
            (br $rawDone)))
        (br $raw)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (local.get $closed))

  ;; A `'''` multi-line literal string at $ptr.
  (func $tomlLiteralString (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (if (i32.eqz (call $tomlLiteralStringBody (local.get $hl) (local.get $lhs)))
      (then (call $tomlStreamOpen (i32.const 39) (i32.const 0) (local.get $hl)))))

  (func $hlToml
    (local $base i32)
    (local $c i32)
    (local $depth i32)
    (local $gap i32)
    (local $header i32)
    (local $hl i32)
    (local $key i32)
    (local $lhs i32)
    (local $date i32)
    (local $limit i32)
    (local $n i32)
    (local $p i32)
    (local $q i32)
    (local $r i32)
    (local $sawNewline i32)
    (local $time i32)
    (local $valid i32)
    (local $year i32)
    (local.set $key (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; TOML whitespace is space/tab; records are separated by LF or CRLF.
        (local.set $gap (global.get $ptr))
        (local.set $sawNewline (i32.const 0))
        (block $spaceDone
          (loop $space
            (br_if $spaceDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $spaceDone (i32.and
              (i32.and
                (i32.ne (local.get $c) (i32.const 9))
                (i32.ne (local.get $c) (i32.const 10)))
              (i32.and
                (i32.ne (local.get $c) (i32.const 13))
                (i32.ne (local.get $c) (i32.const 32)))))
            (if (i32.eq (local.get $c) (i32.const 10))
              (then (local.set $sawNewline (i32.const 1))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $space)))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (if (local.get $sawNewline)
          (then
            (local.set $header (i32.const 0))
            (if (i32.eqz (local.get $depth))
              (then (local.set $key (i32.const 1))))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        ;; Comments always run to the bounded line end.
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        ;; Quoted keys use property color, while values use string color.
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $hl (select
              (enum.get $Token.property) (enum.get $Token.string)
              (i32.or (local.get $key) (local.get $header))))
            (if (i32.and
                  (i32.eqz (i32.or (local.get $key) (local.get $header)))
                  (i32.and
                    (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
                    (i32.and
                      (i32.eq (call $tomlByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $c))
                      (i32.eq (call $tomlByte (i32.add (global.get $ptr) (i32.const 2))) (local.get $c)))))
              (then
                (if (i32.eq (local.get $c) (i32.const 34))
                  (then (call $tomlBasicString (i32.const 1) (local.get $hl)))
                  (else (call $tomlLiteralString (local.get $hl)))))
              (else
                (if (i32.eq (local.get $c) (i32.const 34))
                  (then (call $tomlBasicString (i32.const 0) (local.get $hl)))
                  (else (call $lexRawString
                    (i32.const 39) (i32.const 0) (local.get $hl))))))
            (br $next)))

        ;; A bare key can consist entirely of digits, so key context wins.
        (if (i32.and
              (i32.or (local.get $key) (local.get $header))
              (call $tomlIsBareKey (local.get $c)))
          (then
            (global.set $ptr (call $tomlBareKeyEnd (global.get $ptr)))
            (call $emitTok
              (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Assignment enters value context.
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (local.set $key (i32.const 0))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; A bracket in key context opens a table header; otherwise an array.
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (if (i32.and (local.get $key) (i32.eqz (local.get $depth)))
              (then (local.set $header (i32.const 1)))
              (else
                (if (i32.lt_u (local.get $depth) (i32.const 1024))
                  (then
                    (i32.store8
                      (i32.add (i32.const $mem.tomlStack) (local.get $depth))
                      (i32.const 0))))
                (local.set $depth
                  (i32.add (local.get $depth) (i32.const 1)))
                (local.set $key (i32.const 0))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (local.get $header)
                  (i32.eq (call $tomlByte (global.get $ptr)) (i32.const "[")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok
              (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "]"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (local.get $header)
                  (i32.eq (call $tomlByte (global.get $ptr)) (i32.const "]")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (if (local.get $header)
              (then
                (local.set $header (i32.const 0))
                (local.set $key (i32.const 0)))
              (else
                (if (local.get $depth)
                  (then
                    (local.set $depth
                      (i32.sub (local.get $depth) (i32.const 1)))))))
            (call $emitTok
              (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; A low-bit container stack distinguishes arrays from inline tables.
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (if (i32.lt_u (local.get $depth) (i32.const 1024))
              (then
                (i32.store8
                  (i32.add (i32.const $mem.tomlStack) (local.get $depth))
                  (i32.const 1))))
            (local.set $depth
              (i32.add (local.get $depth) (i32.const 1)))
            (local.set $key (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            (if (local.get $depth)
              (then
                (local.set $depth
                  (i32.sub (local.get $depth) (i32.const 1)))))
            (local.set $key (i32.const 0))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "."))
                    (i32.eq (local.get $c) (i32.const ",")))
          (then
            (if (i32.eq (local.get $c) (i32.const ","))
              (then
                (local.set $key (i32.const 0))
                (if (i32.and
                      (i32.ne (local.get $depth) (i32.const 0))
                      (i32.le_u (local.get $depth) (i32.const 1024)))
                  (then
                    (local.set $key
                      (i32.load8_u
                        (i32.add
                          (i32.const $mem.tomlStack-1) (local.get $depth))))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Booleans and special floats are exact, case-sensitive TOML atoms.
        (local.set $p (i32.add (local.get $lhs) (i32.const 4)))
        (if (i32.and
              (i32.le_u (local.get $p) (global.get $end))
              (i32.and
                (i32.eq (i32.load (local.get $lhs)) (i32.const "true"))
                (call $tomlIsValueEnd (local.get $p))))
          (then
            (global.set $ptr (local.get $p))
            (call $emitTok
              (enum.get $Token.constant) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $p (i32.add (local.get $lhs) (i32.const 5)))
        (if (i32.and
              (i32.le_u (local.get $p) (global.get $end))
              (i32.and
                (i64.eq
                  (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                  (i64.const "false"))
                (call $tomlIsValueEnd (local.get $p))))
          (then
            (global.set $ptr (local.get $p))
            (call $emitTok
              (enum.get $Token.constant) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $p (local.get $lhs))
        (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
              (i32.or
                (i32.eq (i32.load8_u (local.get $p)) (i32.const "+"))
                (i32.eq (i32.load8_u (local.get $p)) (i32.const "-"))))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (local.set $q (i32.add (local.get $p) (i32.const 3)))
        (if (i32.and
              (i32.le_u (local.get $q) (global.get $end))
              (i32.and
                (i32.or
                  (i32.eq
                    (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                    (i32.const "inf"))
                  (i32.eq
                    (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                    (i32.const "nan")))
                (call $tomlIsValueEnd (local.get $q))))
          (then
            (global.set $ptr (local.get $q))
            (call $emitTok
              (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Date/time recognition follows the fixed-width RFC 3339 grammar.
        ;; A space delimiter remains part of the date-time token.
        (local.set $date (i32.const 0))
        (local.set $time (i32.const 0))
        (local.set $valid
          (i32.le_u
            (i32.add (local.get $lhs) (i32.const 10))
            (global.get $end)))
        (if (local.get $valid)
          (then
            (local.set $valid (i32.and
              (i32.and
                (call $lexIsDigit (i32.load8_u (local.get $lhs)))
                (call $lexIsDigit (i32.load8_u offset=1 (local.get $lhs))))
              (i32.and
                (call $lexIsDigit (i32.load8_u offset=2 (local.get $lhs)))
                (call $lexIsDigit (i32.load8_u offset=3 (local.get $lhs))))))
            (local.set $valid (i32.and (local.get $valid)
              (i32.and
                (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "-"))
                (i32.and
                  (call $tomlTwoDigits
                    (i32.add (local.get $lhs) (i32.const 5))
                    (i32.const 1) (i32.const 12))
                  (i32.eq (i32.load8_u offset=7 (local.get $lhs)) (i32.const "-"))))))
            (if (local.get $valid)
              (then
                (local.set $n
                  (i32.add
                    (i32.mul
                      (i32.sub (i32.load8_u offset=5 (local.get $lhs)) (i32.const "0"))
                      (i32.const 10))
                    (i32.sub (i32.load8_u offset=6 (local.get $lhs)) (i32.const "0"))))
                (local.set $valid (i32.and
                  (i32.ge_u (local.get $n) (i32.const 1))
                  (i32.le_u (local.get $n) (i32.const 12))))
                (local.set $limit (i32.const 31))
                (if (i32.or
                      (i32.eq (local.get $n) (i32.const 4))
                      (i32.or
                        (i32.eq (local.get $n) (i32.const 6))
                        (i32.or
                          (i32.eq (local.get $n) (i32.const 9))
                          (i32.eq (local.get $n) (i32.const 11)))))
                  (then (local.set $limit (i32.const 30))))
                (if (i32.eq (local.get $n) (i32.const 2))
                  (then
                    (local.set $limit (i32.const 28))
                    (local.set $year
                      (i32.add
                        (i32.mul
                          (i32.add
                            (i32.mul
                              (i32.add
                                (i32.mul
                                  (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "0"))
                                  (i32.const 10))
                                (i32.sub (i32.load8_u offset=1 (local.get $lhs)) (i32.const "0")))
                              (i32.const 10))
                            (i32.sub (i32.load8_u offset=2 (local.get $lhs)) (i32.const "0")))
                          (i32.const 10))
                        (i32.sub (i32.load8_u offset=3 (local.get $lhs)) (i32.const "0"))))
                    (if (i32.and
                          (i32.eqz (i32.rem_u (local.get $year) (i32.const 4)))
                          (i32.or
                            (i32.ne (i32.rem_u (local.get $year) (i32.const 100)) (i32.const 0))
                            (i32.eqz (i32.rem_u (local.get $year) (i32.const 400)))))
                      (then (local.set $limit (i32.const 29))))))
                (local.set $valid (i32.and
                  (local.get $valid)
                  (call $tomlTwoDigits
                    (i32.add (local.get $lhs) (i32.const 8))
                    (i32.const 1) (local.get $limit))))))))
        (if (local.get $valid)
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 10)))
            (local.set $c (call $tomlByte (local.get $p)))
            (if (i32.or
                  (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "t"))
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 32))
                    (i32.and
                      (call $tomlTwoDigits
                        (i32.add (local.get $p) (i32.const 1))
                        (i32.const 0) (i32.const 23))
                      (i32.and
                        (i32.eq (call $tomlByte
                          (i32.add (local.get $p) (i32.const 3))) (i32.const ":"))
                        (call $tomlTwoDigits
                          (i32.add (local.get $p) (i32.const 4))
                          (i32.const 0) (i32.const 59))))))
              (then
                (local.set $date (i32.const 1))
                (local.set $time (i32.const 1))
                (local.set $q (i32.add (local.get $p) (i32.const 1))))
              (else
                (if (call $tomlIsValueEnd (local.get $p))
                  (then
                    (global.set $ptr (local.get $p))
                    (call $emitTok
                      (enum.get $Token.string.special)
                      (local.get $lhs) (global.get $ptr))
                    (br $next))))))
          (else
            (local.set $time (i32.const 1))
            (local.set $q (local.get $lhs))))

        (if (local.get $time)
          (then
            (local.set $valid (i32.and
              (call $tomlTwoDigits
                (local.get $q) (i32.const 0) (i32.const 23))
              (i32.and
                (i32.eq (call $tomlByte
                  (i32.add (local.get $q) (i32.const 2))) (i32.const ":"))
                (call $tomlTwoDigits
                  (i32.add (local.get $q) (i32.const 3))
                  (i32.const 0) (i32.const 59)))))
            (if (local.get $valid)
              (then
                (local.set $p (i32.add (local.get $q) (i32.const 5)))
                (local.set $r (i32.const 0))
                (if (i32.and
                      (i32.eq (call $tomlByte (local.get $p)) (i32.const ":"))
                      (call $tomlTwoDigits
                        (i32.add (local.get $p) (i32.const 1))
                        (i32.const 0) (i32.const 60)))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 3)))
                    (local.set $r (i32.const 1))))
                (if (i32.and
                      (local.get $r)
                      (i32.and
                        (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                        (i32.and
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const "."))
                          (call $lexIsDigit (i32.load8_u offset=1 (local.get $p))))))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (block $fractionDone
                      (loop $fraction
                        (br_if $fractionDone (i32.ge_u (local.get $p) (global.get $end)))
                        (br_if $fractionDone
                          (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                        (local.set $p (i32.add (local.get $p) (i32.const 1)))
                        (br $fraction)))))
                (if (local.get $date)
                  (then
                    (local.set $c (call $tomlByte (local.get $p)))
                    (if (i32.eq
                          (i32.or (local.get $c) (i32.const 32))
                          (i32.const "z"))
                      (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
                      (else
                        (if (i32.and
                              (i32.or
                                (i32.eq (local.get $c) (i32.const "+"))
                                (i32.eq (local.get $c) (i32.const "-")))
                              (i32.and
                                (call $tomlTwoDigits
                                  (i32.add (local.get $p) (i32.const 1))
                                  (i32.const 0) (i32.const 23))
                                (i32.and
                                  (i32.eq (call $tomlByte
                                    (i32.add (local.get $p) (i32.const 3))) (i32.const ":"))
                                  (call $tomlTwoDigits
                                    (i32.add (local.get $p) (i32.const 4))
                                    (i32.const 0) (i32.const 59)))))
                          (then (local.set $p
                            (i32.add (local.get $p) (i32.const 6)))))))))
                (if (call $tomlIsValueEnd (local.get $p))
                  (then
                    (global.set $ptr (local.get $p))
                    (call $emitTok
                      (enum.get $Token.string.special)
                      (local.get $lhs) (global.get $ptr))
                    (br $next)))))))

        ;; Radix integers are unsigned and require at least one base digit.
        (local.set $base (i32.const 0))
        (if (i32.and
              (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end))
              (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "0")))
          (then
            (local.set $c (i32.load8_u offset=1 (local.get $lhs)))
            (if (i32.eq (local.get $c) (i32.const "x"))
              (then (local.set $base (i32.const 16))))
            (if (i32.eq (local.get $c) (i32.const "o"))
              (then (local.set $base (i32.const 8))))
            (if (i32.eq (local.get $c) (i32.const "b"))
              (then (local.set $base (i32.const 2))))))
        (if (local.get $base)
          (then
            (local.set $q (i32.add (local.get $lhs) (i32.const 2)))
            (local.set $p (call $tomlScanDigits (local.get $q) (local.get $base)))
            (if (i32.gt_u (local.get $p) (local.get $q))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok
                  (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (br $next)))))

        ;; Decimal integers and floats reject leading zeroes, trailing
        ;; underscores, incomplete fractions, and incomplete exponents.
        (local.set $p (local.get $lhs))
        (if (i32.and
              (i32.lt_u (local.get $p) (global.get $end))
              (i32.or
                (i32.eq (i32.load8_u (local.get $p)) (i32.const "+"))
                (i32.eq (i32.load8_u (local.get $p)) (i32.const "-"))))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (if (i32.and
              (i32.lt_u (local.get $p) (global.get $end))
              (call $lexIsDigit (i32.load8_u (local.get $p))))
          (then
            (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "0"))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
              (else (local.set $p
                (call $tomlScanDigits (local.get $p) (i32.const 10)))))
            (if (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                  (i32.and
                    (i32.eq (i32.load8_u (local.get $p)) (i32.const "."))
                    (call $lexIsDigit (i32.load8_u offset=1 (local.get $p)))))
              (then (local.set $p
                (call $tomlScanDigits
                  (i32.add (local.get $p) (i32.const 1)) (i32.const 10)))))
            (local.set $c (call $tomlByte (local.get $p)))
            (if (i32.eq
                  (i32.or (local.get $c) (i32.const 32))
                  (i32.const "e"))
              (then
                (local.set $q (i32.add (local.get $p) (i32.const 1)))
                (local.set $c (call $tomlByte (local.get $q)))
                (if (i32.or
                      (i32.eq (local.get $c) (i32.const "+"))
                      (i32.eq (local.get $c) (i32.const "-")))
                  (then (local.set $q
                    (i32.add (local.get $q) (i32.const 1)))))
                (local.set $r (call $tomlScanDigits (local.get $q) (i32.const 10)))
                (if (i32.gt_u (local.get $r) (local.get $q))
                  (then (local.set $p (local.get $r))))))
            (global.set $ptr (local.get $p))
            (call $emitTok
              (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Malformed atoms remain plain and stop before TOML punctuation.
        (global.set $ptr (local.get $lhs))
        (block $atomDone
          (loop $atom
            ;; the shared terminators cover $end, whitespace, `#`, `,`, `]`,
            ;; and `}`; a plain atom also stops before the remaining punctuation
            (br_if $atomDone (call $tomlIsValueEnd (global.get $ptr)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $atomDone (i32.eq (local.get $c) (i32.const "=")))
            (br_if $atomDone (i32.eq (local.get $c) (i32.const ".")))
            (br_if $atomDone (i32.eq (local.get $c) (i32.const 34)))
            (br_if $atomDone (i32.eq (local.get $c) (i32.const 39)))
            (br_if $atomDone (i32.eq (local.get $c) (i32.const "[")))
            (br_if $atomDone (i32.eq (local.get $c) (i32.const "{")))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $atom)))
        (if (i32.eq (global.get $ptr) (local.get $lhs))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok
          (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next)))
    ;; publish the active shared-stack prefix for live state capture
    (global.set $liveSharedBytes (local.get $depth)))

  ;; Resume toml stream mode 13: a multi-line string body left open at the
  ;; previous chunk end, literal when $streamA is the single quote and basic
  ;; otherwise. Returns 1 when the body consumed the whole chunk, 0 when the
  ;; language lexer should continue from $ptr. When the whole chunk is string
  ;; body $hlToml does not run, so $liveSharedBytes keeps the depth restored
  ;; for this line, which is still the live shared-stack prefix.
  (func $tomlStreamResume (result i32)
    (local $status i32)
    (if (i32.eq (global.get $streamA) (i32.const 39))
      (then
        (local.set $status
          (call $tomlLiteralStringBody (global.get $streamHl) (global.get $ptr))))
      (else
        (local.set $status
          (call $tomlBasicStringBody
            (i32.const 1) (global.get $streamHl) (global.get $ptr)
            (global.get $streamB)))))
    (if (i32.and
          (i32.ne (local.get $status) (i32.const 1))
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (global.set $streamB (i32.eq (local.get $status) (i32.const 2)))
        (return (i32.const 1))))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))
)
