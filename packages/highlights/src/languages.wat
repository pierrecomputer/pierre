(module
  ;; The language table: every language's names, its lexer, and the
  ;; dispatch by language id. The build derives the $Language enum, the
  ;; $hlDispatch table, the JavaScript name lookup, and the packed name list
  ;; at $mem.languageNames from the table below.
  (import "./embed.wat")
  (import "./langs/angular-html.wat")
  (import "./langs/asm.wat")
  (import "./langs/astro.wat")
  (import "./langs/bash.wat")
  (import "./langs/batch.wat")
  (import "./langs/c.wat")
  (import "./langs/c3.wat")
  (import "./langs/clojure.wat")
  (import "./langs/cmake.wat")
  (import "./langs/cpp.wat")
  (import "./langs/csharp.wat")
  (import "./langs/css.wat")
  (import "./langs/cuda.wat")
  (import "./langs/dart.wat")
  (import "./langs/diff.wat")
  (import "./langs/dockerfile.wat")
  (import "./langs/elixir.wat")
  (import "./langs/elm.wat")
  (import "./langs/erlang.wat")
  (import "./langs/fortran.wat")
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
  (import "./langs/solidity.wat")
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

  ;; Plain text and its aliases stay at ID 0; sort the remaining canonical names.
  (language-table
    (language "plain" $hlPlain "plaintext" "text" "txt")
    (language "angular-html" $hlAngularHtml)
    (language "asm" $hlAsm "assembly" "s")
    (language "astro" $hlAstro)
    (language "bash" $hlBash "sh" "shell" "shellscript" "shellsession" "zsh")
    (language "batch" $hlBatch "bat" "batchfile" "cmd" "dos")
    (language "c" $hlC "h")
    (language "c3" $hlC3)
    (language "clojure" $hlClojure "clj" "cljc" "cljs" "edn")
    (language "cmake" $hlCmake)
    (language "cpp" $hlCpp "c++" "cc" "cxx" "hh" "hpp" "hxx")
    (language "csharp" $hlCsharp "c#" "cs")
    (language "css" $hlCss)
    (language "cuda" $hlCuda "cu" "cuh")
    (language "dart" $hlDart)
    (language "diff" $hlDiff "git-commit" "git-rebase" "patch")
    (language "dockerfile" $hlDockerfile "containerfile" "docker")
    (language "elixir" $hlElixir "ex" "exs")
    (language "elm" $hlElm)
    (language "erlang" $hlErlang "erl" "hrl")
    (language "fortran" $hlFortran "f90" "f95" "f03" "f08" "fortran-free-form")
    (language "fortran-fixed-form" $hlFortranFixed "f" "for" "f77")
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
    (language "solidity" $hlSolidity "sol")
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
    (language "zig" $hlZig "zon"))

  ;; plain text: one unstyled token covering the whole input
  (func $hlPlain
    (call $emitTok (enum.get $Token.none) (global.get $ptr) (global.get $end))
    (global.set $ptr (global.get $end)))

  ;; an out-of-range id traps on the table bound, like the JS-side check
  (func $highlightLang (param $lang i32)
    (call_indirect (local.get $lang)))

  ;; The language whose name or alias is the word [$lhs,$rhs), or 0 (plain)
  ;; when none is; markdown resolves fence info words here. The build packs
  ;; every name of the language table into $mem.languageNames, grouped by
  ;; length: a u16 offset (from the table start) per length 0..19, where
  ;; group L spans [L, L+1), then each group's records - the language id and
  ;; the lowercase name, L + 1 bytes. Only the names of the same length are
  ;; compared, eight bytes at a time with the tail masked off, ASCII
  ;; case-insensitively (`| 0x20`; the names are lowercase). Loads past the
  ;; word or a record read slack or neighboring bytes that the mask discards.
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
    (i32.const 0))
)
