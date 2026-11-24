(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "@pierre/wat-tools/common.wat")
  (import "./jinja.wat")

  (func $hlTwig
    (call $hlJinjaImpl (i32.const 1)))
)
