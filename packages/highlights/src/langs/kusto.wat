(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.kustoWords 200)

  (import "@pierre/wat-tools/common.wat")

  ;; Kusto (KQL) and Splunk SPL share this lexer: both are pipe queries where
  ;; the word after `|` is a command, so commands are not listed. Token in the
  ;; low byte. Bit 256 marks a Kusto word, 512 a Splunk word. 1024: the next
  ;; name is a keyword too (`kind=inner`, `nulls last`), 2048: a literal type
  ;; whose `(...)` holds a value (`datetime(2024-01-01)`), 4096: the next name
  ;; is declared.
  (keyword-table $kustoWords $mem.kustoWords $mem.kustoWords+200
    (group $Token.keyword.declaration+4352 "let")
    (group $Token.keyword+1280 "kind" "nulls")
    (group $Token.keyword+256
      "set" "declare" "on" "asc" "desc" "with" "step" "to" "from" "print" "union" "range"
      "datatable")
    (group $Token.keyword+768 "by" "as" "where")
    (group $Token.keyword+512 "over" "output" "outputnew")
    (group $Token.keyword.operator+768 "and" "or" "not" "in")
    (group $Token.keyword.operator+256
      "has" "contains" "startswith" "endswith" "between" "matches" "regex" "has_any" "has_all"
      "hasprefix")
    (group $Token.keyword.operator+512 "xor" "like")
    (group $Token.type.builtin+256 "bool" "dynamic" "int" "long" "real" "string" "decimal")
    (group $Token.type.builtin+2304 "datetime" "timespan" "guid" "time")
    (group $Token.boolean+768 "true" "false")
    (group $Token.function+512 "count"))

  (func $hlKusto
    (call $hlKustoImpl (i32.const 0)))

  ;; $spl is 1 for Splunk: names are matched without case and may hold `.`,
  ;; `[` also starts a command (a subsearch), and ``` ``` ``` is a comment
  ;; instead of a string. $expect is 1 where a command name may follow, 2
  ;; where a keyword value may follow (`kind=inner`), and 3 after `let`. It
  ;; is checkpointed.
  (func $hlKustoImpl (param $spl i32)
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $was i32)
    (local $expect i32)
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
        (local.set $was (local.get $expect))
        (local.set $expect (i32.const 0))

        ;; comments keep a pending command
        (if
          (i32.and
            (i32.eqz (local.get $spl))
            (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/"))))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (local.set $expect (local.get $was))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (local.set $hl (select (enum.get $Token.comment) (enum.get $Token.string) (local.get $spl)))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const "`"))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "`")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                (local.set $g (i32.const 0))
                (block $found
                  (loop $find
                    (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "`")))
                    (br_if $found (i32.ge_u (global.get $ptr) (global.get $end)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br_if $find (i32.ne (call $templateByte (global.get $ptr)) (i32.const "`")))
                    (br_if $find
                      (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "`")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                    (local.set $g (i32.const 1))))
                (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                (if (i32.eqz (local.get $g))
                  (then (call $streamSetFixed32 (i32.const "```") (i32.const 3) (local.get $hl))))
                (if (local.get $spl)
                  (then (local.set $expect (local.get $was))))
                (br $next)))
            ;; a Splunk macro: `name(args)`
            (global.set $ptr
              (call $scanFindSpecial
                (i32.add (local.get $lhs) (i32.const 1))
                (global.get $end)
                (i32.const "`")
                (i32.const 0)
                (i32.const 1)))
            (global.set $ptr
              (i32.add (global.get $ptr) (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; Kusto prefixes: `@` verbatim (no escapes), `h` obfuscated, or both
        (local.set $p (local.get $lhs))
        (if
          (i32.and
            (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "h"))
            (byteset.get "\22'@" (local.get $c2)))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (local.set $g (call $templateByte (local.get $p)))
        (local.set $rhs (i32.eq (local.get $g) (i32.const "@")))
        (if (local.get $rhs)
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $g (call $templateByte (local.get $p)))))
        (if (i32.or (i32.eq (local.get $g) (i32.const 34)) (i32.eq (local.get $g) (i32.const 39)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))
            (global.set $ptr (local.get $p))
            ;; a Splunk 'name' is a field
            (local.set $hl
              (select
                (enum.get $Token.variable)
                (enum.get $Token.string)
                (i32.and (local.get $spl) (i32.eq (local.get $g) (i32.const 39)))))
            (if (local.get $rhs)
              (then (call $lexRawString (local.get $g) (i32.const 0) (local.get $hl)))
              (else (call $lexString (local.get $g) (i32.const 0) (local.get $hl))))
            (br $next)))
        ;; Kusto `$left`, Splunk `$token$`
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $lexIsIdentContinue (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (select (i32.const ".") (i32.const "_") (local.get $spl)))
            (global.set $ptr
              (i32.add (global.get $ptr) (i32.eq (call $templateByte (global.get $ptr)) (i32.const "$"))))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; a sign right after `=` belongs to the value: `earliest=-24h@h`
        (if
          (i32.and
            (i32.and (byteset.get "+-" (local.get $c)) (call $lexIsDigit (local.get $c2)))
            (i32.and
              (i32.gt_u (local.get $lhs) (global.get $srcBase))
              (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "="))))
          (then
            ;; WARNING: the number branch below scans from $ptr, past the sign
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $c (i32.const "0"))))
        ;; the identifier run takes timespan units (`5m`, `1.5h`); Splunk
        ;; snaps a time to a unit with `@`: `-24h@h`, `@d`
        (if
          (i32.or
            (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
            (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsNameStart (local.get $c2))))
          (then
            (if (i32.ne (local.get $c) (i32.const "@"))
              (then (call $lexScanNumber)))
            (if
              (i32.and
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "@"))
                (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $scanIdentRun (i32.const "_"))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; management commands: `.create table`, `.show`
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsNameStart (local.get $c2)))
            (i32.eqz (call $lexLineByteBefore (local.get $lhs))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; names; Kusto `!has` and `!in` are one operator
        (if
          (i32.or
            (call $lexIsNameStart (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const "!")) (call $lexIsNameStart (local.get $c2))))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.eq (local.get $c) (i32.const "!"))))
            (global.set $ptr (local.get $p))
            ;; command names may hold `-`: `mv-expand`, `project-away`
            (call $scanIdentRun
              (select
                (i32.const "-")
                (select (i32.const ".") (i32.const "_") (local.get $spl))
                (i32.eq (local.get $was) (i32.const 1))))
            (local.set $rhs (global.get $ptr))
            (block $classified
              (local.set $hl (enum.get $Token.keyword))
              (br_if $classified
                (i32.and
                  (i32.ne (local.get $c) (i32.const "!"))
                  (i32.or (i32.eq (local.get $was) (i32.const 1)) (i32.eq (local.get $was) (i32.const 2)))))
              (local.set $g (local.get $rhs))
              ;; `has_cs`, `!contains_cs`: case-sensitive forms of an operator
              (if
                (i32.and
                  (i32.eqz (local.get $spl))
                  (i32.and
                    (i32.gt_u (i32.sub (local.get $rhs) (local.get $p)) (i32.const 3))
                    (i32.eq
                      (i32.and (i32.load (i32.sub (local.get $rhs) (i32.const 3))) (i32.const 0xffffff))
                      (i32.const "_cs"))))
                (then (local.set $g (i32.sub (local.get $rhs) (i32.const 3)))))
              (if (local.get $spl)
                (then
                  (local.set $g
                    (keyword-table.value $kustoWords
                      (i32.const $mem.lexLowerScratch)
                      (i32.add
                        (i32.const $mem.lexLowerScratch)
                        (call $lexLowerCopy (local.get $p) (local.get $rhs) (i32.const $mem.lexLowerScratch))))))
                (else
                  (local.set $hl (local.get $g))
                  (local.set $g (keyword-table.value $kustoWords (local.get $p) (local.get $g)))
                  ;; only an operator takes the `_cs` suffix
                  (if (i32.ne (local.get $hl) (local.get $rhs))
                    (then
                      (if (i32.ne (i32.and (local.get $g) (i32.const 255)) (enum.get $Token.keyword.operator))
                        (then (local.set $g (i32.const -1))))))))
              (if
                (i32.and
                  (i32.ge_s (local.get $g) (i32.const 0))
                  (i32.ne (i32.and (local.get $g) (i32.shl (i32.const 256) (local.get $spl))) (i32.const 0)))
                (then
                  (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                  (if (i32.and (local.get $g) (i32.const 1024))
                    (then (local.set $expect (i32.const 2))))
                  (if (i32.and (local.get $g) (i32.const 4096))
                    (then (local.set $expect (i32.const 3))))
                  (if (i32.eq (local.get $hl) (enum.get $Token.keyword.operator))
                    (then
                      ;; `in~`, `has~`: case-insensitive forms
                      (local.set $rhs
                        (i32.add (local.get $rhs) (i32.eq (call $templateByte (local.get $rhs)) (i32.const "~"))))
                      (br $classified)))
                  (if (i32.ne (local.get $c) (i32.const "!"))
                    (then
                      ;; `datetime(2024-01-01 10:00)` holds a literal value
                      (if
                        (i32.and
                          (i32.ne (i32.and (local.get $g) (i32.const 2048)) (i32.const 0))
                          (i32.eq (call $templateByte (local.get $rhs)) (i32.const "(")))
                        (then
                          (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                          (local.set $lhs (i32.add (local.get $rhs) (i32.const 1)))
                          (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $rhs) (local.get $lhs))
                          (local.set $rhs
                            (call $scanFindSpecial
                              (local.get $lhs)
                              (global.get $end)
                              (i32.const ")")
                              (i32.const 0)
                              (i32.const 1)))
                          (local.set $hl (enum.get $Token.number))))
                      (br $classified)))))
              (local.set $hl (enum.get $Token.operator))
              (if (i32.eq (local.get $c) (i32.const "!"))
                (then
                  (local.set $rhs (local.get $p))
                  (br $classified)))
              (local.set $p (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
              (local.set $hl (enum.get $Token.function))
              (br_if $classified (i32.eq (local.get $p) (i32.const "(")))
              ;; `extend total = a + b`, Splunk `index=main`
              (local.set $hl (enum.get $Token.variable))
              (br_if $classified (i32.eq (local.get $was) (i32.const 3)))
              (local.set $g (call $lexSkipSpaceAt (local.get $rhs)))
              (local.set $g (call $templateByte (i32.add (local.get $g) (i32.const 1))))
              (if
                (i32.and
                  (i32.eq (local.get $p) (i32.const "="))
                  (i32.and (i32.ne (local.get $g) (i32.const "=")) (i32.ne (local.get $g) (i32.const "~"))))
                (then (local.set $hl (enum.get $Token.property)))))
            (global.set $ptr (local.get $rhs))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.const 1))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (i32.and (local.get $spl) (i32.eq (local.get $c) (i32.const "[")))
              (then (local.set $expect (i32.const 1))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.and (byteset.get ",.:;" (local.get $c)) (i32.ne (local.get $c2) (i32.const ".")))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.lt_u (local.get $c) (i32.const 0x80))
          (then
            ;; comparisons stay whole: `==`, `!=`, `<=`, `>=`, `=~`, `!~`, `..`
            (if
              (i32.or
                (i32.or
                  (i32.and (byteset.get "!<=>" (local.get $c)) (i32.eq (local.get $c2) (i32.const "=")))
                  (i32.and (byteset.get "!=" (local.get $c)) (i32.eq (local.get $c2) (i32.const "~"))))
                (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c2) (i32.const "."))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            ;; `kind = inner`
            (if (i32.and (i32.eq (local.get $was) (i32.const 2)) (i32.eq (local.get $c) (i32.const "=")))
              (then (local.set $expect (local.get $was))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
