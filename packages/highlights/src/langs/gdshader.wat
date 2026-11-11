(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "./glsl.wat")

  (func $hlGdshader
    (call $hlGlslImpl (i32.const 1)))
)
