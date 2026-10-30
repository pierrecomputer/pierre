(module
  (import "../common.wat")

  ;; Matched without case, like the Prometheus lexer. Functions are not listed:
  ;; any other name before `(` is a call. Token in the low byte; 256 marks the
  ;; grouping words whose next `(` opens a label list.
  (keyword-table $promqlWords $mem.promqlWords $mem.laterWordsFree
    (group $Token.keyword+256 "by" "without" "on" "ignoring" "group_left" "group_right")
    (group $Token.keyword
      "bool" "offset" "sum" "min" "max" "avg" "group" "stddev" "stdvar" "count" "count_values"
      "bottomk" "topk" "quantile" "limitk" "limit_ratio")
    (group $Token.keyword.operator "and" "or" "unless" "atan2")
    (group $Token.number "inf" "nan"))

  ;; $nest is a stack of open brackets, two bits per level: 1 for `{` or a
  ;; label list such as `by (job)`, where names are labels, 2 for `[`, where
  ;; `:` separates a subquery step, and 0 otherwise. $arm is 1 right after a
  ;; grouping word and 2 right after `=~` or `!~`, where a string is a regex.
  ;; Both are checkpointed.
  (func $hlPromql
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $was i32)
    (local $nest i32)
    (local $arm i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $was (local.get $arm))
        (local.set $arm (i32.const 0))

        ;; a comment keeps a pending label list or regex
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (local.set $arm (local.get $was))
            (br $next)))
        ;; backquoted strings have no escapes and may span lines
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (i32.eq (local.get $c) (i32.const "`")))
          (then
            (local.set $hl
              (select (enum.get $Token.string.regex) (enum.get $Token.string) (i32.eq (local.get $was) (i32.const 2))))
            (if (i32.eq (local.get $c) (i32.const "`"))
              (then (call $lexRawString (local.get $c) (i32.const 1) (local.get $hl)))
              (else (call $lexString (local.get $c) (i32.const 0) (local.get $hl))))
            (br $next)))
        ;; Grafana template variables: `$name` and `${name:format}`
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "$"))
            (i32.or (i32.eq (local.get $c2) (i32.const "{")) (call $lexIsIdentContinue (local.get $c2))))
          (then
            (global.set $ptr
              (i32.add (i32.add (local.get $lhs) (i32.const 1)) (i32.eq (local.get $c2) (i32.const "{"))))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (call $scanIdentRun (i32.const ":"))
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}")))))
              (else (call $scanIdentRun (i32.const "_"))))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; the identifier run also takes duration units and runs: `5m`, `1h30m`
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; names; metric names may contain `:` and start with one outside `[`
        (if
          (i32.or
            (call $lexIsNameStart (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eqz (i32.and (local.get $nest) (i32.const 2)))))
          (then
            (call $scanIdentRun (i32.const ":"))
            (local.set $rhs (global.get $ptr))
            (block $classified
              (local.set $hl (enum.get $Token.property))
              (br_if $classified (i32.and (local.get $nest) (i32.const 1)))
              ;; a keyword can name a metric: `count{job="a"}`, `offset[5m]`
              (local.set $p (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
              (local.set $hl (enum.get $Token.variable))
              (br_if $classified
                (i32.or (i32.eq (local.get $p) (i32.const "{")) (i32.eq (local.get $p) (i32.const "["))))
              (local.set $g
                (keyword-table.value $promqlWords
                  (i32.const $mem.lexLowerScratch)
                  (i32.add
                    (i32.const $mem.lexLowerScratch)
                    (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))))
              (if (i32.ge_s (local.get $g) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                  (local.set $arm (i32.shr_u (local.get $g) (i32.const 8)))
                  (br $classified)))
              (local.set $hl
                (select (enum.get $Token.function) (enum.get $Token.variable) (i32.eq (local.get $p) (i32.const "(")))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (byteset.get "([{" (local.get $c))
              (then
                (local.set $nest
                  (i32.or
                    (i32.shl (local.get $nest) (i32.const 2))
                    (i32.or
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "{"))
                        (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $was) (i32.const 1))))
                      (i32.shl (i32.eq (local.get $c) (i32.const "[")) (i32.const 1))))))
              (else (local.set $nest (i32.shr_u (local.get $nest) (i32.const 2)))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ",:" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; comparisons and matchers stay whole: `==`, `!=`, `<=`, `>=`, `=~`, `!~`
        (if (byteset.get "!%*+-/<=>@^~" (local.get $c))
          (then
            (if
              (i32.or
                (i32.and (byteset.get "!<=>" (local.get $c)) (i32.eq (local.get $c2) (i32.const "=")))
                (i32.and (byteset.get "!=" (local.get $c)) (i32.eq (local.get $c2) (i32.const "~"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (if (i32.eq (local.get $c2) (i32.const "~"))
                  (then (local.set $arm (i32.const 2))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
