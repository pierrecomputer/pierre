(module
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
    (local.set $savePtr (global.get $ptr))
    (local.set $saveEnd (global.get $end))
    (local.set $angular (i32.and (global.get $jsTemplateState) (i32.const 0x80000000)))
    (global.set $ptr (local.get $from))
    (global.set $end (local.get $to))
    (global.set $jsTemplateState
      (i32.or
        (local.get $angular)
        (call $hlTemplateMarkup
          (i32.and (global.get $jsTemplateState) (i32.const 0x7fffffff))
          (i32.ne (local.get $angular) (i32.const 0)))))
    (global.set $ptr (local.get $savePtr))
    (global.set $end (local.get $saveEnd)))
)
