(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (import "./php.wat")

  ;; Hack is PHP code without a `<?php` opener or `?>` closer, so the whole
  ;; range is code; a legacy `<?hh` header is lexed inside it.
  (func $hlHack
    (local $xhp i32)
    (global.set $phpHack (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (global.set $phpXhp (local.get $xhp))
    (call $phpCode
      (i32.and (global.get $streaming) (i32.eq (global.get $phpStreamingCode) (i32.const 1))))
    (local.set $xhp (global.get $phpXhp))
    (global.set $phpXhp (i32.const 0))
    (global.set $phpStreamingCode (i32.const 1))
    (global.set $phpHack (i32.const 0)))

  ;; Resume a heredoc, nowdoc, or string the previous chunk of Hack code left open.
  (func $hackStreamResume (result i32)
    (local $done i32)
    (global.set $phpHack (i32.const 1))
    (if (i32.eq (global.get $streamMode) (i32.const 14))
      (then (local.set $done (call $phpHeredocResume))))
    (if (i32.eq (global.get $streamMode) (i32.const 15))
      (then
        (if (call $phpSingleBody (global.get $ptr))
          (then (global.set $streamMode (i32.const 0)))
          (else (local.set $done (i32.const 1))))))
    (global.set $phpHack (i32.const 0))
    (local.get $done))
)
