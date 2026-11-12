(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.rakuWords 376)

  (import "@pierre/wat-tools/common.wat")
  (import "./perl.wat")

  ;; Each value is the word's token; the high byte is what the next name is
  ;; (see $decl in $hlRaku): 1 a routine, 2 a type, 3 a module, 5 a trait,
  ;; 7 a regex routine, whose `{` opens a regex body.
  (keyword-table $rakuWords $mem.rakuWords $mem.rakuWords+376
    (group $Token.keyword.declaration "my" "our" "has" "state" "constant" "unit" "anon")
    (group $Token.keyword.declaration+256 "sub" "method" "submethod" "multi" "proto")
    (group $Token.keyword.declaration+512 "class" "role" "grammar" "module" "package" "enum" "subset")
    (group $Token.keyword.declaration+1792 "token" "rule" "regex")
    (group $Token.keyword.import+768 "use" "need" "import" "require")
    (group $Token.keyword.control
      "if" "elsif" "else" "unless" "given" "when" "default" "for" "while" "until" "loop" "repeat"
      "last" "next" "redo" "return" "gather" "take" "start" "react" "whenever" "supply" "emit" "try"
      "with" "without" "orwith" "do" "once" "quietly" "lazy")
    (group $Token.keyword
      "BEGIN" "END" "ENTER" "LEAVE" "CATCH" "CONTROL" "INIT" "FIRST" "NEXT" "LAST" "KEEP" "UNDO"
      "PRE" "POST" "CHECK" "QUIT" "CLOSE" "of")
    (group $Token.keyword+1280 "is" "does" "but")
    (group $Token.keyword.operator
      "and" "or" "not" "xor" "andthen" "orelse" "eq" "ne" "lt" "le" "gt" "ge" "leg" "cmp" "xx"
      "div" "mod" "gcd" "lcm" "before" "after")
    (group $Token.boolean "True" "False")
    (group $Token.constant.builtin "Nil")
    (group $Token.variable.special "self"))

  ;; 1 when the UTF-8 code point at $p is an operator: a Latin-1 symbol but
  ;; `ª µ º` (`« » ² ¬`), `×`, `÷`, or a character of U+2000-U+22FF
  ;; (punctuation, arrows, math: `∈ ∘ …`).
  (func $rakuIsOp (param $p i32) (result i32)
    (local $b0 i32)
    (local $b1 i32)
    (local.set $b0 (call $templateByte (local.get $p)))
    (local.set $b1 (call $templateByte (i32.add (local.get $p) (i32.const 1))))
    (i32.or
      (i32.and
        (i32.eq (local.get $b0) (i32.const 0xe2))
        (i32.le_u (i32.sub (local.get $b1) (i32.const 0x80)) (i32.const 0x0b)))
      (i32.or
        (i32.and
          (i32.and
            (i32.eq (local.get $b0) (i32.const 0xc2))
            (i32.le_u (i32.sub (local.get $b1) (i32.const 0xa1)) (i32.const 0x1e)))
          (i32.and
            (i32.ne (local.get $b1) (i32.const 0xaa))
            (i32.and (i32.ne (local.get $b1) (i32.const 0xb5)) (i32.ne (local.get $b1) (i32.const 0xba)))))
        (i32.and
          (i32.eq (local.get $b0) (i32.const 0xc3))
          (i32.eq (i32.or (local.get $b1) (i32.const 0x20)) (i32.const 0xb7))))))

  ;; The end of the name at $p: letters, digits, `_`, a `-` or `'` before a
  ;; letter (`is-done`, `isn't`), `::` before a name (`Foo::Bar`), and
  ;; non-ASCII characters that are not operators.
  (func $rakuName (param $p i32) (result i32)
    (local $c i32)
    (local $c2 i32)
    (block $done
      (loop $l
        (local.set $c (call $templateByte (local.get $p)))
        (local.set $c2 (call $templateByte (i32.add (local.get $p) (i32.const 1))))
        (if (i32.ge_u (local.get $c) (i32.const 0x80))
          (then
            (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
            (br_if $done (call $rakuIsOp (local.get $p)))
            (local.set $p (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 1)) (global.get $end)))
            (br $l)))
        (if
          (i32.and
            (call $lexIsIdentContinue (local.get $c))
            (i32.ne (local.get $c) (i32.const "$")))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if
          (i32.and
            (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const 39)))
            (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25)))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 2)))
            (br $l)))
        (br_if $done
          (i32.eqz
            (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":")))
              (call $lexIsNameStart (call $templateByte (i32.add (local.get $p) (i32.const 2)))))))
        (local.set $p (i32.add (local.get $p) (i32.const 2)))
        (br $l)))
    (local.get $p))

