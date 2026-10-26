(module
  (import "../common.wat")

  ;; Keywords count only where a command may start. The high byte of a value
  ;; says what follows: 1 a command, 2 a function name, 3 a variable name
  ;; after options, 4 a loop variable and then `in`.
  (keyword-table $fishWords $mem.fishWords $mem.justWords
    (group $Token.keyword.control+256 "if" "while" "and" "or" "not" "else" "begin")
    (group $Token.keyword.control "switch" "case" "end" "return" "break" "continue" "exit")
    (group $Token.keyword.control+1024 "for")
    (group $Token.keyword.declaration+512 "function")
    (group $Token.keyword.declaration+768 "set")
    (group $Token.keyword+256 "time")
    (group $Token.function+256 "command" "builtin" "exec"))

  ;; Emit the expansion at `$`: `$name`, `$$name`, and an index such as
  ;; `$name[1..-1]` or `$name[$i]`. Without a name the `$` run is literal:
  ;; return 0 with $ptr past it, so the caller emits it once.
  (func $fishVariable (result i32)
    (local $lhs i32)
    (local $p i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (loop $dollars
      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
      (local.set $c (call $templateByte (global.get $ptr)))
      (br_if $dollars (i32.eq (local.get $c) (i32.const "$"))))
    (if (i32.eqz (call $lexIsIdentStart (local.get $c)))
      (then (return (i32.const 0))))
    (call $scanIdentRun (i32.const "_"))
    (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "["))
      (then
        (local.set $p (global.get $ptr))
        (loop $index
          (local.set $p (i32.add (local.get $p) (i32.const 1)))
          (local.set $c (call $templateByte (local.get $p)))
          ;; names, digits, `$`, `-`, and `.`
          (br_if $index
            (i32.or
              (call $lexIsIdentContinue (local.get $c))
              (i32.le_u (i32.sub (local.get $c) (i32.const "-")) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const "]"))
          (then (global.set $ptr (i32.add (local.get $p) (i32.const 1)))))))
    (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  ;; Scan a quoted body from $ptr; $seg is the first byte not yet emitted.
  ;; Single quotes escape only `\'` and `\\`; double quotes also escape `\$`
  ;; and a line break, and expand variables. Returns 0 past the closing
  ;; quote, 1 at a `$(` inside double quotes, 2 at $end.
  (func $fishStringBody (param $q i32) (param $seg i32) (result i32)
    (local $p i32)
    (local $c i32)
    (block $done
      (loop $l
        (local.set $p
          (if (result i32) (i32.eq (local.get $q) (i32.const 34))
            (then (call $scanFind3 (global.get $ptr) (i32.const 34) (i32.const 92) (i32.const "$")))
            (else (call $lexFindEither (global.get $ptr) (i32.const 39) (i32.const 92)))))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (br_if $l
              (i32.eqz
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $c) (local.get $q)))
                  (i32.and
                    (i32.eq (local.get $q) (i32.const 34))
                    (i32.or (i32.eq (local.get $c) (i32.const "$")) (byteset.get "\n\r" (local.get $c)))))))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (call $lexEscapeEnd (local.get $p)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (if (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "("))
          (then (return (i32.const 1))))
        (local.set $seg (local.get $p))
        (if (call $fishVariable)
          (then (local.set $seg (global.get $ptr))))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 2))

  ;; $cmd is 1 where a command may start, and $expect is what a keyword
  ;; awaits (see $fishWords), or 5 for the `in` of a `for` loop. $str is the
  ;; quote of a string that continues from an earlier line or after a `$(`
  ;; closes. $bits holds one bit per open parenthesis, set for a `$(` inside
  ;; double quotes so its `)` returns to the string.
  (func $hlFish
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $v i32)
    (local $hl i32)
    (local $head i32)
    (local $cmd i32)
    (local $expect i32)
    (local $str i32)
    (local $bits i32)
    (local.set $cmd (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $str)
          (then
            (local.set $v (call $fishStringBody (local.get $str) (global.get $ptr)))
            (br_if $done (i32.eq (local.get $v) (i32.const 2)))
            (local.set $str (i32.const 0))
            (if (local.get $v)
              (then
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $bits (i32.or (i32.shl (local.get $bits) (i32.const 1)) (i32.const 1)))
                (local.set $cmd (i32.const 1))))
            (br $next)))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $cmd (i32.const 1))
            (local.set $expect (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        ;; `#` comments only at the start of a word; `a#b` is one word
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.or
              (i32.or (local.get $cmd) (i32.eq (local.get $lhs) (global.get $srcBase)))
              (call $lexIsSpace (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $str (local.get $c))
            (local.set $cmd (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (local.set $expect (i32.const 0))
            (if (i32.eq (local.get $c2) (i32.const "("))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $bits (i32.shl (local.get $bits) (i32.const 1)))
                (local.set $cmd (i32.const 1))
                (br $next)))
            (local.set $cmd (i32.const 0))
            (br_if $next (call $fishVariable))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $v (call $lexEscapeEnd (local.get $lhs)))
            ;; `\` before a line break joins the next line to this command
            (if (byteset.get "\n\r" (local.get $c2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (call $emitGap (global.get $ptr) (local.get $v))
                (global.set $ptr (local.get $v))
                (br $next)))
            ;; the most hex digits after `\x`, `\u`, or `\U`
            (local.set $hl
              (select
                (i32.const 2)
                (select
                  (i32.const 4)
                  (i32.shl (i32.eq (local.get $c2) (i32.const "U")) (i32.const 3))
                  (i32.eq (local.get $c2) (i32.const "u")))
                (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "x"))))
            (if (local.get $hl)
              (then (local.set $v (call $scanHexRun (i32.add (local.get $lhs) (i32.const 2)) (local.get $hl)))))
            (global.set $ptr (local.get $v))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $bits (i32.shl (local.get $bits) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (i32.and (local.get $bits) (i32.const 1))
                  (then
                    (local.set $str (i32.const 34))
                    (local.set $hl (enum.get $Token.punctuation.special))))
                (local.set $bits (i32.shr_u (local.get $bits) (i32.const 1)))))
            (local.set $cmd (i32.eq (local.get $c) (i32.const "(")))
            (local.set $expect (i32.const 0))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "&;<>|" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $op (byteset.get "&;<>|" (local.get $v)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            ;; `;`, pipes, `&&`, and `&` start a command; redirections do not
            (local.set $v (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
            (local.set $cmd
              (i32.or
                (i32.eq (local.get $c) (i32.const ";"))
                (i32.or
                  (i32.eq (local.get $v) (i32.const "|"))
                  (i32.and (i32.eq (local.get $v) (i32.const "&")) (i32.eq (local.get $c) (i32.const "&"))))))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.and (local.get $cmd) (i32.eq (local.get $c) (i32.const "!")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; a word runs to a blank, quote, `$`, `\`, bracket, or operator
        (call $scanIdentRun (i32.const "-"))
        (local.set $rhs (global.get $ptr))
        (block $wordDone
          (loop $word
            (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $v (i32.load8_u (global.get $ptr)))
            (br_if $wordDone (byteset.get "\09\0a\0b\0c\0d \22$&'()\5c;<>[]{}|" (local.get $v)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "-"))
            (br $word)))
        (local.set $head (local.get $cmd))
        (local.set $cmd (i32.const 0))
        ;; `NAME=value cmd` sets a variable for one command
        (if
          (i32.and
            (local.get $head)
            (i32.and
              (i32.gt_u (local.get $rhs) (local.get $lhs))
              (i32.eq (call $templateByte (local.get $rhs)) (i32.const "="))))
          (then
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (local.get $rhs))
            (local.set $lhs (i32.add (local.get $rhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $rhs) (local.get $lhs))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (local.set $cmd (i32.const 1))
            (br $next)))
        (local.set $rhs (global.get $ptr))
        (local.set $v (local.get $expect))
        (local.set $expect (i32.const 0))
        (local.set $hl (enum.get $Token.none))
        (block $classified
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1)))
            (then
              (local.set $hl (enum.get $Token.variable.parameter))
              ;; options come before the name a keyword awaits
              (local.set $expect (local.get $v))
              (local.set $cmd (local.get $head))
              (br $classified)))
          (if (i32.eq (local.get $v) (i32.const 5))
            (then
              (if
                (i32.and
                  (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                  (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "in")))
                (then (local.set $hl (enum.get $Token.keyword.control))))
              (br $classified)))
          (if (local.get $v)
            (then
              (local.set $hl
                (select
                  (enum.get $Token.function.definition)
                  (enum.get $Token.variable)
                  (i32.eq (local.get $v) (i32.const 2))))
              (local.set $expect (select (i32.const 5) (i32.const 0) (i32.eq (local.get $v) (i32.const 4))))
              (br $classified)))
          (if (local.get $head)
            (then
              (local.set $hl (enum.get $Token.function))
              (local.set $v (keyword-table.value $fishWords (local.get $lhs) (local.get $rhs)))
              (if (i32.ge_s (local.get $v) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                  (local.set $v (i32.shr_u (local.get $v) (i32.const 8)))
                  (local.set $cmd (i32.eq (local.get $v) (i32.const 1)))
                  (local.set $expect (select (local.get $v) (i32.const 0) (i32.ge_u (local.get $v) (i32.const 2))))))
              (br $classified)))
          (if (call $lexIsDigit (local.get $c))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexScanNumber)
              (if (i32.eq (global.get $ptr) (local.get $rhs))
                (then (local.set $hl (enum.get $Token.number))))
              (global.set $ptr (local.get $rhs)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
        (br $next))))
)
