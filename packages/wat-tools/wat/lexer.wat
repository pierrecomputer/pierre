(module
  (import "./memory.wat")
  (import "./common.wat")
  (import "./records.wat")

  (func $lexerRun (param $stream i32) (param $reset i32)
    (global.set $srcBase (i32.const $mem.input))
    (global.set $docStart (select (i32.const $mem.input) (i32.const 0) (local.get $reset)))
    (global.set $streaming (local.get $stream))
    (global.set $streamReset (local.get $reset))
    (global.set $streamDepth (i32.const 0))
    (if (local.get $reset)
      (then
        (call $sigReset)
        (call $streamClearCheckpoints)
        (global.set $streamMode (i32.const 0))
        (global.set $streamA (i32.const 0))
        (global.set $streamB (i32.const 0))
        (global.set $streamC (i32.const 0))
        ;; These have no effect while $streamMode is 0, but `saveState`
        ;; copies them. Equal states must have equal bytes.
        (global.set $streamHl (i32.const 0))
        (global.set $streamRegionKind (i32.const 0))
        (global.set $streamRegionStarted (i32.const 0))
        (memory.fill (i32.const $mem.streamDelimiter) (i32.const 0) (i32.const 32))))
    (global.set $eof (i32.add (i32.const $mem.input) (i32.load (i32.const 2))))
    (global.set $end (global.get $eof))
    (global.set $ptr (i32.const $mem.input))
    (global.set $out (i32.and (i32.add (global.get $eof) (i32.const 47)) (i32.const -16)))
    (i32.store (i32.const 6) (global.get $out))
    (global.set $cap (i32.sub (i32.mul (memory.size) (i32.const 65536)) (i32.const 16)))
    (call $recStreamBegin (local.get $reset))
    (if (i32.eqz (call $streamResumeCommon))
      (then (call $highlight)))
    ;; Bytes after the last token are plain text. An editor reads the records
    ;; of each line, so they must cover it.
    (call $emitTok
      (enum.get $Token.none)
      (i32.add
        (global.get $srcBase)
        (if (result i32) (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
          (then (i32.load (i32.sub (global.get $out) (i32.const 8))))
          (else (i32.const 0))))
      (global.get $eof))
    (call $recStreamEnd)
    (i32.store (i32.const 10) (i32.sub (global.get $out) (i32.load (i32.const 6)))))

  (func (export "lex")
    (call $lexerRun (i32.const 0) (i32.const 1)))

  (func (export "lexStream") (param $reset i32)
    (call $lexerRun (i32.const 1) (local.get $reset)))
)
