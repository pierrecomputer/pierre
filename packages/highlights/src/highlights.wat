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
      [64:448)        theme table written by JavaScript, five bytes per token
      [448:1360)      CSS-variable name table
      [1360:1424)     lowercase word copy for case-insensitive keyword lookups
      [1424:3472)     byte-set bitmaps (byteset.get)
      [3472:3624)     emitter HTML fragments
      [3624:8448)     emitter span-open fragment cache
      [8448:8832)     saved theme bytes for the emitter span cache
      [8832:8864)     streaming delimiter
      [8864:10144)    streaming lexer checkpoints
      [10144:36960)   language keyword tables
      [36960:37984)   JSON nesting stack
      [37984:39008)   JavaScript bracket-kind stack
      [39008:39152)   JavaScript token-class bitset
      [39152:39296)   JavaScript token-kind to $Token map (enum-map)
      [39296:40320)   JavaScript template bracket stack
      [40320:41344)   JavaScript template HTML/CSS resume states
      [41344:45440)   JSX-mode stack
      [45440:46496)   markdown fence aliases
      [46496:46592)   nested markdown fence registers, one record per depth
      [46592:47616)   TOML nesting stack
      [47616:63632)   live tokenizer change list
      [63632:63760)   live tokenizer free-list heads
      [63760:65536)   Angular keyword table
    [] pages 2..N     (text buffer; a live instance lays them out itself,
                      see src/live.wat)
      [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) output HTML bytes or (end:u32, hl:u32) token records;
                      $ensureCap grows memory
  ;;)
  (memory (export "memory") 3)

  (import "./embed.wat")
  (import "./emit.wat")
  (import "./langs/angular-html.wat")
  (import "./langs/asm.wat")
  (import "./langs/astro.wat")
  (import "./langs/bash.wat")
  (import "./langs/c.wat")
  (import "./langs/c3.wat")
  (import "./langs/clojure.wat")
  (import "./langs/cmake.wat")
  (import "./langs/cpp.wat")
  (import "./langs/csharp.wat")
  (import "./langs/css.wat")
  (import "./langs/dart.wat")
  (import "./langs/diff.wat")
  (import "./langs/dockerfile.wat")
  (import "./langs/elixir.wat")
  (import "./langs/erlang.wat")
  (import "./langs/fsharp.wat")
  (import "./langs/gleam.wat")
  (import "./langs/glsl.wat")
  (import "./langs/go.wat")
  (import "./langs/graphql.wat")
  (import "./langs/groovy.wat")
  (import "./langs/haskell.wat")
  (import "./langs/hlsl.wat")
  (import "./langs/html.wat")
  (import "./langs/java.wat")
  (import "./langs/json.wat")
  (import "./langs/julia.wat")
  (import "./langs/kotlin.wat")
  (import "./langs/lisp.wat")
  (import "./langs/lua.wat")
  (import "./langs/makefile.wat")
  (import "./langs/markdown.wat")
  (import "./langs/matlab.wat")
  (import "./langs/mdx.wat")
  (import "./langs/nix.wat")
  (import "./langs/objc.wat")
  (import "./langs/ocaml.wat")
  (import "./langs/pascal.wat")
  (import "./langs/perl.wat")
  (import "./langs/php.wat")
  (import "./langs/powershell.wat")
  (import "./langs/proto.wat")
  (import "./langs/python.wat")
  (import "./langs/r.wat")
  (import "./langs/ruby.wat")
  (import "./langs/rust.wat")
  (import "./langs/scala.wat")
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
  (import "./live.wat")
  (import "./token.wat")

  ;; Numeric values are the public ABI mirrored by lib/highlighter.ts.
  (enum $Language
    "plain"
    "angular-html"
    "asm"
    "astro"
    "bash"
    "c"
    "c3"
    "clojure"
    "cmake"
    "cpp"
    "csharp"
    "css"
    "dart"
    "diff"
    "dockerfile"
    "elixir"
    "erlang"
    "fsharp"
    "gleam"
    "glsl"
    "go"
    "graphql"
    "groovy"
    "haskell"
    "hlsl"
    "html"
    "java"
    "js"
    "json"
    "jsx"
    "julia"
    "kotlin"
    "less"
    "lisp"
    "lua"
    "makefile"
    "markdown"
    "matlab"
    "mdx"
    "nix"
    "objc"
    "ocaml"
    "pascal"
    "perl"
    "php"
    "powershell"
    "proto"
    "python"
    "r"
    "ruby"
    "rust"
    "sass"
    "scala"
    "scss"
    "sql"
    "svelte"
    "swift"
    "terraform"
    "toml"
    "ts"
    "tsrx"
    "tsx"
    "vue"
    "wat"
    "wgsl"
    "xml"
    "yaml"
    "zig"
  )

  ;; language dispatch table, one entry per $Language member in enum order
  (table $hlDispatch funcref
    (elem
      $hlPlain $hlAngularHtml $hlAsm $hlAstro $hlBash $hlC $hlC3 $hlClojure $hlCmake $hlCpp
      $hlCsharp $hlCss $hlDart $hlDiff $hlDockerfile $hlElixir $hlErlang
      $hlFsharp $hlGleam $hlGlsl $hlGo $hlGraphql $hlGroovy $hlHaskell $hlHlsl
      $hlHtml $hlJava $hlJs $hlJson $hlJsx $hlJulia $hlKotlin $hlLess $hlLisp
      $hlLua $hlMakefile $hlMarkdown $hlMatlab $hlMdx $hlNix $hlObjc $hlOcaml
      $hlPascal $hlPerl $hlPhp $hlPowershell $hlProto $hlPython $hlR $hlRuby
      $hlRust $hlSass $hlScala $hlScss $hlSql $hlSvelte $hlSwift $hlTerraform
      $hlToml $hlTs $hlTsrx $hlTsx $hlVue $hlWat $hlWgsl $hlXml $hlYaml $hlZig))

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

  ;; Zero every cross-chunk stream global, the stream delimiter, and the
  ;; lexer checkpoint windows, matching a fresh Wasm instance. Called for a
  ;; stream reset and before the live tokenizer's first line. The windows
  ;; matter for a pooled instance: a lexer first entered on a later chunk (a
  ;; markdown fence body) restores its window, which must not hold the
  ;; previous stream's locals.
  (func $streamResetGlobals
    (memory.fill (i32.const $mem.streamDelimiter) (i32.const 0) (i32.const 32))
    (memory.fill (i32.const $mem.streamState) (i32.const 0)
      (i32.const $mem.streamStateUsed))
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
    (memory.fill (i32.const $mem.markdownFenceStack) (i32.const 0)
      (i32.sub (i32.const $mem.tomlStack) (i32.const $mem.markdownFenceStack)))
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
    (if (i32.eq (local.get $lang) (enum.get $Language.tsrx))
      (then (call $hlTsrxStream (local.get $reset)) (return)))
    ;; non-ecma lexers share the parameter-machine globals; the ecma stream
    ;; entries reset them in $hlEcmaImpl
    (if (local.get $reset) (then (call $sigReset)))
    ;; An open markdown fence owns the chunk start: its body resumes inside
    ;; the fence bounds ($markdownCodeRange runs the shared and per-language
    ;; resumes there), so the top-level resumes must not consume a mode the
    ;; body left open.
    (if (i32.and
          (i32.or
            (i32.eq (local.get $lang) (enum.get $Language.markdown))
            (i32.eq (local.get $lang) (enum.get $Language.mdx)))
          (i32.ne (call $markdownFenceReg) (i32.const 0)))
      (then
        (if (call $markdownStreamResume) (then (return)))
        (call $highlightLang (local.get $lang))
        (return)))
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
