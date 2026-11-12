(module
  (import "../embed.wat")
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "./angular-html.wat")
  (import "./css.wat")

  ;; Zero is an ordinary template, 1 starts HTML, bit 31 selects Angular,
  ;; and 260 starts CSS with its statement decision pending. Each interpolation
  ;; saves the body state.
  (global $jsTemplateMarker (mut i32) (i32.const 0))
  (global $jsTemplateState (mut i32) (i32.const 0))

  ;; Run the CSS lexer over one template part without touching its host's
  ;; stream checkpoint. Its packed result fits in the interpolation stack.
  (func $emitCssTemplateBody (param $from i32) (param $to i32)
    (local $savePtr i32)
    (local $saveEnd i32)
    (local $saveStreaming i32)
    (local $saveDialect i32)
    (local $context i32)
    (if (global.get $externalEmbedding)
      (then
        (local.set $context (i32.shr_u (global.get $jsTemplateState) (i32.const 9)))
        (global.set $jsTemplateState
          (i32.or
            (i32.const 260)
            (i32.shl
              (call $embedLanguage
                (enum.get $Language.css) (local.get $from) (local.get $to)
                (i32.eqz (local.get $context)) (local.get $context))
              (i32.const 9))))
        (return)))
    (local.set $savePtr (global.get $ptr))
    (local.set $saveEnd (global.get $end))
    (local.set $saveStreaming (global.get $streaming))
    (local.set $saveDialect (global.get $cssDialect))
    (global.set $ptr (local.get $from))
    (global.set $end (local.get $to))
    (global.set $streaming (i32.const 0))
    (global.set $cssDialect (i32.const 0))
    (global.set $jsTemplateState (call $hlCssImpl (global.get $jsTemplateState)))
    (global.set $cssDialect (local.get $saveDialect))
    (global.set $streaming (local.get $saveStreaming))
    (global.set $ptr (local.get $savePtr))
    (global.set $end (local.get $saveEnd)))

  ;; Markup state fits in the interpolation stack; Angular uses the high bit.
  (func $emitHtmlTemplateBody (param $from i32) (param $to i32)
    (local $savePtr i32)
    (local $saveEnd i32)
    (local $angular i32)
    (local $context i32)
    (local.set $angular (i32.and (global.get $jsTemplateState) (i32.const 0x80000000)))
    ;; WARNING: Only Angular templates go to the host. The `html` lexer is not
    ;; the template markup lexer below: it reads no JavaScript escapes, and it
    ;; lexes script and style bodies.
    (if (i32.and (global.get $externalEmbedding) (i32.ne (local.get $angular) (i32.const 0)))
      (then
        (local.set $context
          (i32.shr_u
            (i32.and (global.get $jsTemplateState) (i32.const 0x7fffffff))
            (i32.const 9)))
        (global.set $jsTemplateState
          (i32.or
            (i32.or (local.get $angular) (i32.const 1))
            (i32.shl
              (call $embedLanguage
                (enum.get $Language.angular-html) (local.get $from) (local.get $to)
                (i32.eqz (local.get $context)) (local.get $context))
              (i32.const 9))))
        (return)))
    (local.set $savePtr (global.get $ptr))
    (local.set $saveEnd (global.get $end))
    (global.set $ptr (local.get $from))
    (global.set $end (local.get $to))
    (global.set $jsTemplateState
      (i32.or
        (local.get $angular)
        (call $hlTemplateMarkup
          (i32.and (global.get $jsTemplateState) (i32.const 0x7fffffff))
          (select
            (i32.const 0)
            (i32.ne (local.get $angular) (i32.const 0))
            (global.get $externalEmbedding)))))
    (global.set $ptr (local.get $savePtr))
    (global.set $end (local.get $saveEnd)))
)
