(module
  (;;
    memory structure
    [] page 1         (control, static data, and scratch)
      [0]             language id (u8)
      [1]             CSS-variable mode (u8)
      [2:6)           input length (u32 LE)
      [6:10)          output start (u32 LE)
      [10:14)         output length (u32 LE)
      [14:64)         reserved space
      [64:4800)       emitter, token, and lexer tables
      [4800:5824)     shared JSON/TOML/TSX-template stack
      [5824:6848)     TSX bracket-kind stack
      [6848:7872)     theme table written by JavaScript
      [7872:11968)    TSX JSX-mode stack
      [11968:65536)   free
    [] pages 2..N     (text buffer)
      [65536:EOF)     input, NUL sentinel, then at least 16 bytes of slack
      [(EOF+47)&~15:) output HTML; $ensureCap grows memory
  ;;)
  (memory (export "memory") 3)

  (import "./token.wat")
  (import "./emit.wat")
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
    "tsx"
    "vue"
    "wat"
    "xml"
    "yaml"
    "zig"
  )

  (func (export "highlight")
    (local $lang i32)
    (call $hlBegin)
    (local.set $lang (i32.load8_u (i32.const 0)))
    (block $lexDone
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
      (unreachable))
    (call $hlEnd))
)
