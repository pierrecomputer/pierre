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
      [64:2000)       theme table written by JavaScript, then the CSS-variable name table
      [2000:6976)     emitter HTML fragments and span-open fragment cache
      [6976:7008)     streaming delimiter
      [7008:11008)    streaming lexer checkpoints
      [11008:39456)   word tables: ECMAScript, C, and one per language (see src/memory.wat)
      [39456:40512)   markdown fence aliases
      [40512:41536)   JSON nesting stack
      [41536:42560)   TOML nesting stack
      [42560:42704)   ECMAScript token-class bitset
      [42704:43728)   ECMAScript template stack
      [43728:44752)   ECMAScript bracket-kind stack
      [44752:48848)   JSX-mode stack
      [48848:48912)   lowercase word copy for case-insensitive keyword lookups
      [48912:65536)   free
    [] pages 2..N     (text buffer; a live instance lays them out itself,
                      see src/live.wat)
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
  (import "./langs/c3.wat")
  (import "./langs/cpp.wat")
  (import "./langs/csharp.wat")
  (import "./langs/css.wat")
  (import "./langs/dart.wat")
  (import "./langs/diff.wat")
  (import "./langs/elixir.wat")
  (import "./langs/glsl.wat")
  (import "./langs/go.wat")
  (import "./langs/haskell.wat")
  (import "./langs/hlsl.wat")
  (import "./langs/html.wat")
  (import "./langs/java.wat")
  (import "./langs/json.wat")
  (import "./langs/kotlin.wat")
  (import "./langs/lisp.wat")
  (import "./langs/lua.wat")
  (import "./langs/markdown.wat")
  (import "./langs/mdx.wat")
  (import "./langs/objc.wat")
  (import "./langs/ocaml.wat")
  (import "./langs/perl.wat")
  (import "./langs/php.wat")
  (import "./langs/proto.wat")
  (import "./langs/python.wat")
  (import "./langs/ruby.wat")
  (import "./langs/rust.wat")
  (import "./langs/sql.wat")
  (import "./langs/svelte.wat")
  (import "./langs/swift.wat")
  (import "./langs/terraform.wat")
  (import "./langs/toml.wat")
  (import "./langs/tsx.wat")
  (import "./langs/vue.wat")
  (import "./langs/wat.wat")
  (import "./langs/wgsl.wat")
  (import "./langs/xml.wat")
  (import "./langs/yaml.wat")
  (import "./langs/zig.wat")
  (import "./langs/dockerfile.wat")
  (import "./langs/erlang.wat")
  (import "./langs/gleam.wat")
  (import "./langs/graphql.wat")
  (import "./langs/powershell.wat")
  (import "./langs/r.wat")
  (import "./langs/scala.wat")

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
    "c3"
    "csharp"
    "dart"
    "elixir"
    "hlsl"
    "java"
    "less"
    "lisp"
    "objc"
    "ocaml"
    "perl"
    "proto"
    "ruby"
    "sass"
    "scss"
    "terraform"
    "wgsl"
    "dockerfile"
    "erlang"
    "gleam"
    "graphql"
    "powershell"
    "r"
    "scala"
  )

  ;; language dispatch table, one entry per $Language member in enum order
  (table $hlDispatch funcref
    (elem
      $hlPlain $hlAsm $hlAstro $hlBash $hlC $hlCpp $hlCss $hlDiff $hlGlsl
      $hlGo $hlHaskell $hlHtml $hlJson $hlKotlin $hlLua $hlMarkdown $hlMdx
      $hlPhp $hlPython $hlRust $hlSql $hlSvelte $hlSwift $hlToml $hlVue
      $hlWat $hlXml $hlYaml $hlZig $hlJs $hlJsx $hlTs $hlTsx
      $hlC3 $hlCsharp $hlDart $hlElixir $hlHlsl $hlJava $hlLess $hlLisp
      $hlObjc $hlOcaml $hlPerl $hlProto $hlRuby $hlSass $hlScss $hlTerraform
      $hlWgsl $hlDockerfile $hlErlang $hlGleam $hlGraphql $hlPowershell $hlR
      $hlScala))

  ;; plain text: one unstyled token covering the whole input
  (func $hlPlain
    (call $emitTok (enum.get $Token.none) (global.get $ptr) (global.get $end))
    (global.set $ptr (global.get $end)))

  ;; an out-of-range id traps on the table bound, like the JS-side check
  (func $highlightLang (param $lang i32)
    (call_indirect (local.get $lang)))

  (func (export "highlight")
    (global.set $srcBase (i32.const 65536))
    (global.set $streaming (i32.const 0))
    (global.set $streamDepth (i32.const 0))
    ;; a pooled instance may hold parameter-machine state from a prior stream
    (call $sigReset)
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
              (then
                ;; a block scalar left open by the previous chunk is a
                ;; yaml-owned mode that the top-level resume only checks
                ;; for yaml documents; resume it inside the range first
                (if (i32.and
                      (i32.eqz (local.get $reset))
                      (i32.eq (global.get $streamMode) (i32.const 11)))
                  (then (drop (call $yamlStreamResume))))
                (call $hlYaml))
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
    ;; start-tag regions owned by the markup lexers (kinds 9-13)
    (if (i32.eq (global.get $streamRegionKind) (i32.const 9))
      (then (return (call $htmlStreamResumeTag))))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 10))
      (then (return (call $xmlStreamResumeTag))))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 11))
      (then (return (call $vueStreamResumeTag))))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 12))
      (then (return (call $svelteStreamResumeTag))))
    (if (i32.eq (global.get $streamRegionKind) (i32.const 13))
      (then (return (call $astroStreamResumeTag))))
    (if (global.get $streamRegionKind)
      (then (return (call $streamResumeRegion))))
    (if (i32.eq (local.get $lang) (enum.get $Language.python))
      (then (return (call $pyStreamResume))))
    (if (i32.eq (local.get $lang) (enum.get $Language.php))
      (then (return (call $phpStreamResume))))
    (if (i32.or
          (i32.eq (local.get $lang) (enum.get $Language.markdown))
          (i32.eq (local.get $lang) (enum.get $Language.mdx)))
      (then (return (call $markdownStreamResume))))
    (if (i32.and
          (i32.eq (local.get $lang) (enum.get $Language.yaml))
          (i32.eq (global.get $streamMode) (i32.const 11)))
      (then (return (call $yamlStreamResume))))
    (if (i32.and
          (i32.eq (local.get $lang) (enum.get $Language.bash))
          (i32.eq (global.get $streamMode) (i32.const 12)))
      (then (return (call $bashStreamResume))))
    (if (i32.and
          (i32.eq (local.get $lang) (enum.get $Language.toml))
          (i32.eq (global.get $streamMode) (i32.const 13)))
      (then (return (call $tomlStreamResume))))
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
      (then (call $hlJsStream (local.get $reset)) (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.jsx))
      (then (call $hlJsxStream (local.get $reset)) (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.ts))
      (then (call $hlTsStream (local.get $reset)) (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.tsx))
      (then (call $hlTsxStream (local.get $reset)) (return)))
    ;; non-ecma lexers share the parameter-machine globals; the ecma stream
    ;; entries reset them in $hlEcmaImpl
    (if (local.get $reset) (then (call $sigReset)))
    (if (call $streamResumeCommon) (then (return)))
    (if (call $streamResumeLang (local.get $lang)) (then (return)))
    (call $highlightLang (local.get $lang)))

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
