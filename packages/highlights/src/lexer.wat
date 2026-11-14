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

  ;; Append the $bytes of child records at $out for the body [$from, $to).
  ;; Their ends are relative to $from. Type 255 is a leading gap: it extends
  ;; the previous record.
  ;; The records are read in place. A write lands at or before the
  ;; record just read, because appending never adds records.
  ;; A custom lexer can stop early or pass the body end. Clamp each
  ;; end and cover the rest, or the next token takes those bytes.
  (func $embedAppend (param $bytes i32) (param $from i32) (param $to i32)
    (local $record i32)
    (local $stop i32)
    (local $end i32)
    (local $type i32)
    (local.set $record (global.get $out))
    (local.set $stop (i32.add (local.get $record) (local.get $bytes)))
    (local.set $end (local.get $from))
    (block $done
      (loop $records
        (br_if $done (i32.ge_u (local.get $record) (local.get $stop)))
        (local.set $end (i32.add (local.get $from) (i32.load (local.get $record))))
        (local.set $type (i32.load offset=4 (local.get $record)))
        (local.set $record (i32.add (local.get $record) (i32.const 8)))
        (if (i32.gt_u (local.get $end) (local.get $to))
          (then (local.set $end (local.get $to))))
        (if (i32.eq (local.get $type) (i32.const 255))
          (then (call $emitGap (global.get $srcBase) (local.get $end)))
          (else (call $recTok (local.get $type) (local.get $end))))
        (br $records)))
    (if (i32.lt_u (local.get $end) (local.get $to))
      (then (call $recTok (enum.get $Token.none) (local.get $to)))))

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
