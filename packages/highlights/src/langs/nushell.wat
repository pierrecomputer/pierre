(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.nuWords 176)

  (import "@pierre/wat-tools/common.wat")

  ;; Each value is the word's token; the high byte says what follows: 1 a
  ;; command, 2 a definition name, 3 a variable name.
  (keyword-table $nuWords $mem.nuWords $mem.nuWords+176
    (group $Token.keyword.declaration+512 "def" "alias" "extern")
    (group $Token.keyword.declaration+768 "let" "mut" "const")
    (group $Token.keyword.control+768 "for")
    (group $Token.keyword.control
      "if" "else" "match" "while" "loop" "break" "continue" "return" "try" "catch")
    (group $Token.keyword.import+256 "export" "export-env")
    (group $Token.keyword.import "use" "source" "source-env" "module" "overlay" "hide")
    (group $Token.keyword.operator
      "and" "or" "xor" "not" "in" "not-in" "has" "not-has" "like" "not-like" "mod" "bit-and"
      "bit-or" "bit-xor" "bit-shl" "starts-with" "ends-with")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))

  ;; Scan a string body from $ptr; [$seg,$ptr) is not yet emitted. The low
  ;; byte of $kind is the quote; only `"` has escapes, and kind 256 and up
  ;; (`$"`, `$'`) opens an expression at `(`. Strings span lines. Returns 0
  ;; past the closing quote, 1 at an expression's `(`, 2 at $end.
  (func $nuStrBody (param $kind i32) (param $seg i32) (result i32)
    (local $q i32)
    (local $p i32)
    (local $c i32)
    (local.set $q (i32.and (local.get $kind) (i32.const 255)))
    (loop $l
      (local.set $p
        (call $scanFind3
          (global.get $ptr)
          (local.get $q)
          (select (i32.const 92) (local.get $q) (i32.eq (local.get $q) (i32.const 34)))
          (select (i32.const "(") (local.get $q) (i32.gt_u (local.get $kind) (i32.const 255)))))
      (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
      (global.set $ptr (local.get $p))
      (local.set $seg (local.get $p))
      (if (i32.lt_u (local.get $p) (global.get $end))
        (then
          (local.set $c (i32.load8_u (local.get $p)))
          (if (i32.eq (local.get $c) (i32.const "("))
            (then (return (i32.const 1))))
          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
          (if (i32.eq (local.get $c) (local.get $q))
            (then
              (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
              (return (i32.const 0))))
          (global.set $ptr (call $lexEscapeEnd (local.get $p)))
          (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
          (local.set $seg (global.get $ptr))
          (br $l))))
    (i32.const 2))

  ;; $cmd is 1 where a command may start. $expect is what the next word is:
  ;; 2 a definition name, 3 a variable name, 4 a type, 5 the `[` of a
  ;; signature, 6 a name that may take a `: type`. $sig counts the brackets
  ;; open in a signature, and $params is 2 before the `|x|` of a closure and
  ;; 1 inside it. $bits holds two bits per open bracket: 0 for `(` and `{`,
  ;; 3 for a list `[`, and 1 or 2 for the `(` of a `$"` or `$'` string, whose
  ;; `)` resumes the string. $str is the string kind to resume.
  (func $hlNushell
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $kind i32)
    (local $cmd i32)
    (local $expect i32)
    (local $sig i32)
    (local $params i32)
    (local $bits i32)
    (local $str i32)
    (local.set $cmd (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (block $string
          (local.set $lhs (global.get $ptr))
          (local.set $kind (local.get $str))
          (if (local.get $kind)
            (then
              (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $str (i32.const 0))
              (br $string)))
          (local.set $gap (global.get $ptr))
          (call $scanWhitespace)
          (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
            (then
              (local.set $cmd (i32.ne (i32.and (local.get $bits) (i32.const 3)) (i32.const 3)))
              (if (i32.ne (local.get $expect) (i32.const 6))
                (then (local.set $expect (i32.const 0))))))
          (call $emitGap (local.get $gap) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (local.get $lhs)))
          (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          ;; `#` comments only at the start of a word
          (local.set $v
            (select
              (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))
              (i32.const 32)
              (i32.gt_u (local.get $lhs) (global.get $srcBase))))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (byteset.get "\09\0a\0b\0c\0d \22'(),:;[]`{|}" (local.get $v)))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
              (br $next)))
          (local.set $kind (local.get $c))
          (br_if $string (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39))))
          (br_if $string (i32.eq (local.get $c) (i32.const "`")))
          (block $emit
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then
                (if (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39)))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                    (local.set $kind (i32.or (local.get $c2) (i32.const 256)))
                    (br $string)))
                (call $scanIdentRun (i32.const "_"))
                (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
                (local.set $v (i32.load offset=1 (local.get $lhs)))
                (local.set $hl (enum.get $Token.variable))
                (if
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 3))
                      (i32.or
                        (i32.eq (i32.and (local.get $v) (i32.const 0xffff)) (i32.const "in"))
                        (i32.eq (i32.and (local.get $v) (i32.const 0xffff)) (i32.const "nu"))))
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 4))
                      (i32.eq (i32.and (local.get $v) (i32.const 0xffffff)) (i32.const "env"))))
                  (then (local.set $hl (enum.get $Token.variable.special))))
                (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                ;; a cell path: `.name`, `.0`, each optional with `?`
                (block $pathDone
                  (loop $path
                    (local.set $lhs (global.get $ptr))
                    (br_if $pathDone (i32.ne (call $templateByte (local.get $lhs)) (i32.const ".")))
                    (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
                    (br_if $pathDone (i32.eqz (call $lexIsIdentContinue (local.get $c))))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                    (local.set $lhs (global.get $ptr))
                    (call $scanIdentRun (i32.const "-"))
                    (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "?"))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                    (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
                    (br $path)))
                (local.set $cmd (i32.const 0))
                (local.set $expect (i32.const 0))
                (br $next)))
            ;; raw strings `r#'...'#` with any number of `#`
            (if (i32.and (i32.eq (local.get $c) (i32.const "r")) (i32.eq (local.get $c2) (i32.const "#")))
              (then
                (local.set $p (global.get $ptr))
                (loop $hashes
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br_if $hashes (i32.eq (call $templateByte (local.get $p)) (i32.const "#"))))
                (if (i32.eq (call $templateByte (local.get $p)) (i32.const 39))
                  (then
                    (local.set $kind (i32.sub (local.get $p) (global.get $ptr)))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (block $closed
                      (loop $find
                        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 39)))
                        (br_if $closed (i32.ge_u (global.get $ptr) (global.get $end)))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (local.set $p (i32.const 0))
                        (block $counted
                          (loop $count
                            (br_if $counted (i32.ge_u (local.get $p) (local.get $kind)))
                            (br_if $counted
                              (i32.ne
                                (call $templateByte (i32.add (global.get $ptr) (local.get $p)))
                                (i32.const "#")))
                            (local.set $p (i32.add (local.get $p) (i32.const 1)))
                            (br $count)))
                        (br_if $find (i32.lt_u (local.get $p) (local.get $kind)))
                        (global.set $ptr (i32.add (global.get $ptr) (local.get $kind)))
                        (local.set $kind (i32.const 0))))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    ;; WARNING: the closer must fit the 32-byte delimiter region
                    (if (i32.and (i32.ne (local.get $kind) (i32.const 0)) (i32.lt_u (local.get $kind) (i32.const 32)))
                      (then
                        (i32.store8 (i32.const $mem.streamDelimiter) (i32.const 39))
                        (memory.fill (i32.const $mem.streamDelimiter+1) (i32.const "#") (local.get $kind))
                        (call $streamSetFixed
                          (i32.const $mem.streamDelimiter)
                          (i32.add (local.get $kind) (i32.const 1))
                          (enum.get $Token.string))))
                    (local.set $cmd (i32.const 0))
                    (local.set $expect (i32.const 0))
                    (br $next)))))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (byteset.get "([{" (local.get $c))
              (then
                (local.set $cmd (i32.ne (local.get $c) (i32.const "[")))
                (local.set $v (i32.mul (i32.eq (local.get $c) (i32.const "[")) (i32.const 3)))
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then
                    (local.set $params
                      (i32.shl
                        (i32.eq (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const "|"))
                        (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "["))
                  (then
                    (if (i32.or (local.get $sig) (i32.eq (local.get $expect) (i32.const 5)))
                      (then (local.set $sig (i32.add (local.get $sig) (i32.const 1)))))))
                (local.set $bits (i32.or (i32.shl (local.get $bits) (i32.const 2)) (local.get $v)))
                (local.set $expect (i32.const 0))
                (br $emit)))
            (if (byteset.get ")]}" (local.get $c))
              (then
                (local.set $v (i32.and (local.get $bits) (i32.const 3)))
                (local.set $bits (i32.shr_u (local.get $bits) (i32.const 2)))
                (local.set $cmd (i32.const 0))
                (local.set $expect (i32.const 0))
                (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.le_u (i32.sub (local.get $v) (i32.const 1)) (i32.const 1)))
                  (then
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                    (local.set $str (select (i32.const 290) (i32.const 295) (i32.eq (local.get $v) (i32.const 1))))
                    (br $next)))
                (if (i32.and (i32.eq (local.get $c) (i32.const "]")) (i32.ne (local.get $sig) (i32.const 0)))
                  (then
                    (local.set $sig (i32.sub (local.get $sig) (i32.const 1)))
                    (if (i32.eqz (local.get $sig))
                      (then (local.set $expect (i32.const 6))))))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const "|"))
              (then
                (local.set $cmd (i32.const 1))
                (local.set $expect (i32.const 0))
                (if (local.get $params)
                  (then
                    (local.set $params (i32.sub (local.get $params) (i32.const 1)))
                    (local.set $cmd (i32.eqz (local.get $params)))
                    (br $emit)))
                (local.set $hl (enum.get $Token.operator))
                (br $emit)))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c) (i32.const ",")))
              (then
                (local.set $cmd (i32.eq (local.get $c) (i32.const ";")))
                (local.set $expect (i32.const 0))
                (br $emit)))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (local.set $expect
                  (i32.shl
                    (i32.or (i32.ne (local.get $sig) (i32.const 0)) (i32.eq (local.get $expect) (i32.const 6)))
                    (i32.const 2)))
                (br $emit)))
            (local.set $v (local.get $expect))
            (local.set $expect (i32.const 0))
            ;; numbers with units, dates, and negative numbers
            (if
              (i32.or
                (call $lexIsDigit (local.get $c))
                (i32.and (byteset.get "+-" (local.get $c)) (call $lexIsDigit (local.get $c2))))
              (then
                (call $lexScanNumber)
                (if
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "-"))
                    (call $lexIsDigit (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))
                  (then
                    (loop $date
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (local.set $c (call $templateByte (global.get $ptr)))
                      (br_if $date
                        (byteset.get "$+-.0123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz" (local.get $c))))))
                (local.set $hl (enum.get $Token.number))
                (local.set $cmd (i32.const 0))
                (br $emit)))
            ;; `->` names the output type of a signature
            (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.operator))
                (local.set $expect (i32.const 4))
                (br $emit)))
            ;; `^git` runs an external command
            (if (i32.and (i32.eq (local.get $c) (i32.const "^")) (call $lexIsNameStart (local.get $c2)))
              (then
                (call $scanIdentRun (i32.const "-"))
                (local.set $hl (enum.get $Token.function))
                (local.set $cmd (i32.const 0))
                (br $emit)))
            ;; operators, except a `-` that starts a flag and the start of a
            ;; path: `/usr`, `./x`, `../x`, `~/x`
            (local.set $p (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
            (if
              (i32.and
                (byteset.get "!%&*+-./<=>?^|~" (local.get $c))
                (i32.eqz
                  (i32.or
                    (i32.or
                      (i32.and
                        (i32.eq (local.get $c) (i32.const "-"))
                        (i32.or (i32.eq (local.get $c2) (i32.const "-")) (call $lexIsNameStart (local.get $c2))))
                      (i32.and (i32.eq (local.get $c) (i32.const "/")) (call $lexIsNameStart (local.get $c2))))
                    (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "~")))
                      (i32.or
                        (i32.eq (local.get $c2) (i32.const "/"))
                        (i32.and
                          (i32.eq (local.get $c2) (i32.const "."))
                          (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $p) (i32.const "/")))))))))
              (then
                (block $opDone
                  (loop $op
                    (local.set $c2 (call $templateByte (global.get $ptr)))
                    (br_if $opDone (i32.eq (local.get $c2) (i32.const "|")))
                    (br_if $opDone (i32.eqz (byteset.get "!%&*+-./<=>?^|~" (local.get $c2))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))
                (local.set $hl (enum.get $Token.operator))
                ;; `let x = ls` runs a command
                (local.set $cmd
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "="))
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1))))
                (br $emit)))
            ;; a bare word runs to a blank, quote, bracket, `|`, `,`, `:`, or `;`
            (block $wordDone
              (loop $word
                (call $scanIdentRun (i32.const "-"))
                (local.set $c2 (call $templateByte (global.get $ptr)))
                (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $wordDone (byteset.get "\09\0a\0b\0c\0d \22'(),:;[]`{|}" (local.get $c2)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $word)))
            (local.set $hl (enum.get $Token.none))
            (block $classified
              (if (i32.eq (local.get $c) (i32.const "-"))
                (then
                  ;; flags come before the name a keyword awaits
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (local.set $expect (local.get $v))
                  (br $classified)))
              (if (i32.eq (local.get $v) (i32.const 2))
                (then
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $expect (i32.const 5))
                  (br $classified)))
              (if (i32.eq (local.get $v) (i32.const 3))
                (then
                  (local.set $hl (enum.get $Token.variable))
                  (local.set $expect (i32.const 6))
                  (br $classified)))
              (if (i32.eq (local.get $v) (i32.const 4))
                (then
                  (local.set $hl (enum.get $Token.type))
                  (br $classified)))
              (if (i32.or (local.get $sig) (i32.eq (local.get $params) (i32.const 1)))
                (then
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (br $classified)))
              (local.set $p (keyword-table.value $nuWords (local.get $lhs) (global.get $ptr)))
              (if (i32.ge_s (local.get $p) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $p) (i32.const 255)))
                  (local.set $p (i32.shr_u (local.get $p) (i32.const 8)))
                  (local.set $cmd (i32.eq (local.get $p) (i32.const 1)))
                  (local.set $expect (select (local.get $p) (i32.const 0) (i32.ge_u (local.get $p) (i32.const 2))))
                  (br $emit)))
              ;; a record key
              (if (i32.eq (local.get $c2) (i32.const ":"))
                (then
                  (local.set $hl (enum.get $Token.property))
                  (br $classified)))
              ;; redirections: `o>`, `e>`, `out>`, `o+e>`
              (if
                (i32.and
                  (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const ">"))
                  (i32.or (i32.eq (local.get $c) (i32.const "o")) (i32.eq (local.get $c) (i32.const "e"))))
                (then
                  (local.set $hl (enum.get $Token.operator))
                  (local.set $cmd (i32.const 0))
                  (br $emit)))
              (if (local.get $cmd)
                (then (local.set $hl (enum.get $Token.function)))))
            (local.set $cmd (i32.const 0)))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (br $next))
        ;; a string of $kind from $lhs, or resumed at $ptr
        (if (i32.eq (local.get $expect) (i32.const 2))
          (then (local.set $expect (i32.const 5)))
          (else (local.set $expect (i32.const 0))))
        (local.set $cmd (i32.const 0))
        (local.set $v (call $nuStrBody (local.get $kind) (local.get $lhs)))
        (if (i32.eq (local.get $v) (i32.const 1))
          (then
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $bits
              (i32.or
                (i32.shl (local.get $bits) (i32.const 2))
                (select (i32.const 1) (i32.const 2) (i32.eq (i32.and (local.get $kind) (i32.const 255)) (i32.const 34)))))
            (local.set $cmd (i32.const 1))))
        (if (i32.eq (local.get $v) (i32.const 2))
          (then (local.set $str (local.get $kind))))
        (br $next))))
)
