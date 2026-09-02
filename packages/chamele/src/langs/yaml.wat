(module
  (import "../common.wat")

  ;; The capture for a plain scalar spanning [$lhs,$rhs). YAML's untagged
  ;; constants are `~` and the case-insensitive words true, false, yes, no, on,
  ;; off, and null, so every match is 1..5 bytes: a length gate rejects longer
  ;; scalars before any byte compare, and each length then tests only its own
  ;; words. ORing 0x20 into a byte lowercases an ASCII letter, which is what
  ;; makes the compares case-insensitive.
  (func $yamlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 1)) (i32.const 4))
      (then (return (enum.get $Token.string))))
    (if (i32.eq (local.get $n) (i32.const 1))
      (then (return (select
        (enum.get $Token.constant.builtin) (enum.get $Token.string)
        (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "~"))))))
    (if (i32.eq (local.get $n) (i32.const 5))
      (then (return (select
        (enum.get $Token.boolean) (enum.get $Token.string)
        (i64.eq
          (i64.and
            (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020))
            (i64.const 0xffffffffff))
          (i64.const "false"))))))
    ;; wide loads stay inside the buffer slack, so a short word is safe to read
    (local.set $w (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)))
    (if (i32.eq (local.get $n) (i32.const 4))
      (then
        (if (i32.eq (local.get $w) (i32.const "true"))
          (then (return (enum.get $Token.boolean))))
        (return (select
          (enum.get $Token.constant.builtin) (enum.get $Token.string)
          (i32.eq (local.get $w) (i32.const "null"))))))
    (if (i32.eq (local.get $n) (i32.const 3))
      (then
        (local.set $w (i32.and (local.get $w) (i32.const 0xffffff)))
        (return (select
          (enum.get $Token.boolean) (enum.get $Token.string)
          (i32.or
            (i32.eq (local.get $w) (i32.const "yes"))
            (i32.eq (local.get $w) (i32.const "off")))))))
    (local.set $w (i32.and (local.get $w) (i32.const 0xffff)))
    (select
      (enum.get $Token.boolean) (enum.get $Token.string)
      (i32.or
        (i32.eq (local.get $w) (i32.const "no"))
        (i32.eq (local.get $w) (i32.const "on")))))

  (func $yamlSkipHorizontal (param $p i32) (result i32)
    (block $done
      (loop $space
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (i32.or
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 9)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $space)))
    (local.get $p))

  (func $yamlAfterLine (param $p i32) (result i32)
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (if (i32.and
              (i32.lt_u (local.get $p) (global.get $end))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 10)))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
    (local.get $p))

  ;; Leading blanks of the line containing $p. The walk back can cross the start
  ;; of a sub-range, which only reads host bytes and never emits them.
  (func $yamlLineIndent (param $p i32) (result i32)
    (block $done
      (loop $back
        (br_if $done (i32.le_u (local.get $p) (global.get $srcBase)))
        (br_if $done (i32.or
          (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 10))
          (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 13))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $back)))
    (i32.sub (call $yamlSkipHorizontal (local.get $p)) (local.get $p)))

  ;; `|` and `>` open a block scalar: every following line that is blank or
  ;; indented deeper than the introducing line is literal text, so YAML rules
  ;; must not apply to it. Returns 1 when a block scalar was consumed, and 0
  ;; when the indicator was something else and the caller should carry on.
  (func $yamlBlockScalar (result i32)
    (local $bodyEnd i32)
    (local $c i32)
    (local $col i32)
    (local $indent i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
    ;; optional chomping (`+`/`-`) and explicit indentation (`1`..`9`)
    (block $modDone
      (loop $mod
        (br_if $modDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $modDone (i32.eqz (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "+"))
                  (i32.eq (local.get $c) (i32.const "-")))
          (i32.le_u (i32.sub (local.get $c) (i32.const "1")) (i32.const 8)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $mod)))
    ;; the header has to end the line; anything else is an ordinary delimiter
    (local.set $lineEnd (call $yamlSkipHorizontal (local.get $p)))
    (if (i32.and
          (i32.lt_u (local.get $lineEnd) (global.get $end))
          (i32.and
            (i32.ne (i32.load8_u (local.get $lineEnd)) (i32.const 10))
            (i32.ne (i32.load8_u (local.get $lineEnd)) (i32.const 13))))
      (then (return (i32.const 0))))
    (local.set $indent (call $yamlLineIndent (local.get $lhs)))
    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (local.get $p))
    (call $emitGap (local.get $p) (local.get $lineEnd))
    (global.set $ptr (call $yamlAfterLine (local.get $lineEnd)))
    (call $emitGap (local.get $lineEnd) (global.get $ptr))
    (local.set $bodyEnd (global.get $ptr))
    (block $scanDone
      (loop $scan
        (br_if $scanDone (i32.ge_u (local.get $bodyEnd) (global.get $end)))
        (local.set $col (call $yamlSkipHorizontal (local.get $bodyEnd)))
        (local.set $lineEnd
          (call $lexFindEither (local.get $col) (i32.const 10) (i32.const 13)))
        ;; a blank line always belongs to the body; a filled one only when it is
        ;; indented deeper than the line that opened the block
        (br_if $scanDone (i32.and
          (i32.ne (local.get $col) (local.get $lineEnd))
          (i32.le_u (i32.sub (local.get $col) (local.get $bodyEnd)) (local.get $indent))))
        (local.set $bodyEnd (call $yamlAfterLine (local.get $lineEnd)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (global.get $ptr) (local.get $bodyEnd))
    (global.set $ptr (local.get $bodyEnd))
    (if (i32.and
          (global.get $streaming)
          (i32.eq (global.get $ptr) (global.get $end)))
      (then
        (global.set $streamMode (i32.const 11))
        (global.set $streamA (local.get $indent))))
    (i32.const 1))

  ;; Continue a block scalar until the first non-blank line that is not more
  ;; indented than its header. Returns one when the whole chunk remains scalar.
  (func $yamlStreamResume (result i32)
    (local $bodyEnd i32)
    (local $col i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local.set $lhs (global.get $ptr))
    (local.set $bodyEnd (global.get $ptr))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $bodyEnd) (global.get $end)))
        (local.set $col (call $yamlSkipHorizontal (local.get $bodyEnd)))
        (local.set $lineEnd
          (call $lexFindEither (local.get $col) (i32.const 10) (i32.const 13)))
        (br_if $done (i32.and
          (i32.ne (local.get $col) (local.get $lineEnd))
          (i32.le_u
            (i32.sub (local.get $col) (local.get $bodyEnd))
            (global.get $streamA))))
        (local.set $bodyEnd (call $yamlAfterLine (local.get $lineEnd)))
        (br $scan)))
    (call $emitTok
      (enum.get $Token.string) (local.get $lhs) (local.get $bodyEnd))
    (global.set $ptr (local.get $bodyEnd))
    (if (i32.eq (global.get $ptr) (global.get $end))
      (then (return (i32.const 1))))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))

  (func $hlYaml
    (local $after i32)
    (local $c i32)
    (local $commentOk i32)
    (local $first i32)
    (local $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local $quote i32)
    (local.set $first (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $commentOk (i32.or
          (local.get $first)
          (i32.ne (global.get $ptr) (local.get $lhs))))
        (local.set $first (i32.const 0))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))

        (if (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (local.get $commentOk))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $quote (local.get $c))
            ;; Probe the closing quote so quoted mapping keys get property. The
            ;; probe hops from quote to backslash instead of walking the body,
            ;; and crosses line breaks because the scalar itself may.
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $quoteDone
              (loop $q
                (global.set $ptr (call $scanFindSpecial
                  (global.get $ptr) (global.get $end) (local.get $quote)
                  (i32.eq (local.get $quote) (i32.const 34)) (i32.const 0)))
                (br_if $quoteDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $quoteDone (i32.eq (local.get $c) (local.get $quote)))
                ;; a backslash: step over the byte it escapes
                (if (i32.lt_u (global.get $ptr) (global.get $end))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (br $q)))
            (local.set $after (call $yamlSkipHorizontal (global.get $ptr)))
            (local.set $hl (select
              (enum.get $Token.property) (enum.get $Token.string)
              (i32.and (i32.lt_u (local.get $after) (global.get $end))
                       (i32.eq (i32.load8_u (local.get $after)) (i32.const ":")))))
            (global.set $ptr (local.get $lhs))
            (if (i32.eq (local.get $quote) (i32.const 34))
              (then (call $lexString (local.get $quote) (i32.const 1) (local.get $hl)))
              (else (call $lexRawString (local.get $quote) (i32.const 1) (local.get $hl))))
            (br $next)))

        (if (i32.or
              (i32.eq (local.get $c) (i32.const "&"))
              (i32.or
                (i32.eq (local.get $c) (i32.const "*"))
                (i32.eq (local.get $c) (i32.const "!"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and
              (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
              (i32.or
                (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffffff)) (i32.const "---"))
                (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffffff)) (i32.const "..."))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+"))
                        (i32.eq (local.get $c) (i32.const "-")))
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                  (call $lexIsDigit (i32.load8_u offset=1 (global.get $ptr))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.or
              (i32.le_u (i32.sub (local.get $c) (i32.const "[")) (i32.const 2))
              (i32.or (i32.eq (local.get $c) (i32.const "{"))
                      (i32.eq (local.get $c) (i32.const "}"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "|"))
                    (i32.eq (local.get $c) (i32.const ">")))
          (then
            (if (call $yamlBlockScalar)
              (then (br $next)))))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const ","))
              (i32.or (i32.eq (local.get $c) (i32.const ":"))
                (i32.or (i32.eq (local.get $c) (i32.const "?"))
                  (i32.or (i32.eq (local.get $c) (i32.const "|"))
                    (i32.or (i32.eq (local.get $c) (i32.const ">"))
                            (i32.eq (local.get $c) (i32.const "-")))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Plain scalar: stop at YAML structure or whitespace.
        (block $wordDone
          (loop $word
            (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $wordDone (call $lexIsSpace (local.get $c)))
            (br_if $wordDone (i32.or
              (i32.eq (local.get $c) (i32.const ":"))
                (i32.or (i32.eq (local.get $c) (i32.const ","))
                  (i32.or (i32.eq (local.get $c) (i32.const "["))
                    (i32.or (i32.eq (local.get $c) (i32.const "]"))
                      (i32.or (i32.eq (local.get $c) (i32.const "{"))
                              (i32.eq (local.get $c) (i32.const "}"))))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $word)))
        (if (i32.eq (global.get $ptr) (local.get $lhs))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $p (call $yamlSkipHorizontal (global.get $ptr)))
        (local.set $hl (select
          (enum.get $Token.property)
          (call $yamlWordHl (local.get $lhs) (global.get $ptr))
          (i32.and (i32.lt_u (local.get $p) (global.get $end))
                   (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
