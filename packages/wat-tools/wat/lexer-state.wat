(module
  (import "./input.wat")
  (memory-region $mem.streamDelimiter 32)
  (memory-region $mem.streamState 3072 8)
  (global $streaming (mut i32) (i32.const 0))
  (global $streamReset (mut i32) (i32.const 0))
  (global $streamDepth (mut i32) (i32.const 0))
  (global $streamMode (mut i32) (i32.const 0))
  (global $streamA (mut i32) (i32.const 0))
  (global $streamB (mut i32) (i32.const 0))
  (global $streamC (mut i32) (i32.const 0))
  (global $streamHl (mut i32) (i32.const 0))
  (global $streamRegionKind (mut i32) (i32.const 0))
  (global $streamRegionStarted (mut i32) (i32.const 0))
  (global $streamWindow (mut i32) (i32.const 0))
  ;; The saved range [Lo, Hi) of $mem.streamState; every byte outside it is
  ;; zero. Lo is $streamStateUsed and Hi 0 when nothing is saved.
  (global $streamStateLo (mut i32) (i32.const $streamStateUsed))
  (global $streamStateHi (mut i32) (i32.const 0))

  (func $streamClearCheckpoints
    (if (i32.lt_u (global.get $streamStateLo) (global.get $streamStateHi))
      (then
        (memory.fill
          (i32.add (i32.const $mem.streamState) (global.get $streamStateLo))
          (i32.const 0)
          (i32.sub (global.get $streamStateHi) (global.get $streamStateLo)))))
    (global.set $streamStateLo (i32.const $streamStateUsed))
    (global.set $streamStateHi (i32.const 0)))
  (global $liveStackBytes (mut i32) (i32.const 0))

  (func $lexEmitLeadingContinuation
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
    (call $emitGap (local.get $lhs) (global.get $ptr)))
)
