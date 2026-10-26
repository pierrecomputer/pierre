(module
  (import "../common.wat")
  (import "./dockerfile.wat")
  (import "./bicep.wat")

  ;; group 1 opens a section with `:` right after it; group 2 starts a step
  (keyword-table $gherkinWords $mem.gherkinWords $mem.gnuplotWords
    (group "Feature" "Background" "Rule" "Scenario" "Example" "Examples" "Scenarios" "Ability")
    (group "Given" "When" "Then" "And" "But"))

  ;; $head: 1 at a line start. $row: 1 in a table row. Doc strings span lines
  ;; through the shared line-delimiter stream mode.
  (func $hlGherkin
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $head i32)
    (local $row i32)
    (call $lexEmitLeadingContinuation)
    (local.set $head (i32.const 1))
    (local.set $row (i32.const 0))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $head (i32.const 1))
            (local.set $row (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if (local.get $head)
          (then
            (local.set $head (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (br $next)))
            (local.set $row (i32.eq (local.get $c) (i32.const "|")))
            (if
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const "`")))
                (i32.and
                  (i32.eq (local.get $c2) (local.get $c))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (local.get $c))))
              (then
                (call $scanToLineEnd)
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $head
                  (call $dockerHeredoc (global.get $ptr) (local.get $lhs) (i32.const 3) (i32.const 1)))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "*"))
                (i32.or (i32.eq (local.get $c2) (i32.const 32)) (i32.eq (local.get $c2) (i32.const 9))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (then
                (call $scanIdentRun (i32.const "-"))
                (local.set $rhs (global.get $ptr))
                (local.set $g (keyword-table.get $gherkinWords (local.get $lhs) (local.get $rhs)))
                (local.set $c2 (call $templateByte (local.get $rhs)))
                (if (i32.eq (local.get $g) (i32.const 1))
                  (then
                    (if
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const 32))
                        (i32.or
                          (i64.eq (i64.load (local.get $rhs)) (i64.const " Outline"))
                          (i64.eq (i64.load offset=1 (local.get $rhs)) (i64.const "Template"))))
                      (then
                        (local.set $p
                          (i32.add
                            (local.get $rhs)
                            (select
                              (i32.const 8)
                              (i32.const 9)
                              (i32.eq (i32.load8_u offset=1 (local.get $rhs)) (i32.const "O")))))
                        (if (i32.le_u (local.get $p) (global.get $end))
                          (then
                            (local.set $rhs (local.get $p))
                            (local.set $c2 (call $templateByte (local.get $rhs)))))))
                    (if (i32.eq (local.get $c2) (i32.const ":"))
                      (then
                        (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                        (call $emitTok (enum.get $Token.keyword.declaration) (local.get $lhs) (global.get $ptr))
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (call $emitGap (global.get $ptr) (local.get $p))
                        (global.set $ptr (local.get $p))
                        (call $scanToLineEnd)
                        (call $emitTok (enum.get $Token.title) (local.get $p) (global.get $ptr))
                        (br $next)))
                    (global.set $ptr (local.get $rhs))))
                (if
                  (i32.and
                    (i32.eq (local.get $g) (i32.const 2))
                    (i32.eqz (call $lexIsIdentContinue (local.get $c2))))
                  (then
                    (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $rhs))
                    (br $next)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $rhs))
                (br $next)))))

        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; words take in their apostrophes, so a quote here opens a one-line string
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (drop
              (call $bicepStringBody (local.get $c) (local.get $lhs) (enum.get $Token.string) (i32.const 1)))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (local.set $p
              (call $scanFindSpecial
                (i32.add (local.get $lhs) (i32.const 1))
                (global.get $end)
                (i32.const ">")
                (i32.const 0)
                (i32.const 1)))
            (if (i32.eq (call $templateByte (local.get $p)) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        (if (local.get $row)
          (then
            (if (i32.eq (local.get $c) (i32.const "|"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const 92))
                (i32.or
                  (i32.or (i32.eq (local.get $c2) (i32.const "|")) (i32.eq (local.get $c2) (i32.const 92)))
                  (i32.eq (local.get $c2) (i32.const "n"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "'"))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
