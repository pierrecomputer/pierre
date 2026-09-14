(module
  (;;
    memory structure
    [] page 1         (control, static data, and scratch)
      [0]             language id (u8)
      [1]             output mode (u8): 0 inline colors, 1 CSS variables,
                      3 UTF-16 line records
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:18)         CSS-variable prefix address (u32 LE)
      [18:22)         CSS-variable prefix byte length (u32 LE)
      [22:64)         reserved space
      [64:448)        theme table written by JavaScript, five bytes per token
      [448:1360)      CSS-variable name table
      [1360:1424)     lowercase word copy for case-insensitive keyword lookups
      [1424:3472)     byte-set bitmaps (byteset.get)
      [3472:3624)     emitter HTML fragments
      [3624:8448)     emitter span-open fragment cache
      [8448:8832)     saved theme bytes for the emitter span cache
      [8832:8864)     streaming delimiter
      [8864:10144)    streaming lexer checkpoints
      [10144:20544)   language keyword tables (displacements and descriptors)
      [20544:28736)   keyword pool: the word bytes every table shares
      [28736:29760)   JSON nesting stack
      [29760:30784)   JavaScript bracket-kind stack
      [30784:30928)   JavaScript token-class bitset
      [30928:31072)   JavaScript token-kind to $Token map (enum-map)
      [31072:32096)   JavaScript template bracket stack
      [32096:33120)   JavaScript template HTML/CSS resume states
      [33120:37216)   JSX-mode stack
      [37216:38272)   markdown fence aliases
      [38272:38368)   nested markdown fence registers, one record per depth
      [38368:39392)   TOML nesting stack
      [39392:55408)   live tokenizer change list
      [55408:55536)   live tokenizer free-list heads
      [55536:65536)   free
    [] pages 2..N     (text buffer; a live instance lays them out itself,
                      see src/live.wat)
      [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) CSS-variable prefix bytes in mode 1, then output HTML;
                      other modes start output here directly;
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

  ;; Declaration order is the language ABI; append new languages to keep IDs stable.
  (language-table
    (language "plain" $hlPlain "plaintext" "text" "txt")
    (language "angular-html" $hlAngularHtml)
    (language "asm" $hlAsm "assembly" "s")
    (language "astro" $hlAstro)
    (language "bash" $hlBash "sh" "shell" "shellscript" "shellsession" "zsh")
    (language "c" $hlC "h")
    (language "c3" $hlC3)
    (language "clojure" $hlClojure "clj" "cljc" "cljs" "edn")
    (language "cmake" $hlCmake)
    (language "cpp" $hlCpp "c++" "cc" "cxx" "hh" "hpp" "hxx")
    (language "csharp" $hlCsharp "c#" "cs")
    (language "css" $hlCss)
    (language "dart" $hlDart)
    (language "diff" $hlDiff "git-commit" "git-rebase" "patch")
    (language "dockerfile" $hlDockerfile "containerfile" "docker")
    (language "elixir" $hlElixir "ex" "exs")
    (language "erlang" $hlErlang "erl" "hrl")
    (language "fsharp" $hlFsharp "f#" "fs" "fsi" "fsx")
    (language "gleam" $hlGleam)
    (language "glsl" $hlGlsl "comp" "frag" "geom" "vert")
    (language "go" $hlGo "golang")
    (language "graphql" $hlGraphql "gql")
    (language "groovy" $hlGroovy "gradle" "gsh" "gvy" "gy")
    (language "haskell" $hlHaskell "hs")
    (language "hlsl" $hlHlsl)
    (language "html" $hlHtml "htm")
    (language "java" $hlJava)
    (language "js" $hlJs "cjs" "javascript" "mjs")
    (language "json" $hlJson "jsonc")
    (language "jsx" $hlJsx)
    (language "julia" $hlJulia "jl")
    (language "kotlin" $hlKotlin "kt" "kts")
    (language "less" $hlLess)
    (language "lisp" $hlLisp "cl" "el" "elisp" "emacs-lisp" "lsp" "scheme" "scm")
    (language "lua" $hlLua)
    (language "makefile" $hlMakefile "make" "mk")
    (language "markdown" $hlMarkdown "md")
    (language "matlab" $hlMatlab "octave")
    (language "mdx" $hlMdx)
    (language "nix" $hlNix)
    (language "objc" $hlObjc "m" "mm" "objcpp" "objective-c" "objective-cpp" "objectivec")
    (language "ocaml" $hlOcaml "ml" "mli")
    (language "pascal" $hlPascal "delphi" "dpk" "dpr" "lpr" "object-pascal" "objectpascal" "pas" "pp")
    (language "perl" $hlPerl "pl" "pm")
    (language "php" $hlPhp)
    (language "powershell" $hlPowershell "ps" "ps1" "psd1" "psm1" "pwsh")
    (language "proto" $hlProto "protobuf")
    (language "python" $hlPython "py")
    (language "r" $hlR "rscript")
    (language "ruby" $hlRuby "rb")
    (language "rust" $hlRust "rs")
    (language "sass" $hlSass)
    (language "scala" $hlScala "sbt" "sc")
    (language "scss" $hlScss)
    (language "sql" $hlSql)
    (language "svelte" $hlSvelte)
    (language "swift" $hlSwift)
    (language "terraform" $hlTerraform "hcl" "tf" "tfvars")
    (language "toml" $hlToml)
    (language "ts" $hlTs "angular-ts" "cts" "mts" "typescript")
    (language "tsrx" $hlTsrx)
    (language "tsx" $hlTsx)
    (language "vue" $hlVue)
    (language "wat" $hlWat "wasm")
    (language "wgsl" $hlWgsl)
    (language "xml" $hlXml "svg" "xsd")
    (language "yaml" $hlYaml "yml")
    (language "zig" $hlZig))

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
    (if
      (i32.or
        (i32.eq (local.get $lang) (enum.get $Language.markdown))
        (i32.eq (local.get $lang) (enum.get $Language.mdx)))
      (then (return (call $markdownStreamResume))))
    (if
      (i32.and
        (i32.eq (local.get $lang) (enum.get $Language.yaml))
        (i32.eq (global.get $streamMode) (i32.const 11)))
      (then (return (call $yamlStreamResume))))
    (if
      (i32.and
        (i32.eq (local.get $lang) (enum.get $Language.bash))
        (i32.eq (global.get $streamMode) (i32.const 12)))
      (then (return (call $bashStreamResume))))
    (if
      (i32.and
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
    (memory.fill
      (i32.const $mem.markdownFenceStack)
      (i32.const 0)
      (i32.sub (i32.const $mem.tomlStack) (i32.const $mem.markdownFenceStack)))
    (global.set $phpStreamingCode (i32.const 0))
    (global.set $phpStreamDecl (i32.const 0))
    (global.set $phpStreamMember (i32.const 0)))

  ;; Lex one chunk of $lang in streaming mode: resume any open multiline
  ;; construct or embedded region, then continue with the language lexer.
  ;; Shared by highlightStream and the live tokenizer's per-line runs.
  (func $streamChunk (param $lang i32) (param $reset i32)
    (if (i32.eq (local.get $lang) (enum.get $Language.js))
      (then
        (call $hlJsStream (local.get $reset))
        (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.jsx))
      (then
        (call $hlJsxStream (local.get $reset))
        (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.ts))
      (then
        (call $hlTsStream (local.get $reset))
        (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.tsx))
      (then
        (call $hlTsxStream (local.get $reset))
        (return)))
    (if (i32.eq (local.get $lang) (enum.get $Language.tsrx))
      (then
        (call $hlTsrxStream (local.get $reset))
        (return)))
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
