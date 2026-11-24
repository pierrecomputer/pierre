(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  ;; Glimmer template-tag modules (.gjs/.gts) https://github.com/embroider-build/content-tag
  (import "@pierre/wat-tools/common.wat")
  (import "./jinja.wat")
  (import "./tsx.wat")

  ;; Resume a script or style body that a template left open at the previous
  ;; chunk end. Its end resets the ECMAScript machine (see
  ;; $streamClearEmbedded), but the module around the template still needs
  ;; that state, so its scalars are restored. The stacks stay in memory.
  ;; Returns 1 when the body runs to $end.
  (func $glimmerResumeRegion (result i32)
    (local $r i32)
    (local $braceDepth i32)
    (local $brkSp i32)
    (local $rxCloser i32)
    (local $ternaryTop i32)
    (local $prevLto i32)
    (local $nlBefore i32)
    (local $lexSp i32)
    (local $emitSp i32)
    (local $state i32)
    (local.set $braceDepth (global.get $braceDepth))
    (local.set $brkSp (global.get $brkSp))
    (local.set $rxCloser (global.get $rxCloser))
    (local.set $ternaryTop (global.get $ternaryTop))
    (local.set $prevLto (global.get $prevLto))
    (local.set $nlBefore (global.get $nlBefore))
    (local.set $lexSp (global.get $jsTemplateLexSp))
    (local.set $emitSp (global.get $jsTemplateEmitSp))
    (local.set $state (global.get $jsTemplateState))
    (local.set $r (call $streamResumeAnyRegion))
    (global.set $braceDepth (local.get $braceDepth))
    (global.set $brkSp (local.get $brkSp))
    (global.set $rxCloser (local.get $rxCloser))
    (global.set $ternaryTop (local.get $ternaryTop))
    (global.set $prevLto (local.get $prevLto))
    (global.set $nlBefore (local.get $nlBefore))
    (global.set $jsTemplateLexSp (local.get $lexSp))
    (global.set $jsTemplateEmitSp (local.get $emitSp))
    (global.set $jsTemplateState (local.get $state))
    (local.get $r))

  ;; $features: 8 JavaScript, 9 TypeScript. The ECMAScript machine stops
  ;; before a `<template>` in operand or class-member position (see
  ;; $hlEcmaImpl), and its state waits in globals while the Handlebars lexer
  ;; runs the body to the first `</template>`. $tpl is 1 inside a body. A
  ;; streamed body runs Handlebars as its own stream root, so its tag state
  ;; lives in the Jinja checkpoint. Region 96 marks a body open at a chunk
  ;; end: $streamResumeLang then calls this lexer before any shared comment
  ;; mode resumes, so the mode stops at `</template>` as in whole input.
  (func $hlGlimmerImpl (param $features i32)
    (local $tpl i32)
    (local $reset i32)
    (local $p i32)
    (local $saveEnd i32)
    (call $lexEmitLeadingContinuation)
    (local.set $reset (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset)))
    (local.set $saveEnd (global.get $end))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 96))
      (then (global.set $streamRegionKind (i32.const 0))))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (global.get $ptr) (local.get $saveEnd)))
        (if (i32.eqz (local.get $tpl))
          (then
            (global.set $ecmaFeatures (local.get $features))
            (global.set $tsxStreamExpressionClose (i32.const 0))
            (global.set $tsxStreamExpressionClosed (i32.const 0))
            (global.set $tsxStreaming (global.get $streaming))
            (global.set $streamDepth (i32.const 0))
            (call $hlEcmaImpl (local.get $reset))
            (local.set $reset (i32.const 0))
            (br_if $done (i32.eqz (global.get $tsxStreamExpressionClosed)))
            (global.set $tsxStreamExpressionClosed (i32.const 0))
            (local.set $p (global.get $ptr))
            (global.set $ptr (i32.add (local.get $p) (i32.const 10)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.html)
              (local.get $p)
              (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.tag)
              (i32.add (local.get $p) (i32.const 1))
              (i32.add (local.get $p) (i32.const 9)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.html)
              (i32.add (local.get $p) (i32.const 9))
              (global.get $ptr))
            (local.set $tpl (i32.const 1))
            (br $next)))
        ;; the body ends at the first `</template>`; wide loads stay inside
        ;; the input slack
        (local.set $p (global.get $ptr))
        (block $found
          (loop $find
            (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
            (br_if $found (i32.ge_u (local.get $p) (local.get $saveEnd)))
            (br_if $found
              (i32.and
                (i32.le_u (i32.add (local.get $p) (i32.const 11)) (local.get $saveEnd))
                (i32.and
                  (i64.eq (i64.load (local.get $p)) (i64.const "</templa"))
                  (i32.eq (i32.load offset=7 (local.get $p)) (i32.const "ate>")))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $find)))
        (global.set $end (local.get $p))
        ;; a body or comment that the previous chunk left open; where whole
        ;; input stops it at `</template>`, the stream drops it there too
        (if (global.get $streamRegionKind)
          (then
            (if
              (i32.and
                (call $glimmerResumeRegion)
                (i32.lt_u (local.get $p) (local.get $saveEnd)))
              (then
                (global.set $streamRegionKind (i32.const 0))
                (global.set $streamMode (i32.const 0))))))
        (if (global.get $streamMode)
          (then
            (if
              (i32.and
                (call $streamResumeCommon)
                (i32.lt_u (local.get $p) (local.get $saveEnd)))
              (then (global.set $streamMode (i32.const 0))))))
        (global.set $streamDepth (i32.const 0))
        (call $hlJinjaImpl (i32.const 3))
        (global.set $end (local.get $saveEnd))
        (if (i32.lt_u (local.get $p) (local.get $saveEnd))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 11)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.html)
              (local.get $p)
              (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok
              (enum.get $Token.tag)
              (i32.add (local.get $p) (i32.const 2))
              (i32.add (local.get $p) (i32.const 10)))
            (call $emitTok
              (enum.get $Token.punctuation.bracket.html)
              (i32.add (local.get $p) (i32.const 10))
              (global.get $ptr))
            ;; the template is a complete expression or class member
            (global.set $lto (enum.get $Lex.identifier))
            (global.set $prevTok (enum.get $Lex.identifier))
            ;; the next body starts with a fresh Handlebars state
            (if (global.get $streaming)
              (then (call $streamClearCheckpoints)))
            (local.set $tpl (i32.const 0))))
        (br $next)))
    (if (i32.and (local.get $tpl) (i32.eqz (global.get $streamRegionKind)))
      (then (call $streamSetRegion (i32.const 96)))))

  (func $hlGlimmerJs
    (call $hlGlimmerImpl (i32.const 8)))
  (func $hlGlimmerTs
    (call $hlGlimmerImpl (i32.const 9)))
)
