(module
  (import "../common.wat")

  (func $groqByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Token in the low byte; the high byte names the capture of the next
  ;; identifier (1: the function a `fn` declaration defines). The word
  ;; operators are contextual: `in`, `match`, `asc`, and `desc` follow an
  ;; operand, so after `{`, `,`, or `.` the same spelling is an attribute.
  (keyword-table $groqWords $mem.groqWords $mem.groovyWords
    (group $Token.keyword.operator "in" "match" "asc" "desc")
    (group $Token.keyword.declaration+256 "fn")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))

  ;; The end of the escape at backslash $p: `\uHHHH`, `\u{H..}`, or one
  ;; character, which keeps UTF-8 characters whole and takes LF after an
  ;; escaped CR.
  (func $groqEscapeEnd (param $p i32) (result i32)
    (local $q i32)
    (if (i32.eq (call $groqByte (i32.add (local.get $p) (i32.const 1))) (i32.const "u"))
      (then
        (local.set $q (i32.add (local.get $p) (i32.const 2)))
        (if (i32.ne (call $groqByte (local.get $q)) (i32.const "{"))
          (then (return (call $scanHexRun (local.get $q) (i32.const 4)))))
        (local.set $q (call $scanHexRun (i32.add (local.get $q) (i32.const 1)) (i32.const 8)))
        (return
          (select
            (i32.add (local.get $q) (i32.const 1))
            (local.get $q)
            (i32.eq (call $groqByte (local.get $q)) (i32.const "}"))))))
    (call $lexEscapeEnd (local.get $p)))

  ;; Scan a string body from $ptr to its closing $quote, which may be on a
  ;; later line. Bytes from $seg are not yet emitted. Returns 1 after the
  ;; closing quote, 0 at $end.
  (func $groqStringBody (param $quote i32) (param $hl i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (block $done
      (loop $l
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (local.get $quote)
            (i32.const 1)
            (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (br_if $done (i32.ne (local.get $c) (i32.const 92)))
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $e (call $groqEscapeEnd (global.get $ptr)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; The string whose opening $quote sits at $ptr. An unterminated string at
  ;; the end of a stream chunk continues in the next one (mode 16).
  (func $groqString (param $quote i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if
      (i32.and
        (i32.ne
          (call $groqStringBody (local.get $quote) (enum.get $Token.string) (local.get $lhs))
          (i32.const 1))
        (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof))))
      (then
        (global.set $streamMode (i32.const 16))
        (global.set $streamA (local.get $quote))
        (global.set $streamHl (enum.get $Token.string)))))

  ;; Resume a string left open at the previous chunk end. Returns 1 when
  ;; the string consumed the whole chunk, 0 after its closing quote.
  (func $groqStreamResume (result i32)
    (if
      (i32.and
        (i32.ne
          (call $groqStringBody (global.get $streamA) (global.get $streamHl) (global.get $ptr))
          (i32.const 1))
        (i32.eq (global.get $ptr) (global.get $end)))
      (then (return (i32.const 1))))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))

  ;; True when [$p, $q) - the whitespace just skipped before a token -
  ;; contains a line break, so the caller can tell a token that starts a
  ;; fresh source line from one that merely follows a same-line space.
  (func $groqGapHasLineBreak (param $p i32) (param $q i32) (result i32)
    (local $c i32)
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $q)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (i32.lt_u (local.get $p) (local.get $q)))

  ;; `*` is the Everything selector unless an operand precedes it on the
  ;; same line, where it is always multiplication - even when the RHS wraps
  ;; past a line break or a `//` comment, e.g. `price *\n  taxRate`. When the
  ;; star instead starts a fresh line, a same-line operand only ended the
  ;; previous query, so it is the selector again unless `[`, `{`, `|`, a
  ;; `//` comment, or the line end follows, so a query that starts on a new
  ;; line after a projection still begins with the selector.
  (func $groqStarIsEverything
    (param $p i32) (param $operand i32) (param $lineStart i32) (result i32)
    (local $c i32)
    (if (i32.eqz (local.get $operand))
      (then (return (i32.const 1))))
    (if (i32.eqz (local.get $lineStart))
      (then (return (i32.const 0))))
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (local.set $c (call $groqByte (local.get $p)))
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "{")))
        (i32.and
          (i32.eq (local.get $c) (i32.const "/"))
          (i32.eq (call $groqByte (i32.add (local.get $p) (i32.const 1))) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const 10)))
        (i32.or (i32.eq (local.get $c) (i32.const 13)) (i32.eqz (local.get $c))))))

  ;; $operand is 1 after a token that can end an operand - an attribute,
  ;; literal, parameter, `@`, `^`, `*`, or a closing bracket - and decides
  ;; whether `*` selects everything or multiplies, whether `-` signs a
  ;; number, and whether a word operator is an attribute. $member is 1
  ;; after `.` or `->`, where every word is an attribute. $expect is 1
  ;; after `fn`, naming the function it defines. $lineStart is 1 once the
  ;; gap since the last token has crossed a line break - it stays 1 across a
  ;; streamed chunk boundary that splits that gap, so a star resumed on its
  ;; own chunk still sees the break that happened before it. All are
  ;; checkpointed.
  (func $hlGroq
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $operand i32)
    (local $member i32)
    (local $expect i32)
    (local $lineStart i32)
    (local $freshLine i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $groqGapHasLineBreak (local.get $gap) (global.get $ptr))
          (then (local.set $lineStart (i32.const 1))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $groqByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $groqByte (i32.add (global.get $ptr) (i32.const 2))))
        ;; this token consumes the line-start state; the next token's gap
        ;; starts the search for a break over again
        (local.set $freshLine (local.get $lineStart))
        (local.set $lineStart (i32.const 0))

        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $groqString (local.get $c))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `$param`: the name starts with a letter or `_`, never another `$`
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "$"))
            (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `@` is the current value; a `^` run names an enclosing scope
        (if (i32.or (i32.eq (local.get $c) (i32.const "@")) (i32.eq (local.get $c) (i32.const "^")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const "^"))
              (then
                (block $run
                  (loop $more
                    (br_if $run (i32.ne (call $groqByte (global.get $ptr)) (i32.const "^")))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $more)))))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; the byte after the name and its blanks
            (local.set $c3 (call $groqByte (local.get $p)))
            (local.set $hl (enum.get $Token.property))
            (if
              (i32.and
                (i32.eq (local.get $c3) (i32.const ":"))
                (i32.eq (call $groqByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))
              (then
                ;; `pt::text(`: the namespace keeps a pending `fn` capture
                (local.set $hl (enum.get $Token.namespace)))
              (else
                (if (i32.eqz (local.get $member))
                  (then
                    (local.set $g (keyword-table.value $groqWords (local.get $lhs) (local.get $rhs)))
                    ;; a word operator needs an operand before it
                    (if
                      (i32.and
                        (i32.eq (i32.and (local.get $g) (i32.const 255)) (enum.get $Token.keyword.operator))
                        (i32.eqz (local.get $operand)))
                      (then (local.set $g (i32.const -1))))
                    (if (i32.ge_s (local.get $g) (i32.const 0))
                      (then
                        (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                        (local.set $expect (i32.shr_u (local.get $g) (i32.const 8))))
                      (else
                        (if (local.get $expect)
                          (then
                            (local.set $hl (enum.get $Token.function.definition))
                            (local.set $expect (i32.const 0)))
                          (else
                            (if (i32.eq (local.get $c3) (i32.const "("))
                              (then (local.set $hl (enum.get $Token.function))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            ;; attributes and literals end an operand; keywords, namespaces,
            ;; and function names do not
            (local.set $operand
              (i32.or
                (i32.eq (local.get $hl) (enum.get $Token.property))
                (i32.or
                  (i32.eq (local.get $hl) (enum.get $Token.boolean))
                  (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; a number, or `-` signing one where no operand precedes it
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.and (call $lexIsDigit (local.get $c2)) (i32.eqz (local.get $operand)))))
          (then
            (if (i32.eqz (call $lexIsDigit (local.get $c)))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; a closer ends an operand; an opener starts a new expression
            (local.set $operand (byteset.get ")]}" (local.get $c)))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        ;; `...` spreads or ends an exclusive range, `..` an inclusive one,
        ;; and `.` accesses an attribute
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (select (i32.const 3) (i32.const 2) (i32.eq (local.get $c3) (i32.const ".")))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $member (i32.const 1))))
            (local.set $operand (i32.const 0))
            (br $next)))

        ;; `::`, `,`, `:`, and `;`
        (if (byteset.get ",:;" (local.get $c))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (i32.add
                  (i32.const 1)
                  (i32.and
                    (i32.eq (local.get $c) (i32.const ":"))
                    (i32.eq (local.get $c2) (i32.const ":"))))))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $operand (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `->` dereferences, and names an attribute when one follows
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 0))
            (local.set $member (i32.const 1))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const "*"))
          (then
            (if
              (i32.and
                (i32.ne (local.get $c2) (i32.const "*"))
                (call $groqStarIsEverything
                  (i32.add (global.get $ptr) (i32.const 1))
                  (local.get $operand)
                  (local.get $freshLine)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (local.set $operand (i32.const 1))
                (local.set $member (i32.const 0))
                (br $next)))))

        ;; `**`, `=>`, `==`, `!=`, `<=`, `>=`, `&&`, `||`, then the single
        ;; byte operators
        (if (byteset.get "!%&*+-/<=>|" (local.get $c))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (i32.add
                  (i32.const 1)
                  (i32.or
                    (i32.or
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const "="))
                        (byteset.get "!<=>" (local.get $c)))
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const ">"))
                        (i32.eq (local.get $c) (i32.const "="))))
                    (i32.and
                      (i32.eq (local.get $c) (local.get $c2))
                      (byteset.get "&*|" (local.get $c)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
