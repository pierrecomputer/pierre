(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.berryWords 112)

  (import "@pierre/wat-tools/common.wat")

  ;; Each value is the word's token; the high byte says what the next name
  ;; is: 1 a function after `def`, 2 a type after `class`.
  (keyword-table $berryWords $mem.berryWords $mem.berryWords+112
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "nil")
    (group $Token.variable.special "self" "super")
    (group $Token.keyword.control
      "if" "elif" "else" "end" "for" "while" "do" "break" "continue" "return" "try" "except"
      "raise")
    (group $Token.keyword.declaration "var" "static")
    (group $Token.keyword.declaration+256 "def")
    (group $Token.keyword.declaration+512 "class")
    (group $Token.keyword.import "import")
    (group $Token.keyword "as"))

  ;; Scan a string body from $ptr; [$seg,$ptr) is not yet emitted. In an
  ;; f-string ($f) a `{` opens a field and `{{` is a literal brace. Strings
  ;; end at a line break, and a `\` before one does not continue them.
  ;; Returns 0 past the closing quote, 1 at a field's `{`, 2 at a line break
  ;; or $end.
  (func $berryStrBody (param $q i32) (param $f i32) (param $seg i32) (result i32)
    (local $p i32)
    (local $stop i32)
    (local $e i32)
    (local $c i32)
    (loop $l
      (local.set $stop
        (call $scanFindSpecial (global.get $ptr) (global.get $end) (local.get $q) (i32.const 1) (i32.const 1)))
      (if (local.get $f)
        (then
          (local.set $p (global.get $ptr))
          (block $found
            (loop $brace
              (br_if $found (i32.ge_u (local.get $p) (local.get $stop)))
              (br_if $found (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $brace)))
          (if (i32.lt_u (local.get $p) (local.get $stop))
            (then
              (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
              (global.set $ptr (local.get $p))
              (if (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "{"))
                (then (return (i32.const 1))))
              (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
              (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
              (local.set $seg (global.get $ptr))
              (br $l)))))
      (global.set $ptr (local.get $stop))
      (if (i32.lt_u (global.get $ptr) (global.get $end))
        (then
          (local.set $c (i32.load8_u (global.get $ptr)))
          (if (i32.eq (local.get $c) (local.get $q))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
              (return (i32.const 0))))
          (if (i32.eq (local.get $c) (i32.const 92))
            (then
              (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
              (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
              (local.set $e
                (select
                  (i32.add (global.get $ptr) (i32.const 1))
                  (call $lexCEscapeEnd (global.get $ptr))
                  (byteset.get "\n\r" (local.get $c))))
              (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
              (global.set $ptr (local.get $e))
              (local.set $seg (local.get $e))
              (br $l))))))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 2))

  ;; $str is the quote of the f-string whose field is open, so its `}`
  ;; returns to the string. $decl is 1 after `def` and 2 after `class` or a
  ;; class name followed by `:`. $member is 1 after `.`, and $lambda 1 in
  ;; the parameters of `/ a, b -> ...`.
  (func $hlBerry
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $str i32)
    (local $decl i32)
    (local $member i32)
    (local $lambda i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (block $string
          (local.set $gap (global.get $ptr))
          (call $scanWhitespace)
          (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
            (then
              (local.set $str (i32.const 0))
              (local.set $lambda (i32.const 0))))
          (call $emitGap (local.get $gap) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (local.get $lhs)))
          (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (global.set $ptr (local.get $lhs))
              (if (i32.ne (local.get $c2) (i32.const "-"))
                (then
                  (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                  (br $next)))
              ;; `#- ... -#`; the `-` of the opener cannot close it
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (local.set $v (i32.const 0))
              (block $closed
                (loop $find
                  (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "#")))
                  (br_if $closed (i32.ge_u (global.get $ptr) (global.get $end)))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $v
                    (i32.and
                      (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 3)))
                      (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 2))) (i32.const "-"))))
                  (br_if $find (i32.eqz (local.get $v)))))
              (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
              (if (i32.eqz (local.get $v))
                (then (call $streamSetFixed32 (i32.const "-#") (i32.const 2) (enum.get $Token.comment))))
              (br $next)))
          (local.set $v (i32.const 0))
          (br_if $string (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39))))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "f"))
              (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
              (local.set $c (local.get $c2))
              (local.set $v (i32.const 1))
              (br $string)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.ne (local.get $str) (i32.const 0)))
            (then
              (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
              (local.set $lhs (global.get $ptr))
              (local.set $c (local.get $str))
              (local.set $str (i32.const 0))
              (local.set $v (i32.const 1))
              (br $string)))
          (if
            (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (local.set $decl (i32.const 0))
              (local.set $member (i32.const 0))
              (br $next)))
          (if (call $lexIsNameStart (local.get $c))
            (then
              (call $scanIdentRun (i32.const "_"))
              (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
              (local.set $c2 (call $templateByte (local.get $p)))
              (local.set $v (keyword-table.value $berryWords (local.get $lhs) (global.get $ptr)))
              (block $classified
                (if (local.get $member)
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.eq (local.get $c2) (i32.const "("))))
                    (br $classified)))
                (if (i32.eq (local.get $decl) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (br $classified)))
                (if (local.get $decl)
                  (then
                    (local.set $hl (enum.get $Token.type))
                    (local.set $decl (i32.shl (i32.eq (local.get $c2) (i32.const ":")) (i32.const 1)))
                    (br $classified)))
                (if (local.get $lambda)
                  (then
                    (local.set $hl (enum.get $Token.variable.parameter))
                    (br $classified)))
                (if (i32.ge_s (local.get $v) (i32.const 0))
                  (then
                    (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                    (local.set $decl (i32.shr_u (local.get $v) (i32.const 8)))
                    (br $classified)))
                (local.set $hl (enum.get $Token.variable))
                (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                  (then (local.set $hl (enum.get $Token.constant))))
                (if (i32.eq (local.get $c2) (i32.const "("))
                  (then (local.set $hl (enum.get $Token.function)))))
              (if (i32.ne (local.get $hl) (enum.get $Token.type))
                (then
                  (if (i32.lt_s (local.get $v) (i32.const 256))
                    (then (local.set $decl (i32.const 0))))))
              (local.set $member (i32.const 0))
              (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (local.set $hl (enum.get $Token.punctuation.bracket))
          (local.set $member (i32.const 0))
          (block $emit
            (br_if $emit (byteset.get "()[]{}" (local.get $c)))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (br_if $emit (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";"))))
            (if (i32.eq (local.get $c) (i32.const "."))
              (then
                (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
                (br_if $emit (local.get $member))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (local.set $hl (enum.get $Token.operator))
            (local.set $lambda (i32.const 0))
            ;; `/ a, b ->` opens a lambda whose names are parameters
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (local.set $p (global.get $ptr))
                (block $look
                  (loop $params
                    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
                    (local.set $c2 (call $templateByte (local.get $p)))
                    (if (i32.eq (local.get $c2) (i32.const "-"))
                      (then
                        (local.set $lambda
                          (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">")))
                        (br $look)))
                    (br_if $look
                      (i32.eqz
                        (i32.or
                          (call $lexIsIdentContinue (local.get $c2))
                          (i32.eq (local.get $c2) (i32.const ",")))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $params)))))
            ;; a class name keeps its `:` base clause
            (br_if $emit (i32.eq (local.get $c) (i32.const ":")))
            (local.set $decl (i32.const 0)))
          (if (i32.ne (local.get $hl) (enum.get $Token.operator))
            (then (local.set $decl (i32.const 0))))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (br $next))
        ;; a string from $lhs, its quote in $c, $v set for an f-string
        (if (i32.eq (call $berryStrBody (local.get $c) (local.get $v) (local.get $lhs)) (i32.const 1))
          (then
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $str (local.get $c))))
        (local.set $decl (i32.const 0))
        (local.set $member (i32.const 0))
        (br $next))))
)
