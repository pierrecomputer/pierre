(module
  (import "../common.wat")

  ;; +256: after `#`, the word starts a statement that runs to the line end.
  (keyword-table $typstWords $mem.typstWords $mem.bibtexWords
    (group $Token.keyword.declaration+256 "let")
    (group $Token.keyword+256 "set" "show" "context")
    (group $Token.keyword.import+256 "import" "include")
    (group $Token.keyword.control+256 "if" "for" "while" "return")
    (group $Token.keyword.control "else" "break" "continue")
    (group $Token.keyword.operator "in" "not" "and" "or")
    (group $Token.keyword "as")
    (group $Token.constant.builtin "none" "auto")
    (group $Token.boolean "true" "false"))

  ;; The next markup byte that may start syntax at or after $p, or $end:
  ;; `#$*/<@`, `[\]^_` and the backtick, and line breaks. One SIMD step per
  ;; 16 bytes; `^` and VT/FF only split a text run.
  (func $typstTextEnd (param $p i32) (result i32)
    (local $mask i32)
    (local $w v128)
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $w (v128.load (local.get $p)))
        (local.set $mask
          (i8x16.bitmask
            (v128.or
              (v128.or
                (i8x16.le_u (i8x16.sub (local.get $w) (i8x16.splat (i32.const "#"))) (i8x16.splat (i32.const 1)))
                (i8x16.le_u (i8x16.sub (local.get $w) (i8x16.splat (i32.const "["))) (i8x16.splat (i32.const 5))))
              (v128.or
                (v128.or
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "*")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "/"))))
                (v128.or
                  (v128.or
                    (i8x16.eq (local.get $w) (i8x16.splat (i32.const "<")))
                    (i8x16.eq (local.get $w) (i8x16.splat (i32.const "@"))))
                  (i8x16.le_u (i8x16.sub (local.get $w) (i8x16.splat (i32.const 10))) (i8x16.splat (i32.const 3))))))))
        (if (local.get $mask)
          (then
            (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
            (br $done)))
        (local.set $p (i32.add (local.get $p) (i32.const 16)))
        (br $wide)))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Advance $ptr over a label name: identifier runs joined by `.` or `:`
  ;; (`fig:plot`), so a trailing `.` ends a sentence instead.
  (func $typstLabelName
    (local $c i32)
    (loop $name
      (call $scanIdentRun (i32.const "-"))
      (local.set $c (call $templateByte (global.get $ptr)))
      (if
        (i32.and
          (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ":")))
          (call $lexIsIdentContinue (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))
        (then
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (br $name)))))

  ;; Scan raw text from $ptr to the first run of $n backticks, or to $end.
  ;; Bytes from $seg are not yet emitted. Returns $n while the raw text is
  ;; open, or 0 once it closed.
  (func $typstRaw (param $seg i32) (param $n i32) (result i32)
    (local $p i32)
    (block $done
      (loop $find
        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "`")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $p (global.get $ptr))
        (loop $run
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (br_if $run (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))))
        (br_if $find (i32.lt_u (i32.sub (global.get $ptr) (local.get $p)) (local.get $n)))
        (global.set $ptr (i32.add (local.get $p) (local.get $n)))
        (local.set $n (i32.const 0))))
    (call $emitTok (enum.get $Token.text.literal) (local.get $seg) (global.get $ptr))
    (local.get $n))

  ;; Typst switches between markup, code, and math. $stack holds the open
  ;; modes, three bits each, top in the low bits: 0 the document's markup,
  ;; 1 a `[...]` content block, 2 a `{...}` code block, 3 `(...)` in code,
  ;; 4 `$...$` math, 5 a `#` expression after an atom, 6 a `#` expression
  ;; before its first atom, 7 a `#let`-like statement that ends with the
  ;; line. A blank ends a `#` expression unless a call, content block, or
  ;; field follows its atom. $flags: 1 strong, 2 emphasis, 4 heading, all
  ;; ended by the line. $mid: a token precedes on this line. $raw: the
  ;; backtick count of open raw text.
  (func $hlTypst
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $tok i32)
    (local $gap i32)
    (local $p i32)
    (local $q i32)
    (local $v i32)
    (local $first i32)
    (local $atom i32)
    (local $top i32)
    (local $stack i64)
    (local $flags i32)
    (local $mid i32)
    (local $raw i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $raw)
      (then (local.set $raw (call $typstRaw (global.get $ptr) (local.get $raw)))))
    (block $done
      (loop $next
        (block $emit
          (local.set $gap (global.get $ptr))
          (call $scanWhitespace)
          (local.set $v (call $lexGapHasBreak (local.get $gap) (global.get $ptr)))
          (if (local.get $v)
            (then
              (local.set $mid (i32.const 0))
              (local.set $flags (i32.const 0))))
          ;; a blank ends `#` expressions; a line break also ends statements
          (if (i32.gt_u (global.get $ptr) (local.get $gap))
            (then
              (loop $unwind
                (local.set $top (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 7))))
                (if
                  (i32.or
                    (i32.le_u (i32.sub (local.get $top) (i32.const 5)) (i32.const 1))
                    (i32.and (i32.eq (local.get $top) (i32.const 7)) (local.get $v)))
                  (then
                    (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))
                    (br $unwind))))))
          (call $emitGap (local.get $gap) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (local.get $lhs)))
          (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          (local.set $first (i32.eqz (local.get $mid)))
          (local.set $mid (i32.const 1))
          (local.set $top (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 7))))
          (local.set $atom (i32.const 0))
          ;; after its atom, a `#` expression continues only with a call,
          ;; a content block, or a field
          (if (i32.eq (local.get $top) (i32.const 5))
            (then
              (if
                (i32.eqz
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "[")))
                    (select
                      (i32.or
                        (i32.ge_u (local.get $c2) (i32.const 0x80))
                        (i32.or
                          (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                          (i32.eq (local.get $c2) (i32.const "_"))))
                      (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "."))
                      (i32.eq (local.get $c) (i32.const ".")))))
                (then
                  (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))
                  (global.set $ptr (local.get $lhs))
                  (local.set $mid (i32.eqz (local.get $first)))
                  (br $next)))))
          ;; the first atom of a `#` expression takes the `#` into its token
          (if (i32.eq (local.get $top) (i32.const 6))
            (then
              (local.set $stack (i64.xor (local.get $stack) (i64.const 3)))
              (local.set $top (i32.const 5))
              (local.set $atom (i32.const 1))
              (local.set $lhs (i32.sub (local.get $lhs) (i32.const 1)))))

          ;; shared by every mode: comments, raw text, and `#` expressions
          (if (i32.eq (local.get $c) (i32.const "/"))
            (then
              (if (i32.eq (local.get $c2) (i32.const "/"))
                (then
                  (global.set $ptr (local.get $lhs))
                  (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                  (local.set $mid (i32.eqz (local.get $first)))
                  (br $next)))
              (if (i32.eq (local.get $c2) (i32.const "*"))
                (then
                  (global.set $ptr (local.get $lhs))
                  (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (enum.get $Token.comment))
                  (br $next)))))
          (if (i32.and (i32.eq (local.get $c) (i32.const "`")) (i32.ne (local.get $top) (i32.const 4)))
            (then
              (loop $ticks
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "`"))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $ticks))))
              (local.set $v (i32.sub (global.get $ptr) (local.get $lhs)))
              (if (i32.eq (local.get $v) (i32.const 2))
                (then
                  (local.set $tok (enum.get $Token.text.literal))
                  (br $emit)))
              (local.set $raw (call $typstRaw (local.get $lhs) (local.get $v)))
              (br $next)))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.or (i32.le_u (local.get $top) (i32.const 1)) (i32.eq (local.get $top) (i32.const 4))))
            (then
              (if
                (i32.or
                  (i32.or
                    (i32.ge_u (local.get $c2) (i32.const 0x80))
                    (i32.or
                      (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                      (i32.eq (local.get $c2) (i32.const "_"))))
                  (byteset.get "\22([{" (local.get $c2)))
                (then
                  (local.set $stack (i64.or (i64.shl (local.get $stack) (i64.const 3)) (i64.const 6)))
                  (local.set $mid (i32.eqz (local.get $first)))
                  (br $next)))))

          ;; ---- markup ----
          (if (i32.le_u (local.get $top) (i32.const 1))
            (then
              (block $text
                (if (local.get $first)
                  (then
                    ;; `= Heading`
                    (if (i32.eq (local.get $c) (i32.const "="))
                      (then
                        (loop $level
                          (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "="))
                            (then
                              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                              (br $level))))
                        (local.set $v (call $templateByte (global.get $ptr)))
                        (if (i32.or (i32.eq (local.get $v) (i32.const 32)) (i32.eq (local.get $v) (i32.const 9)))
                          (then
                            (local.set $flags (i32.const 4))
                            (local.set $tok (enum.get $Token.title))
                            (br $emit)))
                        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
                    ;; `- item`, `+ item`, `1. item`, and `/ Term: text`
                    (local.set $p (global.get $ptr))
                    (if (call $lexIsDigit (local.get $c))
                      (then
                        (loop $digits
                          (if (call $lexIsDigit (call $templateByte (local.get $p)))
                            (then
                              (local.set $p (i32.add (local.get $p) (i32.const 1)))
                              (br $digits))))
                        (if (i32.eq (call $templateByte (local.get $p)) (i32.const "."))
                          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
                    (local.set $v (call $templateByte (local.get $p)))
                    (if
                      (i32.and
                        (select
                          (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "."))
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "+")))
                            (i32.eq (local.get $c) (i32.const "/")))
                          (call $lexIsDigit (local.get $c)))
                        (i32.or (i32.eq (local.get $v) (i32.const 32)) (i32.eq (local.get $v) (i32.const 9))))
                      (then
                        (global.set $ptr (local.get $p))
                        (call $emitTok (enum.get $Token.punctuation.list_marker) (local.get $lhs) (local.get $p))
                        (if (i32.eq (local.get $c) (i32.const "/"))
                          (then
                            (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                            (local.set $q (call $lexFindEither (local.get $p) (i32.const ":") (i32.const 10)))
                            (if (i32.eq (call $templateByte (local.get $q)) (i32.const ":"))
                              (then
                                (call $emitGap (global.get $ptr) (local.get $p))
                                (call $emitTok (enum.get $Token.property) (local.get $p) (local.get $q))
                                (global.set $ptr (local.get $q))))))
                        (br $next)))))
                (byte-switch (local.get $c)
                  (case "\5c"
                    ;; `\#`, `\u{1F600}`, or a forced line break
                    (if
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const "u"))
                        (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "{")))
                      (then
                        (local.set $p (call $lexFindEither (local.get $lhs) (i32.const "}") (i32.const 10)))
                        (if (i32.eq (call $templateByte (local.get $p)) (i32.const "}"))
                          (then (global.set $ptr (i32.add (local.get $p) (i32.const 1)))))))
                    (if
                      (i32.and
                        (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
                        (i32.gt_u (local.get $c2) (i32.const 13)))
                      (then
                        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))))
                    (local.set $tok (enum.get $Token.string.escape))
                    (br $emit))
                  (case "$"
                    (local.set $stack (i64.or (i64.shl (local.get $stack) (i64.const 3)) (i64.const 4)))
                    (local.set $tok (enum.get $Token.punctuation.bracket))
                    (br $emit))
                  (case "["
                    (local.set $stack (i64.or (i64.shl (local.get $stack) (i64.const 3)) (i64.const 1)))
                    (local.set $tok (enum.get $Token.none))
                    (br $emit))
                  (case "]"
                    (br_if $text (i32.eqz (local.get $top)))
                    (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))
                    (local.set $v (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 7))))
                    (local.set $tok
                      (select (enum.get $Token.none) (enum.get $Token.punctuation.bracket) (i32.le_u (local.get $v) (i32.const 1))))
                    (br $emit))
                  (case "*" "_"
                    ;; a delimiter between two word characters is text
                    (br_if $text
                      (i32.and
                        (call $lexIsIdentContinue (local.get $c2))
                        (i32.and
                          (i32.gt_u (local.get $lhs) (global.get $srcBase))
                          (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))))
                    (local.set $v (select (i32.const 1) (i32.const 2) (i32.eq (local.get $c) (i32.const "*"))))
                    (local.set $flags (i32.xor (local.get $flags) (local.get $v)))
                    (local.set $tok
                      (select
                        (enum.get $Token.title)
                        (select (enum.get $Token.emphasis.strong) (enum.get $Token.emphasis) (i32.eq (local.get $v) (i32.const 1)))
                        (i32.and (local.get $flags) (i32.const 4))))
                    (br $emit))
                  (case "<" "@"
                    ;; `<label>` and `@reference`
                    (call $typstLabelName)
                    (br_if $text (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
                    (if (i32.eq (local.get $c) (i32.const "<"))
                      (then
                        (if (i32.ne (call $templateByte (global.get $ptr)) (i32.const ">"))
                          (then
                            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                            (br $text)))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                    (local.set $tok (enum.get $Token.label))
                    (br $emit))))
              ;; a text run; an `http://` or `https://` link ends it
              (local.set $p (call $typstTextEnd (global.get $ptr)))
              (local.set $q (local.get $p))
              (if
                (i32.and
                  (i32.ge_u (i32.sub (local.get $p) (local.get $lhs)) (i32.const 5))
                  (i32.and
                    (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const ":"))
                    (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "/"))))
                (then
                  (local.set $q (i32.sub (local.get $p) (i32.const 5)))
                  (if
                    (i32.and
                      (i32.gt_u (local.get $q) (local.get $lhs))
                      (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 2))) (i32.const "s")))
                    (then (local.set $q (i32.sub (local.get $q) (i32.const 1)))))
                  (if (i32.ne (i32.load (local.get $q)) (i32.const "http"))
                    (then (local.set $q (local.get $p))))))
              (call $emitTok
                (select
                  (enum.get $Token.title)
                  (select
                    (enum.get $Token.emphasis.strong)
                    (select (enum.get $Token.emphasis) (enum.get $Token.none) (i32.and (local.get $flags) (i32.const 2)))
                    (i32.and (local.get $flags) (i32.const 1)))
                  (i32.and (local.get $flags) (i32.const 4)))
                (local.get $lhs)
                (local.get $q))
              (global.set $ptr (local.get $p))
              (if (i32.lt_u (local.get $q) (local.get $p))
                (then
                  (block $urlDone
                    (loop $url
                      (local.set $v (call $templateByte (global.get $ptr)))
                      (br_if $urlDone
                        (i32.or
                          (i32.le_u (local.get $v) (i32.const 32))
                          (i32.or (byteset.get "()<>[]{}" (local.get $v)) (i32.eq (local.get $v) (i32.const 34)))))
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (br $url)))
                  ;; a sentence's closing punctuation is not part of the link
                  (loop $trim
                    (local.set $v (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
                    (if (byteset.get ".,:;" (local.get $v))
                      (then
                        (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))
                        (br $trim))))
                  (call $emitTok (enum.get $Token.link_uri) (local.get $q) (global.get $ptr))))
              (br $next)))

          ;; ---- math ----
          (if (i32.eq (local.get $top) (i32.const 4))
            (then
              (if (i32.eq (local.get $c) (i32.const "$"))
                (then
                  (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))
                  (local.set $tok (enum.get $Token.punctuation.bracket))
                  (br $emit)))
              (if (i32.eq (local.get $c) (i32.const 92))
                (then
                  (if (i32.gt_u (local.get $c2) (i32.const 13))
                    (then
                      (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 2)) (global.get $end)))))
                  (local.set $tok (enum.get $Token.string.escape))
                  (br $emit)))
              (if (i32.eq (local.get $c) (i32.const 34))
                (then
                  (global.set $ptr (local.get $lhs))
                  (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
                  (br $next)))
              ;; letters make names (`x`, `alpha`, `arrow.r`, `sqrt(x)`); `_`
              ;; and digits stay apart, as in `x_1` and `2x`
              (local.set $v (i32.or (local.get $c) (i32.const 32)))
              (if
                (i32.or
                  (i32.ge_u (local.get $c) (i32.const 0x80))
                  (i32.le_u (i32.sub (local.get $v) (i32.const "a")) (i32.const 25)))
                (then
                  (global.set $ptr (local.get $lhs))
                  (loop $name
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (local.set $v (call $templateByte (global.get $ptr)))
                    (if (i32.eq (local.get $v) (i32.const "."))
                      (then
                        (local.set $v (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                        (br_if $name (i32.le_u (i32.sub (i32.or (local.get $v) (i32.const 32)) (i32.const "a")) (i32.const 25)))
                        (local.set $v (i32.const "."))))
                    (br_if $name
                      (i32.or
                        (i32.ge_u (local.get $v) (i32.const 0x80))
                        (i32.le_u (i32.sub (i32.or (local.get $v) (i32.const 32)) (i32.const "a")) (i32.const 25)))))
                  ;; a single letter before `(` is a product, not a call
                  (local.set $tok
                    (select
                      (enum.get $Token.variable)
                      (select (enum.get $Token.function) (enum.get $Token.constant) (i32.eq (local.get $v) (i32.const "(")))
                      (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))))
                  (br $emit)))
              (if (call $lexIsDigit (local.get $c))
                (then
                  (loop $digits
                    (local.set $v (call $templateByte (global.get $ptr)))
                    (if
                      (i32.or
                        (call $lexIsDigit (local.get $v))
                        (i32.and
                          (i32.eq (local.get $v) (i32.const "."))
                          (call $lexIsDigit (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (br $digits))))
                  (local.set $tok (enum.get $Token.number))
                  (br $emit)))
              (local.set $tok
                (select
                  (enum.get $Token.punctuation.bracket)
                  (select
                    (enum.get $Token.punctuation.delimiter)
                    (enum.get $Token.operator)
                    (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";"))))
                  (byteset.get "()[]{}" (local.get $c))))
              (br $emit)))

          ;; ---- code ----
          (byte-switch (local.get $c)
            (case "\22"
              (if (local.get $atom)
                (then
                  (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.special) (i32.sub (local.get $lhs) (i32.const 1)) (local.get $lhs))))
              (global.set $ptr (local.get $lhs))
              (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
              (br $next))
            (case "{" "(" "[" "$"
              (local.set $stack
                (i64.or
                  (i64.shl (local.get $stack) (i64.const 3))
                  (i64.extend_i32_u
                    (select
                      (i32.const 2)
                      (select
                        (i32.const 3)
                        (select (i32.const 1) (i32.const 4) (i32.eq (local.get $c) (i32.const "[")))
                        (i32.eq (local.get $c) (i32.const "(")))
                      (i32.eq (local.get $c) (i32.const "{"))))))
              (local.set $tok (enum.get $Token.punctuation.bracket))
              (br $emit))
            (case "}" ")" "]"
              ;; a closer ends the statements and `#` expressions inside it
              (loop $close
                (local.set $top (i32.wrap_i64 (i64.and (local.get $stack) (i64.const 7))))
                (if (i32.ge_u (local.get $top) (i32.const 5))
                  (then
                    (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))
                    (br $close))))
              (if
                (i32.eq
                  (local.get $top)
                  (select
                    (i32.const 2)
                    (select (i32.const 3) (i32.const 1) (i32.eq (local.get $c) (i32.const ")")))
                    (i32.eq (local.get $c) (i32.const "}"))))
                (then (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))))
              (local.set $tok (enum.get $Token.punctuation.bracket))
              (br $emit))
            (case ";"
              (if (i32.eq (local.get $top) (i32.const 7))
                (then (local.set $stack (i64.shr_u (local.get $stack) (i64.const 3)))))
              (local.set $tok (enum.get $Token.punctuation.delimiter))
              (br $emit))
            (case "," ":"
              (local.set $tok (enum.get $Token.punctuation.delimiter))
              (br $emit))
            (case "."
              ;; `..` spreads, `.5` is a number, `.` reads a field
              (if (i32.eqz (call $lexIsDigit (local.get $c2)))
                (then
                  (if (i32.eq (local.get $c2) (i32.const "."))
                    (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
                  (local.set $tok
                    (select (enum.get $Token.punctuation.delimiter) (enum.get $Token.operator) (i32.ne (local.get $c2) (i32.const "."))))
                  (br $emit)))))
          (if
            (i32.or
              (i32.ge_u (local.get $c) (i32.const 0x80))
              (i32.or
                (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (i32.eq (local.get $c) (i32.const "_"))))
            (then
              (local.set $p (i32.sub (global.get $ptr) (i32.const 1)))
              (local.set $q
                (select (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 0) (i32.gt_u (local.get $p) (global.get $srcBase))))
              (call $scanIdentRun (i32.const "-"))
              (local.set $v (keyword-table.value $typstWords (local.get $p) (global.get $ptr)))
              (if (i32.ge_s (local.get $v) (i32.const 0))
                (then
                  (call $emitTok (i32.and (local.get $v) (i32.const 255)) (local.get $lhs) (global.get $ptr))
                  (if (i32.and (local.get $atom) (i32.ge_u (local.get $v) (i32.const 256)))
                    (then (local.set $stack (i64.or (local.get $stack) (i64.const 7)))))
                  (br $next)))
              (local.set $c2 (call $templateByte (global.get $ptr)))
              (local.set $tok
                (select
                  (select (enum.get $Token.function.method) (enum.get $Token.function) (i32.eq (local.get $q) (i32.const ".")))
                  (select
                    (enum.get $Token.property)
                    (select (enum.get $Token.property) (enum.get $Token.variable) (i32.eq (local.get $q) (i32.const ".")))
                    (i32.eq (local.get $c2) (i32.const ":")))
                  (i32.or (i32.eq (local.get $c2) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "[")))))
              (br $emit)))
          (if (i32.or (call $lexIsDigit (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
            (then
              (global.set $ptr (local.get $lhs))
              (call $lexScanNumber)
              (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "%"))
                (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
              (local.set $tok (enum.get $Token.number))
              (br $emit)))
          (local.set $tok
            (select (enum.get $Token.operator) (enum.get $Token.none) (byteset.get "!%&*+-/<=>?^|~" (local.get $c))))
          (br $emit))
        (call $emitTok (local.get $tok) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
