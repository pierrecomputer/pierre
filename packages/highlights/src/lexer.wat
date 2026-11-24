(module
  (import "./languages.wat")
  (import "./highlights.wat")

  (func $lexBegin
    (global.set $srcBase (i32.const $mem.input))
    (global.set $streamDepth (i32.const 0))
    (global.set $eof (i32.add (i32.const $mem.input) (i32.load (i32.const 2))))
    (global.set $end (global.get $eof))
    (global.set $ptr (i32.const $mem.input))
    (global.set $out (i32.and (i32.add (global.get $eof) (i32.const 47)) (i32.const -16)))
    (i32.store (i32.const 6) (global.get $out))
    (global.set $cap (i32.sub (i32.mul (memory.size) (i32.const 65536)) (i32.const 16))))

  (func (export "lex")
    (global.set $docStart (i32.const $mem.input))
    (global.set $streaming (i32.const 0))
    (call $sigReset)
    (call $lexBegin)
    (call $highlightLang (i32.load8_u (i32.const 0)))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (i32.load (i32.const 6)))))

  (func (export "lexStream") (param $reset i32)
    (global.set $streaming (i32.const 1))
    (global.set $streamReset (local.get $reset))
    (global.set $docStart (select (i32.const $mem.input) (i32.const 0) (local.get $reset)))
    (if (local.get $reset)
      (then (call $streamResetGlobals)))
    (call $lexBegin)
    (call $streamChunk (i32.load8_u (i32.const 0)) (local.get $reset))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (i32.load (i32.const 6))))
    (global.set $streaming (i32.const 0))
    (global.set $streamDepth (i32.const 0)))

  ;; Make room for the records of an embedded body and return the address
  ;; where the host must copy them. The host calls it only when the records
  ;; do not fit before $cap.
  (func (export "reserve") (param $bytes i32) (result i32)
    (call $ensureCap (i32.add (local.get $bytes) (i32.const 16)))
    (global.get $out))

  ;; Lex the body [$from, $to) in a child lexer of the host and append its
  ;; records. The host gets $out and $cap, copies the records to $out when
  ;; they fit (or calls `reserve`), and writes their byte length to control
  ;; word 10. Reset 2 only ends a stream context.
  ;; scripts/build.ts gives this function the name $embedLanguage in
  ;; a lexer module, in place of the one in embed.wat.
  (func $embedHost
    (param $lang i32) (param $from i32) (param $to i32)
    (param $reset i32) (param $context i32) (result i32)
    (i32.store (i32.const 10) (i32.const 0))
    (local.set $context
      (call $hostEmbed
        (local.get $lang) (local.get $from) (local.get $to)
        (local.get $reset) (local.get $context)
        (global.get $out) (global.get $cap)))
    (if (i32.ne (local.get $reset) (i32.const 2))
      (then
        (call $embedAppend (i32.load (i32.const 10)) (local.get $from) (local.get $to))))
    (local.get $context))
)
