(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.talonWords 96)

  (import "@pierre/wat-tools/common.wat")

  (keyword-table $talonWords $mem.talonWords $mem.talonWords+96
    (group "app" "os" "mode" "tag" "title" "language" "hostname") ;; 1: header keys
    (group "and" "not") ;; 2: header prefixes
    (group "settings")) ;; 3

  ;; Scan a string from $ptr; [$seg,$ptr) holds string bytes not yet emitted,
  ;; such as the opening quote. $q closes it, three in a row when $triple.
  ;; Emit `\` escapes and `{name}` interpolations, where `{{` is an escaped
  ;; brace. Interpolations stay on one line. A short string stops before a line
  ;; break. Return $q while a triple string is open at $end, else 0.
  (func $talonString (param $q i32) (param $triple i32) (param $seg i32) (result i32)
    (local $e i32)
    (local $b i32)
    (local $p i32)
    (local $c i32)
    (local $stop i32)
    (block $done
      (loop $scan
        (local.set $e
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $q)
            (i32.const 1)
            (i32.eqz (local.get $triple))))
        (local.set $stop (global.get $end))
        (global.set $end (local.get $e))
        (local.set $b (call $lexFindByte (global.get $ptr) (i32.const "{")))
        (global.set $end (local.get $stop))
        (if (i32.lt_u (local.get $b) (local.get $e))
          (then
            (global.set $ptr (i32.add (local.get $b) (i32.const 1)))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "{"))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $b))
                (global.set $ptr (i32.add (local.get $b) (i32.const 2)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $b) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (br $scan)))
            (local.set $p (global.get $ptr))
            (block $found
              (loop $close
                (local.set $c (call $templateByte (local.get $p)))
                (br_if $scan
                  (i32.or
                    (i32.ge_u (local.get $p) (local.get $e))
                    (byteset.get "\n\r" (local.get $c))))
                (br_if $found (i32.eq (local.get $c) (i32.const "}")))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $close)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $b))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $b) (global.get $ptr))
            (call $emitTok (enum.get $Token.variable) (global.get $ptr) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (local.get $e))
        (br_if $done (i32.ge_u (local.get $e) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $e)))
        (global.set $ptr (i32.add (local.get $e) (i32.const 1)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (if (local.get $triple)
              (then
                (br_if $scan
                  (i32.or
                    (i32.ne (call $templateByte (global.get $ptr)) (local.get $q))
                    (i32.ne (call $templateByte (i32.add (local.get $e) (i32.const 2))) (local.get $q))))
                (global.set $ptr (i32.add (local.get $e) (i32.const 3)))))
            (local.set $q (i32.const 0))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $e))
            ;; a short string does not continue past a line break
            (local.set $c (call $templateByte (global.get $ptr)))
            (if (i32.or (local.get $triple) (i32.eqz (byteset.get "\n\r" (local.get $c))))
              (then (global.set $ptr (call $lexEscapeEnd (local.get $e)))))
            (call $emitTok (enum.get $Token.string.escape) (local.get $e) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; a raw line break ends a short string, unconsumed
        (global.set $ptr (local.get $e))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.mul (local.get $q) (local.get $triple)))

  ;; Talon voice command files: an optional context header (`app: vscode`,
  ;; `and tag: user.x`, `title: /re/`) ended by a `-` line, then rules. A rule
  ;; starts in column 0 with its spoken form and a `:`; its actions follow on
  ;; the line or in an indented block.
  ;; $bol: 1 at a line start. $body: 1 after the `-` line. $rule: 1 in a
  ;; spoken form. $raw: 1 in the raw arguments of `key(...)` and of rule
  ;; triggers such as `face(smile):`. $settings: 1 in a `settings():` block,
  ;; whose names are properties. $open: the quote of an open `"""` string.
  (func $hlTalonscript
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $gap i32)
    (local $p i32)
    (local $k i32)
    (local $g i32)
    (local $hl i32)
    (local $bol i32)
    (local $body i32)
    (local $rule i32)
    (local $raw i32)
    (local $settings i32)
    (local $open i32)
    (local.set $bol (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $open)
          (then
            (local.set $open
              (call $talonString (local.get $open) (i32.const 1) (global.get $ptr)))
            (br_if $done (local.get $open))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $bol (i32.const 1))
            (local.set $rule (i32.const 0))
            (local.set $raw (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (block $emit
          (if (local.get $raw)
            (then
              ;; a key name runs to a blank, control byte, or bracket
              (local.set $p (local.get $lhs))
              (block $run
                (loop $l
                  (local.set $k (call $templateByte (local.get $p)))
                  (br_if $run (i32.le_u (local.get $k) (i32.const 32)))
                  (br_if $run (byteset.get "()[]{}" (local.get $k)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $l)))
              (if (i32.gt_u (local.get $p) (local.get $lhs))
                (then
                  (global.set $ptr (local.get $p))
                  (local.set $hl (enum.get $Token.constant))
                  (br $emit)))))
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
              (br $next)))
          ;; a line in column 0 holds a header entry or starts a rule
          (if (local.get $bol)
            (then
              (local.set $bol (i32.const 0))
              (local.set $p
                (select
                  (i32.const 10)
                  (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))
                  (i32.eq (local.get $gap) (local.get $lhs))))
              (if (i32.eqz (byteset.get " \t" (local.get $p)))
                (then
                  (if (i32.eqz (local.get $body))
                    (then
                      (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.le_u (local.get $c2) (i32.const 32)))
                        (then
                          (local.set $body (i32.const 1))
                          (local.set $hl (enum.get $Token.punctuation.special))
                          (br $emit)))
                      ;; [$lhs,$rhs) holds `and` and `not` prefixes, [$k,$p) the key
                      (local.set $k (local.get $lhs))
                      (local.set $rhs (local.get $lhs))
                      (global.set $ptr (local.get $lhs))
                      (call $scanIdentRun (i32.const "."))
                      (loop $prefix
                        (local.set $p (global.get $ptr))
                        (if
                          (i32.and
                            (i32.eq (keyword-table.get $talonWords (local.get $k) (local.get $p)) (i32.const 2))
                            (i32.eq (call $templateByte (local.get $p)) (i32.const 32)))
                          (then
                            (local.set $rhs (local.get $p))
                            (local.set $k (call $lexSkipSpaceAt (local.get $p)))
                            (global.set $ptr (local.get $k))
                            (call $scanIdentRun (i32.const "."))
                            (br $prefix))))
                      (local.set $g (keyword-table.get $talonWords (local.get $k) (local.get $p)))
                      ;; dotted keys such as `win.title` and `user.x` are context keys too
                      (global.set $ptr (local.get $k))
                      (call $scanIdentRun (i32.const "_"))
                      (if
                        (i32.and
                          (i32.gt_u (local.get $p) (local.get $k))
                          (i32.and
                            (i32.eq (call $templateByte (local.get $p)) (i32.const ":"))
                            (i32.or (i32.eq (local.get $g) (i32.const 1)) (i32.lt_u (global.get $ptr) (local.get $p)))))
                        (then
                          (if (i32.ne (local.get $k) (local.get $lhs))
                            (then
                              (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (local.get $rhs))
                              (call $emitGap (local.get $rhs) (local.get $k))))
                          (call $emitTok (enum.get $Token.property) (local.get $k) (local.get $p))
                          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                          (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                          (local.set $lhs (call $lexSkipSpaceAt (global.get $ptr)))
                          (call $emitGap (global.get $ptr) (local.get $lhs))
                          (global.set $ptr (local.get $lhs))
                          (call $scanToLineEnd)
                          (call $emitTok
                            (select
                              (enum.get $Token.string.regex)
                              (enum.get $Token.string)
                              (i32.eq (call $templateByte (local.get $lhs)) (i32.const "/")))
                            (local.get $lhs)
                            (global.get $ptr))
                          (br $next)))
                      (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
                  (local.set $rule (i32.const 1))
                  (local.set $settings (i32.const 0))))))
          (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (then
              (if
                (i32.and
                  (i32.eq (local.get $c2) (local.get $c))
                  (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (local.get $c)))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                  (local.set $open (call $talonString (local.get $c) (i32.const 1) (local.get $lhs))))
                (else (drop (call $talonString (local.get $c) (i32.const 0) (local.get $lhs)))))
              (br $next)))
          (if (call $lexIsNameStart (local.get $c))
            (then
              (call $scanIdentRun (select (i32.const 39) (i32.const ".") (local.get $rule)))
              (local.set $rhs (global.get $ptr))
              (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
              (if (i32.eq (call $templateByte (local.get $rhs)) (i32.const "("))
                (then
                  (local.set $hl (enum.get $Token.function))
                  (if (local.get $rule)
                    (then
                      ;; a trigger such as `key(ctrl-a):`, `face(smile):`, or `settings():`
                      (local.set $hl (enum.get $Token.keyword))
                      (local.set $raw (i32.const 1))
                      (local.set $settings
                        (i32.eq (keyword-table.get $talonWords (local.get $lhs) (local.get $rhs)) (i32.const 3)))))
                  (local.set $raw
                    (i32.or
                      (local.get $raw)
                      (i32.and
                        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                        (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "key")))))
                  (br $emit)))
              (local.set $hl (enum.get $Token.string.special))
              (br_if $emit (local.get $rule))
              (local.set $hl (enum.get $Token.variable))
              (if
                (i32.and
                  (i32.eq (call $templateByte (local.get $p)) (i32.const "="))
                  (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "=")))
                (then
                  (local.set $hl
                    (select (enum.get $Token.property) (enum.get $Token.variable) (local.get $settings)))))
              (br $emit)))
          (if (local.get $rule)
            (then
              (local.set $hl (enum.get $Token.punctuation.delimiter))
              (if (i32.eq (local.get $c) (i32.const ":"))
                (then
                  (local.set $rule (i32.const 0))
                  (br $emit)))
              ;; `<user.text>` captures and `{user.list}` lists
              (if (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const "{")))
                (then
                  (call $scanIdentRun (i32.const "."))
                  (if (i32.eq (call $templateByte (global.get $ptr)) (i32.add (local.get $c) (i32.const 2)))
                    (then
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (local.set $hl
                        (select
                          (enum.get $Token.variable.parameter)
                          (enum.get $Token.variable.special)
                          (i32.eq (local.get $c) (i32.const "<"))))
                      (br $emit)))
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
              (local.set $hl (enum.get $Token.operator))
              (br_if $emit
                (i32.or
                  (i32.eq (local.get $c) (i32.const "|"))
                  (i32.or (i32.eq (local.get $c) (i32.const "^")) (i32.eq (local.get $c) (i32.const "$")))))))
          (if (call $lexIsDigit (local.get $c))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexScanNumber)
              (local.set $hl (enum.get $Token.number))
              (br $emit)))
          (local.set $hl (enum.get $Token.punctuation.bracket))
          (if (byteset.get "()[]{}" (local.get $c))
            (then
              (if (i32.eq (local.get $c) (i32.const ")"))
                (then (local.set $raw (i32.const 0))))
              (br $emit)))
          (local.set $hl (enum.get $Token.punctuation.delimiter))
          (br_if $emit (byteset.get ",:;" (local.get $c)))
          (local.set $hl (enum.get $Token.operator))
          (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
            (then
              (block $opDone
                (loop $op
                  (local.set $c (call $templateByte (global.get $ptr)))
                  (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (br $op)))
              (br $emit)))
          (local.set $hl (enum.get $Token.none))
          (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
