(module
  (memory-region $mem.input 0 16)
  (memory (export "memory") (memory-pages))
  (global (export "inputPtr") i32 (i32.const $mem.input))
)
