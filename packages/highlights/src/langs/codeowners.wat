(module
  (import "../common.wat")

  ;; Emit the run of non-blank bytes at $ptr as $hl. In a path ($hl
  ;; string.special), `\` escapes the next byte, as in `\#` or `\ `, but
  ;; never a line break.
  (func $codeownersRun (param $hl i32)
    (local $c i32)
    (local $e i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "/"))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (call $lexIsSpace (local.get $c)))
        (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $hl) (enum.get $Token.string.special)))
          (then
            (local.set $c (call $templateByte (local.get $e)))
            (if (i32.and (i32.lt_u (local.get $e) (global.get $end)) (i32.eqz (byteset.get "\n\r" (local.get $c))))
              (then
                (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
                (local.set $e (call $utf8SpanEnd (i32.add (local.get $e) (i32.const 1)) (global.get $end)))
                (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
                (local.set $seg (local.get $e))))))
        (global.set $ptr (local.get $e))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr)))

  ;; GitHub and GitLab CODEOWNERS: a path pattern, then owners (`@user`,
  ;; `@org/team`, or an email). GitLab adds `[Section]`, `^[Optional]`, and
  ;; `[Section][2]` headers with default owners, and `!path` exclusions.
  ;; $col is 0 at a line start, 1 after the path or header.
  (func $hlCodeowners
    (local $c i32)
    (local $lhs i32)
    (local $gap i32)
    (local $col i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $col (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (local.get $col)
          (then
            (call $codeownersRun (enum.get $Token.attribute))
            (br $next)))
        (local.set $col (i32.const 1))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "!"))
            (i32.and
              (i32.eq (local.get $c) (i32.const "^"))
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "["))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (local.set $c (call $templateByte (local.get $lhs)))))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (global.set $ptr
              (call $scanFindSpecial (global.get $ptr) (global.get $end) (i32.const "]") (i32.const 0) (i32.const 1)))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            ;; `]`, then an optional `[2]` approval count
            (block $header
              (loop $count
                (br_if $header (i32.ne (call $templateByte (global.get $ptr)) (i32.const "]")))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (br_if $header (i32.ne (call $templateByte (global.get $ptr)) (i32.const "[")))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (call $lexScanNumber)
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (br $count)))
            (br $next)))
        (call $codeownersRun (enum.get $Token.string.special))
        (br $next))))
)
