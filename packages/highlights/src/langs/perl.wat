(module
  (import "../common.wat")

  (func $perlByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $perlWordHl below. The quote-like
  ;; operators - `q`, `qq`, `qw`, `qr`, `m`, `s`, `tr`, `y` - are matched
  ;; in $perlQuoteKind, the `__FILE__` family by a prefix check, and the
  ;; one-letter repetition operator `x` and `undef` directly: `reverse`
  ;; shares its hash features with `require` and stays out, and `undef` and
  ;; `splice` share slot bits with `not` and `return` in every geometry that
  ;; fits the range.
  (keyword-table $perlWords $mem.perlWords $mem.perlWords+1024
    (group ;; 1: control
      "do" "if" "for" "else" "last" "next" "redo" "goto" "until" "elsif"
      "while" "unless" "return" "foreach")
    (group "sub")                  ;; 2: declaration, next name is a function
    (group "package")              ;; 3: declaration, next name is a namespace
    (group "my" "our" "local" "state") ;; 4: declaration
    (group "no" "use" "require")   ;; 5: import
    (group ;; 6: word operators
      "eq" "ge" "gt" "le" "lt" "ne" "or" "and" "cmp" "not" "xor")
    (group ;; 7: built-in functions
      "lc" "uc" "die" "map" "pop" "ref" "chop" "each" "eval" "exit" "grep"
      "join" "keys" "open" "push" "sort" "warn" "bless" "chomp" "close"
      "defined" "delete" "exists" "index" "print" "shift" "split"
      "length" "printf" "scalar" "substr" "values" "unshift" "sprintf"
      "wantarray")
    (group "BEGIN" "END") ;; 8: special blocks
    (group "say")) ;; 9: say, its own group so the table hash stays sparse

  ;; The token for a bare word, or -1 for an ordinary identifier. Bit 8 marks
  ;; `sub` and bit 9 `package`, whose next name is a definition.
  (func $perlWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $n i32)
    (local.set $g (keyword-table.get $perlWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
        (if (i32.and (i32.eq (local.get $n) (i32.const 1)) (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "x")))
          (then (return (enum.get $Token.keyword.operator))))
        ;; the wide load stays inside the input slack
        (if (i32.and
              (i32.eq (local.get $n) (i32.const 5))
              (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "undef")))
          (then (return (enum.get $Token.function))))
        (if (i32.and
              (i32.ge_u (local.get $n) (i32.const 5))
              (i32.and
                (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "__"))
                (i32.eq (i32.load16_u (i32.sub (local.get $rhs) (i32.const 2))) (i32.const "__"))))
          (then (return (enum.get $Token.variable.special))))
        (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (i32.eq (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.keyword))))
    (enum.get $Token.function))

  ;; The quote-like operator spelled by the word [lhs,rhs): 1 for `q`/`qw`,
  ;; 2 for `qq`, 3 for `m`/`qr`, 4 for `s`/`tr`/`y` - two bodies - or 0.
  (func $perlQuoteKind (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i32.and (i32.load (local.get $lhs)) (i32.const 0xffff)))
    (if (i32.eq (local.get $n) (i32.const 1))
      (then
        (local.set $w (i32.and (local.get $w) (i32.const 255)))
        (if (i32.eq (local.get $w) (i32.const "q")) (then (return (i32.const 1))))
        (if (i32.eq (local.get $w) (i32.const "m")) (then (return (i32.const 3))))
        (if (i32.or (i32.eq (local.get $w) (i32.const "s")) (i32.eq (local.get $w) (i32.const "y")))
          (then (return (i32.const 4))))
        (return (i32.const 0))))
    (if (i32.eq (local.get $n) (i32.const 2))
      (then
        (if (i32.eq (local.get $w) (i32.const "qw")) (then (return (i32.const 1))))
        (if (i32.eq (local.get $w) (i32.const "qq")) (then (return (i32.const 2))))
        (if (i32.eq (local.get $w) (i32.const "qr")) (then (return (i32.const 3))))
        (if (i32.eq (local.get $w) (i32.const "tr")) (then (return (i32.const 4))))))
    (i32.const 0))

  (func $perlCloser (param $open i32) (result i32)
    (if (i32.eq (local.get $open) (i32.const "(")) (then (return (i32.const ")"))))
    (if (i32.eq (local.get $open) (i32.const "[")) (then (return (i32.const "]"))))
    (if (i32.eq (local.get $open) (i32.const "{")) (then (return (i32.const "}"))))
    (if (i32.eq (local.get $open) (i32.const "<")) (then (return (i32.const ">"))))
    (local.get $open))

  ;; Scan a quoted body from $ptr with the bytes since $seg still unemitted:
  ;; up to the $close byte at nesting depth zero, where $open is the byte
  ;; that nests - zero when none - and $depth the nesting already open.
  ;; $flags bit 0 enables escapes and `$name`/`@name` interpolation, bit 1
  ;; colors the body as a regex. Returns 1 past the closer, 0 at $end, in
  ;; the low bit, and the nesting depth still open in the bits above.
  (func $perlQuoteBody
    (param $close i32) (param $open i32) (param $depth i32) (param $flags i32)
    (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $hl i32) (local $status i32)
    (local $stop i32) (local $mark i32)
    (local.set $hl (select (enum.get $Token.string.regex) (enum.get $Token.string)
      (i32.and (local.get $flags) (i32.const 2))))
    (local.set $stop (global.get $ptr))
    (local.set $mark (global.get $ptr))
    (block $done
      (loop $scan
        ;; the next closer or backslash and the next opener, `$`, or `@`
        ;; before it are each found with one SIMD hop and rescanned only
        ;; once $ptr passes them
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (local.get $close)
              (i32.and (local.get $flags) (i32.const 1)) (i32.const 0)))
            (local.set $mark (call $scanFind3 (global.get $ptr)
              (select (local.get $open) (local.get $close) (local.get $open))
              (select (i32.const "$") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
              (select (i32.const "@") (local.get $close) (i32.and (local.get $flags) (i32.const 1))))))
          (else
            (if (i32.gt_u (global.get $ptr) (local.get $mark))
              (then (local.set $mark (call $scanFind3 (global.get $ptr)
                (select (local.get $open) (local.get $close) (local.get $open))
                (select (i32.const "$") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
                (select (i32.const "@") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))))))))
        (global.set $ptr (select (local.get $mark) (local.get $stop)
          (i32.lt_u (local.get $mark) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (if (local.get $depth)
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $scan)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $c) (local.get $open)))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; `$name`, `${name}`, `@name`: interpolated variables
        (local.set $c2 (call $perlByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.or
              (call $lexIsIdentStart (local.get $c2))
              (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c2) (i32.const "{"))))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "}")))
                (if (i32.lt_u (global.get $ptr) (global.get $end))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
              (else (call $lexScanIdent)))
            (call $emitTok (enum.get $Token.variable) (local.get $e) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.or (local.get $status) (i32.shl (local.get $depth) (i32.const 1))))

  (func $perlRangeEq (param $a i32) (param $b i32) (param $n i32) (result i32)
    (local $i i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (if (i32.ne
              (i32.load8_u (i32.add (local.get $a) (local.get $i)))
              (i32.load8_u (i32.add (local.get $b) (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; Consume lines from $ptr through the one holding the $n-byte delimiter
  ;; at $delim - indented when $strip - as one $hl token. An unterminated
  ;; body runs to $end and, in streaming, checkpoints the delimiter so the
  ;; next chunk keeps looking for it. Shared by heredocs and POD.
  (func $perlLineDelimited (param $delim i32) (param $n i32) (param $strip i32) (param $hl i32)
    (local $body i32)
    (local $lhs i32)
    (local $line i32)
    (local.set $body (global.get $ptr))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $line (global.get $ptr))
        (if (local.get $strip)
          (then (local.set $line (call $lexSkipSpaceAt (local.get $line)))))
        (if (i32.and
              (i32.le_u (i32.add (local.get $line) (local.get $n)) (global.get $end))
              (i32.and
                (call $perlRangeEq (local.get $line) (local.get $delim) (local.get $n))
                (i32.or
                  (i32.eq (i32.add (local.get $line) (local.get $n)) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (i32.add (local.get $line) (local.get $n))) (i32.const 10))
                    (i32.eq (i32.load8_u (i32.add (local.get $line) (local.get $n))) (i32.const 13))))))
          (then
            (call $emitTok (local.get $hl) (local.get $body) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $scanToLineEnd)
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (return)))
        (call $scanToLineEnd)
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br $lines)))
    (call $emitTok (local.get $hl) (local.get $body) (global.get $ptr))
    (call $streamSetLine
      (local.get $delim) (local.get $n) (i32.shl (local.get $strip) (i32.const 1)) (local.get $hl)))

  (func $perlIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-./<=>?^|~" (local.get $c)))

  ;; An open quoted body is described by $sClose, $sOpen, $sDepth, and
  ;; $sFlags - see $perlQuoteBody - with $sActive 1 while it is being
  ;; scanned, $seg the start of its bytes not yet emitted, and $sSecond 1
  ;; when a second body follows, as in `s/a/b/`. $operand is 1 where a
  ;; value may start, so `/` opens a match. $decl is 1 after `sub` and 2
  ;; after `package`; $member is 1 after `->` or `::`. $lineHead is 1 until
  ;; the first token of a line, where POD and `__END__` count. A heredoc
  ;; opener leaves $hdLen, $hdDelim, and $hdStrip pending until the line
  ;; break. $data is 1 after `__END__`. All are checkpointed.
  (func $hlPerl
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $status i32)
    (local $operand i32) (local $decl i32) (local $member i32) (local $lineHead i32)
    (local $atHead i32) (local $seg i32)
    (local $sActive i32) (local $sClose i32) (local $sOpen i32) (local $sDepth i32)
    (local $sFlags i32) (local $sSecond i32)
    (local $hdLen i32) (local $hdDelim i32) (local $hdStrip i32) (local $data i32)
    (local.set $lineHead (i32.const 1))
    (local.set $operand (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        ;; everything after `__END__` or `__DATA__` is data
        (if (local.get $data)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (global.set $ptr (global.get $end))
            (call $emitTok (enum.get $Token.comment) (local.get $gap) (global.get $ptr))
            (br $done)))
        (if (local.get $hdLen)
          (then
            ;; the pending heredoc body starts after this line's break, so
            ;; skip blanks only and consume just the LF or CRLF
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 10))
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 13))))
              (then
                (local.set $c (i32.load8_u (global.get $ptr)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const 13))
                      (i32.eq (call $perlByte (global.get $ptr)) (i32.const 10)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitGap (local.get $gap) (global.get $ptr))
                (call $perlLineDelimited
                  (local.get $hdDelim) (local.get $hdLen) (local.get $hdStrip) (enum.get $Token.string))
                (local.set $hdLen (i32.const 0))
                (local.set $lineHead (i32.const 1))
                (local.set $operand (i32.const 1))
                (br $next)))))

        ;; an open quoted body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $sActive)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $perlQuoteBody
              (local.get $sClose) (local.get $sOpen) (local.get $sDepth) (local.get $sFlags)
              (local.get $seg)))
            (local.set $sDepth (i32.shr_u (local.get $status) (i32.const 1)))
            (local.set $seg (global.get $ptr))
            (if (i32.and (local.get $status) (i32.const 1))
              (then
                ;; `s{a}{b}` opens its second body with fresh brackets;
                ;; `s/a/b/` continues to the next closer
                (if (local.get $sSecond)
                  (then
                    (local.set $sSecond (i32.const 0))
                    (if (local.get $sOpen)
                      (then
                        (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
                        (call $emitGap (local.get $seg) (global.get $ptr))
                        (local.set $seg (global.get $ptr))
                        (local.set $sOpen (call $perlByte (global.get $ptr)))
                        (local.set $sClose (call $perlCloser (local.get $sOpen)))
                        (if (i32.or
                              (i32.eq (local.get $sOpen) (local.get $sClose))
                              (i32.ge_u (global.get $ptr) (global.get $end)))
                          (then
                            (local.set $sActive (i32.const 0))
                            (local.set $seg (i32.const 0)))
                          (else
                            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                            (call $emitTok (enum.get $Token.string.regex) (local.get $seg) (global.get $ptr))
                            (local.set $seg (global.get $ptr)))))))
                  (else
                    ;; a match or substitution carries its flag letters
                    (if (i32.and (local.get $sFlags) (i32.const 2))
                      (then
                        (call $lexScanIdent)
                        (call $emitTok (enum.get $Token.string.regex) (local.get $seg) (global.get $ptr))))
                    (local.set $sActive (i32.const 0))
                    (local.set $seg (i32.const 0))
                    (local.set $operand (i32.const 0))))))
            (br $next)))

        (call $scanWhitespace)
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            ;; a line break without a body - the opener was the final line
            ;; of a bounded range - drops the pending heredoc
            (local.set $hdLen (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $perlByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $perlByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        ;; POD: a `=word` line opens documentation that runs to `=cut`
        (if (i32.and
              (i32.and (local.get $atHead) (i32.eq (local.get $c) (i32.const "=")))
              (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25)))
          (then
            (i32.store (i32.const $mem.streamDelimiter) (i32.const "=cut"))
            (call $perlLineDelimited
              (i32.const $mem.streamDelimiter) (i32.const 4) (i32.const 0) (enum.get $Token.comment.doc))
            (local.set $lineHead (i32.const 1))
            (local.set $operand (i32.const 1))
            (br $next)))
        (if (i32.and
              (i32.and (local.get $atHead) (i32.eq (local.get $c) (i32.const "_")))
              (i32.and
                (i32.or
                  (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff)) (i64.const "__END__"))
                  (i64.eq (i64.load (local.get $lhs)) (i64.const "__DATA__")))
                (i32.eqz (call $lexIsIdentContinue
                  (call $perlByte (i32.add (local.get $lhs)
                    (select (i32.const 8) (i32.const 7) (i32.eq (local.get $c3) (i32.const "D")))))))))
          (then
            (local.set $data (i32.const 1))
            (br $next)))

        ;; heredoc openers: `<<EOF`, `<<"EOF"`, `<<'EOF'`, `<<~EOF`
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
            (local.set $hdStrip (i32.eq (local.get $c3) (i32.const "~")))
            (if (local.get $hdStrip) (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (local.set $kind (call $perlByte (local.get $p)))
            (if (i32.and
                  (i32.or
                    (i32.or (i32.eq (local.get $kind) (i32.const 34)) (i32.eq (local.get $kind) (i32.const 39)))
                    (i32.le_u (i32.sub (local.get $kind) (i32.const "A")) (i32.const 25)))
                  (i32.or (local.get $operand) (local.get $hdStrip)))
              (then
                (if (i32.or (i32.eq (local.get $kind) (i32.const 34)) (i32.eq (local.get $kind) (i32.const 39)))
                  (then
                    (local.set $hdDelim (i32.add (local.get $p) (i32.const 1)))
                    (global.set $ptr (call $lexFindByte (local.get $hdDelim) (local.get $kind)))
                    (local.set $hdLen (i32.sub (global.get $ptr) (local.get $hdDelim)))
                    (if (i32.lt_u (global.get $ptr) (global.get $end))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
                  (else
                    (local.set $hdDelim (local.get $p))
                    (global.set $ptr (local.get $p))
                    (call $lexScanIdent)
                    (local.set $hdLen (i32.sub (global.get $ptr) (local.get $hdDelim)))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $operand (i32.const 0))
                (local.set $member (i32.const 0))
                (br $next)))))

        ;; quoted strings and backticks; the body is scanned at the top of
        ;; the loop
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (i32.eq (local.get $c) (i32.const "`")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $sActive (i32.const 1))
            (local.set $sClose (local.get $c))
            (local.set $sOpen (i32.const 0))
            (local.set $sDepth (i32.const 0))
            (local.set $sFlags (i32.ne (local.get $c) (i32.const 39)))
            (local.set $sSecond (i32.const 0))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `/regex/` in operand position
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (local.get $operand))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
            (local.set $sActive (i32.const 1))
            (local.set $sClose (i32.const "/"))
            (local.set $sOpen (i32.const 0))
            (local.set $sDepth (i32.const 0))
            (local.set $sFlags (i32.const 3))
            (local.set $sSecond (i32.const 0))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; sigils: `$x`, `@x`, `%x`, `$#x`, `${x}`, `$_`, `$1`, `$$`, `&sub`
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "@")))
              (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "&"))))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c2) (i32.const "#")))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (local.set $kind (call $perlByte (local.get $p)))
            (if (i32.or
                  (call $lexIsIdentStart (local.get $kind))
                  (i32.and
                    (i32.eq (local.get $c) (i32.const "$"))
                    (i32.or
                      (i32.or (call $lexIsDigit (local.get $kind)) (i32.eq (local.get $kind) (i32.const "{")))
                      (i32.and
                        (i32.eqz (call $lexIsSpace (local.get $kind)))
                        (i32.and (i32.ne (local.get $kind) (i32.const 0)) (i32.ne (local.get $c2) (i32.const "#")))))))
              (then
                (global.set $ptr (local.get $p))
                (if (call $lexIsIdentContinue (local.get $kind))
                  (then
                    ;; `$Foo::bar` keeps its package path
                    (block $pathDone
                      (loop $path
                        (call $lexScanIdent)
                        (br_if $pathDone (i32.eqz (i32.and
                          (i32.eq (call $perlByte (global.get $ptr)) (i32.const ":"))
                          (i32.and
                            (i32.eq (call $perlByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ":"))
                            (call $lexIsIdentStart (call $perlByte (i32.add (global.get $ptr) (i32.const 2))))))))
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                        (br $path))))
                  (else
                    (if (i32.eq (local.get $kind) (i32.const "{"))
                      (then
                        (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const "}")))
                        (if (i32.lt_u (global.get $ptr) (global.get $end))
                          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
                      (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                (call $emitTok
                  (select (enum.get $Token.function)
                    (select (enum.get $Token.variable.special) (enum.get $Token.variable)
                      (i32.eqz (call $lexIsIdentStart (local.get $kind))))
                    (i32.eq (local.get $c) (i32.const "&")))
                  (local.get $lhs) (global.get $ptr))
                (local.set $operand (i32.const 0))
                (local.set $member (i32.const 0))
                (br $next)))))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; quote-like operators: `q{}`, `qw()`, `m//`, `s///`, `tr///`
            (local.set $kind (select (i32.const 0)
              (call $perlQuoteKind (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (local.get $kind)
              (then
                (local.set $sOpen (call $perlByte (local.get $p)))
                ;; the delimiter is any punctuation except `,`, `;`, `=`,
                ;; and `)`, which follow a name used as a word instead
                (if (i32.and
                      (i32.and (i32.gt_u (local.get $sOpen) (i32.const 32)) (i32.lt_u (local.get $sOpen) (i32.const 128)))
                      (i32.eqz (i32.or
                        (call $lexIsIdentContinue (local.get $sOpen))
                        (i32.or
                          (i32.or (i32.eq (local.get $sOpen) (i32.const ",")) (i32.eq (local.get $sOpen) (i32.const ";")))
                          (i32.or
                            (i32.or (i32.eq (local.get $sOpen) (i32.const "=")) (i32.eq (local.get $sOpen) (i32.const ")")))
                            (i32.and (i32.eq (local.get $sOpen) (i32.const "#")) (i32.gt_u (local.get $p) (local.get $rhs))))))))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                    (local.set $sClose (call $perlCloser (local.get $sOpen)))
                    (if (i32.eq (local.get $sClose) (local.get $sOpen))
                      (then (local.set $sOpen (i32.const 0))))
                    (local.set $sDepth (i32.const 0))
                    (local.set $sFlags (select (i32.const 0)
                      (select (i32.const 3) (i32.const 1) (i32.ge_u (local.get $kind) (i32.const 3)))
                      (i32.eq (local.get $kind) (i32.const 1))))
                    (local.set $sSecond (i32.eq (local.get $kind) (i32.const 4)))
                    (call $emitTok
                      (select (enum.get $Token.string.regex) (enum.get $Token.string)
                        (i32.and (local.get $sFlags) (i32.const 2)))
                      (local.get $lhs) (global.get $ptr))
                    (local.set $sActive (i32.const 1))
                    (local.set $seg (global.get $ptr))
                    (local.set $member (i32.const 0))
                    (br $next)))))
            (local.set $kind (select (i32.const -1)
              (call $perlWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $decl (i32.shr_u (local.get $kind) (i32.const 8)))
                (local.set $operand (i32.ne (local.get $hl) (enum.get $Token.variable.special))))
              (else
                (if (local.get $decl)
                  (then
                    (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.namespace)
                      (i32.eq (local.get $decl) (i32.const 1))))
                    ;; a `::` path keeps the head open
                    (if (i32.eqz (i32.and
                          (i32.eq (call $perlByte (local.get $rhs)) (i32.const ":"))
                          (i32.eq (call $perlByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":"))))
                      (then (local.set $decl (i32.const 0))))
                    (local.set $operand (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $member) (i32.const 1))
                      (then
                        (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                          (i32.eq (call $perlByte (local.get $p)) (i32.const "("))))
                        (local.set $operand (i32.const 0)))
                      (else
                        ;; `Foo::Bar` is a package, `Foo::bar(` a function
                        (if (i32.and
                              (i32.eq (call $perlByte (local.get $rhs)) (i32.const ":"))
                              (i32.eq (call $perlByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":")))
                          (then
                            (local.set $hl (enum.get $Token.namespace))
                            (local.set $operand (i32.const 0)))
                          (else
                            (if (i32.eq (call $perlByte (local.get $p)) (i32.const "("))
                              (then
                                (local.set $hl (enum.get $Token.function))
                                (local.set $operand (i32.const 1)))
                              (else
                                (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                  (then
                                    (local.set $hl (enum.get $Token.constant))
                                    (local.set $operand (i32.const 0)))
                                  (else
                                    (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                                      (then
                                        (local.set $hl (select (enum.get $Token.namespace) (enum.get $Token.type)
                                          (i32.eq (local.get $member) (i32.const 2))))
                                        (local.set $operand (i32.const 0)))
                                      (else
                                        ;; a bare lowercase word before `=>` or alone
                                        ;; inside `{}` is a hash key; otherwise it
                                        ;; names a function
                                        (if (i32.or
                                              (i32.and
                                                (i32.eq (call $perlByte (local.get $p)) (i32.const "="))
                                                (i32.eq (call $perlByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">")))
                                              (i32.and
                                                (i32.eq (call $perlByte (local.get $p)) (i32.const "}"))
                                                (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "{"))))
                                          (then (local.set $hl (enum.get $Token.string.special.symbol)))
                                          (else (local.set $hl (enum.get $Token.function))))))
                                        (local.set $operand (i32.const 1))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "[")))
              (i32.eq (local.get $c) (i32.const "{"))))
            (local.set $member (i32.const 0))
            (local.set $decl (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (local.set $decl (i32.const 0))
            (br $next)))
        ;; `->` and `::` name a member
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
              (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const ":"))))
            (local.set $operand (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $perlIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $perlIsOp (call $perlByte (global.get $ptr)))))
                ;; a match opener ends the run, but `//` is defined-or
                (br_if $opDone (i32.and
                  (i32.gt_u (global.get $ptr) (local.get $lhs))
                  (i32.and
                    (i32.eq (call $perlByte (global.get $ptr)) (i32.const "/"))
                    (i32.eqz (i32.and
                      (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
                      (i32.eq (local.get $c) (i32.const "/")))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $operand (i32.const 1))
        (local.set $member (i32.const 0))
        (br $next))))
)
