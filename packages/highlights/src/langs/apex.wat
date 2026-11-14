(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "./java.wat")

  (func $hlApex
    (global.set $javaApex (i32.const 1))
    (call $hlJavaImpl))
)
