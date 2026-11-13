(module
  ;; input base: $mem.input for whole-buffer runs, the live scratch base otherwise.
  ;; token-record offsets and start-of-input checks are relative to it.
  (global $srcBase (mut i32) (i32.const $mem.input))
  ;; Start of the document for this lexer run, or 0 for a continuation.
  ;; This is the first chunk of an input, stream, live document, or fence
  ;; body. Only this position accepts document-start syntax such as `#!`
  ;; or front matter. Defaults to $srcBase for single-lexer test harnesses.
  (global $docStart (mut i32) (i32.const $mem.input))
  (global $eof (mut i32) (i32.const 0)) ;; input end (the NUL sentinel sits there)
  (global $end (mut i32) (i32.const 0)) ;; scan end: $eof, or a sub-range end for embedded scans
  (global $ptr (mut i32) (i32.const 0)) ;; read cursor
  (global $liveLimit (mut i32) (i32.const 0x7fffffff))
  (global $liveSuspended (mut i32) (i32.const 0))
  (global $liveEntering (mut i32) (i32.const 0))

  ;; clamp $e to $stop, then extend it over UTF-8 continuation bytes: an
  ;; escape span must never split a code point
  (func $utf8SpanEnd (param $e i32) (param $stop i32) (result i32)
    (if (i32.gt_u (local.get $e) (local.get $stop))
      (then (local.set $e (local.get $stop))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $e) (local.get $stop)))
        (br_if $done
          (i32.ne (i32.and (i32.load8_u (local.get $e)) (i32.const 0xc0)) (i32.const 0x80)))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (local.get $e))

)
