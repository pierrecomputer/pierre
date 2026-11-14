(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./ini.wat")
  (import "./json.wat")

  ;; Hjson: JSON with `#`, `//`, and `/* */` comments, unquoted keys, optional
  ;; commas, `'''` strings, and quoteless strings that run to the line end.
  ;; A quoteless value that is only a number or literal, before a comma, a
  ;; closing bracket, a comment, or the line end, is that literal.
  ;; $arrays keeps one bit per open container, set for an array, so a line
  ;; break or `,` inside an object or at the root expects a key again.
  ;; Containers deeper than 64 levels count as objects.
  (func $hlHjson
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $hl i32)
    (local $arrays i64)
    (local $value i32) ;; 1 where a key cannot start
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $value (i32.wrap_i64 (i64.and (local.get $arrays) (i64.const 1))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $p (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $p) (i32.const "/"))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $p) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "[")))
              (then
                (local.set $value (i32.eq (local.get $c) (i32.const "[")))
                (local.set $arrays
                  (i64.or
                    (i64.shl (local.get $arrays) (i64.const 1))
                    (i64.extend_i32_u (local.get $value)))))
              (else
                (local.set $arrays (i64.shr_u (local.get $arrays) (i64.const 1)))
                (local.set $value (i32.const 1))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (local.set $value
              (i32.or
                (i32.eq (local.get $c) (i32.const ":"))
                (i32.wrap_i64 (i64.and (local.get $arrays) (i64.const 1)))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (if
              (i32.and
                (i32.eq (local.get $p) (i32.const 39))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const 39)))
              (then
                ;; a `'''` string runs to the next `'''`, across lines
                (local.set $p (i32.add (local.get $lhs) (i32.const 3)))
                (block $closed
                  (loop $find
                    (local.set $p (call $lexFindByte (local.get $p) (i32.const 39)))
                    (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
                      (then
                        (global.set $ptr (global.get $end))
                        (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                        (call $streamSetFixed32 (i32.const "'''") (i32.const 3) (enum.get $Token.string))
                        (br $closed)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $find (i32.ne (i32.load16_u (local.get $p)) (i32.const "''")))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))))
                (local.set $value (i32.const 1))
                (br $next)))
            ;; a quoted string where a key can start is the key
            (call $lexString
              (local.get $c)
              (i32.const 0)
              (select (enum.get $Token.string) (enum.get $Token.property.json_key) (local.get $value)))
            (local.set $value (i32.const 1))
            (br $next)))
        (if (i32.eqz (local.get $value))
          (then
            ;; an unquoted key ends at a blank or a JSON punctuation byte
            (block $keyDone
              (loop $key
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $keyDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $key (i32.eqz (byteset.get "\09\0a\0d ,:[]{}" (local.get $c))))))
            (call $emitTok (enum.get $Token.property.json_key) (local.get $lhs) (global.get $ptr))
            (local.set $value (i32.const 1))
            (br $next)))
        ;; a number or literal, else a quoteless string to the line end
        (local.set $hl (enum.get $Token.none))
        (if (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
          (then
            (call $scanIdentRun (i32.const 0))
            (local.set $hl (call $jsonWordHl (local.get $lhs) (global.get $ptr) (i32.const 0)))))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (call $lexIsDigit (local.get $p))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "-"))))
            (call $lexScanNumber)
            ;; `1.2.3` is text
            (local.set $p
              (call $scanFindSpecial (local.get $lhs) (global.get $ptr) (i32.const ".") (i32.const 0) (i32.const 0)))
            (local.set $hl
              (select
                (enum.get $Token.none)
                (enum.get $Token.number)
                (i32.lt_u
                  (call $scanFindSpecial
                    (i32.add (local.get $p) (i32.const 1))
                    (global.get $ptr)
                    (i32.const ".")
                    (i32.const 0)
                    (i32.const 0))
                  (global.get $ptr))))))
        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
        (local.set $c (call $templateByte (local.get $p)))
        (local.set $p (call $templateByte (i32.add (local.get $p) (i32.const 1))))
        (if
          (i32.and
            (i32.ne (local.get $hl) (enum.get $Token.none))
            (i32.or
              (byteset.get "\00\0a\0d#,]}" (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "/"))
                (i32.or (i32.eq (local.get $p) (i32.const "/")) (i32.eq (local.get $p) (i32.const "*"))))))
          (then (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))
          (else
            (global.set $ptr (local.get $lhs))
            (call $scanToLineEnd)
            (local.set $p (global.get $ptr))
            (local.set $p (call $iniTrim (local.get $lhs) (local.get $p)))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))))
        (local.set $value (i32.const 1))
        (br $next))))
)
