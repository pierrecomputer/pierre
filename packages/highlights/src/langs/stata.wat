(module
  (import "../common.wat")

  ;; Bits above the token: 256 a word that keeps its meaning after the
  ;; command name (`if`, `in`, `using`), 512 a prefix whose next word is a
  ;; command (`quietly`), 1024 a prefix whose `:` starts a command (`by`),
  ;; 2048 the next name defines a program. Words that share hash features
  ;; with another word are matched in $stataWordHl.
  (keyword-table $stataWords $mem.stataWords $mem.daxWords
    (group $Token.keyword.control+256 "if")
    (group $Token.keyword.control+512 "else")
    (group $Token.keyword.control "foreach" "forvalues" "forval" "while" "exit")
    (group $Token.keyword.declaration+2048 "program")
    (group $Token.keyword.declaration+2304 "define")
    (group $Token.keyword.declaration+256 "local" "global")
    (group $Token.keyword.declaration
      "end" "tempvar" "tempname" "scalar" "matrix" "mat" "args" "syntax" "version")
    (group $Token.keyword+512 "quietly" "qui" "noisily" "noi" "capture" "cap")
    (group $Token.keyword+1024 "by" "bysort" "bys" "xi" "svy" "bootstrap" "statsby")
    (group $Token.keyword+256 "in" "using" "of" "varlist" "numlist" "newlist")
    (group $Token.keyword
      "use" "save" "merge" "append" "keep" "drop" "sort" "gsort" "generate" "gen" "egen" "replace"
      "rename" "label" "list" "display" "di" "describe" "des" "summarize" "sum" "su" "tabulate"
      "tab" "tabstat" "table" "count" "collapse" "encode" "destring" "tostring" "format" "set"
      "clear" "import" "export" "insheet" "outsheet" "log" "regress" "reg" "logit" "probit" "ologit"
      "mlogit" "poisson" "xtreg" "ivregress" "areg" "predict" "test" "estimates" "est" "eststo"
      "esttab" "margins" "twoway" "graph" "histogram" "scatter" "line" "help" "return" "ereturn"
      "preserve" "assert" "confirm" "include" "do" "run" "sysuse" "webuse" "xtset" "tsset"
      "levelsof" "duplicates" "order" "compress" "expand" "correlate" "corr" "ttest" "anova"
      "pwcorr" "putexcel" "file" "cd"))

  ;; The table value of the word [lhs,rhs), or -1.
  (func $stataWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $v i32)
    (local $n i32)
    (local $w i64)
    (local.set $v (keyword-table.value $stataWords (local.get $lhs) (local.get $rhs)))
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.or (i32.ge_s (local.get $v) (i32.const 0)) (i32.lt_u (local.get $n) (i32.const 6)))
      (then (return (local.get $v))))
    (local.set $w (i64.load (local.get $lhs)))
    (if (i32.eq (local.get $n) (i32.const 6))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffff)))
        (if (i32.or (i64.eq (local.get $w) (i64.const "recode")) (i64.eq (local.get $w) (i64.const "decode")))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $n) (i32.const 7))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffffff)))
        (if
          (i32.or
            (i64.eq (local.get $w) (i64.const "reshape"))
            (i32.or (i64.eq (local.get $w) (i64.const "restore")) (i64.eq (local.get $w) (i64.const "reghdfe"))))
          (then (return (enum.get $Token.keyword))))))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then
        (if (i64.eq (local.get $w) (i64.const "continue"))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "tempfile"))
          (then (return (enum.get $Token.keyword.declaration))))))
    (i32.const -1))

  ;; Whether the gap [p, stop), which holds a line break, holds a second one,
  ;; so a blank line ends a command that `///` continued.
  (func $stataTwoBreaks (param $p i32) (param $stop i32) (result i32)
    (local $c i32)
    (loop $first
      (local.set $c (i32.load8_u (local.get $p)))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $first (i32.eqz (byteset.get "\n\r" (local.get $c)))))
    (if (i32.and (i32.eq (local.get $c) (i32.const 13)) (i32.eq (call $templateByte (local.get $p)) (i32.const 10)))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    (call $lexGapHasBreak (local.get $p) (local.get $stop)))

  ;; Whether [lhs,rhs) is a factor-variable or time-series operator before
  ;; its `.`: `i`, `c`, `o`, `ib3`, `ibn`, `L2`, `D`, `F`, `S`.
  (func $stataIsFactorOp (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (if (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
      (then (return (i32.const 0))))
    (local.set $c (i32.or (i32.load8_u (local.get $lhs)) (i32.const 32)))
    (if (i32.eqz (byteset.get "bcdfilos" (local.get $c)))
      (then (return (i32.const 0))))
    (block $done
      (loop $rest
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (br_if $rest
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "n")))))
        (return (i32.const 0))))
    (i32.const 1))

  ;; A local macro reference `name' (nested, as in `x`i'') or a global macro
  ;; $name or ${name} at $ptr, bounded by $end. Returns 0, consuming nothing,
  ;; for a `$` that starts no macro.
  (func $stataMacro (result i32)
    (local $lhs i32)
    (local $p i32)
    (local $depth i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
    (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "`"))
      (then
        (local.set $p (local.get $lhs))
        (block $closed
          (loop $scan
            (local.set $depth
              (i32.add
                (local.get $depth)
                (select (i32.const 1) (i32.const -1) (i32.eq (i32.load8_u (local.get $p)) (i32.const "`")))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $closed (i32.eqz (local.get $depth)))
            (local.set $p (call $lexFindEither (local.get $p) (i32.const "`") (i32.const 39)))
            (br_if $scan (i32.lt_u (local.get $p) (global.get $end)))))
        (global.set $ptr (local.get $p)))
      (else
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (global.set $ptr (call $lexFindByte (local.get $lhs) (i32.const "}")))
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
          (else
            (if
              (i32.eqz
                (i32.or
                  (i32.ge_u (local.get $c) (i32.const 0x80))
                  (i32.or
                    (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                    (i32.eq (local.get $c) (i32.const "_")))))
              (then (return (i32.const 0))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))))))
    (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  ;; A `"..."` string, or with $compound a `` `"..."' `` string that nests and
  ;; may hold quotes, from $ptr to its close or $end. Macros inside expand,
  ;; so they are emitted as variables; a backslash keeps a `$` or a backquote
  ;; literal.
  (func $stataString (param $compound i32)
    (local $seg i32)
    (local $body i32)
    (local $p i32)
    (local $c i32)
    (local $depth i32)
    (local.set $seg (global.get $ptr))
    (local.set $body (i32.add (global.get $ptr) (i32.add (i32.const 1) (local.get $compound))))
    (global.set $ptr (local.get $body))
    (local.set $depth (i32.const 1))
    (block $done
      (loop $scan
        (local.set $p (call $scanFind3 (global.get $ptr) (i32.const 34) (i32.const "`") (i32.const "$")))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (br_if $done (i32.eqz (local.get $compound)))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const 39))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (br_if $done (i32.eqz (local.get $depth)))))
            (br $scan)))
        (if
          (i32.and
            (local.get $compound)
            (i32.and
              (i32.eq (local.get $c) (i32.const "`"))
              (i32.eq (call $templateByte (global.get $ptr)) (i32.const 34))))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (br $scan)))
        (if
          (i32.and
            (i32.gt_u (local.get $p) (local.get $body))
            (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 92)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (i32.sub (local.get $p) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.string.escape)
              (i32.sub (local.get $p) (i32.const 1))
              (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (local.set $seg (local.get $p))
        (global.set $ptr (local.get $p))
        (if (call $stataMacro)
          (then (local.set $seg (global.get $ptr)))
          (else (global.set $ptr (i32.add (local.get $p) (i32.const 1)))))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  ;; $cmd is 1 where a command name comes: at a line start, after a prefix
  ;; such as `quietly`, and after the `:` of a `by` prefix when $colon is 1.
  ;; $opt is 1 after the options comma, where names at $paren 0 are options.
  ;; $expect is 1 after `program`, where the next name is defined. $cont is
  ;; 1 after `///`, which joins the next line. All are checkpointed. $eol is
  ;; the end of the current line, which bounds strings and macros.
  (func $hlStata
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $v i32)
    (local $hl i32)
    (local $stop i32)
    (local $atCmd i32)
    (local $eol i32)
    (local $cmd i32)
    (local $colon i32)
    (local $opt i32)
    (local $paren i32)
    (local $expect i32)
    (local $cont i32)
    (local.set $cmd (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (local.set $eol (i32.const 0))
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $lhs) (global.get $ptr))
          (then
            (if (i32.or (i32.eqz (local.get $cont)) (call $stataTwoBreaks (local.get $lhs) (global.get $ptr)))
              (then
                (local.set $cmd (i32.const 1))
                (local.set $colon (i32.const 0))
                (local.set $opt (i32.const 0))
                (local.set $paren (i32.const 0))
                (local.set $expect (i32.const 0))))
            (local.set $cont (i32.const 0))))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $atCmd (local.get $cmd))
        (local.set $cmd (i32.const 0))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (enum.get $Token.comment))
            (local.set $cmd (local.get $atCmd))
            (br $next)))
        ;; `//` and `///` need a blank before them; `///` joins the next line
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
            (i32.or
              (i32.le_u (local.get $lhs) (global.get $srcBase))
              (call $lexIsSpace (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
          (then
            (local.set $cont
              (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "/")))
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (local.set $cmd (local.get $atCmd))
            (br $next)))
        (if (i32.and (local.get $atCmd) (i32.eq (local.get $c) (i32.const "*")))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const "`")))
            (i32.eq (local.get $c) (i32.const "$")))
          (then
            (if (i32.gt_u (local.get $lhs) (local.get $eol))
              (then
                (local.set $eol
                  (call $scanFindSpecial
                    (local.get $lhs)
                    (global.get $end)
                    (i32.const 10)
                    (i32.const 0)
                    (i32.const 1)))))
            (local.set $stop (global.get $end))
            (global.set $end (local.get $eol))
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const 34))
                (i32.and (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $c2) (i32.const 34))))
              (then (call $stataString (i32.ne (local.get $c) (i32.const 34))))
              (else (drop (call $stataMacro))))
            (global.set $end (local.get $stop))
            (br_if $next (i32.gt_u (global.get $ptr) (local.get $lhs)))))

        (if
          (i32.or
            (i32.ge_u (local.get $c) (i32.const 0x80))
            (i32.or
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
              (i32.eq (local.get $c) (i32.const "_"))))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const "."))
                (call $stataIsFactorOp (local.get $lhs) (local.get $rhs)))
              (then
                (local.set $c2 (call $templateByte (i32.add (local.get $rhs) (i32.const 1))))
                (if
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "("))
                    (i32.or
                      (i32.ge_u (local.get $c2) (i32.const 0x80))
                      (i32.or
                        (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                        (i32.eq (local.get $c2) (i32.const "_")))))
                  (then
                    (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (global.get $ptr))
                    (br $next)))))
            (local.set $v (call $stataWordHl (local.get $lhs) (local.get $rhs)))
            (local.set $hl (i32.and (local.get $v) (i32.const 255)))
            (if (local.get $atCmd)
              (then
                (if (i32.lt_s (local.get $v) (i32.const 0))
                  (then (local.set $hl (enum.get $Token.function)))
                  (else
                    (local.set $cmd (i32.ne (i32.and (local.get $v) (i32.const 512)) (i32.const 0)))
                    (local.set $colon
                      (i32.or (local.get $colon) (i32.ne (i32.and (local.get $v) (i32.const 1024)) (i32.const 0))))
                    (local.set $expect (i32.ne (i32.and (local.get $v) (i32.const 2048)) (i32.const 0))))))
              (else
                (if (local.get $expect)
                  (then
                    ;; `program define name`; `program drop name` defines nothing
                    (if (i32.lt_s (local.get $v) (i32.const 0))
                      (then (local.set $hl (enum.get $Token.function.definition))))
                    (local.set $expect
                      (i32.eq (i32.and (local.get $v) (i32.const 0x80000800)) (i32.const 2048))))
                  (else
                    (if (i32.and (local.get $opt) (i32.eqz (local.get $paren)))
                      (then (local.set $hl (enum.get $Token.variable.parameter)))
                      (else
                        (if
                          (i32.or
                            (i32.lt_s (local.get $v) (i32.const 0))
                            (i32.eqz (i32.and (local.get $v) (i32.const 256))))
                          (then
                            (local.set $hl (enum.get $Token.variable))
                            (if (i32.eq (local.get $c) (i32.const "_"))
                              (then (local.set $hl (enum.get $Token.variable.special))))
                            (if (i32.eq (local.get $c2) (i32.const "("))
                              (then (local.set $hl (enum.get $Token.function))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `.` and `.a` through `.z` are missing values, unless glued to a name
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $hl (enum.get $Token.constant.builtin))
            (if
              (i32.and
                (i32.gt_u (local.get $lhs) (global.get $srcBase))
                (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))
              (then (local.set $hl (enum.get $Token.punctuation.delimiter)))
              (else
                (if
                  (i32.and
                    (i32.le_u (i32.sub (local.get $c2) (i32.const "a")) (i32.const 25))
                    (i32.eqz
                      (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))))
                  (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; the `:` after a `by` prefix starts the command
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const ":"))
            (i32.and (local.get $colon) (i32.eqz (local.get $paren))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $cmd (i32.const 1))
            (local.set $colon (i32.const 0))
            (local.set $opt (i32.const 0))
            (br $next)))
        (if (i32.or (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c)) (i32.eq (local.get $c) (i32.const 92)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c))))
                (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "/"))
                    (i32.or (i32.eq (local.get $c2) (i32.const "*")) (i32.eq (local.get $c2) (i32.const "/")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.and (i32.eq (local.get $c) (i32.const ",")) (i32.eqz (local.get $paren)))
              (then (local.set $opt (i32.const 1))))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $paren (i32.add (local.get $paren) (i32.const 1)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.ne (local.get $paren) (i32.const 0)))
              (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))
            ;; `} else {` keeps the command position
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then (local.set $cmd (local.get $atCmd))))))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
