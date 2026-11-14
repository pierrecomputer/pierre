(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.ahkWords 192)

  (import "@pierre/wat-tools/common.wat")

  ;; Words are looked up lowercase. Bit 8: the statement goes on after the
  ;; word (`else MsgBox`). Bit 9: the next word names a class. Bit 10: the
  ;; next word may start a definition (`static Name() {`).
  (keyword-table $ahkWords $mem.ahkWords $mem.ahkWords+192
    (group $Token.keyword.control+256 "else" "try" "finally")
    (group $Token.keyword.control
      "if" "while" "loop" "for" "in" "return" "break" "continue" "catch" "throw" "switch" "case"
      "default" "until" "goto" "gosub" "exit" "exitapp" "as")
    (group $Token.keyword.declaration "global" "local")
    (group $Token.keyword.declaration+1024 "static")
    (group $Token.keyword.declaration+512 "class" "extends")
    (group $Token.keyword.operator "and" "or" "not" "is" "new")
    (group $Token.boolean "true" "false")
    (group $Token.variable.special "this" "super"))

  ;; The end of the hotkey or hotstring label at $p, past its `::`, or 0.
  ;; A hotstring is `:options:abbreviation::`. A hotkey is modifiers, a key
  ;; name or one character, an optional `& key` and ` Up`, then `::`.
  (func $ahkHotkeyEnd (param $p i32) (result i32)
    (local $c i32)
    (local $q i32)
    (local $keys i32)
    (if (i32.eq (i32.load8_u (local.get $p)) (i32.const ":"))
      (then
        (local.set $p (call $scanFind3 (i32.add (local.get $p) (i32.const 1)) (i32.const ":") (i32.const 10) (i32.const 13)))
        (loop $abbr
          (if (i32.ne (call $templateByte (local.get $p)) (i32.const ":"))
            (then (return (i32.const 0))))
          (local.set $p (call $scanFind3 (i32.add (local.get $p) (i32.const 1)) (i32.const ":") (i32.const 10) (i32.const 13)))
          (if (i32.ne (call $templateByte (local.get $p)) (i32.const ":"))
            (then (return (i32.const 0))))
          (br_if $abbr (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":"))))
        (return (i32.add (local.get $p) (i32.const 2)))))
    (block $modsDone
      (loop $mods
        (local.set $c (call $templateByte (local.get $p)))
        (br_if $modsDone (i32.eqz (byteset.get "!#$*+<>^~" (local.get $c))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $mods)))
    (block $keysDone
      (loop $key
        (local.set $c (call $templateByte (local.get $p)))
        (br_if $keysDone (i32.le_u (local.get $c) (i32.const 32)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 1)) (global.get $end)))
        (if (call $lexIsIdentContinue (local.get $c))
          (then (call $scanIdentRun (i32.const "_"))))
        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
        (local.set $c (call $templateByte (local.get $p)))
        (br_if $keysDone (i32.or (i32.ne (local.get $c) (i32.const "&")) (local.get $keys)))
        (local.set $keys (i32.const 1))
        (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.eq (call $templateByte (local.get $p)) (i32.const "~"))))
        (br $key)))
    (if (i32.eq (i32.or (call $templateByte (local.get $p)) (i32.const 32)) (i32.const "u"))
      (then
        (local.set $q (i32.add (local.get $p) (i32.const 1)))
        (if (i32.eq (i32.or (call $templateByte (local.get $q)) (i32.const 32)) (i32.const "p"))
          (then (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $q) (i32.const 1))))))))
    (select
      (i32.add (local.get $p) (i32.const 2))
      (i32.const 0)
      (i32.and
        (i32.eq (call $templateByte (local.get $p)) (i32.const ":"))
        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))))

  ;; A one-line string. The backtick escapes, and `""` is a v1 quote.
  (func $ahkString (param $q i32)
    (local $seg i32)
    (local $p i32)
    (local $e i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (local.get $seg) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $scanFind3 (global.get $ptr) (local.get $q) (i32.const "`") (i32.const 10)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $e (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $e) (i32.const 10))
          (then
            (global.set $ptr (i32.sub (local.get $p)
              (i32.and (i32.gt_u (local.get $p) (local.get $seg))
                (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 13)))))
            (br $done)))
        (if (i32.eq (local.get $e) (local.get $q))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (br_if $done (i32.ne (call $templateByte (global.get $ptr)) (i32.const 34)))
            (br_if $done (i32.ne (local.get $q) (i32.const 34)))
            (local.set $e (i32.add (local.get $p) (i32.const 2))))
          (else
            (local.set $e (call $ahkEscapeEnd (local.get $p)))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $e))
        (local.set $seg (local.get $e))
        (global.set $ptr (local.get $e))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  ;; The end of the backtick escape at $p: one whole character, but never a
  ;; line break.
  (func $ahkEscapeEnd (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.or (i32.eqz (local.get $c)) (byteset.get "\0a\0d" (local.get $c)))
      (then (return (i32.add (local.get $p) (i32.const 1)))))
    (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 2)) (global.get $end)))

  ;; The end of a `%name%` deref at $p, or $p when there is none.
  (func $ahkDerefEnd (param $p i32) (result i32)
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (call $scanIdentRun (i32.const "_"))
    (select
      (i32.add (global.get $ptr) (i32.const 1))
      (local.get $p)
      (i32.and
        (i32.gt_u (global.get $ptr) (i32.add (local.get $p) (i32.const 1)))
        (i32.eq (call $templateByte (global.get $ptr)) (i32.const "%")))))

  ;; $mid is 0 for the first token of a line and $pos 0 at a statement start.
  ;; $args is set in the text arguments of a v1 command (`MsgBox, text`), and
  ;; $section inside a `(` ... `)` continuation section. $expect is 1 when
  ;; the next word names a class, $member 1 after a `.`.
  (func $hlAhk
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $first i32)
    (local $mid i32)
    (local $pos i32)
    (local $args i32)
    (local $section i32)
    (local $expect i32)
    (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $mid (i32.const 0))
            (local.set $pos (i32.const 0))
            (local.set $args (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $first (i32.eqz (local.get $mid)))
        (local.set $mid (i32.const 1))
        (if (i32.and (local.get $section) (local.get $first))
          (then
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (local.set $section (i32.const 0))
                (local.set $pos (i32.const 1))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr)))
              (else
                (call $lexLineComment (i32.const 0) (enum.get $Token.string))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ";"))
              (i32.or (local.get $first)
                (call $lexIsSpace (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (local.get $first)
          (then
            (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
              (then
                (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (local.set $p (call $ahkHotkeyEnd (local.get $lhs)))
            (global.set $ptr (local.get $lhs))
            (if (local.get $p)
              (then
                (local.set $p (i32.sub (local.get $p) (i32.const 2)))
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (if (i32.eq (local.get $c) (i32.const ":"))
                  (then
                    (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (local.get $p))
                    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                    (local.set $lhs (global.get $ptr))
                    (call $scanToLineEnd)
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr)))
                  (else
                    (call $emitTok (enum.get $Token.function.definition) (local.get $lhs) (local.get $p))
                    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                    (local.set $pos (i32.const 0))))
                (br $next)))
            ;; `(` without `)` on its line opens a continuation section
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $p (call $scanFind3 (local.get $lhs) (i32.const ")") (i32.const 10) (i32.const 13)))
                (if (i32.ne (call $templateByte (local.get $p)) (i32.const ")"))
                  (then
                    (local.set $section (i32.const 1))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                    (call $lexLineComment (i32.const 0) (enum.get $Token.attribute))
                    (br $next)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (call $lexIsNameStart (local.get $c2)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $scanIdentRun (i32.const "_"))
                (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
                ;; `#If` and `#HotIf` take an expression, other directives text
                (local.set $v (i32.or (i32.load (i32.add (local.get $lhs) (i32.const 1))) (i32.const 0x20202020)))
                (local.set $args
                  (i32.eqz
                    (i32.or
                      (i32.eq (i32.and (local.get $v) (i32.const 0xffff)) (i32.const "if"))
                      (i32.eq (local.get $v) (i32.const "hoti")))))
                (local.set $pos (i32.const 1))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (global.set $ptr (call $ahkDerefEnd (local.get $lhs)))
            (if (i32.gt_u (global.get $ptr) (local.get $lhs))
              (then
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            ;; `% expr` forces an expression
            (if (call $lexIsSpace (local.get $c2))
              (then (local.set $args (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (global.set $ptr (call $ahkEscapeEnd (local.get $lhs)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            ;; a key name like `{Enter}` in command text
            (if (local.get $args)
              (then
                (global.set $ptr (call $scanFind3 (local.get $lhs) (i32.const "}") (i32.const 10) (i32.const 13)))
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                    (br $next)))))))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (local.get $args)
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $textDone
              (loop $text
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $textDone (byteset.get "\00\0a\0d%,;`{" (local.get $c)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $text)))
            (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (local.set $hl (local.get $pos))
        (local.set $pos (i32.const 1))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $ahkString (local.get $c))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsNameStart (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (local.set $c (call $templateByte (global.get $ptr)))
            (local.set $v
              (call $lexLowerCopy (local.get $lhs) (global.get $ptr) (i32.const $mem.lexLowerScratch)))
            (local.set $v
              (select
                (i32.const -1)
                (keyword-table.value $ahkWords (i32.const $mem.lexLowerScratch)
                  (i32.add (i32.const $mem.lexLowerScratch) (local.get $v)))
                (local.get $member)))
            (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
            (block $kind
              (if (local.get $expect)
                (then
                  (local.set $expect (i32.const 0))
                  (local.set $hl (enum.get $Token.type))
                  (br $kind)))
              (if (i32.ge_s (local.get $v) (i32.const 0))
                (then
                  (if (i32.and (local.get $v) (i32.const 256))
                    (then (local.set $pos (i32.const 0))))
                  (local.set $expect (i32.shr_u (local.get $v) (i32.const 9)))
                  (if (i32.gt_u (local.get $expect) (i32.const 1))
                    (then
                      (local.set $expect (i32.const 0))
                      (local.set $mid (i32.const 0))))
                  (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                  (br $kind)))
              (if (i32.eq (local.get $c) (i32.const "("))
                (then
                  (local.set $hl (enum.get $Token.function))
                  (br_if $kind (i32.eqz (local.get $first)))
                  ;; `Name(params) {` or `Name(params) =>` defines a function
                  (local.set $p (global.get $ptr))
                  (local.set $v (i32.const 0))
                  (block $parenDone
                    (loop $paren
                      (local.set $c (call $templateByte (local.get $p)))
                      (br_if $kind (i32.or (i32.eqz (local.get $c)) (byteset.get "\0a\0d" (local.get $c))))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (local.set $v (i32.add (local.get $v)
                        (i32.sub (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))))
                      (br_if $parenDone (i32.eqz (local.get $v)))
                      (br $paren)))
                  (local.set $p (call $lexSkipSpaceAt (local.get $p)))
                  (local.set $c (call $templateByte (local.get $p)))
                  (if (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.and (i32.eq (local.get $c) (i32.const "="))
                          (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">"))))
                    (then (local.set $hl (enum.get $Token.function.definition))))
                  (br $kind)))
              (if (local.get $member)
                (then
                  (local.set $hl (enum.get $Token.property))
                  (br $kind)))
              (if (i32.and (i32.eq (i32.or (i32.load8_u (local.get $lhs)) (i32.const 32)) (i32.const "a"))
                    (i32.eq (i32.load8_u offset=1 (local.get $lhs)) (i32.const "_")))
                (then
                  (local.set $hl (enum.get $Token.variable.special))
                  (br $kind)))
              ;; `name:` alone is a label
              (if (i32.and (local.get $first)
                    (i32.and (i32.eq (local.get $c) (i32.const ":"))
                      (i32.eqz (byteset.get "=:" (local.get $c2)))))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $pos (i32.const 0))
                  (local.set $hl (enum.get $Token.label))
                  (br $kind)))
              (if (local.get $hl)
                (then
                  (local.set $hl (enum.get $Token.none))
                  (br $kind)))
              ;; a command starts a statement, unless an assignment or
              ;; expression follows the word
              (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
              (local.set $c2 (call $templateByte (local.get $p)))
              (local.set $hl (enum.get $Token.function))
              (if (i32.or (byteset.get "!&*+-/:<=>?^|~" (local.get $c2))
                    (i32.or (i32.eq (local.get $c) (i32.const "."))
                      (i32.eq (local.get $c) (i32.const "["))))
                (then (local.set $hl (enum.get $Token.none))))
              (if (i32.or (i32.eq (local.get $c2) (i32.const ","))
                    (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.gt_u (local.get $p) (global.get $ptr))))
                (then
                  (local.set $args (i32.const 1))
                  (if (i32.eq (local.get $c2) (i32.const "{"))
                    (then
                      (local.set $c (call $templateByte (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1)))))
                      (if (i32.or (i32.eqz (local.get $c)) (byteset.get "\0a\0d" (local.get $c)))
                        (then
                          (local.set $args (i32.const 0))
                          (local.set $hl (enum.get $Token.property)))))))))
            (local.set $member (i32.const 0))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        (local.set $member (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (local.set $member (call $lexIsNameStart (local.get $c2)))
            (if (i32.eq (local.get $c2) (i32.const "="))
              (then
                (local.set $hl (enum.get $Token.operator))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then (local.set $pos (i32.const 0))))))
        (if (byteset.get "!&*+-/:<=>?^|~" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!&*+-/:<=>?^|~" (local.get $c))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
