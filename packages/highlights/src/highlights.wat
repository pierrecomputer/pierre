(module
  (import "./languages.wat")
  (import "./emit.wat")
  (import "./memory.wat")
  (import "./live.wat")
  (import "./token.wat")

  (func (export "highlight")
    (global.set $srcBase (i32.const 65536))
    (global.set $docStart (i32.const 65536))
    (global.set $streaming (i32.const 0))
    (global.set $streamDepth (i32.const 0))
    ;; a pooled instance may hold parameter-machine state from a prior stream
    (call $sigReset)
    (call $hlBegin)
    (call $highlightLang (i32.load8_u (i32.const 0)))
    (call $hlEnd))

  ;; Zero every cross-chunk stream global, the stream delimiter, and the
  ;; lexer checkpoint windows, matching a fresh Wasm instance. Called for a
  ;; stream reset and before the live tokenizer's first line. The windows
  ;; matter for a pooled instance: a lexer first entered on a later chunk (a
  ;; markdown fence body) restores its window, which must not hold the
  ;; previous stream's locals.
  (func $streamResetGlobals
    (global.set $ecmaImport (i32.const 0))
    (memory.fill (i32.const $mem.streamDelimiter) (i32.const 0) (i32.const 32))
    (memory.fill (i32.const $mem.streamState) (i32.const 0) (i32.const $mem.streamStateUsed))
    (global.set $streamMode (i32.const 0))
    (global.set $streamA (i32.const 0))
    (global.set $streamB (i32.const 0))
    (global.set $streamC (i32.const 0))
    (global.set $streamHl (i32.const 0))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamRegionStarted (i32.const 0))
    (global.set $markdownStreamFence (i32.const 0))
    (global.set $markdownStreamFenceLen (i32.const 0))
    (global.set $markdownStreamLang (i32.const 0))
    (memory.fill (i32.const $mem.markdownFenceStack) (i32.const 0) (i32.const 96))
    (global.set $phpStreamingCode (i32.const 0))
    (global.set $phpStreamDecl (i32.const 0))
    (global.set $phpStreamMember (i32.const 0)))

  ;; Lex one chunk of $lang in streaming mode: resume any open multiline
  ;; construct or embedded region, then continue with the language lexer.
  ;; Shared by highlightStream and the live tokenizer's per-line runs.
  (func $streamChunk (param $lang i32) (param $reset i32)
    (if (call $ecmaStreamLang (local.get $lang) (local.get $reset))
      (then (return)))
    ;; non-ecma lexers share the parameter-machine globals; the ecma stream
    ;; entries reset them in $hlEcmaImpl
    (if (local.get $reset)
      (then (call $sigReset)))
    ;; An open markdown fence owns the chunk start: its body resumes inside
    ;; the fence bounds ($markdownCodeRange runs the shared and per-language
    ;; resumes there), so the top-level resumes must not consume a mode the
    ;; body left open.
    (if
      (i32.and
        (i32.or
          (i32.eq (local.get $lang) (enum.get $Language.markdown))
          (i32.eq (local.get $lang) (enum.get $Language.mdx)))
        (i32.ne (call $markdownFenceReg) (i32.const 0)))
      (then
        (if (call $markdownStreamResume)
          (then (return)))
        (call $highlightLang (local.get $lang))
        (return)))
    ;; Embedded regions bound their own open comments and strings before any
    ;; shared mode resumes, so a closer cannot be consumed by the body lexer.
    (if (global.get $streamRegionKind)
      (then
        (if (call $streamResumeLang (local.get $lang))
          (then (return)))))
    (if (call $streamResumeCommon)
      (then (return)))
    (if (call $streamResumeLang (local.get $lang))
      (then (return)))
    (call $highlightLang (local.get $lang)))

  ;; Stream one input chunk through any language while preserving lexer and
  ;; emitter state between calls.
  (func (export "highlightStream") (param $reset i32)
    (global.set $srcBase (i32.const 65536))
    (global.set $streaming (i32.const 1))
    (global.set $streamReset (local.get $reset))
    (global.set $docStart (select (i32.const 65536) (i32.const 0) (local.get $reset)))
    (global.set $streamDepth (i32.const 0))
    ;; A pooled instance must reset the same state as a new Wasm instance.
    (if (local.get $reset)
      (then (call $streamResetGlobals)))
    (call $hlBegin)
    (call $recStreamBegin (local.get $reset))
    (call $streamChunk (i32.load8_u (i32.const 0)) (local.get $reset))
    (call $recStreamEnd)
    (call $hlEnd)
    (global.set $streaming (i32.const 0))
    (global.set $streamDepth (i32.const 0)))
)
