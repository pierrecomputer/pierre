(module
  (import "../common.wat")

  (func $hlJson
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $depth i32)
    (local $expectKey i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; whitespace gap
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        ;; string (object key or value)
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $jsonString (select
              (enum.get $Token.property.json_key)
              (enum.get $Token.string)
              (local.get $expectKey)))
            (local.set $expectKey (i32.const 0))
            (br $next)))

        ;; number
        (if (i32.or
              (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
              (i32.eq (local.get $c) (i32.const "-")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $jsonNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; containers and separators
        (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "[")))
          (then
            (if (i32.lt_u (local.get $depth) (i32.const 1024))
              (then (i32.store8 (i32.add (i32.const $mem.jsonStack) (local.get $depth))
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
            (if (i32.and (i32.gt_u (local.get $depth) (i32.const 0))
                         (i32.le_u (local.get $depth) (i32.const 1024)))
              (then (local.set $expectKey (i32.load8_u
                (i32.add (i32.const $mem.jsonStack-1) (local.get $depth))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (local.set $expectKey (i32.const 0))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; JSONC comments
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (local.set $c (select
              (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
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

        ;; words: true/false -> boolean, null -> constant.builtin, else plain
        (if (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
          (then
            (block $wordDone
              (loop $word
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $word (i32.le_u
                  (i32.sub (i32.or (i32.load8_u (global.get $ptr)) (i32.const 32)) (i32.const "a"))
                  (i32.const 25)))))
            (call $emitTok (call $jsonWordHl (local.get $lhs) (global.get $ptr))
              (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; anything else: one plain byte
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next)))
    ;; publish the active shared-stack prefix for live state capture
    (global.set $liveSharedBytes (local.get $depth)))

  (func $jsonWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 4))
      (then
        (if (i32.eq (i32.load (local.get $lhs)) (i32.const "true"))
          (then (return (enum.get $Token.boolean))))
        (if (i32.eq (i32.load (local.get $lhs)) (i32.const "null"))
          (then (return (enum.get $Token.constant.builtin))))))
    (if (i32.and (i32.eq (local.get $len) (i32.const 5))
                 (i32.eq (i32.load (local.get $lhs)) (i32.const "fals")))
      (then
        (if (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "e"))
          (then (return (enum.get $Token.boolean))))))
    (enum.get $Token.none))

  ;; string body starting at the opening quote; emits the fragments itself so
  ;; `\uXXXX` and 2-byte escapes get their own string.escape spans
  (func $jsonString (param $hl i32)
    (local $seg i32)
    (local $c i32)
    (local $e i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        ;; hop to the next quote, backslash, or line break, 16 bytes per step
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 1) (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        ;; a raw line break terminates the (invalid) string leniently
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        ;; `\u`: span covers `\u` plus the hex digits actually present
        ;; (up to 4) - a short escape must not swallow the closing quote.
        ;; Any other escaped byte stays whole with its UTF-8 tail - a span
        ;; boundary must never split a code point - and a `\` before LF or
        ;; CRLF continues the string on the next line
        (if (i32.and
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
              (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (i32.const "u")))
          (then (local.set $e (call $utf8SpanEnd
            (call $scanHexRun (i32.add (global.get $ptr) (i32.const 2)) (i32.const 4))
            (global.get $end))))
          (else (local.set $e (call $lexEscapeEnd (global.get $ptr)))))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (call $jsonStringOpenAtChunkEnd (local.get $hl))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr)))

  ;; A string whose escaped line break ends the chunk stays open: hand it to
  ;; the shared string mode so the next chunk resumes the body instead of
  ;; lexing the continuation line as json
  (func $jsonStringOpenAtChunkEnd (param $hl i32)
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.or
              (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
              (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13)))))
      (then
        (global.set $streamMode (i32.const 2))
        (global.set $streamA (i32.const 34))
        (global.set $streamB (i32.const 0))
        (global.set $streamHl (local.get $hl)))))

  ;; loose number tail: digits, dot, exponent; first character already consumed
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
          (if (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e")))
            (then (br $consume)))
          (br $done))
        (local.set $prev (local.get $c))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))
)
