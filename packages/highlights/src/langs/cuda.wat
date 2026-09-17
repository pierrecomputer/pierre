(module
  (import "./cpp.wat")

  ;; CUDA keeps C++ literals, directives, and streaming state in one lexer.
  (func $hlCuda
    (call $hlCppImpl (i32.const 1)))
)
