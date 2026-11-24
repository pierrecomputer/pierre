(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")

  ;; The code point at $p, bounded by $end. Four-byte characters return
  ;; 0x10000: APL glyphs are all in the Basic Multilingual Plane.
  (func $aplCodepoint (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (call $templateByte (local.get $p)))
    (if (i32.lt_u (local.get $c) (i32.const 0xc0)) (then (return (local.get $c))))
    (if (i32.ge_u (local.get $c) (i32.const 0xf0)) (then (return (i32.const 0x10000))))
    (if (i32.lt_u (local.get $c) (i32.const 0xe0))
      (then (return (i32.or (i32.shl (i32.and (local.get $c) (i32.const 31)) (i32.const 6))
        (i32.and (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 63))))))
    (i32.or
      (i32.or (i32.shl (i32.and (local.get $c) (i32.const 15)) (i32.const 12))
        (i32.shl (i32.and (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 63)) (i32.const 6)))
      (i32.and (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const 63))))

  ;; Name characters: ASCII letters, `_`, `∆`, `⍙`, and letters below the
  ;; glyph blocks (U+00C0 to U+1FFF) except `×` and `÷`.
  (func $aplIsLetter (param $cp i32) (result i32)
    (i32.or
      (i32.or
        (i32.le_u (i32.sub (i32.or (local.get $cp) (i32.const 32)) (i32.const "a")) (i32.const 25))
        (i32.eq (local.get $cp) (i32.const "_")))
      (i32.or
        (i32.or (i32.eq (local.get $cp) (i32.const 0x2206)) (i32.eq (local.get $cp) (i32.const 0x2359)))
        (i32.and
          (i32.le_u (i32.sub (local.get $cp) (i32.const 0xc0)) (i32.const 0x1f3f))
          (i32.and (i32.ne (local.get $cp) (i32.const 0xd7)) (i32.ne (local.get $cp) (i32.const 0xf7)))))))

  ;; Advance $ptr over name characters and digits.
  (func $aplScanName
    (local $c i32)
    (block $done
      (loop $l
        (local.set $c (call $templateByte (global.get $ptr)))
        (if (i32.lt_u (local.get $c) (i32.const 0x80))
          (then
            (br_if $done (i32.eqz (i32.or (call $lexIsDigit (local.get $c)) (call $aplIsLetter (local.get $c)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br_if $done (i32.eqz (call $aplIsLetter (call $aplCodepoint (global.get $ptr)))))
        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (br $l))))

  ;; Whether $p starts `¯` (C2 AF).
  (func $aplIsHigh (param $p i32) (result i32)
    (i32.and
      (i32.eq (call $templateByte (local.get $p)) (i32.const 0xc2))
      (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 0xaf))))

  ;; $mid is 0 at a statement start: a line start, or after `⋄` or a label.
  (func $hlApl
    (local $c i32)
    (local $cp i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $hl i32)
    (local $first i32)
    (local $mid i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $mid (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $cp (call $aplCodepoint (local.get $lhs)))
        (local.set $first (i32.eqz (local.get $mid)))
        (local.set $mid (i32.const 1))
        (if (i32.eq (local.get $cp) (i32.const 0x235d))
          (then
            (call $lexLineComment (i32.const 3) (enum.get $Token.comment))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const 34)))
          (then
            (call $lexRawString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        ;; a number: digits, `.`, `¯` signs, and `E` or `J` before a digit or `¯`
        (if (i32.or (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const ".")) (call $aplIsHigh (local.get $lhs)))
                (call $lexIsDigit (call $templateByte (i32.add (local.get $lhs)
                  (select (i32.const 1) (i32.const 2) (i32.eq (local.get $c) (i32.const "."))))))))
          (then
            (local.set $p (local.get $lhs))
            (block $numDone
              (loop $num
                (local.set $c (call $templateByte (local.get $p)))
                (if (i32.or (call $lexIsDigit (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $num)))
                (if (call $aplIsHigh (local.get $p))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 2)))
                    (br $num)))
                (br_if $numDone
                  (i32.eqz (i32.or (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "e"))
                    (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "j")))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $num (i32.or (call $lexIsDigit (call $templateByte (local.get $p))) (call $aplIsHigh (local.get $p))))
                (local.set $p (i32.sub (local.get $p) (i32.const 1)))))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $aplIsLetter (local.get $cp))
          (then
            (call $aplScanName)
            (local.set $hl (enum.get $Token.none))
            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
            (if (i32.and (local.get $first) (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $hl (enum.get $Token.label))
                (local.set $mid (i32.const 0))))
            ;; `name ← {` defines a dfn
            (if (i32.eq (call $aplCodepoint (local.get $p)) (i32.const 0x2190))
              (then
                (if (i32.eq (call $templateByte (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 3)))) (i32.const "{"))
                  (then (local.set $hl (enum.get $Token.function.definition))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        ;; `:If` and other control words follow a blank or start a statement
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (local.set $hl (enum.get $Token.keyword.control))
            (if (i32.or (local.get $first) (call $lexIsSpace (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))
              (then
                (if (i32.le_u (i32.sub (i32.or (call $templateByte (global.get $ptr)) (i32.const 32)) (i32.const "a")) (i32.const 25))
                  (then (call $aplScanName)))))))
        (if (i32.eq (local.get $cp) (i32.const 0x2395))
          (then
            (local.set $hl (enum.get $Token.constant.builtin))
            (if (call $aplIsLetter (call $templateByte (global.get $ptr)))
              (then (call $aplScanName)))))
        (if (i32.or (i32.eq (local.get $cp) (i32.const 0x235e)) (i32.eq (local.get $cp) (i32.const 0x236c)))
          (then (local.set $hl (enum.get $Token.constant.builtin))))
        (if (i32.or (i32.or (i32.eq (local.get $cp) (i32.const 0x237a)) (i32.eq (local.get $cp) (i32.const 0x2375)))
              (i32.eq (local.get $cp) (i32.const 0x2207)))
          (then (local.set $hl (enum.get $Token.variable.special))))
        (if (i32.eqz (local.get $hl))
          (then
            (if (i32.or (i32.le_u (i32.sub (local.get $cp) (i32.const 0x2190)) (i32.const 0xa6f))
                  (i32.or (i32.eq (local.get $cp) (i32.const 0xd7)) (i32.eq (local.get $cp) (i32.const 0xf7))))
              (then (local.set $hl (enum.get $Token.operator))))
            (if (i32.or (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
                  (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const "."))))
              (then (local.set $hl (enum.get $Token.operator))))
            (if (i32.eq (local.get $cp) (i32.const 0x2190))
              (then (local.set $hl (enum.get $Token.keyword))))
            (if (i32.eq (local.get $cp) (i32.const 0x2192))
              (then (local.set $hl (enum.get $Token.keyword.control))))
            ;; operators that take functions: `¨ ⍨ ∘ ⍣ ⍤ ⍥ ⌸ ⌺ @ & / \ ⌿ ⍀`
            (if (i32.or
                  (i32.or
                    (i32.or (i32.eq (local.get $cp) (i32.const 0xa8)) (i32.eq (local.get $cp) (i32.const 0x2218)))
                    (i32.or
                      (i32.le_u (i32.sub (local.get $cp) (i32.const 0x2363)) (i32.const 2))
                      (i32.eq (local.get $cp) (i32.const 0x2368))))
                  (i32.or
                    (i32.or
                      (i32.eq (i32.and (local.get $cp) (i32.const -3)) (i32.const 0x2338))
                      (i32.le_u (i32.sub (local.get $cp) (i32.const 0x233f)) (i32.const 1)))
                    (byteset.get "&/@\5c" (local.get $c))))
              (then (local.set $hl (enum.get $Token.keyword.operator))))
            (if (byteset.get "()[]{}" (local.get $c))
              (then (local.set $hl (enum.get $Token.punctuation.bracket))))
            (if (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $cp) (i32.const 0x22c4)))
              (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
            (if (i32.eq (local.get $cp) (i32.const 0x22c4))
              (then (local.set $mid (i32.const 0))))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
