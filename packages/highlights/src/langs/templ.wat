(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "../embed.wat")
  (import "./go.wat")
  (import "./embed-line.wat")
  (import "./template.wat")

  ;; The brace depth $templExprEnd leaves for the next line.
  (global $templBraces (mut i32) (i32.const 0))

  ;; Lex [$ptr, $to), one line at most, as Go. $mode is -1 for a piece that
  ;; does not go on, else what the line before left, 0 at the start: bit 24
  ;; marks an open run of Go lines, the low bits a comment or string still
  ;; open (its stream mode, token in bits 8-15, quote in bits 16-23). Returns
  ;; the state for the next line. Each line runs like a stream chunk ending
  ;; at $to with Go as the stream root, so Go's locals carry on and whole and
  ;; line-fed runs match. A host lexer gets the lines as one Go stream.
  (func $templGo (param $to i32) (param $mode i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local $piece i32)
    (local $saveDepth i32)
    (local $saveEnd i32)
    (local $saveEof i32)
    (local $saveReset i32)
    (local $saveStreaming i32)
    (local.set $piece (i32.lt_s (local.get $mode) (i32.const 0)))
    (if (global.get $externalEmbedding)
      (then
        (drop
          (call $embedLanguage
            (enum.get $Language.go) (global.get $ptr) (local.get $to)
            (select (i32.const -1) (i32.eqz (local.get $mode)) (local.get $piece))
            (i32.const -3)))
        (if (local.get $piece)
          (then
            (global.set $ptr (local.get $to))
            (return (i32.const 0))))
        ;; $mode: a Go block comment (1) or raw string (2) open at $to
        (local.set $saveEnd (global.get $end))
        (global.set $end (local.get $to))
        (local.set $mode (i32.and (local.get $mode) (i32.const 255)))
        (local.set $p (global.get $ptr))
        (block $line
          (loop $scan
            (if (i32.eq (local.get $mode) (i32.const 1))
              (then
                (local.set $p (call $tmplFindWord (local.get $p) (i64.const "*/") (i32.const 2)))
                (br_if $line (i32.ge_u (local.get $p) (local.get $to)))
                (local.set $p (i32.add (local.get $p) (i32.const 2)))
                (local.set $mode (i32.const 0))))
            (if (i32.eq (local.get $mode) (i32.const 2))
              (then
                (local.set $p (call $lexFindByte (local.get $p) (i32.const "`")))
                (br_if $line (i32.ge_u (local.get $p) (local.get $to)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $mode (i32.const 0))))
            (local.set $p (call $tmplFind4 (local.get $p) (i32.const "/") (i32.const "`") (i32.const 34) (i32.const 39)))
            (br_if $line (i32.ge_u (local.get $p) (local.get $to)))
            (local.set $c (i32.load8_u (local.get $p)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                (br_if $line (i32.eq (call $templateByte (local.get $p)) (i32.const "/")))
                (if (i32.eq (call $templateByte (local.get $p)) (i32.const "*"))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (local.set $mode (i32.const 1))))
                (br $scan)))
            (if (i32.eq (local.get $c) (i32.const "`"))
              (then
                (local.set $mode (i32.const 2))
                (br $scan)))
            (loop $quote
              (local.set $p (call $scanFindSpecial (local.get $p) (local.get $to) (local.get $c) (i32.const 1) (i32.const 1)))
              (if (i32.eq (call $templateByte (local.get $p)) (i32.const 92))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 2)))
                  (br $quote))))
            (local.set $p (i32.add (local.get $p) (i32.eq (call $templateByte (local.get $p)) (local.get $c))))
            (br $scan)))
        (global.set $end (local.get $saveEnd))
        (global.set $ptr (local.get $to))
        (return (i32.or (i32.const 0x1000000) (local.get $mode)))))
    (local.set $mode (select (i32.const 0) (local.get $mode) (local.get $piece)))
    (local.set $saveDepth (global.get $streamDepth))
    (local.set $saveEnd (global.get $end))
    (local.set $saveEof (global.get $eof))
    (local.set $saveReset (global.get $streamReset))
    (local.set $saveStreaming (global.get $streaming))
    (global.set $end (local.get $to))
    (global.set $eof (local.get $to))
    (global.set $streaming (i32.const 1))
    ;; a piece runs below the root, so it starts fresh
    (global.set $streamDepth (local.get $piece))
    (global.set $streamReset (i32.eqz (local.get $mode)))
    (global.set $streamMode (i32.and (local.get $mode) (i32.const 255)))
    (global.set $streamHl (i32.and (i32.shr_u (local.get $mode) (i32.const 8)) (i32.const 255)))
    (global.set $streamA (i32.and (i32.shr_u (local.get $mode) (i32.const 16)) (i32.const 255)))
    (global.set $streamB (i32.eq (global.get $streamMode) (i32.const 3)))
    (block $done
      (br_if $done (call $streamResumeCommon))
      (call $hlGo))
    (local.set $mode
      (i32.or
        (i32.const 0x1000000)
        (select
          (i32.or
            (global.get $streamMode)
            (i32.or
              (i32.shl (global.get $streamHl) (i32.const 8))
              (i32.shl (global.get $streamA) (i32.const 16))))
          (i32.const 0)
          (global.get $streamMode))))
    (global.set $streamMode (i32.const 0))
    (global.set $streamDepth (local.get $saveDepth))
    (global.set $streamReset (local.get $saveReset))
    (global.set $end (local.get $saveEnd))
    (global.set $eof (local.get $saveEof))
    (global.set $streaming (local.get $saveStreaming))
    (local.get $mode))

  ;; The `}` that closes a Go expression from $p before $to, or $to, skipping
  ;; strings and runes. $depth counts the braces still open from earlier lines;
  ;; $templBraces gets the count at $to.
  (func $templExprEnd (param $p i32) (param $to i32) (param $depth i32) (result i32)
    (local $c i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (block $done
      (loop $scan
        (local.set $p (call $tmplFind4 (local.get $p) (i32.const "{") (i32.const "}") (i32.const 34) (i32.const "`")))
        (br_if $done (i32.ge_u (local.get $p) (local.get $to)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if
          (i32.and
            (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 39))
            (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 39)))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 2)))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            (br_if $done (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1))))
          (else
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
              (else
                (loop $quote
                  (local.set $p
                    (call $scanFindSpecial
                      (i32.add (local.get $p) (i32.const 1)) (local.get $to) (local.get $c)
                      (i32.ne (local.get $c) (i32.const "`")) (i32.const 1)))
                  (if (i32.eq (call $templateByte (local.get $p)) (i32.const 92))
                    (then
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $quote))))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (global.set $end (local.get $save))
    (global.set $templBraces (local.get $depth))
    (select (local.get $p) (local.get $to) (i32.lt_u (local.get $p) (local.get $to))))

  ;; The `{` that ends the line from $start, or 0.
  (func $templTrailingBrace (param $start i32) (result i32)
    (local $p i32)
    (local.set $p (call $lexFindByte (local.get $start) (i32.const 10)))
    (block $done
      (loop $back
        (br_if $done (i32.le_u (local.get $p) (local.get $start)))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br_if $back (call $lexIsSpace (i32.load8_u (local.get $p))))))
    (select
      (local.get $p)
      (i32.const 0)
      (i32.and (i32.lt_u (local.get $p) (global.get $end)) (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))))

  ;; 1 when [$lhs, $rhs) is a statement keyword of a component body.
  (func $templIsStatement (param $lhs i32) (param $rhs i32) (result i32)
    (local $w i64)
    (local $n i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 5))
      (then (return (i32.const 0))))
    (local.set $w
      (i64.and
        (i64.load (local.get $lhs))
        (i64.sub (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3)))) (i64.const 1))))
    (i32.or
      (i32.or
        (i32.or (i64.eq (local.get $w) (i64.const "if")) (i64.eq (local.get $w) (i64.const "for")))
        (i32.or (i64.eq (local.get $w) (i64.const "else")) (i64.eq (local.get $w) (i64.const "case"))))
      (i32.or (i64.eq (local.get $w) (i64.const "switch")) (i64.eq (local.get $w) (i64.const "default")))))

  ;; Emit the block brace at $p, when nonzero, and move past it.
  (func $templBracket (param $p i32)
    (if (local.get $p)
      (then
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr)))))

  ;; $sec: 0 Go, 1 a `templ` body, 2 a `css` body, 3 a `script` body. $depth:
  ;; the open blocks of a body. $go: the Go mode the line before left open
  ;; (see $templGo). $expr: 1 + the inner brace depth of an open `{ }` Go
  ;; expression. $css: the packed CSS state of a `css` body. $markup: the
  ;; $tmplMarkup state.
  (func $hlTempl
    (local $sec i32)
    (local $depth i32)
    (local $go i32)
    (local $expr i32)
    (local $css i32)
    (local $markup i32)
    (local $c i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $q i32)
    (local $r i32)
    (local $resumed i32)
    (local $skip i32)
    (call $lexEmitLeadingContinuation)
    (local.set $lineEnd (i32.const 0))
    (local.set $resumed (i32.const 0))
    (if (global.get $streamRegionKind)
      (then (local.set $resumed (call $streamResumeAnyRegion))))
    (block $done
      (br_if $done (local.get $resumed))
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        ;; the line end, found once per line
        (if (i32.ge_u (local.get $lhs) (local.get $lineEnd))
          (then (local.set $lineEnd (call $embedLineEnd (local.get $lhs)))))
        ;; an open `{ }` Go expression
        (if (local.get $expr)
          (then
            (local.set $p
              (call $templExprEnd (local.get $lhs) (local.get $lineEnd) (i32.sub (local.get $expr) (i32.const 1))))
            (drop (call $templGo (local.get $p) (i32.const -1)))
            (local.set $expr (i32.add (global.get $templBraces) (i32.const 1)))
            (if (i32.lt_u (local.get $p) (local.get $lineEnd))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
                (local.set $expr (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $sec) (i32.const 3))
          (then
            (if (i32.eqz (call $embedJsLine (local.get $lineEnd) (i32.const 0) (i32.const 1)))
              (then
                (local.set $sec (i32.const 0))
                (call $templBracket (global.get $ptr))))
            (br $next)))
        (if (i32.eq (local.get $sec) (i32.const 2))
          (then
            (local.set $p (call $scanFind3 (local.get $lhs) (i32.const "{") (i32.const "}") (i32.const 10)))
            (local.set $c (call $templateByte (local.get $p)))
            (local.set $css
              (call $embedCssLine
                (i32.add (local.get $p) (i32.eq (local.get $c) (i32.const 10)))
                (local.get $css)))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr))
                (local.set $sec (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
                (local.set $expr (i32.const 1))))
            (br $next)))
        (if (i32.eqz (local.get $sec))
          (then
            ;; a `templ`, `css`, or `script` component starts its line
            (block $go
              (br_if $go (i32.and (local.get $go) (i32.const 255)))
              (br_if $go
                (i32.and
                  (i32.ne (local.get $lhs) (global.get $srcBase))
                  (i32.ne (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 10))))
              (br_if $go (i32.eqz (call $lexIsIdentStart (i32.load8_u (local.get $lhs)))))
              (call $scanIdentRun (i32.const "_"))
              (local.set $q (global.get $ptr))
              (local.set $c (i32.sub (local.get $q) (local.get $lhs)))
              (local.set $r
                (select
                  (i32.const 1)
                  (select
                    (i32.const 2)
                    (select (i32.const 3) (i32.const 0)
                      (i32.and
                        (i32.eq (local.get $c) (i32.const 6))
                        (i64.eq
                          (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff))
                          (i64.const "script"))))
                    (i32.and (i32.eq (local.get $c) (i32.const 3)) (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "css"))))
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 5))
                    (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "templ")))))
              (global.set $ptr (local.get $lhs))
              (br_if $go (i32.eqz (local.get $r)))
              (local.set $p (call $lexSkipSpaceAt (local.get $q)))
              (local.set $c (call $templateByte (local.get $p)))
              (br_if $go
                (i32.or
                  (i32.eq (local.get $p) (local.get $q))
                  (i32.and (i32.eqz (call $lexIsIdentStart (local.get $c))) (i32.ne (local.get $c) (i32.const "(")))))
              (call $emitTok (enum.get $Token.keyword.declaration) (local.get $lhs) (local.get $q))
              (call $emitGap (local.get $q) (local.get $p))
              (global.set $ptr (local.get $p))
              ;; a method's receiver
              (if (i32.eq (local.get $c) (i32.const "("))
                (then
                  (local.set $q (call $scanFindSpecial (local.get $p) (local.get $lineEnd) (i32.const ")") (i32.const 0) (i32.const 1)))
                  (drop (call $templGo (i32.add (local.get $q) (i32.eq (call $templateByte (local.get $q)) (i32.const ")"))) (i32.const -1)))
                  (local.set $p (global.get $ptr))
                  (global.set $ptr (call $lexSkipSpaceAt (local.get $p)))
                  (call $emitGap (local.get $p) (global.get $ptr))))
              (local.set $p (global.get $ptr))
              (call $scanIdentRun (i32.const "_"))
              (call $emitTok (enum.get $Token.function.definition) (local.get $p) (global.get $ptr))
              (local.set $p (call $templTrailingBrace (global.get $ptr)))
              (drop (call $templGo (select (local.get $p) (local.get $lineEnd) (local.get $p)) (i32.const -1)))
              (br_if $next (i32.eqz (local.get $p)))
              (call $templBracket (local.get $p))
              ;; WARNING: the Go lines' saved locals would keep live line states apart
              (call $streamClearCheckpoints)
              (local.set $go (i32.const 0))
              (local.set $sec (local.get $r))
              (local.set $depth (i32.const 1))
              (local.set $markup (i32.const 0))
              (local.set $css (i32.const 0))
              (if (i32.eq (local.get $r) (i32.const 3))
                (then
                  ;; the first line of a `script` body
                  (if (i32.eqz (call $embedJsLine (local.get $lineEnd) (i32.const 1) (i32.const 1)))
                    (then
                      (local.set $sec (i32.const 0))
                      (call $templBracket (global.get $ptr))))))
              (br $next))
            (local.set $go (call $templGo (local.get $lineEnd) (local.get $go)))
            (br $next)))
        ;; a statement, a `}`, or a component call starts a body line
        (if
          (i32.and
            (i32.eqz (i32.and (local.get $markup) (i32.const 7)))
            (i32.or
              (i32.eq (local.get $lhs) (global.get $srcBase))
              (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 10))))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (local.set $c (call $templateByte (local.get $lhs)))
            (if (i32.eq (local.get $c) (i32.const "}"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (if (i32.eqz (local.get $depth))
                  (then
                    (local.set $sec (i32.const 0))
                    (br $next)))
                (local.set $lhs (call $lexSkipSpaceAt (global.get $ptr)))
                (call $emitGap (global.get $ptr) (local.get $lhs))
                (global.set $ptr (local.get $lhs))
                (local.set $c (call $templateByte (local.get $lhs)))))
            (local.set $r (i32.eq (local.get $c) (i32.const "@")))
            (if (call $lexIsIdentStart (local.get $c))
              (then
                (call $scanIdentRun (i32.const "_"))
                (local.set $r (call $templIsStatement (local.get $lhs) (global.get $ptr)))
                (if (local.get $r)
                  (then (call $emitTok (enum.get $Token.keyword.control) (local.get $lhs) (global.get $ptr)))
                  (else (global.set $ptr (local.get $lhs))))))
            (if (local.get $r)
              (then
                (if (i32.eq (local.get $c) (i32.const "@"))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))))
                (local.set $p (call $templTrailingBrace (global.get $ptr)))
                (drop (call $templGo (select (local.get $p) (local.get $lineEnd) (local.get $p)) (i32.const -1)))
                (call $templBracket (local.get $p))
                (local.set $depth (i32.add (local.get $depth) (i32.ne (local.get $p) (i32.const 0))))
                (br $next)))
            (br_if $next (i32.ge_u (global.get $ptr) (global.get $end)))))
        (local.set $r
          (call $tmplMarkupBrace (local.get $markup) (i32.or (i32.const 0x0a01) (i32.shl (local.get $skip) (i32.const 4)))))
        (local.set $markup (i32.and (local.get $r) (i32.const 0xffffff)))
        (local.set $r (i32.shr_u (local.get $r) (i32.const 24)))
        (local.set $skip (i32.const 0))
        (br_if $next (i32.ne (local.get $r) (i32.const 1)))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        ;; a token, not a gap: a CR before it was text, so CRLF matches LF
        (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const 10))
          (then
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; a `{` inside a quoted value is text
        (if (i32.eq (i32.and (local.get $markup) (i32.const 7)) (i32.const 4))
          (then
            (global.set $ptr (local.get $lhs))
            (local.set $skip (i32.const 1))
            (br $next)))
        (if (i32.eq (i32.and (local.get $markup) (i32.const 7)) (i32.const 3))
          (then (local.set $markup (i32.xor (local.get $markup) (i32.const 2)))))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (local.set $expr (i32.const 1))
        (br $next))))
)
