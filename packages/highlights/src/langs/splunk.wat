(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "./kusto.wat")

  (func $hlSplunk
    (call $hlKustoImpl (i32.const 1)))
)
