(module
  (import "../common.wat")

  (func $rubyByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $rubyWordHl below. The `attr_*`
  ;; family and the `__FILE__` family are prefix checks there: their members
  ;; share hash features the table cannot separate.
  (keyword-table $rubyWords $mem.rubyWords $mem.rubyWords+768 16 128
    (group ;; 1: control
      "if" "do" "in" "END" "end" "for" "next" "redo" "then" "when" "BEGIN"
      "begin" "break" "elsif" "raise" "retry" "until" "while" "yield"
      "ensure" "rescue" "return" "unless")
    (group "def")            ;; 2: declaration, next name is a method
    (group "class" "module") ;; 3: declaration, next name is a constant
    (group "alias")          ;; 4: declaration
    (group "or" "and" "not") ;; 5: word operators
    (group "true" "false")   ;; 6: booleans
    (group "nil")            ;; 7: built-in constant
    (group "self" "super")   ;; 8: special variables
    (group ;; 9: methods that read as keywords
      "pp" "loop" "proc" "puts" "catch" "print" "throw" "using" "extend"
      "freeze" "lambda" "public" "include" "prepend" "private" "require"
      "protected" "alias_method" "define_method" "module_function"
      "require_relative"))

  ;; The token for a bare word, or -1 for an ordinary identifier. Bit 8 marks
  ;; `def`, bit 9 `class`/`module`, whose next name is a definition.
  (func $rubyWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $n i32)
    (local.set $g (keyword-table.get $rubyWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
        ;; the wide loads stay inside the input slack
        (if (i32.and
              (i32.ge_u (local.get $n) (i32.const 6))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0x000000ffffffffff))
                (i64.const "attr_")))
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
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.variable.special))))
    (enum.get $Token.function))

  ;; The closing delimiter for a literal opened with $open: the matching
  ;; bracket, or the byte itself.
  (func $rubyCloser (param $open i32) (result i32)
    (if (i32.eq (local.get $open) (i32.const "(")) (then (return (i32.const ")"))))
    (if (i32.eq (local.get $open) (i32.const "[")) (then (return (i32.const "]"))))
    (if (i32.eq (local.get $open) (i32.const "{")) (then (return (i32.const "}"))))
    (if (i32.eq (local.get $open) (i32.const "<")) (then (return (i32.const ">"))))
    (local.get $open))

  ;; Scan a literal body from $ptr with the bytes since $seg still
  ;; unemitted: up to the $close byte at nesting depth zero, where $open is
  ;; the byte that nests - zero when none - and $depth the nesting already
  ;; open. $flags bit 0 enables escapes and `#{}` interpolation, bit 1
  ;; colors the body as a regex, bit 2 as a symbol, and bit 3 keeps the body
  ;; on one line. $nested is nonzero inside an interpolation, where a nested
  ;; literal keeps `#{` plain. Returns the status in the low two bits - 1
  ;; past the closer, 2 past a `#{` that opens an interpolation, emitted as
  ;; punctuation.special, 0 at $end or at the line break of a one-line
  ;; body - and the nesting depth still open in the bits above.
  (func $rubyLiteralBody
    (param $close i32) (param $open i32) (param $depth i32) (param $flags i32)
    (param $nested i32) (param $seg i32) (result i32)
    (local $c i32) (local $e i32) (local $hl i32) (local $status i32)
    (local $stop i32) (local $hash i32)
    (local.set $hl (select (enum.get $Token.string.regex)
      (select (enum.get $Token.string.special.symbol) (enum.get $Token.string)
        (i32.and (local.get $flags) (i32.const 4)))
      (i32.and (local.get $flags) (i32.const 2))))
    (local.set $stop (global.get $ptr))
    (local.set $hash (global.get $ptr))
    (block $done
      (loop $scan
        ;; the next closer, backslash, or - for a one-line body - line break
        ;; and the next opener or `#` before it are each found with one SIMD
        ;; hop and rescanned only once $ptr passes them
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (local.get $close)
              (i32.and (local.get $flags) (i32.const 1)) (i32.shr_u (local.get $flags) (i32.const 3))))
            (local.set $hash (call $lexFindEither (global.get $ptr)
              (select (i32.const "#") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
              (select (local.get $open) (local.get $close) (local.get $open)))))
          (else
            (if (i32.gt_u (global.get $ptr) (local.get $hash))
              (then (local.set $hash (call $lexFindEither (global.get $ptr)
                (select (i32.const "#") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
                (select (local.get $open) (local.get $close) (local.get $open))))))))
        (global.set $ptr (select (local.get $hash) (local.get $stop)
          (i32.lt_u (local.get $hash) (local.get $stop))))
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
            ;; a regex carries its flag letters
            (if (i32.and (local.get $flags) (i32.const 2))
              (then (call $lexScanIdent)))
            (local.set $status (i32.const 1))
            (br $done)))
        (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $c) (local.get $open)))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; `#{` opens an interpolation; `#@x` and `#$x` interpolate too but
        ;; stay plain here
        (if (i32.and
              (i32.eq (call $rubyByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{"))
              (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.or (i32.const 2) (i32.shl (local.get $depth) (i32.const 2))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.or (local.get $status) (i32.shl (local.get $depth) (i32.const 2))))

  (func $rubyRangeEq (param $a i32) (param $b i32) (param $n i32) (result i32)
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
  ;; next chunk keeps looking for it. Shared by heredocs and `=begin`.
  (func $rubyLineDelimited (param $delim i32) (param $n i32) (param $strip i32) (param $hl i32)
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
                (call $rubyRangeEq (local.get $line) (local.get $delim) (local.get $n))
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

  ;; the `%` literal kind letter at $p: 1 for the interpolating kinds - `Q`,
  ;; `W`, `I`, `r`, `x` - 2 for `q`, `w`, `i`, `s`, and 0 for no letter
  (func $rubyPercentKind (param $c i32) (result i32)
    (if (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "Q")) (i32.eq (local.get $c) (i32.const "W")))
          (i32.or
            (i32.eq (local.get $c) (i32.const "I"))
            (i32.or (i32.eq (local.get $c) (i32.const "r")) (i32.eq (local.get $c) (i32.const "x")))))
      (then (return (i32.const 1))))
    (if (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "q")) (i32.eq (local.get $c) (i32.const "w")))
          (i32.or (i32.eq (local.get $c) (i32.const "i")) (i32.eq (local.get $c) (i32.const "s"))))
      (then (return (i32.const 2))))
    (i32.const 0))

  (func $rubyIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))))))))

  ;; An open literal body is described by $sClose, $sOpen, $sDepth, and
  ;; $sFlags - see $rubyLiteralBody - with $sActive 1 while it is being
  ;; scanned and $seg the start of its bytes not yet emitted; the $i*
  ;; copies hold the literal suspended by a `#{` interpolation whose braces
  ;; $interp counts. $operand is 1 where a value may start - so `/`, `%`,
  ;; and `<<` open literals - and 2 right after a plain name, which also
  ;; takes a heredoc argument. $decl is 1 after `def` and 2 after `class`
  ;; or `module`; $member is 1 after `.`, `&.`, or `::`. $lineHead is 1
  ;; until the first token of a line, where `=begin` and `__END__` count.
  ;; A heredoc opener leaves $hdLen, $hdDelim, and $hdStrip pending until
  ;; the line break. $data is 1 after `__END__`. All are checkpointed.
  (func $hlRuby
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $g i32) (local $status i32)
    (local $operand i32) (local $decl i32) (local $member i32) (local $lineHead i32)
    (local $atHead i32) (local $seg i32) (local $interp i32)
    (local $sActive i32) (local $sClose i32) (local $sOpen i32) (local $sDepth i32) (local $sFlags i32)
    (local $iClose i32) (local $iOpen i32) (local $iDepth i32) (local $iFlags i32)
    (local $hdLen i32) (local $hdDelim i32) (local $hdStrip i32) (local $data i32)
    (local.set $lineHead (i32.const 1))
    (local.set $operand (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        ;; everything after `__END__` is data
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
                      (i32.eq (call $rubyByte (global.get $ptr)) (i32.const 10)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitGap (local.get $gap) (global.get $ptr))
                (call $rubyLineDelimited
                  (local.get $hdDelim) (local.get $hdLen) (local.get $hdStrip) (enum.get $Token.string))
                (local.set $hdLen (i32.const 0))
                (local.set $lineHead (i32.const 1))
                (local.set $operand (i32.const 1))
                (br $next)))))

        ;; an open literal body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $sActive)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $rubyLiteralBody
              (local.get $sClose) (local.get $sOpen) (local.get $sDepth) (local.get $sFlags)
              (local.get $interp) (local.get $seg)))
            (local.set $sDepth (i32.shr_u (local.get $status) (i32.const 2)))
            (local.set $status (i32.and (local.get $status) (i32.const 3)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                ;; `#{` opened an interpolation: code until the matching `}`
                (local.set $iClose (local.get $sClose))
                (local.set $iOpen (local.get $sOpen))
                (local.set $iDepth (local.get $sDepth))
                (local.set $iFlags (local.get $sFlags))
                (local.set $interp (i32.const 1))
                (local.set $sActive (i32.const 0))
                (local.set $seg (i32.const 0))
                (local.set $operand (i32.const 1)))
              (else
                ;; closed, or a one-line body cut by a line break; other
                ;; bodies stay open for the next chunk
                (if (i32.or
                      (i32.eq (local.get $status) (i32.const 1))
                      (i32.and (local.get $sFlags) (i32.const 8)))
                  (then
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
            (local.set $operand (i32.const 1))
            (local.set $decl (i32.const 0))
            ;; a line break without a body - the opener was the final line
            ;; of a bounded range - drops the pending heredoc
            (local.set $hdLen (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $rubyByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $rubyByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        ;; `=begin` ... `=end` and `__END__` at a line start
        (if (i32.and (local.get $atHead) (i32.eq (local.get $c) (i32.const "=")))
          (then
            (if (i32.and
                  (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "=be"))
                  (i32.eq (i32.and (i32.load (i32.add (local.get $lhs) (i32.const 2))) (i32.const 0xffffff)) (i32.const "egi")))
              (then
                (call $scanToLineEnd)
                (if (i32.lt_u (global.get $ptr) (global.get $end))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                ;; the closer lives in the delimiter region, which only the
                ;; checkpoint helper reads
                (i32.store (i32.const $mem.streamDelimiter) (i32.const "=end"))
                (call $rubyLineDelimited
                  (i32.const $mem.streamDelimiter) (i32.const 4) (i32.const 0) (enum.get $Token.comment))
                (local.set $lineHead (i32.const 1))
                (br $next)))))
        (if (i32.and
              (i32.and (local.get $atHead) (i32.eq (local.get $c) (i32.const "_")))
              (i32.and
                (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff)) (i64.const "__END__"))
                (i32.eqz (call $lexIsIdentContinue (call $rubyByte (i32.add (local.get $lhs) (i32.const 7)))))))
          (then
            (local.set $data (i32.const 1))
            (br $next)))

        ;; heredoc openers: `<<~ID`, `<<-ID`, `<<ID` with an uppercase name or
        ;; a quoted one, taken as an argument or in operand position
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "<")))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
            (local.set $hdStrip (i32.or
              (i32.eq (local.get $c3) (i32.const "~")) (i32.eq (local.get $c3) (i32.const "-"))))
            (if (local.get $hdStrip) (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (local.set $kind (call $rubyByte (local.get $p)))
            (if (i32.and
                  (i32.or
                    (i32.or (i32.eq (local.get $kind) (i32.const 34)) (i32.eq (local.get $kind) (i32.const 39)))
                    (i32.or
                      (i32.le_u (i32.sub (local.get $kind) (i32.const "A")) (i32.const 25))
                      (i32.and (local.get $hdStrip) (call $lexIsIdentStart (local.get $kind)))))
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

        ;; quoted literals; the body is scanned at the top of the loop
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
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `/regex/` and `%w[...]` literals in operand position
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (local.get $operand))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
            (local.set $sActive (i32.const 1))
            (local.set $sClose (i32.const "/"))
            (local.set $sOpen (i32.const 0))
            (local.set $sDepth (i32.const 0))
            (local.set $sFlags (i32.const 11))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "%")) (local.get $operand))
          (then
            (local.set $kind (call $rubyPercentKind (local.get $c2)))
            (local.set $p (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1) (local.get $kind))))
            (local.set $sOpen (call $rubyByte (local.get $p)))
            (if (i32.and
                  (i32.gt_u (local.get $sOpen) (i32.const 32))
                  (i32.and
                    (i32.lt_u (local.get $sOpen) (i32.const 128))
                    (i32.eqz (call $lexIsIdentContinue (local.get $sOpen)))))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (local.set $sClose (call $rubyCloser (local.get $sOpen)))
                ;; only the bracket kinds nest
                (if (i32.eq (local.get $sClose) (local.get $sOpen))
                  (then (local.set $sOpen (i32.const 0))))
                (local.set $sDepth (i32.const 0))
                (local.set $sFlags (i32.ne (local.get $kind) (i32.const 2)))
                (if (i32.eq (local.get $c2) (i32.const "r"))
                  (then (local.set $sFlags (i32.const 3))))
                (if (i32.or (i32.eq (local.get $c2) (i32.const "s")) (i32.eq (local.get $c2) (i32.const "i")))
                  (then (local.set $sFlags (i32.or (local.get $sFlags) (i32.const 4)))))
                (if (i32.eq (local.get $c2) (i32.const "I"))
                  (then (local.set $sFlags (i32.const 5))))
                (call $emitTok
                  (select (enum.get $Token.string.regex)
                    (select (enum.get $Token.string.special.symbol) (enum.get $Token.string)
                      (i32.and (local.get $sFlags) (i32.const 4)))
                    (i32.and (local.get $sFlags) (i32.const 2)))
                  (local.get $lhs) (global.get $ptr))
                (local.set $sActive (i32.const 1))
                (local.set $seg (global.get $ptr))
                (local.set $member (i32.const 0))
                (br $next)))))

        ;; `:symbol`, `:"symbol"`, and `:+`; `::` is a scope delimiter
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.ne (local.get $c2) (i32.const ":")))
          (then
            (if (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $sActive (i32.const 1))
                (local.set $sClose (local.get $c2))
                (local.set $sOpen (i32.const 0))
                (local.set $sDepth (i32.const 0))
                (local.set $sFlags (i32.or (i32.const 12) (i32.ne (local.get $c2) (i32.const 39))))
                (local.set $seg (global.get $ptr))
                (local.set $member (i32.const 0))
                (br $next)))
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanIdent)
                (if (i32.or
                      (i32.eq (call $rubyByte (global.get $ptr)) (i32.const "?"))
                      (i32.or
                        (i32.eq (call $rubyByte (global.get $ptr)) (i32.const "!"))
                        (i32.eq (call $rubyByte (global.get $ptr)) (i32.const "="))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $operand (i32.const 0))
                (local.set $member (i32.const 0))
                (br $next)))
            (if (i32.and (call $rubyIsOp (local.get $c2)) (local.get $operand))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (block $opDone
                  (loop $op
                    (br_if $opDone (i32.eqz (call $rubyIsOp (call $rubyByte (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $operand (i32.const 0))
                (local.set $member (i32.const 0))
                (br $next)))))

        ;; `@ivar`, `@@cvar`, `$global`
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "@")) (i32.or
                (call $lexIsIdentStart (local.get $c2))
                (i32.and (i32.eq (local.get $c2) (i32.const "@")) (call $lexIsIdentStart (local.get $c3)))))
              (i32.and (i32.eq (local.get $c) (i32.const "$")) (i32.gt_u (local.get $c2) (i32.const 32))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const "@"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (if (call $lexIsIdentContinue (call $rubyByte (global.get $ptr)))
              (then (call $lexScanIdent))
              (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $lexScanIdent)
            ;; a method name may end in `?` or `!`, but not before `=`
            (if (i32.and
                  (i32.or
                    (i32.eq (call $rubyByte (global.get $ptr)) (i32.const "?"))
                    (i32.eq (call $rubyByte (global.get $ptr)) (i32.const "!")))
                  (i32.ne (call $rubyByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "=")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; `key:` is a symbol key, unless it is `key::Scope`
            (if (i32.and
                  (i32.eq (call $rubyByte (local.get $rhs)) (i32.const ":"))
                  (i32.and
                    (i32.ne (call $rubyByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":"))
                    (i32.eqz (local.get $member))))
              (then
                (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $operand (i32.const 1))
                (local.set $decl (i32.const 0))
                (br $next)))
            (local.set $kind (select (i32.const -1)
              (call $rubyWordHl (local.get $lhs) (local.get $rhs))
              (i32.and (local.get $member) (i32.eqz (local.get $decl)))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $decl (i32.shr_u (local.get $kind) (i32.const 8)))
                ;; `def self.name` keeps the head open through `self`
                (if (i32.and
                      (i32.eq (local.get $hl) (enum.get $Token.variable.special))
                      (i32.eq (call $rubyByte (local.get $rhs)) (i32.const ".")))
                  (then (local.set $decl (i32.const 1))))
                ;; keywords and word operators expect a value next; values
                ;; and method-like words do not
                (local.set $operand (i32.or
                  (i32.eq (local.get $hl) (enum.get $Token.keyword.control))
                  (i32.or
                    (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                    (i32.eq (local.get $hl) (enum.get $Token.keyword.operator)))))
                ;; `puts`-style methods take a heredoc or literal argument
                (if (i32.eq (local.get $hl) (enum.get $Token.function))
                  (then (local.set $operand (i32.const 2)))))
              (else
                (if (local.get $decl)
                  (then
                    (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                      (i32.eq (local.get $decl) (i32.const 1))))
                    ;; `class Foo::Bar` keeps the head open through the scope
                    (if (i32.eqz (i32.and
                          (i32.eq (call $rubyByte (local.get $rhs)) (i32.const ":"))
                          (i32.eq (call $rubyByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":"))))
                      (then (local.set $decl (i32.const 0))))
                    (local.set $operand (i32.const 0)))
                  (else
                    (if (local.get $member)
                      (then
                        (local.set $hl (enum.get $Token.function.method))
                        ;; `Foo::Bar` is a constant
                        (if (i32.and
                              (i32.eq (local.get $member) (i32.const 2))
                              (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                          (then (local.set $hl (select (enum.get $Token.constant) (enum.get $Token.type)
                            (call $lexIsConstCase (local.get $lhs) (local.get $rhs))))))
                        (local.set $operand (i32.const 0)))
                      (else
                        (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                          (then
                            (local.set $hl (enum.get $Token.constant))
                            (local.set $operand (i32.const 0)))
                          (else
                            (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                              (then
                                (local.set $hl (enum.get $Token.type))
                                (local.set $operand (i32.const 0)))
                              (else
                                ;; a name before `(` or before an argument on
                                ;; the same line - a literal, a symbol, an
                                ;; instance variable, or a non-keyword name -
                                ;; is a method call; anything else is a
                                ;; variable and may take a heredoc
                                (local.set $hl (enum.get $Token.variable))
                                (local.set $operand (i32.const 2))
                                (local.set $c2 (call $rubyByte (local.get $p)))
                                (if (i32.or
                                      (i32.eq (call $rubyByte (local.get $rhs)) (i32.const "("))
                                      (i32.and
                                        (i32.gt_u (local.get $p) (local.get $rhs))
                                        (i32.or
                                          (i32.or
                                            (i32.eq (local.get $c2) (i32.const 34))
                                            (i32.eq (local.get $c2) (i32.const 39)))
                                          (i32.or
                                            (i32.or
                                              (i32.eq (local.get $c2) (i32.const "@"))
                                              (i32.and
                                                (i32.eq (local.get $c2) (i32.const ":"))
                                                (call $lexIsIdentStart (call $rubyByte (i32.add (local.get $p) (i32.const 1))))))
                                            (i32.and
                                              (call $lexIsIdentStart (local.get $c2))
                                              (i32.eq (call $rubyArgWord (local.get $p)) (i32.const 1)))))))
                                  (then
                                    (local.set $hl (enum.get $Token.function))
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

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the brace matching `#{` returns to the literal body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $sClose (local.get $iClose))
                        (local.set $sOpen (local.get $iOpen))
                        (local.set $sDepth (local.get $iDepth))
                        (local.set $sFlags (local.get $iFlags))
                        (local.set $sActive (i32.const 1))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (local.set $decl (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; a closer ends a value; an opener starts one
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
        ;; `.`, `&.`, and `::` name a member; `..` and `...` are ranges
        (if (i32.or
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.ne (local.get $c2) (i32.const ".")))
                (i32.and (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c2) (i32.const "."))))
              (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 1) (i32.const 2)
              (i32.eq (local.get $c) (i32.const ".")))))
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
        (if (i32.or (call $rubyIsOp (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (i32.or
                  (call $rubyIsOp (call $rubyByte (global.get $ptr)))
                  (i32.eq (call $rubyByte (global.get $ptr)) (i32.const ".")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $operand (i32.const 1))
            (local.set $member (i32.const 0))
            ;; `def ==(other)` names an operator method
            (if (i32.eq (local.get $decl) (i32.const 1)) (then (local.set $decl (i32.const 0))))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $operand (i32.const 1))
        (local.set $member (i32.const 0))
        (br $next))))

  ;; Whether the word at $p can be a bare argument: 1 for a name that is not
  ;; a keyword, 0 for a keyword such as the `if` of a trailing modifier.
  (func $rubyArgWord (param $p i32) (result i32)
    (local $e i32)
    (local.set $e (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $e) (global.get $end)))
        (br_if $done (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $e)))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (i32.eqz (keyword-table.get $rubyWords (local.get $p) (local.get $e))))
)
