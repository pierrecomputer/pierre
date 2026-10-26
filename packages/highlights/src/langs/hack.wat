(module
  (import "./php.wat")

  ;; Hack is PHP code without a `<?php` opener or `?>` closer, so the whole
  ;; range is code; a legacy `<?hh` header is lexed inside it.
  (func $hlHack
    (global.set $phpHack (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (call $phpCode (i32.const 0))
    (global.set $phpStreamingCode (i32.const 1))
    (global.set $phpHack (i32.const 0)))

  ;; Resume PHP's stream state for the next chunk of Hack code.
  (func $hackStreamResume (result i32)
    (local $done i32)
    (global.set $phpHack (i32.const 1))
    (local.set $done (call $phpStreamResume))
    (global.set $phpHack (i32.const 0))
    (local.get $done))
)
