(module
  (import "../common.wat")
  ;; heredoc end lines compare with $bashRangeEq
  (import "./bash.wat")

  ;; The high byte of a value is what the keyword awaits: 1 a class or
  ;; defined type name, 2 a function name, both then parameters; 3 a class
  ;; name; 4 a node name, where a regex may stand.
  (keyword-table $puppetWords $mem.puppetWords $mem.applescriptWords
    (group $Token.keyword.declaration+256 "class" "define")
    (group $Token.keyword.declaration+512 "function" "plan")
    (group $Token.keyword.declaration+1024 "node")
    (group $Token.keyword.declaration "type")
    (group $Token.keyword.import+768 "include" "require" "contain")
    (group $Token.keyword+768 "inherits")
    (group $Token.keyword.control "if" "elsif" "else" "unless" "case")
    (group $Token.keyword "default")
    (group $Token.keyword.operator "and" "or" "in")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "undef"))

  ;; Advance $ptr over a name whose segments `::` joins, as in
  ;; `apache::vhost`, `::fqdn`, or `Apache::Vhost`.
  (func $puppetName
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "_"))
        (br_if $done (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
        (br_if $done
          (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ":")))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (br $l))))

  ;; Emit `$name`, `$::name`, or `$scope::name` from the `$` at $ptr as $hl.
  ;; Returns 0 and keeps $ptr when no name follows, so the `$` is literal.
  (func $puppetVariable (param $hl i32) (result i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
    (call $puppetName)
    (if (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
      (then
        (global.set $ptr (local.get $lhs))
        (return (i32.const 0))))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  ;; At a `$` in a string or heredoc, emit `$name`, or `${` and `}` around
  ;; an expression emitted as a variable. The expression ends at its `}` or
  ;; the line break. Returns 0 and keeps $ptr for a literal `$`.
  (func $puppetInterp (result i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (if (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "{"))
      (then (return (call $puppetVariable (enum.get $Token.variable)))))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (call $scanFind3 (global.get $ptr) (i32.const "}") (i32.const 10) (i32.const 13)))
    (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
    (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}"))
      (then
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))))
    (i32.const 1))

  ;; Scan a quoted body from $ptr; $seg is the first byte not yet emitted.
  ;; Double quotes take escapes and expand variables; single quotes escape
  ;; only `\'` and `\\`. Returns 1 past the closing quote, 0 at $end.
  (func $puppetStringBody (param $q i32) (param $seg i32) (result i32)
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
            (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (br_if $l
              (i32.and
                (i32.eq (local.get $q) (i32.const 39))
                (i32.and (i32.ne (local.get $c) (i32.const 39)) (i32.ne (local.get $c) (i32.const 92)))))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (call $lexEscapeEnd (local.get $p)))
            ;; `\u{1F600}` and `é`
            (if (i32.eq (local.get $c) (i32.const "u"))
              (then
                (global.set $ptr (call $scanHexRun (i32.add (local.get $p) (i32.const 2)) (i32.const 4)))
                (if (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const "{"))
                  (then
                    (global.set $ptr (call $scanHexRun (i32.add (local.get $p) (i32.const 3)) (i32.const 6)))
                    (global.set $ptr
                      (i32.add
                        (global.get $ptr)
                        (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}"))))))))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (local.set $seg (local.get $p))
        (if (call $puppetInterp)
          (then (local.set $seg (global.get $ptr)))
          (else (global.set $ptr (i32.add (local.get $p) (i32.const 1)))))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; Consume heredoc body lines from $ptr, the start of a line, through the
  ;; line before the end line, or to $end. $mem.streamDelimiter holds the
  ;; tag; $hd is its length, plus 256 when a quoted tag expands variables.
  ;; An end line is the tag after blanks and an optional `|` or `-`, as in
  ;; `|- EOT`. Returns 1 with $ptr before the end line's break.
  (func $puppetHeredoc (param $hd i32) (result i32)
    (local $seg i32)
    (local $p i32)
    (local $c i32)
    (local $n i32)
    (local.set $n (i32.and (local.get $hd) (i32.const 255)))
    (local.set $seg (global.get $ptr))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
        (if (i32.eq (call $templateByte (local.get $p)) (i32.const "|"))
          (then (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1))))))
        (if (i32.eq (call $templateByte (local.get $p)) (i32.const "-"))
          (then (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $p) (i32.const 1))))))
        (if
          (i32.and
            (i32.le_u (i32.add (local.get $p) (local.get $n)) (global.get $end))
            (call $bashRangeEq (local.get $p) (i32.const $mem.streamDelimiter) (local.get $n)))
          (then
            (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $p) (local.get $n))))
            (local.set $c (call $templateByte (local.get $p)))
            (if (i32.or (i32.ge_u (local.get $p) (global.get $end)) (byteset.get "\n\r" (local.get $c)))
              (then
                (global.set $ptr (local.get $p))
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (return (i32.const 1))))))
        (if (i32.and (local.get $hd) (i32.const 256))
          (then
            (block $lineDone
              (loop $dollar
                (local.set $p
                  (call $scanFindSpecial
                    (global.get $ptr)
                    (global.get $end)
                    (i32.const "$")
                    (i32.const 0)
                    (i32.const 1)))
                (global.set $ptr (local.get $p))
                (br_if $lineDone (i32.ne (call $templateByte (local.get $p)) (i32.const "$")))
                (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
                (local.set $seg (local.get $p))
                (if (call $puppetInterp)
                  (then (local.set $seg (global.get $ptr)))
                  (else (global.set $ptr (i32.add (local.get $p) (i32.const 1)))))
                (br $dollar))))
          (else (call $scanToLineEnd)))
        ;; the line break, LF or CRLF
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then
            (local.set $c (i32.load8_u (global.get $ptr)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const 13))
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const 10)))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
        (br $lines)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; Whether the operator before $p on the same line is `=>` or `+>`, so a
  ;; bare word at $p is a value such as `present`.
  (func $puppetAfterArrow (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $back
        (br_if $done (i32.lt_u (local.get $p) (i32.add (global.get $srcBase) (i32.const 2))))
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (br_if $done (i32.and (i32.ne (local.get $c) (i32.const 32)) (i32.ne (local.get $c) (i32.const 9))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $back)))
    (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 2))))
    (i32.and
      (i32.ge_u (local.get $p) (i32.add (global.get $srcBase) (i32.const 2)))
      (i32.and
        (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const ">"))
        (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "+"))))))

  ;; $expect is what a keyword awaits (see $puppetWords), or 5 after a
  ;; class, defined type, or function name, whose `(` opens parameters.
  ;; $params is the bracket depth inside a parameter list, where `$name`
  ;; declares a parameter. $str is the quote of a string that continues on
  ;; the next line. $hd is an open heredoc (see $puppetHeredoc), plus 512
  ;; while its body waits for the end of the opener's line.
  (func $hlPuppet
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $e i32)
    (local $hl i32)
    (local $expect i32)
    (local $params i32)
    (local $str i32)
    (local $hd i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $str)
          (then
            (if (call $puppetStringBody (local.get $str) (global.get $ptr))
              (then (local.set $str (i32.const 0))))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))
        (if (local.get $hd)
          (then
            ;; the body starts after the opener's line break
            (if (i32.and (local.get $hd) (i32.const 512))
              (then
                (local.set $gap (global.get $ptr))
                (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
                (local.set $c (call $templateByte (global.get $ptr)))
                (if
                  (i32.and (i32.lt_u (global.get $ptr) (global.get $end)) (byteset.get "\n\r" (local.get $c)))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (global.set $ptr
                      (i32.add
                        (global.get $ptr)
                        (i32.and
                          (i32.eq (local.get $c) (i32.const 13))
                          (i32.eq (call $templateByte (global.get $ptr)) (i32.const 10)))))
                    (call $emitGap (local.get $gap) (global.get $ptr))
                    (local.set $hd (i32.xor (local.get $hd) (i32.const 512))))
                  (else (global.set $ptr (local.get $gap))))))
            (if (i32.eqz (i32.and (local.get $hd) (i32.const 512)))
              (then
                (if (call $puppetHeredoc (local.get $hd))
                  (then
                    (local.set $hd (i32.const 0))
                    (memory.fill (i32.const $mem.streamDelimiter) (i32.const 0) (i32.const 32))))
                (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))))))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $e (local.get $expect))
        (local.set $expect (i32.const 0))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "*"))
              (then
                (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            ;; a regex literal where a value starts: after `=~`, `!~`, `node`,
            ;; an opening bracket, `,`, or `=`, or at a line start
            (local.set $v (call $lexLineByteBefore (local.get $lhs)))
            (if
              (i32.or
                (i32.or (i32.eq (local.get $e) (i32.const 4)) (i32.eqz (local.get $v)))
                (i32.or
                  (byteset.get "([{" (local.get $v))
                  (i32.or
                    (i32.eq (local.get $v) (i32.const ","))
                    (i32.or (i32.eq (local.get $v) (i32.const "=")) (i32.eq (local.get $v) (i32.const "~"))))))
              (then
                (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
                (block $rxDone
                  (loop $rx
                    (local.set $p
                      (call $scanFindSpecial
                        (local.get $p)
                        (global.get $end)
                        (i32.const "/")
                        (i32.const 1)
                        (i32.const 1)))
                    (br_if $rxDone (i32.ge_u (local.get $p) (global.get $end)))
                    (local.set $v (i32.load8_u (local.get $p)))
                    (if (i32.eq (local.get $v) (i32.const "/"))
                      (then
                        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                        (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
                        (br $next)))
                    ;; an escape, but a regex never spans lines
                    (br_if $rxDone (i32.ne (local.get $v) (i32.const 92)))
                    (local.set $v (call $templateByte (i32.add (local.get $p) (i32.const 1))))
                    (br_if $rxDone (byteset.get "\n\r" (local.get $v)))
                    (local.set $p (i32.add (local.get $p) (i32.const 2)))
                    (br $rx)))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $str (local.get $c))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (br_if $next
              (call $puppetVariable
                (select
                  (enum.get $Token.variable.parameter)
                  (enum.get $Token.variable)
                  (i32.and
                    (i32.eq (local.get $params) (i32.const 1))
                    (i32.ne (call $lexLineByteBefore (local.get $lhs)) (i32.const "="))))))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            ;; `@("EOT")`, `@(EOT)`, or `@(EOT:json/L)` opens a heredoc whose
            ;; body starts on the next line
            (if (i32.and (i32.eq (local.get $c2) (i32.const "(")) (i32.eqz (local.get $hd)))
              (then
                (local.set $p (call $lexSkipSpaceAt (i32.add (local.get $lhs) (i32.const 2))))
                (local.set $hl (i32.eq (call $templateByte (local.get $p)) (i32.const 34)))
                (local.set $p (i32.add (local.get $p) (local.get $hl)))
                (local.set $rhs (local.get $p))
                (block $tagDone
                  (loop $tag
                    (br_if $tagDone (i32.ge_u (local.get $p) (global.get $end)))
                    (local.set $v (i32.load8_u (local.get $p)))
                    (br_if $tagDone
                      (i32.or
                        (call $lexIsSpace (local.get $v))
                        (i32.or
                          (i32.or (i32.eq (local.get $v) (i32.const 34)) (i32.eq (local.get $v) (i32.const ")")))
                          (i32.or (i32.eq (local.get $v) (i32.const ":")) (i32.eq (local.get $v) (i32.const "/"))))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $tag)))
                (local.set $v (i32.sub (local.get $p) (local.get $rhs)))
                (local.set $p (call $scanFind3 (local.get $p) (i32.const ")") (i32.const 10) (i32.const 13)))
                (if
                  (i32.and
                    (i32.eq (call $templateByte (local.get $p)) (i32.const ")"))
                    (i32.le_u (i32.sub (local.get $v) (i32.const 1)) (i32.const 31)))
                  (then
                    (memory.copy (i32.const $mem.streamDelimiter) (local.get $rhs) (local.get $v))
                    (local.set $hd
                      (i32.or (local.get $v) (i32.or (i32.shl (local.get $hl) (i32.const 8)) (i32.const 512))))
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    (br $next)))))
            ;; `@` declares a virtual resource and `@@` an exported one
            (global.set $ptr
              (i32.add
                (local.get $lhs)
                (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const "@")))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.or
            (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
            (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":")))
              (call $lexIsIdentStart (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))))
          (then
            (call $puppetName)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $c2 (call $templateByte (local.get $p)))
            (local.set $v (keyword-table.value $puppetWords (local.get $lhs) (local.get $rhs)))
            (block $classified
              ;; an attribute: `ensure =>` or `require +>`; a selector's
              ;; `default =>` stays a keyword
              (local.set $hl (enum.get $Token.property))
              (br_if $classified
                (i32.and
                  (i32.and
                    (i32.or (i32.eq (local.get $c2) (i32.const "=")) (i32.eq (local.get $c2) (i32.const "+")))
                    (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">")))
                  (i32.ne (local.get $v) (enum.get $Token.keyword))))
              ;; the name a declaration or `include` awaits
              (if (i32.le_u (i32.sub (local.get $e) (i32.const 1)) (i32.const 2))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.function.definition)
                      (enum.get $Token.type)
                      (i32.eq (local.get $e) (i32.const 2))))
                  (local.set $expect (select (i32.const 5) (i32.const 0) (i32.le_u (local.get $e) (i32.const 2))))
                  (br $classified)))
              ;; data types and resource references
              (local.set $hl (enum.get $Token.type))
              (br_if $classified (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (if (i32.ge_s (local.get $v) (i32.const 0))
                (then
                  (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                  (local.set $expect (i32.shr_u (local.get $v) (i32.const 8)))
                  (br $classified)))
              ;; calls, and methods such as `.each`
              (local.set $hl (enum.get $Token.function))
              (br_if $classified
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "("))
                  (i32.eq (call $lexLineByteBefore (local.get $lhs)) (i32.const "."))))
              ;; a resource type before its body: `file {`
              (local.set $hl (enum.get $Token.type))
              (br_if $classified (i32.eq (local.get $c2) (i32.const "{")))
              (local.set $hl
                (select (enum.get $Token.constant) (enum.get $Token.none) (call $puppetAfterArrow (local.get $lhs)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (if (byteset.get "([{" (local.get $c))
              (then
                (if (i32.and (i32.eq (local.get $e) (i32.const 5)) (i32.eq (local.get $c) (i32.const "(")))
                  (then (local.set $params (i32.const 1)))
                  (else
                    (if (local.get $params)
                      (then (local.set $params (i32.add (local.get $params) (i32.const 1))))))))
              (else
                (if (local.get $params)
                  (then (local.set $params (i32.sub (local.get $params) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get ",.:;" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            ;; a `/` after an operator may start a regex, as in `=~ /x/`
            (block $opDone
              (loop $op
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eq (local.get $v) (i32.const "/")))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $v))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
