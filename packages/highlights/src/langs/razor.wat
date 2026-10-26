(module
  (import "../common.wat")
  (import "./csharp.wat")
  (import "./template.wat")

  ;; 1 a statement whose header runs to its `{`, 2 `using` (a statement before
  ;; `(`, else a directive), 3 a `@code` block, 4 `@section`, 5 a directive that
  ;; takes the rest of its line.
  (keyword-table $razorWords $mem.razorWords $mem.twigWords
    (group "if" "for" "foreach" "while" "switch" "lock" "try" "do")
    (group "using")
    (group "code" "functions")
    (group "section")
    (group
      "model" "inject" "page" "layout" "inherits" "implements" "namespace" "attribute" "typeparam"
      "rendermode" "preservewhitespace" "addTagHelper" "removeTagHelper" "tagHelperPrefix"))

  ;; Each piece starts fresh, so the C# lexer drops a comment or string mode open
  ;; at a chunk end; $hlRazor continues those itself ($xline).
  (func $razorCs (param $to i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (call $hlCsharp)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to))
    (global.set $streamMode (i32.const 0)))

  ;; A stack 30 deep stays as it is.
  (func $razorPush (param $stack i64) (param $kind i32) (result i64)
    (if (i64.ge_u (local.get $stack) (i64.const 0x1000000000000000))
      (then (return (local.get $stack))))
    (i64.or
      (i64.shl (select (local.get $stack) (i64.const 1) (i64.ne (local.get $stack) (i64.const 0))) (i64.const 2))
      (i64.extend_i32_u (local.get $kind))))

  (func $razorPop (param $stack i64) (result i64)
    (local.set $stack (i64.shr_u (local.get $stack) (i64.const 2)))
    (select (local.get $stack) (i64.const 0) (i64.gt_u (local.get $stack) (i64.const 1))))

  ;; Just past the bracket that balances the `(` or `[` at $p, or for a
  ;; statement header ($header) at its first `{`; else the line end.
  (func $razorExprEnd (param $p i32) (param $header i32) (result i32)
    (local $c i32)
    (local $c2 i32)
    (local $depth i32)
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (br_if $done
          (i32.and
            (i32.and (local.get $header) (i32.eqz (local.get $depth)))
            (i32.eq (local.get $c) (i32.const "{"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (loop $string
              (local.set $p
                (call $scanFindSpecial (local.get $p) (global.get $end) (local.get $c) (i32.const 1) (i32.const 1)))
              (if (i32.eq (call $templateByte (local.get $p)) (i32.const 92))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (local.set $c2 (call $templateByte (local.get $p)))
                  (local.set $p (i32.add (local.get $p) (i32.eqz (byteset.get "\n\r" (local.get $c2)))))
                  (br $string))))
            (local.set $p
              (i32.add (local.get $p) (i32.eq (call $templateByte (local.get $p)) (local.get $c))))
            (br $scan)))
        (if (byteset.get "([" (local.get $c))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (byteset.get ")]" (local.get $c))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.ne (local.get $depth) (i32.const 0))))
            (br_if $done (i32.eqz (i32.or (local.get $header) (local.get $depth))))))
        (br $scan)))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  (func $razorImplicitEnd (param $p i32) (result i32)
    (local $c i32)
    (local $save i32)
    (local.set $save (global.get $ptr))
    (block $done
      (loop $name
        (global.set $ptr (local.get $p))
        (call $scanIdentRun (i32.const "_"))
        (local.set $p (global.get $ptr))
        (loop $call
          (local.set $c (call $templateByte (local.get $p)))
          (if (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "[")))
            (then
              (local.set $p (call $razorExprEnd (local.get $p) (i32.const 0)))
              (br $call))))
        (local.set $c
          (i32.add
            (local.get $p)
            (i32.and
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ".")))))
        (br_if $done (i32.ne (call $templateByte (local.get $c)) (i32.const ".")))
        (br_if $done
          (i32.eqz (call $lexIsIdentStart (call $templateByte (i32.add (local.get $c) (i32.const 1))))))
        (local.set $p (i32.add (local.get $c) (i32.const 1)))
        (br $name)))
    (global.set $ptr (local.get $save))
    (local.get $p))

  ;; $stack: open blocks and elements, two bits each above a 1 bit: 0 a C# brace,
  ;; 1 a code block, 2 an element in a code block, 3 a section body. $markup: the
  ;; $tmplMarkup state. $enter: the one tag a statement starts; $lineMarkup: an
  ;; `@:` line. $await: waiting for the `{` of a code block (1) or section (2),
  ;; or for `else`, `catch`, `finally`, `while` (3). $xline: a C# block comment
  ;; (1), verbatim string (2), or raw string (3) open at a line end. $stmt: a C#
  ;; statement may start.
  (func $hlRazor
    (local $stack i64)
    (local $markup i32)
    (local $await i32)
    (local $xline i32)
    (local $stmt i32)
    (local $enter i32)
    (local $lineMarkup i32)
    (local $c i32)
    (local $ev i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $parens i32)
    (local $q i32)
    (local $r i32)
    (local $resumed i32)
    (local $saveEnd i32)
    (local $skip i32)
    (local $top i32)
    (call $lexEmitLeadingContinuation)
    (local.set $resumed (i32.const 0))
    (if (global.get $streamRegionKind)
      (then (local.set $resumed (call $streamResumeAnyRegion))))
    (block $done
      (br_if $done (local.get $resumed))
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $top
          (select
            (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 3)))
            (i32.const 4)
            (i64.gt_u (local.get $stack) (i64.const 1))))
        (block $header
          (if (local.get $await)
            (then
              (call $scanWhitespace)
              (call $emitGap (local.get $lhs) (global.get $ptr))
              (br_if $next (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $lhs (global.get $ptr))
              (local.set $c (local.get $await))
              (local.set $await (i32.const 0))
              (if (i32.lt_u (local.get $c) (i32.const 3))
                (then
                  (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "{"))
                    (then
                      (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                      (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                      (local.set $stack
                        (call $razorPush
                          (local.get $stack)
                          (select (i32.const 1) (i32.const 3) (i32.eq (local.get $c) (i32.const 1)))))
                      (local.set $stmt (i32.const 1))
                      (local.set $lineMarkup (i32.const 0))))
                  (br $next)))
              (call $scanIdentRun (i32.const "_"))
              (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
              (global.set $ptr (local.get $lhs))
              (br_if $header
                (i32.or
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 4))
                      (i32.eq (i32.load (local.get $lhs)) (i32.const "else")))
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 7))
                      (i64.eq
                        (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff))
                        (i64.const "finally"))))
                  (i32.and
                    (i32.eq (local.get $p) (i32.const 5))
                    (i32.or
                      (i64.eq
                        (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                        (i64.const "catch"))
                      (i64.eq
                        (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                        (i64.const "while"))))))
              (br $next)))
          (if (i32.eq (i32.and (local.get $markup) (i32.const 0x17)) (i32.const 0x14))
            (then
              (local.set $q (i32.and (i32.shr_u (local.get $markup) (i32.const 8)) (i32.const 255)))
              (local.set $p
                (call $scanFindSpecial (local.get $lhs) (global.get $end) (local.get $q) (i32.const 0) (i32.const 1)))
              (if (i32.eq (call $templateByte (local.get $p)) (local.get $q))
                (then
                  (call $razorCs (local.get $p))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
                  (local.set $markup
                    (i32.or (i32.and (local.get $markup) (i32.const 0xffff00e8)) (i32.const 1))))
                (else (call $razorCs (call $markdownAfterLine (local.get $p)))))
              (br $next)))
          (if
            (i32.and
              (i32.le_u (local.get $top) (i32.const 1))
              (i32.eqz (i32.or (i32.or (local.get $enter) (local.get $lineMarkup)) (local.get $markup))))
            (then
              (if (local.get $xline)
                (then
                  (local.set $r (select (enum.get $Token.comment) (enum.get $Token.string) (i32.eq (local.get $xline) (i32.const 1))))
                  (if (i32.eq (local.get $xline) (i32.const 2))
                    (then
                      (local.set $p (local.get $lhs))
                      (loop $quote
                        (local.set $p (call $lexFindByte (local.get $p) (i32.const 34)))
                        (if (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
                          (then
                            (local.set $p (i32.add (local.get $p) (i32.const 2)))
                            (br $quote))))
                      (local.set $q (i32.const 1)))
                    (else
                      (local.set $q (select (i32.const 2) (i32.const 3) (i32.eq (local.get $xline) (i32.const 1))))
                      (local.set $p
                        (call $tmplFindWord
                          (local.get $lhs)
                          (select (i64.const "*/") (i64.const 0x222222) (i32.eq (local.get $xline) (i32.const 1)))
                          (local.get $q)))))
                  (if (i32.lt_u (local.get $p) (global.get $end))
                    (then
                      (local.set $p (i32.add (local.get $p) (local.get $q)))
                      (local.set $xline (i32.const 0)))
                    (else (local.set $p (global.get $end))))
                  (global.set $ptr (local.get $p))
                  (call $emitTok (local.get $r) (local.get $lhs) (local.get $p))
                  (br $next)))
              (local.set $lineEnd (call $markdownLineEnd (local.get $lhs)))
              (local.set $saveEnd (global.get $end))
              (global.set $end (local.get $lineEnd))
              (local.set $p (local.get $lhs))
              (local.set $parens (i32.const 0))
              (local.set $ev (i32.const 0))
              (block $stop
                (loop $scan
                  (br_if $stop (i32.ge_u (local.get $p) (global.get $end)))
                  (local.set $c (i32.load8_u (local.get $p)))
                  (local.set $q (call $templateByte (i32.add (local.get $p) (i32.const 1))))
                  (byte-switch (local.get $c)
                    (case 9 32
                      (global.set $ptr (local.get $p))
                      (call $scanWhitespace)
                      (local.set $p (global.get $ptr))
                      (br $scan))
                    (case "/"
                      (if (i32.eq (local.get $q) (i32.const "/"))
                        (then
                          (local.set $p (global.get $end))
                          (br $scan)))
                      (if (i32.eq (local.get $q) (i32.const "*"))
                        (then
                          (local.set $p
                            (call $tmplFindWord (i32.add (local.get $p) (i32.const 2)) (i64.const "*/") (i32.const 2)))
                          (local.set $xline (i32.ge_u (local.get $p) (global.get $end)))
                          (local.set $p (i32.add (local.get $p) (i32.const 2)))
                          (br $scan))))
                    (case 34
                      (local.set $stmt (i32.const 0))
                      (if
                        (i32.and
                          (i32.eq (local.get $q) (i32.const 34))
                          (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34)))
                        (then
                          (local.set $p
                            (call $tmplFindWord
                              (i32.add (local.get $p) (i32.const 3))
                              (i64.const 0x222222)
                              (i32.const 3)))
                          (if (i32.ge_u (local.get $p) (global.get $end))
                            (then (local.set $xline (i32.const 3))))
                          (local.set $p (i32.add (local.get $p) (i32.const 3)))
                          (br $scan)))
                      (local.set $q (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
                      (if
                        (i32.and
                          (i32.gt_u (local.get $p) (local.get $lhs))
                          (i32.or
                            (i32.eq (local.get $q) (i32.const "@"))
                            (i32.and
                              (i32.eq (local.get $q) (i32.const "$"))
                              (i32.and
                                (i32.gt_u (i32.sub (local.get $p) (i32.const 1)) (local.get $lhs))
                                (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 2))) (i32.const "@"))))))
                        (then
                          (loop $quote
                            (local.set $p (call $lexFindByte (i32.add (local.get $p) (i32.const 1)) (i32.const 34)))
                            (if (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 34))
                              (then
                                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                                (br $quote))))
                          (if (i32.ge_u (local.get $p) (global.get $end))
                            (then (local.set $xline (i32.const 2))))
                          (local.set $p (i32.add (local.get $p) (i32.const 1)))
                          (br $scan)))
                      (loop $string
                        (local.set $p
                          (call $scanFindSpecial
                            (i32.add (local.get $p) (i32.const 1))
                            (global.get $end)
                            (i32.const 34)
                            (i32.const 1)
                            (i32.const 0)))
                        (if (i32.eq (call $templateByte (local.get $p)) (i32.const 92))
                          (then
                            (local.set $p (i32.add (local.get $p) (i32.const 1)))
                            (br $string))))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $scan))
                    (case 39
                      (local.set $stmt (i32.const 0))
                      (local.set $q
                        (i32.add (local.get $p) (select (i32.const 3) (i32.const 2) (i32.eq (local.get $q) (i32.const 92)))))
                      (local.set $p
                        (select
                          (i32.add (local.get $q) (i32.const 1))
                          (i32.add (local.get $p) (i32.const 1))
                          (i32.eq (call $templateByte (local.get $q)) (i32.const 39))))
                      (br $scan))
                    (case "{"
                      (local.set $stack (call $razorPush (local.get $stack) (i32.const 0)))
                      (local.set $stmt (i32.const 1))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $scan))
                    (case "}"
                      (if (i64.eq (i64.and (local.get $stack) (i64.const 3)) (i64.const 1))
                        (then
                          (local.set $ev (i32.const 1))
                          (br $stop)))
                      (local.set $stack (call $razorPop (local.get $stack)))
                      (local.set $stmt (i32.const 1))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $scan))
                    (case ";" ":"
                      (local.set $stmt (i32.and (i32.eqz (local.get $parens)) (i32.ne (local.get $q) (i32.const ":"))))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $scan))
                    (case "("
                      (local.set $parens (i32.add (local.get $parens) (i32.const 1))))
                    (case ")"
                      (local.set $parens (i32.sub (local.get $parens) (i32.ne (local.get $parens) (i32.const 0)))))
                    (case "<"
                      (if (i32.eq (local.get $q) (i32.const "/"))
                        (then (local.set $q (call $templateByte (i32.add (local.get $p) (i32.const 2))))))
                      (if
                        (i32.and
                          (i32.and (local.get $stmt) (i32.eqz (local.get $parens)))
                          (i32.or
                            (i32.le_u (i32.sub (i32.or (local.get $q) (i32.const 32)) (i32.const "a")) (i32.const 25))
                            (i32.or (i32.eq (local.get $q) (i32.const "_")) (i32.ge_u (local.get $q) (i32.const 128)))))
                        (then
                          (local.set $ev (i32.const 2))
                          (br $stop))))
                    (case "@"
                      (if (i32.eq (local.get $q) (i32.const "*"))
                        (then
                          (local.set $ev (i32.const 4))
                          (br $stop)))
                      (if (i32.and (i32.eq (local.get $q) (i32.const ":")) (local.get $stmt))
                        (then
                          (local.set $ev (i32.const 3))
                          (br $stop)))))
                  (local.set $stmt (i32.const 0))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $scanIdentRun (i32.const "_"))
                  (local.set $p (global.get $ptr))
                  (br $scan)))
              (global.set $end (local.get $saveEnd))
              (global.set $ptr (local.get $lhs))
              (if (i32.gt_u (local.get $p) (local.get $lineEnd))
                (then (local.set $p (local.get $lineEnd))))
              (if (i32.eqz (local.get $ev))
                (then (local.set $p (call $markdownAfterLine (local.get $p)))))
              (call $razorCs (local.get $p))
              (if (i32.eq (local.get $ev) (i32.const 1))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
                  (local.set $stack (call $razorPop (local.get $stack)))
                  (local.set $await (i32.const 3))))
              (if (i32.eq (local.get $ev) (i32.const 2))
                (then (local.set $enter (i32.const 1))))
              (if (i32.eq (local.get $ev) (i32.const 3))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                  (call $emitTok (enum.get $Token.keyword.control) (local.get $p) (global.get $ptr))
                  (local.set $lineMarkup (i32.const 1))))
              (if (i32.eq (local.get $ev) (i32.const 4))
                (then (call $tmplComment (i32.const 2) (i32.const "*@") (i32.const 2))))
              (br $next)))
          (local.set $saveEnd (global.get $end))
          (local.set $lineEnd (call $markdownAfterLine (call $markdownLineEnd (local.get $lhs))))
          (local.set $skip (i32.const 0))
          (loop $markupNext
            (if (local.get $lineMarkup)
              (then (global.set $end (local.get $lineEnd))))
            (local.set $r
              (call $tmplMarkup
                (local.get $markup)
                (i32.or
                  (i32.or
                    (i32.const 1)
                    (i32.shl
                      (i32.and (i32.eq (local.get $top) (i32.const 3)) (i32.eqz (local.get $enter)))
                      (i32.const 1)))
                  (i32.or
                    (i32.shl
                      (i32.or (local.get $enter) (i32.eq (local.get $top) (i32.const 2)))
                      (i32.const 3))
                    (i32.shl (local.get $skip) (i32.const 4))))))
            (global.set $end (local.get $saveEnd))
            (local.set $markup (i32.and (local.get $r) (i32.const 0xffffff)))
            (local.set $ev (i32.shr_u (local.get $r) (i32.const 24)))
            (if (i32.and (local.get $lineMarkup) (i32.ge_u (global.get $ptr) (local.get $lineEnd)))
              (then
                (call $tmplCut)
                (local.set $lineMarkup (i32.const 0))
                (local.set $markup (i32.const 0))))
            (br_if $next (i32.eqz (local.get $ev)))
            (if (i32.ge_u (local.get $ev) (i32.const 3))
              (then
                (if (i32.eq (local.get $ev) (i32.const 3))
                  (then (local.set $stack (call $razorPush (local.get $stack) (i32.const 2)))))
                (if (i32.and (i32.eq (local.get $ev) (i32.const 5)) (i32.eqz (local.get $enter)))
                  (then (local.set $stack (call $razorPop (local.get $stack)))))
                (local.set $enter (i32.const 0))
                (local.set $stmt (i32.const 1))
                (br $next)))
            (br_if $next (i32.eq (local.get $ev) (i32.const 2)))
            (local.set $lhs (global.get $ptr))
            (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "}"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (local.set $stack (call $razorPop (local.get $stack)))
                (br $next)))
            (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
            (block $plain
              ;; an `@` after a letter or digit is part of an address
              (br_if $plain
                (i32.and
                  (i32.gt_u (local.get $lhs) (global.get $srcBase))
                  (call $markdownIsAlnum (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
              (if (i32.eq (local.get $c) (i32.const "@"))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                  (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.eq (local.get $c) (i32.const "*"))
                (then
                  (call $tmplComment (i32.const 2) (i32.const "*@") (i32.const 2))
                  (br $next)))
              ;; before an attribute, `@name` is a Blazor directive attribute
              (br_if $plain (i32.le_u (i32.sub (i32.and (local.get $markup) (i32.const 7)) (i32.const 1)) (i32.const 1)))
              (if (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eqz (local.get $markup)))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr))
                  (br $header)))
              (br_if $plain
                (i32.and
                  (i32.ne (local.get $c) (i32.const "("))
                  (i32.or
                    (i32.eqz (call $lexIsIdentStart (local.get $c)))
                    (i32.eq (local.get $c) (i32.const "$")))))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr))
              (if (i32.eq (local.get $c) (i32.const "("))
                (then (local.set $p (call $razorExprEnd (global.get $ptr) (i32.const 0))))
                (else
                  (call $scanIdentRun (i32.const "_"))
                  (local.set $p (global.get $ptr))
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (local.set $r
                    (select
                      (keyword-table.get $razorWords (global.get $ptr) (local.get $p))
                      (i32.const 0)
                      (i32.eqz (local.get $markup))))
                  (br_if $header (i32.eq (local.get $r) (i32.const 1)))
                  (if (i32.eq (local.get $r) (i32.const 2))
                    (then
                      (br_if $header
                        (i32.eq (call $templateByte (call $lexSkipSpaceAt (local.get $p))) (i32.const "(")))
                      (call $razorCs (call $markdownLineEnd (local.get $p)))
                      (br $next)))
                  (if (local.get $r)
                    (then
                      (call $emitTok (enum.get $Token.keyword) (global.get $ptr) (local.get $p))
                      (global.set $ptr (local.get $p))
                      (if (i32.eq (local.get $r) (i32.const 5))
                        (then
                          (call $razorCs (call $markdownLineEnd (local.get $p)))
                          (br $next)))
                      (local.set $await (select (i32.const 1) (i32.const 2) (i32.eq (local.get $r) (i32.const 3))))
                      (if (i32.eq (local.get $r) (i32.const 4))
                        (then
                          (local.set $q (call $lexSkipSpaceAt (local.get $p)))
                          (call $emitGap (local.get $p) (local.get $q))
                          (global.set $ptr (local.get $q))
                          (call $scanIdentRun (i32.const "_"))
                          (call $emitTok (enum.get $Token.variable) (local.get $q) (global.get $ptr))))
                      (br $next)))
                  (local.set $q (call $lexSkipSpaceAt (local.get $p)))
                  (if
                    (i32.and
                      (i32.and
                        (i32.eq (i32.sub (local.get $p) (global.get $ptr)) (i32.const 5))
                        (i64.eq
                          (i64.and (i64.load (global.get $ptr)) (i64.const 0xffffffffff))
                          (i64.const "await")))
                      (call $lexIsIdentStart (call $templateByte (local.get $q))))
                    (then (local.set $p (local.get $q)))
                    (else (local.set $p (global.get $ptr))))
                  (local.set $p (call $razorImplicitEnd (local.get $p)))))
              (call $razorCs (local.get $p))
              ;; an expression right after `=` is the attribute's whole value
              (if (i32.eq (i32.and (local.get $markup) (i32.const 7)) (i32.const 3))
                (then (local.set $markup (i32.xor (local.get $markup) (i32.const 2)))))
              (br $next))
            (local.set $skip (i32.const 1))
            (br $markupNext)))
        (local.set $p (call $razorExprEnd (global.get $ptr) (i32.const 1)))
        (call $razorCs (local.get $p))
        (if (i32.eq (call $templateByte (local.get $p)) (i32.const "{"))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
            (local.set $stack (call $razorPush (local.get $stack) (i32.const 1)))
            (local.set $stmt (i32.const 1))
            (local.set $lineMarkup (i32.const 0)))
          (else (local.set $await (i32.const 1))))
        (br $next))))
)
