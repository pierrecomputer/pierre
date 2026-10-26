(module
  (import "../common.wat")

  (func $hlJson
    (call $hlJsonImpl (i32.const 0)))

  (func $hlJson5
    (call $hlJsonImpl (i32.const 1)))

  (func $hlJsonl
    (call $hlJsonImpl (i32.const 2)))

  ;; $dialect: 0 JSON (with JSONC comments), 1 JSON5, 2 JSONL.
  ;; JSON5 adds single-quoted strings, identifier keys, hex numbers, numbers
  ;; with `+` or a leading dot, and Infinity/NaN. JSONL starts a new value on
  ;; every line, so an unbalanced record cannot affect the lines after it.
  (func $hlJsonImpl (param $dialect i32)
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $depth i32)
    (local $expectKey i32)
    (local $json5 i32)
    (local $open i32) ;; a string still open at the chunk end: quote | hl << 8
    (call $lexEmitLeadingContinuation)
    (local.set $json5 (i32.eq (local.get $dialect) (i32.const 1)))
    (if (local.get $open)
      (then
        (local.set $open
          (call $jsonString
            (i32.shr_u (local.get $open) (i32.const 8))
            (i32.and (local.get $open) (i32.const 0xff))
            (local.get $json5)
            (global.get $ptr)))))
    (block $done
      (loop $next
        ;; whitespace gap
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (if (i32.eq (local.get $dialect) (i32.const 2))
          (then
            (block $lineDone
              (loop $line
                (br_if $lineDone (i32.ge_u (local.get $gap) (global.get $ptr)))
                (if (i32.eq (i32.load8_u (local.get $gap)) (i32.const 10))
                  (then
                    (local.set $depth (i32.const 0))
                    (local.set $expectKey (i32.const 0))
                    (br $lineDone)))
                (local.set $gap (i32.add (local.get $gap) (i32.const 1)))
                (br $line)))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        ;; string (object key or value)
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $open
              (call $jsonString
                (select
                  (enum.get $Token.property.json_key)
                  (enum.get $Token.string)
                  (local.get $expectKey))
                (local.get $c)
                (local.get $json5)
                (local.get $lhs)))
            (local.set $expectKey (i32.const 0))
            (br $next)))

        ;; number
        (if
          (i32.or
            (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
            (i32.eq (local.get $c) (i32.const "-")))
          (then
            (if (local.get $json5)
              (then (call $emitTok (call $json5Number) (local.get $lhs) (global.get $ptr)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $jsonNumber)
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; containers and separators
        (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "[")))
          (then
            (if (i32.lt_u (local.get $depth) (i32.const 1024))
              (then
                (i32.store8
                  (i32.add (i32.const $mem.jsonStack) (local.get $depth))
                  (i32.eq (local.get $c) (i32.const "{")))))
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (local.set $expectKey (i32.eq (local.get $c) (i32.const "{")))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "}")) (i32.eq (local.get $c) (i32.const "]")))
          (then
            (if (local.get $depth)
              (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (local.set $expectKey (i32.const 0))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            ;; the next string is a key again iff the current container is an object
            (local.set $expectKey (i32.const 0))
            (if
              (i32.and
                (i32.gt_u (local.get $depth) (i32.const 0))
                (i32.le_u (local.get $depth) (i32.const 1024)))
              (then
                (local.set $expectKey
                  (i32.load8_u (i32.add (i32.const $mem.jsonStack-1) (local.get $depth))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (local.set $expectKey (i32.const 0))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        ;; JSONC comments
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (local.set $c
              (select
                (i32.load8_u offset=1 (global.get $ptr))
                (i32.const 0)
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $scanToLineEnd)
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "*"))
              (then
                (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; words: true/false -> boolean, null -> constant.builtin, else plain.
        ;; JSON5 names follow JavaScript identifiers, `\uXXXX` escapes
        ;; included, and can be object keys.
        (if
          (if (result i32)
            (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
            (then (i32.const 1))
            (else
              (if (result i32)
                (local.get $json5)
                (then
                  (i32.or
                    (call $lexIsIdentStart (local.get $c))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const 92))
                      (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "u")))))
                (else (i32.const 0)))))
          (then
            (if (local.get $json5)
              (then
                (loop $name
                  (call $scanIdentRun (i32.const "$"))
                  (if
                    (i32.and
                      (i32.eq (call $templateByte (global.get $ptr)) (i32.const 92))
                      (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "u")))
                    (then
                      (global.set $ptr
                        (call $scanHexRun (i32.add (global.get $ptr) (i32.const 2)) (i32.const 4)))
                      (br $name)))))
              (else
                (block $wordDone
                  (loop $word
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (br_if $word
                      (i32.le_u
                        (i32.sub
                          (i32.or (i32.load8_u (global.get $ptr)) (i32.const 32))
                          (i32.const "a"))
                        (i32.const 25)))))))
            (call $emitTok
              (select
                (enum.get $Token.property.json_key)
                (call $jsonWordHl (local.get $lhs) (global.get $ptr) (local.get $json5))
                (i32.and (local.get $json5) (local.get $expectKey)))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        ;; JSON5: single-quoted strings, and numbers that start with `+` or `.`
        (if (local.get $json5)
          (then
            (if (i32.eq (local.get $c) (i32.const 39))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $open
                  (call $jsonString
                    (select
                      (enum.get $Token.property.json_key)
                      (enum.get $Token.string)
                      (local.get $expectKey))
                    (local.get $c)
                    (i32.const 1)
                    (local.get $lhs)))
                (local.set $expectKey (i32.const 0))
                (br $next)))
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const "+"))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "."))
                  (i32.and
                    (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                    (i32.le_u
                      (i32.sub (i32.load8_u offset=1 (global.get $ptr)) (i32.const "0"))
                      (i32.const 9)))))
              (then
                (call $emitTok (call $json5Number) (local.get $lhs) (global.get $ptr))
                (br $next)))))

        ;; anything else: one plain byte
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next)))
    ;; publish the active stack prefix for live state capture
    (global.set $liveStackBytes (local.get $depth)))

  (func $jsonWordHl (param $lhs i32) (param $rhs i32) (param $json5 i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 4))
      (then
        (if (i32.eq (i32.load (local.get $lhs)) (i32.const "true"))
          (then (return (enum.get $Token.boolean))))
        (if (i32.eq (i32.load (local.get $lhs)) (i32.const "null"))
          (then (return (enum.get $Token.constant.builtin))))))
    (if
      (i32.and
        (i32.eq (local.get $len) (i32.const 5))
        (i32.eq (i32.load (local.get $lhs)) (i32.const "fals")))
      (then
        (if (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "e"))
          (then (return (enum.get $Token.boolean))))))
    (if
      (i32.and
        (local.get $json5)
        (i32.or
          (i32.and
            (i32.eq (local.get $len) (i32.const 8))
            (i64.eq (i64.load (local.get $lhs)) (i64.const "Infinity")))
          (i32.and
            (i32.eq (local.get $len) (i32.const 3))
            (i32.eq
              (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
              (i32.const "NaN")))))
      (then (return (enum.get $Token.constant.builtin))))
    (enum.get $Token.none))

  ;; Scan a string body from $ptr, after the opening $quote, and emit it
  ;; from $seg. `\u` and, in JSON5, `\x` escapes span the hex digits
  ;; present. Returns `$quote | $hl << 8` when an escaped line break leaves
  ;; the string open at the end of a streamed chunk, else 0. The lexer keeps
  ;; that value and resumes here, so continued lines lex escapes alike.
  (func $jsonString (param $hl i32) (param $quote i32) (param $json5 i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (block $done
      (loop $l
        ;; hop to the next quote, backslash, or line break, 16 bytes per step
        ;; constant quotes keep the scan's splat out of the loop
        (global.set $ptr
          (if (result i32) (i32.eq (local.get $quote) (i32.const 34))
            (then (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 1)))
            (else (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const 39) (i32.const 1) (i32.const 1)))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        ;; a raw line break terminates the (invalid) string leniently
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        ;; Hex escapes cover only the digits present, so a short escape cannot
        ;; swallow the closing quote. Any other escaped byte stays whole with
        ;; its UTF-8 tail, and a `\` before LF or CRLF continues the string.
        (local.set $c
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "u"))
            (i32.and (local.get $json5) (i32.eq (local.get $c) (i32.const "x"))))
          (then
            (local.set $e
              (call $utf8SpanEnd
                (call $scanHexRun
                  (i32.add (global.get $ptr) (i32.const 2))
                  (select (i32.const 4) (i32.const 2) (i32.eq (local.get $c) (i32.const "u"))))
                (global.get $end))))
          (else (local.set $e (call $lexEscapeEnd (global.get $ptr)))))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (if
          (i32.and
            (global.get $streaming)
            (i32.and
              (i32.eq (global.get $ptr) (global.get $end))
              (i32.or
                (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
                (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13)))))
          (then
            (return
              (i32.or (local.get $quote) (i32.shl (local.get $hl) (i32.const 8))))))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; A JSON5 number at $ptr: an optional sign, then `0x` hex digits,
  ;; Infinity or NaN, or a decimal with an optional leading or trailing dot.
  ;; Returns its token; a sign before another word takes that word's token.
  (func $json5Number (result i32)
    (local $c i32)
    (local $lhs i32)
    (local.set $c (i32.load8_u (global.get $ptr)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $c
          (select
            (i32.load8_u (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (global.get $ptr) (global.get $end))))))
    (local.set $lhs (global.get $ptr))
    (if (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
      (then
        (call $scanIdentRun (i32.const "$"))
        (return (call $jsonWordHl (local.get $lhs) (global.get $ptr) (i32.const 1)))))
    (if
      (i32.and
        (i32.eq (local.get $c) (i32.const "0"))
        (i32.and
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (i32.eq (i32.or (i32.load8_u offset=1 (global.get $ptr)) (i32.const 32)) (i32.const "x"))))
      (then
        (global.set $ptr
          (call $scanHexRun
            (i32.add (global.get $ptr) (i32.const 2))
            (i32.sub (global.get $end) (global.get $ptr))))
        (return (enum.get $Token.number))))
    (call $jsonNumber)
    (enum.get $Token.number))

  ;; loose number tail: digits, dot, exponent
  (func $jsonNumber
    (local $c i32)
    (local $prev i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (block $consume
          (br_if $consume (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (br_if $consume (i32.eq (local.get $c) (i32.const ".")))
          (br_if $consume (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "e")))
          (if
            (i32.and
              (i32.or
                (i32.eq (local.get $c) (i32.const "+"))
                (i32.eq (local.get $c) (i32.const "-")))
              (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e")))
            (then (br $consume)))
          (br $done))
        (local.set $prev (local.get $c))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))
)
