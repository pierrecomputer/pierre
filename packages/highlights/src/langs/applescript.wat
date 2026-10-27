(module
  (import "../common.wat")

  ;; AppleScript ignores case, so the table holds lowercase words and the
  ;; lookup uses a lowercased copy. The high byte of a value: 1 at a line
  ;; start names a handler next, as in `on run`, `to greet(who)`, and
  ;; `end greet`; 2 the next name is a variable; 3 the word takes the next
  ;; one, as in `missing value` and `shell script`; 4 the rest of the line
  ;; names variables; 5 `with` then names a loop variable.
  (keyword-table $applescriptWords $mem.applescriptWords $mem.sparqlWords
    (group $Token.keyword.control+256 "end")
    (group $Token.keyword.declaration+256 "on" "to")
    (group $Token.keyword.control+1280 "repeat")
    (group $Token.keyword.control
      "if" "then" "else" "while" "until" "times" "try" "error" "return" "exit" "tell"
      "considering" "ignoring" "continue" "timeout" "transaction" "using")
    (group $Token.keyword.declaration+512 "set" "property" "prop")
    (group $Token.keyword.declaration+1024 "local" "global")
    (group $Token.keyword.declaration "script" "copy")
    (group $Token.keyword.operator
      "and" "or" "not" "is" "equal" "equals" "contains" "contain" "as" "div" "mod" "greater"
      "less" "does" "starts" "ends" "begins" "comes" "before" "after" "in")
    (group $Token.keyword
      "of" "the" "every" "some" "first" "last" "front" "named" "thru"
      "through" "from" "by" "at" "into" "for" "with" "without" "terms" "but")
    (group $Token.boolean "true" "false" "yes" "no")
    (group $Token.constant.builtin+768 "missing")
    (group $Token.constant.builtin
      "null" "pi" "tab" "space" "linefeed" "quote" "seconds" "minutes" "hours" "days" "weeks")
    (group $Token.variable.special "me" "my" "it" "its" "applescript")
    (group $Token.type.builtin
      "application" "app" "text" "string" "integer" "real" "number" "list" "record" "boolean"
      "date" "file" "folder" "alias" "class" "item" "items" "character" "characters" "word"
      "words" "paragraph" "paragraphs" "window" "document")
    (group $Token.function+768 "shell")
    (group $Token.function
      "activate" "display" "dialog" "alert" "notification" "log" "delay" "say" "beep" "run"
      "launch" "quit" "open" "close" "count" "make" "delete" "duplicate" "exists" "move"
      "choose" "do" "keystroke" "click" "get"))

  ;; The words that share a hash with a table word, or hold an apostrophe,
  ;; matched in the lowercased copy of $n bytes: their token, or -1.
  (func $applescriptWord (param $n i32) (result i32)
    (local $w i64)
    (if (i32.gt_u (local.get $n) (i32.const 7))
      (then (return (i32.const -1))))
    (local.set $w
      (i64.and
        (i64.load (i32.const $mem.lexLowerScratch))
        (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3)))) (i64.const 1))))
    (if (i32.or (i64.eq (local.get $w) (i64.const "where")) (i64.eq (local.get $w) (i64.const "whose")))
      (then (return (enum.get $Token.keyword))))
    (if
      (i32.or
        (i64.eq (local.get $w) (i64.const "than"))
        (i32.or (i64.eq (local.get $w) (i64.const "isn't")) (i64.eq (local.get $w) (i64.const "doesn't"))))
      (then (return (enum.get $Token.keyword.operator))))
    (select (enum.get $Token.variable.special) (i32.const -1) (i64.eq (local.get $w) (i64.const "result"))))

  ;; $lineStart is 1 before the first token of a line; a `¬` joins the next
  ;; line to the statement instead. $expect is what a keyword awaits (see
  ;; $applescriptWords), or 3 for the rest of a handler's first line, whose
  ;; names are parameters.
  (func $hlApplescript
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $n i32)
    (local $hl i32)
    (local $head i32)
    (local $lineStart i32)
    (local $expect i32)
    (local.set $lineStart (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; $tok emits [$lhs,$ptr) as $hl
        (block $tok
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $lineStart (i32.const 1))
            (local.set $expect (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $head (local.get $lineStart))
        (local.set $lineStart (i32.const 0))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const "-"))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "(*") (i32.const "*)") (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `«class pnam»` raw codes, `¬`, and the operators `÷ ≠ ≤ ≥`
        (if
          (i32.and
            (i32.ge_u (local.get $c) (i32.const 0xc2))
            (i32.le_u (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))
          (then
            (local.set $v (i32.load16_u (local.get $lhs)))
            (if (i32.eq (local.get $v) (i32.const 0xabc2))
              (then
                (local.set $p (i32.add (local.get $lhs) (i32.const 2)))
                (block $rawDone
                  (loop $raw
                    (local.set $p
                      (call $scanFindSpecial
                        (local.get $p)
                        (global.get $end)
                        (i32.const 0xbb)
                        (i32.const 0)
                        (i32.const 1)))
                    (br_if $rawDone (i32.ne (call $templateByte (local.get $p)) (i32.const 0xbb)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br_if $raw (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 2))) (i32.const 0xc2)))))
                (global.set $ptr (local.get $p))
                (local.set $hl (enum.get $Token.constant))
                (br $tok)))
            (if (i32.eq (local.get $v) (i32.const 0xacc2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                ;; consume the line break so the next line continues this one
                (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                (local.set $v (call $templateByte (local.get $p)))
                (if (i32.and (i32.lt_u (local.get $p) (global.get $end)) (byteset.get "\n\r" (local.get $v)))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (if
                      (i32.and
                        (i32.eq (local.get $v) (i32.const 13))
                        (i32.eq (call $templateByte (local.get $p)) (i32.const 10)))
                      (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                    (call $emitGap (global.get $ptr) (local.get $p))
                    (global.set $ptr (local.get $p))))
                (br $next)))
            (local.set $p (local.get $lhs))
            (if (i32.eq (local.get $v) (i32.const 0xb7c3))
              (then (local.set $p (i32.add (local.get $lhs) (i32.const 2)))))
            (if (i32.le_u (i32.add (local.get $lhs) (i32.const 3)) (global.get $end))
              (then
                (local.set $v (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)))
                (if
                  (i32.or
                    (i32.eq (local.get $v) (i32.const 0xa089e2))
                    (i32.or (i32.eq (local.get $v) (i32.const 0xa489e2)) (i32.eq (local.get $v) (i32.const 0xa589e2))))
                  (then (local.set $p (i32.add (local.get $lhs) (i32.const 3)))))))
            (if (i32.gt_u (local.get $p) (local.get $lhs))
              (then
                (global.set $ptr (local.get $p))
                (local.set $hl (enum.get $Token.operator))
                (br $tok)))))
        ;; `|name with spaces|`
        (if (i32.eq (local.get $c) (i32.const "|"))
          (then
            (local.set $p
              (call $scanFindSpecial
                (i32.add (local.get $lhs) (i32.const 1))
                (global.get $end)
                (i32.const "|")
                (i32.const 0)
                (i32.const 1)))
            (local.set $hl (enum.get $Token.none))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if (i32.eq (call $templateByte (local.get $p)) (i32.const "|"))
              (then
                (local.set $hl (enum.get $Token.variable))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (if (i32.eq (local.get $expect) (i32.const 2))
                  (then (local.set $expect (i32.const 0))))))
            (br $tok)))
        ;; the possessive `'s`, as in `window's name`
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $hl (enum.get $Token.none))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "s"))
                (i32.eqz (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))))
              (then
                (local.set $hl (enum.get $Token.keyword.operator))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (br $tok)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            ;; `isn't` and `doesn't`
            (if
              (i32.and
                (i32.and
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const 39))
                  (i32.eq
                    (i32.or (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 32))
                    (i32.const "t")))
                (i32.eqz (call $lexIsIdentContinue (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (local.set $rhs (global.get $ptr))
            (local.set $n
              (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
            (local.set $v
              (keyword-table.value $applescriptWords
                (i32.const $mem.lexLowerScratch)
                (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
            (if (i32.lt_s (local.get $v) (i32.const 0))
              (then (local.set $v (call $applescriptWord (local.get $n)))))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $c2 (call $templateByte (local.get $p)))
            (block $classified
              (if (i32.ge_s (local.get $v) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                  (local.set $v (i32.shr_u (local.get $v) (i32.const 8)))
                  ;; `repeat with i`
                  (if (i32.eq (local.get $expect) (i32.const 5))
                    (then
                      (local.set $expect
                        (select
                          (i32.const 2)
                          (i32.const 0)
                          (i32.and
                            (i32.eq (local.get $n) (i32.const 4))
                            (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "with")))))))
                  ;; `on run` and `on open` name handlers; `on error` and
                  ;; `end tell` keep their keywords
                  (if (i32.eq (local.get $expect) (i32.const 1))
                    (then
                      (if (i32.eq (local.get $hl) (enum.get $Token.function))
                        (then (local.set $hl (enum.get $Token.function.definition))))
                      (local.set $expect (i32.const 3))))
                  (if (i32.eq (local.get $v) (i32.const 1))
                    (then
                      (if (local.get $head)
                        (then (local.set $expect (i32.const 1)))
                        (else (local.set $hl (enum.get $Token.keyword))))
                      (br $classified)))
                  (if (i32.eq (local.get $v) (i32.const 3))
                    (then
                      ;; `missing value` and `shell script` are one term
                      (local.set $n (select (i32.const 5) (i32.const 6) (i32.eq (local.get $n) (i32.const 7))))
                      (if
                        (i32.and
                          (i32.le_u (i32.add (local.get $p) (local.get $n)) (global.get $end))
                          (i32.and
                            (i64.eq
                              (i64.and
                                (i64.or (i64.load (local.get $p)) (i64.const 0x2020202020202020))
                                (i64.sub
                                  (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
                                  (i64.const 1)))
                              (select (i64.const "value") (i64.const "script") (i32.eq (local.get $n) (i32.const 5))))
                            (i32.eqz
                              (call $lexIsIdentContinue
                                (call $templateByte (i32.add (local.get $p) (local.get $n)))))))
                        (then (local.set $rhs (i32.add (local.get $p) (local.get $n)))))
                      (br $classified)))
                  (if (local.get $v)
                    (then (local.set $expect (local.get $v))))
                  (br $classified)))
              (if (i32.eq (local.get $expect) (i32.const 1))
                (then
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $expect (i32.const 3))
                  (br $classified)))
              (local.set $v (local.get $expect))
              (if (i32.or (i32.eq (local.get $v) (i32.const 2)) (i32.eq (local.get $v) (i32.const 5)))
                (then (local.set $expect (i32.const 0))))
              ;; `name of x` and record keys such as `{name: x}`
              (local.set $hl (enum.get $Token.property))
              (br_if $classified
                (i32.or
                  (i32.eq (local.get $c2) (i32.const ":"))
                  (i32.and
                    (i32.le_u (i32.add (local.get $p) (i32.const 2)) (global.get $end))
                    (i32.and
                      (i32.eq (i32.or (i32.load16_u (local.get $p)) (i32.const 0x2020)) (i32.const "of"))
                      (i32.eqz
                        (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $p) (i32.const 2)))))))))
              (local.set $hl (enum.get $Token.function))
              (br_if $classified (i32.eq (local.get $c2) (i32.const "(")))
              (local.set $hl (enum.get $Token.none))
              (if (i32.eq (local.get $v) (i32.const 3))
                (then (local.set $hl (enum.get $Token.variable.parameter))))
              (if (i32.or (i32.eq (local.get $v) (i32.const 2)) (i32.eq (local.get $v) (i32.const 4)))
                (then (local.set $hl (enum.get $Token.variable)))))
            (global.set $ptr (local.get $rhs))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        ;; WARNING: frequent tokens keep their own emits; sending them to the
        ;; $tok tail made JavaScriptCore up to 30% slower
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ",:;" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            ;; `<=`, `>=`, and `<>`
            (if
              (i32.and
                (i32.eq (i32.or (local.get $c) (i32.const 2)) (i32.const ">"))
                (i32.or (i32.eq (local.get $c2) (i32.const "=")) (i32.eq (local.get $c2) (i32.const ">"))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (local.set $hl (enum.get $Token.none)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
