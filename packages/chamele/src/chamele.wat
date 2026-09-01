(module
  (;;
    memory structure
    [] page 1         (control, static data, and scratch)
      [0]             language id (u8)
      [1]             output mode (u8): 0 inline colors, 1 CSS variables,
                      2 byte-end records, 3 UTF-16 line records
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:64)         reserved space
      [64:4800)       emitter, token, and lexer tables
      [4800:5824)     shared JSON/TOML/ECMAScript-template stack
      [5824:6848)     ECMAScript bracket-kind stack
      [6848:7872)     theme table written by JavaScript
      [7872:11968)    JSX-mode stack
      [11968:12000)   streaming delimiter
      [12000:16000)   streaming lexer checkpoints
      [16000:60000)   keyword-table region (see src/memory.wat)
      [60000:64818)   span-open fragment cache (HTML modes)
      [64818:65536)   free
    [] pages 2..N     (text buffer)
      [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) output HTML bytes or (end:u32, hl:u32) token records;
                      $ensureCap grows memory
  ;;)
  (memory (export "memory") 3)

  (import "./token.wat")
  (import "./emit.wat")
  (import "./live.wat")
  (import "./langs/asm.wat")
  (import "./langs/astro.wat")
  (import "./langs/bash.wat")
  (import "./langs/c.wat")
  (import "./langs/cpp.wat")
  (import "./langs/css.wat")
  (import "./langs/diff.wat")
  (import "./langs/glsl.wat")
  (import "./langs/go.wat")
  (import "./langs/haskell.wat")
  (import "./langs/html.wat")
  (import "./langs/json.wat")
  (import "./langs/kotlin.wat")
  (import "./langs/lua.wat")
  (import "./langs/markdown.wat")
  (import "./langs/mdx.wat")
  (import "./langs/php.wat")
  (import "./langs/python.wat")
  (import "./langs/rust.wat")
  (import "./langs/sql.wat")
  (import "./langs/svelte.wat")
  (import "./langs/swift.wat")
  (import "./langs/toml.wat")
  (import "./langs/tsx.wat")
  (import "./langs/vue.wat")
  (import "./langs/wat.wat")
  (import "./langs/xml.wat")
  (import "./langs/yaml.wat")
  (import "./langs/zig.wat")

  ;; Numeric values are the public ABI mirrored by lib/index.mjs.
  (enum $Language
    "plain"
    "asm"
    "astro"
    "bash"
    "c"
    "cpp"
    "css"
    "diff"
    "glsl"
    "go"
    "haskell"
    "html"
    "json"
    "kotlin"
    "lua"
    "markdown"
    "mdx"
    "php"
    "python"
    "rust"
    "sql"
    "svelte"
    "swift"
    "toml"
    "vue"
    "wat"
    "xml"
    "yaml"
    "zig"
    "js"
    "jsx"
    "ts"
    "tsx"
  )

  (func $highlightLang (param $lang i32)
    (block $lexDone
      ;; plain text: one unstyled token covering the whole input
      (if (i32.eq (local.get $lang) (enum.get $Language.plain))
        (then
          (call $emitTok (enum.get $Token.none) (global.get $ptr) (global.get $end))
          (global.set $ptr (global.get $end))
          (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.js))
        (then (call $hlJs) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.jsx))
        (then (call $hlJsx) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.ts))
        (then (call $hlTs) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.tsx))
        (then (call $hlTsx) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.html))
        (then (call $hlHtml) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.css))
        (then (call $hlCss) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.json))
        (then (call $hlJson) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.bash))
        (then (call $hlBash) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.c))
        (then (call $hlC) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.cpp))
        (then (call $hlCpp) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.go))
        (then (call $hlGo) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.python))
        (then (call $hlPython) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.rust))
        (then (call $hlRust) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.yaml))
        (then (call $hlYaml) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.php))
        (then (call $hlPhp) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.sql))
        (then (call $hlSql) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.swift))
        (then (call $hlSwift) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.toml))
        (then (call $hlToml) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.haskell))
        (then (call $hlHaskell) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.kotlin))
        (then (call $hlKotlin) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.astro))
        (then (call $hlAstro) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.vue))
        (then (call $hlVue) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.svelte))
        (then (call $hlSvelte) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.xml))
        (then (call $hlXml) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.markdown))
        (then (call $hlMarkdown) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.mdx))
        (then (call $hlMdx) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.asm))
        (then (call $hlAsm) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.wat))
        (then (call $hlWat) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.diff))
        (then (call $hlDiff) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.glsl))
        (then (call $hlGlsl) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.lua))
        (then (call $hlLua) (br $lexDone)))
      (if (i32.eq (local.get $lang) (enum.get $Language.zig))
        (then (call $hlZig) (br $lexDone)))
      (unreachable)))

  (func (export "highlight")
    (global.set $srcBase (i32.const 65536))
    (global.set $streaming (i32.const 0))
    (global.set $streamDepth (i32.const 0))
    (call $hlBegin)
    (call $highlightLang (i32.load8_u (i32.const 0)))
    (call $hlEnd))

  (func $streamEmbedRange (param $kind i32) (param $from i32) (param $to i32)
    (local $reset i32)
    (local $saveDepth i32)
    (local $saveEnd i32)
    (local $saveReset i32)
    (local.set $reset (i32.eqz (global.get $streamRegionStarted)))
    (local.set $saveDepth (global.get $streamDepth))
    (local.set $saveEnd (global.get $end))
    (local.set $saveReset (global.get $streamReset))
    (global.set $streamDepth (i32.const 0))
    (global.set $streamReset (local.get $reset))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (if (i32.eq (local.get $kind) (i32.const 1))
      (then (call $hlJsStream (local.get $reset)))
      (else
        (if (i32.eq (local.get $kind) (i32.const 2))
          (then (call $hlCss))
          (else
            (if (i32.eq (local.get $kind) (i32.const 4))
              (then (call $hlYaml))
              (else (call $hlTsxStream (local.get $reset))))))))
    (global.set $end (local.get $saveEnd))
    (global.set $ptr (local.get $to))
    (global.set $streamReset (local.get $saveReset))
    (global.set $streamDepth (local.get $saveDepth))
    (global.set $streamRegionStarted (i32.const 1)))

  (func $streamResumeRegion (result i32)
    (local $after i32)
    (local $close i32)
    (local $closeLen i32)
    (local $kind i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $found i32)
    (local.set $kind (global.get $streamRegionKind))
    (local.set $close (global.get $end))
    (local.set $p (global.get $ptr))
    ;; Framework expression bodies: Vue uses `}}`; Astro, MDX, and Svelte use
    ;; `}`. The TSX lexer stops before the outer delimiter.
    (if (i32.ge_u (local.get $kind) (i32.const 6))
      (then
        (local.set $closeLen
          (select (i32.const 2) (i32.const 1)
            (i32.eq (local.get $kind) (i32.const 6))))
        (if (i32.eqz
              (call $hlTsxExpressionStream
                (i32.const 0) (local.get $closeLen)))
          (then (return (i32.const 1))))
        (local.set $close (global.get $ptr))
        (local.set $after (i32.add (local.get $close) (local.get $closeLen)))
        (call $emitTok
          (select
            (enum.get $Token.punctuation.special)
            (enum.get $Token.punctuation.bracket)
            (i32.le_u (local.get $kind) (i32.const 7)))
          (local.get $close) (local.get $after))
        (global.set $ptr (local.get $after))
        (global.set $streamRegionKind (i32.const 0))
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.le_u (local.get $kind) (i32.const 2))
      (then
        (block $rawDone
          (loop $raw
            (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
            (br_if $rawDone (i32.ge_u (local.get $p) (global.get $end)))
            (if (call $isRawTextClose (local.get $p) (local.get $kind))
              (then
                (local.set $close (local.get $p))
                (local.set $found (i32.const 1))
                (br $rawDone)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $raw))))
      (else
        (if (i32.eq (local.get $kind) (i32.const 5))
          (then
            (local.set $p (call $lexFindByte (local.get $p) (i32.const ">")))
            (if (i32.lt_u (local.get $p) (global.get $end))
              (then
                (local.set $close (i32.add (local.get $p) (i32.const 1)))
                (local.set $found (i32.const 1)))))
          (else
            (block $frontDone
              (loop $front
                (br_if $frontDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $lineEnd (call $markdownLineEnd (local.get $p)))
                (if (i32.and
                      (i32.eq (i32.sub (local.get $lineEnd) (local.get $p)) (i32.const 3))
                      (i32.eq
                        (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                        (i32.const "---")))
                  (then
                    (local.set $close (local.get $p))
                    (local.set $found (i32.const 1))
                    (br $frontDone)))
                (local.set $p (call $markdownAfterLine (local.get $lineEnd)))
                (br $front)))))))
    (call $streamEmbedRange
      (local.get $kind) (global.get $ptr) (local.get $close))
    (if (i32.eqz (local.get $found))
      (then (return (i32.const 1))))
    (global.set $ptr (local.get $close))
    (global.set $streamRegionKind (i32.const 0))
    (global.set $streamMode (i32.const 0))
    (if (i32.and
          (i32.gt_u (local.get $kind) (i32.const 2))
          (i32.ne (local.get $kind) (i32.const 5)))
      (then
        (local.set $after
          (call $markdownAfterLine (call $markdownLineEnd (global.get $ptr))))
        (call $emitTok
          (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $after))
        (global.set $ptr (local.get $after))))
    (i32.const 0))

  (func $streamResumeLang (param $lang i32) (result i32)
    (if (global.get $streamRegionKind)
      (then (return (call $streamResumeRegion))))
    (if (i32.eq (local.get $lang) (enum.get $Language.python))
      (then (return (call $pyStreamResume))))
    (if (i32.eq (local.get $lang) (enum.get $Language.php))
      (then (return (call $phpStreamResume))))
    (if (i32.eq (local.get $lang) (enum.get $Language.markdown))
      (then (return (call $markdownStreamResume))))
    (if (i32.and
          (i32.eq (local.get $lang) (enum.get $Language.yaml))
          (i32.eq (global.get $streamMode) (i32.const 11)))
      (then (return (call $yamlStreamResume))))
    (i32.const 0))

  ;; Zero every cross-chunk stream global, matching a fresh Wasm instance.
  ;; Called for a stream reset and before the live tokenizer's first line.
  (func $streamResetGlobals
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
    (global.set $phpStreamingCode (i32.const 0))
    (global.set $phpStreamDecl (i32.const 0))
    (global.set $phpStreamMember (i32.const 0)))

  ;; Lex one chunk of $lang in streaming mode: resume any open multiline
  ;; construct or embedded region, then continue with the language lexer.
  ;; Shared by highlightStream and the live tokenizer's per-line runs.
  (func $streamChunk (param $lang i32) (param $reset i32)
    (if (i32.eq (local.get $lang) (enum.get $Language.js))
      (then (call $hlJsStream (local.get $reset)))
      (else
        (if (i32.eq (local.get $lang) (enum.get $Language.jsx))
          (then (call $hlJsxStream (local.get $reset)))
          (else
            (if (i32.eq (local.get $lang) (enum.get $Language.ts))
              (then (call $hlTsStream (local.get $reset)))
              (else
                (if (i32.eq (local.get $lang) (enum.get $Language.tsx))
                  (then (call $hlTsxStream (local.get $reset)))
                  (else
                    (if (i32.eqz (call $streamResumeCommon))
                      (then
                        (if (i32.eqz (call $streamResumeLang (local.get $lang)))
                          (then (call $highlightLang (local.get $lang)))))))))))))))

  ;; Stream one input chunk through any language while preserving lexer and
  ;; emitter state between calls.
  (func (export "highlightStream") (param $reset i32)
    (global.set $srcBase (i32.const 65536))
    (global.set $streaming (i32.const 1))
    (global.set $streamReset (local.get $reset))
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