;; 1 when the token at $lhs touches the token before it: no blank between
  ;; them, and not at a chunk start, which a line-fed stream cannot see past.
  (func $rakuGlued (param $lhs i32) (param $gap i32) (result i32)
    (i32.and (i32.eq (local.get $lhs) (local.get $gap)) (i32.gt_u (local.get $lhs) (global.get $srcBase))))

  ;; Scan a quoted body from $ptr up to the $close byte at nesting depth
  ;; zero; $open nests (zero when none), and $depth is the nesting already
  ;; open. $flags: 1 interpolates `$x` and `@x[`, 2 colors a regex, 4 a
  ;; comment, which has no escapes, and 8 stops at a `{` code block. In a
  ;; body without 1 or 2 a `\` escapes only the delimiters and `\`.
  ;; Returns 1 past the closer, 2 at a code block's `{`, or 0 at $end, plus
  ;; four times the nesting depth still open.
  (func $rakuBody (param $close i32) (param $open i32) (param $depth i32) (param $flags i32) (result i32)
    (local $c i32)
    (local $c2 i32)
    (local $e i32)
    (local $hl i32)
    (local $seg i32)
    (local $status i32)
    (local $stop i32)
    (local $mark i32)
    (local.set $hl
      (select
        (enum.get $Token.comment)
        (select
          (enum.get $Token.string.regex)
          (enum.get $Token.string)
          (i32.and (local.get $flags) (i32.const 2)))
        (i32.and (local.get $flags) (i32.const 4))))
    (local.set $seg (global.get $ptr))
    (local.set $stop (global.get $ptr))
    (local.set $mark (global.get $ptr))
    (block $done
      (loop $scan
        ;; the next closer or backslash, and the next opener, `$`, `@`, or
        ;; `{` before it, each found with one SIMD hop (see $perlQuoteBody)
        (if
          (i32.or
            (i32.ge_u (global.get $ptr) (local.get $stop))
            (i32.gt_u (global.get $ptr) (local.get $mark)))
          (then
            (local.set $mark
              (call $scanFind3
                (global.get $ptr)
                (select
                  (local.get $open)
                  (select (i32.const "{") (local.get $close) (i32.and (local.get $flags) (i32.const 8)))
                  (local.get $open))
                (select (i32.const "$") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
                (select (i32.const "@") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))))))
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (local.get $close)
                (i32.eqz (i32.and (local.get $flags) (i32.const 4)))
                (i32.const 0)))))
        (global.set $ptr
          (select (local.get $mark) (local.get $stop) (i32.lt_u (local.get $mark) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $depth)
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (br $scan)))
            (local.set $status (i32.const 1))
            (br $done)))
        (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $c) (local.get $open)))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $status (i32.const 2))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (if
              (i32.eqz
                (i32.or
                  (i32.and (local.get $flags) (i32.const 3))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const 92))
                    (i32.or (i32.eq (local.get $c2) (local.get $close)) (i32.eq (local.get $c2) (local.get $open))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $scan)))
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        ;; `$x`, `$!x`, `$.x`, `$*X`, and `@x` before a subscript
        (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "$"))
            (byteset.get "!*.?^:=~" (local.get $c2)))
          (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))
        (if (call $lexIsNameStart (call $templateByte (local.get $e)))
          (then
            (local.set $e (call $rakuName (local.get $e)))
            (local.set $c2 (call $templateByte (local.get $e)))
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const "$"))
                (byteset.get "()<>[]{}" (local.get $c2)))
              (then
                (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
                (call $emitTok (enum.get $Token.variable) (global.get $ptr) (local.get $e))
                (global.set $ptr (local.get $e))
                (local.set $seg (local.get $e))
                (br $scan)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.or (local.get $status) (i32.shl (local.get $depth) (i32.const 2))))

  ;; $sq describes an open quoted body: its closer, its opener << 8, and its
  ;; flags << 16 (see $rakuBody; 16 marks a second body to follow, as in
  ;; `s/a/b/`), with $sDepth its open nesting. $operand is 1 where a term
  ;; may start, so `/` and `<` open a regex and quote words. $decl is what
  ;; the next name is: 1 a routine, 2 a type, 3 a module, 4 none but a `{`
  ;; opens a regex body, 5 a trait, 6 a method after `.`, 7 a regex routine.
  ;; $lineHead is 1 until the first token of a line, where Pod counts. $pod
  ;; is 1 on a Pod paragraph line, 2 when the next line may continue it,
  ;; and 3 after `=finish`. A heredoc opener leaves $hdLen and $hdDelim
  ;; pending until the line break. $bits holds one bit per open `{`, set
  ;; for a code block inside a `"` string, whose `}` returns to the string.
  (func $hlRaku
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    (local $atHead i32)
    (local $operand i32)
    (local $decl i32)
    (local $lineHead i32)
    (local $pod i32)
    (local $sq i32)
    (local $sDepth i32)
    (local $hdLen i32)
    (local $hdDelim i32)
    (local $bits i32)
    (local.set $lineHead (i32.const 1))
    (local.set $operand (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; token tails, innermost first: $literal opens a quoted body,
        ;; $valueTok and $opTok set what may follow, and $tok emits
        ;; [$lhs,$ptr) as $hl
        (block $tok
        (block $opTok
        (block $valueTok
        (block $literal
        (local.set $gap (global.get $ptr))
        ;; everything after `=finish` is Pod
        (if (i32.eq (local.get $pod) (i32.const 3))
          (then
            (global.set $ptr (global.get $end))
            (call $emitTok (enum.get $Token.comment.doc) (local.get $gap) (global.get $ptr))
            (br $done)))
        (if (local.get $hdLen)
          (then
            ;; the pending heredoc body starts after this line's break
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (local.set $c (call $templateByte (global.get $ptr)))
            (if (byteset.get "\n\r" (local.get $c))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 13))
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const 10)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitGap (local.get $gap) (global.get $ptr))
                (call $perlLineDelimited
                  (local.get $hdDelim)
                  (local.get $hdLen)
                  (i32.const 1)
                  (enum.get $Token.string))
                (local.set $hdLen (i32.const 0))
                (local.set $lineHead (i32.const 1))
                (local.set $operand (i32.const 1))
                (br $next)))))

        ;; an open quoted body
        (if (local.get $sq)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (call $rakuBody
              (i32.and (local.get $sq) (i32.const 255))
              (i32.and (i32.shr_u (local.get $sq) (i32.const 8)) (i32.const 255))
              (local.get $sDepth)
              (i32.shr_u (local.get $sq) (i32.const 16))))
            (local.set $sDepth (i32.shr_u (local.get $c) (i32.const 2)))
            (if (i32.and (local.get $c) (i32.const 2))
              (then
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $bits (i32.or (i32.shl (local.get $bits) (i32.const 1)) (i32.const 1)))
                (local.set $sq (i32.const 0))
                (local.set $operand (i32.const 1))
                (br $next)))
            (if (i32.and (local.get $c) (i32.const 1))
              (then
                (local.set $operand (i32.const 0))
                (if (i32.eqz (i32.and (local.get $sq) (i32.const 0x100000)))
                  (then
                    (local.set $sq (i32.const 0))
                    (br $next)))
                ;; `s{a}{b}` opens its second body with fresh brackets;
                ;; `s/a/b/` continues to the next closer
                (local.set $sq (i32.xor (local.get $sq) (i32.const 0x100000)))
                (br_if $next (i32.eqz (i32.and (local.get $sq) (i32.const 0xff00))))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
                (call $emitGap (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (local.set $c (call $templateByte (local.get $lhs)))
                (local.set $c2 (call $perlCloser (local.get $c)))
                (if (i32.or (i32.eq (local.get $c) (local.get $c2)) (i32.ge_u (local.get $lhs) (global.get $end)))
                  (then
                    (local.set $sq (i32.const 0))
                    (br $next)))
                (local.set $sq
                  (i32.or
                    (i32.and (local.get $sq) (i32.const 0xff0000))
                    (i32.or (local.get $c2) (i32.shl (local.get $c) (i32.const 8)))))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            (local.set $hdLen (i32.const 0))
            ;; a blank line ends a Pod paragraph, as a line-fed stream sees it
            (if (local.get $pod)
              (then
                (local.set $p (call $lexFindEither (local.get $gap) (i32.const 10) (i32.const 13)))
                (local.set $p
                  (i32.add
                    (local.get $p)
                    (i32.add
                      (i32.const 1)
                      (i32.and
                        (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
                        (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 10))))))
                (local.set $pod
                  (select
                    (i32.const 0)
                    (i32.shl (i32.eq (local.get $pod) (i32.const 1)) (i32.const 1))
                    (call $lexGapHasBreak (local.get $p) (global.get $ptr))))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        ;; Pod: `=begin NAME` runs to `=end NAME`, `=finish` to the end, and
        ;; other directives (`=head1`, `=item`, `=for`) to a blank line
        (if
          (i32.and
            (i32.and (local.get $atHead) (i32.eq (local.get $c) (i32.const "=")))
            (call $lexIsNameStart (local.get $c2)))
          (then
            (local.set $p (call $rakuName (i32.add (local.get $lhs) (i32.const 1))))
            (local.set $kind (i32.sub (local.get $p) (local.get $lhs)))
            (local.set $c (i32.load offset=1 (local.get $lhs)))
            (if (i32.and (i32.eq (local.get $kind) (i32.const 7)) (i32.eq (local.get $c) (i32.const "fini")))
              (then
                (local.set $pod (i32.const 3))
                (br $next)))
            (local.set $lineHead (i32.const 1))
            (local.set $operand (i32.const 1))
            (if (i32.and (i32.eq (local.get $kind) (i32.const 6)) (i32.eq (local.get $c) (i32.const "begi")))
              (then
                (local.set $p (call $lexSkipSpaceAt (local.get $p)))
                (local.set $kind (i32.sub (call $rakuName (local.get $p)) (local.get $p)))
                (if (i32.gt_u (local.get $kind) (i32.const 27))
                  (then (local.set $kind (i32.const 27))))
                (i32.store (i32.const $mem.streamDelimiter) (i32.const "=end"))
                (i32.store8 (i32.const $mem.streamDelimiter+4) (i32.const 32))
                (memory.copy (i32.const $mem.streamDelimiter+5) (local.get $p) (local.get $kind))
                (call $perlLineDelimited
                  (i32.const $mem.streamDelimiter)
                  (i32.add (local.get $kind) (i32.const 5))
                  (i32.const 5)
                  (enum.get $Token.comment.doc))
                (br $next)))
            (call $lexLineComment (i32.const 0) (enum.get $Token.comment.doc))
            (local.set $pod (i32.const 1))
            (br $next)))
        ;; a line that continues a Pod paragraph
        (if (i32.and (local.get $atHead) (i32.eq (local.get $pod) (i32.const 2)))
          (then
            (call $lexLineComment (i32.const 0) (enum.get $Token.comment.doc))
            (local.set $pod (i32.const 1))
            (local.set $lineHead (i32.const 1))
            (br $next)))
        (local.set $pod (i32.const 0))

        ;; comments: `#|` and `#=` document a declaration, and `` #`( ) ``
        ;; embeds a comment in any bracket pair
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "`"))
              (then
                (local.set $c (call $perlCloser (local.get $c3)))
                (if (i32.ne (local.get $c) (local.get $c3))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                    (local.set $sq
                      (i32.or (i32.or (local.get $c) (i32.shl (local.get $c3) (i32.const 8))) (i32.const 0x40000)))
                    (local.set $lineHead (local.get $atHead))
                    (br $literal)))))
            (call $lexLineComment
              (i32.const 1)
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c2) (i32.const "|")) (i32.eq (local.get $c2) (i32.const "=")))))
            (local.set $lineHead (local.get $atHead))
            (br $next)))

        ;; strings, `/regex/` and `<quote words>` where a term may start
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $sq (i32.const 0x090022))
            (br $literal)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $sq (i32.const 39))
            (br $literal)))
        (if (local.get $operand)
          (then
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (local.set $sq (i32.const 0x02002f))
                (br $literal)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "<"))
                (i32.and (i32.ne (local.get $c2) (i32.const "<")) (i32.ne (local.get $c2) (i32.const "="))))
              (then
                (local.set $sq (i32.const 0x3c3e))
                (br $literal)))))
        ;; a glued subscript or pair value: `%h<key>`, `$<name>`, `:a<b>`
        (if
          (i32.and
            (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $rakuGlued (local.get $lhs) (local.get $gap)))
            (call $lexIsNameStart (local.get $c2)))
          (then
            (local.set $p (call $rakuName (global.get $ptr)))
            (if (i32.eq (call $templateByte (local.get $p)) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (local.set $hl (enum.get $Token.string))
                (br $valueTok)))))
        ;; `｢...｣` quotes without escapes
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 0xef))
            (i32.and (i32.eq (local.get $c2) (i32.const 0xbd)) (i32.eq (local.get $c3) (i32.const 0xa2))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
            (local.set $kind (i32.const 0))
            (block $closed
              (loop $find
                (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 0xa3)))
                (br_if $closed (i32.ge_u (global.get $ptr) (global.get $end)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $kind
                  (i32.eq
                    (i32.load16_u (i32.sub (global.get $ptr) (i32.const 3)))
                    (i32.const 0xbdef)))
                (br_if $find (i32.eqz (local.get $kind)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (if (i32.eqz (local.get $kind))
              (then (call $streamSetFixed32 (i32.const 0xa3bdef) (i32.const 3) (enum.get $Token.string))))
            (local.set $operand (i32.const 0))
            (br $next)))

        ;; sigils with twigils: `$x @a %h &f $.attr $!priv $*DYN $?FILE $^a $:n`
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "@")))
            (i32.and
              (local.get $operand)
              (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "&")))))
          (then
            (local.set $p (global.get $ptr))
            (local.set $hl (enum.get $Token.variable))
            (if
              (i32.and
                (byteset.get "!*.?^:=~" (local.get $c2))
                (call $lexIsNameStart (local.get $c3)))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $hl (enum.get $Token.variable.special))
                (if (i32.or (i32.eq (local.get $c2) (i32.const "!")) (i32.eq (local.get $c2) (i32.const ".")))
                  (then (local.set $hl (enum.get $Token.property))))
                (if (i32.or (i32.eq (local.get $c2) (i32.const "^")) (i32.eq (local.get $c2) (i32.const ":")))
                  (then (local.set $hl (enum.get $Token.variable.parameter))))))
            (if (call $lexIsNameStart (call $templateByte (local.get $p)))
              (then
                (global.set $ptr (call $rakuName (local.get $p)))
                (if (i32.eq (local.get $c) (i32.const "&"))
                  (then (local.set $hl (enum.get $Token.function))))
                (if
                  (i32.and
                    (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 2)))
                    (i32.eq (local.get $c2) (i32.const "_")))
                  (then (local.set $hl (enum.get $Token.variable.special))))
                (br $valueTok)))
            ;; `$/`, `$!`, `$0`, and a bare sigil
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "$"))
                (i32.or
                  (i32.or (i32.eq (local.get $c2) (i32.const "!")) (i32.eq (local.get $c2) (i32.const "/")))
                  (call $lexIsDigit (local.get $c2))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (local.set $hl (enum.get $Token.variable.special))
            (br_if $valueTok (i32.ne (local.get $c) (i32.const "&")))))

        (if (i32.ge_u (local.get $c) (i32.const 0x80))
          (then
            (if (call $rakuIsOp (local.get $lhs))
              (then
                (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
                (local.set $hl (enum.get $Token.operator))
                (br $opTok)))))
        (if (call $lexIsNameStart (local.get $c))
          (then
            (local.set $rhs (call $rakuName (local.get $lhs)))
            (global.set $ptr (local.get $rhs))
            (if (i32.eq (local.get $decl) (i32.const 6))
              (then
                (local.set $decl (i32.const 0))
                (local.set $hl (enum.get $Token.function.method))
                (br $valueTok)))
            (local.set $kind (keyword-table.value $rakuWords (local.get $lhs) (local.get $rhs)))
            (block $word
              ;; quote-like words with adverbs: `q:to/END/`, `qq{}`, `m:i//`,
              ;; `rx//`, `s///`, `tr///`
              (local.set $hl (i32.sub (local.get $rhs) (local.get $lhs)))
              (br_if $word (i32.gt_u (local.get $hl) (i32.const 3)))
              (local.set $c (i32.and (i32.load (local.get $lhs)) (i32.shr_u (i32.const -1) (i32.shl (i32.sub (i32.const 4) (local.get $hl)) (i32.const 3)))))
              (local.set $hl
                (select
                  (i32.const 0x0100)
                  (select
                    (i32.const 0x0000)
                    (select
                      (i32.const 0x0200)
                      (select (i32.const 0x1200) (i32.const -1)
                        (i32.or
                          (i32.or (i32.eq (local.get $c) (i32.const "s")) (i32.eq (local.get $c) (i32.const "S")))
                          (i32.or (i32.eq (local.get $c) (i32.const "tr")) (i32.eq (local.get $c) (i32.const "TR")))))
                      (i32.or (i32.eq (local.get $c) (i32.const "m")) (i32.eq (local.get $c) (i32.const "rx"))))
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const "q")) (i32.eq (local.get $c) (i32.const "Q")))
                      (i32.or (i32.eq (local.get $c) (i32.const "qw")) (i32.eq (local.get $c) (i32.const "qx")))))
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "qq")) (i32.eq (local.get $c) (i32.const "qqw")))
                    (i32.eq (local.get $c) (i32.const "qqx")))))
              (br_if $word (i32.lt_s (local.get $hl) (i32.const 0)))
              ;; adverbs; `:to` and `:heredoc` make a heredoc
              (local.set $c2 (i32.const 0))
              (local.set $p (local.get $rhs))
              (block $advDone
                (loop $adverb
                  (br_if $advDone (i32.ne (call $templateByte (local.get $p)) (i32.const ":")))
                  (br_if $advDone (i32.eqz (call $lexIsNameStart (call $templateByte (i32.add (local.get $p) (i32.const 1))))))
                  (local.set $c3 (call $rakuName (i32.add (local.get $p) (i32.const 1))))
                  (if
                    (i32.or
                      (i32.and
                        (i32.eq (i32.sub (local.get $c3) (local.get $p)) (i32.const 3))
                        (i32.eq (i32.load16_u offset=1 (local.get $p)) (i32.const "to")))
                      (i32.and
                        (i32.eq (i32.sub (local.get $c3) (local.get $p)) (i32.const 8))
                        (i64.eq
                          (i64.and (i64.load offset=1 (local.get $p)) (i64.const 0xffffffffffffff))
                          (i64.const "heredoc"))))
                    (then (local.set $c2 (i32.const 1))))
                  (local.set $p (local.get $c3))
                  (br $adverb)))
              (local.set $c (call $templateByte (local.get $p)))
              (br_if $word
                (i32.or
                  (i32.or
                    (i32.ge_u (local.get $p) (global.get $end))
                    (i32.or (i32.le_u (local.get $c) (i32.const 32)) (i32.ge_u (local.get $c) (i32.const 128))))
                  (i32.or
                    (call $lexIsIdentContinue (local.get $c))
                    (i32.or
                      (byteset.get ":),=;]}" (local.get $c))
                      (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "#")))))))
              (local.set $c3 (call $perlCloser (local.get $c)))
              ;; a heredoc's terminator word sits on this line; its body starts on the next
              (if (local.get $c2)
                (then
                  (local.set $hdDelim (i32.add (local.get $p) (i32.const 1)))
                  (global.set $ptr
                    (call $scanFindSpecial (local.get $hdDelim) (global.get $end) (local.get $c3) (i32.const 0) (i32.const 1)))
                  (if (i32.eq (call $templateByte (global.get $ptr)) (local.get $c3))
                    (then
                      (local.set $hdLen (i32.sub (global.get $ptr) (local.get $hdDelim)))
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (local.set $hl (enum.get $Token.string))
                      (br $valueTok)))))
              (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
              (local.set $sq
                (i32.or
                  (i32.or (local.get $c3) (i32.shl (select (i32.const 0) (local.get $c) (i32.eq (local.get $c) (local.get $c3))) (i32.const 8)))
                  (i32.shl (local.get $hl) (i32.const 8))))
              (br $literal))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $c3 (call $templateByte (local.get $p)))
            ;; a declarator wins over a pending name
            (if
              (i32.and
                (i32.and (i32.ne (local.get $decl) (i32.const 0)) (i32.ne (local.get $decl) (i32.const 4)))
                (i32.ne (i32.and (local.get $kind) (i32.const 255)) (enum.get $Token.keyword.declaration)))
              (then
                (local.set $hl (enum.get $Token.function.definition))
                (local.set $c (local.get $decl))
                (local.set $decl (i32.shl (i32.eq (local.get $c) (i32.const 7)) (i32.const 2)))
                (br_if $tok (i32.eq (local.get $c) (i32.const 1)))
                (br_if $tok (i32.eq (local.get $c) (i32.const 7)))
                (local.set $hl (enum.get $Token.type))
                (br_if $valueTok (i32.eq (local.get $c) (i32.const 2)))
                (local.set $hl (enum.get $Token.namespace))
                (if (i32.eq (local.get $c) (i32.const 3))
                  (then
                    ;; `use v6.d`
                    (block $verDone
                      (loop $ver
                        (br_if $verDone (i32.ne (call $templateByte (global.get $ptr)) (i32.const ".")))
                        (br_if $verDone
                          (i32.eqz (call $lexIsIdentContinue (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                        (global.set $ptr (call $rakuName (i32.add (global.get $ptr) (i32.const 1))))
                        (br $ver)))
                    (br $opTok)))
                ;; a trait: `is rw`, `does Role`
                (if (i32.eq (local.get $c) (i32.const 5))
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.attribute)
                        (enum.get $Token.type)
                        (i32.ge_u (i32.load8_u (local.get $lhs)) (i32.const "a"))))
                    (br $valueTok)))))
            ;; a pair key before `=>`
            (if
              (i32.and
                (i32.eq (local.get $c3) (i32.const "="))
                (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">")))
              (then
                (local.set $hl (enum.get $Token.string.special.symbol))
                (br $valueTok)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $decl (i32.shr_u (local.get $kind) (i32.const 8)))
                ;; a trait follows a term; `is` before a term is the Test function
                (if (i32.eq (local.get $decl) (i32.const 5))
                  (then
                    (if (local.get $operand)
                      (then
                        (local.set $decl (i32.const 0))
                        (local.set $hl (enum.get $Token.function))
                        (br $opTok)))))
                (br_if $valueTok
                  (i32.or
                    (i32.or
                      (i32.eq (local.get $hl) (enum.get $Token.boolean))
                      (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))
                    (i32.eq (local.get $hl) (enum.get $Token.variable.special))))
                (br $opTok)))
            (local.set $decl (i32.const 0))
            ;; the repetition operator `x`, too short for the table, and
            ;; `where`, whose hash `while` has
            (local.set $hl (enum.get $Token.keyword.operator))
            (br_if $opTok
              (i32.and
                (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1)))
                (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "x"))))
            (local.set $hl (enum.get $Token.keyword))
            (br_if $opTok
              (i32.and
                (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 5)))
                (i64.eq
                  (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff))
                  (i64.const "where"))))
            (local.set $hl (enum.get $Token.constant))
            (br_if $valueTok (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))
            (local.set $hl (enum.get $Token.type))
            (br_if $valueTok (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
            ;; any other name calls a routine, which takes its arguments as terms
            (local.set $hl (enum.get $Token.function))
            (br $opTok)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (local.set $hl (enum.get $Token.number))
            (br $valueTok)))

        ;; pairs: `:name`, `:!flag`, `:$x`
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            ;; a type smiley: `Int:D`, `Str:U`
            (if
              (i32.and
                (i32.and (call $rakuGlued (local.get $lhs) (local.get $gap)) (i32.eqz (local.get $operand)))
                (i32.and
                  (i32.or (i32.eq (local.get $c2) (i32.const "D")) (i32.eq (local.get $c2) (i32.const "U")))
                  (i32.eqz (call $lexIsIdentContinue (local.get $c3)))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (local.set $hl (enum.get $Token.type))
                (br $valueTok)))
            (local.set $hl (enum.get $Token.string.special.symbol))
            (if (call $lexIsNameStart (local.get $c2))
              (then
                (global.set $ptr (call $rakuName (global.get $ptr)))
                (br $valueTok)))
            (if (i32.and (i32.eq (local.get $c2) (i32.const "!")) (call $lexIsNameStart (local.get $c3)))
              (then
                (global.set $ptr (call $rakuName (i32.add (local.get $lhs) (i32.const 2))))
                (br $valueTok)))
            (br_if $tok (i32.or (i32.eq (local.get $c2) (i32.const "$")) (i32.eq (local.get $c2) (i32.const "@"))))
            ;; `:=` binds; `::` qualifies
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (i32.or (i32.eq (local.get $c2) (i32.const "=")) (i32.eq (local.get $c2) (i32.const ":")))))
            (local.set $hl (enum.get $Token.operator))
            (br $opTok)))
        ;; `.method`, `.^meta`, `.?maybe`
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if
              (i32.or
                (byteset.get "!+?" (local.get $c2))
                (i32.or (i32.eq (local.get $c2) (i32.const "^")) (i32.eq (local.get $c2) (i32.const "*"))))
              (then
                (if (call $lexIsNameStart (local.get $c3))
                  (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))))
            (if (call $lexIsNameStart (call $templateByte (global.get $ptr)))
              (then
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $decl (i32.const 6))
                (br $next)))))
        ;; `[+]` reduces with an operator
        (if (i32.and (local.get $operand) (i32.eq (local.get $c) (i32.const "[")))
          (then
            (local.set $p (i32.add (local.get $lhs) (i32.add (i32.const 1) (i32.eq (local.get $c2) (i32.const 92)))))
            (block $metaDone
              (loop $meta
                (local.set $c3 (call $templateByte (local.get $p)))
                (br_if $metaDone (i32.eqz (call $perlIsOp (local.get $c3))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $meta)))
            (if
              (i32.and
                (i32.eq (local.get $c3) (i32.const "]"))
                (i32.gt_u (local.get $p) (i32.add (local.get $lhs) (i32.const 1))))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (local.set $hl (enum.get $Token.operator))
                (br $opTok)))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (if (i32.eq (local.get $decl) (i32.const 4))
                  (then
                    (local.set $sq (i32.const 0x027b7d))
                    (br $literal)))
                (local.set $bits (i32.shl (local.get $bits) (i32.const 1)))))
            (local.set $decl (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (local.set $p (i32.and (local.get $bits) (i32.const 1)))
                (local.set $bits (i32.shr_u (local.get $bits) (i32.const 1)))
                ;; the `}` of a code block returns to its string
                (if (local.get $p)
                  (then
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                    (local.set $sq (i32.const 0x090022))
                    (local.set $sDepth (i32.const 0))
                    (br $next)))))
            (br_if $opTok (byteset.get "([{" (local.get $c)))
            (br $valueTok)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (local.set $decl (i32.const 0))
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (br $opTok)))
        (if (call $perlIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c3 (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (call $perlIsOp (local.get $c3))))
                ;; a regex opener ends the run, but `//` is defined-or
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $c3) (i32.const "/"))
                    (i32.eqz
                      (i32.and
                        (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
                        (i32.eq (local.get $c) (i32.const "/"))))))
                ;; so does a method call: `>>.say`
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $c3) (i32.const "."))
                    (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (local.set $decl (i32.const 0))
            (local.set $hl (enum.get $Token.operator))
            (br $opTok)))
        (local.set $hl (enum.get $Token.none))
        (br $opTok))
        ;; a quoted-body opener colored by its flags; the body is scanned at
        ;; the top of the loop
        (local.set $hl
          (select
            (enum.get $Token.comment)
            (select
              (enum.get $Token.string.regex)
              (enum.get $Token.string)
              (i32.and (local.get $sq) (i32.const 0x20000)))
            (i32.and (local.get $sq) (i32.const 0x40000))))
        (local.set $sDepth (i32.const 0))
        (local.set $decl (i32.const 0))
        (br $tok))
        ;; a value token: a `/` next divides
        (local.set $operand (i32.const 0))
        (br $tok))
        ;; a punctuation or operator token: a term may start next
        (local.set $operand (i32.const 1)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
