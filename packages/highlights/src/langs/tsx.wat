(module
  (import "./js-inline-template.wat")
  (import "./js.wat")
  (import "./jsx.wat")
  (import "./ts.wat")
  (import "./tsrx.wat")

  ;; One feature-gated pipeline composes JS, JSX, TS, and TSX.
  ;; emit one classified token, splitting the multi-part kinds
  (func $emitCur (param $t i32) (param $lhs i32) (param $rhs i32) (param $next i32)
    (local $c i32)
    ;; a TSRX `@{` statement container - the scanner's two-byte l_brace -
    ;; splits into its directive `@` and an ordinary `{`; the classifier
    ;; still steps the parameter machine for the brace
    (if
      (i32.and
        (i32.eq (local.get $t) (enum.get $Lex.l_brace))
        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2)))
      (then
        (drop
          (call $classify
            (global.get $prevTok)
            (local.get $t)
            (local.get $next)
            (local.get $lhs)
            (local.get $rhs)))
        (call $tsrxEmitContainerOpen (local.get $lhs) (local.get $rhs))
        (return)))
    ;; every single-span kind classifies through the table; only the
    ;; multi-part kinds (sentinel 253) take the chain below
    (if (i32.ne (enum-map.get $LexHl (local.get $t)) (i32.const 253))
      (then
        (call $emitTok
          (call $classify
            (global.get $prevTok)
            (local.get $t)
            (local.get $next)
            (local.get $lhs)
            (local.get $rhs))
          (local.get $lhs)
          (local.get $rhs))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.string_literal))
      (then
        (call $emitEscaped (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.backtick))
      (then
        (call $emitTemplate
          (local.get $lhs)
          (local.get $rhs)
          (i32.const 0)
          (i32.const 1)
          (i32.const 1))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.dollar_brace))
      (then
        (call $emitTemplate
          (local.get $lhs)
          (local.get $rhs)
          (i32.const 1)
          (i32.const 1)
          (i32.const 0))
        (return)))
    (if
      (i32.or
        (i32.eq (local.get $t) (enum.get $Lex.comment))
        (i32.eq (local.get $t) (enum.get $Lex.hash_bang)))
      (then
        (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $rhs))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.multiline_comment))
      (then
        ;; `/** ... */` but not `/**/` is a doc comment with JSDoc tags. Judge
        ;; the token's own bytes: the stream mode may already describe the
        ;; lookahead token, which is cut at the chunk end
        (if (call $isDocComment (local.get $lhs) (local.get $rhs))
          (then (call $emitDocComment (local.get $lhs) (local.get $rhs)))
          (else (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $rhs))))
        (return)))
    (if (i32.eq (local.get $t) (enum.get $Lex.invalid))
      (then
        ;; unterminated literals keep their color, judged by the first byte
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $emitEscaped (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
            (return)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $c) (i32.const "}")))
          (then
            (call $emitTemplate
              (local.get $lhs)
              (local.get $rhs)
              (i32.const 0)
              (i32.const 1)
              (i32.const 0))
            (return)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (local.get $rhs))
            (return)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $rhs))
        (return)))
    ;; eof never reaches the emitter; nothing else is left
    (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $rhs)))

  (func $tsxFinishStreamToken (param $t i32)
    (global.set $prevLto (global.get $lto))
    (global.set $lto (local.get $t))
    (global.set $prevTok (local.get $t)))

  ;; Continue a token that reached the previous chunk boundary. Returns 1 when
  ;; it still consumes the whole new chunk.
  (func $tsxResume (result i32)
    (local $mode i32)
    (local $from i32)
    (local $t i32)
    (local $quote i32)
    (local $c i32)
    (local.set $mode (global.get $tsxStreamMode))
    (if (i32.eqz (local.get $mode))
      (then (return (i32.const 0))))
    (local.set $from (global.get $ptr))
    ;; template body
    (if (i32.eq (local.get $mode) (i32.const 1))
      (then
        (local.set $t (call $scanTemplateBody))
        ;; the continuation is template text from its first byte: a leading
        ;; `}` here is a character, not a substitution close
        (call $emitTemplate
          (local.get $from)
          (global.get $ptr)
          (i32.eq (local.get $t) (enum.get $Lex.dollar_brace))
          (i32.const 0)
          (i32.eq (local.get $t) (enum.get $Lex.backtick)))
        (if (i32.eq (local.get $t) (enum.get $Lex.invalid))
          (then (return (i32.const 1))))
        (global.set $tsxStreamMode (i32.const 0))
        (call $tsxFinishStreamToken (local.get $t))
        (return (i32.const 0))))
    ;; block or doc comment
    (if (i32.le_u (local.get $mode) (i32.const 3))
      (then
        (call $scanBlockCommentEnd)
        (if (i32.eq (local.get $mode) (i32.const 3))
          (then (call $emitDocCommentRange (local.get $from) (global.get $ptr) (i32.const 0)))
          (else (call $emitTok (enum.get $Token.comment) (local.get $from) (global.get $ptr))))
        (if
          (i32.or
            (i32.lt_u (i32.sub (global.get $ptr) (local.get $from)) (i32.const 2))
            (i32.ne (i32.load16_u (i32.sub (global.get $ptr) (i32.const 2))) (i32.const 0x2f2a)))
          (then (return (i32.const 1))))
        (global.set $tsxStreamMode (i32.const 0))
        (return (i32.const 0))))
    ;; JavaScript string after a backslash line continuation
    (if (i32.le_u (local.get $mode) (i32.const 5))
      (then
        (local.set $quote
          (select (i32.const 34) (i32.const 39) (i32.eq (local.get $mode) (i32.const 4))))
        (local.set $t (call $scanStringBody (local.get $quote)))
        (call $emitEscaped (enum.get $Token.string) (local.get $from) (global.get $ptr))
        (if
          (i32.and
            (i32.eq (local.get $t) (enum.get $Lex.invalid))
            (i32.eq (global.get $ptr) (global.get $end)))
          (then (return (i32.const 1))))
        (global.set $tsxStreamMode (i32.const 0))
        (call $tsxFinishStreamToken (local.get $t))
        (return (i32.const 0))))
    ;; quoted JSX attribute value: hop to the closing quote 16 bytes per step,
    ;; as $jsxTagStep does for the opening chunk
    (local.set $quote
      (select (i32.const 34) (i32.const 39) (i32.eq (local.get $mode) (i32.const 6))))
    (global.set $ptr
      (call $scanFind3 (global.get $ptr) (local.get $quote) (local.get $quote) (local.get $quote)))
    (local.set $c (i32.lt_u (global.get $ptr) (global.get $end)))
    (if (local.get $c)
      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitTok (enum.get $Token.string) (local.get $from) (global.get $ptr))
    (if (i32.eqz (local.get $c))
      (then (return (i32.const 1))))
    (global.set $tsxStreamMode (i32.const 0))
    (i32.const 0))

  ;; the lexer: a one-token-lookahead pipeline over $nextToken, with the
  ;; jsx byte modes layered on top (see the mode stack above)
  (func $hlEcmaImpl (param $reset i32)
    (local $curT i32)
    (local $curLhs i32)
    (local $curRhs i32)
    (local $nxtT i32)
    (local $nxtLhs i32)
    (local $nxtRhs i32)
    (local $haveNext i32)
    (local $done i32)
    (local $m i32)
    (local $cut i32)
    (local $metadataMarker i32)
    (local $markerBefore i32)
    (local $markerLhs i32)
    (local $markerRhs i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $reset)
      (then
        (global.set $sourceStart (global.get $ptr))
        (global.set $lto (enum.get $Lex.eof))
        (global.set $prevLto (enum.get $Lex.eof))
        (global.set $prevTok (enum.get $Lex.eof))
        (global.set $nlBefore (i32.const 0))
        (global.set $braceDepth (i32.const 0))
        (global.set $jsTemplateLexSp (i32.const 0))
        (global.set $jsTemplateEmitSp (i32.const 0))
        (global.set $jsTemplateState (i32.const 0))
        (global.set $jsTemplateMarker (i32.const 0))
        (global.set $brkSp (i32.const 0))
        (global.set $rxCloser (i32.const 0))
        (global.set $jsxSp (i32.const 0))
        (global.set $tsxStreamMode (i32.const 0))
        (global.set $tsxStreamNl (i32.const 0))
        (call $sigReset))
      (else
        ;; A later chunk cannot contain the source-level hashbang.
        (global.set $sourceStart (i32.const 0))))
    (if (call $tsxResume)
      (then
        (global.set $ptr (global.get $end))
        (return)))
    (local.set $done (global.get $ptr))
    (block $out
      (loop $main
        ;; jsx TAG/CONTENT modes scan bytes, not tokens. An `if`, not a
        ;; select: select is eager and would pay the stack loads per token
        ;; even for plain JS/TS.
        (local.set $m (i32.const 0))
        (if (call $ecmaHasJsx)
          (then (local.set $m (call $jsxTopMode))))
        (if (call $jsxByteMode (local.get $m))
          (then
            (br_if $out (i32.ge_u (global.get $ptr) (global.get $end)))
            (if (i32.eq (local.get $m) (i32.const 1))
              (then (call $jsxTagStep))
              (else
                (if (i32.eq (local.get $m) (i32.const 2))
                  (then (call $jsxContentStep))
                  (else
                    (if (i32.eq (local.get $m) (i32.const 6))
                      (then (call $tsrxStyleStep))
                      (else (call $jsxCloseTailStep)))))))
            (local.set $done (global.get $ptr))
            (br $main)))
        ;; pull the current token (the previous iteration's lookahead, if any)
        (if (local.get $haveNext)
          (then
            (local.set $curT (local.get $nxtT))
            (local.set $curLhs (local.get $nxtLhs))
            (local.set $curRhs (local.get $nxtRhs))
            (local.set $haveNext (i32.const 0)))
          (else
            (local.set $curT (call $nextToken))
            (local.set $curLhs (global.get $lhs))
            (local.set $curRhs (global.get $rhs))))
        (call $emitGap (local.get $done) (local.get $curLhs))
        (local.set $done (local.get $curLhs))
        ;; a TSRX `<script>` body ends where the scanner reported `</script`
        ;; as eof before the input end: emit the close tag and pop
        (if
          (i32.and
            (i32.eq (local.get $curT) (enum.get $Lex.eof))
            (i32.and
              (i32.eq (local.get $m) (i32.const 5))
              (i32.lt_u (global.get $ptr) (global.get $end))))
          (then
            (global.set $ptr (i32.add (local.get $curLhs) (i32.const 2)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.jsx)
              (local.get $curLhs)
              (global.get $ptr))
            (drop (call $jsxEmitName))
            (drop (call $jsxCloseTagTail))
            (call $jsxPop)
            (local.set $done (global.get $ptr))
            (br $main)))
        (br_if $out (i32.eq (local.get $curT) (enum.get $Lex.eof)))
        ;; Stop before an embedded framework expression's outer delimiter so
        ;; its parent lexer can emit the punctuation and resume its own scan.
        ;; A `}` inside a jsx element is never that delimiter: the `{` of a
        ;; jsx expression container is pulled by $jsxOpenContainer and skips
        ;; the depth count, so `<li>{i}</li>` in a streamed `{...}` used to
        ;; close the expression at the container's `}`.
        (if
          (i32.and
            (i32.ne (global.get $tsxStreamExpressionClose) (i32.const 0))
            (i32.and
              (i32.eq (local.get $curT) (enum.get $Lex.r_brace))
              (i32.and
                (i32.eqz (global.get $tsxStreamExpressionDepth))
                (i32.eqz (global.get $jsxSp)))))
          (then
            (if
              (i32.or
                (i32.eq (global.get $tsxStreamExpressionClose) (i32.const 1))
                (i32.and
                  (i32.le_u (i32.add (local.get $curLhs) (i32.const 2)) (global.get $end))
                  (i32.eq (i32.load16_u (local.get $curLhs)) (i32.const "}}"))))
              (then
                (global.set $ptr (local.get $curLhs))
                (global.set $tsxStreamExpressionClosed (i32.const 1))
                (br $out)))))
        (if (i32.ne (global.get $tsxStreamExpressionClose) (i32.const 0))
          (then
            (if (i32.eq (local.get $curT) (enum.get $Lex.l_brace))
              (then
                (global.set $tsxStreamExpressionDepth
                  (i32.add (global.get $tsxStreamExpressionDepth) (i32.const 1)))))
            (if
              (i32.and
                (i32.eq (local.get $curT) (enum.get $Lex.r_brace))
                (i32.gt_u (global.get $tsxStreamExpressionDepth) (i32.const 0)))
              (then
                (global.set $tsxStreamExpressionDepth
                  (i32.sub (global.get $tsxStreamExpressionDepth) (i32.const 1)))))))
        ;; a `}` that closes a jsx expression container - or a TSRX directive
        ;; block - resumes the tag/content
        (if
          (i32.and
            (i32.eq (local.get $curT) (enum.get $Lex.r_brace))
            (i32.or (i32.eq (local.get $m) (i32.const 3)) (i32.eq (local.get $m) (i32.const 4))))
          (then
            (if (i32.le_s (global.get $braceDepth) (call $jsxTopTarget))
              (then
                (call $emitTok
                  (enum.get $Token.punctuation.bracket)
                  (local.get $curLhs)
                  (local.get $curRhs))
                (local.set $done (local.get $curRhs))
                (call $jsxPop)
                (br $main)))))
        ;; a `<` in operand position with a tag-like shape opens JSX; without
        ;; the shape it falls through and stays a comparison operator
        (if
          (i32.and
            (call $ecmaHasJsx)
            (i32.and
              (i32.eq (local.get $curT) (enum.get $Lex.l_angle))
              (call $jsxCanStart (global.get $prevTok))))
          (then
            (if (call $jsxValidate (local.get $curRhs))
              (then
                (call $emitTok
                  (enum.get $Token.punctuation.bracket.jsx)
                  (local.get $curLhs)
                  (local.get $curRhs))
                (global.set $jsTemplateMarker (i32.const 0))
                (call $jsxPush (i32.const 1) (call $jsxEmitName))
                (local.set $done (global.get $ptr))
                (br $main)))))
        ;; lookahead, then emit the current token. A nonzero stream mode
        ;; before the lookahead means the current token itself was cut at the
        ;; chunk end; read it now, because the lookahead sets the mode for the
        ;; NEXT token when that one is the cut one
        (local.set $cut (global.get $tsxStreamMode))
        (local.set $nxtT (call $nextToken))
        (local.set $nxtLhs (global.get $lhs))
        (local.set $nxtRhs (global.get $rhs))
        (local.set $haveNext (i32.const 1))
        (local.set $metadataMarker (i32.const 0))
        (if
          (i32.and
            (i32.or
              (i32.eq (global.get $prevTok) (enum.get $Lex.eof))
              (i32.or
                (i32.eq (global.get $prevTok) (enum.get $Lex.l_brace))
                (i32.eq (global.get $prevTok) (enum.get $Lex.comma))))
            (i32.or
              (i32.eq (local.get $curT) (enum.get $Lex.identifier))
              (i32.eq (local.get $curT) (enum.get $Lex.string_literal))))
          (then
            (local.set $markerLhs (local.get $curLhs))
            (local.set $markerRhs (local.get $curRhs))
            (if (i32.eq (local.get $curT) (enum.get $Lex.string_literal))
              (then
                (local.set $markerLhs (i32.add (local.get $markerLhs) (i32.const 1)))
                (local.set $markerRhs (i32.sub (local.get $markerRhs) (i32.const 1)))))
            (if
              (i32.and
                (i32.eq (i32.sub (local.get $markerRhs) (local.get $markerLhs)) (i32.const 8))
                (i64.eq (i64.load (local.get $markerLhs)) (i64.const "template")))
              (then (local.set $metadataMarker (i32.const 0xc0000001))))
            (if
              (i32.and
                (i32.eq (i32.sub (local.get $markerRhs) (local.get $markerLhs)) (i32.const 6))
                (i64.eq
                  (i64.and (i64.load (local.get $markerLhs)) (i64.const 0xffffffffffff))
                  (i64.const "styles")))
              (then (local.set $metadataMarker (i32.const 0x40000104))))))
        (if
          (i32.and
            (i32.ne (local.get $metadataMarker) (i32.const 0))
            (i32.and
              (i32.eq (local.get $curT) (enum.get $Lex.identifier))
              (i32.or
                (i32.eq (local.get $nxtT) (enum.get $Lex.colon))
                (i32.or
                  (i32.eq (local.get $nxtT) (enum.get $Lex.eof))
                  (i32.ne (bitset.get $LexBits.comment (local.get $nxtT)) (i32.const 0))))))
          (then (call $emitTok (enum.get $Token.property) (local.get $curLhs) (local.get $curRhs)))
          (else
            (call $emitCur
              (local.get $curT)
              (local.get $curLhs)
              (local.get $curRhs)
              (local.get $nxtT))))
        (local.set $markerBefore (global.get $jsTemplateMarker))
        (global.set $jsTemplateMarker (i32.const 0))
        ;; Tagged identifiers and exact comment markers select embedded languages.
        ;; The token scanner already excludes whitespace.
        (local.set $markerLhs (local.get $curLhs))
        (local.set $markerRhs (local.get $curRhs))
        (if (i32.eq (local.get $curT) (enum.get $Lex.multiline_comment))
          (then
            (local.set $markerLhs (i32.add (local.get $markerLhs) (i32.const 2)))
            (local.set $markerRhs (i32.sub (local.get $markerRhs) (i32.const 2)))
            (block $trimLeft
              (loop $left
                (br_if $trimLeft (i32.ge_u (local.get $markerLhs) (local.get $markerRhs)))
                (br_if $trimLeft (i32.gt_u (i32.load8_u (local.get $markerLhs)) (i32.const 32)))
                (local.set $markerLhs (i32.add (local.get $markerLhs) (i32.const 1)))
                (br $left)))
            (block $trimRight
              (loop $right
                (br_if $trimRight (i32.ge_u (local.get $markerLhs) (local.get $markerRhs)))
                (br_if $trimRight
                  (i32.gt_u
                    (i32.load8_u (i32.sub (local.get $markerRhs) (i32.const 1)))
                    (i32.const 32)))
                (local.set $markerRhs (i32.sub (local.get $markerRhs) (i32.const 1)))
                (br $right)))))
        (if (i32.eq (i32.sub (local.get $markerRhs) (local.get $markerLhs)) (i32.const 4))
          (then
            (global.set $jsTemplateMarker
              (i32.or
                (i32.and
                  (i32.eq (local.get $curT) (enum.get $Lex.identifier))
                  (i32.eq (i32.load (local.get $markerLhs)) (i32.const "html")))
                (i32.and
                  (i32.and
                    (i32.eqz (local.get $cut))
                    (i32.eq (local.get $curT) (enum.get $Lex.multiline_comment)))
                  (i32.eq
                    (i32.or (i32.load (local.get $markerLhs)) (i32.const 0x20202020))
                    (i32.const "html")))))))
        (if (i32.eq (i32.sub (local.get $markerRhs) (local.get $markerLhs)) (i32.const 3))
          (then
            (if
              (i32.or
                (i32.and
                  (i32.eq (local.get $curT) (enum.get $Lex.identifier))
                  (i32.eq
                    (i32.and (i32.load (local.get $markerLhs)) (i32.const 0xffffff))
                    (i32.const "css")))
                (i32.and
                  (i32.and
                    (i32.eqz (local.get $cut))
                    (i32.eq (local.get $curT) (enum.get $Lex.multiline_comment)))
                  (i32.eq
                    (i32.or
                      (i32.and (i32.load (local.get $markerLhs)) (i32.const 0xffffff))
                      (i32.const 0x202020))
                    (i32.const "css"))))
              (then (global.set $jsTemplateMarker (i32.const 260))))))
        ;; Component metadata keys select the language after their colon.
        ;; Bit 30 marks a key awaiting its colon; comments preserve that decision.
        (if
          (i32.and
            (i32.eq (local.get $curT) (enum.get $Lex.colon))
            (i32.ne (i32.and (local.get $markerBefore) (i32.const 0x40000000)) (i32.const 0)))
          (then
            (global.set $jsTemplateMarker
              (i32.and (local.get $markerBefore) (i32.const 0xbfffffff)))))
        (if
          (i32.and
            (i32.ne (bitset.get $LexBits.comment (local.get $curT)) (i32.const 0))
            (i32.eqz (global.get $jsTemplateMarker)))
          (then (global.set $jsTemplateMarker (local.get $markerBefore))))
        (if (local.get $metadataMarker)
          (then (global.set $jsTemplateMarker (local.get $metadataMarker))))
        (local.set $done (local.get $curRhs))
        ;; comments are transparent to prev; a cut token's kind is recorded by
        ;; the resume instead
        (if
          (i32.and
            (i32.eqz (bitset.get $LexBits.comment (local.get $curT)))
            (i32.eqz (local.get $cut)))
          (then (global.set $prevTok (local.get $curT))))
        (br $main)))
    (if (i32.eqz (global.get $tsxStreamExpressionClosed))
      (then (global.set $ptr (global.get $end)))))

  (func $hlEcma (param $features i32)
    (global.set $ecmaFeatures (local.get $features))
    (global.set $tsxStreamExpressionClose (i32.const 0))
    (global.set $tsxStreaming (i32.const 0))
    (call $hlEcmaImpl (i32.const 1)))

  (func $hlEcmaStream (param $features i32) (param $reset i32)
    (global.set $ecmaFeatures (local.get $features))
    (global.set $tsxStreamExpressionClose (i32.const 0))
    (global.set $tsxStreaming (i32.const 1))
    (call $hlEcmaImpl (local.get $reset)))

  (func $hlTsx
    (call $hlEcma (i32.const 3)))

  (func $hlTsxStream (param $reset i32)
    (call $hlEcmaStream (i32.const 3) (local.get $reset)))

  ;; Highlight an embedded expression body until its outer `}` or `}}`.
  ;; Returns one with $ptr left at the closing delimiter, zero at chunk end.
  (func $hlTsxExpressionStream (param $reset i32) (param $closeLen i32) (result i32)
    (global.set $ecmaFeatures (i32.const 3))
    (global.set $tsxStreaming (i32.const 1))
    (global.set $tsxStreamExpressionClose (local.get $closeLen))
    (global.set $tsxStreamExpressionClosed (i32.const 0))
    (if (local.get $reset)
      (then (global.set $tsxStreamExpressionDepth (i32.const 0))))
    (call $hlEcmaImpl (local.get $reset))
    (global.get $tsxStreamExpressionClosed))
)
