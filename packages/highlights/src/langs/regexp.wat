(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")

  ;; End of the `{n}`, `{n,}`, `{,m}`, or `{n,m}` quantifier whose `{` is at
  ;; $p, or 0 when the braces are literal text.
  (func $regexpBraceEnd (param $p i32) (result i32)
    (local $c i32)
    (local $digits i32)
    (local $comma i32)
    (block $no
      (loop $l
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $c (call $templateByte (local.get $p)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (local.set $digits (i32.const 1))
            (br $l)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ",")) (i32.eqz (local.get $comma)))
          (then
            (local.set $comma (i32.const 1))
            (br $l)))
        (br_if $no (i32.or (i32.ne (local.get $c) (i32.const "}")) (i32.eqz (local.get $digits))))
        (return (i32.add (local.get $p) (i32.const 1)))))
    (i32.const 0))

  ;; First $close byte at or after $p on the current line, or 0.
  (func $regexpFindOnLine (param $p i32) (param $close i32) (result i32)
    (local $c i32)
    (block $no
      (loop $l
        (local.set $c (call $templateByte (local.get $p)))
        (br_if $no (i32.or (i32.eqz (local.get $c)) (byteset.get "\n\r" (local.get $c))))
        (if (i32.eq (local.get $c) (local.get $close))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; Emit the backslash escape at $ptr. Outside a character class ($class 0),
  ;; `\b`-style anchors and backreferences exist. A backslash before a line
  ;; break stays alone, so each line starts outside any class.
  (func $regexpEscape (param $class i32)
    (local $lhs i32)
    (local $c i32)
    (local $p i32)
    (local $hl i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
    (local.set $hl (enum.get $Token.string.escape))
    (local.set $p (call $lexEscapeEnd (local.get $lhs)))
    (if (i32.or (i32.eqz (local.get $c)) (byteset.get "\n\r" (local.get $c)))
      (then (local.set $p (i32.add (local.get $lhs) (i32.const 1)))))
    (if (i32.eqz (local.get $class))
      (then
        (if (byteset.get "ABGZbz" (local.get $c))
          (then (local.set $hl (enum.get $Token.keyword.control))))
        (if (i32.le_u (i32.sub (local.get $c) (i32.const "1")) (i32.const 8))
          (then
            (local.set $hl (enum.get $Token.variable.special))
            (block $digitsDone
              (loop $digits
                (br_if $digitsDone (i32.eqz (call $lexIsDigit (call $templateByte (local.get $p)))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $digits)))))
        ;; `\k<name>`, `\k'name'`, `\g<1>`
        (if (i32.or (i32.eq (local.get $c) (i32.const "k")) (i32.eq (local.get $c) (i32.const "g")))
          (then
            (local.set $hl (enum.get $Token.variable.special))
            (local.set $c (call $templateByte (local.get $p)))
            (if (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const "'")))
              (then
                (local.set $c
                  (call $regexpFindOnLine
                    (i32.add (local.get $p) (i32.const 1))
                    (select (i32.const ">") (i32.const "'") (i32.eq (local.get $c) (i32.const "<")))))
                (if (local.get $c)
                  (then (local.set $p (i32.add (local.get $c) (i32.const 1)))))))))))
    (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
    ;; `\p{L}`, `\x{41}`, `\u{1F600}`, `\k{name}`, `\N{name}`
    (if
      (i32.and
        (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "{"))
        (byteset.get "NPgkopux" (local.get $c)))
      (then
        (local.set $c (call $regexpFindOnLine (i32.add (local.get $lhs) (i32.const 3)) (i32.const "}")))
        (if (local.get $c)
          (then (local.set $p (i32.add (local.get $c) (i32.const 1))))))
      (else
        (if (i32.eq (local.get $c) (i32.const "x"))
          (then (local.set $p (call $scanHexRun (local.get $p) (i32.const 2)))))
        (if (i32.eq (local.get $c) (i32.const "u"))
          (then (local.set $p (call $scanHexRun (local.get $p) (i32.const 4)))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "c")) (call $lexIsIdentStart (call $templateByte (local.get $p))))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
    (global.set $ptr (local.get $p))
    (call $emitTok (local.get $hl) (local.get $lhs) (local.get $p)))

  ;; A regular expression: the whole input is a pattern, and a line that
  ;; starts with `/` and ends with `/flags` is a delimited literal.
  ;; $class: inside `[...]`, with 2 while the class has no member yet (so a
  ;; leading `]` is a member). $close: the closing `/` of a delimited line.
  (func $hlRegexp
    (local $c i32)
    (local $lhs i32)
    (local $p i32)
    (local $class i32)
    (local $close i32)
    (local $lineStart i32)
    (call $lexEmitLeadingContinuation)
    (local.set $lineStart (i32.const 1))
    (local.set $class (i32.const 0))
    (local.set $close (i32.const 0))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (byteset.get "\n\r" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $lineStart (i32.const 1))
            (local.set $class (i32.const 0))
            (local.set $close (i32.const 0))
            (br $next)))
        (if (local.get $lineStart)
          (then
            (local.set $lineStart (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                ;; the line must end with `/` and letters only
                (local.set $p (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13)))
                (block $flagsDone
                  (loop $flags
                    (local.set $p (i32.sub (local.get $p) (i32.const 1)))
                    (br_if $flagsDone (i32.le_u (local.get $p) (local.get $lhs)))
                    (br_if $flags
                      (i32.le_u
                        (i32.sub (i32.or (i32.load8_u (local.get $p)) (i32.const 32)) (i32.const "a"))
                        (i32.const 25)))))
                (if
                  (i32.and
                    (i32.gt_u (local.get $p) (local.get $lhs))
                    (i32.and
                      (i32.eq (i32.load8_u (local.get $p)) (i32.const "/"))
                      (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 92))))
                  (then
                    (local.set $close (local.get $p))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                    (br $next)))))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $regexpEscape (local.get $class))
            (local.set $class (i32.ne (local.get $class) (i32.const 0)))
            (br $next)))
        (if (local.get $class)
          (then
            (if (i32.and (i32.eq (local.get $c) (i32.const "]")) (i32.eq (local.get $class) (i32.const 1)))
              (then
                (local.set $class (i32.const 0))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $class (i32.const 1))
            ;; POSIX `[:alpha:]`
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "["))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const ":")))
              (then
                (local.set $p (call $regexpFindOnLine (i32.add (local.get $lhs) (i32.const 2)) (i32.const "]")))
                (if (i32.eq (i32.load8_u (i32.sub (select (local.get $p) (i32.add (local.get $lhs) (i32.const 1)) (local.get $p)) (i32.const 1))) (i32.const ":"))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
                    (br $next)))))
            ;; a range `-`, not one at either end of the class
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "-"))
                (i32.and
                  (i32.ne (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "["))
                  (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const "]"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (local.set $p (local.get $lhs))
            (block $memberDone
              (loop $member
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $memberDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $c (i32.load8_u (local.get $p)))
                (br_if $member (i32.eqz (byteset.get "\n\r\5c[]-" (local.get $c))))))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.constant) (local.get $lhs) (local.get $p))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (local.set $class (i32.const 2))
            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (local.get $p))
            (if (i32.eq (call $templateByte (local.get $p)) (i32.const "^"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.keyword.operator) (local.get $p) (global.get $ptr))
                (br $next)))
            (global.set $ptr (local.get $p))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (local.get $p))
            (global.set $ptr (local.get $p))
            (if (i32.ne (call $templateByte (local.get $p)) (i32.const "?"))
              (then (br $next)))
            (local.set $lhs (local.get $p))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $c (call $templateByte (local.get $p)))
            ;; `(?#comment)`
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (local.set $p (call $regexpFindOnLine (local.get $p) (i32.const ")")))
                (global.set $ptr
                  (select
                    (local.get $p)
                    (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13))
                    (local.get $p)))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "P"))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $c (call $templateByte (local.get $p)))))
            ;; `(?<name>`, `(?P<name>`, `(?'name'`, `(?P=name)`
            (if
              (i32.or
                (i32.or
                  (i32.eq (local.get $c) (i32.const "'"))
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "="))
                    (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "P"))))
                (i32.and
                  (i32.eq (local.get $c) (i32.const "<"))
                  (call $lexIsNameStart (call $templateByte (i32.add (local.get $p) (i32.const 1))))))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (local.get $p))
                (global.set $ptr (local.get $p))
                (call $scanIdentRun (i32.const 0))
                (call $emitTok
                  (select (enum.get $Token.variable.special) (enum.get $Token.variable) (i32.eq (local.get $c) (i32.const "=")))
                  (local.get $p)
                  (global.get $ptr))
                (if
                  (i32.and
                    (i32.ne (local.get $c) (i32.const "="))
                    (i32.eq
                      (call $templateByte (global.get $ptr))
                      (select (i32.const ">") (i32.const "'") (i32.eq (local.get $c) (i32.const "<")))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (call $emitTok (enum.get $Token.keyword.operator) (i32.sub (global.get $ptr) (i32.const 1)) (global.get $ptr))))
                (br $next)))
            ;; `?:`, `?=`, `?!`, `?>`, `?|`, `?<=`, `?<!`, and inline flags `?i-m:`
            (if (i32.eq (local.get $c) (i32.const "<"))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (block $flagsDone
              (loop $flags
                (local.set $c (call $templateByte (local.get $p)))
                (br_if $flagsDone
                  (i32.eqz
                    (i32.or
                      (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                      (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "^"))))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $flags)))
            (if
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c) (i32.const "=")))
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const ">")))
                  (i32.eq (local.get $c) (i32.const "|"))))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (local.get $p))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $p (call $regexpBraceEnd (local.get $lhs)))
            (if (local.get $p)
              (then
                (block $quantDone
                  (loop $quant
                    (br_if $quantDone (i32.ge_u (global.get $ptr) (local.get $p)))
                    (local.set $lhs (global.get $ptr))
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok
                      (select
                        (enum.get $Token.number)
                        (enum.get $Token.keyword.operator)
                        (call $lexIsDigit (i32.load8_u (local.get $lhs))))
                      (local.get $lhs)
                      (global.get $ptr))
                    (br $quant)))
                (local.set $c (call $templateByte (local.get $p)))
                (if (i32.or (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c) (i32.const "+")))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (call $emitTok (enum.get $Token.keyword.operator) (local.get $p) (global.get $ptr))))
                (br $next)))))
        (if (i32.eq (local.get $lhs) (local.get $close))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (call $lexFindEither (local.get $lhs) (i32.const 10) (i32.const 13)))
            (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "+")))
            (i32.or (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c) (i32.const "|"))))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
            ;; a lazy or possessive suffix
            (if (i32.ne (local.get $c) (i32.const "|"))
              (then
                (local.set $c (call $templateByte (local.get $p)))
                (if (i32.or (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c) (i32.const "+")))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
            (global.set $ptr (local.get $p))
            (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (local.get $p))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "^")) (i32.eq (local.get $c) (i32.const "$")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; literal text up to the next metacharacter
        (local.set $p (local.get $lhs))
        (block $literalDone
          (loop $literal
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br_if $literalDone (i32.ge_u (local.get $p) (global.get $end)))
            (br_if $literalDone (i32.eq (local.get $p) (local.get $close)))
            (local.set $c (i32.load8_u (local.get $p)))
            (br_if $literal (i32.eqz (byteset.get "\n\r\5c$()*+.?[^{|" (local.get $c))))))
        (global.set $ptr (local.get $p))
        (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $p))
        (br $next))))
)
