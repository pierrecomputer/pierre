(module
  ;; The language table: every language's names, its lexer, and the
  ;; dispatch by language id. The build derives the $Language enum, the
  ;; $hlDispatch table, the JavaScript name lookup, and the packed name list
  ;; at $mem.languageNames from the table below.
  (import "./embed.wat")
  (import "./langs/ada.wat")
  (import "./langs/apex.wat")
  (import "./langs/angular-html.wat")
  (import "./langs/apache.wat")
  (import "./langs/asciidoc.wat")
  (import "./langs/asm.wat")
  (import "./langs/astro.wat")
  (import "./langs/awk.wat")
  (import "./langs/bash.wat")
  (import "./langs/batch.wat")
  (import "./langs/bicep.wat")
  (import "./langs/blade.wat")
  (import "./langs/c.wat")
  (import "./langs/c3.wat")
  (import "./langs/clojure.wat")
  (import "./langs/cmake.wat")
  (import "./langs/cobol.wat")
  (import "./langs/coffee.wat")
  (import "./langs/cpp.wat")
  (import "./langs/csharp.wat")
  (import "./langs/css.wat")
  (import "./langs/csv.wat")
  (import "./langs/cuda.wat")
  (import "./langs/dart.wat")
  (import "./langs/diff.wat")
  (import "./langs/dockerfile.wat")
  (import "./langs/dotenv.wat")
  (import "./langs/elixir.wat")
  (import "./langs/elm.wat")
  (import "./langs/erb.wat")
  (import "./langs/erlang.wat")
  (import "./langs/fortran.wat")
  (import "./langs/fsharp.wat")
  (import "./langs/gdresource.wat")
  (import "./langs/gdscript.wat")
  (import "./langs/gdshader.wat")
  (import "./langs/gherkin.wat")
  (import "./langs/gleam.wat")
  (import "./langs/glsl.wat")
  (import "./langs/gnuplot.wat")
  (import "./langs/go.wat")
  (import "./langs/graphql.wat")
  (import "./langs/groq.wat")
  (import "./langs/groovy.wat")
  (import "./langs/haml.wat")
  (import "./langs/handlebars.wat")
  (import "./langs/haskell.wat")
  (import "./langs/haxe.wat")
  (import "./langs/hlsl.wat")
  (import "./langs/html.wat")
  (import "./langs/http.wat")
  (import "./langs/ini.wat")
  (import "./langs/java.wat")
  (import "./langs/jinja.wat")
  (import "./langs/json.wat")
  (import "./langs/julia.wat")
  (import "./langs/kotlin.wat")
  (import "./langs/latex.wat")
  (import "./langs/lean.wat")
  (import "./langs/liquid.wat")
  (import "./langs/lisp.wat")
  (import "./langs/log.wat")
  (import "./langs/lua.wat")
  (import "./langs/makefile.wat")
  (import "./langs/markdown.wat")
  (import "./langs/matlab.wat")
  (import "./langs/mdx.wat")
  (import "./langs/nginx.wat")
  (import "./langs/nim.wat")
  (import "./langs/nix.wat")
  (import "./langs/objc.wat")
  (import "./langs/ocaml.wat")
  (import "./langs/odin.wat")
  (import "./langs/pascal.wat")
  (import "./langs/perl.wat")
  (import "./langs/php.wat")
  (import "./langs/plsql.wat")
  (import "./langs/po.wat")
  (import "./langs/powershell.wat")
  (import "./langs/prisma.wat")
  (import "./langs/prolog.wat")
  (import "./langs/proto.wat")
  (import "./langs/pug.wat")
  (import "./langs/python.wat")
  (import "./langs/qml.wat")
  (import "./langs/r.wat")
  (import "./langs/razor.wat")
  (import "./langs/rst.wat")
  (import "./langs/ruby.wat")
  (import "./langs/rust.wat")
  (import "./langs/scala.wat")
  (import "./langs/solidity.wat")
  (import "./langs/sql.wat")
  (import "./langs/svelte.wat")
  (import "./langs/swift.wat")
  (import "./langs/tcl.wat")
  (import "./langs/terraform.wat")
  (import "./langs/toml.wat")
  (import "./langs/tsx.wat")
  (import "./langs/twig.wat")
  (import "./langs/verilog.wat")
  (import "./langs/vhdl.wat")
  (import "./langs/viml.wat")
  (import "./langs/vue.wat")
  (import "./langs/wat.wat")
  (import "./langs/wgsl.wat")
  (import "./langs/xml.wat")
  (import "./langs/yaml.wat")
  (import "./langs/zig.wat")

  ;; Plain text and its aliases stay at ID 0; sort the remaining canonical names.
  (language-table
    (language "plain" $hlPlain "plaintext" "text" "txt")
    (language "ada" $hlAda "adb" "ads")
    (language "angular-html" $hlAngularHtml)
    (language "apache" $hlApache "apacheconf" "htaccess")
    (language "apex" $hlApex)
    (language "asciidoc" $hlAsciidoc "adoc")
    (language "asm" $hlAsm "assembly" "mips" "mipsasm" "riscv" "s")
    (language "astro" $hlAstro)
    (language "awk" $hlAwk)
    (language "bash" $hlBash "sh" "shell" "shellscript" "shellsession" "zsh")
    (language "batch" $hlBatch "bat" "batchfile" "cmd" "dos")
    (language "bicep" $hlBicep)
    (language "blade" $hlBlade)
    (language "c" $hlC "h")
    (language "c3" $hlC3)
    (language "clojure" $hlClojure "clj" "cljc" "cljs" "edn")
    (language "cmake" $hlCmake)
    (language "cobol" $hlCobol "cbl" "cob")
    (language "coffee" $hlCoffee "coffeescript")
    (language "cpp" $hlCpp "c++" "cc" "cxx" "hh" "hpp" "hxx")
    (language "csharp" $hlCsharp "c#" "cs")
    (language "css" $hlCss "postcss" "qss")
    (language "csv" $hlCsv)
    (language "cuda" $hlCuda "cu" "cuh")
    (language "dart" $hlDart)
    (language "diff" $hlDiff "git-commit" "git-rebase" "patch")
    (language "dockerfile" $hlDockerfile "containerfile" "docker")
    (language "dotenv" $hlDotenv "env")
    (language "elixir" $hlElixir "ex" "exs")
    (language "elm" $hlElm)
    (language "erb" $hlErb)
    (language "erlang" $hlErlang "erl" "hrl")
    (language "fortran" $hlFortran "f90" "f95" "f03" "f08" "fortran-free-form")
    (language "fortran-fixed-form" $hlFortranFixed "f" "for" "f77")
    (language "fsharp" $hlFsharp "f#" "fs" "fsi" "fsx")
    (language "gdresource" $hlGdresource "godot-resource" "tres" "tscn")
    (language "gdscript" $hlGdscript "gd")
    (language "gdshader" $hlGdshader "gdshaderinc" "godot-shader")
    (language "gherkin" $hlGherkin "cucumber" "feature")
    (language "gleam" $hlGleam)
    (language "glsl" $hlGlsl "comp" "frag" "geom" "vert")
    (language "gnuplot" $hlGnuplot "gp")
    (language "go" $hlGo "golang")
    (language "graphql" $hlGraphql "gql")
    (language "groq" $hlGroq)
    (language "groovy" $hlGroovy "gradle" "gsh" "gvy" "gy" "nextflow" "nextflow-groovy" "nf")
    (language "haml" $hlHaml)
    (language "handlebars" $hlHandlebars "hbs" "mustache")
    (language "haskell" $hlHaskell "hs")
    (language "haxe" $hlHaxe "hx")
    (language "hlsl" $hlHlsl)
    (language "html" $hlHtml "htm" "html-derivative")
    (language "http" $hlHttp)
    (language "ini" $hlIni "desktop" "properties" "systemd")
    (language "java" $hlJava)
    (language "jinja" $hlJinja "j2" "jinja2")
    (language "js" $hlJs "cjs" "javascript" "mjs")
    (language "json" $hlJson "jsonc")
    (language "json5" $hlJson5)
    (language "jsonl" $hlJsonl)
    (language "jsx" $hlJsx)
    (language "julia" $hlJulia "jl")
    (language "kotlin" $hlKotlin "kt" "kts")
    (language "latex" $hlLatex "tex")
    (language "lean" $hlLean "lean4")
    (language "less" $hlLess)
    (language "liquid" $hlLiquid)
    (language "lisp" $hlLisp "cl" "el" "elisp" "emacs-lisp" "lsp" "scheme" "scm")
    (language "log" $hlLog)
    (language "lua" $hlLua)
    (language "makefile" $hlMakefile "make" "mk")
    (language "markdown" $hlMarkdown "mdc" "md")
    (language "matlab" $hlMatlab "octave")
    (language "mdx" $hlMdx)
    (language "nginx" $hlNginx)
    (language "nim" $hlNim)
    (language "nix" $hlNix)
    (language "objc" $hlObjc "m" "mm" "objcpp" "objective-c" "objective-cpp" "objectivec")
    (language "ocaml" $hlOcaml "ml" "mli")
    (language "odin" $hlOdin)
    (language "pascal" $hlPascal "delphi" "dpk" "dpr" "lpr" "object-pascal" "objectpascal" "pas" "pp")
    (language "perl" $hlPerl "pl" "pm")
    (language "php" $hlPhp)
    (language "plsql" $hlPlsql)
    (language "po" $hlPo "pot" "potx")
    (language "powershell" $hlPowershell "ps" "ps1" "psd1" "psm1" "pwsh")
    (language "prisma" $hlPrisma)
    (language "prolog" $hlProlog)
    (language "proto" $hlProto "protobuf")
    (language "pug" $hlPug "jade")
    (language "python" $hlPython "py")
    (language "qml" $hlQml)
    (language "r" $hlR "rscript")
    (language "razor" $hlRazor "cshtml")
    (language "rst" $hlRst "restructuredtext")
    (language "ruby" $hlRuby "rb")
    (language "rust" $hlRust "rs")
    (language "sass" $hlSass)
    (language "scala" $hlScala "sbt" "sc")
    (language "scss" $hlScss)
    (language "solidity" $hlSolidity "sol")
    (language "sql" $hlSql)
    (language "svelte" $hlSvelte)
    (language "swift" $hlSwift)
    (language "tcl" $hlTcl)
    (language "terraform" $hlTerraform "hcl" "tf" "tfvars")
    (language "toml" $hlToml)
    (language "ts" $hlTs "angular-ts" "cts" "lit" "mts" "ts-tags" "typescript")
    (language "tsrx" $hlTsrx)
    (language "tsv" $hlTsv)
    (language "tsx" $hlTsx)
    (language "twig" $hlTwig)
    (language "verilog" $hlVerilog "sv" "svh" "system-verilog" "systemverilog")
    (language "vhdl" $hlVhdl "vhd")
    (language "viml" $hlViml "vim" "vimscript")
    (language "vue" $hlVue "vue-html")
    (language "wat" $hlWat "wasm")
    (language "wgsl" $hlWgsl)
    (language "xml" $hlXml "svg" "xsd" "xsl" "xslt")
    (language "yaml" $hlYaml "yml")
    (language "zig" $hlZig "zon"))

  ;; plain text: one unstyled token covering the whole input
  (func $hlPlain
    (call $emitTok (enum.get $Token.none) (global.get $ptr) (global.get $end))
    (global.set $ptr (global.get $end)))

  ;; an out-of-range id traps on the table bound, like the JS-side check
  (func $highlightLang (param $lang i32)
    (call_indirect (local.get $lang)))

  ;; Find the language for name or alias [$lhs,$rhs). Return 0 (plain) if
  ;; absent. Markdown uses this for fence info strings.
  ;; The build groups names by length in $mem.languageNames. A u16 offset
  ;; per length 0..19 precedes the records. Group L spans offsets [L, L+1).
  ;; Each record holds a language ID and lowercase name, L + 1 bytes total.
  ;; Compare equal-length names eight bytes at a time, ignoring ASCII case
  ;; with `| 0x20`. Masks discard bytes loaded past a word or record.
  (func $languageByName (param $lhs i32) (param $rhs i32) (result i32)
    (local $i i32)
    (local $len i32)
    (local $mask i64)
    (local $record i32)
    (local $rem i32)
    (local $stop i32)
    (local $word i64)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $len) (i32.const 1)) (i32.const 17))
      (then (return (i32.const 0))))
    (local.set $record
      (i32.add
        (i32.const $mem.languageNames)
        (i32.load16_u offset=$mem.languageNames (i32.shl (local.get $len) (i32.const 1)))))
    (local.set $stop
      (i32.add
        (i32.const $mem.languageNames)
        (i32.load16_u offset=$mem.languageNames+2 (i32.shl (local.get $len) (i32.const 1)))))
    ;; the word's first eight bytes and their mask, compared once per record
    (local.set $word
      (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
    (local.set $mask
      (select
        (i64.const -1)
        (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $len) (i32.const 3))))
          (i64.const 1))
        (i32.ge_u (local.get $len) (i32.const 8))))
    (block $done
      (loop $alias
        (br_if $done (i32.ge_u (local.get $record) (local.get $stop)))
        (block $miss
          (br_if $miss
            (i64.ne
              (i64.and
                (i64.xor (local.get $word) (i64.load offset=1 (local.get $record)))
                (local.get $mask))
              (i64.const 0)))
          ;; a name over eight bytes compares its remaining chunks
          (local.set $i (i32.const 8))
          (block $matched
            (loop $chunk
              (br_if $matched (i32.ge_u (local.get $i) (local.get $len)))
              (local.set $rem (i32.sub (local.get $len) (local.get $i)))
              (br_if $miss
                (i64.ne
                  (i64.and
                    (i64.xor
                      (i64.or
                        (i64.load (i32.add (local.get $lhs) (local.get $i)))
                        (i64.const 0x2020202020202020))
                      (i64.load offset=1 (i32.add (local.get $record) (local.get $i))))
                    (select
                      (i64.const -1)
                      (i64.sub
                        (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $rem) (i32.const 3))))
                        (i64.const 1))
                      (i32.ge_u (local.get $rem) (i32.const 8))))
                  (i64.const 0)))
              (local.set $i (i32.add (local.get $i) (i32.const 8)))
              (br $chunk)))
          (return (i32.load8_u (local.get $record))))
        (local.set $record (i32.add (local.get $record) (i32.add (local.get $len) (i32.const 1))))
        (br $alias)))
    (i32.const 0))

  ;; 1 for the ECMAScript family, whose stream entries keep their own
  ;; resumable machine instead of checkpointed lexer locals.
  (func $isEcmaLang (param $lang i32) (result i32)
    (i32.or
      (i32.or
        (i32.eq (local.get $lang) (enum.get $Language.js))
        (i32.eq (local.get $lang) (enum.get $Language.jsx)))
      (i32.or
        (i32.or
          (i32.eq (local.get $lang) (enum.get $Language.ts))
          (i32.eq (local.get $lang) (enum.get $Language.tsx)))
        (i32.eq (local.get $lang) (enum.get $Language.tsrx)))))

  ;; Stream a chunk of an ECMAScript-family language through its resumable
  ;; entry and return 1; return 0 without lexing for any other language.
  (func $ecmaStreamLang (param $lang i32) (param $reset i32) (result i32)
    (if (i32.eq (local.get $lang) (enum.get $Language.js))
      (then
        (call $hlJsStream (local.get $reset))
        (return (i32.const 1))))
    (if (i32.eq (local.get $lang) (enum.get $Language.jsx))
      (then
        (call $hlJsxStream (local.get $reset))
        (return (i32.const 1))))
    (if (i32.eq (local.get $lang) (enum.get $Language.ts))
      (then
        (call $hlTsStream (local.get $reset))
        (return (i32.const 1))))
    (if (i32.eq (local.get $lang) (enum.get $Language.tsx))
      (then
        (call $hlTsxStream (local.get $reset))
        (return (i32.const 1))))
    (if (i32.eq (local.get $lang) (enum.get $Language.tsrx))
      (then
        (call $hlTsrxStream (local.get $reset))
        (return (i32.const 1))))
    (i32.const 0))

  ;; Resume a construct $lang's lexer left open at the previous chunk end:
  ;; start tags and embedded regions first, then the modes owned by one
  ;; language. Returns 1 when the construct consumed the whole range. Shared
  ;; by the top-level stream and markdown fence bodies.
  (func $streamResumeLang (param $lang i32) (result i32)
    ;; an HTTP body bounds the regions and modes of its own lexer
    (if (i32.eq (global.get $streamRegionKind) (i32.const 29))
      (then (return (call $httpStreamResume))))
    (if
      (i32.and
        (i32.eq (local.get $lang) (enum.get $Language.erb))
        (i32.le_u (i32.sub (global.get $streamRegionKind) (i32.const 26)) (i32.const 1)))
      (then (return (call $erbStreamResume))))
    (if
      (i32.and
        (i32.eq (global.get $streamRegionKind) (i32.const 28))
        (i32.or
          (i32.eq (local.get $lang) (enum.get $Language.haml))
          (i32.eq (local.get $lang) (enum.get $Language.pug))))
      (then (return (call $indentStreamResume))))
    ;; WARNING: Blade and Razor resume an open script or style body in their own
    ;; lexer: the body's end clears every checkpoint, so they load state first
    (if
      (i32.and
        (i32.ne (global.get $streamRegionKind) (i32.const 0))
        (i32.or
          (i32.eq (local.get $lang) (enum.get $Language.blade))
          (i32.eq (local.get $lang) (enum.get $Language.razor))))
      (then
        (call $highlightLang (local.get $lang))
        (return (i32.const 1))))
    ;; an open start-tag (kinds 9-13) or embedded region
    (if (global.get $streamRegionKind)
      (then (return (call $streamResumeAnyRegion))))
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
    (if
      (i32.and
        (i32.eq (local.get $lang) (enum.get $Language.odin))
        (i32.eq (global.get $streamMode) (i32.const 23)))
      (then (return (call $odinStreamResumeTriple))))
    (if
      (i32.and
        (i32.eq (local.get $lang) (enum.get $Language.groq))
        (i32.eq (global.get $streamMode) (i32.const 16)))
      (then (return (call $groqStreamResume))))
    (i32.const 0))
)
