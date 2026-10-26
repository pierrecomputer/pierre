(module
  (import "../common.wat")

  ;; Each group value is a token plus a kind in bits 8 and up. Kinds 0-3 are
  ;; commands highlighted as function, keyword, keyword.import, or
  ;; punctuation.list_marker; the token is then the highlight of their next
  ;; `{...}` argument. Kind 4 is `\begin`/`\end`, 5 is `\verb`. Kinds 6 and up
  ;; name environments: 6 math, 7-11 verbatim-like, whose token highlights
  ;; the body.
  (keyword-table $latexWords $mem.latexWords $mem.lispWords
    (group $Token.title+256
      "part" "chapter" "section" "subsection" "subsubsection" "paragraph" "subparagraph"
      "title" "author")
    (group $Token.string+512
      "documentclass" "usepackage" "RequirePackage" "LoadClass" "input" "include"
      "includeonly" "includegraphics" "bibliography" "addbibresource")
    (group $Token.constant
      "label" "ref" "eqref" "pageref" "autoref" "cref" "Cref" "nameref" "cite" "citep"
      "citet" "nocite" "parencite" "textcite")
    (group $Token.link_uri "url" "href")
    (group $Token.emphasis.strong "textbf")
    (group $Token.emphasis "emph" "textit")
    (group $Token.function
      "newcommand" "renewcommand" "providecommand" "def" "let" "newenvironment"
      "renewenvironment" "DeclareMathOperator")
    (group $Token.none+768 "item")
    (group $Token.type+1024 "begin" "end")
    (group $Token.none+1280 "verb")
    (group $Token.none+1536
      "equation" "align" "gather" "multline" "flalign" "alignat" "eqnarray" "math"
      "displaymath")
    (group $Token.text.literal+1792 "verbatim")
    (group $Token.text.literal+2048 "Verbatim")
    (group $Token.text.literal+2304 "lstlisting")
    (group $Token.text.literal+2560 "minted")
    (group $Token.comment+2816 "comment"))

  ;; The end of an environment name at $p: its `}`, or the first byte that
  ;; cannot be part of a name on this line.
  (func $latexEnvNameEnd (param $p i32) (result i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done (byteset.get "{}\5c%$\0a\0d" (local.get $c)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; The keyword value of the environment name [$lhs,$rhs), plus 4096 when
  ;; it ends with `*`, or -1 for an unknown name.
  (func $latexEnvKey (param $lhs i32) (param $rhs i32) (result i32)
    (local $star i32)
    (local.set $star
      (i32.and
        (i32.gt_u (local.get $rhs) (local.get $lhs))
        (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "*"))))
    (i32.or
      (keyword-table.value $latexWords (local.get $lhs) (i32.sub (local.get $rhs) (local.get $star)))
      (i32.shl (local.get $star) (i32.const 12))))

  ;; $math: 0 text, 1 `$`, 2 `$$`, 3 `\(`, 4 `\[`, 5 a math environment.
  ;; $raw: the key of an open verbatim or comment environment; its body runs
  ;; to the `\end` with the same key.
  ;; $pend: the token for the next `{...}` argument of a command such as
  ;; `\section`; an optional `[...]` may come first ($pendOpt).
  ;; $argHl and $argDepth: the token and brace depth of the open argument,
  ;; plus 256 when it opened inside math, where it wins over the math token;
  ;; $outerHl and $outerDepth: the argument it interrupted.
  ;; $lineEmpty: no token since the last LF. A blank line ends math and
  ;; arguments, as in TeX, so a stray `$` or `{` cannot color the rest.
  ;; All are checkpointed.
  (func $hlLatex
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $p i32)
    (local $q i32)
    (local $v i32)
    (local $kind i32)
    (local $hl i32)
    (local $mask i32)
    (local $w v128)
    (local $range v128)
    (local $extra v128)
    (local $math i32)
    (local $raw i32)
    (local $depth i32)
    (local $pend i32)
    (local $pendOpt i32)
    (local $argHl i32)
    (local $argDepth i32)
    (local $outerHl i32)
    (local $outerDepth i32)
    (local $lineEmpty i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; a verbatim or comment body, also resumed at a chunk start
        (if (local.get $raw)
          (then
            (local.set $p (global.get $ptr))
            (block $closed
              (loop $find
                (local.set $p (call $lexFindByte (local.get $p) (i32.const 92)))
                (br_if $closed (i32.ge_u (local.get $p) (global.get $end)))
                (if
                  (i32.and
                    (i32.le_u (i32.add (local.get $p) (i32.const 5)) (global.get $end))
                    (i32.and
                      (i32.eq (i32.load (local.get $p)) (i32.const "\\end"))
                      (i32.eq (i32.load8_u offset=4 (local.get $p)) (i32.const "{"))))
                  (then
                    (local.set $q (call $latexEnvNameEnd (i32.add (local.get $p) (i32.const 5))))
                    (br_if $closed
                      (i32.and
                        (i32.lt_u (local.get $q) (global.get $end))
                        (i32.and
                          (i32.eq (i32.load8_u (local.get $q)) (i32.const "}"))
                          (i32.eq
                            (call $latexEnvKey (i32.add (local.get $p) (i32.const 5)) (local.get $q))
                            (local.get $raw)))))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $find)))
            (call $emitTok (i32.and (local.get $raw) (i32.const 255)) (global.get $ptr) (local.get $p))
            (global.set $ptr (local.get $p))
            (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
            (local.set $raw (i32.const 0))))

        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (local.set $p (local.get $lhs))
        (block $gapDone
          (loop $gap
            (br_if $gapDone (i32.ge_u (local.get $p) (global.get $ptr)))
            (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 10))
              (then
                (if (local.get $lineEmpty)
                  (then
                    (local.set $math (i32.const 0))
                    (local.set $pend (i32.const 0))
                    (local.set $pendOpt (i32.const 0))
                    (local.set $argHl (i32.const 0))
                    (local.set $argDepth (i32.const 0))
                    (local.set $outerHl (i32.const 0))
                    (local.set $outerDepth (i32.const 0))
                    (local.set $depth (i32.const 0))))
                (local.set $lineEmpty (i32.const 1))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $gap)))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lineEmpty (i32.const 0))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2
          (select
            (i32.load8_u offset=1 (local.get $lhs))
            (i32.const 0)
            (i32.lt_u (i32.add (local.get $lhs) (i32.const 1)) (global.get $end))))

        (block $bracket
          (byte-switch (local.get $c)
            (case "%"
              (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
              (br $next))
            (case "$"
              (local.set $pend (i32.mul (local.get $pend) (local.get $pendOpt)))
              (local.set $q (i32.const 1))
              (if (i32.eqz (local.get $math))
                (then
                  (local.set $q (i32.add (i32.const 1) (i32.eq (local.get $c2) (i32.const "$"))))
                  (local.set $math (local.get $q)))
                (else
                  (if (i32.eq (local.get $math) (i32.const 1))
                    (then (local.set $math (i32.const 0))))
                  ;; display math closes only with `$$`
                  (if
                    (i32.and (i32.eq (local.get $math) (i32.const 2)) (i32.eq (local.get $c2) (i32.const "$")))
                    (then
                      (local.set $q (i32.const 2))
                      (local.set $math (i32.const 0))))))
              (global.set $ptr (i32.add (local.get $lhs) (local.get $q)))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
              (br $next))
            (case "{"
              (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
              (if (i32.and (i32.ne (local.get $pend) (i32.const 0)) (i32.eqz (local.get $pendOpt)))
                (then
                  (local.set $outerHl (local.get $argHl))
                  (local.set $outerDepth (local.get $argDepth))
                  (local.set $argHl
                    (i32.or (local.get $pend) (select (i32.const 256) (i32.const 0) (local.get $math))))
                  (local.set $argDepth (local.get $depth))
                  (local.set $pend (i32.const 0))))
              (br $bracket))
            (case "}"
              (if (i32.and (i32.ne (local.get $argDepth) (i32.const 0)) (i32.eq (local.get $depth) (local.get $argDepth)))
                (then
                  (local.set $argHl (local.get $outerHl))
                  (local.set $argDepth (local.get $outerDepth))
                  (local.set $outerHl (i32.const 0))
                  (local.set $outerDepth (i32.const 0))))
              (if (local.get $depth)
                (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
              (local.set $pend (i32.const 0))
              (local.set $pendOpt (i32.const 0))
              (br $bracket))
            (case "["
              (local.set $pendOpt (i32.ne (local.get $pend) (i32.const 0)))
              (br $bracket))
            (case "]"
              (local.set $pendOpt (i32.const 0))
              (br $bracket))
            (case "&"
              (local.set $pend (i32.mul (local.get $pend) (local.get $pendOpt)))
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
              (br $next))
            (case "#"
              (local.set $pend (i32.mul (local.get $pend) (local.get $pendOpt)))
              (if (i32.le_u (i32.sub (local.get $c2) (i32.const "1")) (i32.const 8))
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                  (call $emitTok (enum.get $Token.variable.parameter) (local.get $lhs) (global.get $ptr))
                  (br $next))))
            (case "^" "_" "="
              (if (local.get $math)
                (then
                  (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (br $next))))
            (case "\5c"
              ;; a command inside a pending command's `[...]` keeps it pending
              (local.set $pend (i32.mul (local.get $pend) (local.get $pendOpt)))
              (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
              ;; a control symbol: `\\`, `\%`, or the math delimiters `\(`
              ;; `\)` `\[` `\]`; a backslash before a line break stays alone
              (if
                (i32.eqz
                  (i32.or
                    (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                    (i32.eq (local.get $c2) (i32.const "@"))))
                (then
                  (local.set $hl (enum.get $Token.function))
                  (if (i32.or (i32.eq (local.get $c2) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "[")))
                    (then
                      (if (i32.eqz (local.get $math))
                        (then
                          (local.set $math
                            (select (i32.const 3) (i32.const 4) (i32.eq (local.get $c2) (i32.const "("))))))
                      (local.set $hl (enum.get $Token.punctuation.bracket))))
                  (if (i32.or (i32.eq (local.get $c2) (i32.const ")")) (i32.eq (local.get $c2) (i32.const "]")))
                    (then
                      (if
                        (i32.eq
                          (local.get $math)
                          (select (i32.const 3) (i32.const 4) (i32.eq (local.get $c2) (i32.const ")"))))
                        (then (local.set $math (i32.const 0))))
                      (local.set $hl (enum.get $Token.punctuation.bracket))))
                  (if
                    (i32.and
                      (i32.lt_u (local.get $p) (global.get $end))
                      (i32.and (i32.ne (local.get $c2) (i32.const 10)) (i32.ne (local.get $c2) (i32.const 13))))
                    (then (local.set $p (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 1)) (global.get $end)))))
                  (global.set $ptr (local.get $p))
                  (call $emitTok (local.get $hl) (local.get $lhs) (local.get $p))
                  (br $next)))
              ;; a control word: letters and `@`, then an optional `*`
              (local.set $q (local.get $p))
              (block $nameDone
                (loop $name
                  (local.set $q (i32.add (local.get $q) (i32.const 1)))
                  (br_if $nameDone (i32.ge_u (local.get $q) (global.get $end)))
                  (local.set $c (i32.load8_u (local.get $q)))
                  (br_if $name
                    (i32.or
                      (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
                      (i32.eq (local.get $c) (i32.const "@"))))))
              (local.set $v (keyword-table.value $latexWords (local.get $p) (local.get $q)))
              (local.set $kind (i32.shr_s (local.get $v) (i32.const 8)))
              (if
                (i32.and
                  (i32.lt_u (local.get $q) (global.get $end))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const "*")))
                (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
              (global.set $ptr (local.get $q))
              (local.set $hl (enum.get $Token.function))
              (if (i32.le_u (local.get $kind) (i32.const 3))
                (then
                  (if (i32.eqz (local.get $pendOpt))
                    (then (local.set $pend (i32.and (local.get $v) (i32.const 255)))))
                  (local.set $hl
                    (select
                      (enum.get $Token.keyword)
                      (select
                        (enum.get $Token.keyword.import)
                        (select
                          (enum.get $Token.punctuation.list_marker)
                          (enum.get $Token.function)
                          (i32.eq (local.get $kind) (i32.const 3)))
                        (i32.eq (local.get $kind) (i32.const 2)))
                      (i32.eq (local.get $kind) (i32.const 1))))))
              (if (i32.eq (local.get $kind) (i32.const 4))
                (then (local.set $hl (enum.get $Token.keyword))))
              (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
              ;; `\verb|...|`: the body ends at the delimiter or the line
              (if (i32.eq (local.get $kind) (i32.const 5))
                (then
                  (local.set $c
                    (select
                      (i32.load8_u (global.get $ptr))
                      (i32.const 0)
                      (i32.lt_u (global.get $ptr) (global.get $end))))
                  (if
                    (i32.and
                      (i32.le_u (i32.sub (local.get $c) (i32.const 33)) (i32.const 93))
                      (i32.gt_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
                    (then
                      (local.set $p
                        (call $lexFindEither
                          (i32.add (global.get $ptr) (i32.const 1))
                          (local.get $c)
                          (i32.const 10)))
                      (if
                        (i32.and
                          (i32.lt_u (local.get $p) (global.get $end))
                          (i32.eq (i32.load8_u (local.get $p)) (local.get $c)))
                        (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                      (call $emitTok (enum.get $Token.text.literal) (global.get $ptr) (local.get $p))
                      (global.set $ptr (local.get $p))))))
              ;; `\begin{name}` and `\end{name}` on one line; without a closed
              ;; name on this line, the next group still names it
              (if (i32.eq (local.get $kind) (i32.const 4))
                (then
                  ;; `\end` is the four-byte command
                  (local.set $c2 (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 4)))
                  (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                  (local.set $q (local.get $p))
                  (if
                    (i32.and
                      (i32.lt_u (local.get $p) (global.get $end))
                      (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))
                    (then (local.set $q (call $latexEnvNameEnd (i32.add (local.get $p) (i32.const 1))))))
                  (if
                    (i32.or
                      (i32.eq (local.get $q) (local.get $p))
                      (i32.or
                        (i32.ge_u (local.get $q) (global.get $end))
                        (i32.ne (i32.load8_u (local.get $q)) (i32.const "}"))))
                    (then
                      (local.set $pend (enum.get $Token.type))
                      (br $next)))
                  (call $emitGap (global.get $ptr) (local.get $p))
                  (call $emitTok
                    (enum.get $Token.punctuation.bracket)
                    (local.get $p)
                    (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.type) (i32.add (local.get $p) (i32.const 1)) (local.get $q))
                  (global.set $ptr (i32.add (local.get $q) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $q) (global.get $ptr))
                  (local.set $v (call $latexEnvKey (i32.add (local.get $p) (i32.const 1)) (local.get $q)))
                  (local.set $kind
                    (select
                      (i32.shr_u (i32.and (local.get $v) (i32.const 4095)) (i32.const 8))
                      (i32.const -1)
                      (i32.ge_s (local.get $v) (i32.const 0))))
                  (if (local.get $c2)
                    (then
                      (if (i32.and (i32.eq (local.get $kind) (i32.const 6)) (i32.eq (local.get $math) (i32.const 5)))
                        (then (local.set $math (i32.const 0))))
                      (br $next)))
                  (if (i32.and (i32.eq (local.get $kind) (i32.const 6)) (i32.eqz (local.get $math)))
                    (then (local.set $math (i32.const 5))))
                  (if (i32.ge_s (local.get $kind) (i32.const 7))
                    (then
                      (local.set $raw (local.get $v))
                      ;; Verbatim, lstlisting, and minted options and minted's
                      ;; language, on the `\begin` line, precede the body
                      (block $optsDone
                        (loop $opts
                          (br_if $optsDone (i32.or (i32.lt_s (local.get $kind) (i32.const 8)) (i32.gt_s (local.get $kind) (i32.const 10))))
                          (br_if $optsDone (i32.ge_u (global.get $ptr) (global.get $end)))
                          (local.set $c (i32.load8_u (global.get $ptr)))
                          (br_if $optsDone (i32.and (i32.ne (local.get $c) (i32.const "[")) (i32.ne (local.get $c) (i32.const "{"))))
                          (local.set $p
                            (call $lexFindEither
                              (i32.add (global.get $ptr) (i32.const 1))
                              (i32.add (local.get $c) (i32.const 2))
                              (i32.const 10)))
                          (br_if $optsDone
                            (i32.or
                              (i32.ge_u (local.get $p) (global.get $end))
                              (i32.eq (i32.load8_u (local.get $p)) (i32.const 10))))
                          (call $emitTok
                            (enum.get $Token.punctuation.bracket)
                            (global.get $ptr)
                            (i32.add (global.get $ptr) (i32.const 1)))
                          (call $emitTok (enum.get $Token.none) (i32.add (global.get $ptr) (i32.const 1)) (local.get $p))
                          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                          (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
                          (br $opts)))))))
              (br $next)))
          ;; plain text up to the next special byte or line break; it ends a
          ;; pending argument unless it sits in that command's `[...]`
          (local.set $pend (i32.mul (local.get $pend) (local.get $pendOpt)))
          (local.set $range (i8x16.splat (select (i32.const 4) (i32.const 2) (local.get $math))))
          (local.set $extra (i8x16.splat (select (i32.const "=") (i32.const 10) (local.get $math))))
          (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
          (block $found
            (loop $wide
              (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
              (local.set $w (v128.load (local.get $p)))
              ;; `#$%&`, `[\]` (`[\]^_` in math), `{`, `}`, LF, and `=` in math
              (local.set $mask
                (i8x16.bitmask
                  (v128.or
                    (v128.or
                      (i8x16.le_u (i8x16.sub (local.get $w) (i8x16.splat (i32.const "#"))) (i8x16.splat (i32.const 3)))
                      (i8x16.le_u (i8x16.sub (local.get $w) (i8x16.splat (i32.const "["))) (local.get $range)))
                    (v128.or
                      (v128.or
                        (i8x16.eq (local.get $w) (i8x16.splat (i32.const "{")))
                        (i8x16.eq (local.get $w) (i8x16.splat (i32.const "}"))))
                      (v128.or
                        (i8x16.eq (local.get $w) (i8x16.splat (i32.const 10)))
                        (i8x16.eq (local.get $w) (local.get $extra)))))))
              (if (local.get $mask)
                (then
                  (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
                  (br $found)))
              (local.set $p (i32.add (local.get $p) (i32.const 16)))
              (br $wide)))
          (if (i32.gt_u (local.get $p) (global.get $end))
            (then (local.set $p (global.get $end))))
          (global.set $ptr (local.get $p))
          (local.set $hl (select (enum.get $Token.number) (enum.get $Token.none) (local.get $math)))
          (if
            (i32.and
              (i32.ne (local.get $argDepth) (i32.const 0))
              (i32.or (i32.ge_u (local.get $argHl) (i32.const 256)) (i32.eqz (local.get $math))))
            (then (local.set $hl (i32.and (local.get $argHl) (i32.const 255)))))
          (call $emitTok (local.get $hl) (local.get $lhs) (local.get $p))
          (br $next))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
