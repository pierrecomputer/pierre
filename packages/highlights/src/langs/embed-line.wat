(module
  (import "../embed.wat")
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./css.wat")
  (import "./tsx.wat")

  ;; Just past the LF that ends the line at $p, or $end. Stream chunks end at
  ;; an LF, so a range up to here is the same in whole and line-fed runs.
  (func $embedLineEnd (param $p i32) (result i32)
    (local.set $p (call $lexFindByte (local.get $p) (i32.const 10)))
    (select (i32.add (local.get $p) (i32.const 1)) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Lex [$ptr, $to), at most one line, as a JavaScript body that a template
  ;; embeds (Marko and templ scripts). Each call ends where the JS lexer stops
  ;; by itself, so line-fed runs match whole ones, as in $qmlJs. $reset starts
  ;; a new body. With $close, the body ends at its outer `}`, left at $ptr.
  ;; Returns 1 while the body goes on: a `}` still due, or without $close an
  ;; open bracket, comment, string, or template.
  ;; An open body lives in the host's checkpointed locals, not a
  ;; stream region: closing a region clears every lexer's saved locals.
  (func $embedJsLine (param $to i32) (param $reset i32) (param $close i32) (result i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ecmaFeatures (i32.const 0))
    (global.set $tsxStreaming (i32.const 1))
    (global.set $tsxStreamExpressionClose (local.get $close))
    (global.set $tsxStreamExpressionClosed (i32.const 0))
    (if (local.get $reset)
      (then (global.set $tsxStreamExpressionDepth (i32.const 0))))
    (call $hlEcmaImpl (local.get $reset))
    (global.set $end (local.get $save))
    (if (result i32) (local.get $close)
      (then (i32.eqz (global.get $tsxStreamExpressionClosed)))
      (else
        (i32.ne
          (i32.or
            (i32.or (global.get $brkSp) (global.get $tsxStreamMode))
            (global.get $jsTemplateLexSp))
          (i32.const 0)))))

  ;; Lex [$ptr, $to), at most one line, as CSS that a template embeds: $state
  ;; is the packed CSS state ($hlCssImpl, block depth from bit 9), 256 starts a
  ;; body that opens with its own `{`. Bits 28+ select the dialect: 0 css,
  ;; 1 less, 2 scss. Returns the state for the next line, as
  ;; $emitCssTemplateBody does.
  (func $embedCssLine (param $to i32) (param $state i32) (result i32)
    (local $c i32)
    (local $dialect i32)
    (local $p i32)
    (local $saveEnd i32)
    (local $saveStreaming i32)
    (local $saveDialect i32)
    (local.set $dialect (i32.shr_u (local.get $state) (i32.const 28)))
    (local.set $state (i32.and (local.get $state) (i32.const 0x0fffffff)))
    (local.set $saveEnd (global.get $end))
    (global.set $end (local.get $to))
    (if (global.get $externalEmbedding)
      (then
        (local.set $p (global.get $ptr))
        (drop
          (call $embedLanguage
            (select
              (enum.get $Language.less)
              (select (enum.get $Language.scss) (enum.get $Language.css) (i32.eq (local.get $dialect) (i32.const 2)))
              (i32.eq (local.get $dialect) (i32.const 1)))
            (local.get $p) (local.get $to)
            (i32.le_u (local.get $state) (i32.const 256)) (i32.const -8)))
        ;; the host keeps the CSS state; count the braces for the depth. Bits
        ;; 6-7 mark what is open at the range end: 1 a comment, 2 a `"` string,
        ;; 3 a `'` string. The child lexer resumes the same.
        (block $done
          (loop $scan
            (block $quoted
              (if (i32.and (local.get $state) (i32.const 192))
                (then
                  (if (i32.eq (i32.and (local.get $state) (i32.const 192)) (i32.const 64))
                    (then
                      (local.set $p (call $lexFindByte (local.get $p) (i32.const "*")))
                      (br_if $done (i32.ge_u (local.get $p) (local.get $to)))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (if (i32.eq (call $templateByte (local.get $p)) (i32.const "/"))
                        (then
                          (local.set $state (i32.xor (local.get $state) (i32.const 64)))
                          (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                      (br $scan)))
                  (local.set $c
                    (select (i32.const 34) (i32.const 39) (i32.eq (i32.and (local.get $state) (i32.const 192)) (i32.const 128))))
                  (local.set $state (i32.and (local.get $state) (i32.const -193)))
                  (br $quoted)))
              (br_if $done (i32.ge_u (local.get $p) (local.get $to)))
              (local.set $c (i32.load8_u (local.get $p)))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (if (i32.eq (local.get $c) (i32.const 92))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br $scan)))
              (br_if $quoted (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39))))
              (if (i32.eq (local.get $c) (i32.const "/"))
                (then
                  (if (i32.eq (call $templateByte (local.get $p)) (i32.const "*"))
                    (then
                      (local.set $state (i32.or (local.get $state) (i32.const 64)))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                  (br_if $done
                    (i32.and
                      (i32.ne (local.get $dialect) (i32.const 0))
                      (i32.eq (call $templateByte (local.get $p)) (i32.const "/"))))
                  (br $scan)))
              (if (i32.eq (local.get $c) (i32.const "{"))
                (then (local.set $state (i32.add (local.get $state) (i32.const 512)))))
              (if (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.ge_u (local.get $state) (i32.const 512)))
                (then (local.set $state (i32.sub (local.get $state) (i32.const 512)))))
              (br $scan))
            (loop $quote
              (local.set $p (call $scanFindSpecial (local.get $p) (local.get $to) (local.get $c) (i32.const 1) (i32.const 1)))
              (if (i32.eq (call $templateByte (local.get $p)) (i32.const 92))
                (then
                  (local.set $p (i32.add (local.get $p) (i32.const 2)))
                  (br $quote))))
            (if (i32.ge_u (local.get $p) (local.get $to))
              (then
                (local.set $state
                  (i32.or (local.get $state) (select (i32.const 128) (i32.const 192) (i32.eq (local.get $c) (i32.const 34)))))
                (br $done)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $scan)))
        (global.set $ptr (local.get $to))
        (global.set $end (local.get $saveEnd))
        (return (i32.or (local.get $state) (i32.shl (local.get $dialect) (i32.const 28))))))
    (local.set $saveStreaming (global.get $streaming))
    (local.set $saveDialect (global.get $cssDialect))
    (global.set $streaming (i32.const 0))
    (global.set $cssDialect (local.get $dialect))
    (local.set $state (call $hlCssImpl (local.get $state)))
    (global.set $cssDialect (local.get $saveDialect))
    (global.set $streaming (local.get $saveStreaming))
    (global.set $end (local.get $saveEnd))
    (i32.or (local.get $state) (i32.shl (local.get $dialect) (i32.const 28))))
)
